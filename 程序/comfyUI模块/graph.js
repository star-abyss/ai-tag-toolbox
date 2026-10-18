'use strict';
/*
 * comfyUI 模块 · 图。
 *
 * 界面图  节点 id / type / inputs / widgets_values / links 的那份。
 * 接口图  节点 id → { class_type, inputs } 的那份。
 *
 * 本文件只做三件事，全是纯函数：
 *   1. 两种形态的互认与转换
 *   2. 从接口图里读出正 / 负 / 图接在哪
 *   3. 把正负提示词与图片写回接口图
 */

const 图版本 = 1;

const ERR = {
  BAD_GRAPH: 'GRAPH_INVALID',
  NO_GRAPH: 'GRAPH_EMPTY',
  NO_PROMPT: 'GRAPH_NO_PROMPT',
  BAD_PARAM: 'INVALID_ARGUMENT',
};

const ok = (data) => ({ ok: true, data: data === undefined ? null : data });
const fail = (码, 话, 细节) => ({
  ok: false,
  reason: `${码}: ${话 || 码}`,
  code: 码,
  ...(细节 === undefined ? {} : { details: 细节 }),
});

const 是对象 = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const 是数组 = (v) => Array.isArray(v);
const isNonEmptyString = (v) => typeof v === 'string' && v.length > 0;
const 深拷贝 = (v) => (v === null || v === undefined ? v : JSON.parse(JSON.stringify(v)));

/** 连线：长度 ≥ 2 且首项是节点 id。 */
const 是连线 = (v) => 是数组(v) && v.length >= 2 && (typeof v[0] === 'string' || typeof v[0] === 'number');

/**
 * 一个节点在 ComfyUI 定义里的控件参数名，按顺序。连线型输入不算。
 *
 * @param {object} 定义 /object_info 的一条
 * @returns {Array<{name:string}>}
 */
function 定义里的控件(定义) {
  const 输入 = 是对象(定义) && 是对象(定义.input) ? 定义.input : null;
  if (!输入) return [];
  const 出 = [];
  for (const 组 of ['required', 'optional']) {
    for (const [名, 规格] of Object.entries(输入[组] || {})) {
      let 型;
      if (是数组(规格) && 规格.length) {
        型 = 是数组(规格[0]) ? 'COMBO' : 规格[0];
      } else if (是对象(规格)) {
        型 = 规格.type;
      } else {
        型 = 规格;
      }
      const 是控件 = 型 === 'COMBO' || ['INT', 'FLOAT', 'STRING', 'BOOLEAN'].includes(型);
      if (!是控件) continue;
      if (出.some((x) => x.name === 名)) continue;
      出.push({ name: 名 });
    }
  }
  return 出;
}

function 参数定义(定义) {
  const 出 = new Map();
  const 输入 = 是对象(定义) && 是对象(定义.input) ? 定义.input : {};
  for (const 组 of ['required', 'optional']) {
    for (const [名称, 原规格] of Object.entries(输入[组] || {})) {
      const 规格 = 是数组(原规格) ? 原规格 : null;
      const 类型 = 规格 ? (是数组(规格[0]) ? 'COMBO' : 规格[0]) : (原规格 && 原规格.type);
      if (类型 === 'COMBO' || ['INT', 'FLOAT', 'STRING', 'BOOLEAN'].includes(类型)) {
        const 元数据 = 是对象(规格 && 规格[1]) ? 规格[1] : 是对象(原规格) ?原规格 : {};
        出.set(名称, { 名称, 类型, ...(类型 === 'COMBO' ? { 选项: 规格 && 是数组(规格[0]) ? 深拷贝(规格[0]) : [] } : {}),
          ...(元数据.min !== undefined ? { 最小值: 元数据.min } : {}), ...(元数据.max !== undefined ? { 最大值: 元数据.max } : {}),
          ...(元数据.step !== undefined ? { 步长: 元数据.step } : {}), ...(元数据.tooltip !== undefined ? { 说明: 元数据.tooltip } : {}) });
      } else if (类型 && !['MODEL', 'CLIP', 'VAE', 'CONDITIONING', 'LATENT', 'IMAGE', 'MASK', 'AUDIO', 'VIDEO'].includes(类型)) {
        出.set(名称, { 名称, 类型: String(类型) });
      }
    }
  }
  return 出;
}

