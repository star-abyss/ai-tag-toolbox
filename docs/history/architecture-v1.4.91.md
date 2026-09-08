# AI 绘画 Tag 工具箱：当前架构与下一阶段统一重构规划

> 文档用途：为下一次全新对话提供完整、可执行的项目上下文。
>
> 当前代码版本：V1.4.91
> 当前源码目录：F:\codex\rewrite-v1.4.3  
> 当前桌面测试包：C:\Users\admin\Desktop\AI绘画Tag工具箱V1.4.91
> 文档状态：架构说明、实施进度与后续规划；下方“当前实施进度”标注已经落地的部分。

### 当前实施进度（V1.4.91）

- 阶段 1–2：独立单图 Vision Service 与 `vision.processOne` Calls 入口已完成。
- 阶段 3：右侧 `currentVisionImageId` 与对话图片上传边界已完成。
- 阶段 4：ComfyUI 动态 capabilities 与主 AI 最小 render schema 已完成。
- 阶段 5：统一 `src/modules/ai-runner.js` 与 `assistant.run({ mode: "assistant" | "draw" })` 已完成。
- 阶段 6：页面用户模式已收敛为“助手”和“绘图”；Generate、Recreate、ComfyIteration 作为绘图任务上下文。
- 阶段 7：Agent Runtime/Admin 工具分组、动态权限列表和 `settings.comfy.*` 已完成。
- 阶段 8：旧四模式页面、重复循环、Vision 别名和 Comfy 文本协议已删除；旧会话仅在恢复时一次性映射。

---

## 一、必须遵守的项目设计原则

本项目是一个开源、本地运行、中小规模的桌面工具，不面向服务器部署，也不设计复杂的账户、鉴权、租户或企业级安全体系。

项目优先级从高到低为：

1. 能运行、能尽快交给用户人工检查。
2. 逻辑简洁，功能归属一眼可见。
3. 模块边界清楚，后续容易增加新能力。
4. 流畅性和交互反馈明确。
5. 必要的防呆和数据一致性。
6. 最后才是较完整的自动验证与防御性设计。

这里所说的“安全”主要是：

- 防止识别错图片；
- 防止工作流图片污染用户图片；
- 防止提示词默认值被永久破坏；
- 防止状态保存错位；
- 防止同一任务被重复提交；
- 防止 ComfyUI 未连接时 AI 假装调用成功。

这里不追求：

- 软件防破解；
- 复杂权限系统；
- 多用户隔离；
- 企业级审计；
- 为每个参数编写多层验证器；
- 为小型功能建立多层抽象框架。

开发规则应继续坚持：

- 模块化单体，而不是微服务；
- 每种状态只有一个拥有者；
- 页面不持有业务状态；
- 网络、存储、业务能力不写进页面事件；
- 小步提交，每一步保持可运行；
- 默认运行 npm run check；
- UI、真实 API 和真实 ComfyUI 效果主要由用户人工检查。

---

## 二、项目定位与主要功能

AI 绘画 Tag 工具箱主要解决以下问题：

1. 浏览、搜索和组合站内绘图 Tag。
2. 读取图片中内置的 Tag、生成参数和 ComfyUI 工作流。
3. 使用本地 WD EVA02 模型识别常见绘图 Tag。
4. 使用独立视觉 AI API 分析图片。
5. 使用主 AI 生成、修改和讨论绘图提示词。
6. 调用本地 ComfyUI 工作流生成图片。
7. 让主 AI 根据 ComfyUI 返图继续调整提示词。
8. 为 Codex、外部 Agent 和 MCP 客户端开放同样的查询、识图和绘图能力。
9. 提供本地中英翻译与 Tag 参考匹配。

现有页面外观和主要交互习惯以 V1.4.2 为参考，但 V1.4.2 只能作为素材与行为参考，不能继续继承它的全局变量、脚本链、双重状态和兼容 Bridge。

---

## 三、V1.4.4 当前项目目录

当前源码的主要结构如下：

    rewrite-v1.4.3/
    ├─ main.js
    ├─ preload.js
    ├─ package.json
    ├─ VERSION.txt
    ├─ README.md
    ├─ V1.4.4-架构方案.md
    ├─ agent-tools/
    │  ├─ README.md
    │  ├─ 外部Agent工具说明.md
    │  ├─ protocol.md
    │  ├─ tools.manifest.json
    │  └─ mcp-server.js
    ├─ assets/
    │  ├─ 标签数据
    │  └─ 提示词素材
    ├─ locales/
    │  ├─ zh-CN.json
    │  └─ en-US.json
    ├─ scripts/
    │  └─ check.mjs
    └─ src/
       ├─ index.html
       ├─ app.css
       ├─ app.js
       ├─ app-view.js
       ├─ migrate.js
       └─ modules/
          ├─ index.js
          ├─ storage.js
          ├─ tags.js
          ├─ images.js
          ├─ vision.js
          ├─ prompts.js
          ├─ translation.js
          ├─ comfy.js
          ├─ assistant.js
          └─ calls/
             ├─ registry.js
             ├─ index.js
             └─ server.js

当前是一个 Electron 模块化单体。所有业务模块运行在 preload 所在的本地环境中，页面通过 contextBridge 暴露的 AppModules 调用业务能力。

---

## 四、V1.4.4 当前启动和组装流程

当前启动链路为：

    main.js
      ↓
    创建 Electron BrowserWindow
      ↓
    preload.js
      ↓
    捕获一次旧版 localStorage 快照
      ↓
    migrate.js 将旧数据写入 AppStorage
      ↓
    依次创建 Storage、Tags、Vision、Images、Prompts、
    Comfy、Assistant、Calls、Translation、Agent Server
      ↓
    contextBridge.exposeInMainWorld("AppModules")
      ↓
    index.html 加载 app-view.js 与 app.js
      ↓
    app.js 创建视图并启动页面

当前 preload.js 是项目的组合根，负责：

- 找到标签、提示词和本地模型素材；
- 建立稳定用户数据目录；
- 创建唯一的 Storage 入口；
- 创建所有业务模块并注入依赖；
- 创建 Agent HTTP 服务；
- 向页面暴露薄 API。

app.js 当前只负责：

- 页面级 route；
- 主题；
- 语言；
- 创建 AppView；
- 启动视图。

页面中大量按钮、路由和渲染绑定仍集中在 app-view.js。它已经不直接实现底层网络和存储，但文件仍然很大，是后续可以继续整理的 UI 层。

---

## 五、V1.4.4 当前模块职责

### 5.1 Storage

文件：src/modules/storage.js

职责：

