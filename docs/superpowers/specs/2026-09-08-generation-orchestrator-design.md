# 自动迭代出图与候选评估设计

## 目标

将绘图和复刻从主 AI 自由拼接低层工具，调整为由程序状态机执行的生成任务。主 AI 负责理解用户、识别绘图意图、补充必要信息和交付结果；程序负责查询资料、识图、编译 Tag、调用 ComfyUI、评价候选、修正提示词、控制预算和选择最佳图。

## 边界

- 主 AI 通过 `generation.execute` 启动任务，通过 `generation.resume` 补充暂停任务；现有停止按钮取消当前任务。
- `GenerationOrchestrator` 是普通程序模块，不是 AI 子代理。
- 新增固定 `evaluateImages` 子代理，共用当前视觉 API 配置，不新增 API 页面字段。
- 现有 `vision` 子代理只做事实提取；`generateTags` 子代理负责初次编译和按评估结果修订；`evaluateImages` 负责单图评价和多图比较。
- 低层 `agent.generateTags`、`comfy.validateWorkflow` 和 `comfy.render` 保留为内部工具，但不再放入主 AI 的工具列表。
- 普通识图、翻译、Tag 查询和角色查询仍可由主 AI 直接调用。

## 提示词

提示词组从 5 个固定条目升级为 6 个：

1. `primary`
2. `generateTags`
3. `artistQuality`
4. `vision`
5. `candidateEvaluation`
6. `translation`

新增素材 `12-候选图评估提示词-CANDIDATE_EVALUATION.txt`。提示词包升级为 v3；读取现有 v2 状态或导入 v2 包时，为每个提示词组补入默认评估提示词，显式空字符串仍保持空白。旧内容不得被覆盖。

所有固定子代理使用“用户可编辑规则 + 程序固定输出协议”。用户可以修改评价维度和偏好，不能移除 JSON Schema、真实候选 ID 校验、可见证据要求和无结果时的失败约定。

主 AI 默认提示词移除模型生成的逐步进度文本，改为要求绘图和复刻调用高层生成工具。界面进度完全来自程序事件。

## 生成设置

新增规范化设置组：

```json
{
  "generation": {
    "strategy": "auto",
    "autoSelect": true,
    "maxSuccessfulRenders": 3,
    "maxRenderAttempts": 5,
    "acceptScore": 90,
    "minImprovement": 3
  }
}
```

策略含义：

- `quick`：生成 1 个成功候选，不强制横向比较。
- `auto`：至少 2 个、最多 3 个成功候选；达到合格分且无硬错误可停止。
- `fixed3`：尽量生成 3 个成功候选后比较。

失败的 ComfyUI 提交增加 `renderAttempts`，不增加 `successfulRenders`。达到 3 个成功候选后拒绝第 4 个成功生成任务。高层生成任务使用阶段超时，不使用主 AI `maxToolRounds` 作为内部预算；进入高层生成工具时，运行时将根请求截止时间延长到生成任务上限，避免普通对话超时提前终止 ComfyUI。

## 任务数据

```json
{
  "jobId": "job_xxx",
  "sessionId": "session_xxx",
  "mode": "create",
  "status": "preparing",
  "requirements": "用户原始要求",
  "sourceImageId": "",
  "characterIds": [],
  "brief": {},
  "policy": {},
  "promptSnapshot": {
    "setId": "prompt-set-default",
    "revision": 1,
    "items": {}
  },
  "candidates": [],
  "selectedCandidateId": "",
  "renderAttempts": 0,
  "successfulRenders": 0,
  "stopReason": ""
}
```

候选必须保存 `imageId`、迭代号、实际正向/负向 Tag、实际 ComfyUI 参数、工作流配置档 ID/修订摘要、单图评价和选择状态。最终提示词必须来自实际提交给 ComfyUI 的值。

## 高层工具

`generation.execute` 输入：

```json
{
  "requirements": "string",
  "mode": "create | recreate | auto",
  "sourceImageId": "string?",
  "sourceSlot": "integer?",
  "characterQueries": ["string"],
  "characterIds": ["string"],
  "strategy": "quick | auto | fixed3?",
  "autoSelect": "boolean?"
}
```

`generation.resume` 输入为 `jobId`，以及可选的 `sourceImageId`、`characterIds`、`workflowProfileId`、`strategy` 和 `autoSelect`。缺少原图、角色候选不唯一或工作流能力不足时，任务返回 `status: needs_input`，并保存到本地任务仓库。用户补充后从阶段边界继续。

任务完成返回：

```json
{
  "status": "completed",
  "jobId": "job_xxx",
  "selectedCandidateId": "candidate-2",
  "selectedImageId": "img_xxx",
  "selectionReason": "string",
  "positiveTags": [],
  "negativeTags": [],
  "parameters": {},
  "candidates": [],
  "artifacts": [],
  "imageIds": [],
  "stopReason": "accepted | max_successful_renders | no_improvement | quick"
}
```

## 子代理协议

`vision` 在复刻任务开始时生成紧凑 `VisualBlueprint`，只包含人物、角色特征、姿势、视角、构图、衣物、场景、光照、风格和 `mustPreserve`。完整 PNG metadata 和 ComfyUI workflow 留在本地，以引用 ID 保存，不进入主 AI 历史。

`generateTags` 支持：