function 列工作流参数(图, 节点定义 = {}) {
  const 认 = 认形态(图);
  if (!认.ok) return 认;
  const 节点们 = 认.data.形态 === '界面图'
    ? (是数组(认.data.值.nodes) ? 认.data.值.nodes : [])
    : Object.entries(认.data.值).map(([id, 值]) => ({ id, type: 值.class_type, inputs: 值.inputs, title: 值._meta && 值._meta.title }));
  const 线 = new Map();
  if (认.data.形态 === '界面图') for (const 项 of (认.data.值.links || [])) if (是数组(项) && 项.length > 4) 线.set(String(项[0]), [String(项[1]), 项[2]]);
  const 输出 = [];
  for (const 节点 of 节点们) {
    if (!节点 || 节点.id === undefined || !节点.type || /^(Note|MarkdownNote|Reroute)$/i.test(节点.type) || 节点.mode === 2 || 节点.mode === 4) continue;
    const 定义 = 节点定义[节点.type];
    const defs = 参数定义(定义);
    const 声明 = 是数组(节点.inputs) ? 节点.inputs : [];
    const 值们 = 节点.widgets_values;
    const lmNames = 节点.properties && 节点.properties.__lm_widget_ids;
    const known = new Set([...(定义里的控件(定义).map(x => x.name)), ...声明.filter(x => x && x.widget).map(x => x.name)]);
    const 值表 = new Map();
    if (是对象(值们)) {
      for (const 项 of 声明) if (项 && 项.widget) {
        const key = 项.widget.name || 项.name;
        if (key && Object.hasOwn(值们, key)) 值表.set(项.name, 值们[key]);
      }
      for (const [key, value] of Object.entries(值们)) if (!值表.has(key)) 值表.set(key, value);
    } else if (是数组(值们)) {
      if (Array.isArray(lmNames)) lmNames.forEach((name, i) => { if (known.has(name) && i < 值们.length) 值表.set(name, 值们[i]); });
      else {
        let i = 0;
        for (const { name } of 定义里的控件(定义)) {
          if (声明.some(x => x.name === name && x.link != null && 线.has(String(x.link)))) continue;
          if (i >= 值们.length) break;
          值表.set(name, 值们[i]);
          if (typeof 值们[i] === 'number' && 是开关词(值们[i + 1])) {
            const controlName = `${name}_control_after_generate`;
            defs.set(controlName, { 名称: controlName, 类型: 'COMBO', 选项: [...开关词], 只读: true, 说明: '这是 ComfyUI 网页的运行后控件状态；工具出图使用工作流中保存的种子值。' });
            值表.set(controlName, 值们[i + 1]);
            i += 2;
          } else i += 1;
        }
      }
      if (/^PrimitiveNode$/i.test(节点.type) && 值们.length) 值表.set('value', 值们[0]);
      if (!定义 && 值们.length) 值表.set('widgets_values', 深拷贝(值们));
    }
    for (const [名称, 值] of Object.entries(认.data.形态 === '接口图' ? 节点.inputs : {})) {
      const connected = Array.isArray(值) && 值.length >= 2 && (typeof 值[0] === 'string' || typeof 值[0] === 'number') && typeof 值[1] === 'number';
      if (!defs.has(名称)) defs.set(名称, { 名称, 类型: connected ? '连接' : Array.isArray(值) ? 'JSON' : typeof 值 });
      值表.set(名称, 值);
    }
    const 参数 = [];
    const names = new Set([...defs.keys(), ...值表.keys(), ...声明.filter(x => x && x.name && x.link != null && 线.has(String(x.link))).map(x => x.name)]);
    for (const 名称 of names) {
      const declaration = 声明.find(x => x && x.name === 名称);
      const apiValue = 认.data.形态 === '接口图' ? 节点.inputs[名称] : undefined;
      const apiLinked = Array.isArray(apiValue) && apiValue.length >= 2 && (typeof apiValue[0] === 'string' || typeof apiValue[0] === 'number') && typeof apiValue[1] === 'number';
      const linked = apiLinked || Boolean(declaration && declaration.link != null && 线.has(String(declaration.link)));
      const meta = defs.get(名称) || { 名称, 类型: linked ? ((declaration && declaration.type) || '连接') : typeof 值表.get(名称) };
      const 链值 = apiLinked ? apiValue : (declaration && declaration.link != null ? 线.get(String(declaration.link)) : undefined);
      const p = { ...meta, ...(值表.has(名称) ? { 值: 深拷贝(值表.get(名称)) } : {}), ...(linked ? { 值: 深拷贝(链值), 只读: true } : {}) };
      if (Array.isArray(值们) && Array.isArray(lmNames)) {
        const i = lmNames.indexOf(名称);
        if (i >= 0 && i + 1 < 值们.length && 值们[i + 1] !== null && typeof 值们[i + 1] === 'object') p.值 = 深拷贝(值们[i + 1]);
      }
      if (!定义 && 名称 === 'widgets_values') {
        p.只读 = true;
        p.说明 = '当前节点定义缺失，控件位置无法映射；请在高级工作流 JSON 中编辑';
      }
      if (p.值 !== null && typeof p.值 === 'object' && !p.只读) {
        p.类型 = 'JSON';
        p.只读 = true;
        p.说明 = '对象控件请在高级工作流 JSON 中编辑';
      }
      参数.push(p);
    }
    if (参数.length) 输出.push({ 编号: String(节点.id), 名称: 节点.title || (节点.properties && 节点.properties['Node name for S&R']) || 节点.type, 类型: 节点.type, 参数 });
  }
  return ok({ 节点: 输出 });
}