- 所有小型 JSON 状态的唯一持久化入口；
- 默认使用 rewrite-storage.json 文件；
- 为图片等大对象提供 Blob 存储接口；
- 在无法使用文件或 IndexedDB 时保留内存回退；
- 对页面和业务模块暴露 get、set、load、save、remove 等统一方法。

当前不再允许业务模块直接调用浏览器 localStorage。旧 localStorage 只由 preload 在启动时读取一次，交给独立迁移器。

### 5.2 Migrate

文件：src/migrate.js

职责：

- 读取旧版数据快照；
- 把旧设置、提示词、世界书、收藏和会话转为新格式；
- 只在启动阶段执行；
- 与正式业务逻辑分离。

迁移器不是长期兼容层。新业务代码不应该继续读取旧字段。

### 5.3 Tags

文件：src/modules/tags.js

职责：

- 加载基础标签、扩展标签、同义词和 WD 模型标签；
- 英文、中文、别名和分类搜索；
- 成人标签过滤；
- 当前标签选择；
- 收藏组合；
- 自定义标签；
- 标签分类和数量统计；
- 搜索缓存和分页。

Tags 不依赖 Assistant、Images、ComfyUI 或页面。

当前主要公开能力：

    tags.list(options)
    tags.page(options)
    tags.search(query, options)
    tags.select(id)
    tags.selected()
    tags.clearSelection()
    tags.addCustom(tag)
    tags.removeCustom(id)
    tags.categories()

### 5.4 Images

文件：src/modules/images.js

职责：

- 将上传、粘贴、拖拽和工具返图转换为统一 Image 对象；
- 保存原图 Data URL、字节或 Blob；
- 解析 PNG tEXt、iTXt 和 zTXt；
- 读取 A1111、Forge、NovelAI 和 ComfyUI 元数据；
- 管理 imageId；
- 保存每张图片的分析结果；
- 为不同页面保存图片集合；
- 调用注入的本地分析器；
- 对本地识图结果做按图片、模型和参数缓存。

当前 Image 对象大致为：

    {
      id,
      filename,
      dataUrl,
      thumbnailDataUrl,
      mime,
      source,
      width,
      height,
      metadata,
      analysis,
      status,
      blobId,
      createdAt
    }

需要特别区分：

- ImageStore 是所有图片的仓库；
- collection 是页面或任务临时引用哪些 imageId；
- collection 不是识图模块应该依赖的业务输入。

当前 app-view.js 仍然使用 talk、quick、gen、comfy 等集合。这个设计适合多图会话，但不适合作为单图识图接口，因此是下一阶段需要修正的地方。

### 5.5 Vision（当前只完成了本地识图适配）

文件：src/modules/vision.js

当前职责：

- 加载 WD EVA02 2026 Canary ONNX 模型；
- 读取 tags-canary.json；
- 预处理图片；
- 执行本地模型推理；
- 返回常见绘图 Tag。

当前 vision.js 并不是完整的“统一识图服务”。它主要是本地模型适配器。

当前完整识图能力实际上分散在：

- images.js：元数据和内置 Tag；
- vision.js：本地 WD 识图；
- calls/index.js：AI 识图提示词组装和视觉 API 调用；
- assistant.js：在复刻和 ComfyUI 流程中决定何时识图；
- app-view.js：从 quick 或 talk 集合中选择图片。

这正是下一阶段需要封装成独立 Vision Service 的主要原因。

### 5.6 Prompts

文件：src/modules/prompts.js

当前提示词来源：

    main        内部主提示词
    generate    生成 Tag 任务提示词
    chat        自由对话任务提示词
    vision      识图描述提示词
    comfy       ComfyUI 提示词协议
    quality     默认质量前缀
    appendices  默认附录

Prompts 负责：

- 读取内置默认文本；
- 返回当前有效文本；
- 保存用户覆盖值；
- 启用或停用提示词；
- 恢复默认；
- 管理自定义提示词；
- 组合指定模式的提示词。

提示词保护规则：

- 内置默认文本不可修改和删除；
- 用户修改的是覆盖值；
- 恢复默认会清除覆盖值并重新启用；
- 内置提示词不可删除；
- 自定义提示词允许新建、修改、停用和删除。

当前 Vision AI 已经能从提示词模块读取 vision 提示词，但这段调用仍位于 Calls handler 中。目标设计要求 Vision Service 自己通过注入的 getPrompt 读取 prompts.getEffective("vision")，而不是由调用者拼接。

### 5.7 Translation

文件：src/modules/translation.js

职责：

- 本地中英翻译；
- 中文自然语言转 Tag 参考；
- Tag 转中文；
- 通过 Tags 搜索候选；
- 可选调用通用 AiService；
- 保存翻译任务状态与结果。

Translation 只依赖 Tags、翻译模型 runner 和通用 AI 客户端，不应该调用 Assistant 的具体模式。

### 5.8 Comfy

文件：src/modules/comfy.js

职责严格限定为连接器：

- 保存 ComfyUI 基地址；
- 检查 system_stats；
- 导入 API 格式工作流；
- 从工作流提取正向、负向、宽高、步数、CFG 和 seed；
- 向工作流注入占位符；
- POST /prompt 提交；
- 查询 /queue；
- 轮询 /history/{prompt_id}；
- 通过 /view 获取结果图片；
- 把图片转换为 artifact。

comfy.js 不应该：

- 判断用户意图；
- 决定是否继续迭代；
- 调用主 AI；
- 调用识图 AI；
- 修改提示词模块；
- 管理会话。

这一边界已经基本正确，后续应继续保留。

### 5.9 Calls

文件：

    src/modules/calls/registry.js
    src/modules/calls/index.js
    src/modules/calls/server.js

Calls 是 V1.4.4 新增的统一能力层。

registry.js 负责：

- 注册稳定业务工具名；
- 生成 OpenAI function tools schema；
- 解析别名；
- 检查只读和写入权限；
- 统一错误格式；
- 统一返回结构。

index.js 当前注册的主要工具包括：

Tag：

    tags.search

识图：

    vision.readMetadata
    vision.localIdentify
    vision.aiDescribe

ComfyUI：

    comfy.check
    comfy.render
    comfy.history
    comfy.getImage

提示词：

    prompts.list
    prompts.read
    prompts.compose
    prompts.create
    prompts.update
    prompts.delete
    prompts.enable
    prompts.reset

设置：

    settings.getComfyIterations
    settings.setComfyIterations

server.js 把同一个 Registry 暴露为本地 HTTP 接口：

    GET  /health
    GET  /tools/list
    POST /tools/call

agent-tools/mcp-server.js 再把 HTTP 接口转发为 MCP stdio server。

当前 Calls 的主要优点：