- `compile`：输入 brief、角色资料、可选原图，返回完整正向/负向 Tag。
- `revise`：输入上一版 Tag 和结构化评价，返回 `add/remove/preserve` 补丁。程序应用补丁并去重，不能删除评价中已确认的保留项。

`evaluateImages` 支持：

- `review`：输入 brief、一个候选和可选原图，返回各维度分数、硬错误、问题、建议和 `accept/revise/reject`。
- `compare`：输入 2 到 3 个真实候选，横向比较并返回推荐候选 ID、排序和理由。

候选评价只依据图片和 brief。候选 ID 必须来自输入；分数限制在 0 到 100；返回无效 JSON 时自动修复重试一次，仍失败则保留候选并标记 `evaluation_unavailable`。

## 创建流程

1. 冻结提示词组和工作流配置档快照。
2. 解析/验证角色 ID；歧义时暂停。
3. 构建 brief 并调用 `generateTags.compile`。
4. 预检一次 ComfyUI；状态已包含工作流可用性，不重复调用 validate。
5. 生成候选并登记到当前会话。
6. 调用 `evaluateImages.review`。
7. 未停止且有预算时调用 `generateTags.revise`，再生成下一候选。
8. 对所有候选调用 `evaluateImages.compare`；程序先应用硬约束和分数排序，再接受合法推荐。
9. 返回最佳图片、全部候选和每张图的实际提示词。

## 复刻流程

1. 将 `sourceImageId` 或 `sourceSlot` 解析为当前会话的授权图片。
2. 一次性读取精简 metadata，并调用 `vision` 生成视觉蓝图。
3. 检查工作流配置档能力：`txt2img`、`img2img`、`controlImage`、`mask`。
4. 有 `sourceImage` 绑定时，将授权图片上传到 ComfyUI `/upload/image`，把返回文件名写入绑定节点；可选绑定 denoise/control strength。
5. 没有参考图能力时继续执行 `txt2img` 文本近似复刻，并在任务结果中返回 `recreationMode: text_approximation`，禁止承诺姿势完全一致。
6. 每轮评价同时发送原图和候选图，按角色、姿势、构图、场景、风格分别找差异。

## ComfyUI 配置档

配置档新增版本化字段：

```json
{
  "capabilities": {
    "txt2img": true,
    "img2img": false,
    "controlImage": false,
    "mask": false
  },
  "bindings": {
    "sourceImage": null,
    "denoise": null,
    "controlStrength": null
  }
}
```

现有配置档迁移为 `txt2img: true`，其余为 false。程序不得猜测复杂工作流的图片节点；用户需在 ComfyUI 配置页明确绑定。最终提交给 `/prompt` 的脱敏工作流摘要和绑定变更进入调用监视器。

## 选择规则

- 硬错误优先于综合分；存在无硬错误候选时淘汰有硬错误候选。
- `create` 默认权重：需求匹配、角色、构图、风格、技术质量。
- `recreate` 默认权重：参考相似度、角色、姿势、构图、场景、技术质量。
- 比较子代理只在真实候选中推荐；非法 ID 回退到程序最高分。
- 用户手动选择覆盖自动推荐，并更新最终提示词与图片 ID。

## 事件与交互

程序发送：`generation.started`、`source.inspected`、`prompt.compiled`、`candidate.rendering`、`candidate.ready`、`candidate.evaluated`、`prompt.revised`、`candidate.recommended`、`generation.needs_input`、`generation.completed`、`generation.failed`。

对话区提供“快速 1 张 / 自动 2-3 张 / 固定 3 张”、自动选择最佳图和当前工作流。候选图横向展示，包含评分、主要差异、实际提示词、设为最终结果和基于此图继续优化。进度由事件生成，不要求主 AI 输出进度文案。

## 错误与恢复

- 缺少原图、角色歧义和工作流能力选择进入 `needs_input`。
- AI 超时或无效 JSON在当前阶段重试一次。
- ComfyUI 瞬时失败可重试，总尝试最多 5 次；失败不清除已有候选。
- 用户取消后状态为 `cancelled`，保留成功候选。
- 无候选时任务失败；有候选但评价不可用时交付全部候选，不宣称已自动选出最佳图。
- 每阶段完成后持久化任务；重启后运行中的任务标记为 `interrupted`，允许从最近阶段继续。

## 性能与日志

- 主 AI不接收完整 metadata、workflow、图片字节或每轮内部记录。
- 识图和评价优先使用图片仓库已有缩略图；没有缩略图时使用同一授权边界下的原图，图片数据仍不进入主 AI 或日志。
- 监视器按 `jobId/stage/candidateId` 记录内部调用，错误和最终结果优先保留，不能因大字段截断而丢失。
- 工具记录的 Token 明确区分本次 API 使用量与根任务累计量。

## 验收

- 普通绘图自动生成 2 到 3 个候选并选择合法最佳图。
- 复刻任务至少完成原图蓝图、候选评价和一次定向修订；有参考图绑定时实际提交原图。
- 成功候选限制为 3，失败提交不占成功次数。
- 主 AI全程最多使用少量高层工具回合，内部迭代不触发 `TOOL_ROUND_LIMIT`。
- 旧提示词组、旧配置档、普通对话、单图识图、翻译和直接 ComfyUI 配置保持兼容。
