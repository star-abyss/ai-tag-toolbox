# 本地角色库任务计划书

> 执行方式：本轮持续执行；使用 superpowers:executing-plans 和有明确文件边界的子任务，逐项验证。用户已授权计划后执行，无需二次确认。

**目标：** 将角色身份、作品和特征引用接入主页 Tag 及 AI，同时隔离隐藏专用词的常规搜索。

**架构：** 通用 Tag 字典、隐藏专用词表和角色资料分别保存。characters 模块负责惰性加载、索引、查询、引用展开、独立选择；普通 tags 模块只加载通用新增词。角色视图与 AI 共用这一模块。

**技术栈：** Electron、CommonJS、原生 DOM、JSON、Python 标准 CSV 构建、node:test 与既有 JSDOM。

**设计依据：** ../specs/2026-09-06-local-characters-design.md

## 全局约束

- 基于实际桌面 V1.4.197，最终 V1.4.198；三处版本统一，不 push。
- 无图片；来源明确标为上游 2024-11-14 快照，不宣称官网全量导出。
- 隐藏词表无独立 UI、普通 Tag 搜索或 AI 查询工具。
- 原始 ID、括号限定词、作品标识、原始 Tag 不丢失；不会将近义词强制等同。
- 原有用户数据和未覆盖的旧角色名保留，角色选择状态独立于普通 Tag。
- 每项完成 npm run check；不启动慢 UI/smoke 测试。

## 状态

- [x] 0. 核对桌面基线并在隔离分支保存 V1.4.197。
- [x] 1. 数据构建与本地角色模块。33,599 条来源记录；227 通用新增；804 隐藏词。
- [x] 2. AI 查询与生成工具接入。characters.search 与 characterIds 引用展开已通过工具测试。
- [x] 3. 主页角色列表、详情、作品筛选与选择栏。12 项 DOM 用例通过，包含快速切换页面时的搜索隔离。
- [ ] 4. 集成检查、审查、V1.4.198 桌面同步。44 项检查通过，等待最终桌面包校验。

## 1. 数据构建与角色模块

文件：scripts/build-characters.py、assets/数据资产/角色/{characters,specific-tags,manifest}.json、assets/数据资产/标签/character-general-tags.json、src/modules/characters.js、src/modules/tags.js、src/modules/index.js、tests/characters.test.cjs。

先写失败用例：隐藏词不进入 tags.search；精确中英文/作品查询；同名多个候选；adult false 不返回成人特征；旧角色 fallback；分页无 1,000 截断；独立选择恢复与不重复引用。再实现最小模块和数据构建。

```js
const chars = createCharacters({ tags, storage, data: { characters, specificTags, manifest } });
chars.page({ query: '初音', seriesId: '', precision: 'standard', offset: 0, limit: 50 });
// { items: [{id,name,nameZh,seriesId,seriesName,count,hasFeatures}], total, offset, limit, hasMore }
chars.get(id, { includeAdult: false });
// { id,name,nameZh,aliases,seriesId,seriesName,identityTags,generalTags,specificTags,hasFeatures }
// Tag details: { id,en,zh,category,nsfw }; specific rows may include review:true.
chars.series({ query: '', limit: 100 }); // [{id,name,count}]
chars.select(id, { generalTagIds: [], specificTagIds: [], includeSeries: true, includeAdult: false });
chars.selected(); // [{id,name,tags:[string]}]
chars.removeSelection(id); chars.clearSelection();
chars.selectionText(); chars.size(); chars.manifest();
```

数据构建只读预审源，按已确认通用词清单补英文、中文、分类；未确认项仍存角色专用表。对每个 tag 引用和角色计数断言，确定 JSON 文件不含图像字段。
运行 `node --test tests/characters.test.cjs` 验证红绿，再 `npm run check`，提交 `V1.4.198：构建本地角色资料与隐藏特征引用`。

## 2. AI 查询与生成工具

文件：preload.js、src/modules/{assistant,primary-tools,fixed-subagents}.js、assets/提示词素材/10-主AI固定提示词-PRIMARY_AGENT.txt、09-固定生成Tag子代理-GENERATE_TAGS_AGENT.txt、tests/character-tools.test.cjs、scripts/check.mjs。

消费任务 1 的 characters.get/page。通过 preload 实例化 characters 并注入 assistant 和 AppModules。增加 characters.search 输出 schema，严格限制条数；generateTags 的 characterIds 由工具内部展开为 characterReferences。

```js
await tools.call('characters.search', { query: '初音未来', limit: 5 });
await tools.call('agent.generateTags', { requirements: '初音未来穿白裙', characterIds: ['hatsune_miku'] });
```

失败测试核对 hidden Tag 仅经角色返回；关联不存在时报清楚的工具错误；多人参考具有角色 ID；旧调用不带 characterIds 仍正常。更新固定工具数量 guard，保持 3 个固定子代理。
运行针对性测试及 `npm run check`，提交 `V1.4.198：接入角色查询和带归属的生成参考`。

## 3. 主页角色视图

文件：src/views/characters-view.js、src/app-view.js、src/index.html、src/characters.css、tests/characters-view.test.cjs、locales/{zh-CN,en-US}.json（仅有必要时）。

新视图工厂遵循 AppViews：

```js
createCharactersView({ document, characters, onChange, copy, notify, getLocale });
// render({query,precision,includeAdult}), selection changed -> onChange()
```

“人物与角色”保留普通标签，下面的“角色库”替代旧角色名入口。列表 50 条/页、可搜索作品/来源、右侧详情、特征复选框、明确加入操作。无隐藏表管理界面。
头部搜索框根据当前角色范围调用新视图，不额外创建第二个角色名搜索框。选择栏同时展示原 Tag 与角色组合，移除/清空/复制行为一致。
JSDOM 验证真实 DOM 点击、筛选、清空、翻页、恶意字符安全显示、空态、中文英文切换。使用既有图标/按钮形式和主题变量，无卡片套卡片、无远程资源。
完成本地独立测试，主任务负责运行整套 `npm run check` 与提交 `V1.4.198：增加主页角色检索与详情选择`。

## 4. 交付

核对任务 1-3 的接口调用一致，针对分类、旧收藏、独立选择、错误状态审查。运行最终 `npm run check`，保存摘要。package.json、VERSION.txt、index.html 以及可见版本标识更新到 V1.4.198。
使用现有桌面 V1.4.197 运行时作模板，同步源码到 app/，打包 resources/app.asar，改名 exe。桌面旧测试目录从桌面移至工作区备份，最终桌面只保留最新测试版；不删除源代码备份目录。
任务书和设计书同时放进最终桌面包，记录数据行数、通用新增词数、隐藏词数、已知数据限制。提交并等待人工反馈。