- 页面、主 AI 和外部 Agent 可以使用同一个 handler；
- 工具名与源码函数名分离；
- ComfyUI 连接器没有复制多套；
- 外部 Agent 不需要扫描源码猜调用方式。

以下是 V1.4.4 早期基线中的问题记录；V1.4.91 已完成对应收敛：

- Vision 统一为 `vision.processOne`，严格接受单个 `imageId`；
- Vision 主提示词由 Prompts 的 `getEffective("vision")` 提供；
- ComfyUI capabilities 在交给 AI/Agent 前动态检查；
- Agent 工具现在按 Runtime/Admin 分组并受 `agentWriteEnabled` 控制。

### 5.10 Assistant

文件：src/modules/assistant.js

Assistant 是当前最大的核心模块，负责：

- 主 API 客户端；
- 识图 API 客户端；
- OpenAI Compatible 请求；
- SSE 流式解析；
- reasoning 与正文分离；
- 原生 tool_calls 解析；
- 工具循环；
- 会话与消息；
- 提示词组合；
- 用户预设；
- 世界书；
- 收藏；
- Chat、Generate、Recreate 和 Comfy 四种执行流程；
- 工具调用次数、AI 回合数和 ComfyUI 渲染次数；
- ComfyUI 返图回灌；
- 非视觉主模型委托识图 API；
- 取消、超时和错误。

当前存在两个 AI 客户端：

    primary AI
      负责普通对话、绘图决策、任务规划和最终输出。

    vision AI
      负责独立图片分析。

当前四个公开入口：

    assistant.chat()
    assistant.generate()
    assistant.recreate()
    assistant.iterateWithComfy()

它们已经共享：

- AiService；
- Calls Registry；
- 会话；
- 图片仓库；
- 提示词模块；
- 工具循环的部分实现。

但仍然保留四套外围业务流程和四种提示词分支。Assistant 因此继续承担过多职责，也是下一阶段需要收敛为统一 Runner 的核心。

### 5.11 AppView

文件：src/app-view.js

职责：

- 页面路由；
- 导航与模式切换；
- 标签、会话、图片和结果渲染；
- 用户输入事件；
- 流式消息显示；
- 拖拽、粘贴和上传；
- 设置表单；
- 提示词编辑页；
- 右侧识图面板。

它不再直接调用 fetch，也不直接调用 localStorage。

当前问题：

- 文件仍然很大；
- 右侧识图面板通过 quick 或 talk collection 推断图片；
- 多图会话和单图识图的概念尚未完全分开；
- 页面仍然呈现四个 AI 模式；
- 针对 Recreate 和 Comfy 的独立 UI 绑定较多。

---

## 六、V1.4.4 当前状态所有权

| 状态 | 当前拥有者 | 页面读取方式 |
|---|---|---|
| 标签目录、分类、选择、自定义标签 | Tags | tags snapshot / 方法 |
| 图片、元数据、本地分析结果 | Images | imageStore / images 方法 |
| 提示词默认值、覆盖值、启用状态 | Prompts | prompts 方法 |
| AI 设置、预设、世界书、收藏 | Assistant | assistant get/set 方法 |
| 会话、消息、AI 任务 | Assistant | assistant sessions / currentSession |
| ComfyUI 地址和工作流连接状态 | Comfy + Assistant settings | comfy / assistant settings |
| 翻译输入和结果 | Translation | translation 方法 |
| 页面路由、语言、主题、折叠状态 | App/AppView | 页面内部状态 |

当前总体已经摆脱 V1.4.2 的双重 Store，但 Assistant 中仍聚集了较多业务状态。下一阶段不必为了纯洁性把所有状态再拆成很多小仓库；只需把 Vision 和统一 AI Runner 的边界拆清楚。

---

## 七、V1.4.4 当前统一数据对象

### 7.1 Tag

    {
      id,
      en,
      zh,
      aliases,
      category,
      subcategory,
      nsfw,
      origin
    }

### 7.2 Image

    {
      id,
      filename,
      dataUrl,
      thumbnailDataUrl,
      source,
      mime,
      metadata,
      analysis,
      status,
      blobId,
      createdAt
    }

### 7.3 Message

    {
      id,
      role,
      text,
      reasoning,
      imageIds,
      mode,
      result,
      toolCalls,
      status,
      createdAt
    }

### 7.4 Session

    {
      id,
      title,
      messages,
      createdAt,
      updatedAt
    }

### 7.5 Tool Result

    {
      ok,
      data,
      code,
      error
    }

### 7.6 Image Artifact

    {
      id,
      filename,
      path,
      viewUrl,
      dataUrl,
      mime,
      width,
      height,
      prompt,
      negative
    }

目标架构应尽量保留这些数据对象，避免为了统一 Runner 再重写标签、图片和会话格式。

---

## 八、V1.4.4 当前四种 AI 模式

### 8.1 Assistant / Chat

当前流程：

    用户文字或图片
      ↓
    组装 Chat 提示词
      ↓
    主 AI
      ↓
    可选调用 Tag / Vision 工具
      ↓
    流式输出并保存会话

问题：

- 当前仍可能受到 promptMods 和旧 Chat 任务提示词影响；
- 与 Generate 的工具循环基本相同，但保留独立入口。

### 8.2 Generate

当前流程：

    用户描述
      ↓
    Tags 候选
      ↓
    生成主提示词 + Generate 任务提示词
      ↓
    主 AI
      ↓
    输出最终提示词与负面提示词

它与 Chat 的主要区别实际上只有提示词策略和输出解析。

### 8.3 Recreate

当前流程：

    用户图片
      ↓
    可选本地识图
      ↓
    主 AI 或 vision.aiDescribe
      ↓
    生成最终绘图 Tag

它与 Generate 使用同一个主 AI 和同一套 Calls，但仍有独立 runRecreate。

### 8.4 ComfyIteration

当前流程：

    用户需求或基准图
      ↓
    主 AI 生成工具调用
      ↓
    comfy.render
      ↓
    ComfyUI 返回 artifact
      ↓
    主 AI直接看图，或 vision.aiDescribe
      ↓
    主 AI决定继续 render 或结束

当前已经实现：

- AI 回合数、工具次数和渲染次数分开；
- ComfyUI connector 与循环逻辑分开；
- 返图 artifact 回灌；
- 视觉主模型直接看图；
- 非视觉主模型委托识图 API；
- Tag 查询工具；
- 原生工具调用兼容；
- 实时事件显示。

但它仍然保留独立 runComfy、独立专用提示词和独立 UI 模式。

---

## 九、当前架构的主要问题

### 9.1 四种模式的调用逻辑没有完全统一

