# 图片仓库与极简 AI 调用模块重构实施计划

> **For agentic workers:** 本计划需按任务逐项执行；每个任务先写失败测试、确认失败原因，再实现最小改动并提交。

**Goal:** 建立独立图片库、会话图片仓库、单图识图临时存储和精简 JSON AI 调用协议，使程序承担图片生命周期、引用解析、默认参数、权限和结果压缩。

**Architecture:** 全局图片实体只保存一次，图库与会话通过关联记录引用；右侧识图使用独立单槽临时输入。AI 只提交 `call` 与少量变量，由调用表驱动校验、补全、执行和短结果回注。

**Tech Stack:** Electron preload、Node.js CommonJS 业务模块、纯 HTML/CSS/浏览器 DOM、现有 OpenAI 兼容 AI 服务、Vision/ONNX、ComfyUI HTTP API、文件 JSON + 图片二进制存储。

**Spec:** 本文的“已确认的产品规则”“数据模型”和“调用协议”章节即实施规格；实现前不得以旧的 `talk`/`comfy` 集合语义覆盖本文规则。

## Global Constraints

- 本轮只整理设计，不修改生产代码、不改变版本号、不打包桌面程序。
- 实现时每个独立任务必须先有失败测试，运行 `npm run check` 后才能提交。
- 图片二进制、Base64、任意本地路径和完整工具响应不得进入 AI 上下文或会话 JSON。
- AI 只允许访问当前会话授权的图片；破坏性操作必须由用户确认或受明确设置控制。
- 物理删除必须经过跨图库/跨会话引用检查；稳定 `imageId` 永不因重命名或迁移改变。
- 现有 assistant 消息图片剥离规则必须保留，避免向 API 发送不合法的 assistant 图片内容。

## 已确认的产品规则

1. 独立图片库拥有自己的主页面和顶部导航入口。入口必须使用工具箱现有统一按钮模板，使用独立且可区分的颜色；未打开时显示“🖼 图片库”（英文显示“🖼 Gallery”），打开后显示“← 返回主页面”（英文显示“← Back home”）。它属于导航状态按钮，点击一次进入图库，再点击一次返回主页面。
2. AI 页面左侧侧栏拆为“对话管理”和“对话图片仓库”两部分。桌面端侧栏总宽度固定在 420px 左右，对话管理列宽 148px，图片仓库列至少 250px；窄窗口时改为上下排列或可折叠布局。普通标签页侧栏保持现有宽度。
3. 对话图片仓库默认一行两张图，可切换为一行一张；显示大小只改变视图，不改变原图。显示模式和尺寸按用户设置持久化，固定选项为 `两列/单列` 与 `紧凑/标准/大图`，不允许用户输入任意 CSS 尺寸。
4. 用户上传、拖入或粘贴到对话框，或者拖入左侧对话图片区，均进入当前对话图片仓库。图片卡片右上角提供删除按钮；点击图片卡片默认切换“下一条消息参考图”勾选状态，勾选项显示在对话输入框上方。
5. 勾选图片表示“下一条消息引用/参考这些图片”，不是无条件把整个图片库发送给 AI。发送成功后自动取消待发送状态，图片继续保留在对话仓库，用户可再次勾选复用。
6. 右侧识图区域是独立的单图临时输入区，默认最多保存一张图片，与主图片库和对话图片仓库分离。拖入图片库或对话仓库已有图片时只传递内部图片引用/地址，不复制文件、不改变待发送勾选；拖入或粘贴外部图片时写入唯一临时存储。下一张外部图片进入时取消旧请求、删除旧临时文件/Blob、释放旧 Object URL，再替换为新图。
7. 右侧识图打开时，主对话内容变暗；顶部导航、左侧对话图片仓库和右侧识图面板保持可见。左侧图片仓库保持高亮和可操作。拖入右侧识图只设置识图当前图片，不自动加入对话仓库，也不改变下一条消息勾选。
8. “清空对话”只清理消息、AI 回复、任务过程和候选选择记录；保留左侧对话图片仓库、图片元数据、识图结果和临时标题，并把所有图片的 `pending`/“下一条待发送”状态重置为 false。
9. “删除对话”默认同时删除该对话专属图片。确认框提供“保留图片到独立图片库”选项；取消删除图片时，将本对话拥有的图片关联转移到独立图片库。原本已经属于独立图片库的图片只移除本对话关联，不得误删全局原图。
10. 独立图片库支持上传、原图下载、重命名、多选、批量删除、导入、导出、发送到指定对话和单张识图。发送目标选择器默认当前活动对话；操作是加入目标对话仓库，不直接触发 AI 请求。无活动对话时先创建或让用户选择对话。
11. 独立图片库默认按加入时间排列；至少支持旧到新、新到旧两种排序。重命名只改显示名称/备注，不改变 `imageId`，不破坏任何历史引用。
12. AI 可以为当前对话图片写一个简短临时标题。临时标题属于会话图片关联，不修改独立图片库正式文件名；标题可被用户手动修改，删除会话时随会话关联处理。
13. AI 可以查询当前对话图片清单，也可以按图片编号、候选编号或临时标题读取指定图片。AI 只能访问当前会话明确可见的图片和右侧当前识图临时图，不能访问任意本地路径、其他会话或全局未授权图片。
14. AI 工具调用采用精简 JSON。AI 只填写 `call` 和调用表声明的必要变量；程序负责默认值、当前设置、图片引用解析、参数校验、权限、实际调用和结果摘要。复杂 API 参数、工作流 JSON、URL、Base64、内部 ID 映射不暴露给 AI。