function 写工作流参数(图, 节点id, 名称, 值, 节点定义 = {}) {
  const 认 = 认形态(图);
  if (!认.ok) return 认;
  const 输出 = 深拷贝(认.data.值);
  if (认.data.形态 === '接口图') {
    const node = 输出[String(节点id)];
    if (!node || !Object.hasOwn(node.inputs, 名称)) return fail(ERR.BAD_PARAM, `找不到参数 ${节点id}.${名称}`);
    const old = node.inputs[名称];
    if (Array.isArray(old) && old.length >= 2 && (typeof old[0] === 'string' || typeof old[0] === 'number') && typeof old[1] === 'number') return fail(ERR.BAD_PARAM, `${节点id}.${名称} 已连接，不能直接编辑`);
    node.inputs[名称] = 深拷贝(值);
    return ok(输出);
  }
  const node = (输出.nodes || []).find(x => String(x.id) === String(节点id));
  if (!node) return fail(ERR.BAD_PARAM, `找不到节点 ${节点id}`);
  const declaration = (node.inputs || []).find(x => x && x.name === 名称);
  if (declaration && declaration.link != null) return fail(ERR.BAD_PARAM, `${节点id}.${名称} 已连接，不能直接编辑`);
  if (是对象(node.widgets_values)) { node.widgets_values[declaration && declaration.widget && declaration.widget.name || 名称] = 深拷贝(值); return ok(输出); }
  if (!Array.isArray(node.widgets_values)) node.widgets_values = [];
  const names = node.properties && node.properties.__lm_widget_ids;
  if (Array.isArray(names)) {
    let index = names.indexOf(名称);
    if (index >= 0 && index + 1 < node.widgets_values.length && node.widgets_values[index + 1] !== null && typeof node.widgets_values[index + 1] === 'object') index += 1;
    if (index < 0 || index >= node.widgets_values.length) return fail(ERR.BAD_PARAM, `找不到参数 ${节点id}.${名称}`);
    node.widgets_values[index] = 深拷贝(值);
    return ok(输出);
  }
  const controls = 定义里的控件(节点定义[node.type]);
  if (/^PrimitiveNode$/i.test(node.type) && 名称 === 'value') { node.widgets_values[0] = 深拷贝(值); return ok(输出); }
  let index = 0;
  for (const control of controls) {
    if ((node.inputs || []).some(x => x.name === control.name && x.link != null)) continue;
    if (名称 === `${control.name}_control_after_generate`) {
      if (typeof node.widgets_values[index] !== 'number' || !是开关词(node.widgets_values[index + 1])) return fail(ERR.BAD_PARAM, `找不到参数 ${节点id}.${名称}`);
      node.widgets_values[index + 1] = 深拷贝(值);
      return ok(输出);
    }
    if (control.name === 名称) {
      if (index >= node.widgets_values.length) return fail(ERR.BAD_PARAM, `找不到参数 ${节点id}.${名称}`);
      node.widgets_values[index] = 深拷贝(值);
      return ok(输出);
    }
    index += typeof node.widgets_values[index] === 'number' && 是开关词(node.widgets_values[index + 1]) ? 2 : 1;
  }
  return fail(ERR.BAD_PARAM, `找不到参数 ${节点id}.${名称}`);
}

/** 开关位的取值。 */
const 开关词 = new Set(['fixed', 'randomize', 'increment', 'decrement']);
const 是开关词 = (v) => typeof v === 'string' && 开关词.has(v.trim().toLowerCase());

/**
 * 界面图 → 接口图。
 *
 * 已连线的输入取 [源节点, 源槽]；没连线的输入从 widgets_values 取。
 * 文件里没声明的控件，按节点定义补回参数名；不给定义就只按文件里有的算。
 *
 * @param {any} 界面图
 * @param {object} [节点定义] /object_info 的节点表
 * @returns {{ok:boolean, data?:object, reason?:string, code?:string}}
 */
