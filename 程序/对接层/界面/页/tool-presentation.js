'use strict';

/**
 * 工具展示层：注册名 → 中文名 / 参数摘要 / 状态文案的唯一来源。
 *
 * 规则：键一律用注册名（`_shared/tool-aliases.js` 的 `REGISTERED`）；
 * 查不到名字时回退到原名（`tags_search`），不回退到"工具"这个兜底词。
 *
 * 渲染层通过 `global.ToolPresentation` 取用；Node 侧可直接 `require`。
 */

(function installToolPresentation(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ToolPresentation = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  /** 注册名 → 中文名。键必须落在 `REGISTERED` 里（测试反查）。 */
  const TOOL_LABELS = Object.freeze({
    tags_search: 'Tag 查询',
    tags_get: '读 Tag 详情',
    favorites_list: '收藏夹列表',
    characters_search: '角色查询',
    characters_get: '读角色详情',
    characters_series: '角色作品',
    vision_process: '识图',
    translation_translate: '翻译',
    image_info: '读图片信息',
    comfy_status: 'ComfyUI 状态',
    comfy_workflows: 'ComfyUI 工作流',
    generation_execute: '自动生成任务',
    generation_get: '查生成任务',
    ask_user: '向你提问',
    view_images: '看图',
    set_conversation_title: '重命名对话',
    job_output: '读任务输出',
    job_list: '列任务',
    job_kill: '中止任务'
  });

  /**
   * 内部 / 历史名：**不是模型可见工具**，但仍会出现在事件里
   * （`comfy.render` 来自出图链路、`agent.generateTags` 是旧的副 AI 任务名）。
   * 测试允许表里多出这几个键，其余多出来的键一律算漂移。
   */
  const INTERNAL_LABELS = Object.freeze({
    'comfy.render': 'ComfyUI 出图',
    'agent.generateTags': 'Tag 生成'
  });

  /** 参数摘要按这张表取：第一个非空的键胜出；键必须是该工具真的入参名。 */
  const SUMMARY_KEYS = Object.freeze({
    tags_search: ['query', 'characterId', 'series', 'category'],
    tags_get: ['id'],
    characters_search: ['query', 'series'],
    characters_get: ['id'],
    characters_series: ['query'],
    vision_process: ['imageId', 'instruction'],
    translation_translate: ['text', 'direction'],
    image_info: ['imageId', 'container'],
    comfy_workflows: ['workflowId'],
    generation_execute: ['requirements', 'positiveTags', 'previousTags', 'characterIds'],
    generation_get: ['jobId'],
    ask_user: ['question', 'options'],
    view_images: ['imageId'],
    set_conversation_title: ['title'],
    job_output: ['jobId'],
    job_list: ['status'],
    job_kill: ['jobId', 'reason']
  });

  /**
   * 事件类型 → 阶段。**工具事件不走展示白名单**（`tool/call` / `tool/result`
   * 是管道记账事件，界面正文里不该出现），所以这里用查表而不是
   * `type === "…"` 字面量：一处定义，界面只问"这个类型属于哪个阶段"。
   */
  const PHASES = Object.freeze({
    'tool/call': 'calling',
    'tool.start': 'calling',
    'tool/result': 'settled',
    'tool.complete': 'settled',
    'tool.failed': 'failed',
    'tool.blocked': 'blocked'
  });

  /** 进度类事件（ComfyUI 排队）单独一档：它不是调用开始也不是结束。 */
  const PROGRESS_EVENT = 'progress';

  const SUMMARY_MAX = 40;

  function text(value) { return value == null ? '' : String(value).trim(); }

  /** 中文名；未知工具回退**原名**（不回退"工具"）。 */
  function toolLabel(name, args) {
    const key = text(name);
    if (!key) return '工具';
    /** 识图按模式分三种说法 —— 与旧的 `vision.processOne` 行为一致。 */
    if (key === 'vision_process') {
      const mode = text(args?.mode);
      if (mode === 'local') return '本地识图';
      if (mode === 'metadata') return '读取图片信息';
      return '识图 AI';
    }
    return TOOL_LABELS[key] || INTERNAL_LABELS[key] || key;
  }

  /**
   * 一行参数摘要：取第一个非空参数，数组给条数，只留首行，最长 40 字。
   *
   * `labelOf` 是**可选的图片改名器**（`imageId → "会话图 2"`）——
   * 界面卡片上的编号就是它；取不到就照原样显示 imageId。
   */
  function toolSummary(name, args, labelOf = null) {
    const keys = SUMMARY_KEYS[text(name)] || [];
    const source = args && typeof args === 'object' ? args : {};
    for (const key of keys) {
      const value = source[key];
      if (value == null) continue;
      if (Array.isArray(value)) { if (value.length) return `${value.length} 项`; continue; }
      if (typeof value === 'object') continue;
      /** 布尔与数字不是给人看的摘要（`probe: true`、`limit: 20` 都只会添乱）。 */
      if (typeof value === 'boolean' || typeof value === 'number') continue;
      const line = text(value).split(/\r?\n/)[0];
      if (!line) continue;
      const shown = key === 'imageId' && labelOf ? labelOf(line) : line;
      return shown.length > SUMMARY_MAX ? `${shown.slice(0, SUMMARY_MAX - 1)}…` : shown;
    }
    return '';
  }

  /** 事件类型 → 阶段；不是工具事件返回空串。 */
  function toolPhase(type) { return PHASES[text(type)] || ''; }

  function isToolEvent(type) { return Boolean(toolPhase(type)); }

  /** `中文名（摘要）`；没有摘要就是 `中文名`。状态栏与消息区共用这一种写法。 */
  function toolTitle(name, args, labelOf = null) {
    const label = toolLabel(name, args);
    const summary = toolSummary(name, args, labelOf);
    return summary ? `${label}（${summary}）` : label;
  }

  /** 正在调用那一句 —— 状态栏与时间线摘要**共用同一个字符串**。 */
  function runningText(name, args) { return `正在调用 ${toolTitle(name, args)}…`; }

  /**
   * 状态栏那一句话。返回 `{ phase, label, summary, title, text }`；
   * 不是工具事件则返回 `null`（调用方保留原有文案）。
   */
  function toolAction(type, name, args, error) {
    const phase = toolPhase(type);
    if (!phase) return null;
    const label = toolLabel(name, args);
    const summary = toolSummary(name, args);
    const title = toolTitle(name, args);
    if (phase === 'calling') return { phase, label, summary, title, text: runningText(name, args) };
    if (phase === 'settled') return { phase, label, summary, title, text: `${title} 已完成` };
    if (phase === 'blocked') return { phase, label, summary, title, text: `${label} 已跳过（本轮已停止）` };
    const reason = text(error?.message || error?.code);
    return { phase, label, summary, title, text: `${label} 调用失败${reason ? `：${reason}` : ''}` };
  }

  /** 时间线里那行末尾的状态词。 */
  function statusText(status) {
    return status === 'running' ? '执行中' : status === 'failed' ? '失败' : status === 'cancelled' ? '已取消' : '已完成';
  }
  /**
   * 工具那行的图标 —— 按工具名给一个，认不出来的给通用齿轮。
   * 只影响观感，不参与任何判断。
   */
  const TOOL_ICONS = Object.freeze({
    'tags.search': '🔍', 'tags.get': '🏷', 'favorites.list': '⭐',
    'characters.search': '👤', 'characters.get': '👤', 'characters.series': '📚',
    'vision.process': '👁', 'translation.translate': '🌐',
    'image.info': '🖼', 'view.images': '🖼',
    'comfy.status': '🔌', 'comfy.workflows': '🧩',
    'generation.execute': '🎨', 'generation.get': '📋',
    'job.output': '📋', 'job.list': '📋', 'job.kill': '⛔',
    'ask.user': '❓', 'set.conversation.title': '✏️'
  });
  function toolIcon(name) {
    const key = text(name);
    if (TOOL_ICONS[key]) return TOOL_ICONS[key];
    const dotted = key.replace(/_/g, '.');
    return TOOL_ICONS[dotted] || '🔧';
  }

  return Object.freeze({
    TOOL_LABELS, INTERNAL_LABELS, SUMMARY_KEYS, PHASES, PROGRESS_EVENT, SUMMARY_MAX, TOOL_ICONS,
    toolLabel, toolSummary, toolPhase, isToolEvent, toolTitle, runningText, toolAction, statusText, toolIcon
  });
});
