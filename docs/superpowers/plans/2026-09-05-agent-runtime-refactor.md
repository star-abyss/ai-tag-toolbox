# Agent Runtime 统一架构重构实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 V1.4.192 重构为统一 Agent Runtime 架构，并生成可启动的 V1.4.193 桌面测试包。

**Architecture:** 保留稳定的标签、图片仓库、Vision 模型和 ComfyUI 工作流领域模块，新增统一 Runtime、固定子代理注册表和主 AI 高层工具白名单。Preload 只暴露公开接口；页面拆出会话、提示词、设置、Agent 状态和图片库视图适配器。

**Tech Stack:** Electron、Node.js CommonJS、原生 DOM、现有本地模型与 ComfyUI HTTP 接口。

**Spec:** `docs/superpowers/specs/2026-09-05-agent-runtime-refactor-design.md`

## Global Constraints

- 版本统一为 `V1.4.193`。
- 主 AI 只能看到八个固定高层工具。
- 固定子代理为 `vision`、`translation`、`generateTags`，不带会话上下文且不调用工具。
- ComfyUI 绘图参数由设置提供，`batchCount` 与 `maxComfyCalls` 分离。
- 删除旧迁移、旧模式、旧外部 Agent 协议和旧权限分组。
- 每个阶段运行 `npm run check`，提交中文信息 `V1.4.193：...`。

---

### Task 1: 统一版本、设置和提示词入口

**Files:**
- Modify: `package.json`, `VERSION.txt`, `src/index.html`, `main.js`, `preload.js`
- Modify: `src/modules/prompts.js`, `src/modules/assistant.js`
- Remove: `src/migrate.js`, `src/modules/config-migration.js`
- Test: `scripts/check.mjs`

**Interfaces:**
- Produces `settings` with `primaryApi`, `visionApi`, `comfy`, `limits` groups and no legacy mode/iteration fields.
- Produces prompt keys `primary`, `vision`, `translation`, `generateTags`, `external`.

- [ ] 备份 `resources/app` 源码到桌面备份目录。
- [ ] 删除迁移调用和旧字段默认值，建立新设置归一化函数。
- [ ] 更新提示词默认 key、导入导出 schema 和版本显示。
- [ ] 更新检查脚本的设置/提示词断言。
- [ ] 运行 `npm run check` 并提交 `V1.4.193：统一设置与提示词结构`。

### Task 2: 建立 Agent Runtime

**Files:**
- Create: `src/modules/agent-runtime.js`
- Create: `src/modules/request-manager.js`, `src/modules/status-manager.js`
- Modify: `src/modules/ai-runner.js`, `src/modules/index.js`, `preload.js`
- Test: `scripts/check.mjs`

**Interfaces:**
- `createAgentRuntime({ primaryClient, subagents, tools, getSettings, onStatus })` returns `runPrimary`, `runSubAgent`, `callTool`, `cancel`, `getStatus`.
- Every result uses `{ ok, data, error, requestId, usage }`.

- [ ] 先为 timeout/cancel/tool-limit 写失败断言。
- [ ] 实现 request registry、AbortController、超时和统一错误转换。
- [ ] 实现主 AI 工具循环和 `maxComfyCalls` 计数。
- [ ] 将 assistant 的 AI 请求入口改为 Runtime 代理。
- [ ] 运行 `npm run check` 并提交 `V1.4.193：建立统一 Agent Runtime`。

### Task 3: 固定子代理注册表

**Files:**
- Create: `src/modules/fixed-subagents.js`
- Create: `src/modules/agents/vision-agent.js`, `src/modules/agents/translation-agent.js`, `src/modules/agents/generate-tags-agent.js`
- Modify: `src/modules/translation.js`, `src/modules/vision-service.js`, `src/modules/tags.js`, `src/modules/index.js`
- Test: `scripts/check.mjs`

**Interfaces:**
- `createFixedSubagents({ vision, translation, ai, prompts })` returns registry entries with `run(request, context)` and schemas.
- `runtime.runSubAgent('vision'|'translation'|'generateTags', request)` is the only public execution path.