function 界面图转接口图(界面图, 节点定义 = {}) {
  const 认 = 认形态(界面图);
  if (!认.ok) return 认;
  if (认.data.形态 === '接口图') return ok(深拷贝(认.data.值));

  const 源 = 认.data.值;
  const 节点们 = 是数组(源.nodes) ? 源.nodes : [];
  if (!节点们.length) return fail(ERR.NO_GRAPH, '这张界面图里没有节点');

  // 连线表：连线 id → [源节点, 源槽]
  const 线 = new Map();
  for (const 项 of 是数组(源.links) ? 源.links : []) {
    if (!是数组(项) || 项.length < 5) continue;
    线.set(String(项[0]), [String(项[1]), Number(项[2]) || 0]);
  }

  const 节点表 = new Map();
  for (const 节点 of 节点们) {
    if (!是对象(节点) || 节点.id === undefined) continue;
    节点表.set(String(节点.id), 节点);
  }

  // 不进接口图的节点：标注、静音（mode 2）、旁路（mode 4）、中转（Reroute）
  const 类型不进 = (类型) => /^(Note|MarkdownNote|Reroute|PrimitiveNode)$/i.test(类型);
  const 不进 = (节点) => !是对象(节点) || typeof 节点.type !== 'string'
    || 类型不进(节点.type) || 节点.mode === 2 || 节点.mode === 4;
  /** 旁路与中转节点的输出要按类型接到上游去。 */
  const 穿得过 = (节点) => 是对象(节点)
    && (/^Reroute$/i.test(String(节点.type)) || 节点.mode === 4);

  /**
   * 一条连线落到什么上：一个值（源头是 PrimitiveNode）或一个 [节点, 槽]。
   * 中间夹着的旁路（mode 4）与 Reroute 节点按类型穿过去。
   *
   * @param {string|number} 连线 连线 id
   * @returns {{值:any}|{源:[string, number]}|null} 上游接不上时给 null
   */
  function 解析连线(连线) {
    let 项 = 线.get(String(连线));
    if (!项) return null;
    const 见过 = new Set();
    for (;;) {
      const 节点 = 节点表.get(String(项[0]));
      if (!节点) return null;
      if (!不进(节点)) return { 源: [String(项[0]), 项[1]] };
      if (见过.has(String(节点.id))) return null;
      见过.add(String(节点.id));
      if (/^PrimitiveNode$/i.test(String(节点.type))) {
        const 值 = 是数组(节点.widgets_values) ? 节点.widgets_values[0] : undefined;
        return 值 === undefined ? null : { 值 };
      }
      if (!穿得过(节点)) return null;
      const 槽 = Number(项[1]) || 0;
      const 出型 = (是数组(节点.outputs) && 是对象(节点.outputs[槽]) ? 节点.outputs[槽].type : '') || '';
      const 声明 = 是数组(节点.inputs) ? 节点.inputs : [];
      const 配上 = 声明.find((i) => 是对象(i) && i.link !== null && i.link !== undefined
        && 线.has(String(i.link)) && (!出型 || i.type === 出型));
      if (!配上) return null;
      项 = 线.get(String(配上.link));
    }
  }

  const 接口图 = {};
  for (const 节点 of 节点们) {
    if (!是对象(节点) || typeof 节点.type !== 'string') continue;
    if (不进(节点)) continue;

    const 声明 = 是数组(节点.inputs) ? 节点.inputs : [];
    const 值们 = 节点.widgets_values;
    const 是对象值 = 是对象(值们);
    const 数组值 = 是数组(值们) ? 值们.slice() : [];
    const 控件的名 = (项) => (isNonEmptyString(项.widget.name) ? 项.widget.name
      : (isNonEmptyString(项.name) ? 项.name : ''));

    const inputs = {};
    const 控件们 = 声明.filter((x) => 是对象(x) && 是对象(x.widget));
    const 定义控件们 = 定义里的控件(节点定义[节点.type]);
    const 保存控件名 = 节点.properties && 节点.properties.__lm_widget_ids;
    const 有保存名 = 是数组(保存控件名);
    const 输入定义 = (节点定义[节点.type] && 节点定义[节点.type].input) || {};
    const 输入名 = new Set([
      ...Object.keys(输入定义.required || {}), ...Object.keys(输入定义.optional || {}),
      ...控件们.map((项) => 项.name),
    ]);
    // 已经变成连线输入的控件：文件里的 widgets_values 没有它们的位置
    const 连了线的控件名 = new Set();
    for (const 项 of 声明) {
      if (!是对象(项) || typeof 项.name !== 'string') continue;
      if (项.link !== null && 项.link !== undefined && 线.has(String(项.link))) 连了线的控件名.add(项.name);
    }

    // ① 控件名与保存值映射；顺序控件包含可选的开关位。
    const 值表 = new Map();      // 控件名 → 值
    if (是对象值) {
      for (const 项 of 控件们) {
        const 键 = 控件的名(项);
        if (键 && Object.prototype.hasOwnProperty.call(值们, 键)) 值表.set(项.name, 值们[键]);
      }
    } else if (有保存名) {
      保存控件名.forEach((名, 位) => {
        if (typeof 名 === 'string' && 输入名.has(名) && 位 < 数组值.length) 值表.set(名, 数组值[位]);
      });
    } else if (定义控件们.length) {
      let 位 = 0;
      for (const 参数 of 定义控件们) {
        if (位 >= 数组值.length) break;
        // 已经变成连线输入的控件不占 widgets_values 的位
        if (连了线的控件名.has(参数.name)) continue;
        值表.set(参数.name, 数组值[位]);
        位 += (typeof 数组值[位] === 'number' && 是开关词(数组值[位 + 1])) ? 2 : 1;
      }
    } else {
      控件们.forEach((项, 序) => {
        if (序 < 数组值.length) 值表.set(项.name, 数组值[序]);
      });
    }

    // ② 落进 inputs：连线的取源，控件的取值
    for (const 声明项 of 声明) {
      if (!是对象(声明项) || typeof 声明项.name !== 'string') continue;
      const 连线 = 声明项.link;
      if (连线 !== null && 连线 !== undefined && 线.has(String(连线))) {
        const 落 = 解析连线(连线);
        if (!落) continue;
        inputs[声明项.name] = '源' in 落 ? 落.源 : 深拷贝(落.值);
        continue;
      }
      if (值表.has(声明项.name)) inputs[声明项.name] = 深拷贝(值表.get(声明项.name));
      else if (是对象(声明项.widget) && 是对象值 && Object.prototype.hasOwnProperty.call(值们, 控件的名(声明项))) {
        inputs[声明项.name] = 深拷贝(值们[控件的名(声明项)]);
      }
    }

    // ③ 未出现在输入声明中的控件值。
    if (!是对象值) {
      const 已声明名 = new Set(声明.map((x) => (是对象(x) ? x.name : '')));
      for (const [名, 值] of 值表) {
        if (!已声明名.has(名) && !(名 in inputs)) inputs[名] = 深拷贝(值);
      }
    }

    // ④ 一个声明都没有、定义也认不出的节点：把标量值按位置塞进 w0/w1…
    if (!声明.length && !定义控件们.length && !有保存名) {
      数组值.forEach((v, i) => {
        if (typeof v !== 'object' || v === null) inputs[`w${i}`] = v;
      });
    }

    接口图[String(节点.id)] = { class_type: 节点.type, inputs, _meta: { title: 节点.title || '' } };
  }

  if (!Object.keys(接口图).length) return fail(ERR.NO_GRAPH, '这张界面图里没有可执行的节点');
  return ok(接口图);
}

