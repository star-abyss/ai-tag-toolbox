# AI 绘画 Tag 工具箱 V1.4.3

Windows 便携式 AI 绘画提示词工作台。它把 Tag 搜索、离线角色资料、AI 助手、ComfyUI 出图、图片管理和中英翻译放在一个本地应用里。

## 下载

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

### AI 助手与生图

- 主 AI 负责理解用户要求、查询 Tag/角色和调度任务；文生图 Tag、识图、评价和修订由固定子代理与程序状态机处理。
- 支持普通绘图、参考图复刻、角色替换、候选评价、自动迭代和手动点评。
- 每轮可生成 1–10 张图片；自动迭代最多 1–10 次 ComfyUI 调用，两个入口使用同一份设置。
- 同一轮候选横向排列，方便对比；可查看并分别复制正向 Tag、负向 Tag，或直接选择最终图片。
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

源码仓库不包含 `models/` 和 `node_modules/`。当前依赖清单尚未整理为完整独立安装流程，部分测试依赖开发机路径；直接使用应用请下载上方便携包。开发者需先准备 Electron、ONNX/Transformers 依赖及 jsdom 测试环境。

```text
npm run check
npm run dev
```

`npm run check` 执行架构护栏、模块测试、jsdom 页面测试和历史回归测试。本版本发布检查共 172 项通过。此前已进行本地接口模拟和浏览器交互验证，用户已确认当前内部版本可用；本次升版不重新运行付费 AI 和 ComfyUI 出图。

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
