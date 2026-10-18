// 有哪七个模块、各自叫什么、装配要什么。
//
// `名字` 是装配层给模块起的键，也是工具名的前半段（`<模块>_<动作>`）。
// 模型侧的名字只能是 ASCII 字母、数字、下划线、连字符（提供方的约束），
// 所以键用英文；模块自己那一层的中文动作名（模块层）不动，靠 `动作名` 这张对照翻过去。
//
// `选项` 只接配置递进来的位置、地址、以及递进来的函数；工具参数里不出现地址。
// 加一个模块只改这里一行。
import path from 'node:path';

import { 造文件存档 } from './存档.js';

/** 把配置里的相对位置拼到项目根下面。 */
const 位置 = (根, 相对) => path.resolve(根, 相对);

/**
 * 模块清单。
 * @param {object} 递 装配层递给模块的那些东西
 *   AI翻译     装订模块的端口：报文进去，键值对出来
 *   本地翻译引擎 翻译模块的端口：待译单元进去，带标识的译文单元出来
 *   本地识图引擎 识图模块的 `tagger`
 *   看图        识图模块的 `看图`
 *   读元数据     识图模块的 `读元数据`
 */
/**
 * 模块自己那层的动作名 → 模型侧的动作名。
 *
 * 只有带点的名字要换（`.` 在工具名里不合法）；其余原名照用。
 * 两份清单（工具那一侧与界面那一侧）读的是同一张对照，所以这里是唯一一份。
 * @param {{动作名?:object}} 一块 模块清单里的一条
 * @param {string} 动作 模块自己那层的动作名
 */
export function 模型侧动作名(一块, 动作) {
  const 对照 = (一块 && 一块.动作名) || {};
  return Object.keys(对照).find((一) => 对照[一] === 动作) || 动作;
}