## 总体架构

```text
独立图片库（Global Gallery）
        │ global 引用
        ├──────────────┐
        │              │
当前对话图片仓库      右侧识图临时输入（单图）
(Conversation Gallery) │
        │              │
        └── AI 图片上下文解析器
                │
        精简 JSON 调用解析器
                │
        调用表 / 参数补全 / 权限 / 限流
                │
        Vision、Tag 查询、ComfyUI、会话服务
                │
        结果压缩 + UI 事件 + 历史记录
```

图片实体与图片归属分离：一个物理图片实体可以被独立图片库和多个对话引用；“是否属于某个对话”“是否待发送”“是否候选图”都存储在关联记录上，而不是写死在图片实体上。

## 数据模型

### 1. 全局图片实体 `ImageAsset`

```js
{
  imageId: "img_xxx",            // 全局稳定 ID，永不因重命名改变
  filename: "original.png",      // 原始文件名
  displayName: "室内参考图",      // 用户可改的显示名
  mime: "image/png",
  width: 1024,
  height: 1024,
  source: "upload | comfy | import | agent",
  dataRef: "rewrite-images/img_xxx.bin",
  thumbnailRef: "...",
  metadata: {},
  localAnalysis: {},
  aiDescription: "",             // 可缓存的识图摘要，不等同于会话临时标题
  createdAt: "...",
  updatedAt: "..."
}
```

原图二进制不进入消息或 AI JSON；`dataRef` 指向图片存储层。识图缓存必须绑定 `imageId/tempId + model + promptVersion + analysisMode`。

### 2. 独立图库关联 `GalleryRef`

```js
{
  galleryId: "gallery_main",
  imageId: "img_xxx",
  displayOrder: 42,
  pinned: false,
  createdAt: "..."
}
```

`displayOrder` 使用加入图库时的单调序号；排序相同或迁移补号时以 `createdAt` 再以 `imageId` 作为稳定的确定性排序键。图库关联删除只解除图库归属，物理文件是否删除由全局引用计数决定。

### 3. 对话图片关联 `ConversationImageRef`

```js
{
  refId: "conv_img_xxx",          // 会话内关联 ID
  sessionId: "session_xxx",
  imageId: "img_xxx",
  slotNo: 7,                       // 单调递增，不因删除复用
  displayTitle: "第2轮生成图",
  titleSource: "system | user | ai",
  source: "upload | comfy | gallery | import",
  ownership: "conversation-owned | shared-gallery",
  messageId: "message_xxx",
  candidateId: "candidate-2",
  pending: false,                  // 下一条消息是否引用
  sent: true,
  selected: false,
  final: false,
  createdAt: "...",
  updatedAt: "..."
}
```

`slotNo` 一旦分配不复用，避免历史文本中的“图2”在删除和新增后指向另一张图。程序内部始终使用 `refId`/`imageId`，UI 和 AI 使用“图7”“候选图2”等短别名。

`ownership="conversation-owned"` 表示本对话创建的上传图或 ComfyUI 返图；`ownership="shared-gallery"` 表示从独立图库引用的图片。删除会话时前者可按用户选择物理删除或转入图库，后者只移除当前会话关联。`displayTitle` 永远是会话级临时标题；全局 `ImageAsset.displayName` 是图库级正式显示名，两者不得互相覆盖。

### 4. 右侧识图临时输入 `VisionTempInput`

```js
{
  tempId: "vision_tmp_xxx",
  ownerScope: "ui",                // 不属于任何会话或图库
  kind: "library-ref | conversation-ref | external-temp",
  imageId: "img_xxx",             // 非 external-temp 时存在
  filePath: "...",                // 仅主进程/临时区内部可见
  address: "内部地址或 Blob 引用",
  filename: "example.png",
  requestId: "vision_request_xxx",
  createdAt: "..."
}
```

`VisionTempInput` 只允许一条活动记录，属于当前窗口的 UI 状态，不随清空/删除会话转移。关闭识图不删除图库/对话图片；外部临时图在替换、应用退出或明确清理时删除。AI 只能读取当前活动的 `VisionTempInput`，不能通过 `tempId` 访问历史临时文件。

