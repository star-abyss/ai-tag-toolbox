# Automatic And Manual Generation Control V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add deterministic automatic/manual generation control, preserve source truth, make user selection preemptive, and keep primary-AI payloads and usage accurate.

**Architecture:** Extend the single persistent `GenerationOrchestrator` with round-based policy and `awaiting_feedback`/`finishing` states. Add focused parsers and patch utilities so Vision, Tag revision, public DTOs, UI snapshots, and usage accounting have separate contracts.

**Tech Stack:** Electron, CommonJS, native fetch/FormData, existing Agent Runtime, ComfyUI connector, Node test, jsdom, Playwright smoke.

**Spec:** `docs/superpowers/specs/2026-09-08-generation-control-v2-design.md`

## Global Constraints

- Main AI must not inspect or rewrite source-image facts for generation tasks.
- One successful ComfyUI submission is one round; failed submissions do not consume `maxAutoRounds`.
- Manual mode runs one round per explicit user continuation.
- User final selection preempts every AI and ComfyUI stage and rejects late results.
- Full metadata, workflow, image bytes and full evaluations stay local.
- Existing V1.4.220 settings, profiles, sessions and prompt bundles migrate without data loss.
- Each task begins with a failing focused test, runs `npm run check`, and commits with the stated Chinese message.
- Do not push internal versions. Only V1.4.228 is synchronized to the desktop.

---

### Task 1: Source Truth And Vision Payloads

**Files:**
- Create: `src/modules/vision-payload.js`
- Modify: `src/modules/vision-service.js`
- Modify: `src/modules/generation-orchestrator.js`
- Modify: `src/modules/primary-tools.js`
- Modify: `src/modules/primary-agent.js`
- Modify: `assets/提示词素材/10-主AI固定提示词-PRIMARY_AGENT.txt`
- Create: `tests/vision-payload.test.cjs`
- Modify: `tests/generation-orchestrator.test.cjs`
- Modify: `tests/runtime-integration.test.cjs`

**Interfaces:**
- Produces `parseVisionPayload(value)` and `compactVisionResult(value)`.
- Generation stores immutable `originalRequirements` and structured `visualBlueprint`.
- Public `vision.processOne` omits metadata and embedded workflow data.

- [x] **Step 1:** Add failing tests for fenced/raw Vision JSON, plain-text fallback, immutable requirements, compact public Vision output and no main-AI pre-inspection instruction.
- [x] **Step 2:** Run the focused tests and verify nested JSON/metadata failures.
- [x] **Step 3:** Implement parser normalization and use it in Vision AI mode and generation preparation.
- [x] **Step 4:** Update primary prompt contracts to pass original text and source/character IDs without pre-inspection.
- [x] **Step 5:** Run focused tests and `npm run check`.
- [x] **Step 6:** Commit `V1.4.221：修正复刻原始要求与识图结构`.

### Task 2: Safe Prompt Patch Engine

**Files:**
- Create: `src/modules/prompt-patch.js`
- Modify: `src/modules/generation-orchestrator.js`
- Modify: `src/modules/fixed-subagents.js`
- Modify: `assets/提示词素材/09-固定生成Tag子代理-GENERATE_TAGS_AGENT.txt`
- Create: `tests/prompt-patch.test.cjs`
- Modify: `tests/generation-orchestrator.test.cjs`

**Interfaces:**
- Produces `applyPromptPatch(current, patch, options)` with `{ ok, positiveTags, negativeTags, rejected, warnings }`.
- Permanent `lockedTags` are caller-owned; subagent `preserve` is patch-scoped.
- Natural-language negative commands never enter positive tags.

- [ ] **Step 1:** Add failing tests for expiring preserve, locked tags, same-patch conflicts, invalid removals, negation conversion and allowed dictionary tags.
- [ ] **Step 2:** Run focused tests and verify the old accumulated-preserve behavior fails.
- [ ] **Step 3:** Implement the patch engine and bounded repair input for the Tag subagent.
- [ ] **Step 4:** Replace the orchestrator-local patch function and persist patch warnings.
- [ ] **Step 5:** Run focused tests and `npm run check`.
- [ ] **Step 6:** Commit `V1.4.222：修复Tag补丁锁定与冲突处理`.

