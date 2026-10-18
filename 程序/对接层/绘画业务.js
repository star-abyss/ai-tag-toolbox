export const ERR = Object.freeze({
  NO_TOOL: 'BUSINESS_NO_TOOL', BAD_INPUT: 'BUSINESS_BAD_INPUT', NO_IMAGE: 'SESSION_IMAGE_MISSING',
  STOPPED: 'SESSION_STOPPED', NO_INTERACTION: 'BUSINESS_NO_INTERACTION', NO_OUTPUT: 'BUSINESS_NO_IMAGES',
  LIMIT: 'BUSINESS_GENERATION_LIMIT', BUSY: 'BUSINESS_GENERATION_BUSY',
});
const 文本 = (description, required = false) => ({ type: 'string', description, ...(required ? { required: true } : {}) });
const 图号 = (description, required = true) => ({ type: 'integer', minimum: 1, description, ...(required ? { required: true } : {}) });
const 定义 = (名字, 摘要, 参数 = {}) => ({ 名字, 摘要, 参数, 说明: Object.fromEntries(Object.entries(参数).map(([名, 值]) => [名, 值.description])) });
const 工具表 = [
  定义('tags_search', '按中文、英文或别名查找绘画标签与角色候选。返回标识、规范词、中文主名和命中类型/命中词；其他检索写法及近似命中只表示相关，不证明可以互换或删除原词属性。多个角色都符合且尚未确认时，用 ask_user 请用户选择；读取选中项用 tags_get。', {
    查询: 文本('要查的名字或关键词。', true), 数量: { type: 'integer', minimum: 1, description: '返回多少条候选，省略为30；总数与还有更多说明完整性。' },
  }),
  定义('tags_get', '读取搜索候选的标签或角色详情。标识来自 tags_search；角色详情包含作品与可选特征词。只读取内容，不改变选择或任何记录。', { 标识: 文本('搜索返回的记录标识；数字标识也填写字符串。', true) }),
  定义('images_list', '列出当前会话区的图片编号、名称与尺寸。用户说图1时使用图号1；已删图号不会改指其他图片。仅列信息，需要查看图像时用 images_view。'),
  定义('images_view', '查看当前会话区指定图号。返回当前图片引用，并将实际图片内容交给支持视觉的模型；图号不存在或已删除时返回明确失败。', { 图号: 图号('会话区显示的图片编号，例如图1填写1。') }),
  定义('drawing_info', '查询生图是否启用、是否已配置，以及可接受的提示词、参考图和批量张数。'),
  定义('drawing_generate', '按用户配置生成一批图片，可使用当前会话的参考图。完成后取回图片、加入会话区分配图号，并交给支持视觉的模型；无法继续时返回失败结果。', {
    正向: 文本('本次完整正向提示词。由你根据用户要求组织。', true),
    负向: 文本('本次负向提示词。省略时保留当前绘画配置的负向输入，空串表示清空；是否填写由你决定，支持情况见 drawing_info。'),
    参考图: 图号('当前会话的参考图片编号；省略时不替换当前绘画配置的图片输入。', false),
  }),
  定义('ask_user', '向用户提问并等待明确答案。可用于确认多个匹配角色中的哪一个。每个选项有稳定标识和可读说明；用户取消后本轮结束，后续尚未执行的生图不会继续。', {
    问题: 文本('需要用户确认的问题。', true),
    选项: { type: 'array', required: true, items: { type: 'object', properties: { 标识: 文本('本选项的标识。'), 说明: 文本('用户看到的角色或选项说明。') }, required: ['标识', '说明'] }, description: '供用户选择的选项；说明应足以区分候选。' },
  }),
  定义('translate_text', '翻译文本并给出词库命中与译文对照。输入可以是描述或已组成的提示词；不会更改会话图片或已选择的标签。', {
    文本: 文本('要翻译的原文。', true), 方向: { type: 'string', enum: ['auto', 'en-zh', 'zh-en'], description: 'auto自动判断；en-zh英译中；zh-en中译英，省略为auto。' },
  }),
  定义('vision_tag', '使用本地识图模型分析当前会话图片，返回标签、中文名与概率。只分析，不自动选择或改写用户提示词。', {
    图号: 图号('待分析的当前会话图片编号。'), 阈值: { type: 'number', description: '模型标签概率阈值；省略使用当前模型默认值。' },
  }),
  定义('vision_describe', '让视觉模型分析当前会话图片，返回描述与标签。可用提示说明关注内容；失败返回实际原因。', {
    图号: 图号('待分析的当前会话图片编号。'), 提示: 文本('希望重点观察或说明的内容。'),
  }),
];
const ok = data => ({ ok: true, data });
const fail = (code, text) => ({ ok: false, code, reason: `${code}: ${text}` });
const 主名 = value => String(value ?? '').split(/[,，]/)[0].trim();