### 地址与引用解析约定

“把地址传给识图”在产品层表示传递受控的 `VisionInput` 引用，不表示把用户配置目录中的真实 Windows 路径暴露给 AI。程序根据地址类型物化为底层服务需要的形式：本地 Vision 使用 bytes/受控临时文件，远程视觉 API 使用 data URL 或明确允许的 http/https URL。AI、渲染器和页面不得提交任意文件路径；所有图片引用都先经过当前会话权限和 `VisionTempInput` 单槽校验。

图片引用解析的固定优先级为：明确 `refId` → `imageId` → 不可复用的会话 `slotNo` → `candidateId` → 唯一临时标题 → 当前 `VisionTempInput` 的 `tempId`。标题或自然语言匹配到多张图片时必须返回候选列表并暂停该调用，不得猜测。会话切换时，图片清单、pending 状态和标题上下文切换到新 `sessionId`；右侧 UI 临时输入保持独立，不自动改变新会话的待发送集合。

### 5. AI 调用记录 `CallRecord`

```js
{
  id: "call_xxx",
  sessionId: "session_xxx",
  messageId: "message_xxx",
  call: "vision | search | images | render | title",
  input: { /* 只保存 AI 提交的变量 */ },
  resolved: { /* 程序补全后的安全摘要，不含 Base64 */ },
  status: "running | done | error | cancelled",
  resultSummary: "...",
  resultRef: "...",               // 大结果/图片使用引用
  createdAt: "...",
  elapsedMs: 0
}
```

### 持久化键与边界

| 存储键 | 内容 | 清空对话 | 删除对话并删除图片 | 删除对话并保留图片 |
|---|---|---|---|---|
| `images_index` | 全局图片实体索引、元数据和物理文件引用 | 不变 | 仅移除无其他引用的实体 | 保留实体 |
| `gallery_refs` | 独立图库关联、显示名、排序和置顶 | 不变 | 不变 | 为转入图片新增关联 |
| `conversation_image_refs` | 会话图片关联、编号、标题、pending、候选关系 | 保留 | 删除本会话关联 | 删除本会话关联 |
| `sessions` | 会话消息和调用记录 | 清除当前会话正文/记录 | 删除会话 | 删除会话 |
| `gallery_preferences` | 排序、两列/单列、缩放档位 | 不变 | 不变 | 不变 |
| `vision_temp` | 仅在内存/临时目录保存当前单图输入 | 不变 | 不变 | 不变 |

`vision_temp` 不写入 `conversation_image_refs`；它属于窗口级临时状态。`conversation_image_refs` 删除前必须先计算引用计数，不能依赖集合名称推断所有权。

## 程序接口契约（实施前固定）

以下接口是模块之间的边界；实现可以使用现有 CommonJS 风格，但方法名、参数语义和返回字段必须保持一致。

### `imageRepository`

```js
listGallery({ order = "oldest", query = "", selectedIds = [] })
// => { items: ImageAsset[], total: number }

listConversation(sessionId, { includePending = true, includeDeleted = false } = {})
// => { items: ConversationImageRef[], pendingIds: string[] }

attachToConversation(sessionId, imageId, { source, messageId = "", candidateId = "" } = {})
// => ConversationImageRef（重复关联返回原记录，不复制 ImageAsset）

setPending(sessionId, refId, pending)
// => ConversationImageRef

removeFromConversation(sessionId, refId)
// => { removed: boolean, imageStillReferenced: boolean }

clearSessionContent(sessionId)
// => { removedMessages: number, retainedImages: number, resetPending: number }

deleteSession(sessionId, { retainImages = false })
// => { deletedMessages: number, deletedImages: number, promotedImages: number }

renameGalleryImage(imageId, displayName)
// => ImageAsset（imageId 不变）

promoteConversationImages(sessionId, refIds)
// => { promoted: string[], skippedShared: string[] }

referenceCount(imageId)
// => { gallery: number, conversations: number, messages: number, total: number }
```

### `visionTempStore`

```js
setLibraryReference({ imageId, address, filename = "" })
// => VisionTempInput(kind="library-ref")

setConversationReference({ sessionId, refId, imageId, address, filename = "" })
// => VisionTempInput(kind="conversation-ref")

replaceExternal({ bytes, mime, filename = "" })
// => VisionTempInput(kind="external-temp")；先取消旧请求并清理旧临时资源

current()
// => VisionTempInput | null（不返回任意历史临时文件）

resolveForVision()
// => { kind, imageId?, tempId?, bytes?, address, mime, filename }

clear({ reason = "user" })
// => { cleared: boolean }
```

### `callProtocol`

