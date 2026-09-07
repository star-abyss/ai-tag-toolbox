# AI 调用监视器与状态栏修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 为主 AI、工具和固定子代理增加本地可导出的调用监视器，并让对话顶部状态文本不会挤压 ComfyUI 调试控件。

**Architecture:** 运行时在每个调用边界生成脱敏的请求快照与输出快照，沿现有 `requestId/rootRequestId` 关联并保留最近记录。独立 call-monitor 模块通过 AsyncLocalStorage 关联实际 API 请求，日志写入独立的本地文件。Assistant 将记录暴露给只读监视器视图，视图支持按请求查看、复制和导出 JSON；对话顶部只显示固定长度的简短状态，详细事件不再写入状态栏。

**Tech Stack:** Electron preload bridge、现有 CommonJS 模块、原生 DOM/CSS、Node test + jsdom。

**Spec:** 本次对话中已确认的“外部调试监视器 + 顶部状态栏隔离”设计。

## Global Constraints

- API Key、图片 data URL/bytes、绝对路径和文件名不得进入监视器记录。
- 监视器只读，不改变主 AI、工具或子代理的执行权限。
- 现有对话历史和普通状态栏行为保持兼容；监视器记录有固定上限。
- 必跑 `npm run check`；内部版本每轮使用 `V1.4.212` 及以上，不 push。

---

### Task 1: Runtime call snapshots

**Files:**
- Modify: `src/modules/agent-runtime.js`
- Create: `src/modules/call-monitor.js`
- Modify: `src/modules/ai-client.js`
- Modify: `src/modules/assistant.js`
- Test: `tests/runtime-integration.test.cjs`

**Interfaces:**
- Produces `runtime.listCallRecords()` and `runtime.clearCallRecords()`.
- Each record contains `requestId`, `rootRequestId`, `parentRequestId`, `kind`, `startedAt`, `endedAt`, `status`, `input`, `output`, `events`, and `usage`.
- `onCallRecord` receives a cloned redacted record after each primary/tool/subagent call.

- [x] Add a failing test proving primary and subagent records include sanitized input/output and never include an API key or image payload.
- [x] Run `node --test tests/runtime-integration.test.cjs` and observe the missing record API.
- [x] Add bounded record storage, redaction helpers, and lifecycle snapshots at runtime boundaries.
- [x] Add AI client request/response metadata callbacks without changing provider payloads.
- [x] Run the focused test and the full check.
- [x] Commit as `V1.4.212：记录主AI与子代理调用快照`.

### Task 2: Monitor view and status isolation

**Files:**
- Create: `src/views/call-monitor-view.js`
- Modify: `src/index.html`
- Modify: `src/app-view.js`
- Modify: `src/views/conversation-view.js`
- Modify: `src/app.css`
- Modify: `tests/ui-dom.test.cjs`
- Modify: `tests/ui-architecture.test.cjs`

**Interfaces:**
- `AppViews.callMonitor.createCallMonitorView({ document, assistant, runtime, notify })` renders records and exposes `render`, `refresh`, `clear`, `exportJson`, and `bind`.
- The assistant page button `#openCallMonitor` opens the monitor; the monitor never mutates execution state.

- [x] Add a failing DOM test for opening the monitor, showing a redacted call and exporting JSON.
- [x] Run the focused DOM test and observe the missing view/button.
- [x] Add the monitor panel, source script, and preload-safe assistant/runtime access.
- [x] Keep the top status line to a compact label and enforce ellipsis/fixed dimensions in CSS.
- [x] Run focused UI tests and full `npm run check`.
- [x] Commit as `V1.4.213：增加AI调用监视器并隔离状态栏`.

### Task 3: Desktop package

**Files:**
- Modify: `package.json`, `VERSION.txt`, `src/index.html`, `main.js`, `preload.js`, `scripts/check.mjs`, `work/finalize-desktop.cjs`, `deployment-verification.json`

- [x] Raise the version to the final internal version and update the package metadata.
- [x] Run `npm run check` after the version update.
- [x] Move the previous desktop test directory to `F:\codex\desktop-backups`.
- [x] Generate and verify the desktop package, including `app.asar`, native dependencies, runtime, and executable.

## 实施结果（2026-09-08）

- 运行时记录：897a4ee；界面与状态栏：ede6221；脱敏补充：79a10b8。
- 原始 API 记录由统一 ai-client 边界捕获，固定子代理业务代码无需改变。
- 监视器日志独立于 assistant 会话存储，采用最近 200 条 / 12 MiB 上限。
- npm run check：80 项通过。打包后的 Electron 已在 1100×800 窗口完成状态栏、监视器、导出、持久化和脱敏烟雾检查，并保存截图证据。
- 最终使用说明见仓库根目录《交付说明-V1.4.213.md》。