### Task 3: Round-Based Automatic And Manual State Machine

**Files:**
- Modify: `src/modules/settings.js`
- Modify: `src/modules/generation-orchestrator.js`
- Modify: `src/modules/draw-candidates.js`
- Modify: `src/modules/primary-tools.js`
- Modify: `tests/generation-orchestrator.test.cjs`
- Modify: `tests/assistant-flow.test.cjs`

**Interfaces:**
- Settings produce `autoRun`, `imagesPerRound`, `maxAutoRounds`.
- Jobs produce `rounds`, `successfulRounds`, `awaiting_feedback` and `outcome`.
- `generation.resume({ jobId, action:'continue', baseCandidateId, feedback })` resumes manual work.

- [ ] **Step 1:** Add failing migration, multi-image round, automatic round-winner, manual pause and feedback-resume tests.
- [ ] **Step 2:** Verify the current candidate-count strategy fails them.
- [ ] **Step 3:** Implement settings migration and round normalization.
- [ ] **Step 4:** Refactor rendering so one submission may register 1–8 candidates and only the round winner drives revision.
- [ ] **Step 5:** Implement manual `awaiting_feedback` without automatic revision.
- [ ] **Step 6:** Run focused tests and `npm run check`.
- [ ] **Step 7:** Commit `V1.4.223：实现自动与手动批次生成状态机`.

### Task 4: Preemptive User Final Selection

**Files:**
- Modify: `src/modules/generation-orchestrator.js`
- Modify: `src/modules/assistant.js`
- Modify: `src/modules/comfy.js`
- Modify: `src/modules/primary-tools.js`
- Modify: `preload.js`
- Modify: `tests/generation-orchestrator.test.cjs`
- Modify: `tests/comfy-execution.test.cjs`
- Modify: `tests/assistant-flow.test.cjs`

**Interfaces:**
- Produces `generation.selectAndFinish(jobId, candidateId, source)`.
- Assistant exposes `selectGenerationFinal(messageId, candidateId)`.
- `USER_SELECTED` completes rather than cancels the job.

- [ ] **Step 1:** Add failing tests selecting during render/evaluation/revision and rejecting late artifacts.
- [ ] **Step 2:** Add a failing test that ComfyUI interrupt is invoked once.
- [ ] **Step 3:** Implement revision guards, special abort reason and atomic selection.
- [ ] **Step 4:** Wire Assistant and preload without exposing unrestricted orchestrator mutation.
- [ ] **Step 5:** Run focused tests and `npm run check`.
- [ ] **Step 6:** Commit `V1.4.224：支持最终候选抢占式结束`.

### Task 5: Generation Controls And Manual Feedback UI

**Files:**
- Modify: `src/index.html`
- Modify: `src/app.css`
- Modify: `src/app-view.js`
- Modify: `src/views/settings-view.js`
- Modify: `locales/zh-CN.json`
- Modify: `locales/en-US.json`
- Modify: `tests/ui-dom.test.cjs`
- Modify: `tests/ui-architecture.test.cjs`

**Interfaces:**
- Top controls bind `comfyOn`, `imagesPerRound`, `maxAutoRounds`, `autoRun`.
- Candidate UI emits final selection, per-image feedback and continuation commands.
- Tag details contain separate positive/negative copy actions.

- [ ] **Step 1:** Add failing DOM tests for master switch, gear, disabled max rounds, manual feedback, running action visibility and Tag copy sections.
- [ ] **Step 2:** Replace the three-way strategy control with the new compact controls.
- [ ] **Step 3:** Render round grouping, feedback inputs and context-dependent candidate actions.
- [ ] **Step 4:** Connect final selection immediately and manual continuation only while idle.
- [ ] **Step 5:** Add responsive/localized styling and verify 980px/minimized and wide layouts in jsdom constraints.
- [ ] **Step 6:** Run focused tests and `npm run check`.
- [ ] **Step 7:** Commit `V1.4.225：完成双模式生成交互界面`.

### Task 6: Delivery Semantics And Recreation Geometry