export function 造模块清单(递 = {}) {
  const AI翻译 = 递.AI翻译;
  const 本地翻译引擎 = 递.本地翻译引擎;
  const 本地识图引擎 = 递.本地识图引擎;
  const 看图 = 递.看图;
  const 读元数据 = 递.读元数据;

  /**
   * 从配置里取一格位置拼到项目根下面。
   * 缺这一项就当场点名。
   * @param {string} 键 配置项的名字
   */
  const 取位置 = (键) => (根, config) => {
    const 相对 = config[键];
    if (typeof 相对 !== 'string' || !相对.trim()) {
      throw new Error(`对接层配置里缺「${键}」这一项，补上这一个再启动`);
    }
    return 位置(根, 相对);
  };

  return Object.freeze([
    {
      名字: 'tag',
      门面: 'tag模块/index.js',
      工厂: 'createTagModule',
      选项: (根, config) => ({ data: 取位置('标签目录')(根, config) }),
      // 模型侧的动作名 → 模块自己那层的动作名。
      // 只有带点的名字要换（`.` 在工具名里不合法）；其余原名照用。
      动作名: {
        resolve: 'resolve',
        record_get: 'record.get',
        record_batch: 'record.batch',
        record_create: 'record.create',
        record_edit: 'record.edit',
        record_delete: 'record.delete',
        record_groups: 'record.groups',
        hidden_hide: 'hidden.hide',
        hidden_unhide: 'hidden.unhide',
        hidden_list: 'hidden.list',
        modified_list: 'modified.list',
        modified_restore: 'modified.restore',
        position_list: 'position.list',
        position_createPage: 'position.createPage',
        position_createClass: 'position.createClass',
        position_update: 'position.update',
        position_delete: 'position.delete',
        position_members: 'position.members',
        position_attach: 'position.attach',
        position_detach: 'position.detach',
        position_reorder: 'position.reorder',
        position_whereIs: 'position.whereIs',
        note_get: 'note.get',
        note_set: 'note.set',
        identity_adults: 'identity.adults',
        identity_roles: 'identity.roles',
        identity_isAdult: 'identity.isAdult',
        identity_isRole: 'identity.isRole',
      },
    },
    {
      名字: 'image',
      门面: '图片模块/index.js',
      工厂: 'createImageModule',
      选项: (根, config) => ({ 根目录: 取位置('图片目录')(根, config), ...(递.接收作用域 === undefined ? {} : { 接收作用域: 递.接收作用域 }) }),
      动作名: {
        list: '列',
        detail: '取详情',
        content: '取内容',
        address: '取地址',
        save: '存',
        rename: '改',
        remove: '删',
        clear: '清空',
        maintain_report: '维护.报告',
        maintain_clean: '维护.清理',
        table_favorite: '表.收藏',
        table_class: '表.分类',
      },
    },
    {
      名字: 'worldbook',
      门面: '世界书模块/index.js',
      工厂: 'createWorldbookModule',
      选项: (根, config) => ({
        根目录: 取位置('世界书用户目录')(根, config),
        默认目录: 取位置('世界书默认目录')(根, config),
        默认启用: { 主AI: ['$default:主AI'], 文生图: ['$default:文生图'], 翻译: ['$default:翻译'], 识图: ['$default:识图'] },
      }),
      动作名: {
        run: '执行',
        read: '读',
        table: '表',
        test: '测',
        books: '书',
        entries: '条目',
        save: '存',
        drop: '丢',
        reload: '重读',
        status: '状态',
      },
    },
    {
      名字: 'binding',
      门面: '装订模块/index.js',
      工厂: 'createBindingModule',
      // 装订没有盘：它要的是两个函数，一个查标签库，一个问模型。
      // 查词就是标签模块的 `认词` 原样转交；标签模块没装起来就没有这一支。
      选项: (根, config, 门面) => {
        const 给 = {};
        if (门面.tag && typeof 门面.tag.recognize === 'function') {
          给.查词 = (词们) => 门面.tag.recognize(词们);
        }
        if (AI翻译) 给.AI翻译 = AI翻译;
        return 给;
      },
      动作名: { split: '切分', bind: '装订' },
    },
    {
      名字: 'translate',
      门面: '翻译模块/index.js',
      工厂: 'createTranslateModule',
      // 本地档：切分与查词都借装订模块那一套（同一份，不复制），"译"是本地模型。
      选项: (根, config, 门面) => {
        const 给 = {
          文本处理: 门面.binding && 门面.binding.文本处理,
          查词: 门面.tag && typeof 门面.tag.recognize === 'function' ? (词们) => 门面.tag.recognize(词们) : null,
          译: 本地翻译引擎 || null,
          默认方向: config.翻译方向 || 'auto',
          默认模型: config.翻译模型 || '',
        };
        return 给;
      },
      动作名: { models: '看模型', local: '本地译', split: '切分' },
    },
    {
      名字: 'comfy',
      门面: 'comfyUI模块/index.js',
      工厂: 'createComfyModule',
      // 存档是模块要的三件（读 / 写 / 清）：位置从配置来，适配器由本层造。
      选项: (根, config) => ({
        取地址: () => config.comfyUI地址,
        存档: 造文件存档(取位置('comfyUI工作流存档')(根, config)),
      }),
      动作名: {
        drawing: '绘图开关',
        generationSettings: '生成设置',
        ping: '探活',
        queue: '看队列',
        objectInfo: '看节点定义',
        setWorkflow: '存工作流',
        getWorkflow: '取工作流',
        clearWorkflow: '清工作流',
        detect: '认',
        detectImage: '认图',
        generate: '出图',
        fetch: '取图',
      },
    },
    {
      名字: 'vision',
      门面: '识图模块/index.js',
      工厂: 'createVisionModule',
      // 识图要的五样都由装配层备齐：位图、查词、本地打标引擎、看图那条链路、元数据解析。
      选项: (根, config, 门面) => {
        const 给 = {
          取图字节: (引用) => {
            if (!门面.image) return null;
            const 回 = 门面.image.run('取内容', { 引用, 变体: 'original' });
            return 回 && 回.ok ? 回.data : null;
          },
          查词: 门面.tag && typeof 门面.tag.recognize === 'function' ? (词们) => 门面.tag.recognize(词们) : null,
          tagger: 本地识图引擎 || null,
          看图: 看图 || null,
          读元数据: 读元数据 || null,
          引擎: 本地识图引擎
            ? {
              get id() { return 本地识图引擎.id; },
              get 名字() { return 本地识图引擎.名字; },
              get 阈值() { return 本地识图引擎.阈值; },
            }
            : null,
        };
        return 给;
      },
      动作名: { models: '看模型', detect: '认图', metadata: '读元数据', ask: '看图' },
    },
  ]);
}

/**
 * 查一个动作里某个参数的类型。查不到就给 null（调用方按字符串走）。
 * 先看这个动作那一层，再看整张公共表。
 * @param {string} 模块键 装配层给模块起的键
 * @param {string} 动作名 模型侧的动作名
 * @param {string} 参数名
 */
export function 取参数类型(模块键, 动作名, 参数名) {
  const 这层 = 参数类型[`${模块键}.${动作名}`];
  const 定 = (这层 && 这层[参数名]) || 参数类型[参数名];
  return 定 ? { ...定 } : null;
}

