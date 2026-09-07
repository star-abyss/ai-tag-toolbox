# 自动与手动生成控制 V2 设计

## 目标

在现有 `GenerationOrchestrator` 上增加自动和手动两种执行策略，并修复真实运行暴露的目标漂移、Vision JSON 嵌套、Tag 补丁冲突、结果夸大、参考图能力不透明、公开载荷过大和 Token 少计问题。

主 AI 继续负责理解绘图意图、角色查询和对话；程序状态机拥有原图分析、Tag 编译与修订、ComfyUI 调用、候选评价、批次选择和停止权。用户通过界面发出的继续优化与最终选择属于明确程序命令，不允许主 AI 改写。

## 核心原则

- 只有一个状态机，通过 `autoRun` 区分自动与手动，不复制生成流程。
- 用户原始要求不可变。主 AI 只传 `originalRequirements`、`sourceImageId`、`characterIds`，不得把识图观察改写进要求。
- 一轮等于一次成功的 ComfyUI 调用；`imagesPerRound` 是该调用返回的候选数。
- `maxAutoRounds` 只限制自动模式的成功轮次；失败调用只增加 `renderAttempts`。
- 手动模式每轮完成后进入 `awaiting_feedback` 并释放对话区。
- 任意已有候选的“最终选择”拥有最高优先级，立即停止在途工作并完成任务。
- 完整图片、metadata、工作流、蓝图和评价只留在本地；主 AI 获得紧凑 DTO。

## 设置与迁移

规范化设置：

```json
{
  "comfy": { "enabled": true, "batchCount": 1 },
  "generation": {
    "autoRun": true,
    "imagesPerRound": 1,
    "maxAutoRounds": 3,
    "maxRenderAttempts": 5,
    "acceptScore": 90,
    "minImprovement": 3,
    "followSourceAspectRatio": true,
    "jobTimeoutMs": 1200000
  }
}
```

- 新安装默认 `comfy.enabled=true`；已存在设置中的显式 true/false 原样保留。
- `imagesPerRound` 范围 1–8，与 ComfyUI `batchCount` 保持单一数据源。
- `maxAutoRounds` 范围 1–3，自动关闭时界面禁用但不删除保存值。
- 旧 `quick` 迁移为 `autoRun=true,maxAutoRounds=1`；`auto` 和 `fixed3` 迁移为 `autoRun=true,maxAutoRounds=3`。旧 `autoSelect` 不再显示，自动任务结束时默认选择程序推荐；用户可随时覆盖。

## 任务状态

```text
preparing -> compiling -> rendering -> evaluating
                                  |-> autoRun: revising -> rendering
                                  |-> manual: awaiting_feedback
                                  |-> accepted/limit: selecting -> completed
                                  |-> user selection: finishing -> completed
```

新增 `awaiting_feedback` 与 `finishing`。`status` 表示执行生命周期，`outcome` 表示交付质量：

- `accepted`
- `best_available`
- `user_selected`
- `user_selected_with_issues`
- `cancelled`
- `failed`

`best_available` 用于达到成功轮数或尝试上限但所有候选仍为 `revise/reject`，或仍存在硬错误的情况。

## 任务与批次数据

```json
{
  "jobId": "job_xxx",
  "originalRequirements": "用户原话",
  "sourceImageId": "img_xxx",
  "characterIds": [],
  "autoRun": true,
  "imagesPerRound": 2,
  "maxAutoRounds": 3,
  "successfulRounds": 0,
  "renderAttempts": 0,
  "rounds": [
    {
      "roundId": "round-1",
      "submittedPrompt": {},
      "candidates": [],
      "recommendedCandidateId": ""
    }
  ],
  "selectedCandidateId": "",
  "status": "rendering",
  "outcome": ""
}
```

一次成功调用返回的全部图片归入同一 `roundId`，共享实际提示词和参数。每张图片独立 review；程序按硬错误和分数预排序，最多取前三张进行视觉 compare，并产生本轮推荐。自动修订只能基于本轮推荐候选，最终比较最多比较三个轮次推荐，避免候选数量扩大后超过视觉接口上限。

## 原始要求与视觉蓝图

生成输入：

```js
generation.execute({
  originalRequirements,
  mode,
  sourceImageId,
  characterIds
})
```

兼容读取旧 `requirements`，但立即复制到不可变 `originalRequirements`。主 AI 不得为绘图预先调用 Vision；用户单独要求“描述图片”时仍可使用公开识图。

Vision AI 输出经过 `parseVisionPayload()` 解析和 Schema 校验：

```json
{
  "tags": [],
  "description": "",
  "people": [],
  "pose": "",
  "viewpoint": "",
  "composition": "",
  "clothing": [],
  "scene": "",
  "lighting": "",
  "style": "",
  "mustPreserve": []
}
```

无效 JSON 修复一次；仍无效则使用受限纯文本 description，禁止 JSON 字符串再次嵌套。公开 `vision.processOne` 只返回 description、tags、model 和必要状态，metadata 保留在本地服务接口。

## Tag 修订

新增独立 `prompt-patch.js`。永久 `lockedTags` 只能来自用户明确硬约束；子代理返回的 `preserve` 只在当前补丁内阻止同一补丁删除，下一轮失效。