```js
extractAssistantCalls(text)
// => { visibleText: string, calls: [{ call: string, variables: object }] }

normaliseCall(call, context)
// => { ok: true, id, variables, resolvedSummary } | { ok: false, code, message }

execute(call, context)
// => { ok, callId, summary, refs, uiEvent }

planImageContext({ sessionId, userText, pendingRefIds = [] })
// => { manifest, explicitRefs, attachRefs, toolReadableRefs }
```

`extractAssistantCalls()` 只处理 AI 输出的独立 JSON 行或 `json` 代码块；`normaliseCall()` 只保留调用表声明字段；`execute()` 不把原始图片数据写入 `CallRecord`；`planImageContext()` 在 AI 请求前完成编号/标题解析，避免把整张图片仓库塞进 Prompt。

## 图片库页面与导航设计

### 导航入口

- 在现有 `header-trailing` 中、`visionBtn` 与 `favBtn` 之间增加 `galleryBtn`，保持搜索框两侧的既有排列稳定；窄屏按现有导航换行规则排列。
- 必须同时使用现有 `.btn .btn-nav .nav-action .nav-toggle` 统一模板；不得单独写一套 hover、active、focus、press 规则。
- 使用独立图库色，例如琥珀/蓝绿色，与 AI、翻译、识图区分；默认、悬停、按下、激活态都由 `--nav-accent` 派生。不得复用 AI、翻译、识图或收藏组合的默认色。
- 空闲文字：`🖼 图片库`；激活文字：`← 返回主页面`；激活态保留左侧深色强调条、较亮本体和加粗文字。
- 激活状态由统一 `syncNavAction("gallery", ui.route === "gallery")` 同步，不能在多个按钮事件中分别操作。
- 点击图库入口进入 `gallery` 路由；再次点击回到 `tags`，不清空搜索文本、Tag 选择或 AI 模式选择。

### 页面布局

```text
图库页面
┌────────────────────────────────────────────┐
│ 上传  下载  批量删除  导入  导出  排序  大小 │
│ 已选 N 张                         搜索/筛选 │
├────────────────────────────────────────────┤
│ [图片卡] [图片卡] [图片卡]                  │
│ [图片卡] [图片卡] [图片卡]                  │
└────────────────────────────────────────────┘
```

- 卡片点击切换多选状态；操作按钮必须阻止冒泡。
- 卡片右上角删除按钮只删除独立图库关联，若图片仍被对话引用，先显示引用数量和影响范围，再让用户选择“仅从图库移除”或“彻底删除”。
- 下载默认下载原图，不下载缩略图；批量下载使用压缩包并保留文件名冲突处理规则。
- “识图”按钮将卡片图片设置到右侧识图临时输入，打开识图抽屉，不改变对话待发送集合。
- 导入导出采用图片包格式：`manifest.json + images/ + thumbnails/`，避免大量 Base64 JSON；manifest 保留元数据、识图结果、生成信息和关联可选字段。

## AI 页面左侧对话图片仓库

### 布局与控件

- AI 页面左侧区域使用两列：左列为新建/会话列表，右列为当前会话图片仓库。
- 图片仓库头部显示“对话图片 N 张 / 待发送 M 张”，并提供“两列 / 单列”切换。
- 图片卡片默认两列；单列模式使用较大预览。每张卡片包含缩略图、右上角删除按钮、短编号、临时标题、来源徽章和选中态。
- 选中态采用统一按钮/卡片模板：高亮边框、勾选标记和明显的文字对比；不要只改变透明度。
- 对话输入框上方固定显示待发送图片条带，每项提供缩略图、`图N`、取消引用按钮和“清空本次引用”。
- 清空对话不清空仓库；删除对话按钮必须与清空按钮使用不同的危险色和确认语义。

### 上传、拖拽、粘贴

- `data-image-context="conversation"` 覆盖对话输入区和左侧对话图片区；两者调用同一个 `addConversationImages()`。
- 外部文件进入对话区：创建 `ImageAsset` + `ConversationImageRef`，默认 `pending=true`。
- 从独立图库拖入：复用原 `imageId`，仅创建会话关联，不复制物理文件。
- 从对话区拖入右侧识图：仅创建/更新 `VisionTempInput(kind="conversation-ref")`，不改变 `pending`。
- 在右侧识图打开时，外部文件拖入右侧：写入 `VisionTempInput(kind="external-temp")`，不创建对话关联。
- 粘贴事件根据获得焦点的上下文处理；图片卡片、图片区和右侧识图区必须可聚焦并标记清晰的上下文。
- 识图临时区一次只保留一张；多张外部图片拖入时使用第一张并给出明确提示。

### 对话清理与图片所有权

