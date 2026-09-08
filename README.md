# AI 绘画 Tag 工具箱 V1.4.238

本地 Electron 工具，提供普通 Tag、34,122 个离线角色、单图识图、对话/图库、翻译和 ComfyUI 绘图。

完整模块关系、状态归属、工具接口、角色数据流及持久化说明见 [当前架构文档](项目当前架构与统一重构规划.md)。旧版 Calls、ai-runner、四模式和外部 Agent Server 方案已归档，不能代表当前实现。

## 主要入口

| 文件 | 职责 |
| --- | --- |
| `main.js` / `preload.js` | Electron 窗口、本地业务组装、AppModules 桥接 |
| `src/app.js` / `src/app-view.js` / `src/views/` | 页面路由、交互和子视图 |
| `src/modules/assistant.js` | 会话及生成操作门面 |
| `src/modules/agent-runtime.js` / `primary-tools.js` | 请求生命周期、工具 schema 和主 AI 工具循环 |
| `src/modules/generation-orchestrator.js` | 生图/复刻状态机、轮次预算、暂停、评价和选择 |
| `src/modules/fixed-subagents.js` / `candidate-evaluator.js` | 识图、翻译、Tag 编译修订、候选评价 |
| `src/modules/generation-guidance.js` | 用户要求、目标角色与原图观察的共享规则 |
| `src/modules/tags.js` / `characters.js` | 普通词库和独立角色资料 |
| `src/modules/images.js` / `image-repository.js` / `vision-temp-store.js` | 图片资源、引用关系及单图工作区 |
| `src/modules/comfy*.js` | ComfyUI 配置档、节点绑定、API 导入、HTTP 生成与取消 |
| `src/modules/translation.js` / `vision-service.js` | 本地翻译/Tag 参考、单图识图 |
| `src/views/translation-view.js` / `src/modules/translation-alignment.js` | 翻译请求状态、双向高亮与对照协议校验 |
| `src/modules/prompts.js` / `settings.js` / `storage.js` | 提示词组、规范配置与持久化 |
| `src/modules/call-monitor.js` | 脱敏调用输入输出、事件及用量 |

## 当前行为

- 主 AI 调度 `generation.execute/resume`；程序负责识图、Tag、ComfyUI、评价与迭代。翻译页直接运行翻译子代理。
- Tag、评价与修订子代理共享目标角色资料。外貌是可选参考，允许按人数和裁剪范围删减，不永久锁定。
- 角色歧义在对话中展示选择卡片，点击后直接用原 jobId 恢复。
- ComfyUI 独立配置页与对话控制共用批量数量和调用上限，范围 1–10；支持自动和手动点评迭代。
- 图片保持同轮横排、轮次间上下分组。用户选择最终图会终止后续工作。
- 无参考图节点绑定时标明“文本近似复刻”；匹配原图尺寸需要可写的尺寸绑定。
- V1.4.235 修复 AI 翻译按钮在空输入、切页后无法恢复的问题，并拒绝过期翻译结果回写。
- V1.4.238 修正 AI 翻译对照：关闭思维链和思考面板，忽略服务商意外返回的 reasoning；模型漏写逗号时保留有效片段关联。原文选区与译文选区都能双向高亮，复制仍为纯译文。

## 运行与验证

桌面包中双击 `AI绘画Tag工具箱V1.4.238.exe`。开发模式 `npm run dev` 需要可用的 Electron；根 package.json 不包含完整独立安装依赖清单，打包使用现有运行时模板及本地依赖。

`npm run check` 执行快速护栏、行为单元测试和 jsdom 页面测试。本轮结果见 V1.4.238 交付说明；按项目规则不额外运行启动应用的慢测试。用户配置与图片保存在 `%APPDATA%\ai-tag-toolbox-rewrite`，桌面版本目录只是程序包。对照精度由所配置 AI 决定，长文本会增加返回量；本地翻译继续使用普通译文模式。

本轮详情见 [V1.4.238 交付说明](交付说明-V1.4.238.md)。