补丁必须满足：

- `remove` 只能删除当前存在且未锁定的 Tag。
- `add/remove` 不能包含同一规范化 Tag。
- 正向 Tag 禁止自然语言命令 `remove ...`、`do not ...`、`not ...`。
- `no humans` 等词库确认的合法 Tag 通过 allowlist，不做简单子串拦截。
- 负面 Tag 开启时，将否定目标转换为负面 Tag；关闭时改为正向替代表达，不把否定命令提交给模型。
- 新增动作与现有动作冲突时，修订子代理修复一次；仍冲突则保留用户硬约束并拒绝补丁。

手动继续输入：

```js
generation.resume({
  jobId,
  action: "continue",
  baseCandidateId,
  feedback
})
```

修订只使用所选候选的实际提示词、其评价和用户原话反馈。

## 自动与手动行为

自动模式：每轮 render -> review each -> compare round -> 判断停止；未停止时以本轮推荐修订一次并进入下一轮。达到阈值且无硬错误为 `accepted`；达到上限仍不合格为 `best_available`。

手动模式：只执行一轮，评价并推荐后进入 `awaiting_feedback`。用户可保存整轮点评和每图点评；只有点击继续后才修订并再执行一轮。对话输入在等待期间保持可用。

自动执行期间隐藏“继续优化”，任务完成后显示。手动等待期间显示点评与继续。两种模式始终显示“选为最终结果”。

## 抢占式最终选择

```js
generation.selectAndFinish(jobId, candidateId, source)
```

执行顺序：原子写入选择 -> 状态改为 `finishing` -> 中断状态机 controller -> 调用 ComfyUI `/interrupt` -> 丢弃所有晚到结果 -> 根据候选硬错误设置 `user_selected` 或 `user_selected_with_issues` -> 完成高层工具。

特殊中断原因 `USER_SELECTED` 不得被转换成普通 `cancelled`。每个 await 后检查 job revision/status，防止晚到图片和评价覆盖最终选择。

## 复刻能力与宽高比

- `reference_image`：配置档启用 img2img/controlImage 且 sourceImage 绑定有效，原图实际上传。
- `text_approximation`：无参考绑定仍允许文本近似，但配置区、候选区和最终结果均显示该标记。
- `followSourceAspectRatio=true` 时读取原图宽高比，并在工作流宽高绑定均可写时按 64 倍数计算目标尺寸；总像素不超过当前配置的像素预算。
- 缺少宽高绑定时保留工作流尺寸，并返回 `aspectRatioMode=workflow_fixed` 与提示，禁止宣称构图完全保持。

## 公开 DTO 与本地快照

`generation.uiSnapshot(jobId)` 返回本地完整候选和评价。`generation.publicResult(jobId)` 进入主 AI 历史：

```json
{
  "jobId": "job_xxx",
  "status": "completed",
  "outcome": "best_available",
  "recreationMode": "text_approximation",
  "selected": { "candidateId": "candidate-3", "imageId": "img_x", "positiveTags": [], "negativeTags": [], "parameters": {} },
  "candidates": [{ "candidateId": "candidate-1", "imageId": "img_x", "score": 72, "verdict": "revise", "hardErrorCount": 2, "summary": "" }],
  "residualIssues": [],
  "nextAction": ""
}
```

完整评价、comparison、promptSnapshot、metadata 和 workflow 不进入主 AI tool message。Assistant 通过本地事件的 `jobId` 获取 `uiSnapshot` 渲染候选，不依赖公开 DTO。

## Token 统计

所有固定子代理统一返回 `{ ok, data, usage }`。运行时将每次 Vision、Tag、评价与主 AI usage 加入同一根任务，并保留分类：

```json
{
  "total_tokens": 115263,
  "byKind": { "primary": 75940, "vision": 1939, "generateTags": 23564, "evaluateImages": 13820 }
}
```

调用监视器继续记录单次 exchange usage，根汇总必须等于各 exchange usage 之和。

## 最终回复

程序提供权威交付标记，界面始终显示：outcome、recreationMode、硬错误数量、残留问题和实际提示词。主 AI 提示词要求：

- `best_available` 使用“达到上限后的最佳候选”，禁止“完全一致/保持不变”。
- `text_approximation` 明确说“文本近似复刻，原图未进入工作流”。
- `user_selected_with_issues` 明确说“用户已选择，仍存在以下已知问题”。

即使模型措辞不合规，程序生成的状态条和候选信息仍作为权威结果显示。

## 验收

- 自动模式支持每轮多图、最多三轮、本轮最佳驱动下一轮修订。
- 手动模式一轮后释放输入，可保存整轮/单图点评并继续。
- 任意阶段点击最终选择会中断在途 ComfyUI 且不接收晚到结果。
- 原始教堂/POV 等源图事实不被主 AI 改写；Vision JSON 不嵌套。
- 不出现互斥动作或 `remove/no/not` 自然语言命令正向 Tag。
- 全部不合格时返回 `best_available`，文本近似和固定宽高明确展示。
- 主 AI公开载荷保持紧凑；根 Token 与各 API exchange 求和一致。
- 旧设置、提示词、工作流配置档、普通识图与翻译继续兼容。