export const 导出绘画工具表 = () => structuredClone(工具表);

/** 当前会话中的绘画业务，工具定义与执行绑定在同一处。 */
export function 造绘画业务({ 门面, sessionId, 提问, signal, 生成设置, onGenerationState } = {}) {
  const 作用域 = { 存放地: 'session', 会话ID: sessionId };
  const 停止 = () => signal?.aborted ? fail(ERR.STOPPED, '用户已停止') : null;
  let state = null, preparing = null, generating = false;
  function 设置状态(settings) {
    state = {
      每轮张数: settings.每轮张数,
      最多轮数: settings.自动迭代 ? settings.最多轮数 : 1,
      自动迭代: settings.自动迭代,
      已用轮数: 0,
      剩余轮数: settings.自动迭代 ? settings.最多轮数 : 1,
    };
    onGenerationState?.(structuredClone(state));
  }
  if (生成设置 !== undefined) 设置状态(structuredClone(生成设置));
  function 准备() {
    if (state) return Promise.resolve(ok(structuredClone(state)));
    if (!preparing) preparing = (async () => {
      const result = await 门面.comfy.run('生成设置');
      if (!result.ok) return result;
      设置状态(result.data);
      return ok(structuredClone(state));
    })();
    return preparing;
  }
  async function 定位(number) {
    if (!sessionId) return fail(ERR.NO_IMAGE, '没有当前会话');
    if (!Number.isInteger(number) || number < 1) return fail(ERR.BAD_INPUT, '图号须为正整数');
    const list = await 门面.image.run('列会话图', { 作用域 });
    if (!list.ok) return list;
    const row = list.data.条目.find(item => item.图号 === number);
    return row ? ok(row) : fail(ERR.NO_IMAGE, `当前会话图${number}不存在或已删除`);
  }
  async function 取图(number) {
    const found = await 定位(number);
    if (!found.ok) return found;
    const content = await 门面.image.run('取内容', { 引用: found.data.引用, 变体: 'original' });
    return content.ok ? ok({ 条目: found.data, 内容: content.data }) : content;
  }
  const handlers = {
    async tags_search(args) {
      if (typeof args.查询 !== 'string') return fail(ERR.BAD_INPUT, '查询须为文本');
      const limit = args.数量 === undefined ? 30 : args.数量;
      if (!Number.isInteger(limit) || limit < 1) return fail(ERR.BAD_INPUT, '数量须为正整数');
      const result = await 门面.tag.run('query', { 串: args.查询, 上限: Number.MAX_SAFE_INTEGER });
      if (!result.ok) return result;
      const rows = result.data.候选.filter(row => row.类型 === '记录');
      return ok({ 候选: rows.slice(0, limit).map(({ 记录, 档, 命中, 命中类型, 命中词 }) => ({ 标识: String(记录.ID), 名称: 主名(记录.名称), 中文名: 主名(记录.中文名), 命中, 命中类型, 命中词, 档 })), 总数: rows.length, 还有更多: rows.length > limit });
    },
    async tags_get(args) {
      const result = await 门面.tag.run('record.get', { 标识: args.标识 });
      if (!result.ok) return result;
      const row = result.data;
      const data = { 标识: String(row.ID), 名称: 主名(row.名称), 中文名: 主名(row.中文名) };
      if (Array.isArray(row.成员)) {
        const words = await 门面.tag.run('render.words', { 标识: row.ID });
        if (!words.ok) return words;
        data.详情 = { 角色名: words.data.角色名, 作品: words.data.作品, 特征: words.data.块们.map(block => ({ 分类: block.页名, 词: block.词们 })), 其他特征: words.data.没页的词 };
      }
      return ok(data);
    },
    async images_list() {
      if (!sessionId) return fail(ERR.NO_IMAGE, '没有当前会话');
      const result = await 门面.image.run('列会话图', { 作用域 });
      if (!result.ok) return result;
      return ok({ 图片: result.data.条目.map(row => ({ 图号: row.图号, 名称: row.显示名, 宽: row.宽, 高: row.高 })) });
    },
    async images_view(args) {
      const result = await 定位(args.图号);
      return result.ok ? ok({ 图号: result.data.图号, 图片: { type: 'session-image', imageId: result.data.标识 } }) : result;
    },
    async drawing_info() {
      const enabled = await 门面.comfy.run('绘图开关');
      if (!enabled.ok) return enabled;
      const inputs = await 门面.comfy.run('认');
      if (!inputs.ok) return { ...inputs, 当前绘图启用: enabled.data.启用 };
      return ok({ 启用: enabled.data.启用, 已配置: true, 正向提示词: Boolean(inputs.data.正向.length), 负向提示词: Boolean(inputs.data.负向.length), 参考图: Boolean(inputs.data.图片.length), 批量张数: Boolean(inputs.data.张数?.length) });
    },
    async drawing_generate(args) {
      if (typeof args.正向 !== 'string') return fail(ERR.BAD_INPUT, '正向提示词须为文本');
      if (!sessionId) return fail(ERR.NO_IMAGE, '没有当前会话');
      if (state.剩余轮数 <= 0) return fail(ERR.LIMIT, '当前无法继续生成；可继续查看图片和回复');
      let reference;
      if (args.参考图 !== undefined) {
        const image = await 取图(args.参考图);
        if (!image.ok) return image;
        reference = { 字节: image.data.内容.字节, 文件名: image.data.内容.文件名, mime: image.data.内容.mime };
      }
      if (停止()) return 停止();
      let counted = false;
      const result = await 门面.comfy.run('出图', {
        正向: args.正向,
        ...(args.负向 === undefined ? {} : { 负向: args.负向 }),
        ...(reference ? { 图片: reference } : {}),
        张数: state.每轮张数,
        onEvent(event) {
          if (event.类型 !== '提交中' || counted) return;
          counted = true;
          state.已用轮数++;
          state.剩余轮数--;
          onGenerationState?.(structuredClone(state));
        },
      }, { signal });
      if (!result.ok) return result;
      const images = [];
      for (const output of result.data.产出 || []) {
        if (停止()) return 停止();
        if (output.种类 && output.种类 !== 'image') continue;
        const content = await 门面.comfy.run('取图', { 产出: output }, { signal });
        if (!content.ok) return { ...content, 已接收图片: images };
        let dimensions = {};
        try {
          const { default: sharp } = await import('sharp');
          const metadata = await sharp(Buffer.from(content.data.字节)).metadata();
          dimensions = { 宽: metadata.width, 高: metadata.height };
        } catch { /* 无尺寸信息时按原文件保存。 */ }
        const stored = await 门面.image.run('存', { 作用域, 字节: content.data.字节, 文件名: content.data.文件名, mime: content.data.mime, ...dimensions, 来源: 'generation', 元数据: { 正向提示词: args.正向, ...(args.负向 === undefined ? {} : { 负向提示词: args.负向 }) } });
        if (!stored.ok) return { ...stored, 已接收图片: images };
        images.push({ 图号: stored.data.图号, 名称: stored.data.显示名, 引用: { type: 'session-image', imageId: stored.data.标识 } });
      }
      return images.length ? ok({ 图片: images }) : fail(ERR.NO_OUTPUT, '本次生成没有返回图片文件');
    },
    async ask_user(args) {
      if (typeof 提问 !== 'function') return fail(ERR.NO_INTERACTION, '当前会话未接入用户提问');
      return await 提问(args, signal);
    },
    translate_text: args => 门面.translate.run('本地译', args),
    async vision_tag(args) {
      const found = await 定位(args.图号);
      if (!found.ok) return found;
      const result = await 门面.vision.run('认图', { 存放地: 'session', 会话ID: sessionId, 条目ID: found.data.标识, ...(args.阈值 === undefined ? {} : { 阈值: args.阈值 }) });
      if (!result.ok) return result;
      const { 引用, ...data } = result.data;
      return ok({ 图号: args.图号, ...data });
    },
    async vision_describe(args) {
      const found = await 定位(args.图号);
      if (!found.ok) return found;
      const result = await 门面.vision.run('看图', { 存放地: 'session', 会话ID: sessionId, 条目ID: found.data.标识, 提示: args.提示 });
      if (!result.ok) return result;
      const { 引用, ...data } = result.data;
      return ok({ 图号: args.图号, ...data });
    },
  };
  return Object.freeze({
    工具表: 导出绘画工具表(),
    准备,
    状态: () => structuredClone(state),
    async 执行(name, args = {}) {
      const stopped = 停止();
      if (stopped) return stopped;
      if (!Object.hasOwn(handlers, name)) return fail(ERR.NO_TOOL, '没有这个绘画工具');
      if (!args || typeof args !== 'object' || Array.isArray(args)) return fail(ERR.BAD_INPUT, '参数须为对象');
      if (name === 'drawing_generate' || name === 'drawing_info') {
        if (name === 'drawing_generate' && generating) return fail(ERR.BUSY, '上一次生成还没结束');
        if (name === 'drawing_generate') generating = true;
        try {
          const ready = await 准备();
          if (!ready.ok) return ready;
          if (停止()) return 停止();
          return await handlers[name](args);
        } finally {
          if (name === 'drawing_generate') generating = false;
        }
      }
      return await handlers[name](args);
    },
  });
}
