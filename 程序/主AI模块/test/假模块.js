'use strict';

function 假业务工具() {
  return [
    { 名字: 'tag_query', 摘要: '按词查询标签', 参数: { 词串: { type: 'string', description: '要查的词，逗号分隔', required: true }, 上限: { type: 'integer', description: '最多回几条' } }, 说明: { 词串: '要查的词，逗号分隔', 上限: '最多回几条' } },
    { 名字: 'tag_recognize', 摘要: '识别输入中的标签', 参数: { 词: { type: 'string', description: '一个词或一批词', required: true } }, 说明: { 词: '一个词或一批词' } },
    { 名字: 'image_list', 摘要: '列出会话图片', 参数: { 会话ID: { type: 'string', required: true } }, 说明: {} },
    { 名字: 'image_detail', 摘要: '读取会话图片详情', 参数: { 引用: { type: 'object', required: true, properties: { 作用域: { type: 'string', required: true }, 条目ID: { type: 'string', required: true } } } }, 说明: {} },
    { 名字: 'worldbook_run', 摘要: '查询命中的世界书内容', 参数: { 请求: { type: 'string', required: true }, 文本: { type: 'string', required: true } }, 说明: {} },
    { 名字: 'binding_bind', 摘要: '翻译提示词', 参数: { 文本: { type: 'string', required: true } }, 说明: {} },
    { 名字: 'comfy_generate', 摘要: '按提示词生成图片', 参数: { 正向: { type: 'string', required: true }, 负向: { type: 'string' } }, 说明: { 正向: '正向提示词' } },
  ];
}

function 假默认预设() {
  return { name: '主AI' };
}

function 建假默认目录(根) {
  const 默认目录 = require('path').join(根, '默认');
  require('fs').mkdirSync(默认目录, { recursive: true });
  require('fs').writeFileSync(require('path').join(默认目录, '主AI.json'), JSON.stringify(假默认预设(), null, 2), 'utf8');
  return 默认目录;
}

module.exports = { 假业务工具, 假默认预设, 建假默认目录 };