- `clearSessionContent(sessionId)`：删除消息与调用记录中的对话正文，保留 `ConversationImageRef`；所有 `pending=false`，保留标题、分析和候选绑定。
- `deleteSession(sessionId, { retainImages })`：
  - `retainImages=false`：删除本会话拥有且没有其他引用的图片实体、文件和会话关联；图库来源图片只移除本会话关联。
  - `retainImages=true`：把本会话拥有的图片加入独立图库，保留 `imageId`、显示名、分析和生成信息，再删除会话关联。
- 删除前显示数量：消息数、会话专属图片数、将保留/删除的共享图片数；操作应一次确认并可取消。
- 任何物理删除都必须经过引用计数检查；不能因删除一个会话而删除其他会话或独立图库仍引用的图片。

## 极简 JSON 调用协议

### AI 可见格式

所有调用根对象使用稳定字符串 `call`，不使用易变的纯数字编号。AI 只填写表中标为 `aiInput` 的字段。

```json
{"call":"search","query":"蓝发","precision":"standard"}
{"call":"vision","image":"图2"}
{"call":"images"}
{"call":"render","prompt":"1girl, blue hair"}
{"call":"title","image":"图2","text":"蓝发角色坐在窗边"}
```

JSON 可以单独占一行或放在 `json` 代码块中。程序只解析 AI 输出，不解析用户原文；只有根对象含有已知 `call` 且对象是独立行/代码块时才执行。普通解释中的 JSON、引用的用户文本和未知 `call` 不执行；识别并执行后从用户可见正文移除调用 JSON。第一版默认每轮只接受一个调用对象；如未来支持数组，必须限制长度并保持顺序执行。

### 调用表字段

调用表是唯一来源，至少包含：

```js
{
  id: "search",
  aliases: ["Q"],
  description: "查询 Tag",
  aiInput: { /* only AI-authored variables */ },
  defaults: { /* settings or safe constants */ },
  resolve: "resolveSearchInput",
  permission: "read",
  scope: "tag-library",
  maxPerRound: 1,
  executor: "tags.search",
  resultFormatter: "compactSearchResult"
}
```

调用表同时驱动：AI 调用规则生成、JSON 校验、默认参数、图片引用解析、权限检查、执行器、结果摘要和 UI 名称。不得在 Prompt、页面事件和底层工具中重复维护同一套参数规则。

### 第一阶段基础调用

调用表首批条目固定为以下接口；字段名是协议的一部分，新增字段必须以向后兼容方式加入，不能改变既有字段含义：

```js
[
  {
    id: "images",
    aliases: ["I", "conversation.images.list"],
    aiInput: {},
    defaults: { scope: "currentSession", filter: "all" },
    permission: "read",
    scope: "current-session",
    maxPerRound: 1,
    executor: "conversation.images.list",
    resultFormatter: "compactImageManifest"
  },
  {
    id: "vision",
    aliases: ["V", "conversation.images.read"],
    aiInput: { image: { type: "imageRef", required: true, maxLength: 80 } },
    defaults: { mode: "ai", includeLocalTags: true },
    permission: "read",
    scope: "current-session-or-current-vision-temp",
    maxPerRound: 3,
    executor: "vision.processOne",
    resultFormatter: "compactVisionResult"
  },
  {
    id: "render",
    aliases: ["R", "comfy"],
    aiInput: {
      prompt: { type: "string", required: true, maxLength: 4000 },
      negative: { type: "string", maxLength: 2000 },
      iterations: { type: "integer", min: 1, max: 10 },
      seed: { type: "integer", min: 0 }
    },
    defaults: { workflow: "settings.comfyWorkflow", iterations: "settings.comfyIters" },
    permission: "external-effect",
    scope: "current-session",
    maxPerRound: 1,
    executor: "comfy.render",
    resultFormatter: "compactRenderResult"
  },
  {
    id: "title",
    aliases: ["N", "conversation.images.setTitle"],
    aiInput: {
      image: { type: "imageRef", required: true, maxLength: 80 },
      text: { type: "string", required: true, maxLength: 40 }
    },
    permission: "conversation-metadata-write",
    scope: "current-session",
    maxPerRound: 3,
    executor: "conversation.images.setTitle",
    resultFormatter: "compactTitleResult"
  },
  {
    id: "search",
    aliases: ["Q", "tags"],
    aiInput: {
      query: { type: "string", required: true, maxLength: 120 },
      precision: { type: "enum", values: ["exact", "standard", "broad"], default: "userSetting" }
    },
    defaults: { includeAdult: "tagSetting", limit: 50, category: "currentCategory" },
    permission: "read",
    scope: "tag-library",
    maxPerRound: 1,
    executor: "tags.search",
    resultFormatter: "compactSearchResult"
  }
]
```

#### `search`：查询 Tag

```json
{"call":"search","query":"蓝发","precision":"standard"}
```