**Files:**
- Modify: `src/modules/generation-orchestrator.js`
- Modify: `src/modules/primary-tools.js`
- Modify: `src/modules/comfy-workflow.js`
- Modify: `src/modules/images.js`
- Modify: `src/app-view.js`
- Modify: `src/modules/primary-agent.js`
- Modify: `assets/提示词素材/10-主AI固定提示词-PRIMARY_AGENT.txt`
- Modify: `tests/generation-orchestrator.test.cjs`
- Modify: `tests/comfy-execution.test.cjs`
- Modify: `tests/ui-dom.test.cjs`

**Interfaces:**
- Results expose `outcome`, `residualIssues`, `recreationMode`, `aspectRatioMode`.
- Reference mode derives dimensions from source ratio only when both explicit bindings are writable.

- [ ] **Step 1:** Add failing tests for `best_available`, user-selected-with-issues, text approximation labels and 1024x1520 ratio fitting.
- [ ] **Step 2:** Implement deterministic outcome classification and residual issue extraction.
- [ ] **Step 3:** Implement pixel-budget aspect fitting and explicit width/height capability checks.
- [ ] **Step 4:** Add authoritative UI delivery badges and strict primary response wording.
- [ ] **Step 5:** Run focused tests and `npm run check`.
- [ ] **Step 6:** Commit `V1.4.226：完善复刻结果语义与宽高比`.

### Task 7: Compact Public DTO And Complete Usage

**Files:**
- Modify: `src/modules/generation-orchestrator.js`
- Modify: `src/modules/agent-runtime.js`
- Modify: `src/modules/fixed-subagents.js`
- Modify: `src/modules/vision-service.js`
- Modify: `src/modules/primary-tools.js`
- Modify: `src/modules/assistant.js`
- Modify: `src/modules/usage-limiter.js`
- Modify: `tests/runtime-integration.test.cjs`
- Modify: `tests/call-monitor.test.cjs`
- Modify: `tests/generation-integration.test.cjs`

**Interfaces:**
- Produces `generation.uiSnapshot(jobId)` and `generation.publicResult(jobId)`.
- Usage exposes exact root totals and `byKind`.
- Primary tool messages omit full evaluations and metadata while Assistant UI retains them.

- [ ] **Step 1:** Add failing byte-budget and exact token-sum tests using multiple subagents.
- [ ] **Step 2:** Standardize fixed-subagent `{ data, usage }` envelopes without changing public parsed data.
- [ ] **Step 3:** Add usage kind attribution and aggregate every provider response.
- [ ] **Step 4:** Split public generation DTO from local UI state and compact public Vision output.
- [ ] **Step 5:** Run focused tests and `npm run check`.
- [ ] **Step 6:** Commit `V1.4.227：压缩AI返回并修正Token统计`.

### Task 8: V1.4.228 End-To-End Delivery

**Files:**
- Modify: `tests/generation-integration.test.cjs`
- Modify: `package.json`
- Modify: `VERSION.txt`
- Modify: `src/index.html`
- Modify: `main.js`
- Modify: `preload.js`
- Modify: `scripts/check.mjs`
- Modify: `deployment-verification.json`
- Create: `交付说明-V1.4.228.md`
- Modify ignored helpers: `work/finalize-desktop.cjs`, `work/generation-smoke.cjs`

**Interfaces:**
- Final desktop directory is `C:\Users\admin\Desktop\AI绘画Tag工具箱V1.4.228`.

- [ ] **Step 1:** Expand integration fixtures for auto multi-round, manual feedback, failed submission budget, selection during active render, compact DTO and exact usage.
- [ ] **Step 2:** Run `npm run check` with zero failures.
- [ ] **Step 3:** Update all version markers to 1.4.228 and rerun `npm run check`.
- [ ] **Step 4:** Stop V1.4.220 processes and move its desktop directory into `F:\codex\desktop-backups`.
- [ ] **Step 5:** Build and verify source mirrors, app.asar, native dependencies and V1.4.228 executable.
- [ ] **Step 6:** Run packaged Electron smoke at 1100x800 and 1500x950 against local AI/ComfyUI fixtures, including manual continuation and in-flight final selection.
- [ ] **Step 7:** Record evidence, mark every plan item complete, commit, rebuild once and verify desktop uniqueness/hash/HEAD.
- [ ] **Step 8:** Do not push or publish; stop for user manual testing.