Chat、Generate、Recreate 和 Comfy 已经共享 AiService 和 Calls，但仍有四套入口、四段消息组装和四种外围流程。

结果是：

- 修复流式消息时可能只修到某个模式；
- 图片输入逻辑可能不一致；
- 工具调用事件可能出现重复实现；
- 新工具需要检查四个流程；
- UI 需要维护四个模式按钮和状态。

### 9.2 识图还不是完整独立模块

目前没有一个真正统一的：

    Vision.processOne(imageId, mode, options)

元数据、本地模型和 AI 识图分散在 Images、Vision、Calls、Assistant 和 AppView。

### 9.3 识图接口仍然以图片数组和页面集合为中心

当前 vision.readMetadata、vision.localIdentify 和 vision.aiDescribe 接受 imageIds 数组。

右侧快速识图面板也会从 quick 或 talk collection 读取图片。

这与已经确认的设计不一致：

- 识图一次只能处理一张图片；
- 调用者必须明确传入 imageId；
- Vision 不允许扫描页面集合猜当前图片；
- 新图片进入右侧面板时应替换旧图片和旧结果。

### 9.4 Prompt 读取位置不够统一

AI 识图提示词已经来自 Prompts，但由 Calls handler 直接拼接。

目标应改为：

    Vision Service
      → getPrompt("vision")
      → 识图主提示词
      → 本次 instruction
      → 当前图片
      → vision AI

调用者不应该知道提示词文件、默认值或拼接顺序。

### 9.5 ComfyUI 工具可用性（已完成）

目标要求：

- ComfyUI 未连接或没有有效工作流时，主 AI 不应该获得 comfy.render 工具；
- 不只是调用后返回错误，而是请求开始前就从工具 schema 中移除；
- 外部 Agent 的工具列表也应该标记为 unavailable，或不暴露该运行工具。

V1.4.91 的统一 Runner 和 Agent `/tools/list` 都在下发 schema 前检查地址、工作流和 API 格式；不可用时移除 `comfy.render`，handler 保留最后一道检查。

### 9.6 运行接口与管理接口（已完成）

主 AI 日常工作只需要：

- Tag 查询；
- 单图识图；
- ComfyUI 渲染。

Agent 管理能力还包括：

- 修改 ComfyUI 参数；
- 修改提示词覆盖值；
- 新建和删除自定义提示词；
- 启用或停用提示词；
- 设置迭代次数。

V1.4.91 已在 Calls Registry 中标记 `runtime` / `admin` 分组，外部 Agent 默认只获得 Runtime，开启 `agentWriteEnabled` 后才获得 Admin。

---

## 十、已经确认的下一阶段总体设计

下一阶段不再保留四个用户可见 AI 模式，只保留：

1. 助手模式；
2. 绘图模式。

四个旧模式的关系改为：

| 当前模式 | 目标状态 |
|---|---|
| Assistant / Chat | 保留为助手模式 |
| Generate | 合并进绘图模式 |
| Recreate | 变成绘图模式中的“有基准图任务” |
| ComfyIteration | 变成绘图模式中的“调用渲染并分析返图任务” |

Recreate 和 ComfyIteration 不再是不同的 AI 执行器，只是同一个绘图 Runner 在不同上下文下调用不同工具。

目标结构：

    页面 / 主 AI / 外部 Agent
                 ↓
        统一 AI Runner 与 Calls
                 ↓
       ┌─────────┼──────────┐
       ↓         ↓          ↓
    Tags      Vision      Comfy
       ↓         ↓          ↓
    标签库   单图识图服务   连接器/工作流

提示词作为策略注入：

    助手模式
      → 不注入绘图业务提示词

    绘图模式
      → prompts.getEffective("draw")

    AI 识图
      → prompts.getEffective("vision")

---

## 十一、目标 AI Runner

建议只保留一个统一执行入口：

    assistant.run({
      mode,
      text,
      imageIds,
      sessionId,
      options
    })

mode 只允许：

    assistant
    draw

统一 Runner 的固定过程：

    1. 读取当前会话。
    2. 根据 mode 选择提示词策略。
    3. 根据当前环境计算可用工具。
    4. 把工具 schema 和消息交给主 AI。
    5. 执行主 AI 返回的工具调用。
    6. 把工具结果重新放回同一次任务上下文。
    7. 重复，直到 AI 输出最终结果、用户停止或达到限制。
    8. 保存统一 Message 和 Tool Trace。

只允许提示词策略不同，不允许再复制工具循环。

### 11.1 助手模式

助手模式不注入以下内容：

- 绘图主提示词；
- 生成 Tag 任务提示词；
- 复刻协议；
- ComfyUI 迭代协议；
- 质量词和画师前缀；
- 世界书绘图规则，除非用户显式启用。

助手模式仍然可以获得工具 schema 和最小工具说明。

“不注入任何提示词”在实现上指“不注入业务型系统提示词”，不是彻底移除 API 必需的工具 schema。

助手模式可调用：

    tags.search
    vision.processOne
    comfy.render（仅在可用时）

它可以纯粹回答问题，也可以在用户明确要求时查询、识图或绘图。

### 11.2 绘图模式

绘图模式注入：

    prompts.getEffective("draw")

首版可以继续复用现有 main + generate 的有效组合，不必立即重写提示词文本。

绘图模式与助手模式拥有相同工具：

    tags.search
    vision.processOne
    comfy.render（仅在可用时）

绘图模式根据上下文自然形成不同任务：

    没有图片、只要求提示词
      → 文生图 Tag 生成

    有基准图片
      → 调用 Vision 后进行复刻或改图

    要求实际出图且 ComfyUI 可用
      → comfy.render

    收到 ComfyUI 返图
      → vision.processOne 或主模型直接看图
      → 修改提示词
      → 再次 comfy.render

这些都是同一个 Runner 的连续工具调用，不再有独立 Recreate 或 ComfyIteration 流程。

---

## 十二、目标三类运行接口

应用内主 AI、页面和外部 Agent 应使用完全相同的 Runtime Tools。

### 12.1 Tag 查询

接口：

    tags.search({
      query,
      category,
      includeAdult,
      limit
    })

输入：

- 一个关键词或短语；
- 可选分类；
- 可选成人标签；
- 可选数量。

输出：

    {
      ok: true,
      tool: "tags.search",
      data: {
        items: [...]
      }
    }

查询只返回结果，不修改页面当前选择。

### 12.2 单图识图

目标统一接口：

    vision.processOne({
      imageId,
      mode,
      model,
      instruction
    })

imageId：

- 必须是一个明确图片 ID；
- 不允许 imageIds 数组；
- 不允许 Vision 自己从 quick、talk、comfy 等集合中猜图片。

