# AI 绘画 Tag 工具箱 V1.4.3

Windows 便携式 AI 绘画提示词工作台。它把 Tag 搜索、离线角色资料、AI 助手、ComfyUI 出图、图片管理和中英翻译放在一个本地应用里。

当前发布版为 **V1.4.356**：合并 PR #2，修复 AI 识图成功后不显示描述、请求失败显示 [object Object] 的问题。图库、会话和设置继续共用原数据目录。见 [V1.4.356 交付说明](交付说明-V1.4.356.md)。

## 下载

- [下载 V1.4.356 Windows 测试版（7z）](https://github.com/star-abyss/ai-tag-toolbox/releases/download/v1.4.356/AI.Tag.V1.4.356.7z)
- [查看 V1.4.356 发布页](https://github.com/star-abyss/ai-tag-toolbox/releases/tag/v1.4.356)

V1.4.356 解压后双击根目录的 AI绘画Tag工具箱.exe。V1.4.355 用户也可点击左上角版本号，选择 V1.4.356 安装。

- [下载 V1.4.3 Windows 便携包（7z）](https://github.com/star-abyss/ai-tag-toolbox/releases/download/v1.4.3/AI.Tag.V1.4.3.7z)
- [下载 V1.4.32 Windows 测试版（7z）](https://github.com/star-abyss/ai-tag-toolbox/releases/download/v1.4.32/AI.Tag.V1.4.32.7z)
- [查看 V1.4.3 更新说明](更新说明-V1.4.3.md)
- [查看 V1.4.32 测试版说明](交付说明-V1.4.32.md)
- [查看全部 Release](https://github.com/star-abyss/ai-tag-toolbox/releases)

下载并解压后，双击 `AI绘画Tag工具箱V1.4.3.exe` 即可运行，不需要安装 Node.js 或 Electron。便携包包含 Electron 运行时、依赖、Tag 素材、34,122 个离线角色资料、WD EVA02 本地识图模型和离线翻译模型。

V1.4.32 是基于 V1.4.3 的 Pre-release 测试版，包含 DeepSeek thinking 模式兼容修复和原创人物跳过角色确认功能；解压后运行 `AI绘画Tag工具箱V1.4.32.exe`。

## 主要功能

### Tag 与角色库

- 普通 Tag 支持英文、中文、别名、分类、成人内容开关和精确/标准/宽松搜索。
- 独立角色库收录 34,122 个角色，显示角色名、作品出处、身份 Tag 和可选外貌 Tag。
- 角色专用词只在角色资料引用时使用，不混入普通 Tag 搜索，避免阵营、学校等词污染常规词库。
- 角色页面支持按名称、作品检索，角色资料可单独选择身份与外貌；复制时不会强制带入全部外貌词。

### 快捷收藏

- 系列横向并列、条目竖向排列，支持子分类、系列配色、排序和折叠。
- 保存单标签、标签组或自录原文，附中文说明、别名与备注；复制保留空格、权重、转义和换行。
- 收藏内部搜索支持命中高亮、定位和返回；关闭全局查询的条目仍可内部查找。
- 自动保存、批量整理、撤销重做、最近复制、缩放，以及 TSV/逐行录入和 JSON 备份。
- 底部收藏组合使用独立快照，后续修改收藏不会改写当前 Prompt。

### AI 助手与生图

- 主 AI 负责理解用户要求、直接观察图片并调度必要模块；文生图 Tag 和辅助识图按需调用，主 AI 在每轮候选图下公开评价、差异和下一步。
- 支持普通绘图、参考图复刻、角色替换、候选评价、自动迭代和手动点评。
- 每轮可生成 1–10 张图片；自动迭代最多 1–10 次 ComfyUI 调用，两个入口使用同一份设置。
- 同一轮候选横向排列，方便对比；最终提示词复制只提供正向 Tag，或直接选择最终图片。
- 点击“最终选择”会立即停止后续工作；无变化的 Tag 修订会被拦截，避免浪费 ComfyUI 调用。

### ComfyUI

- ComfyUI 有独立配置页，可从 API 工作流 JSON 导入并分析节点。
- 支持配置档、提示词节点、采样器、尺寸、批量数量、输出节点，以及显式参考图/Control 绑定。
- 复杂工作流无法安全猜测节点时会要求明确绑定；没有参考图绑定会明确标记为“文本近似复刻”。
- 对话页的调试入口可直接打开 ComfyUI 配置页，状态、队列和工作流诊断可在页面查看。

### 图片与调试

- 对话图片和独立图库分开管理；清空对话图片会移除当前会话引用，并清理没有其他引用的图片文件。删除对话时默认清理其中图片，也可勾选转存图库。
- 调用监视器记录主 AI、工具和子代理的请求、返回、事件和 Token，用独立滚动区域显示长内容。
- 监视器写入前会隐藏 API Key、图片像素和已识别的本地路径，日志保存在 `%APPDATA%\ai-tag-toolbox-rewrite\debug\ai-calls.json`。

### 翻译与对照

- 支持本地 Tag 翻译和 AI 双向翻译。
- AI 翻译关闭思维链并使用非流式请求，按钮会显示旋转加载图标和“AI 翻译中…”。
- 有效对照数据支持原文/译文双向选区高亮、悬停预览、点击固定和 `Esc` 清除。
- 重复词、语序变化、一对多/多对一和模型漏写逗号都能保留可用关联；对照无效时仍显示完整普通译文。

## 快速开始

1. 解压便携包并启动程序。
2. 在“API 设置”填写 OpenAI 兼容接口地址、模型名和 API Key；识图 API 可以沿用主 API 或单独配置。
3. 需要出图时，在“ComfyUI 配置”填写本机地址并导入 API 格式工作流，检查提示词和参考图节点绑定。
4. 在对话页输入要求。提到角色名称或不确定 Tag 时，主 AI 会先查询本地库；角色名有歧义时按页面提示选择。
5. 需要多轮生成时选择自动或手动模式，比较候选后点击最终选择。

## 开发与验证

源码仓库不包含 `models/` 和 `node_modules/`。开发者先运行 `npm ci` 安装检查所需依赖，再运行 `npm run check`；UI 测试使用项目本地的 jsdom，不依赖开发机绝对路径。直接使用应用请下载上方便携包；本地识图、翻译和 Electron 开发仍需准备对应的可选运行时与模型。

```text
npm ci
npm run check
npm run dev
```

`npm run check` 执行全部维护源码/脚本/测试的 Acorn 语法扫描、21 条 ESLint 正确性规则、架构护栏、模块测试、jsdom 页面测试和历史回归测试。收藏覆盖包含迁移、原文复制、搜索分页、保存失败恢复、真实模块与页面联动；最终计数记录在桌面包 `build-info.json`。纯数据性能测试可运行 `node scripts/benchmark-favorites.mjs`。Electron 布局、系统剪贴板、实际关窗、真实 AI 和 ComfyUI 出图留给人工验收，本轮不调用付费接口、不推送、不发布。

主要目录：

| 路径 | 作用 |
| --- | --- |
| `main.js` / `preload.js` | Electron 启动和本地模块桥接 |
| `src/app-view.js` / `src/views/` | 页面路由和各页面交互 |
| `src/modules/agent-runtime.js` / `primary-tools.js` | 主 AI 工具循环和输入输出边界 |
| `src/modules/generation-orchestrator.js` | 生图、评价、修订和最终选择状态机 |
| `src/modules/comfy*.js` | ComfyUI 配置、工作流解析和 HTTP 调用 |
| `src/modules/characters.js` / `tags.js` | 离线角色资料和普通 Tag 词库 |
| `src/modules/translation-alignment.js` / `views/translation-view.js` | 翻译对照协议和双向高亮 |

## 已知边界

- 生图效果取决于使用的文生图模型、提示词和 ComfyUI 工作流。
- 复杂工作流的参考图、Denoise、Control 和尺寸节点需要在配置页明确绑定，程序不会猜测并修改未知节点。
- 角色库不包含缩略图、原图或 LoRA 文件；角色外貌仅作为可选 Tag 参考。
- 对照高亮依赖 AI 返回正确的片段关联；缺失或不可信的关联会安全降级为普通译文。
- 用户设置、对话和图片存放在 AppData，不会随桌面程序目录迁移。

从 V1.4.191 或更早版本升级前，请备份旧版用户数据、提示词和工作流。新版使用不同的设置/会话结构，不保证自动迁移旧版全部数据，API 与 ComfyUI 可能需要重新配置。V1.4.239 升级到 V1.4.3 沿用同一套数据结构。旧外部 Agent Server/Runtime/Admin 接口已移除，调用监视器提供本地调试记录。

## 许可证与数据来源

角色资料基于 [Laxhar/noob-wiki 的固定公开快照](https://huggingface.co/datasets/Laxhar/noob-wiki/tree/929c972dcc8aeecde42b7cd8931afe82cd864424) 整理，另保留原词库的角色补充。数据集卡标注 Apache-2.0；来源、快照修订和数量见 [角色清单](assets/数据资产/角色/manifest.json)。该标注不代表 AniMadex 网站完整内容或图片的授权。运行时及模型保留随包附带的第三方许可证。

模块关系和接口说明见 [当前架构文档](项目当前架构与统一重构规划.md)，历次变化见 [CHANGELOG](CHANGELOG.md)。
