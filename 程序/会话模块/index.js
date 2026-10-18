'use strict';
const { createCore } = require('./core.js');
const { check } = require('./port.js');
const { ERR, fail, copy } = require('./data.js');
const { createFileAdapter } = require('./adapter-file.js');
const { createMemoryAdapter } = require('./adapter-memory.js');
const TABLE = {
  列: { 摘要: '列出会话与保存问题', 参数: [], 说明: {} },
  读: { 摘要: '读取会话记录和运行状态', 参数: ['会话'], 说明: { 会话: '会话标识' } },
  待答问题: { 摘要: '读取目标会话当前等待用户回答的问题', 参数: ['会话'], 说明: { 会话: '会话标识' } },
  回答问题: { 写: true, 摘要: '向目标会话回答当前问题', 参数: ['会话', '问题ID', '答案'], 说明: { 会话: '会话标识', 问题ID: '当前待答问题标识', 答案: '用户选中的选项或文字' } },
  取消问题: { 写: true, 摘要: '取消目标会话当前问题并停止本轮后续执行', 参数: ['会话', '问题ID'], 说明: { 会话: '会话标识', 问题ID: '当前待答问题标识' } },
  新: { 写: true, 摘要: '新建空会话', 参数: [], 说明: {} },
  改名: {
    写: true,
    摘要: '保存完整标题',
    参数: ['会话', '标题'],
    说明: { 会话: '会话标识', 标题: '非空全文标题' },
  },
  草稿: {
    写: true,
    摘要: '保存下一次发送的有序图文内容',
    参数: ['会话', '内容'],
    说明: { 会话: '会话标识', 内容: 'Part 数组；可为空；保存不检查图片存在性' },
  },
  改消息: {
    写: true,
    摘要: '修改一条用户或助手消息的正文',
    参数: ['会话', '消息ID', '文本'],
    说明: { 会话: '会话标识', 消息ID: '目标消息标识', 文本: '完整替换的正文文本；保留非文本内容' },
  },
  重新生成: {
    写: true,
    摘要: '重新执行指定轮次并替换该轮助手回复',
    参数: ['会话', '轮次ID'],
    说明: { 会话: '会话标识', 轮次ID: '目标用户消息所属轮次；保留后续对话' },
  },
  发: {
    写: true,
    摘要: '保存并受理一轮图文发送',
    参数: ['会话', '内容'],
    说明: {
      会话: '明确的会话标识；本轮图片与回复始终归此会话',
      内容: '有序 Part 数组，支持纯图。当前会话素材标识用于操作；导入历史正文的旧标识仅为原文。实际图像工具回执保存到本轮会话，字节位置替换为 session-image 标记；只返回产出标识时不自动取图。历史缺图按原理由显示。',
    },
  },
  停: {
    写: true,
    摘要: '请求停止目标会话本轮，等待执行收口',
    参数: ['会话'],
    说明: { 会话: '会话标识' },
  },
  存: {
    写: true,
    摘要: '重试保存当前内存事实，不重新执行',
    参数: ['会话'],
    说明: { 会话: '会话标识' },
  },
  清空: {
    写: true,
    摘要: '清空消息、轮次和草稿，保留图片素材',
    参数: ['会话'],
    说明: { 会话: '会话标识；运行中返回 busy' },
  },
  删: {
    写: true,
    摘要: '先按选择保图，再清图片和删除会话文件',
    参数: ['会话', '保留图片?'],
    说明: {
      会话: '会话标识',
      保留图片:
        'boolean，默认 false；true 时先逐张复制到图库，全部成功才清源；部分失败返回实际已完成项',
    },
  },
  导出: {
    写: true,
    摘要: '导出自包含 JSON 归档，含全部现存会话素材',
    参数: ['会话列表'],
    说明: { 会话列表: '非空、不重复的会话 ID 数组；按输入顺序导出' },
  },
  导入: {
    写: true,
    摘要: '导入完整归档，全部活动标识重新生成',
    参数: ['内容'],
    说明: {
      内容: '.toolbox-session.json 的完整 JSON 文本；先检查全包，再逐项创建；部分失败保留可见的导入未完成会话与素材',
    },
  },
};
function createSessionModule(options = {}) {
  check(options);
  const core = createCore(options);
  return Object.freeze({
    run(action, parameters = {}) {
      if (!Object.hasOwn(TABLE, action)) return fail(ERR.BAD_ACTION, '没有这个动作');
      try {
        const result = core.methods[action](copy(parameters));
        return TABLE[action].写
          ? Promise.resolve(result).catch((e) =>
              e?.ok === false ? copy(e) : fail(ERR.WRITE_FAILED, e.message || '写操作失败'),
            )
          : result;
      } catch (e) {
        const error = fail(ERR.BAD_ARGUMENT, e.message || '参数不符合形状');
        return TABLE[action].写 ? Promise.resolve(error) : error;
      }
    },
    actions: Object.freeze(Object.keys(TABLE)),
    describe: () =>
      Object.entries(TABLE).map(([动作, { 写, ...value }]) => ({ 动作, ...copy(value) })),
    ready: core.ready,
    subscribe: core.subscribe,
    close: core.close,
  });
}
module.exports = Object.freeze({
  createSessionModule,
  createFileAdapter,
  createMemoryAdapter,
  ERR,
});
