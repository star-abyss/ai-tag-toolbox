# ComfyUI Configuration Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with verification checkpoints.

**Goal:** 将 ComfyUI 从 API 设置中独立出来，支持一次导入确认复杂工作流节点，之后主 AI 只提交提示词并由当前配置档执行。

**Architecture:** 保留 `comfy.js` 作为门面，新增纯工作流分析和配置档边界；配置页管理地址、状态、导入、绑定和覆盖开关；Runtime 继续只向主 AI 暴露 `comfy.render`，渲染时复制当前配置档并按显式绑定修改工作流。第一阶段仍使用 ComfyUI HTTP API，WebSocket 延后。

**Tech Stack:** Electron 31、CommonJS、原生 DOM、JSON、ComfyUI HTTP API、node:test、JSDOM。

**Spec:** `docs/superpowers/specs/2026-09-07-comfyui-config-design.md`

## Global Constraints

- 主 AI 不理解、不保存、不传输节点 ID 和完整工作流；它只负责对话、生成 Tag、调用 `comfy.render`。
- 默认只允许覆盖正向提示词和负向提示词；尺寸、采样、Seed、批量数量和模型等参数默认由工作流决定。
- 未确认的节点不自动修改；无法识别的结构显示为需要手动绑定。
- 第一版继续使用 `/prompt`、`/history/{prompt_id}`、`/queue`、`/interrupt` 和 `/view`，WebSocket 作为后续实时进度增强。
- 不删除现有工作流内容。每次执行都从保存的原始工作流深拷贝生成临时提交对象。
- 每个小步骤完成运行 `npm run check`，提交信息使用 `V版本号：说明`，内部版本不 push。
- 不跑 `--uitest`、`--smoke`、`--i18ntest` 或 `test:regression` 慢测试；ComfyUI 核心链路只在针对性单测中使用伪造 HTTP 响应。
- 桌面同步在本轮最终停下时进行，桌面只保留最终测试版，并复制完整 Electron 根目录运行时、`locales`、`models` 和 `resources/default_app.asar`。

---

### Task 1: Extract ComfyUI Workspace Route

**Files:**
- Create: `src/views/comfy-view.js`
- Modify: `src/index.html:92-116, 470-580`
- Modify: `src/app-view.js:124-132, 2920-3040, 3370-3405`
- Modify: `src/app.css`
- Modify: `locales/zh-CN.json`
- Modify: `locales/en-US.json`
- Test: `tests/ui-dom.test.cjs`
- Test: `tests/ui-architecture.test.cjs` or the existing matching UI architecture test file

**Interfaces:**
- Consumes: `assistant.getSettings`, `assistant.setSettings`, `comfy.status`, `comfy.workflowStatus`, `comfy.importWorkflow` when available.
- Produces: `createComfyView({ document, comfy, assistant, notify, openExternal, autoBind })`, with `render()`, `refresh()`, `snapshot()` and a `comfy` AI tab route.

- [ ] **Step 1: Write the failing DOM test**

Add a JSDOM test that boots the application and asserts:

```js
app.view.route('ai');
app.view.showAi('comfy');
assert.equal(app.window.document.querySelector('#tabComfy').style.display, '');
assert.equal(app.window.document.querySelector('#tabApi').style.display, 'none');
app.window.document.querySelector('#talkComfyDebug').click();
assert.equal(app.window.document.querySelector('#tabComfy').style.display, '');
```

The same test must assert that `#comfyBase`, `#comfyWf`, and the old ComfyUI controls are not rendered under `#tabApi`.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `node --test tests/ui-dom.test.cjs`

Expected: FAIL because `#tabComfy`, the ComfyUI tab, and the debug navigation do not exist.

- [ ] **Step 3: Add the ComfyUI tab and view factory**

Move the ComfyUI controls from the API details block into a new `<div id="tabComfy" data-comfy-view="true" style="display:none">`. Add a tab button with `data-panel="comfy"`, a back button, and stable IDs for status, profile selector, import actions, analysis summary, bindings and overrides. Create `src/views/comfy-view.js` with a renderer that only reads/writes the public interfaces and leaves the existing workflow text as an advanced field.

