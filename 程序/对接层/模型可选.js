// 本地模型那一层。两件事：
//   ① 列：扫模型目录，说出装了哪几格、缺什么、这次用哪一格
//   ② 换：运行中把这一格换掉，不用重起
//
// 门面拿到的是"转交对象"：每次调用现查"现在用哪一格"，所以换模型不必重装门面。
// 引擎本身是懒的：造打标器要装 1.25 GB 的 ONNX，第一次用到才装，装过按 id 留着。
//
// 调试台（tools/动作浏览器/）与界面层（界面/）用的是同一份。
import path from 'node:path';

import { 列模型, 找一格, 造译端口, 造打标器 } from './模型引擎/index.js';

/**
 * 造本地模型那一层。
 * @param {object} 参数
 *   项目根  项目根
 *   配置    模型目录为模型根绝对路径；包含翻译模型 / 识图模型 / 翻译方向
 *   onChange 配置变化时接收完整的新配置
 */
export function 造本地模型({ 项目根, 配置, onChange }) {
  const 模型目录 = 配置.模型目录 ? path.resolve(配置.模型目录) : '';

  /** 这次用哪一格；空串 = 跟着"目录里第一格装好的"走。 */
  let 选的 = {
    vision: String(配置.识图模型 || ''),
    translation: String(配置.翻译模型 || ''),
  };
  const 默认方向 = 配置.翻译方向 || 'en-zh';

  /** 装过的打标器按 id 留着，不重复装。 */
  const 打标器们 = new Map();

  /** 现在这一格用哪个 id：选项失效时返回空，不自动换到别的模型。 */
  function 用的是(类别) {
    const 明确选择 = 选的[类别];
    const 一格 = 明确选择
      ? 找一格(模型目录, 类别, 明确选择)
      : 找一格(模型目录, 类别);
    return 一格 && 一格.装好了 ? 一格.id : '';
  }

  /** 目录里现在有哪几格，装好了没有。 */
  function 列() {
    const 扫出来 = 模型目录 ? 列模型(模型目录) : { vision: [], translation: [] };
    const 收拾 = (类别) => 扫出来[类别].map((一) => ({
      id: 一.id,
      名字: 一.名字,
      类别,
      装好了: 一.装好了,
      缺什么: 一.缺什么,
      引擎: 一.引擎,
      这次用: 一.id === 用的是(类别),
    }));
    return {
      目录: 模型目录,
      vision: 收拾('vision'),
      translation: 收拾('translation'),
      这次用: { vision: 用的是('vision'), translation: 用的是('translation') },
    };
  }

  /** 换一格。不认这一格就不动，如实说。 */
  async function 换(类别, id) {
    if (类别 !== 'vision' && 类别 !== 'translation') {
      return { ok: false, reason: `没有「${类别}」这一类；只有 vision 与 translation`, code: 'HOST_BAD_KIND' };
    }
    const 要换的 = String(id || '');
    if (要换的) {
      const 一格 = 找一格(模型目录, 类别, 要换的);
      if (!一格) return { ok: false, reason: `模型目录里没有「${要换的}」这一格`, code: 'HOST_NO_MODEL' };
      if (!一格.装好了) return { ok: false, reason: `「${要换的}」没装好：${一格.缺什么.join('；')}`, code: 'HOST_MODEL_INCOMPLETE' };
    }
    if (typeof onChange === 'function') {
      await onChange(类别, 要换的);
    }
    选的[类别] = 要换的;
    return { ok: true, data: 列() };
  }

  /** 打标那一格：名字与阈值从目录现取，打标时现查用哪一格。 */
  const 打标 = {
    get id() { return 用的是('vision'); },
    get 名字() {
      const id = 用的是('vision');
      const 一格 = id ? 找一格(模型目录, 'vision', id) : null;
      return 一格 ? 一格.名字 : '';
    },
    get 阈值() {
      const id = 用的是('vision');
      const 一格 = id ? 找一格(模型目录, 'vision', id) : null;
      return (一格 && 一格.参数 && 一格.参数.阈值) || undefined;
    },
    async 打标(字节, 选项) {
      const id = 用的是('vision');
      if (!id) throw new Error('没有装好的识图模型');
      if (!打标器们.has(id)) 打标器们.set(id, await 造打标器({ 模型目录, 格: id }));
      return 打标器们.get(id).打标(字节, 选项);
    },
  };

  /**
   * 翻译那一格的"译"端口：**必须是个函数本身**（翻译模块校验得严，对象过不去）。
   * 里面每次现查"现在用哪一格"，所以换模型不用重装。
   */
  const 译 = async function 译(报文) {
    const id = 用的是('translation');
    if (!id) return { ok: false, reason: '没有装好的翻译模型', code: 'TEXT_LOCAL_NO_ENGINE' };
    // 造译端口给的就是一个 `译(报文)` 函数；真正的模型在引擎里按路径缓存，这里现造很轻。
    const 译一格 = 造译端口({ 模型目录, 格: id, 默认方向 });
    return 译一格(报文);
  };

  return { 打标, 译, 列, 换 };
}