AI 变量只有 `query` 和可选 `precision`。程序自动使用用户成人标签开关、当前分类、语言、查询表、限制数量和搜索缓存。结果只返回少量 `en/zh/category` 摘要，不返回完整标签库。

#### `vision`：读取一张图片

```json
{"call":"vision","image":"图2"}
```

`image` 可为会话编号、候选编号、临时标题或 `临时图`。程序按“稳定会话关联 ID → 候选 ID → 不重复标题 → 明确错误”的顺序解析；禁止任意路径。程序再把图片地址转换为本地模型或远程 API 所需的二进制/data URL，调用现有 Vision 服务。

#### `images`：查询当前对话图片清单

```json
{"call":"images"}
```

只返回编号、标题、来源、候选编号、待发送状态和是否最终选择，不返回 Base64、文件路径或完整分析内容。

#### `render`：ComfyUI 出图

```json
{"call":"render","prompt":"1girl, blue hair"}
```

可选变量仅限经过调用表声明的 `negative`、`iterations`、`seed`。这里的 `iterations` 表示程序最多连续执行多少轮候选渲染，不是传给 ComfyUI 的底层节点字段；程序必须套用用户设置的上限并在每轮返图后更新候选关联。程序自动补齐工作流、尺寸、步数、CFG、采样器、调度器、地址和默认负面提示词；AI 不得提交工作流 JSON、节点参数或本地路径。是否自动执行由用户“允许 AI 自动出图”开关控制；关闭时变成待确认动作。

完成后图片自动加入当前对话仓库并生成候选关联，返回给 AI 的只包含候选编号、图片编号、提示词摘要和状态。

#### `title`：设置会话临时标题

```json
{"call":"title","image":"图2","text":"蓝发角色坐在窗边"}
```

标题长度限制 40 个字符，只修改当前会话关联；重复标题返回候选编号列表而不是猜测。

### 解析与执行状态机

```text
AI 完成一轮输出
  ↓
提取独立 JSON / json 代码块
  ↓
验证根对象 call 与调用表
  ↓
过滤未知字段、限制长度和数量
  ↓
解析图片别名/自然语言引用
  ↓
补齐用户设置和安全默认值
  ↓
权限与会话范围检查
  ↓
执行现有业务模块
  ↓
保存 CallRecord（不含图片二进制）
  ↓
生成短结果并加入内部 AI 上下文
  ↓
自动继续 AI 回合；无调用时结束
```

一次默认只自动执行一个调用；需要多个图片识图时由 AI 分回合请求，或调用表明确允许的有限批次。调用 JSON 和内部工具追踪不直接作为 assistant 的原生 `tool_calls` 发送，避免缺少 `id`、混入结果对象或把图片放进 assistant 消息造成 400。

### 错误、重试与限制

- 未知 `call`、缺字段、枚举错误、超过长度：返回一条短错误给 AI，不回传完整 Schema。
- 图片不存在或标题重复：返回可用编号列表，禁止猜测或访问任意路径。
- Vision/搜索的同一图片同一参数命中缓存；只在缓存缺失时调用模型。
- 每 AI 回合最多 1 次 ComfyUI、最多 3 次只读图片调用；整次任务受现有最大 AI 回合数、工具数和 Comfy 迭代数约束。
- 参数字段被服务商拒绝时，程序仅对明确的可选字段做一次安全回退；不得无限重试。
- 请求取消、窗口关闭和切换临时识图图片时，旧请求结果不得覆盖新状态。

## AI 上下文与性能规则

1. 每次请求只发送用户勾选图片、用户明确引用图片和 AI 主动读取的图片；图库中未引用图片只以短清单存在。
2. 历史消息保存 `imageId/refId`，不保存 Data URL、bytes 或完整工具返回。
3. 新一轮默认不重新附加全部历史用户图片；程序只提供轻量图片清单和缓存摘要，只有用户重新勾选、明确引用或 AI 请求读取时才附加原图。这样“清空对话后保留图片”不会导致下一条消息隐式发送全部旧图。
4. ComfyUI 每次返图只把当前候选的图片引用和压缩结果加入 AI 上下文；完整图片由图片仓库和 Vision 按需读取。
5. UI 预览优先缩略图，原图使用懒加载；图库分页/虚拟化只影响展示，不改变数据顺序。
6. AI 描述、模型 Tag、PNG 元数据和候选评价应缓存到图片/会话关联，避免重复识图。
7. 右侧 `VisionTempInput` 不属于对话消息上下文；只有用户显式要求或 AI 通过 `vision` 调用读取时才使用，读取结果不会自动勾选为下一条消息附件。

## 兼容与迁移