mode：

    metadata
      读取内置 Tag、工作流和生成参数。

    local
      使用本地 WD 模型识别常见绘图 Tag。

    ai
      使用独立视觉 AI API。

model：

- 只对 local 模式有意义；
- 首版默认 eva02；
- 后续可以扩展其他本地模型。

instruction：

- 只对 ai 模式有意义；
- 是一次性的附加要求；
- 例如“重点分析手部、角色姿势和镜头角度”；
- 不允许覆盖识图主提示词；
- 不写回提示词模块。

目标统一返回：

    {
      ok: true,
      tool: "vision.processOne",
      imageId: "img_xxx",
      mode: "ai",
      data: {
        metadata: {},
        tags: [],
        text: "",
        reasoning: "",
        model: ""
      }
    }

每次调用只处理一张图片。

### 12.3 ComfyUI 渲染

应用内主 AI 的接口应尽量小：

    comfy.render({
      prompt,
      negative
    })

主 AI 负责传入：

- 正向 Tag；
- 可选负面 Tag。

下列参数默认由用户在设置中控制：

- width；
- height；
- steps；
- cfg；
- seed 策略；
- sampler；
- scheduler；
- 工作流；
- 模型、LoRA、VAE 等工作流节点。

应用内 AI 不应该在每次 render 时擅自覆盖这些用户设置。

输出：

    {
      ok: true,
      tool: "comfy.render",
      data: {
        artifact: {
          id,
          filename,
          dataUrl,
          viewUrl,
          prompt,
          negative
        }
      }
    }

---

## 十三、目标独立 Vision Service

Vision 应成为真正独立的黑盒业务模块。

建议创建：

    src/modules/vision-service.js

或者直接把现有 vision.js 扩展为完整服务，但不要让本地模型加载代码、Prompt 组合和远程 API 请求全部混成一个巨大函数。

推荐依赖注入：

    createVisionService({
      images,
      localVision,
      visionAI,
      getPrompt
    })

其中：

    images
      根据 imageId 读取原图和元数据。

    localVision
      当前 WD EVA02 adapter。

    visionAI
      独立视觉 API 客户端。

    getPrompt
      id => prompts.getEffective(id)

Vision Service 公开：

    processOne(input)
    readMetadata(imageId)
    localIdentify(imageId, options)
    aiDescribe(imageId, options)

后三个可以只是 processOne 的薄封装，不允许再各自复制业务逻辑。

### 13.1 metadata 模式

    校验 imageId
      ↓
    Images.get(imageId)
      ↓
    Images.metadata(imageId)
      ↓
    返回内置正向 Tag、负向 Tag、参数和工作流

### 13.2 local 模式

    校验 imageId
      ↓
    Images.get(imageId)
      ↓
    LocalVision.analyze(image)
      ↓
    保存当前图片的分析缓存
      ↓
    返回单图 Tag

### 13.3 ai 模式

    校验 imageId
      ↓
    getPrompt("vision")
      ↓
    识图主提示词
      +
    本次 instruction
      +
    当前图片
      ↓
    独立 vision AI 请求
      ↓
    返回描述、Tag、reasoning 和模型信息

AI 识图必须是独立的一次请求：

- 不继承主 AI 的聊天历史；
- 不把主 AI 的系统提示词带入；
- 不把上一次识图对话带入；
- 每次调用从识图主提示词重新开始；
- instruction 只作用于本次调用。

### 13.4 提示词归属

Vision Service 不保存提示词文本。

Prompts 是提示词唯一拥有者：

    prompts.getEffective("vision")
    prompts.getDefault("vision")
    prompts.setOverride("vision", text)
    prompts.reset("vision")

Vision 只消费 getEffective("vision")。

调用者只能传 instruction，不能传 systemPrompt 或覆盖完整识图主提示词。

首版只保留一个 vision 主提示词即可。以后有需要再增加：

    vision.tags
    vision.describe
    vision.pose
    vision.compare

不要在第一阶段立即拆出很多提示词类型。

---

## 十四、单图识图与多图上下文的边界

这是下一阶段最重要的数据边界。

### 14.1 对话和 ComfyUI 可以拥有多图

主 AI 会话可以保存：

    imageIds: ["img_1", "img_2", "img_3"]

这些图片属于会话上下文，用户可以说：

- 比较图 1 和图 2；
- 参考上一张图；
- 使用最新返图继续修改。

### 14.2 Vision 每次只处理一张

即使对话里有多张图片，调用 Vision 时也必须明确：

    vision.processOne({
      imageId: "img_3",
      mode: "ai"
    })

默认“最新图片”应由调用方在调用前解析为具体 imageId，而不是让 Vision 扫描集合。

### 14.3 右侧识图面板只有一个 currentImageId

目标页面状态：

    currentVisionImageId

用户每次拖入、粘贴或上传新图时：

    1. 取消旧的识图请求。
    2. 替换 currentVisionImageId。
    3. 清除旧图片的当前显示结果。
    4. 自动读取新图内置 Tag。
    5. 等待用户选择本地识图或 AI 识图。

右侧面板不应使用 quick collection 中的全部图片进行识图。

### 14.4 AI 调用 Vision 时也必须单图

主 AI 工具调用：

    vision.processOne({
      imageId: "明确的图片 ID",
      mode: "local" 或 "ai"
    })

如果主 AI 的当前消息包含多张图片：

- AI 必须在工具参数中选择一张；
- 工具 schema 要明确说明一次只允许一个 imageId；
- 参数不完整时返回“缺少 imageId”，而不是猜测。

### 14.5 ComfyUI 返图

    comfy.render
      ↓
    返回 artifact.id
      ↓
    artifact 保存进 Images
      ↓
    得到明确 imageId
      ↓
    vision.processOne(imageId, mode)

不得从 ComfyUI 历史或图片仓库中模糊选择“最近某张”作为识图目标。

---

## 十五、动态工具可用性

统一 Runner 在每次调用主 AI 前都应计算 capabilities。

建议结构：

    {
      tags: true,
      vision: {
        metadata: true,
        local: localModelAvailable,
        ai: visionApiConfigured
      },
      comfy: {
        connected,
        workflowReady,
        render: connected && workflowReady
      }
    }

生成工具清单：

    tools = [
      tags.search,
      vision.processOne
    ]

    if (capabilities.comfy.render) {
      tools.push(comfy.render)
    }

ComfyUI 未连接或没有有效工作流时：

- 主 AI 不获得 comfy.render schema；
- 助手模式也不获得；
- 绘图模式仍然可以生成和修改 Tag；
- 页面应显示“ComfyUI 当前不可用”；
- handler 仍保留最后一道不可用检查，防止连接状态在任务途中变化。