/* ------------------------------------------------------------------ 认形态 */

/**
 * 这是哪一种形态。
 * @param {any} 值
 * @returns {{ok:boolean, 形态?:'界面图'|'接口图', reason?:string, code?:string}}
 */
function 认形态(值) {
  let 源 = 值;
  if (typeof 源 === 'string') {
    try {
      源 = JSON.parse(源);
    } catch (错误) {
      return fail(ERR.BAD_GRAPH, `不是有效的 JSON：${(错误 && 错误.message) || 错误}`);
    }
  }
  if (!是对象(源) || Object.keys(源).length === 0) {
    return fail(ERR.NO_GRAPH, '这里没有工作流');
  }
  if (是数组(源.nodes) || 是数组(源.links)) return ok({ 形态: '界面图', 值: 源 });
  // 接口图：每个值都得有 class_type 与 inputs
  const 项 = Object.entries(源);
  const 坏 = 项.find(([, n]) => !是对象(n) || typeof n.class_type !== 'string' || !是对象(n.inputs));
  if (坏) return fail(ERR.BAD_GRAPH, `节点 ${坏[0]} 不是接口格式（要有 class_type 和 inputs）`);
  return ok({ 形态: '接口图', 值: 源 });
}

/* ------------------------------------------------------------------ 读口 */

/** 提示词口靠类名认；认不出类名时看控件值里有没有长文本。 */
const 文本类名 = /TextEncode|CLIPTextEncode|TextEncodeSDXL|TextEncodeFlux|Text|Prompt|String/i;
const 非提示词类名 = /Overlay|TextImage|SaveText|ShowText|TextPreview/i;

/**
 * 一个节点里哪个字段是提示词。
 * 先看字段名在不在候选表里，再看谁的字多，最后按声明顺序。
 *
 * @param {object} 节点
 * @param {string} [角色] 'positive' | 'negative'，给了就把它排在最前
 * @returns {{input:string, 文本:string}|null}
 */
const 提示词字段序 = ['text', 'text_g', 'text_l', 'prompt', 'positive', 'negative', 'string', 'value', 'populated_text', 'wildcard_text'];
function 挑提示词字段(节点, 角色) {
  const inputs = 是对象(节点 && 节点.inputs) ? 节点.inputs : {};
  const 候选 = Object.keys(inputs).filter((k) => typeof inputs[k] === 'string');
  if (!候选.length) return null;
  const 序 = 角色 === 'negative'
    ? ['negative', ...提示词字段序]
    : 角色 === 'positive'
      ? ['positive', ...提示词字段序]
      : 提示词字段序;
  const 打分 = (k) => {
    const 位 = 序.indexOf(k);
    return 位 >= 0 ? 1000 - 位 : 0;
  };
  候选.sort((a, b) => {
    const 差 = 打分(b) - 打分(a);
    if (差) return 差;
    return String(inputs[b]).length - String(inputs[a]).length;
  });
  const 键 = 候选[0];
  return { input: 键, 文本: String(inputs[键]) };
}

/** 从接口图里找出「带字的节点」。 */
function 找文本节点(接口图) {
  const 出 = [];
  for (const [id, 节点] of Object.entries(接口图)) {
    const 类名 = String(节点.class_type || '');
    if (非提示词类名.test(类名)) continue;
    const inputs = 节点.inputs || {};
    const 文本键 = Object.keys(inputs).filter((k) => typeof inputs[k] === 'string');
    if (!文本键.length) continue;
    const 挑 = 挑提示词字段(节点);
    // 类名像文本节点，或字段名在提示词候选表里且非空
    const 像 = 文本类名.test(类名) || (提示词字段序.includes(挑.input) && String(挑.文本).trim().length);
    if (!像) continue;
    出.push({
      nodeId: String(id),
      classType: 类名,
      title: (节点._meta && 节点._meta.title) || '',
      input: 挑.input,
      文本: 挑.文本,
      全部文本键: 文本键,
    });
  }
  return 出;
}

/** 沿上游走时不去解析的键。 */
const 挡住的键 = /^(model|clip|vae|latent|latent_image|samples|image|images|mask|pixels|noise|control_net|width|height|batch_size|seed|steps|cfg)$/i;

/**
 * 从某个节点沿输入连线往上游找，收集角色相符的文本节点。
 *
 * @param {object} 接口图
 * @param {string|number} 起点id
 * @param {string} 角色 'positive' | 'negative'
 * @param {Set<string>} [见过] 已经走过的节点 id
 * @returns {Array<{nodeId:string, classType:string, title:string, input:string, 文本:string}>}
 */