- [ ] 写三个子代理 schema 和无思维链选项的失败断言。
- [ ] 实现固定提示词、输入校验和输出归一化。
- [ ] 把本地翻译与 AI 翻译收拢到 `translation-agent`。
- [ ] 将 Vision/Tag 结果接入 Runtime。
- [ ] 运行 `npm run check` 并提交 `V1.4.193：注册固定子代理`。

### Task 4: 主 AI 高层工具白名单

**Files:**
- Create: `src/modules/primary-tools.js`
- Modify: `src/modules/calls/registry.js`, `src/modules/assistant.js`, `src/modules/comfy.js`, `preload.js`
- Remove: `src/modules/calls/server.js`, `agent-tools/`
- Test: `scripts/check.mjs`

**Interfaces:**
- `createPrimaryTools({ tags, imageRepository, runtime, comfy, getSettings })` exposes exactly eight named tools.
- `runtime.callTool(name, args, context)` rejects all other names with `TOOL_UNAVAILABLE`.

- [ ] 写工具白名单和敏感字段过滤断言。
- [ ] 实现八个高层工具适配器。
- [ ] 删除 Runtime/Admin/外部 Agent 分组和 HTTP 服务。
- [ ] 将 ComfyUI render 输入收敛为 tags，设置提供绘图参数。
- [ ] 运行 `npm run check` 并提交 `V1.4.193：收敛主 AI 工具白名单`。

### Task 5: 删除助手/绘图模式

**Files:**
- Modify: `src/modules/assistant.js`, `src/modules/ai-runner.js`, `src/app-view.js`, `src/index.html`, `src/app.css`
- Test: `scripts/check.mjs`

**Interfaces:**
- `assistant.run({ text, imageIds? })` is the only conversation submission interface.
- UI has one AI conversation route; render occurs only after `comfy.render` tool call.

- [ ] 删除 mode/task 分支和绘图模式 DOM。
- [ ] 统一发送流程到 `runtime.runPrimary`。
- [ ] 保留 ComfyUI 设置面板并改名 `batchCount`/`maxComfyCalls`。
- [ ] 运行 `npm run check` 并提交 `V1.4.193：删除助手绘图模式`。

### Task 6: 拆分 UI 视图适配器

**Files:**
- Create: `src/views/agent-status-view.js`, `src/views/conversation-view.js`, `src/views/prompt-view.js`, `src/views/settings-view.js`, `src/views/gallery-view.js`
- Modify: `src/app-view.js`, `src/app.js`, `src/index.html`, `src/app.css`
- Test: `scripts/check.mjs`

**Interfaces:**
- Each view exports `createXView({ document, api, notify })` with `render(snapshot)` and event handlers.
- `app-view.js` only routes and composes views.

- [ ] 从 app-view 提取 Agent 状态与会话发送/取消渲染。
- [ ] 提取提示词、设置和图片库渲染。
- [ ] 让视图只调用公开 Runtime/领域 API。
- [ ] 运行 `npm run check` 并提交 `V1.4.193：拆分页面视图模块`。

### Task 7: 新检查脚本和删除遗留

**Files:**
- Rewrite: `scripts/check.mjs`
- Modify: `README.md`, `CHANGELOG.md`, `build-info.json`
- Remove: legacy protocol and migration references in source/docs

- [ ] 检查源码无旧模式、迁移入口、外部 Agent 服务和旧字段。
- [ ] 增加 Runtime、子代理、工具白名单、UI 边界和 Comfy 参数测试。
- [ ] 运行完整 `npm run check` 并提交 `V1.4.193：重写架构检查`。

### Task 8: Electron 验证与桌面打包

**Files:**
- Modify: root `package.json`, root `VERSION.txt`, root `main.js`, root `preload.js`
- Create: `C:\Users\admin\Desktop\AI绘画Tag工具箱V1.4.193\`

- [ ] 启动 Electron，确认窗口打开且无启动异常。
- [ ] 运行 `npm run check`，记录退出码和测试数量。
- [ ] 复制最新 `resources/app`、资源和依赖，生成 V1.4.193 exe。
- [ ] 删除旧桌面测试目录，只保留 V1.4.193。
- [ ] 检查版本文件、目录名和 exe 名称一致。
- [ ] 提交 `V1.4.193：完成 Electron 检查与桌面打包`。