/** 主AI模块（预设的家）。它与五个能力模块不同：它不登记工具。 */
export const 主AI = Object.freeze({
  名字: '主AI',
  门面: '主AI模块/index.js',
  工厂: 'createMainAiModule',
});
export const 会话 = Object.freeze({
  名字: 'session', 门面: '会话模块/index.js', 工厂: 'createSessionModule',
  动作名: { list: '列', read: '读', create: '新', rename: '改名', draft: '草稿', send: '发', editMessage: '改消息', regenerate: '重新生成', stop: '停', clear: '清空', remove: '删', save: '存', export: '导出', import: '导入' },
});
const PartSchema = { oneOf: [
  { type: 'object', properties: { type: { const: 'text' }, text: { type: 'string' } }, required: ['type', 'text'], additionalProperties: false },
  { type: 'object', properties: { type: { const: 'image' }, imageId: { type: 'string', pattern: '^img_[A-Za-z0-9-]+$' } }, required: ['type', 'imageId'], additionalProperties: false },
] };

/**
 * 参数的类型：**只列不是字符串的那些**，没列到的按 `string` 走。
 *
 * 模块的动作表只给参数名与说明，不给类型；模型那侧要按 JSON Schema 填参数，
 * 所以类型在**模型这一侧**补，模块自己那层的中文参数名与形状一个字不动。
 *
 * 形状按模块的口径给：`作用域` / `引用` / `产出` / `条目` / `一套` / `图` / `元数据` /
 * `配色` / `参数` 是对象（键与取值见各模块的 `接口.md`）；`oneOf` 那几个是"两种形状都可能"。
 * 同一个参数名在不同动作下形状不同，所以按 `模块键.动作名` 分层，再按参数名兜底。
 */
export const 参数类型 = Object.freeze({
  'tag.resolve': { 词: { type: 'string' } },
  'image.列会话图': { 作用域: { type: 'object', properties: { 存放地: { const: 'session' }, 会话ID: { type: 'string' } }, required: ['存放地', '会话ID'] } },
  'image.按图号取详情': { 作用域: { type: 'object', properties: { 存放地: { const: 'session' }, 会话ID: { type: 'string' } }, required: ['存放地', '会话ID'] }, 图号: { type: 'integer', minimum: 1 } },
  'drawing.生成': { 参考图: { type: 'integer', minimum: 1 } },
  'session.回答问题': { 答案: { type: 'string' } },
  'comfy.drawing': { 启用: { type: 'boolean' } },
  'comfy.generationSettings': { 每轮张数: { type: 'integer', minimum: 1 }, 最多轮数: { type: 'integer', minimum: 1 }, 自动迭代: { type: 'boolean' } },
  'comfy.generate': { 张数: { type: 'integer', minimum: 1 } },
  'session.send': { 内容: { type: 'array', items: PartSchema } },
  'session.draft': { 内容: { type: 'array', items: { oneOf: [...PartSchema.oneOf, { type: 'object', properties: { type: { const: 'image' }, imageId: { type: 'null' }, missing: { type: 'object', properties: { originalId: { type: 'string' }, reason: { type: 'string' } }, required: ['originalId', 'reason'], additionalProperties: false } }, required: ['type', 'imageId', 'missing'], additionalProperties: false }] } } },
  'session.remove': { 保留图片: { type: 'boolean' } },
  'session.export': { 会话列表: { type: 'array', items: { type: 'string' } } },
  'session.import': { 内容: { type: 'string' } },
  'vision.metadata': { 字节: { type: 'array', items: { type: 'integer' } } },
  // ---- 数组 ----
  标识列表: { type: 'array' },
  成员: { type: 'array' },
  词: { type: 'array' },
  启用: { type: 'array' },
  参考标签: { type: 'array' },
  // ---- 布尔 ----
  位置序: { type: 'boolean' },
  // ---- 对象 ----
  作用域: { type: 'object' },
  引用: { type: 'object' },
  产出: { type: 'object' },
  条目: { type: 'object' },
  一套: { type: 'object' },
  图: { type: 'object' },
  元数据: { type: 'object' },
  参数: { type: 'object' },
  runtime: { type: 'object' },
  配色: { type: 'object' },
  // ---- 两种形状都可能 ----
  标识: { oneOf: [{ type: 'string' }, { type: 'number' }] },
  模型: { oneOf: [{ type: 'string' }, { type: 'object' }] },
  // 同一个名字在几个动作下不一样，按动作分层：
  'tag.note.set': { 标识: { oneOf: [{ type: 'string' }, { type: 'number' }] } },
  'tag.identity.isAdult': { 标识: { oneOf: [{ type: 'string' }, { type: 'number' }] } },
  'tag.identity.isRole': { 标识: { oneOf: [{ type: 'string' }, { type: 'number' }] } },
  'tag.position.update': { 标识: { oneOf: [{ type: 'string' }, { type: 'number' }] } },
  'tag.position.delete': { 标识: { oneOf: [{ type: 'string' }, { type: 'number' }] } },
  '主AI.预设': { 预设: { oneOf: [{ type: 'string' }, { type: 'object' }] }, 源: { oneOf: [{ type: 'string' }, { type: 'object' }] } },
  '主AI.工具': { 预设: { type: 'string' } },
  '主AI.读': { 预设: { type: 'string' } },
  '主AI.测': { 预设: { type: 'string' } },
  '主AI.执行': { 预设: { type: 'string' } },
});