function 沿上游找文本(接口图, 起点id, 角色, 见过 = new Set()) {
  if (起点id === null || 起点id === undefined || 见过.has(String(起点id))) return [];
  见过.add(String(起点id));
  const 节点 = 接口图[String(起点id)];
  if (!节点) return [];
  const inputs = 是对象(节点.inputs) ? 节点.inputs : {};
  const 出 = [];

  const 挑 = 挑提示词字段(节点, 角色);
  const 类名 = String(节点.class_type || '');
  const 是文本节点 = 挑 && 文本类名.test(类名) && !非提示词类名.test(类名)
    && (提示词字段序.includes(挑.input) || String(挑.文本).trim().length);
  if (是文本节点) {
    // 显式标了对面那一侧、又没有本侧字段的节点，不算这一侧的口
    const 本侧 = 角色 === 'negative' ? 'negative' : 'positive';
    const 对面 = 角色 === 'negative' ? 'positive' : 'negative';
    const 有本侧 = Object.prototype.hasOwnProperty.call(inputs, 本侧);
    const 有对面 = Object.prototype.hasOwnProperty.call(inputs, 对面);
    if (有本侧 || !有对面) {
      出.push({
        nodeId: String(起点id),
        classType: 类名,
        title: (节点._meta && 节点._meta.title) || '',
        input: 挑.input,
        文本: 挑.文本,
      });
    }
  }

  // 一个节点不妨碍它上游还有别的文本节点
  for (const [键, 值] of Object.entries(inputs)) {
    if (!是连线(值)) continue;
    if (挡住的键.test(键)) continue;
    出.push(...沿上游找文本(接口图, 值[0], 角色, 见过));
  }
  return 出;
}

const 采样器类名 = /Sampler|Guider/i;
const 图类名 = /LoadImage|ImageLoader|LoadImageMask|LoadImageOutput/i;

/**
 * 读出「正 / 负 / 图」接在哪。
 *
 * @param {any} 图 界面图或接口图都行
 * @param {object} [选项] { 节点定义 }
 * @returns {{ok:boolean, data?:object, reason?:string, code?:string}}
 */
