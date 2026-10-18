'use strict';
/*
 * 识图模块 · 假适配器。自包含：几张假图放在内存里，打标给可控的假结果。
 * 自检靠它跑，不碰真图库、不碰真模型。
 *
 *   const 端口 = createFakeAdapter({ 图们, 标签们, 词表 })
 *     图们    { <条目ID>: 字节 }            假图库
 *     标签们   [{ 词, 概率, 分类 }]         假打标结果（不按阈值筛，引擎那边筛）
 *     词表    { <英文词>: <中文名> }        假查词
 */

const { 读PNG元数据 } = require('./元数据.js');

/**
 * @param {object} [选项]
 * @returns {{取图字节:Function, 查词:Function, tagger:object, 看图:Function, 读元数据:Function, 引擎:object}}
 */
function createFakeAdapter(选项 = {}) {
  const 图们 = 选项.图们 && typeof 选项.图们 === 'object' ? 选项.图们 : {};
  const 标签们 = Array.isArray(选项.标签们) ? 选项.标签们 : [];
  const 词表 = 选项.词表 && typeof 选项.词表 === 'object' ? 选项.词表 : {};

  /** 取图：按条目 ID 找，找不到给 null。 */
  function 取图字节(引用) {
    const 字节 = 图们[引用 && 引用.条目ID];
    return 字节 ? { 字节, mime: 'image/png' } : null;
  }

  /** 查词：表里有给中文名，没有给 null。 */
  function 查词(词们) {
    return (Array.isArray(词们) ? 词们 : []).map((一) => (词表[一] === undefined ? null : 词表[一]));
  }

  /** 假引擎：按阈值筛假标签，按概率排。 */
  const tagger = {
    async 打标(字节, 打标选项 = {}) {
      if (!字节) throw new Error('没有字节');
      const 阈值 = Number(打标选项.阈值) || 0.35;
      const 过 = 标签们
        .filter((一) => Number(一.概率) >= 阈值)
        .sort((a, b) => Number(b.概率) - Number(a.概率))
        .map((一) => ({ ...一 }));
      const 上限 = Number(打标选项.上限) || 0;
      return {
        标签: 上限 > 0 ? 过.slice(0, 上限) : 过,
        尺寸: { 宽: 448, 高: 448 },
        阈值,
      };
    },
  };

  /** 假看图：把参考标签原样交回来，再拼一句描述。 */
  async function 看图(输入 = {}) {
    const 参考 = Array.isArray(输入.参考标签) ? 输入.参考标签 : [];
    return {
      标签: 参考.map((一) => ({ 词: String(一), 概率: null, 分类: 0 })),
      描述: `假描述（提示：${输入.提示 || '无'}）`,
      模型: '假看图模型',
      用量: { 输入: 1, 输出: 1 },
    };
  }

  return {
    取图字节,
    查词,
    tagger,
    看图,
    读元数据: (字节) => 读PNG元数据(字节),
    引擎: { id: '假引擎', 名字: '假打标引擎', 阈值: 0.6094 },
  };
}

module.exports = { createFakeAdapter };
