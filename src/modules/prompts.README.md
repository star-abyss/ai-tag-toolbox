# Prompts 模块

`prompts.js` 是一个故意保持很小的提示词素材读取器。它只读取
`assets/提示词素材` 下的 7 个文本文件，不负责 AI 请求、页面状态或旧版
提示词流程。

```js
const path = require('node:path');
const { createPrompts } = require('./prompts');

const prompts = createPrompts({
  dir: path.join(__dirname, '..', '..', 'assets', '提示词素材')
});

const system = prompts.get('main');
const vision = prompts.get('vision');
const request = prompts.compose('generate', {
  extra: '1girl, outdoors',
  // appendices: [1] 或 true；默认不附加任何附录
  appendices: [1]
});
```

素材键仍包括 `main`、`generate`、`chat`、`vision`、`comfy`、`quality`、
`appendices`；这些是提示词文件名，不是用户 AI 模式。页面和统一 Runner 只暴露
`assistant`（助手）与 `draw`（绘图）两种模式，Comfy 只是绘图模式的任务上下文。
为迁移旧设置，读取时仍接受 `system`、`gen`、`image`、`comfyui` 等历史键别名。

`appendices()` 会把默认附录拆成 `{ id, index, title, text, enabled, trigger }`
对象；`enabled` 默认是 `false`，由 Assistant 根据当前需求决定是否启用。

这是 CommonJS/Node 模块。Electron 的 preload 可以创建一个实例后注入页面，
也可以直接由 Assistant 使用；页面不需要知道素材文件路径。