不要只依靠系统提示词告诉 AI“不要调用”；最有效的方式是根本不把不可用工具交给模型。

---

## 十六、Agent 目标设计

外部 Agent 与应用内主 AI 应被视为同等级调用者。

它们都通过 Calls 调用：

    tags.search
    vision.processOne
    comfy.render

但外部 Agent 可以在用户授权后获得更多管理工具。

### 16.1 Runtime Tools

默认可用：

    tags.search
    vision.processOne
    comfy.render（仅可用时）
    prompts.read
    prompts.list
    settings.comfy.get

### 16.2 Admin / Config Tools

需要 agentWriteEnabled：

    settings.comfy.update
    settings.comfy.setIterations
    prompts.create
    prompts.update
    prompts.delete
    prompts.enable
    prompts.reset

### 16.3 ComfyUI 设置

Agent 可修改：

- width；
- height；
- steps；
- cfg；
- negative 默认值；
- 迭代次数；
- 允许的采样器和调度器设置；
- 工作流选择，是否开放由用户设置决定。

应用内主 AI 的 comfy.render 不直接携带这些管理参数，而是读取用户当前设置。

### 16.4 提示词权限

必须继续遵守：

- 内置默认文本永远不能修改；
- 内置提示词不能删除；
- 主提示词和 vision 提示词只能修改覆盖值；
- 内置提示词可以停用；
- reset 会恢复默认文本和默认启用状态；
- 自定义提示词可以新建和删除；
- instruction 不修改提示词。

### 16.5 工具文档

agent-tools 下必须同步更新：

    外部Agent工具说明.md
    protocol.md
    tools.manifest.json

外部 Agent 不应该阅读源码才能知道怎么调用。

---

## 十七、统一事件和计数

统一 Runner 仍然必须保留三个独立计数：

    aiTurns
      主 AI 完成了多少次请求。

    toolCalls
      调用了多少次 Tags、Vision、Comfy 或其他工具。

    renderCount
      实际提交了多少次 ComfyUI 渲染。

它们不能互相代替。

示例：

    AI 回合 1
      → tags.search

    AI 回合 2
      → comfy.render

    工具自动处理返图
      → vision.processOne

    AI 回合 3
      → 输出结论

结果：

    aiTurns = 3
    toolCalls = 3
    renderCount = 1

统一 UI 事件建议：

    ai-start
    ai-delta
    ai-complete
    tool-start
    tool-progress
    tool-complete
    render-start
    render-progress
    render-complete
    task-complete
    task-error

Chat、Draw、Vision 和 Agent 不应各自再发一套含义不同的事件。

---

## 十八、目标依赖关系

允许：

    App / AppView → Assistant Facade
    App / AppView → Calls
    App / AppView → Tags
    App / AppView → Images
    App / AppView → Translation

    Assistant Runner → Prompts
    Assistant Runner → Calls
    Assistant Runner → Conversation

    Calls → Tags
    Calls → Vision Service
    Calls → Comfy Connector
    Calls → Prompts
    Calls → Settings

    Vision Service → Images
    Vision Service → Local Vision Adapter
    Vision Service → Vision AI Client
    Vision Service → getPrompt

    Translation → Tags
    Translation → Generic AiService

禁止：

    Vision → 页面 collection
    Vision → 主 AI 会话历史
    Tags → Assistant
    Comfy Connector → Assistant
    Comfy Connector → Vision
    页面 → fetch
    页面 → localStorage
    页面 → 工作流内部节点业务
    Agent Server → 复制一套业务 handler

---

## 十九、建议的最小文件调整

不要为每个小函数新建文件。建议只增加真正有独立职责的模块。

目标可以保持为：

    src/modules/
    ├─ assistant.js
    ├─ ai-service.js          可选：从 assistant.js 提取通用 API 客户端
    ├─ ai-runner.js           统一 Assistant / Draw 工具循环
    ├─ vision-service.js      单图识图服务
    ├─ vision.js              WD EVA02 本地 adapter
    ├─ calls/
    │  ├─ registry.js
    │  ├─ index.js
    │  └─ server.js
    ├─ images.js
    ├─ prompts.js
    ├─ comfy.js
    ├─ tags.js
    ├─ translation.js
    └─ storage.js

assistant.js 可以继续作为对外 Facade，负责：

- 会话；
- 设置；
- 预设；
- 世界书；
- 调用 ai-runner；
- 暴露 run、cancel 和 session API。

ai-runner.js 只负责：

- 模式提示词；
- 动态工具清单；
- AI/tool 循环；
- 计数；
- 事件。

vision-service.js 只负责：

- 单图；
- 模式选择；
- Vision Prompt；
- 本地/AI 识图；
- 统一结果。

如果实现过程中发现拆出 ai-service.js 反而增加复杂度，可以暂时保留在 assistant.js；但统一 Runner 和 Vision Service 两个边界必须落地。

---

## 二十、目标业务流程

### 20.1 右侧识图：读取内置 Tag

    用户拖入新图
      ↓
    Images.add
      ↓
    currentVisionImageId = 新 imageId
      ↓
    vision.processOne({
      imageId,
      mode: "metadata"
    })
      ↓
    显示内置 Tag 和元数据

### 20.2 右侧识图：本地识图

    用户点击本地识图
      ↓
    vision.processOne({
      imageId: currentVisionImageId,
      mode: "local",
      model: 当前本地模型
    })
      ↓
    返回当前单图 Tag
      ↓
    折叠旧结果并显示本次结果

### 20.3 右侧识图：AI 识图

    用户点击 AI 识图
      ↓
    vision.processOne({
      imageId: currentVisionImageId,
      mode: "ai",
      instruction: 用户临时要求
    })
      ↓
    Prompts.getEffective("vision")
      ↓
    独立 vision API
      ↓
    返回描述和 Tag

### 20.4 助手模式查询 Tag

    用户询问某个姿势 Tag
      ↓
    主 AI 判断需要查询
      ↓
    tags.search
      ↓
    结果回传主 AI
      ↓
    普通回答

不注入绘图主提示词。

### 20.5 绘图模式只生成提示词

    用户输入画面要求
      ↓
    Draw Prompt
      ↓
    可选 tags.search
      ↓
    主 AI 输出最终 Tag

如果 ComfyUI 未连接，流程到此结束。

### 20.6 绘图模式复刻图片

    用户上传多张对话图片
      ↓
    主 AI选择其中一张 imageId
      ↓
    vision.processOne(imageId, "metadata" / "local" / "ai")
      ↓
    识图结果回传主 AI
      ↓
    主 AI生成复刻 Tag

没有独立 Recreate Runner。

