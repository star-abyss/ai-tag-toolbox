# Automatic Generation Orchestrator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a program-controlled 1-to-3 candidate generation workflow with source-image inspection, structured evaluation, prompt revision, best-candidate selection, and exact prompt delivery.

**Architecture:** Add a persistent `GenerationOrchestrator` behind high-level primary tools. It calls four fixed subagents and internal ComfyUI tools while the primary AI receives only compact job results. Prompt sets and workflow profiles gain versioned evaluation/reference-image fields with backward-compatible migration.

**Tech Stack:** Electron, CommonJS, native `fetch`/`FormData`, existing Assistant/Agent Runtime, ComfyUI API, Node test, jsdom.

**Spec:** `docs/superpowers/specs/2026-09-08-generation-orchestrator-design.md`

## Global Constraints

- Main AI remains responsible for conversation and high-level dispatch only.
- `evaluateImages` shares the existing vision API and does not add API settings.
- Successful candidate count and render attempt count remain separate.
- Image bytes, API keys, absolute paths, and full workflows never enter primary AI history or exported logs.
- Existing prompt v1/v2 bundles, prompt sets, ComfyUI profiles, chat, translation, and single-image vision remain compatible.
- Each production change starts with a failing focused test; run `npm run check` before every deliverable commit.
- Internal versions are committed in Chinese and are not pushed; the final desktop package is the last internal version.

---

### Task 1: Prompt Set V3 And Evaluation Prompt

**Files:**
- Create: `assets/提示词素材/12-候选图评估提示词-CANDIDATE_EVALUATION.txt`
- Modify: `src/modules/prompts.js`
- Modify: `src/views/prompt-view.js`
- Modify: `src/index.html`
- Modify: `src/modules/prompts.README.md`
- Modify: `tests/prompts-contract.test.cjs`
- Modify: `tests/prompts-composition.test.cjs`
- Modify: `tests/ui-dom.test.cjs`

**Interfaces:**
- Produces prompt key `candidateEvaluation` and `prompts.composeEvaluation()`.
- Prompt bundle format remains `ai-tag-prompts`, with `version: 3`.
- V1/V2 imports normalize all sets to six keys without replacing existing text.

- [x] **Step 1: Write failing migration and UI tests**

```js
assert.deepEqual(prompts.keys(), ['primary', 'generateTags', 'artistQuality', 'vision', 'candidateEvaluation', 'translation']);
assert.equal(prompts.exportBundle().version, 3);
assert.match(prompts.get('candidateEvaluation'), /候选|评价/);
assert.equal(importedV2.sets[0].items.primary, 'user primary');
assert.match(importedV2.sets[0].items.candidateEvaluation, /候选|评价/);
assert.ok(document.querySelector('#psCandidateEvaluation'));
```

- [x] **Step 2: Run the prompt and DOM tests and verify they fail because the sixth key and field are absent**

Run: `node --test tests/prompts-contract.test.cjs tests/prompts-composition.test.cjs tests/ui-dom.test.cjs`

- [x] **Step 3: Implement V3 normalization, aliases, composition, prompt asset, editor field and six-item copy**

```js
const PROMPT_ITEM_KEYS = Object.freeze([
  'primary', 'generateTags', 'artistQuality', 'vision', 'candidateEvaluation', 'translation'
]);
function composeEvaluation() { return get('candidateEvaluation'); }
```

- [x] **Step 4: Run focused tests and `npm run check`**

- [x] **Step 5: Commit**

```powershell
git commit -m "V1.4.215：新增候选图评估提示词"
```

### Task 2: Fixed Multi-Image Evaluation Subagent

**Files:**
- Create: `src/modules/candidate-evaluator.js`
- Modify: `src/modules/fixed-subagents.js`
- Modify: `src/modules/index.js`
- Modify: `src/modules/assistant.js`
- Modify: `scripts/check.mjs`
- Create: `tests/candidate-evaluator.test.cjs`
- Modify: `tests/runtime-integration.test.cjs`

**Interfaces:**
- Produces fixed subagent `evaluateImages`.
- Input: `{ operation, mode, brief, sourceImageId?, candidateImageIds, previousEvaluations? }`.
- Output for review: `{ operation:'review', evaluations:[CandidateEvaluation] }`.
- Output for compare: `{ operation:'compare', recommendedCandidateId, ranking, reason }`.

- [x] **Step 1: Write failing tests for review, compare, invalid candidate IDs, JSON repair retry and image redaction**

```js
const result = await runtime.runSubAgent('evaluateImages', {
  input: { operation: 'compare', mode: 'create', brief: { requirements: 'blue hair' }, candidateImageIds: ['a', 'b'] }
});
assert.equal(result.data.recommendedCandidateId, 'b');
assert.deepEqual(result.data.ranking.map(row => row.candidateId), ['b', 'a']);
assert.equal(providerMessages[0].filter(part => part.type === 'image_url').length, 2);
```