function 读口(图, 选项 = {}) {
  const 节点定义 = 是对象(选项.节点定义) ? 选项.节点定义 : {};
  const 转 = 界面图转接口图(图, 节点定义);
  if (!转.ok) return 转;
  const 接口图 = 转.data;

  // 采样器：类名像，或者同时吃 positive / negative / latent_image 里至少两项
  const 采样器们 = Object.entries(接口图)
    .filter(([, n]) => {
      const 类名 = String(n.class_type || '');
      if (采样器类名.test(类名)) return true;
      const 键 = Object.keys(n.inputs || {});
      return ['positive', 'negative', 'latent_image'].filter((k) => 键.includes(k)).length >= 2;
    })
    .map(([id, n]) => ({
      nodeId: String(id),
      classType: String(n.class_type || ''),
      评分: ['positive', 'negative', 'latent_image', 'steps', 'cfg', 'sampler_name']
        .reduce((总, k) => 总 + (Object.prototype.hasOwnProperty.call(n.inputs || {}, k) ? 1 : 0), 0),
    }))
    .sort((a, b) => b.评分 - a.评分 || a.nodeId.localeCompare(b.nodeId));

  const 有正键 = 采样器们.filter((s) => Object.prototype.hasOwnProperty.call(接口图[s.nodeId].inputs || {}, 'positive'));
  const 主采样器 = (有正键.length ? 有正键 : 采样器们)[0] || null;

  const 张数 = [];
  if (主采样器) {
    const 空latent类名 = /^(EmptyLatentImage|EmptySD3LatentImage|EmptyFluxLatentImage)$/;
    const 加口 = (节点id, 字段) => {
      const 节点 = 接口图[String(节点id)];
      const 值 = 节点 && (节点.inputs || {})[字段];
      if (!节点 || typeof 值 !== 'number' || 是连线(值)) return false;
      张数.push({ nodeId: String(节点id), classType: String(节点.class_type || ''), input: 字段, 当前值: 节点.inputs[字段] });
      return true;
    };
    const latent入口 = (接口图[主采样器.nodeId].inputs || {}).latent_image;
    const latent节点 = 是连线(latent入口) ? 接口图[String(latent入口[0])] : null;
    const 类名 = String((latent节点 && latent节点.class_type) || '');
    const 输入 = latent节点 && latent节点.inputs || {};
    if (空latent类名.test(类名) && Object.prototype.hasOwnProperty.call(输入, 'batch_size')) {
      加口(latent入口[0], 'batch_size');
    } else if (类名 === 'RepeatLatentBatch'
        && Object.prototype.hasOwnProperty.call(输入, 'amount') && 是连线(输入.samples)) {
      const 上游 = 接口图[String(输入.samples[0])];
      const 上游类名 = String((上游 && 上游.class_type) || '');
      const 上游输入 = 上游 && 上游.inputs || {};
      if (空latent类名.test(上游类名) && Object.prototype.hasOwnProperty.call(上游输入, 'batch_size')) {
        if (加口(输入.samples[0], 'batch_size')) 加口(latent入口[0], 'amount');
      } else if (/^VAEEncode$/.test(上游类名) && 是连线(上游输入.pixels)) {
        const 图片节点 = 接口图[String(上游输入.pixels[0])];
        const 图片输入 = 图片节点 && 图片节点.inputs || {};
        if (String((图片节点 && 图片节点.class_type) || '') === 'LoadImage'
            && typeof 图片输入.image === 'string' && !是连线(图片输入.image)) {
          加口(latent入口[0], 'amount');
        }
      }
    }
  }

  /** 去重：同一个节点同一个输入只算一个口。 */
  const 去重 = (列表) => {
    const 见过 = new Set();
    const 出 = [];
    for (const 项 of 列表) {
      const 键 = `${项.nodeId}.${项.input}`;
      if (见过.has(键)) continue;
      见过.add(键);
      出.push(项);
    }
    return 出;
  };

  let 正 = [];
  let 负 = [];
  if (主采样器) {
    const 节点 = 接口图[主采样器.nodeId];
    const 正入 = (节点.inputs || {}).positive;
    const 负入 = (节点.inputs || {}).negative;
    if (是连线(正入)) 正 = 沿上游找文本(接口图, 正入[0], 'positive');
    else if (typeof 正入 === 'string' && 正入.trim()) 正 = [{ nodeId: 主采样器.nodeId, classType: 主采样器.classType, input: 'positive', 文本: 正入 }];
    if (是连线(负入)) 负 = 沿上游找文本(接口图, 负入[0], 'negative');
    else if (typeof 负入 === 'string' && 负入.trim()) 负 = [{ nodeId: 主采样器.nodeId, classType: 主采样器.classType, input: 'negative', 文本: 负入 }];
  }

  正 = 去重(正);
  负 = 去重(负);

  // 采样器上没挂正负 → 按角色在全图里找
  const 已认 = new Set([...正, ...负].map((x) => `${x.nodeId}.${x.input}`));
  const 全文本 = 找文本节点(接口图).filter((t) => !已认.has(`${t.nodeId}.${t.input}`));

  const 挑一个 = (角色, 排除 = new Set()) => {
    /** 这个节点在这一角色下要填的键。 */
    const 要填的键 = (t) => {
      const 挑 = 挑提示词字段(接口图[t.nodeId], 角色);
      return 挑 ? `${t.nodeId}.${挑.input}` : `${t.nodeId}.${t.input}`;
    };
    const 可用 = 全文本.filter((t) => !排除.has(要填的键(t)));
    const 候选 = (t) => {
      const 挑 = 挑提示词字段(接口图[t.nodeId], 角色);
      if (!挑 || !提示词字段序.includes(挑.input)) return null;
      return { nodeId: t.nodeId, classType: t.classType, title: t.title, input: 挑.input, 文本: 挑.文本 };
    };
    // 显式标了本侧字段的
    for (const t of 可用) {
      const 挑 = 挑提示词字段(接口图[t.nodeId], 角色);
      if (挑 && 挑.input === 角色) return 候选(t);
    }
    // 当场空着的
    for (const t of 可用) {
      const c = 候选(t);
      if (c && !String(c.文本).trim()) return c;
    }
    // 都不是：正向取字最多的，负向不给
    if (角色 === 'positive') {
      const 带字的 = 可用.map(候选).filter((c) => c && String(c.文本).trim());
      带字的.sort((a, b) => String(b.文本).length - String(a.文本).length);
      if (带字的.length) return 带字的[0];
    }
    return null;
  };

  if (!正.length) {
    const 一个 = 挑一个('positive');
    if (一个) 正 = [一个];
  }
  if (!负.length) {
    const 正用 = new Set(正.map((x) => `${x.nodeId}.${x.input}`));
    const 一个 = 挑一个('negative', 正用);
    if (一个) 负 = [一个];
  }

  // 同一个节点同一个字段只能算一个口：正负撞上时正向留着，负向不算
  const 正向用 = new Set(正.map((x) => `${x.nodeId}.${x.input}`));
  负 = 负.filter((x) => !正向用.has(`${x.nodeId}.${x.input}`));

  // 图片口：类名像图片节点，并且确实有装文件名的那个键
  const 图节点们 = [];
  for (const [id, n] of Object.entries(接口图)) {
    if (!图类名.test(String(n.class_type || ''))) continue;
    const inputs = n.inputs || {};
    const 键 = Object.keys(inputs).find((k) => /^(image|image_name|filename|file)$/i.test(k));
    if (!键) continue;
    图节点们.push({
      nodeId: String(id),
      classType: String(n.class_type || ''),
      input: 键,
      当前值: typeof inputs[键] === 'string' ? inputs[键] : '',
    });
  }

  const 输出们 = Object.entries(接口图)
    .filter(([, n]) => {
      const 类名 = String(n.class_type || '');
      if (/^(Save|Preview)/i.test(类名)) return true;
      const 定义 = 节点定义[类名];
      return Boolean(定义 && 定义.output_node === true);
    })
    .map(([id, n]) => {
      const 类名 = String(n.class_type || '');
      return {
        nodeId: String(id),
        classType: 类名,
        类型: /audio/i.test(类名) ? 'audio' : /video|animated/i.test(类名) ? 'video' : /3d|glb|point|gaussian/i.test(类名) ? '3d' : 'image',
      };
    });

  const 认得的 = [];
  if (正.length) 认得的.push('正向提示词');
  if (负.length) 认得的.push('负向提示词');
  if (图节点们.length) 认得的.push('图片');

  return ok({
    format: 图版本,
    节点数: Object.keys(接口图).length,
    采样器们,
    主采样器: 主采样器 ? 主采样器.nodeId : null,
    采样器不唯一: 采样器们.length > 1,
    正向: 正,
    负向: 负,
    图片: 图节点们,
    张数,
    输出: 输出们,
    认得的,
    认不出的: ['正向提示词', '负向提示词', '图片'].filter((x) => !认得的.includes(x)),
    接口图,
  });
}