### 20.7 绘图模式 ComfyUI 迭代

    用户要求实际绘制
      ↓
    capabilities 确认 comfy.render 可用
      ↓
    主 AI生成 Tag
      ↓
    comfy.render({ prompt, negative })
      ↓
    artifact imageId
      ↓
    主 AI直接看图，或 vision.processOne(imageId, "ai")
      ↓
    主 AI修改 Tag
      ↓
    再次 comfy.render，或输出结论

没有独立 ComfyIteration Runner。

### 20.8 外部 Agent

    Agent GET /tools/list
      ↓
    获取当前动态工具清单
      ↓
    POST /tools/call
      ↓
    Calls Registry
      ↓
    与应用内 AI 相同的 Tags / Vision / Comfy handler

---

## 二十一、明确保留的现有内容

下一阶段不应该重写以下已经有效的内容：

1. V1.4.2 风格的页面布局和交互习惯。
2. 当前 Tags 数据、分类、同义词和搜索索引。
3. WD EVA02 本地模型与预处理。
4. Images 的 PNG 元数据解析。
5. ImageStore 和 artifact 体系。
6. Prompts 的默认值、覆盖值、启用和恢复机制。
7. 用户预设和世界书数据。
8. 当前双 API 配置界面。
9. ComfyUI connector、工作流导入和占位符注入。
10. 当前 Storage 和 migrate。
11. 当前会话、消息编辑、删除、复制和重新生成。
12. Agent HTTP 与 MCP 入口。
13. 本地翻译模型。
14. AI 回合、工具次数和渲染次数分离。
15. 流式正文与 reasoning 分离。
16. 桌面 portable 打包方式。

重构重点是调用边界，不是重新制作整套工具箱。

---

## 二十二、明确删除或替换的内容

目标完成后应删除：

1. 四个用户可见 AI 模式切换。
2. 独立 runGenerate、runRecreate、runComfy 工具循环。
3. Vision 工具的 imageIds 数组参数。
4. Vision 根据 quick、talk、comfy collection 猜图片。
5. Calls handler 内部直接拼接 Vision 系统提示词。
6. 静态向所有 AI 暴露 comfy.render。
7. 应用内 AI 在 render 参数中随意修改 width、height、steps、cfg。
8. 页面为 Recreate 和 Comfy 单独维护重复的发送逻辑。
9. 旧式 COMFY 文本指令作为正式协议。
10. 为兼容旧四模式而长期保留的别名和分支。

用户已经明确：不需要为了旧调用方式制造长期兼容层。更新所有当前调用方后，可以直接删除旧入口。

---

## 二十三、推荐实施顺序

### 阶段 0：冻结文档和接口

目标：

- 以本文档为执行基线；
- 暂停继续修补旧四模式；
- 明确单图 Vision contract；
- 明确 Assistant/Draw 两模式 contract；
- 明确 Runtime 与 Admin 工具分组。

产出：

- 接口对象；
- 工具 schema；
- 统一 Result；
- capabilities 结构。

### 阶段 1：建立 Vision Service

修改：

- 新增 vision-service.js；
- 注入 Images、LocalVision、VisionAI 和 getPrompt；
- 实现 processOne；
- 实现 metadata、local、ai 三模式；
- AI 模式读取 prompts.getEffective("vision")；
- 统一返回结构；
- 一次只接受 imageId。

暂时保持页面不变，先让 Calls 能调用新服务。

验收：

- 同一张图三种模式都能调用；
- 传多个 imageId 被拒绝；
- AI 识图不带主会话历史；
- instruction 只作用于一次请求。

### 阶段 2：替换 Calls 的 Vision 工具

修改：

- 注册 vision.processOne；
- 页面、主 AI、Agent 改用新工具；
- 更新 manifest 和文档；
- 删除 vision.readMetadata、vision.localIdentify、vision.aiDescribe 的正式入口；
- 如果需要短暂过渡，只允许内部薄别名，并在同一阶段末删除。

验收：

- UI、主 AI、Agent 使用同一个 handler；
- 没有第二套识图提示词拼接。

### 阶段 3：修正右侧单图识图

修改：

- AppView 增加 currentVisionImageId；
- 新上传替换旧图；
- 取消旧请求；
- 自动读取 metadata；
- 本地和 AI 按钮只传 currentVisionImageId；
- 清理 quick collection 的隐式多图识图；
- 对话图片集合继续允许多图。

验收：

- 连续拖入两张图，第二次只识别第二张；
- 旧 Tag 不出现在新图结果中；
- 本地识图和 AI 识图目标一致；
- AI 工具调用也只处理明确单图。

### 阶段 4：动态能力与三个 Runtime Tools

修改：

- 实现 capabilities；
- 只保留 tags.search、vision.processOne、comfy.render；
- ComfyUI 未连接或工作流无效时移除 comfy.render；
- handler 保留运行时二次检查；
- Agent tools/list 返回可用状态。

验收：

- ComfyUI 关闭时主 AI看不到 render；
- ComfyUI 打开且工作流有效时工具出现；
- Tags 和 Vision 始终独立可用。

### 阶段 5：建立统一 AI Runner

修改：

- 抽出一个 AI/tool 循环；
- 保留 assistant 和 draw 两种 prompt profile；
- 统一图片、工具、事件、停止和错误；
- 统一 Result；
- 继续使用当前 Conversation；
- 保留三个独立计数器。

验收：

- 两个模式调用逻辑完全相同；
- 区别只来自 Prompt profile；
- 新增工具只改 Calls 注册和工具清单；
- 不再在四个函数中重复处理流式响应。

### 阶段 6：合并 UI 模式

修改：

- 模式条只保留“助手”和“绘图”；
- Generate、Recreate 和 Comfy 入口合并到绘图模式；
- ComfyUI 设置仍留在 API 设置页；
- 绘图模式根据输入和工具调用展示 Tag、返图和迭代过程；
- 保留消息复制、修改、删除、重发、思考折叠和工具轨迹。

验收：

- 助手模式无绘图 Prompt；
- 绘图模式可完成生成、复刻和迭代；
- 没有重复 AI 气泡；
- 多图对话和单图 Vision 不冲突。

### 阶段 7：Agent 设置接口分组

修改：

- Runtime 和 Admin 工具分组；
- ComfyUI 设置用 settings.comfy.get/update；
- 提示词设置继续走 prompts.*；
- agentWriteEnabled 只控制写工具；
- 更新 Agent 文档和 manifest。

验收：

- Agent 默认能查询、识图和绘图；
- 默认不能改设置和提示词；
- 开启写权限后才能调用 Admin 工具；
- 内置默认提示词仍不可破坏。

