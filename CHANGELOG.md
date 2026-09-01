# 更新日志

## V1.4.131

### 重构

- 简洁模块化重写，页面外观沿用 V1.4.2 的使用习惯，业务代码不再依赖旧版脚本链。
- 业务代码拆分为 `src/modules/`：`tags.js`、`images.js`、`vision.js`、`vision-service.js`、`translation.js`、`assistant.js`、`ai-runner.js`、`comfy.js`、`prompts.js`、`storage.js` 等。
- 新增 `agent-tools/`（外部 Agent 工具）、`assets/`（标签数据与提示词素材）、`scripts/`（校验脚本）。

### 功能与行为

- Vision 识图一次只处理一个明确的 `imageId`，`mode` 支持 `metadata`、`local` 和 `ai`；页面、主 AI 与外部 Agent 通过同一个 Calls handler 调用。
- AI 页面提供"助手"和"绘图"两种模式；ComfyUI 未连接或工作流无效时，`comfy.render` 不会下发给主 AI。
- Calls 提供动态 capabilities 与 Agent Runtime/Admin 分组，`ai-runner.js` 统一助手/绘图工具循环。
- 外部 Agent 默认只获得 Runtime 工具（Tag、单图 Vision、可用时 Comfy 渲染、提示词/Comfy 设置读取）；开启"允许外部 Agent 修改提示词和 ComfyUI 迭代设置"后才会出现 Admin 工具。
- ComfyUI 工作流提交前按采样器连接关系覆盖固定的正/负向 Tag、尺寸、steps、CFG 等节点；无法定位可写节点时返回明确错误。
- 本地识图与离线翻译模型不随源码入库（`models/` 已忽略），模型缺失时页面仍可打开，本地识图会显示不可用原因。

## V1.4.1

### 新增

- 增加中英文界面与多语言国际化适配。

### 优化

- 优化 API 调用逻辑与长耗时请求处理。
- 完善相关状态提示与错误诊断。

### 注意

- 本地识图与离线翻译仍需随程序保留 `models/` 目录。
