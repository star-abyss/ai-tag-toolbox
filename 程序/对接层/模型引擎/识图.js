// 模型引擎 · 识图。本地打标：WD EVA02 Tagger 那一类模型。
//
// 一次打标：
//   ① 预处理：sharp 解图 → 底色铺白 → 缩放（contain）到模型要的边长 → 去 alpha → 原始 RGB
//   ② 排成 NCHW：按模型要的通道顺序（默认 BGR），每个通道除以 255
//   ③ 推理：onnxruntime，输出每个标签的概率
//   ④ 对应标签表：tags-canary.json 是 `[名字, 分类号, 出现次数]` 的数组，下标就是输出位
//
// 模型与标签表路径从模型目录扫描结果读取。

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

import { 要一次, 找一格, 格里的文件 } from './目录.js';

const 要 = createRequire(import.meta.url);

/** 一张图默认缩到多大。 */
const 默认边长 = 448;

/** 标签表：数组或对象都收，统一成 `[{ 词, 分类, 次数 }]`，下标就是输出位。 */
function 读标签表(文件) {
  const 原始 = JSON.parse(fs.readFileSync(文件, 'utf8'));
  const 列 = Array.isArray(原始)
    ? 原始
    : Object.keys(原始)
      .sort((a, b) => Number(a) - Number(b))
      .map((k) => 原始[k]);
  return 列.map((一, i) => {
    if (Array.isArray(一)) {
      return {
        词: String(一[0] === undefined || 一[0] === null ? `#${i}` : 一[0]),
        分类: Number.isFinite(Number(一[1])) ? Number(一[1]) : 0,
        次数: Number.isFinite(Number(一[2])) ? Number(一[2]) : 0,
      };
    }
    if (一 && typeof 一 === 'object') {
      return {
        词: String(一.name || 一.tag || 一.en || `#${i}`),
        分类: Number.isFinite(Number(一.category ?? 一.categoryCode)) ? Number(一.category ?? 一.categoryCode) : 0,
        次数: Number.isFinite(Number(一.count)) ? Number(一.count) : 0,
      };
    }
    return { 词: String(一 === undefined || 一 === null ? `#${i}` : 一), 分类: 0, 次数: 0 };
  });
}

/** 把原始 RGB 排成 NCHW 的 float。 */
function 排NCHW(rgb, 边长, 按BGR) {
  const 格数 = 边长 * 边长;
  const 出 = new Float32Array(格数 * 3);
  for (let i = 0; i < 格数; i += 1) {
    const r = rgb[i * 3];
    const g = rgb[i * 3 + 1];
    const b = rgb[i * 3 + 2];
    出[i] = (按BGR ? b : r) / 255;
    出[格数 + i] = g / 255;
    出[格数 * 2 + i] = (按BGR ? r : b) / 255;
  }
  return 出;
}

/**
 * 装一个打标引擎（一格的模型）。
 * @param {object} 参数
 *   模型目录  项目里的 `模型/` 那一层
 *   格        model id；不给就用第一格装好的
 */
export async function 造打标器({ 模型目录, 格 = '' }) {
  const ort = 要('onnxruntime-node');
  const sharp = 要('sharp');
  const 一格 = 找一格(模型目录, 'vision', 格);
  if (!一格) throw new Error(`模型目录里没有识图模型：${模型目录}`);
  if (!一格.装好了) throw new Error(`识图模型「${一格.id}」没装好：${一格.缺什么.join('；')}`);

  const 模型路径 = 格里的文件(一格, '模型');
  const 词表路径 = 格里的文件(一格, '词表') || 格里的文件(一格, '标签');
  const 边长 = Number(一格.参数 && 一格.参数.边长) || 默认边长;
  const 按BGR = 一格.参数 && 一格.参数.通道 ? String(一格.参数.通道).toLowerCase() === 'bgr' : true;
  const 自带阈值 = Number(一格.参数 && 一格.参数.阈值) || 0.35;

  const 会话 = await 要一次(`识图会话:${模型路径}`, () =>
    ort.InferenceSession.create(模型路径, { executionProviders: ['cpu'] }));
  const 词表 = await 要一次(`识图词表:${词表路径 || 模型路径}`, async () =>
    (词表路径 ? 读标签表(词表路径) : []));

  const 入口 = (会话.inputNames && 会话.inputNames[0]) || 'input';
  const 出口 = (会话.outputNames && 会话.outputNames[0]) || 'output';

  /**
   * 打标。
   * @param {Buffer|Uint8Array} 字节
   * @param {{阈值?:number, 上限?:number}} [选项]
   * @returns {Promise<{标签:Array, 尺寸:object, 阈值:number}>}
   */
  async function 打标(字节, 选项 = {}) {
    const 阈值 = Number(选项.阈值) > 0 && Number(选项.阈值) <= 1 ? Number(选项.阈值) : 自带阈值;

    // ① 预处理：铺白底、按 contain 缩放、去 alpha、拿原始 RGB
    const 解 = await sharp(Buffer.from(字节))
      .flatten({ background: { r: 255, g: 255, b: 255 } })
      .resize(边长, 边长, { fit: 'contain', background: { r: 255, g: 255, b: 255 } })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const 信息 = 解.info || {};
    const 通道 = Number(信息.channels) || 3;

    // ② NCHW
    const 张量 = new ort.Tensor('float32', 排NCHW(解.data, 边长, 按BGR), [1, 3, 边长, 边长]);

    // ③ 推理
    const 跑 = await 会话.run({ [入口]: 张量 });
    const 原始输出 = 跑[出口] || Object.values(跑)[0];
    const 值 = 原始输出 && 原始输出.data;
    if (!值 || typeof 值.length !== 'number') throw new Error('模型没有返回结果');

    // ④ 过阈值、按概率排
    const 出 = [];
    for (let i = 0; i < 值.length; i += 1) {
      let p = Number(值[i]);
      if (!Number.isFinite(p)) continue;
      if (p < 0 || p > 1) p = 1 / (1 + Math.exp(-p));   // 少数导出版本给的是 logits
      if (p < 阈值) continue;
      const 一 = 词表[i] || { 词: `#${i}`, 分类: 0, 次数: 0 };
      出.push({
        词: 一.词,
        概率: Math.round(p * 10000) / 10000,
        分类: 一.分类,
        次数: 一.次数,
      });
    }
    出.sort((a, b) => b.概率 - a.概率);
    const 上限 = Number(选项.上限) || 0;
    return {
      标签: 上限 > 0 ? 出.slice(0, 上限) : 出,
      尺寸: { 宽: Number(解.info && 解.info.width) || 边长, 高: Number(解.info && 解.info.height) || 边长, 缩放到: 边长, 通道 },
      阈值,
    };
  }

  return {
    打标,
    id: 一格.id,
    名字: 一格.名字,
    阈值: 自带阈值,
    词表条数: 词表.length,
    模型路径,
  };
}