Update `showAi()` to recognize `comfy`, update the tab strip, render the ComfyUI view, and update `route('ai')` state. Change `#talkComfyDebug` from a toast-only handler to `showAi('comfy')`.

- [ ] **Step 4: Add concise bilingual labels and layout rules**

Add labels for the new tab, status actions, import actions and back action. Keep the existing button classes and use a full-width configuration surface instead of nested cards. Ensure the page can scroll independently at narrow widths.

- [ ] **Step 5: Run focused and full checks**

Run: `node --test tests/ui-dom.test.cjs` and `npm run check`.

Expected: the new route test passes and all existing tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/views/comfy-view.js src/index.html src/app-view.js src/app.css locales tests
git commit -m "V1.4.204：拆出 ComfyUI 配置工作区"
```

### Task 2: Add Versioned ComfyUI Profiles and Legacy Migration

**Files:**
- Create: `src/modules/comfy-profiles.js`
- Modify: `src/modules/settings.js:1-120`
- Modify: `src/modules/comfy.js:518-556, 785-808`
- Modify: `src/modules/index.js`
- Test: `tests/comfy-profiles.test.cjs`
- Test: `tests/assistant-flow.test.cjs`

**Interfaces:**
- Consumes: legacy `settings.comfy.workflow`, current ComfyUI base URL and scalar settings.
- Produces: `createComfyProfiles({ storage, initial })` with `list()`, `get(id)`, `active()`, `save(profile)`, `remove(id)`, `setActive(id)`, `snapshot()`, and `migrateLegacy(settings)`.

- [ ] **Step 1: Write failing profile tests**

Create tests for:

```js
const profiles = createComfyProfiles({ storage, initial: { comfy: { workflow: legacyWorkflow } } });
assert.equal(profiles.list().length, 1);
assert.equal(profiles.active().name, '默认工作流');
assert.deepEqual(profiles.active().workflow, legacyWorkflow);
assert.equal(profiles.active().overrides.positive, true);
assert.equal(profiles.active().overrides.width, false);
```

Also test that saving a second profile, switching active profile, deleting the active profile, and loading invalid JSON leave one valid profile and a deterministic active ID.

- [ ] **Step 2: Run the profile tests and verify they fail**

Run: `node --test tests/comfy-profiles.test.cjs`

Expected: FAIL because `comfy-profiles.js` does not exist.

- [ ] **Step 3: Implement profile normalization and migration**

Store profiles under a versioned settings object:

```js
comfy: {
  profiles: { version: 1, activeProfileId: 'profile-default', items: [] },
  base: 'http://127.0.0.1:8188',
  ...legacyFields
}
```

Normalize every profile with the fields from the design spec. The default override map must enable only `positive` and `negative`. Keep `workflow` as a deep-cloned API object or string until parsed by the workflow module.

- [ ] **Step 4: Connect settings and the ComfyUI facade**

Make `normaliseSettings()` preserve or create the profile container. `createComfy()` should accept a profile provider, expose profile methods, and use the active profile’s workflow/base for existing `status()` and `render()` calls. Keep `settings.comfy.workflow` as a compatibility alias during migration so old callers still read the active profile workflow.

- [ ] **Step 5: Run tests and commit**

Run: `node --test tests/comfy-profiles.test.cjs tests/assistant-flow.test.cjs` and `npm run check`.

Commit:

```bash
git add src/modules/comfy-profiles.js src/modules/settings.js src/modules/comfy.js src/modules/index.js tests
git commit -m "V1.4.205：增加 ComfyUI 配置档与旧工作流迁移"
```

### Task 3: Implement Workflow Analysis and Compatibility Report

**Files:**
- Create: `src/modules/comfy-workflow.js`
- Modify: `src/modules/comfy.js:50-200, 273-372, 411-473`
- Test: `tests/comfy-workflow.test.cjs`

**Interfaces:**
- Consumes: parsed API workflow and optional `/object_info` node definitions.
- Produces: `parseWorkflow`, `validateApiWorkflow`, `analyzeWorkflow(workflow, options)`, `bindingCandidates(analysis)`, `collectOutputCandidates(workflow)`, `applyExplicitBindings(workflow, bindings, values, overrides)`, `validateBindings(workflow, bindings)`.

- [ ] **Step 1: Write failing analysis tests**

Cover the current Anima workflow and a multi-sampler workflow:

```js
const analysis = analyzeWorkflow(animaWorkflow);
assert.equal(analysis.level, 'standard');
assert.equal(analysis.samplerCandidates[0].nodeId, '42');
assert.deepEqual(analysis.outputCandidates.map(row => row.nodeId), ['68']);
assert.equal(analysis.promptCandidates.positive[0].nodeId, '6');
```

For a workflow with two samplers, assert `level === 'advanced'` and both samplers are returned. For `{ nodes: [], links: [] }`, assert `ready === false` and an API-format error. For an unknown custom class, assert it appears in `missingClasses` only when absent from supplied object info.

- [ ] **Step 2: Run the focused tests and verify they fail**

Run: `node --test tests/comfy-workflow.test.cjs`

Expected: FAIL because the analysis module does not exist.

- [ ] **Step 3: Implement pure graph analysis**

Move graph traversal helpers out of `comfy.js` without changing their current behavior. Add sampler class detection for `KSampler`, `KSamplerAdvanced`, `SamplerCustom`, `SamplerCustomAdvanced`, and object-info classes whose input/output names identify a sampler. Return candidates with `{ nodeId, classType, title, score, inputKeys }`.

Find all positive/negative text bindings along semantic links. Preserve every candidate; do not pick a winner in the pure analyzer. Detect standard width, height and batch fields, and gather output nodes by output type and known class names.

- [ ] **Step 4: Implement explicit binding validation and application**

Validate each saved `{ nodeId, input }` path before editing. Apply prompt values only to bindings whose override is enabled. Apply numeric and sampler overrides only when their matching switch is enabled. Throw an actionable error containing profile name, node ID and input when a binding is stale.

- [ ] **Step 5: Keep compatibility wrappers in `comfy.js`**

Export the pure functions through the existing module index and make `importApiWorkflow()` return an analysis object in addition to the existing text and inferred values. Existing `buildWorkflow()` must continue to accept old workflows while delegating analysis and explicit binding to the new module.

- [ ] **Step 6: Run checks and commit**

Run: `node --test tests/comfy-workflow.test.cjs tests/runtime-integration.test.cjs` and `npm run check`.

Commit:

```bash
git add src/modules/comfy-workflow.js src/modules/comfy.js src/modules/index.js tests
git commit -m "V1.4.206：增加 ComfyUI 工作流分析与绑定候选"
```

### Task 4: Build Import, Binding and Override UI

**Files:**
- Modify: `src/views/comfy-view.js`
- Modify: `src/app-view.js:736-766, 1390-1415, 3390-3705`
- Modify: `src/index.html` ComfyUI tab block
- Modify: `src/characters.css` only if shared variables are needed; otherwise `src/app.css`
- Test: `tests/ui-dom.test.cjs`

**Interfaces:**
- Consumes: `comfy.importWorkflow`, `comfy.analyze`, `comfy.profiles`, `comfy.saveProfile`, `comfy.setActiveProfile`, `comfy.validateProfile`.
- Produces: one-time import confirmation, readable candidate selectors, override checkboxes and profile actions.

- [ ] **Step 1: Write failing UI tests**

Add tests that:

```js
app.view.showAi('comfy');
app.window.document.querySelector('#comfyWfJson').click();
assert.equal(app.window.document.querySelector('#comfyWfJsonFile').hidden, false);
```

Stub `comfy.importWorkflow()` to return two sampler candidates and assert the page shows two readable choices, not raw paths. Assert prompt and negative override checkboxes are checked while width, height, steps, cfg, seed, sampler, scheduler, batch count and model are unchecked.

- [ ] **Step 2: Run the UI tests and verify they fail**

Run: `node --test tests/ui-dom.test.cjs`

Expected: FAIL because the new controls and state wiring are missing.

- [ ] **Step 3: Implement profile selector and import flow**

Implement file and paste import using existing `readJson`, PNG metadata parsing and `comfy.importWorkflow`. Show analysis results and keep the raw JSON in the advanced editor. Selecting a candidate updates only the draft profile; saving persists it and optionally makes it active.

- [ ] **Step 4: Implement readable binding selectors**

Render sampler, positive, negative, size, batch and output candidates with title fallback order `_meta.title`, class type, node ID. Store explicit bindings as node ID/input pairs. If a required binding is absent, show the error and disable “保存并设为当前” until the user chooses a valid candidate.

- [ ] **Step 5: Implement override switches and profile actions**

Render the override map from the profile. Changing a switch updates the draft only; saving persists it. Add new, duplicate, rename, delete, import and export profile actions. Deleting the active profile selects the remaining profile deterministically.

- [ ] **Step 6: Run full checks and commit**

Run: `node --test tests/ui-dom.test.cjs` and `npm run check`.

Commit:

```bash
git add src/views/comfy-view.js src/app-view.js src/index.html src/app.css locales tests
git commit -m "V1.4.207：增加 ComfyUI 工作流导入绑定界面"
```

### Task 5: Route Rendering Through Explicit Profiles

**Files:**
- Modify: `src/modules/comfy.js:535-686`
- Modify: `src/modules/primary-tools.js:156-176`
- Modify: `src/modules/assistant.js:128-134`
- Modify: `src/preload.js` ComfyUI public bridge
- Test: `tests/comfy-execution.test.cjs`
- Test: `tests/runtime-integration.test.cjs`

**Interfaces:**
- Consumes: active profile, explicit bindings, override map, prompt and negative values.
- Produces: `comfy.render({ prompt, negative, signal, onProgress })` that keeps the existing primary tool contract and never sends workflow details to the primary AI.

- [ ] **Step 1: Write failing execution tests**

Use a fake `fetch` implementation and a profile with literal values. Assert:

```js
const built = comfy.buildWorkflow({ prompt: 'new prompt', negative: 'new negative' });
assert.equal(built['6'].inputs.text, 'new prompt');
assert.equal(built['7'].inputs.text, 'new negative');
assert.equal(built['5'].inputs.width, 640); // unchanged when width override is false
assert.equal(built['42'].inputs.steps, 30); // unchanged when steps override is false
```

Add a second profile with `overrides.width = true` and assert width changes. Add a stale binding test that fails before `/prompt` is called and includes node ID/input in the error.

- [ ] **Step 2: Run execution tests and verify they fail**

Run: `node --test tests/comfy-execution.test.cjs`

Expected: FAIL because rendering still relies on structural guesses and does not read profile bindings.

- [ ] **Step 3: Implement profile-aware build and output policy**

Resolve the active profile, clone its workflow, validate explicit bindings, apply prompt/negative values, then apply only enabled overrides. Keep the old structural inference as a migration fallback for profiles without bindings. Collect selected output nodes from `/history`; support `SaveImage` and `PreviewImage` first, while preserving typed file metadata for other output classes.

- [ ] **Step 4: Preserve primary tool and preload boundaries**

Keep `primary-tools.js` sending only `positiveTags` and optional `negativeTags` to `comfy.render`. Expose profile and analysis methods only under the ComfyUI configuration bridge, not under the primary AI tool schemas. Ensure settings changes call `comfy.setBase` and profile activation calls `comfy.setWorkflow` through the facade.

- [ ] **Step 5: Run targeted and full checks**

Run: `node --test tests/comfy-execution.test.cjs tests/runtime-integration.test.cjs` and `npm run check`.

Commit:

```bash
git add src/modules/comfy.js src/modules/primary-tools.js src/modules/assistant.js preload.js tests
git commit -m "V1.4.208：按配置档执行复杂 ComfyUI 工作流"
```

### Task 6: Connect Local ComfyUI Diagnostics and Error Reporting

**Files:**
- Modify: `src/modules/comfy.js`
- Modify: `src/views/comfy-view.js`
- Modify: `src/app-view.js`
- Modify: `preload.js`
- Test: `tests/comfy-diagnostics.test.cjs`

**Interfaces:**
- Consumes: `/system_stats`, `/object_info`, `/queue`, `/history/{prompt_id}`, `/interrupt`.
- Produces: cached diagnostics, queue count, missing-node report, readable execution errors and retry action.

- [ ] **Step 1: Write failing diagnostics tests**

Assert that `objectInfo()` is cached for the same base URL, `status()` includes ComfyUI version and queue counts when available, and an execution error includes node ID, node type and exception message.

- [ ] **Step 2: Run diagnostics tests and verify they fail**

Run: `node --test tests/comfy-diagnostics.test.cjs`

Expected: FAIL because version/object-info caching and structured diagnostics are not exposed to the page.

- [ ] **Step 3: Implement bounded diagnostics cache and structured errors**

Cache object info by normalized base URL for five minutes. Limit page-facing node data to current workflow classes. Parse ComfyUI status messages into `{ nodeId, nodeType, message }` and preserve the raw error only in the advanced details view.

- [ ] **Step 4: Add retry and refresh actions**

Use the existing request/abort helpers. A retry re-runs analysis or status refresh; it never silently changes the workflow or enabled overrides.

- [ ] **Step 5: Run full checks and commit**

Run: `node --test tests/comfy-diagnostics.test.cjs` and `npm run check`.

Commit:

```bash
git add src/modules/comfy.js src/views/comfy-view.js src/app-view.js preload.js tests
git commit -m "V1.4.209：增加 ComfyUI 状态诊断与错误定位"
```

### Task 7: Finalize Version, Desktop Package and Acceptance Evidence

**Files:**
- Modify: `package.json`
- Modify: `VERSION.txt`
- Modify: `src/index.html`
- Modify: `main.js`
- Modify: `preload.js`
- Modify: `scripts/check.mjs`
- Create: `交付说明-V1.4.210.md`
- Modify: `deployment-verification.json`
- Modify: `work/finalize-desktop.cjs` (ignored packaging helper)
- Test: all existing tests plus the new ComfyUI tests

**Interfaces:**
- Consumes: all public ComfyUI facade and UI route changes from Tasks 1-6.
- Produces: a versioned desktop test package with complete Electron runtime files and acceptance evidence.

- [ ] **Step 1: Add acceptance assertions before version bump**

Extend `scripts/check.mjs` to assert the ComfyUI route exists, the API tab no longer owns `comfyWf`, the facade exports profile/analyze methods, and the primary tool schema still exposes only prompt/negative inputs for `comfy.render`.

- [ ] **Step 2: Run the acceptance check**

Run: `npm run check`

Expected: FAIL until all route, facade and schema assertions are present.

- [ ] **Step 3: Update version and delivery evidence**

Set the final internal version consistently in package metadata, `VERSION.txt`, HTML title, Electron title, preload version and check script. Record the final test count, active profile migration, local ComfyUI version used for read-only verification, and known limitations in `交付说明-V1.4.210.md`.

- [ ] **Step 4: Run the full verification suite**

Run: `npm run check`.

Expected: exit code 0, all tests pass, no slow app launch tests.

- [ ] **Step 5: Commit source and evidence**

```bash
git add package.json VERSION.txt src/index.html main.js preload.js scripts/check.mjs deployment-verification.json 交付说明-V1.4.210.md
git commit -m "V1.4.210：完成 ComfyUI 配置工作区验收"
```

- [ ] **Step 6: Synchronize the desktop package**

Move the current desktop test directory to `F:\codex\desktop-backups`, run `node work/finalize-desktop.cjs`, and ensure the finalizer copies the template Electron root files, `locales`, `models`, `resources/default_app.asar`, `app/`, `resources/app/`, `resources/app.asar`, and the renamed EXE.

- [ ] **Step 7: Verify the desktop package independently**

Check:

```text
desktop package exists
three package.json versions match
ffmpeg.dll exists beside the EXE
locales contains 57 files
models contains 22 files
resources/default_app.asar exists
resources/app.asar exists
EXE starts with the final window title
desktop contains only the final V1.4.210 test directory
```

Record the archive SHA-256, source commit, source file count and test count in `build-info.json`. Do not push.

## Plan Self-Review

- Route extraction, profile migration, graph analysis, UI binding, execution, diagnostics and delivery each have a dedicated task.
- Every production change has a preceding focused failing test step and a full-check step.
- Prompt-only default behavior and explicit override behavior are tested separately.
- The primary AI boundary remains unchanged: only `positiveTags` and `negativeTags` reach `comfy.render`.
- The desktop finalizer explicitly copies Electron runtime directories that were missing from V1.4.202, preventing another DLL/white-screen package failure.
