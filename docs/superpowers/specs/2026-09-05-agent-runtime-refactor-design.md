# Agent Runtime 统一架构重构设计

**版本目标：** V1.4.193（内部迭代版）

**范围：** 将现有 AI 绘画 Tag 工具箱收敛为一个主 AI、三个固定子代理和一组固定高层工具。会话、图片、标签、提示词和 ComfyUI 领域能力继续复用稳定模块，但所有 AI 请求统一经过 Runtime。

## 架构

渲染页面只调用公开的视图和业务接口。`preload.js` 只暴露已经绑定当前会话的 Runtime、领域模块和设置读写方法，不暴露文件路径、底层 AI Client 或可变工具注册表。

`agent-runtime.js` 是唯一 AI 调度入口，提供：

```js
runtime.runPrimary(request)
runtime.runSubAgent(name, request)
runtime.callTool(name, args, context)
runtime.cancel(requestId)
runtime.getStatus(requestId)
```

Runtime 负责请求 ID、超时、取消、等待状态、统一错误对象、工具调用计数和输出 schema 校验。主 AI 只能收到 `primary-agent` 生成的固定系统提示词和 `primary-tools` 白名单；固定子代理不带会话历史，也不调用工具。

固定子代理注册表包含 `vision`、`translation` 和 `generateTags`。每个注册项声明固定提示词、输入/输出 schema、超时、直接输出选项和执行函数。子代理结果统一为 `{ ok, data, error?, requestId, usage? }`。

主 AI 工具白名单为：

- `tags.search`
- `conversation.listImages`
- `vision.processOne`
- `translation.translate`
- `agent.generateTags`
- `comfy.status`
- `comfy.validateWorkflow`
- `comfy.render`

工具实现只能通过公开领域接口访问标签、图片、会话、固定子代理和 ComfyUI。`comfy.render` 的输入只包含正向 Tag 和可选负向 Tag；宽高、Steps、CFG、Seed、Sampler、Scheduler、`batchCount` 由设置模块读取，`maxComfyCalls` 只由 Runtime 限制调用次数。

## 设置和提示词

新设置结构删除 `mode`、`task`、`comfyIters`、`maxIterations`、`agentWriteEnabled` 及旧 ComfyUI AI schema 字段。设置模块提供主 AI、Vision AI、ComfyUI 和运行限制的明确字段；不再读取或迁移旧 localStorage、旧迁移标记或旧协议。

内部提示词和外部提示词分离管理。内部提示词包含主 AI 和三个固定子代理的固定 key、默认值、schema 校验、恢复默认、导入和导出；外部提示词只作为用户可编辑的补充文本，由 Runtime 按固定顺序组装。

## UI 边界

`app-view.js` 保留 DOM 路由和事件委派，但拆出以下视图模块：会话视图、提示词视图、设置视图、Agent 状态视图和图片库视图。视图只能调用公开 Runtime/领域接口，统一显示运行中、超时、取消、工具调用和错误状态。页面只有一个 AI 对话入口，是否出图由主 AI 是否调用 `comfy.render` 决定。

## 错误、取消和安全边界

所有失败都转换为 `{ ok:false, error:{ code, message, retryable } }`。Runtime 在超时或取消时终止当前请求并清理状态；工具调用达到 `maxComfyCalls` 时返回 `COMFY_CALL_LIMIT`. Renderer 传入的图片只能使用当前会话的 `imageId`，物理删除仍需通过图片仓库引用计数检查。

## 删除和保留

删除 `src/migrate.js`、`src/modules/config-migration.js`、`src/modules/calls/server.js`、`agent-tools/`、旧外部 Agent 协议和旧模式分支。保留标签、图片仓库、Vision 本地模型、ComfyUI 工作流内部实现以及现有页面功能；在新接口下重新接线。

## 验收

1. `npm run check` 只验证新 Runtime、固定子代理、工具白名单、设置/提示词新格式和 UI 边界，不再验证迁移、外部 Agent 或旧模式。
2. 页面源码中不存在 `mode === 'draw'`、`task === 'comfy'`、绘图模式切换或旧 ComfyUI AI schema。
3. 三个固定子代理均可通过 `runtime.runSubAgent` 执行，主 AI 只能看到八个白名单工具。
4. 统一 Runtime 覆盖 AI 请求、工具循环、等待、超时、取消、错误和调用上限。
5. Electron 可启动，图片读取、Vision、翻译、Tag 生成、ComfyUI 状态/检查/出图均可由公开接口完成。
6. 版本标识在 `package.json`、`VERSION.txt`、`index.html`、Electron 标题、桌面目录名和 exe 文件名中统一为 `V1.4.193`。
