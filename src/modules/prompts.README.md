# Prompts 模块（V3）

`prompts.js` 现在是主提示词组 + 扩展提示词的存储与管理模块。它读取
`assets/提示词素材` 下的素材文件作为「默认内容」，所有运行时编辑都保存在
storage（默认键 `rewrite_prompt_state`）。

```js
const path = require('node:path');
const { createPrompts } = require('./prompts');

const prompts = createPrompts({
  dir: path.join(__dirname, '..', '..', 'assets', '提示词素材')
});

// 主提示词组：固定 6 个条目，可多组、可整体切换。
const sets = prompts.sets();            // [{ id, name, items }]
prompts.setActive(sets[1].id);          // 批量切换（6 个条目一起换）
const system = prompts.get('primary');  // 当前组的主 AI 提示词

// 扩展提示词：只进入主 AI 请求，由系统匹配。
prompts.createExtension({
  name: '角色替换规则',
  text: '把角色 A 替换成 B',
  activation: { mode: 'keywords', keywords: ['角色替换', '换角色'] }
});
const request = prompts.composePrimary('做一次角色替换');

// 文生图 Tag 子代理 = 文生图提示词 + 画师与品质词参考提示词。
const tagsPrompt = prompts.composeGenerate();

// 候选图评估子代理使用独立提示词。
const evaluationPrompt = prompts.composeEvaluation();
```

## 主提示词组

- 固定包含 6 个条目：`primary`、`generateTags`、`artistQuality`、`vision`、`candidateEvaluation`、`translation`。
- 条目不允许单独增加/删除，只允许整组批量切换、批量导入导出；条目内容可以单独编辑。
- 新建提示词组自动创建 6 个空白条目；切换提示词组时 6 个条目整体切换。
- 当前使用的提示词组是主 AI 与全部固定子代理的提示词来源。

素材键与文件（默认内容）：

| 键 | 文件 |
| --- | --- |
| `primary` | 10-主AI固定提示词-PRIMARY_AGENT.txt |
| `generateTags` | 09-固定生成Tag子代理-GENERATE_TAGS_AGENT.txt |
| `artistQuality` | 11-画师与品质词参考提示词-ARTIST_QUALITY.txt |
| `vision` | 04-识图描述提示词-DEFAULT_VISION_PROMPT.txt |
| `candidateEvaluation` | 12-候选图评估提示词-CANDIDATE_EVALUATION.txt |
| `translation` | 08-固定翻译子代理-TRANSLATION_AGENT.txt |

## 扩展提示词

- 允许新增、删除、编辑、导入、导出、单独启用/停用。
- 只对主 AI 生效：不发送给识图、翻译、文生图 Tag 子代理。
- 启用方式二选一：
  - `always`（常驻）：启用即发送；
  - `keywords`（关键词匹配）：用户输入包含任一关键词时发送。
- 匹配由系统完成（`matchExtensions` / `composePrimary`），AI 不参与判断。

## 请求组成

- 主 AI：当前组 `primary` + 匹配成功的扩展提示词 + 会话上下文 + 用户输入 + 固定工具定义。
- 文生图 Tag 子代理：当前组 `generateTags` + 当前组 `artistQuality` + 需求 + 可选图片/已有 Tag/参考 Tag。
- 识图子代理：当前组 `vision` + 参考 Tag + 图片。
- 候选图评估子代理：当前组 `candidateEvaluation` + 用户要求 + 候选图；复刻模式还包含参考图。
- 翻译子代理：当前组 `translation` + 待翻译文本。AI 翻译页启用 `includeAlignment` 时，程序在当前提示词后追加对照协议，并提供完整原文、方向与稳定 `sourceUnits`；要求返回完整译文及关联 ID 的 `targetSegments`。该协议也适用于用户已保存的旧提示词组，对照无效时保留普通译文。

## 包格式

- 全量包：`{ format: 'ai-tag-prompts', version: 3, activeSetId, sets, extensions }`（批量导出/导入，替换现有全部状态）。
- 单组包：`{ format: 'ai-tag-prompt-set', version: 1, name, items }`（导入后追加为新提示词组）。
- 扩展包：`{ format: 'ai-tag-prompt-extensions', version: 1, extensions }`（导入后追加）。
- 兼容旧版 v2 五条目包、v1 包（`ai-tag-prompts` v1：internal/external）与旧版持久化状态（`{ overrides, enabled, custom }`）。v2 中缺少的 `candidateEvaluation` 自动使用素材默认值，显式空白的旧条目保持空白。

这是 CommonJS/Node 模块。Electron 的 preload 可以创建一个实例后注入页面，
也可以直接由 Assistant 使用；页面不需要知道素材文件路径。