### 阶段 8：删除旧架构

删除：

- 四模式入口和别名；
- 旧 Vision 数组工具；
- 旧 Comfy 专用循环；
- 旧 Recreate 专用流程；
- 不再使用的 UI 控件；
- 不再使用的提示词协议分支；
- 过渡兼容代码。

更新：

- README；
- 架构文档；
- Agent 文档；
- VERSION；
- 桌面包。

---

## 二十四、建议的每阶段提交方式

遵守小步提交：

1. Vision contract 和空服务。
2. metadata 模式。
3. local 模式。
4. ai 模式与 Prompt 注入。
5. Calls 接入 Vision。
6. 右侧面板单图化。
7. 动态 capabilities。
8. 统一 Runner。
9. 两模式 UI。
10. Agent Admin 工具。
11. 删除旧四模式。
12. 文档与打包。

每一步：

- 只解决一个边界；
- npm run check 必须通过；
- 不在同一提交同时重写 UI、Vision、Runner 和 Agent；
- 同一问题修改两三次仍不稳定时先停下来报告，不无限换方案。

---

## 二十五、验收标准

### 架构

1. 主 AI 只有一个统一 Runner。
2. 用户可见模式只有 Assistant 和 Draw。
3. Assistant 与 Draw 的工具循环完全相同。
4. 模式差异只来自 Prompt profile。
5. Vision 是独立单图黑盒。
6. UI、主 AI 和 Agent 使用同一个 Vision handler。
7. Comfy connector 不知道 AI 和 Vision。
8. Calls 是所有工具能力的唯一业务入口。

### Vision

1. 一次只接受一个 imageId。
2. 支持 metadata、local、ai。
3. AI 模式读取 Prompts 的 vision 有效提示词。
4. instruction 不修改提示词。
5. AI 识图每次是独立请求。
6. 连续上传新图不会识别旧图。
7. 对话多图不会污染单图识图。

### AI

1. 助手模式不注入绘图业务提示词。
2. 绘图模式注入 Draw Prompt。
3. 两种模式都能查询和识图。
4. ComfyUI 可用时两种模式都能按需绘图。
5. ComfyUI 不可用时 AI 看不到 render 工具。
6. 文生图、复刻和迭代都由 Draw Runner 完成。
7. AI 回合、工具调用和渲染次数分别统计。

### Agent

1. Agent 使用与应用内 AI 相同的 Runtime Tools。
2. 设置和提示词修改属于 Admin Tools。
3. 写工具受 agentWriteEnabled 控制。
4. 内置提示词默认文本不可修改或删除。
5. 外部 Agent 文档完整，不需阅读源码。

### UI

1. 保留 V1.4.2 的主要布局和配色习惯。
2. 右侧识图面板只有一个当前图片。
3. 新图替换旧图并清空旧结果。
4. 多图只属于对话和 Comfy 上下文。
5. 工具调用、思考、返图和错误实时可见。
6. 消息复制、修改、删除、重发继续可用。

### 运行

1. npm run check 通过。
2. 桌面只保留一个最新测试版本目录。
3. 包含对应版本名 exe。
4. 模型和 node_modules 依赖齐全。
5. Agent /health 正常。
6. 不自动 push 或发布 Release，除非用户明确要求。

---

## 二十六、当前明确不做的内容

1. 不引入 React、Vue 或大型状态框架。
2. 不引入复杂 DI 容器。
3. 不把每个工具拆成一个服务进程。
4. 不增加账户、登录和远程权限系统。
5. 不把 Storage 改成复杂数据库。
6. 不重写标签数据和 WD 模型。
7. 不重写 ComfyUI connector。
8. 不重新制作整套 UI。
9. 不保留长期的旧四模式兼容层。
10. 不让 Vision 重新变成 Assistant 的内部函数。
11. 不允许页面直接组装 Vision Prompt。
12. 不允许外部 Agent 直接修改内置默认提示词。

---

## 二十七、仍需在实施前确认的少量策略

以下不是架构阻塞项，但新对话开始实施前可以快速确认：

1. Draw 模式在 ComfyUI 可用时，是否只有用户明确要求“出图”才调用 render。
   推荐：是。普通“帮我写提示词”只输出 Tag，不自动占用 GPU。

2. Assistant 模式是否允许调用 comfy.render。
   已讨论结论：允许，但只在用户明确要求且 ComfyUI 可用时。

3. Vision AI 是否默认缓存。
   推荐：metadata 和 local 可以缓存；ai 模式默认每次独立请求，不做长期结果缓存。

4. Agent 是否允许直接替换工作流。
   推荐：首阶段不开放；先只允许修改宽高、steps、cfg 和迭代次数。

5. Draw Prompt 的第一版是否继续组合 main + generate。
   推荐：是。先统一架构，再根据人工效果调整提示词内容。

---

## 二十八、给下一次新对话的直接执行说明

新对话可以直接引用本文档，并发送以下要求：

    阅读 F:\codex\rewrite-v1.4.3\项目当前架构与统一重构规划.md。

    以文档中“已经确认的下一阶段总体设计”为准执行重构。
    不把目标规划误认为当前已经实现的功能。

    第一阶段先实现独立 Vision Service：
    1. 单次只接受一个 imageId；
    2. mode 支持 metadata、local、ai；
    3. AI 模式从 Prompts 读取 vision 有效提示词；
    4. instruction 只作为本次附加要求；
    5. UI、主 AI 和 Agent 最终都调用同一个 vision.processOne。

    然后实现动态能力、统一 AI Runner 和 Assistant/Draw 两模式。
    不长期兼容旧四模式。

    保留现有 Tags、Images、Prompts、Storage、Conversation、
    Translation、Comfy connector、Agent Server、页面布局和数据。

    按文档阶段小步提交，每步运行 npm run check。
    最终重新打包桌面测试版本并停下等待人工反馈。

---

## 二十九、最终架构一句话总结

目标项目不是“四个 AI 功能页分别调用各自逻辑”，而是：

    一个统一 AI Runner
      +
    两种 Prompt 模式
      +
    三个核心运行工具
      +
    一个独立单图 Vision Service
      +
    一组仅供授权 Agent 使用的设置工具

即：

    Assistant / Draw
           ↓
       Unified Runner
           ↓
       Calls Registry
       ├─ tags.search
       ├─ vision.processOne
       └─ comfy.render

Prompts 管理规则，Images 管理图片，Vision 负责单图识别，Comfy 只负责连接和渲染，Assistant 负责会话与统一工具循环，Agent 只是另一个调用者。

这套设计符合项目最核心的目标：简洁、清晰、模块化、可扩展，并优先保证能快速交付可运行代码。
