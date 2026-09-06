# ComfyUI 配置工作区与复杂工作流设计

## 目标

把 ComfyUI 设置从 API 页独立为 ComfyUI 配置工作区。用户首次导入工作流时完成一次分析和节点确认，之后主 AI 只提交正向/负向 Tag，ComfyUI 模块根据当前配置档写入工作流、提交任务并回收结果。

## 已确认边界

- 主 AI 不理解、不保存、不传输节点 ID 和完整工作流；它只负责对话、生成 Tag、调用 `comfy.render`。
- 工作流负责 LoRA、ControlNet、区域条件、相机、多阶段采样和其他复杂结构。
- ComfyUI 配置页负责地址、连接状态、工作流导入、节点绑定、覆盖开关、配置档和调试信息。
- 默认只允许覆盖正向提示词和负向提示词；尺寸、采样、Seed、批量数量和模型等参数默认由工作流决定。
- 未确认的节点不自动修改；无法识别的结构显示为需要手动绑定。
- 第一版继续使用 `/prompt`、`/history/{prompt_id}`、`/queue`、`/interrupt` 和 `/view`，WebSocket 作为后续实时进度增强，不阻塞本次配置改造。
- 不删除现有工作流内容。每次执行都从保存的原始工作流深拷贝生成临时提交对象。

## 页面结构

AI 工作台页签调整为：

```text
AI 对话 | 提示词 | API 设置 | ComfyUI
```

对话区左上角“调试”按钮跳转到 ComfyUI 页签，并刷新连接与当前配置状态。ComfyUI 页签包含：

1. 状态区：连接、ComfyUI 版本、显卡摘要、队列数量、当前配置和最近错误；提供测试连接、刷新状态、打开 ComfyUI 页面。
2. 配置档区：当前配置选择、新建、复制、重命名、删除、导入/导出配置。
3. 导入区：API JSON 文件、PNG 工作流、粘贴 JSON、原始 JSON 折叠编辑器。
4. 分析区：节点数量、兼容等级、采样器、提示词分支、输出节点和缺失自定义节点摘要。
5. 绑定区：正向提示词、负向提示词、主采样器、尺寸、批量数量和输出节点候选。普通显示使用节点标题、类型和 ID，技术路径只在高级信息中显示。
6. 覆盖区：正向、负向、尺寸、步数/CFG、Seed、采样器/Scheduler、批量数量和模型开关。正向/负向默认开启，其余默认关闭。
7. 保存与诊断区：保存并设为当前、仅保存、重新分析、测试工作流、恢复上一版本，并显示可读错误。

API 页只保留主 AI API、识图 API、模型连接测试和通用运行限制。ComfyUI 地址和所有工作流参数从 API 页移出。

## 导入与分析

支持 ComfyUI API 格式 JSON 和包含 API 工作流元数据的 PNG。检测到界面格式 `{ nodes, links }` 时拒绝转换并提示用户导出 API 格式。导入流程为：读取、解析、验证、分析、生成候选绑定、等待用户确认、保存配置档。

分析器调用 `/object_info` 获取节点定义，但只分析当前工作流实际出现的类。它输出节点摘要、候选绑定和风险：

- 标准：一个主采样器、清晰的正负文本分支、标准尺寸和图片输出。
- 高级：多采样器、多条件分支、LoRA、ControlNet、放大或自定义节点，需要用户确认候选。
- 手动绑定：无法确认采样器、提示词或输出，保存前必须完成必要绑定。

采样器候选包括 `KSampler`、`KSamplerAdvanced`、`SamplerCustom`、`SamplerCustomAdvanced` 以及通过节点定义识别为采样器的自定义类。提示词候选沿采样器的 `positive`/`negative`/`conditioning`/`text` 语义连接查找；尺寸候选支持标准 latent 输入和自定义节点中明确的 width/height 字段。输出候选至少支持 `SaveImage`、`PreviewImage`、动画/视频/音频/3D 保存节点，并保留节点类型和文件信息。