/* ------------------------------------------------------------------ 填口 */

/**
 * 把三项填进接口图。返回新图，入参不动。
 *
 * 正向接在几个节点上，就往几个里写同一段字。
 *
 * @param {any} 图
 * @param {{正向?:string, 负向?:string, 图片?:string, 口?:object, 节点定义?:object}} 输入
 * @returns {{ok:boolean, data?:{接口图:object, 填了的:object}, reason?:string, code?:string}}
 */
function 填口(图, 输入 = {}) {
  const 口 = 输入.口 || 读口(图, { 节点定义: 输入.节点定义 });
  if (!口.ok) return 口;
  const 接口图 = 深拷贝(口.data.接口图);

  const 填了的 = { 正向: [], 负向: [], 图片: [], 张数: [] };
  /** 已经写过的地址。 */
  const 写过 = new Set();

  const 写文本 = (地址们, 文本, 归类) => {
    if (文本 === undefined || 文本 === null) return ok(null);
    for (const 地址 of 地址们) {
      const 节点 = 接口图[地址.nodeId];
      if (!节点) return fail(ERR.BAD_PARAM, `绑定的节点不在了：${地址.nodeId}`);
      const 键 = `${地址.nodeId}.${地址.input}`;
      if (写过.has(键)) return fail(ERR.BAD_PARAM, `节点 ${键} 被两处口共用了，写谁都不对`);
      const 现有 = 节点.inputs[地址.input];
      if (是连线(现有)) {
        return fail(ERR.BAD_PARAM, `节点 ${地址.nodeId} 的 ${地址.input} 是连线，写不进去`);
      }
      节点.inputs[地址.input] = String(文本);
      写过.add(键);
      填了的[归类].push(键);
    }
    return ok(null);
  };

  if (输入.正向 !== undefined && 输入.正向 !== null) {
    if (!口.data.正向.length) return fail(ERR.NO_PROMPT, '这张图上没有正向提示词的口');
    const 写 = 写文本(口.data.正向, 输入.正向, '正向');
    if (!写.ok) return 写;
  }
  if (输入.负向 !== undefined && 输入.负向 !== null) {
    // 图上没有负向口时跳过
    if (口.data.负向.length) {
      const 写 = 写文本(口.data.负向, 输入.负向, '负向');
      if (!写.ok) return 写;
    }
  }
  if (输入.图片 !== undefined && 输入.图片 !== null && String(输入.图片).trim()) {
    if (!口.data.图片.length) return fail(ERR.BAD_PARAM, '这张图不收图片');
    const 写 = 写文本(口.data.图片, 输入.图片, '图片');
    if (!写.ok) return 写;
  }

  if (输入.张数 !== undefined && 输入.张数 !== null) {
    if (!Number.isInteger(输入.张数) || 输入.张数 < 1) return fail(ERR.BAD_PARAM, '张数要是正整数');
    if (!口.data.张数.length) return fail(ERR.BAD_PARAM, '这张图的主采样器没有可确认的批量输入');
    const 有重复节点 = 口.data.张数.some((地址) => 地址.classType === 'RepeatLatentBatch');
    for (const 地址 of 口.data.张数) {
      const 节点 = 接口图[地址.nodeId];
      if (!节点 || !节点.inputs || 是连线(节点.inputs[地址.input])) {
        return fail(ERR.BAD_PARAM, `节点 ${地址.nodeId} 的 ${地址.input} 不是可填写的批量输入`);
      }
      节点.inputs[地址.input] = 有重复节点 && /^(EmptyLatentImage|EmptySD3LatentImage|EmptyFluxLatentImage)$/.test(地址.classType)
        ? 1
        : 输入.张数;
      填了的.张数.push(`${地址.nodeId}.${地址.input}`);
    }
  }

  return ok({ 接口图, 填了的 });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 造一个 UUID v4 形状的 id。 */
function 随机UUID() {
  const 十六 = () => Math.floor(Math.random() * 16).toString(16);
  const 段 = (长) => Array.from({ length: 长 }, 十六).join('');
  return `${段(8)}-${段(4)}-4${段(3)}-${'89ab'[Math.floor(Math.random() * 4)]}${段(3)}-${段(12)}`;
}

/**
 * 界面图的 id 是 UUID；缺了或不合规就补一个。
 *
 * @param {object} 图 界面图
 * @param {Function} [新UUID] 造 id 的函数
 * @returns {object} 补好的图（新对象）
 */
function 补图id(图, 新UUID) {
  if (!是对象(图)) return 图;
  const 现有 = typeof 图.id === 'string' && UUID.test(图.id) ? 图.id : '';
  if (现有) return 图;
  const 造 = typeof 新UUID === 'function' ? 新UUID : 随机UUID;
  return { ...图, id: 造() };
}

module.exports = {
  ERR,
  ok,
  fail,
  图版本,
  是对象,
  是数组,
  深拷贝,
  认形态,
  界面图转接口图,
  列工作流参数,
  写工作流参数,
  读口,
  填口,
  补图id,
};
