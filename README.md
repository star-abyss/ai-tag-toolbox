# AI 绘画 Tag 工具箱 V1.4.131

这是一次简洁模块化重写的本地测试版，页面外观沿用 V1.4.2 的使用习惯，业务代码不再依赖旧版脚本链。

## 当前结构

- `main.js`：Electron 启动入口
- `preload.js`：加载并注入业务模块的薄桥接
- `src/index.html`、`src/app.css`、`src/app.js`：页面与 UI 入口
- `src/modules/tags.js`：标签目录与标签状态
- `src/modules/images.js`：图片对象与 PNG 元数据基础能力
- `src/modules/vision.js`：本地 WD EVA02 识图适配
- `src/modules/vision-service.js`：统一单图 Vision Service（`vision.processOne`）
- `src/modules/translation.js`：本地翻译与 Tag 参考匹配
- `src/modules/assistant.js`：统一 AI、会话和助手/绘图任务上下文
- `src/modules/ai-runner.js`：助手/绘图共用的 AI 与 Calls 工具循环
- `src/modules/comfy.js`：ComfyUI 连接与工作流处理
- `src/modules/prompts.js`、`src/modules/storage.js`：提示词素材与轻量存储
- `assets/`：标签数据和提示词素材

Vision 识图一次只处理一个明确的 `imageId`，`mode` 支持 `metadata`、`local` 和 `ai`；页面、主 AI 与外部 Agent 通过同一个 Calls handler 调用。

AI 页面现在提供“助手”和“绘图”两种模式。ComfyUI 未连接或工作流无效时，`comfy.render` 不会下发给主 AI；绘图模式只有勾选实际出图时才会请求渲染。

阶段 4–8 已完成：Calls 提供动态 capabilities 与 Agent Runtime/Admin 分组，`src/modules/ai-runner.js` 统一助手/绘图工具循环；用户界面只显示助手和绘图，Comfy 渲染是绘图上下文中的可选工具。旧生成/复刻/迭代入口、Vision 别名和文本 Comfy 协议已移除；旧会话恢复时只做一次性模式映射。

外部 Agent 默认只获得 Runtime 工具（Tag、单图 Vision、可用时 Comfy 渲染、提示词/Comfy 设置读取）。打开“允许外部 Agent 修改提示词和 ComfyUI 迭代设置”后才会出现 Admin 工具。

运行 `npm run check` 可执行快速语法和核心素材检查；`npm run dev` 需要 Electron 依赖。

ComfyUI 工作流在提交前会按采样器连接关系覆盖固定的正/负向 Tag、尺寸、steps、CFG 等节点；无法定位可写节点时会返回明确错误，不会把旧参数当作成功执行。单图识图模块在标签主页面和 AI 页面复用同一实例，入口与折叠控制保持在模块内部。桌面包由打包脚本复制 Electron 运行时、模型和 `resources/app` 源码目录生成。模型缺失时标签库和普通页面仍可打开，本地识图会显示不可用原因。