## 配置档数据结构

```js
{
  id: 'profile-anima-main',
  name: 'Anima 主图',
  base: 'http://127.0.0.1:8188',
  workflow: {},
  analysis: { level: 'standard', nodeCount: 12, missingClasses: [] },
  bindings: {
    positive: [{ nodeId: '6', input: 'text' }],
    negative: [{ nodeId: '7', input: 'text' }],
    sampler: '42',
    width: { nodeId: '5', input: 'width' },
    height: { nodeId: '5', input: 'height' },
    batchCount: { nodeId: '5', input: 'batch_size' },
    outputs: ['68']
  },
  overrides: {
    positive: true,
    negative: true,
    width: false,
    height: false,
    steps: false,
    cfg: false,
    seed: false,
    sampler: false,
    scheduler: false,
    batchCount: false,
    ckpt: false
  },
  outputPolicy: 'selected',
  updatedAt: 0
}
```

The legacy single `comfy.workflow` setting migrates into a `default` profile. Existing values remain usable. Profiles are stored in settings under a versioned `comfy.profiles` object with `activeProfileId`; invalid profiles are reported and do not silently replace a valid active profile.

## Execution

`comfy.render({ prompt, negative })` resolves the active profile, clones its workflow, applies only bindings whose override is enabled, validates the resulting API workflow, and posts `{ prompt: workflow, client_id }` to `/prompt`. It waits for the returned `prompt_id`, reads `/history/{prompt_id}`, and collects selected or all configured output nodes according to `outputPolicy`. Image outputs continue through the existing image repository. Other file types are returned as typed artifacts and are not forced into the image store.

The existing structural override functions remain useful for profiles imported from standard workflows, but explicit bindings take precedence. If an enabled override points to a missing node/input, execution fails before `/prompt` with the profile name and binding path. The original saved workflow remains unchanged.

## Public module interfaces

`comfy.js` remains the facade and exposes:

```js
createComfy(options)
comfy.status(options)
comfy.objectInfo(classPattern, signal)
comfy.analyze(workflow, options)
comfy.importWorkflow(value, options)
comfy.profiles()
comfy.activeProfile()
comfy.saveProfile(profile)
comfy.deleteProfile(id)
comfy.setActiveProfile(id)
comfy.validateProfile(id)
comfy.render({ prompt, negative, signal, onProgress })
```

Pure workflow operations may live in `comfy-workflow.js`; HTTP operations may live in `comfy-transport.js`; profile normalization and migration may live in `comfy-profiles.js`. Existing imports from `modules/index.js` remain valid through the facade.

## Error handling

Errors name the layer and, where possible, the node:

- invalid JSON/API format: ask for API export;
- missing custom node: list missing class names;
- ambiguous binding: require one user selection;
- stale binding: name profile, node ID and input;
- ComfyUI connection failure: show configured URL and connection hint;
- execution failure: show node ID, node type, exception text and available history details;
- unsupported output: preserve the file reference and explain that image preview is unavailable.

## Performance

`/object_info` is cached per ComfyUI base URL for five minutes. The UI receives current-workflow summaries, not the full 2564-node response. Workflow analysis runs only on import, explicit re-analysis, or a failed binding validation. Render calls clone the profile workflow once and do not rebuild the analysis index.

## Acceptance criteria

- The API page no longer owns ComfyUI controls.
- The AI debug button opens the ComfyUI configuration page.
- A standard workflow imports and saves without manual node-path editing.
- The current Anima workflow identifies its KSamplerAdvanced, positive/negative text, latent dimensions and SaveImage output.
- A multi-sampler workflow presents candidates and requires one selection.
- Default rendering changes only enabled prompt bindings.
- Unknown custom nodes remain in the workflow and are reported.
- Legacy `comfy.workflow` settings migrate into one profile.
- `npm run check` covers analysis, profile migration, explicit binding, prompt-only defaults, stale binding errors and the new page route.
