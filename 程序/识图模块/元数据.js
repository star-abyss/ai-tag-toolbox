'use strict';
/*
 * 识图模块 · 读 PNG 元数据（纯函数，不 require fs）。
 *
 * AI 画的 PNG 里常常藏着生成信息，三种常见放法：
 *   ① tEXt / iTXt 块：键是 parameters / prompt / Comment / Software …
 *   ② zTXt 块：同样的东西，压缩过
 *   ③ EXIF（JPEG/TIFF 里）
 *
 * 这里只认 PNG 的三种块。
 * 交回来的形状：
 *   { 有: 真伪, 提示词, 负向提示词, 工作流, 参数, 全部: { 键: 值 }, 尺寸: {宽, 高} }
 */

/** PNG 头 8 个字节。 */
const PNG签名 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** 是不是 PNG。 */
function 是PNG(字节) {
  if (!字节 || 字节.length < 8) return false;
  for (let i = 0; i < 8; i += 1) if (字节[i] !== PNG签名[i]) return false;
  return true;
}

/** 一个块的关键字与文本。 */
function 读块(数据, 起, 长, 类型) {
  if (类型 === 'tEXt') {
    const 零 = 数据.indexOf(0, 起);
    if (零 < 0 || 零 >= 起 + 长) return null;
    const 键 = 数据.slice(起, 零).toString('latin1');
    const 值 = 数据.slice(零 + 1, 起 + 长).toString('latin1');
    return { 键, 值 };
  }
  if (类型 === 'iTXt') {
    // 关键字 \0 压缩标志(1) 压缩方法(1) 语言 \0 译名 \0 文本
    const 零 = 数据.indexOf(0, 起);
    if (零 < 0 || 零 >= 起 + 长) return null;
    const 键 = 数据.slice(起, 零).toString('latin1');
    const 压 = 数据[零 + 1];
    let 走 = 零 + 3;
    const 语零 = 数据.indexOf(0, 走);
    if (语零 < 0) return null;
    走 = 语零 + 1;
    const 名零 = 数据.indexOf(0, 走);
    if (名零 < 0) return null;
    走 = 名零 + 1;
    const 尾 = 数据.slice(走, 起 + 长);
    return { 键, 值: 压 === 0 ? 尾.toString('utf8') : null };
  }
  if (类型 === 'zTXt') {
    const 零 = 数据.indexOf(0, 起);
    if (零 < 0 || 零 >= 起 + 长) return null;
    const 键 = 数据.slice(起, 零).toString('latin1');
    return { 键, 值: null };  // 压缩的不解，如实标出来
  }
  return null;
}

/** 将图里的采样器分支转换为正向或负向文本。 */
function 读Comfy图(原文, 形态) {
  if (typeof 原文 !== 'string' || !原文.trim()) return null;
  let 图;
  try {
    图 = JSON.parse(原文);
  } catch {
    return null;
  }

  const API图 = 图 && !Array.isArray(图) && typeof 图 === 'object'
    && Object.values(图).some((节点) => 节点 && typeof 节点.class_type === 'string');
  const 界面图 = 图 && Array.isArray(图.nodes) && Array.isArray(图.links);
  if (!API图 && !界面图) return null;

  const 节点们 = API图
    ? Object.entries(图).map(([id, 节点]) => [String(id), 节点])
    : 图.nodes.map((节点) => [String(节点.id), 节点]);
  const 节点表 = new Map(节点们);
  const 连线表 = new Map();
  if (界面图) {
    for (const 连线 of 图.links) {
      if (Array.isArray(连线) && 连线.length >= 5) {
        连线表.set(String(连线[0]), { id: String(连线[1]), 槽: Number(连线[2]) || 0 });
      }
    }
  }

  const 类型名 = (节点) => String(节点.class_type || 节点.type || '');
  const 输入们 = (节点) => {
    const 输入 = 节点.inputs || {};
    if (形态 !== 'workflow' || !Array.isArray(输入)) return 输入;
    return Object.fromEntries(输入.map((一) => [一.name || '', 一.link]));
  };
  const 采样器们 = 节点们.filter(([, 节点]) => /sampler/i.test(类型名(节点)));
  if (!采样器们.length) return { 正向: '', 负向: '' };

  function 读分支(引用, 侧, 已访 = new Set()) {
    if (!Array.isArray(引用) || 引用.length < 2) return '';
    const id = String(引用[0]);
    const 槽 = Number(引用[1]) || 0;
    const key = `${id}:${槽}:${侧}`;
    if (已访.has(key)) return '';
    const 节点 = 节点表.get(id);
    if (!节点) return '';
    已访.add(key);

    const 类型 = 类型名(节点).toLowerCase();
    const 输入 = 输入们(节点);
    let 文本 = '';
    if (类型.includes('easy fullloader') && 形态 === 'prompt') {
      if (槽 === 4 && 侧 === 'positive' && typeof 输入.positive === 'string') 文本 = 输入.positive;
      if (槽 === 5 && 侧 === 'negative' && typeof 输入.negative === 'string') 文本 = 输入.negative;
    } else if (类型 === 'cliptextencode' && typeof 输入.text === 'string') {
      文本 = 输入.text;
    } else if (形态 === 'workflow' && 类型 === 'cliptextencode' && Array.isArray(节点.widgets_values)) {
      文本 = typeof 节点.widgets_values[0] === 'string' ? 节点.widgets_values[0] : '';
    } else if (形态 === 'workflow' && 类型.includes('easy fullloader') && Array.isArray(节点.widgets_values)) {
      const 位置 = 侧 === 'positive' && 槽 === 4 ? 10 : 侧 === 'negative' && 槽 === 5 ? 13 : -1;
      文本 = 位置 >= 0 && typeof 节点.widgets_values[位置] === 'string' ? 节点.widgets_values[位置] : '';
    }

    if (!文本) {
      const 接入 = Object.entries(输入).filter(([名, 值]) => {
        if (API图 ? !Array.isArray(值) : !Number.isInteger(值)) return false;
        if (名 === 'positive' || 名 === 'negative') return 名 === 侧;
        return /conditioning/i.test(名) || (名 === '' && 类型名(节点).toLowerCase() === 'reroute');
      });
      文本 = 接入.map(([, 值]) => {
        if (API图) return 读分支(值, 侧, 已访);
        const 来源 = 连线表.get(String(值));
        return 来源 ? 读分支([来源.id, 来源.槽], 侧, 已访) : '';
      }).filter(Boolean).join('\n');
    }
    已访.delete(key);
    return 文本.trim();
  }

  const 分支文本 = (侧) => 采样器们.map(([, 节点]) => {
    const 值 = 输入们(节点)[侧];
    if (API图) return 读分支(值, 侧);
    const 来源 = 连线表.get(String(值));
    return 来源 ? 读分支([来源.id, 来源.槽], 侧) : '';
  }).filter(Boolean).join('\n');

  return { 正向: 分支文本('positive'), 负向: 分支文本('negative') };
}