1. 现有 `images_index`、`rewrite-images/{imageId}.bin`、`talk`/`comfy` 集合和会话 `imageIds` 必须可读取。
2. 启动迁移时：
   - `talk` 集合中的图片创建当前默认会话关联，保持原加入顺序；
   - `comfy` 图片按现有候选/消息信息创建生成关联；无法确定会话的图片进入独立图库；
   - 旧消息中的 `imageIds` 转成 `ConversationImageRef` 引用；
   - 旧的 assistant 图片内容继续剥离，不重新写入 API assistant 消息；
   - 已有标题缺失时使用文件名或“第 N 张图片”，不改原 imageId。
3. 旧的原生工具调用仍可被程序兼容读取，但新 Prompt 只向 AI 暴露精简 JSON；兼容层把旧调用转换成调用表内部格式。
4. 导入图片包遇到重复 imageId 时建立旧 ID→新 ID 映射，并同步修改会话关联、候选关联和调用记录引用。

## 计划中的文件职责

- `src/modules/images.js`：保留全局图片实体、二进制、索引、元数据和物理删除；增加引用计数/孤立图片检查所需接口。
- 新建 `src/modules/image-repository.js`：独立图库关联、会话图片关联、pending/selected/标题/转移/批量操作和导入导出清单。
- 新建 `src/modules/vision-temp-store.js`：右侧识图单图临时存储、地址解析、替换和清理。
- 新建 `src/modules/call-table.js`：调用表、字段校验、默认值和执行器映射。
- 新建 `src/modules/call-protocol.js`：AI 输出 JSON 提取、调用执行循环、可见文本清理、错误和限流。
- `src/modules/vision-service.js`：改为接受统一 `VisionInput` 引用，不让页面或 AI 直接传任意路径；保留单图边界。
- `src/modules/calls/index.js`：作为程序内部执行注册表，接入调用表，不再向 AI 暴露冗余 schema；保留现有底层执行器。
- `src/modules/ai-runner.js`：接入精简调用协议，管理自动回合、结果摘要、工具/渲染限制和候选事件。
- `src/modules/assistant.js`：会话上下文只组装必要图片引用；保存关联 ID、临时标题和调用记录；保持 assistant 图片剥离规则。
- `src/app-view.js`：新增图库路由、导航状态、左侧对话图片仓库、待发送条带、拖拽/粘贴上下文、识图桥接和删除确认。
- `src/index.html`：新增图库导航按钮、图库主页面、AI 侧栏图片仓库和图片卡片挂载点；所有按钮套用统一模板类。
- `src/app.css`：图库页面、AI 侧栏双栏布局、两列/单列卡片、选中态、删除按钮、遮罩层级和导航按钮颜色令牌。
- `preload.js`：暴露最小安全接口，不暴露任意文件系统路径；注入 image repository、temporary store 和 call protocol。
- `scripts/check.mjs`：新增数据迁移、仓库关联、清理策略、精简 JSON 调用、权限、限流和 AI 上下文回归检查。
- `README.md`、`CHANGELOG.md`、`启动说明.txt`、`VERSION.txt`、`agent-tools/*`：实现完成后同步接口说明和版本标识；本计划阶段不修改版本号。

## 分阶段实施顺序（未来执行时）

### 阶段 1：数据层与迁移

- 先为 `ImageAsset`、`GalleryRef`、`ConversationImageRef`、`VisionTempInput` 定义纯数据函数和失败测试。
- 实现引用计数、会话转移、清空与删除语义；验证共享图片不会被误删。
- 实现旧 `images_index`/集合/会话数据迁移；运行快速检查后单独提交。

### 阶段 2：右侧识图临时存储

- 先测试图片库引用、外部临时图替换、旧请求取消和清理。
- 接入 VisionInput 地址解析；验证识图临时图永不自动加入对话仓库。
- 更新右侧识图 UI 和拖拽层级；运行快速检查后单独提交。

### 阶段 3：独立图库页面

- 先测试图库排序、重命名不改 ID、批量选择、下载清单和导入导出映射。
- 加入 `gallery` 路由和统一导航按钮：颜色令牌、hover/active/press、激活文字“返回主页面”全部复用模板。
- 完成卡片、显示大小、拖拽到对话/识图和删除确认；单独提交。

### 阶段 4：AI 页面临时图库

- 先测试对话仓库 pending 状态、发送成功后取消 pending、清空保留图片、删除转移图片。
- 调整左侧 AI 侧栏宽度与双栏布局；添加两列/单列显示切换和输入框上方待发送条带。
- 接入用户上传、拖入、粘贴和从图库添加；单独提交。

### 阶段 5：精简 JSON 调用表

- 先写失败测试覆盖 JSON 提取、未知调用、字段过滤、默认值和可见文本清理。
- 实现 `call-table.js` 与 `call-protocol.js`；先接入 `images`、`search`、`vision`、`title`，再接入受权限控制的 `render`。
- 验证调用结果只向 AI 返回摘要，完整记录只进入 UI/历史；单独提交。