/** 控件的种类。`引用` / `作用域` / `产出` 是"上下文给的"，不给人填。 */
const 控件 = Object.freeze({
  文本框: 'text',
  长文本: 'textarea',
  数字: 'number',
  开关: 'boolean',
  下拉: 'select',
  标识: 'ref',
  上下文: 'context',
});

/**
 * 参数的控件与内层字段：`{ 控件, 选项?, 字段? }`。
 *
 * `取参数类型` 回答"这参数是什么类型"，这一张回答"界面上用什么控件、对象里有哪些字段"——
 * 同一个参数的两种说明，所以两张表住在同一个文件里，不另立一份。
 *
 * `字段` 只给字段名与控件，按各模块的 `接口.md`；**不给校验、不给默认值、不给必填**——
 * 那三样是模块自己的事（缺了就是缺功能，写错了就是调用失败）。
 * 字段的说明从模块自己的 `describe().说明` 里取，这里不重写一遍。
 *
 * 表里查不到的参数：说得出的按标量走、说不出的当空对象；`引用` / `作用域` / `产出` 这三样
 * 界面不认识就给 `上下文`，由哪个面板去填由那个面板自己决定。
 */
export const 界面字段 = Object.freeze({
  会话: { 控件: 控件.上下文 },
  标题: { 控件: 控件.文本框 },
  保留图片: { 控件: 控件.开关 },
  会话列表: { 控件: 控件.上下文 },
  'session.draft': { 内容: { 控件: 控件.上下文 } },
  'session.send': { 内容: { 控件: 控件.上下文 } },
  'session.editMessage': { 消息ID: { 控件: 控件.上下文 } },
  'session.regenerate': { 轮次ID: { 控件: 控件.上下文 } },
  'session.import': { 内容: { 控件: 控件.长文本 } },
  // ---- 各模块都有的那几样 ----
  文本: { 控件: 控件.长文本 },
  名字: { 控件: 控件.文本框 },
  标识: { 控件: 控件.标识 },
  标识列表: { 控件: 控件.标识 },
  上限: { 控件: 控件.数字 },
  位置序: { 控件: 控件.开关 },
  启用: { 控件: 控件.标识 },
  配色: { 控件: 控件.文本框 },
  成员: { 控件: 控件.标识 },
  位置: { 控件: 控件.下拉, 选项: ['分类', '收藏'] },

  // ---- 图片模块 ----
  作用域: {
    控件: 控件.上下文,
    字段: [{ 名: '存放地', 控件: 控件.下拉, 选项: ['gallery', 'session', 'vision'] }, { 名: '会话ID', 控件: 控件.文本框 }],
  },
  引用: {
    控件: 控件.上下文,
    字段: [{ 名: '作用域', 控件: 控件.上下文 }, { 名: '条目ID', 控件: 控件.文本框 }],
  },
  变体: { 控件: 控件.下拉, 选项: ['original', 'preview', 'thumbnail'] },
  字节: { 控件: 控件.上下文 },
  文件名: { 控件: 控件.文本框 },
  mime: { 控件: 控件.文本框 },

  // ---- 世界书模块 ----
  请求: { 控件: 控件.下拉 },
  书: { 控件: 控件.标识 },
  条目: {
    控件: 控件.上下文,
    字段: [
      { 名: 'label', 控件: 控件.文本框 },
      { 名: 'text', 控件: 控件.长文本 },
      { 名: 'always', 控件: 控件.开关 },
      { 名: 'keys', 控件: 控件.标识 },
      { 名: 'enabled', 控件: 控件.开关 },
      { 名: '落点', 控件: 控件.下拉, 选项: ['前', '后', '按深度'], 选项显示名: { 前: '系统内容前部', 后: '系统内容后部', 按深度: '本轮输入前 · 用户消息' } },
    ],
  },

  // ---- comfyUI 模块 ----
  图: { 控件: 控件.上下文 },
  产出: {
    控件: 控件.上下文,
    字段: [{ 名: '文件名', 控件: 控件.文本框 }, { 名: '子目录', 控件: 控件.文本框 }, { 名: '类型', 控件: 控件.文本框 }],
  },

  // ---- 按动作分层：同一个名字在几个动作下不一样 ----
  // 键用**模型侧**的动作名（`模块键.动作名`）：查表的那一方手里只有模型侧的名字。
  'tag.query': { 串: { 控件: 控件.文本框 } },
  'tag.recognize': { 词: { 控件: 控件.文本框 } },
  'tag.record.create': { 名称: { 控件: 控件.文本框 }, 中文名: { 控件: 控件.文本框 }, 成员: { 控件: 控件.标识 } },
  'tag.record.edit': { 名称: { 控件: 控件.文本框 }, 中文名: { 控件: 控件.文本框 }, 成员: { 控件: 控件.标识 } },
  'tag.note.set': { 标识: { 控件: 控件.标识 } },
  'image.list': { 作用域: { 控件: 控件.上下文, 字段: [{ 名: '存放地', 控件: 控件.下拉, 选项: ['gallery', 'session', 'vision'] }, { 名: '会话ID', 控件: 控件.文本框 }] } },
  'image.clear': { 作用域: { 控件: 控件.上下文, 字段: [{ 名: '存放地', 控件: 控件.下拉, 选项: ['gallery', 'session', 'vision'] }, { 名: '会话ID', 控件: 控件.文本框 }] } },
  'image.save': { 来源: { 控件: 控件.下拉, 选项: ['upload', 'generation', 'copy', 'import'] } },
  'comfy.generate': { 正向: { 控件: 控件.长文本 }, 负向: { 控件: 控件.长文本 }, 图片: { 控件: 控件.上下文 }, 张数: { 控件: 控件.数字 } },
  'comfy.drawing': { 启用: { 控件: 控件.开关 } },
  'comfy.generationSettings': { 每轮张数: { 控件: 控件.数字 }, 最多轮数: { 控件: 控件.数字 }, 自动迭代: { 控件: 控件.开关 } },
  'comfy.detectImage': { 图: { 控件: 控件.上下文 } },
  'comfy.setWorkflow': { 图: { 控件: 控件.上下文 } },
  // 识图的三个动作收的是**扁平**的图引用（存放地 / 条目ID / 会话ID），
  // 这三样都由上下文给，不给人填。
  'vision.detect': {
    存放地: { 控件: 控件.上下文 },
    条目ID: { 控件: 控件.上下文 },
    会话ID: { 控件: 控件.上下文 },
  },
  'vision.metadata': {
    存放地: { 控件: 控件.上下文 },
    条目ID: { 控件: 控件.上下文 },
    会话ID: { 控件: 控件.上下文 },
    字节: { 控件: 控件.上下文 },
  },
  'vision.ask': {
    存放地: { 控件: 控件.上下文 },
    条目ID: { 控件: 控件.上下文 },
    会话ID: { 控件: 控件.上下文 },
    提示: { 控件: 控件.长文本 },
  },
  'worldbook.books': { 动作: { 控件: 控件.下拉, 选项: ['换', '导入', '新建', '改名', '删', '导出'] } },
  'worldbook.entries': { 动作: { 控件: 控件.下拉, 选项: ['加', '改', '删', '移'] }, 方向: { 控件: 控件.下拉, 选项: ['上', '下'] } },
});

/**
 * 查一个参数的界面说明。查不到就给一个按类型推的兜底。
 * 先看这个动作那一层，再看整张公共表，最后看类型表。
 * @param {string} 模块键 装配层给模块起的键
 * @param {string} 动作名 模型侧的动作名
 * @param {string} 参数名
 */
export function 取界面字段(模块键, 动作名, 参数名) {
  const 这层 = 界面字段[`${模块键}.${动作名}`];
  const 定 = (这层 && 这层[参数名]) || 界面字段[参数名];
  if (定) return { 控件: 控件.文本框, ...定 };

  const 型 = 取参数类型(模块键, 动作名, 参数名);
  const 种类 = 型 && (型.type || (Array.isArray(型.oneOf) ? 型.oneOf[0].type : ''));
  if (种类 === 'array') return { 控件: 控件.标识 };
  if (种类 === 'boolean') return { 控件: 控件.开关 };
  if (种类 === 'number') return { 控件: 控件.数字 };
  return { 控件: 控件.文本框 };
}