/**
 * 从 PNG 里抠出元数据文本。
 * @param {Buffer|Uint8Array} 字节
 * @returns {{有:boolean, 提示词:string, 负向提示词:string, 工作流:string, 参数:string, 全部:object, 尺寸:{宽:number,高:number}, 说明?:string}}
 */
function 读PNG元数据(字节) {
  const 空 = { 有: false, 提示词: '', 负向提示词: '', 工作流: '', 参数: '', 全部: {}, 尺寸: { 宽: 0, 高: 0 } };
  if (!字节) return { ...空, 说明: '没有图片字节' };
  const 数据 = Buffer.isBuffer(字节) ? 字节 : Buffer.from(字节);
  if (!是PNG(数据)) return { ...空, 说明: '不是 PNG' };

  const 全部 = {};
  let 宽 = 0;
  let 高 = 0;
  let 走 = 8;
  while (走 + 8 <= 数据.length) {
    const 长 = 数据.readUInt32BE(走);
    const 类型 = 数据.slice(走 + 4, 走 + 8).toString('latin1');
    const 起 = 走 + 8;
    if (起 + 长 > 数据.length) break;

    if (类型 === 'IHDR' && 长 >= 8) {
      宽 = 数据.readUInt32BE(起);
      高 = 数据.readUInt32BE(起 + 4);
    } else if (类型 === 'tEXt' || 类型 === 'iTXt' || 类型 === 'zTXt') {
      const 块 = 读块(数据, 起, 长, 类型);
      if (块 && 块.键) 全部[块.键] = 块.值 === null ? '' : 块.值;
    } else if (类型 === 'IEND') {
      break;
    }
    走 = 起 + 长 + 4;
  }

  /** 从若干候选键里取第一个非空的。 */
  const 取 = (...键们) => {
    for (const 键 of 键们) {
      const 值 = 全部[键];
      if (typeof 值 === 'string' && 值.trim()) return 值;
    }
    return '';
  };

  const 参数 = 取('parameters', 'Parameters');
  const 提示原文 = 取('prompt', 'Prompt');
  let 提示词 = 提示原文 || 取('Description', 'description', 'Comment');
  let 负向 = 取('negative_prompt', 'Negative prompt', 'Negative');
  const 工作流 = 取('workflow', 'Workflow');

  const API解析 = 读Comfy图(取('prompt', 'Prompt'), 'prompt');
  const 界面解析 = 读Comfy图(工作流, 'workflow');
  if (API解析) {
    提示词 = API解析.正向;
    负向 = API解析.负向;
  } else if (提示原文) {
    try {
      const JSON值 = JSON.parse(提示原文);
      if (JSON值 !== null && typeof JSON值 === 'object') 提示词 = '';
    } catch {
    }
  }
  if (界面解析) {
    if (!提示词) 提示词 = 界面解析.正向;
    if (!负向) 负向 = 界面解析.负向;
  }

  // 自动画图工具常把正负向写在一段 parameters 里：正面 …\nNegative prompt: …\nSteps: …
  if (参数) {
    const 负 = 参数.match(/Negative prompt:\s*([\s\S]*?)(?:\n[A-Z][a-zA-Z ]*:|$)/);
    if (!负向 && 负) 负向 = 负[1].trim();
    if (!提示词) {
      const 头 = 参数.split(/Negative prompt:/)[0];
      提示词 = 头.replace(/\n?Steps:[\s\S]*$/, '').trim();
    }
  }

  return {
    有: Object.keys(全部).length > 0,
    提示词: 提示词 || '',
    负向提示词: 负向 || '',
    工作流: 工作流 || '',
    参数: 参数 || '',
    全部,
    尺寸: { 宽, 高 },
  };
}

module.exports = { 读PNG元数据 };