- [x] **Step 2: Run the focused tests and verify `SUBAGENT_UNAVAILABLE`**

Run: `node --test tests/candidate-evaluator.test.cjs tests/runtime-integration.test.cjs`

- [x] **Step 3: Implement evaluator schemas, fixed protocol, authorized multi-image resolution and normalized outputs**

```js
const EVALUATION_OPERATIONS = Object.freeze(['review', 'compare']);
const score = value => Math.max(0, Math.min(100, Number(value) || 0));
```

- [x] **Step 4: Retry malformed provider JSON once with a repair instruction; return `OUTPUT_INVALID` after the second failure**

```js
for (let attempt = 0; attempt < 2; attempt += 1) {
  const response = await visionAI.complete(messagesFor(attempt), directOptions);
  try { return normalizeEvaluation(response, input); } catch (error) { if (attempt) throw error; }
}
```

- [x] **Step 5: Run focused tests and `npm run check`**

- [x] **Step 6: Commit**

```powershell
git commit -m "V1.4.216：增加固定候选图评估子代理"
```

### Task 3: Generation Job State Machine

**Files:**
- Create: `src/modules/generation-orchestrator.js`
- Modify: `src/modules/draw-candidates.js`
- Modify: `src/modules/index.js`
- Create: `tests/generation-orchestrator.test.cjs`

**Interfaces:**
- Produces `createGenerationOrchestrator(options)` with `execute(input, context)`, `resume(input, context)`, `cancel(jobId)`, `get(jobId)`, `list()`, and `selectCandidate(jobId, candidateId, source)`.
- Dependencies: `runSubAgent`, `renderCandidate`, `preflight`, `listConversationImages`, `resolveCharacter`, `getSettings`, `getPromptSnapshot`, and storage.

- [x] **Step 1: Write failing tests for quick, auto, fixed3, retry, cancellation, needs-input and restart recovery**

```js
const result = await orchestrator.execute({ requirements: 'blue hair', mode: 'create', strategy: 'auto' }, context);
assert.equal(result.candidates.length, 2);
assert.equal(result.selectedCandidateId, 'candidate-2');
assert.equal(result.successfulRenders, 2);
assert.equal(result.renderAttempts, 2);
assert(events.some(event => event.type === 'candidate.evaluated'));
```

- [x] **Step 2: Run the new test and verify the module is absent**

Run: `node --test tests/generation-orchestrator.test.cjs`

- [x] **Step 3: Implement normalized job/policy storage and deterministic phase events**

```js
const JOB_STATES = Object.freeze(['preparing', 'compiling', 'rendering', 'evaluating', 'revising', 'selecting', 'needs_input', 'completed', 'failed', 'cancelled', 'interrupted']);
```

- [x] **Step 4: Implement successful-render and attempt budgets, one retry per AI stage, score stopping, legal recommendation fallback and prompt patch application**

```js
while (job.successfulRenders < policy.maxSuccessfulRenders && job.renderAttempts < policy.maxRenderAttempts) {
  const candidate = await renderNext(job, context);
  if (!candidate) continue;
  job.candidates = addCandidate(job.candidates, candidate);
  const evaluation = await reviewCandidate(job, candidate, context);
  if (mayStop(job, evaluation)) break;
  job.prompt = applyPromptPatch(job.prompt, await revisePrompt(job, evaluation, context));
}
```

- [x] **Step 5: Persist after every phase and turn restored `running` jobs into `interrupted` jobs**

```js
function persist(job) { jobs.set(job.jobId, clone(job)); storage?.set?.('generation_jobs', [...jobs.values()]); }
for (const job of restoredJobs) if (RUNNING_STATES.has(job.status)) job.status = 'interrupted';
```

- [x] **Step 6: Run focused tests and `npm run check`**

- [x] **Step 7: Commit**

```powershell
git commit -m "V1.4.217：实现自动迭代出图状态机"
```

### Task 4: ComfyUI Reference Image Capabilities

**Files:**
- Modify: `src/modules/comfy-profiles.js`
- Modify: `src/modules/comfy-workflow.js`
- Modify: `src/modules/comfy.js`
- Modify: `src/modules/primary-tools.js`
- Modify: `src/views/comfy-view.js`
- Modify: `tests/comfy-profiles.test.cjs`
- Modify: `tests/comfy-workflow.test.cjs`
- Modify: `tests/comfy-execution.test.cjs`

**Interfaces:**
- Profile adds `capabilities` and optional bindings `sourceImage`, `denoise`, `controlStrength`.
- `comfy.uploadImage({ bytes, filename, type }, signal)` returns `{ name, subfolder, type }`.
- Internal `comfy.render` accepts `sourceImageId` and returns `recreationMode`, exact prompt/negative, effective parameters and workflow summary.