### 阶段 6：AI Runner 与连续对话

- 先写失败测试覆盖 AI 查询图片、按标题/编号解析、Vision 结果回注、Comfy 候选关联和下一轮引用。
- 接入回合限流、缓存、取消和旧请求隔离；保留原生工具兼容层。
- 跑一次 AI/Comfy smoke 检查，单独提交。

### 阶段 7：整体验证与桌面包

- 必跑 `npm run check`；按风险跑一次包含 AI/Comfy 的 smoke。
- 检查源码、Electron `resources\\app` 和顶层 `app` 一致；确认图片模型、`node_modules` 和用户数据路径不被覆盖。
- 更新版本号、日志、说明和 agent-tools 文档；删除桌面旧测试目录，仅保留最新 exe；启动烟测后停止测试进程。

## 测试与验收清单

### 数据与生命周期

- 同一全局图片可被多个对话引用；删除一个对话不会影响其他引用。
- 清空对话保留图片、标题、识图结果，并将所有 pending 重置为 false。
- 删除对话默认删除专属图片；选择保留时图片转入独立图库且 imageId 不变。
- 删除图库关联不会误删仍被对话引用的图片；物理删除后索引、文件和引用状态一致。
- 临时识图区最多一张；替换外部图会取消旧请求并清理旧临时资源。

### AI 调用

- `search` 只提交 query/precision；程序补齐成人开关、分类、limit。
- `vision` 只提交图片别名；程序解析到唯一当前会话图片或临时图。
- `images` 返回轻量清单，不带 Base64/本地路径。
- `render` 只提交 prompt 及允许的少量变量；工作流和设备参数由程序补全。
- 未知/非法 JSON 不执行；调用标记不泄漏到最终用户文本。
- Vision/搜索缓存有效；调用失败不会无限重试；渲染和读取次数受限。
- 历史 assistant 消息不携带图片内容或不完整的原生 tool call，避免 HTTP 400。

### UI

- 图库导航按钮使用统一模板、独立颜色，进入后文字变为“返回主页面”。
- AI 左侧对话管理与图片仓库在桌面并排，窄屏不重叠。
- 图片默认两列，可切换单列；选中图片在输入框上方清晰显示。
- 拖入对话区与左侧图片区结果一致；右侧识图拖入不进入对话仓库。
- 识图打开时主内容变暗，但导航和左侧图片仓库可操作；删除按钮无遮挡。
- 批量删除、重命名、导入导出和发送到指定对话均有清晰确认/状态反馈。

## 版本与提交约束

- 每个阶段按仓库 `AGENTS.md` 小步提交，中文提交信息格式为 `V版本号：说明`。
- 每次独立改动提交前必跑 `npm run check`；AI 核心链路改动允许额外跑一次 smoke。
- 正式版本变更时同步 `package.json`、`VERSION.txt`、`src/index.html`，并同步桌面测试目录；内部版本不 push。
- 本文档阶段不改代码、不提交生产功能、不 push、不发布 Release。

## 计划自审与已做调整

本轮通读后确认所有已讨论需求都有对应的产品规则、数据字段、接口契约、实施阶段和验收项；未发现需要保留的未决冲突。为避免执行阶段出现歧义，已做以下调整：

1. 将侧栏宽度描述改为桌面端总宽约 420px、对话管理 148px、图片仓库至少 250px，并明确窄屏切换策略。
2. 将图库入口固定在 `visionBtn` 与 `favBtn` 之间，写死统一模板类、独立颜色令牌和“返回主页面”激活文案。
3. 将 `slotNo` 和图库 `displayOrder` 规定为不可复用/可确定性排序，解决删除后编号漂移和历史引用错位。
4. 明确区分全局正式名称 `ImageAsset.displayName`、会话临时标题 `ConversationImageRef.displayTitle`、AI 识图摘要 `aiDescription`，避免重命名语义冲突。
5. 明确 `VisionTempInput` 是窗口级单槽状态，不属于会话；清空或删除对话不会误清理右侧当前识图输入。
6. 明确 `render.iterations` 是程序控制的候选渲染轮数，不是 ComfyUI 节点字段，避免 AI 误传底层参数。
7. 明确 JSON 只解析 AI 独立行/代码块中的已知 `call`，第一版一轮一个调用；未知 JSON、用户原文和普通代码示例不执行。
8. 明确默认不重发全部历史图片，只发送待发送/明确引用/AI 主动读取的图片，以落实“由程序承担上下文压缩”的目标。
9. 明确共享图片只删除会话关联，物理删除必须通过跨图库、跨会话和消息引用计数检查。
10. 明确 ComfyUI 等外部副作用由用户开关控制，AI 只能读图、查询、生成临时标题；删除、转移和正式重命名保留给用户。
