# AI 绘画 Tag 工具箱 V1.4.1

本地 AI 绘画提示词工作台（Windows 便携版）。面向画师与 AI 绘画爱好者：把图片/想法快速变成可直接使用的提示词。

## 📥 下载

👉 **[Releases 下载页](https://github.com/star-abyss/ai-tag-toolbox/releases)**

- 下载最新 `AI.Tag.Vx.x.x.7z`，解压后运行 `AI绘画Tag工具箱.exe`，**无需安装、无需联网**。
- 若提示缺少模型，请确保 `models/` 目录与 exe 同目录放置（已包含在 7z 内）。

## ✨ 功能

- **18093 条本地标签库**：分类浏览、中英文搜索、收藏组合、自定义标签
- **本地识图（WD EVA02）**：完全离线，不消耗 API，识别图片后一键出 Tag
- **离线中英翻译**：本地模型翻译，不联网
- **双向 AI Tag 翻译**：中文描述 → 标准 Tag、Tag → 中文，自动携带本站多译名对照
- **中英文界面**：支持自动检测、手动切换和 JSON 语言包扩展
- **长耗时 AI 请求**：默认不自动截断，可选 300～3600 秒自动停止；对话、翻译和识图显示已用时
- **AI 助手四种模式**：
  - 💬 对话：自由问答，支持附图
  - ✨ 生成Tag：描述 → 最终提示词
  - 🎯 复刻：图片 → 本地识图 → 视觉描述 → 最终提示词
  - 🎨 迭代：AI + ComfyUI 自动出图并多轮改进
- **图片元数据解析**：读取 AI 原图内嵌提示词（A1111 / NovelAI / ComfyUI）
- **世界书（拓展提示词）与提示词预设**：可导入导出、按模块启用
- **多会话管理**：历史消息编辑、重新生成、归档
- **兼容主流服务商**：OpenAI / DeepSeek / SiliconFlow / Moonshot / 阿里云百炼 / Ollama / 自定义接口

## 🚀 快速开始

1. 下载 7z 解压，运行 `AI绘画Tag工具箱.exe`；
2. 顶部「🤖 AI 助手」进入工作台，选择模式；
3. 在「⚙️ API 与 ComfyUI」填写你的模型接口（本地识图与翻译不需要 API Key）；
4. 上传/粘贴/拖入图片即可开始。

## 🛠 从源码运行（开发者）

```bash
npm install          # 安装依赖（onnxruntime-node 等）
npx electron .       # 启动开发版
```

- 本地模型放在 `models/`：`wd-eva02-tagger-2026-canary.onnx`（识图）、`translation/`（离线翻译）。
- 自测：`npx electron . --uitest`（UI 集成测试）、`npx electron . --smoke <图片> eva02`（识图冒烟）。
- 国际化自测：`npx electron . --i18ntest`；错误提示自测：`npx electron . --errortest`。

## 🌐 语言包

- 内置 `zh-CN` 和 `en-US`，顶部“文/A”菜单可立即切换。
- 第三方语言包使用 JSON 数据格式，导入后保存在用户数据目录；语言包不能执行脚本。
- 语言包可只覆盖部分界面、分类或 Tag，未翻译内容按 English → 简体中文回退。

## 📁 目录结构

```
src/
  index.html        单页界面
  js/               按域拆分的前端模块（标签库/对话/提示词/世界书/ComfyUI/翻译…）
  css/app.css       样式
  extra-tags.js     扩展标签数据
main.js             Electron 主进程（窗口/识图推理/翻译/ComfyUI 桥）
preload.js          安全桥接
tests/test-modes.js 自测模式
```

## 📜 许可与说明

- 个人项目，功能以实际版本为准；
- 标签数据与翻译模型来自开源社区对照表，仅供学习与创作使用；
- 使用第三方 AI 接口时请遵守服务商条款。

**历史版本与更新日志见 [Releases](https://github.com/star-abyss/ai-tag-toolbox/releases)。**