- [x] **Step 1: Write failing migration, binding, upload and render tests**

```js
assert.equal(profile.capabilities.txt2img, true);
assert.equal(profile.capabilities.img2img, false);
assert.equal(uploadRequest.pathname, '/upload/image');
assert.equal(submittedWorkflow['12'].inputs.image, 'source.png');
```

- [x] **Step 2: Run ComfyUI tests and verify missing capability/upload behavior**

Run: `node --test tests/comfy-profiles.test.cjs tests/comfy-workflow.test.cjs tests/comfy-execution.test.cjs`

- [x] **Step 3: Add profile migration, image-input candidates, explicit reference bindings and configuration UI selector**

```js
const capabilities = { txt2img: true, img2img: false, controlImage: false, mask: false, ...source.capabilities };
const sourceImageCandidates = Object.entries(workflow)
  .filter(([, node]) => /LoadImage|ImageLoader/i.test(node.class_type))
  .map(([nodeId, node]) => ({ nodeId, input: Object.keys(node.inputs).find(key => /image/i.test(key)) }));
```

- [x] **Step 4: Implement authorized image byte upload and bind only the configured node; return `text_approximation` when no source binding exists**

```js
const uploaded = sourceImageId ? await comfy.uploadImage(await repository.getOriginalBytes(sourceImageId), signal) : null;
const recreationMode = uploaded && profile.bindings.sourceImage ? 'reference_image' : 'text_approximation';
```

- [x] **Step 5: Ensure the monitor receives only a workflow hash, changed binding names and submitted parameters**

```js
context.onEvent?.({ type: 'comfy.submitted', workflowHash, changedBindings, parameters: effectiveParameters });
```

- [x] **Step 6: Run focused tests and `npm run check`**

- [x] **Step 7: Commit**

```powershell
git commit -m "V1.4.218：支持ComfyUI参考图工作流绑定"
```

### Task 5: High-Level Primary Tools And Budget Semantics

**Files:**
- Modify: `src/modules/primary-tools.js`
- Modify: `src/modules/agent-runtime.js`
- Modify: `src/modules/request-manager.js`
- Modify: `src/modules/usage-limiter.js`
- Modify: `src/modules/settings.js`
- Modify: `src/modules/assistant.js`
- Modify: `src/modules/primary-agent.js`
- Modify: `assets/提示词素材/10-主AI固定提示词-PRIMARY_AGENT.txt`
- Modify: `tests/runtime-integration.test.cjs`
- Modify: `tests/assistant-flow.test.cjs`

**Interfaces:**
- Adds primary-visible `generation.execute` and `generation.resume`.
- Marks `agent.generateTags`, `comfy.validateWorkflow`, and `comfy.render` internal-only.
- Adds `requestManager.extend(requestId, timeoutMs)` for the generation job deadline.
- `comfyCalls` increments only after a successful render; `renderAttempts` belongs to the job.

- [x] **Step 1: Write failing tests for visible tools, one-round high-level execution, timeout extension, recoverable internal failures and successful-only Comfy count**

```js
assert(primaryTools.openAiTools().some(row => row.function.name === 'generation_execute'));
assert(!primaryTools.openAiTools().some(row => row.function.name === 'comfy_render'));
assert.equal(result.data.selectedImageId, 'img-2');
assert.equal(runtime.usageSnapshot.comfyCalls, 2);
```

- [x] **Step 2: Run integration tests and verify missing tools and old limiter behavior**

- [x] **Step 3: Wire the orchestrator into Assistant and primary tools; expose compact schemas only**

```js
generation = createGenerationOrchestrator({ storage, runSubAgent, renderCandidate, preflight, getSettings, getPromptSnapshot });
primaryTools = createPrimaryTools({ ...options, generation });
```

- [x] **Step 4: Change the primary prompt to use high-level generation tools and remove model-authored progress narration**

```text
绘图或复刻任务调用 generation.execute。不要自行循环调用 Tag、识图或 ComfyUI；程序会返回最终候选和实际提示词。
```

- [x] **Step 5: Implement deadline extension and success-only Comfy counting without weakening ordinary tool limits**

```js
context.extendRootTimeout?.(settings.generation.jobTimeoutMs);
limiter.check(rootId, 'comfy');
const result = await render();
limiter.complete(rootId, 'comfy');
```

- [x] **Step 6: Add Assistant candidate selection methods and ensure the selected candidate controls final image and prompt fields**

```js
function chooseCandidate(messageId, candidateId, source = 'user') {
  message.result.candidates = selectCandidate(message.result.candidates, candidateId, source);
  Object.assign(message.result, finalCandidate(message.result.candidates, candidateId));
  persist(); return clone(message.result);
}
```

- [x] **Step 7: Run focused tests and `npm run check`**

- [x] **Step 8: Commit**

```powershell
git commit -m "V1.4.219：接入主AI高层生成任务"
```

### Task 6: Conversation Controls And Candidate Comparison UI

**Files:**
- Modify: `src/index.html`
- Modify: `src/app.css`
- Modify: `src/app-view.js`
- Modify: `src/views/conversation-view.js`
- Modify: `src/views/settings-view.js`
- Modify: `preload.js`
- Modify: `locales/zh-CN.json`
- Modify: `locales/en-US.json`
- Modify: `tests/ui-dom.test.cjs`
- Modify: `tests/ui-architecture.test.cjs`

**Interfaces:**
- Settings fields: `generationStrategy`, `generationAutoSelect`.
- Existing candidate cards render score, issues, exact prompt and selection state.
- Program events drive compact status; no AI progress text enters the toolbar.

- [x] **Step 1: Write failing DOM tests for the three-way strategy control, auto-select, candidate scores, exact prompt copy, manual selection, stop and needs-input state**

```js
assert.equal(document.querySelector('#generationStrategy').value, 'auto');
assert.equal(document.querySelectorAll('.draw-candidate').length, 3);
document.querySelector('[data-candidate-id="candidate-2"] .draw-candidate-choose').click();
assert.equal(assistant.selectedCandidateId, 'candidate-2');
```

- [x] **Step 2: Run UI tests and verify controls/results are absent**

- [x] **Step 3: Add compact controls beside ComfyUI status and persist settings**

```html
<select id="generationStrategy"><option value="quick">快速 1 张</option><option value="auto">自动 2-3 张</option><option value="fixed3">固定 3 张</option></select>
<label><input id="generationAutoSelect" type="checkbox" checked> 自动选择最佳图</label>
```

- [x] **Step 4: Connect generation events to the existing timeline and candidate cards; show final result and horizontal comparison without nested panels**

```js
if (event.type === 'candidate.evaluated') put('#talkStatus', `候选 ${event.iteration} · ${event.score} 分`);
if (event.type === 'generation.completed') updateStreamingCandidates();
```

- [x] **Step 5: Add localized labels and responsive constraints for 980px minimum and maximized widths**

```css
.draw-candidates{grid-template-columns:repeat(auto-fit,minmax(260px,1fr))}
.generation-controls{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
```

- [x] **Step 6: Run focused tests and `npm run check`**

- [x] **Step 7: Commit**

```powershell
git commit -m "V1.4.220：完成候选图比较与简化交互"
```

### Task 7: End-To-End Verification And Desktop Package

**Files:**
- Modify: `tests/call-monitor.test.cjs`
- Create: `tests/generation-integration.test.cjs`
- Modify: `package.json`
- Modify: `VERSION.txt`
- Modify: `src/index.html`
- Modify: `main.js`
- Modify: `preload.js`
- Modify: `scripts/check.mjs`
- Modify: `deployment-verification.json`
- Create: `交付说明-V1.4.220.md`
- Modify ignored delivery script: `work/finalize-desktop.cjs`

**Interfaces:**
- Final version is `1.4.220` unless an additional corrective iteration is required.
- Desktop directory is `C:\Users\admin\Desktop\AI绘画Tag工具箱V1.4.220`.

- [x] **Step 1: Add an end-to-end local fixture test covering create, recreate, two candidates, one revision, comparison, exact prompt, monitoring and cancellation**

```js
const result = await assistant.generation.execute({ requirements: 'blue-haired girl', mode: 'create', strategy: 'auto' }, context);
assert.equal(result.successfulRenders, 2);
assert.equal(result.candidates[1].evaluation.verdict, 'accept');
assert.equal(result.positiveTags.join(', '), submittedPrompts[1]);
```

- [x] **Step 2: Run `npm run check`; require zero failures**

- [x] **Step 3: Update all version markers and rerun `npm run check`**

```powershell
npm run check
```

- [x] **Step 4: Move the previous exact-version desktop test directory to `F:\codex\desktop-backups`**

```powershell
Move-Item -LiteralPath 'C:\Users\admin\Desktop\AI绘画Tag工具箱V1.4.213' -Destination 'F:\codex\desktop-backups\AI绘画Tag工具箱V1.4.213-before220'
```

- [x] **Step 5: Build and verify source copies, `app.asar`, native dependencies and executable**

```powershell
node work/finalize-desktop.cjs
```

- [x] **Step 6: Launch the packaged Electron app against local fake AI/ComfyUI endpoints; verify 1100x800 and maximized layouts, 2-to-3 candidate flow, monitor export and source-image submission**

```powershell
node work/generation-smoke.cjs
```

- [x] **Step 7: Commit final evidence without pushing or creating a release**

```powershell
git commit -m "V1.4.220：完成自动迭代出图验收"
```
