# AI 绘画 Tag 工具箱 V1.4.191 · 外部 Agent 工具接口

## 连接方式

应用启动后会自动提供本地 JSON-RPC 风格 HTTP 服务：

```text
地址：http://127.0.0.1:32145
工具列表：GET /tools/list
调用工具：POST /tools/call
健康检查：GET /health
```

也可以设置环境变量 `AITAG_AGENT_PORT` 覆盖端口。工具服务只在本机运行。

请求示例：

```json
{
  "id": 1,
  "tool": "tags.search",
  "arguments": {
    "query": "blue hair",
    "limit": 30
  }
}
```

调用返回统一格式：

```json
{
  "id": 1,
  "ok": true,
  "data": {}
}
```

失败时：

```json
{
  "id": 1,
  "ok": false,
  "code": "TOOL_ERROR",
  "error": "错误说明"
}
```

完整机器可读定义见同目录的 `tools.manifest.json`。

## 工具分组与权限

`GET /tools/list` 返回当前可用的工具，并为每项标记 `group`：

- `runtime`：默认可用的 Tag 查询、单图识图、ComfyUI 出图（可用时）、提示词读取和 ComfyUI 设置读取；
- `admin`：会修改提示词或 ComfyUI 设置的管理工具。

默认 Agent 只看到 Runtime 工具。用户在应用“API 设置 → 外部 Agent 工具接口”中打开“允许外部 Agent 修改提示词和 ComfyUI 迭代设置”后，列表才会增加 Admin 工具。服务端会在列出和执行两个环节都检查权限，不能通过手写工具名绕过开关。

## 工具说明

### `tags.search`

查询 Tag 库。支持英文、中文和别名。

```json
{
  "tool": "tags.search",
  "arguments": {
    "query": "蓝发",
    "category": "hair",
    "includeAdult": false,
    "limit": 50
  }
}
```

### `vision.processOne`

统一的单图识图入口。一次调用必须传入一个明确的 `imageId`，不接受 `imageIds` 数组，也不会从页面集合猜图片。

`mode` 有三种：

- `metadata`：读取 PNG 内置 Tag、生成参数和 ComfyUI 工作流；
- `local`：使用本地 WD EVA02 模型提取常见绘图 Tag；
- `ai`：使用独立识图 API 分析图片。

```json
{
  "tool": "vision.processOne",
  "arguments": {
    "imageId": "img_abc123",
    "mode": "ai",
    "instruction": "重点分析人物姿势、手部动作和镜头角度"
  }
}
```

`model` 只对 `local` 模式有意义。`instruction` 是本次临时附加要求，不能替换识图主提示词，也不会修改提示词库。返回的 `data` 始终对应这一张图片。

`GET /tools/list` 会根据当前状态动态返回工具：ComfyUI 未启用、未连接或工作流无效时，不会列出 `comfy.render`。主 AI 的 `comfy.render` schema 只接受 `prompt` 和可选 `negative`，尺寸、步数、CFG 和工作流读取用户设置。提交前会按工作流节点连接关系覆盖固定字面量参数，无法覆盖时返回具体节点错误。

### `comfy.render`

调用当前 ComfyUI 工作流生成一张图片。返回结果中的 `data.artifact.id` 可用于后续读取。

```json
{
  "tool": "comfy.render",
  "arguments": {
    "prompt": "1girl, blue hair",
    "negative": "lowres, bad hands",
    "width": 1024,
    "height": 1520,
    "steps": 30,
    "cfg": 5
  }
}
```

### Runtime：提示词与 ComfyUI 设置读取

```text
prompts.list
prompts.read
settings.comfy.get
```

`settings.comfy.get` 返回当前启用状态、宽高、步数、CFG、负面 Tag、采样器/调度器、迭代次数和工作流是否有效。ComfyUI 的连接与工作流状态也会反映在 `/tools/list` 的 `capabilities.comfy` 中。

### Admin：提示词与 ComfyUI 设置修改

```text
settings.comfy.update
settings.comfy.setIterations
prompts.create
prompts.update
prompts.delete
prompts.enable
prompts.reset
```

`settings.comfy.update` 只更新传入字段，支持 `width`、`height`、`steps`、`cfg`、`negative`、`sampler`、`scheduler`、`workflow` 和 `comfyOn`。数值会被限制在安全范围内，非法 API 工作流会被拒绝。

内置默认提示词永远不能修改或删除。主提示词和识图主提示词可以修改当前覆盖值，但不能删除；点击恢复默认会清除覆盖值并重新启用。自定义提示词可以新建和删除。

### ComfyUI 迭代设置

`settings.comfy.setIterations` 的迭代次数范围为 1–10。修改设置需要在应用中打开“允许外部 Agent 编辑”开关。

## 外部 Agent 权限

默认允许查询、识图、读取提示词和在 ComfyUI 可用时调用渲染。渲染返回的 `artifact.id` 可直接交给 `vision.processOne` 做单图分析。

打开编辑权限后，才允许：

- 修改主提示词或识图主提示词的当前覆盖值；
- 停用内置提示词；
- 新建、修改和删除自定义提示词；
- 修改 ComfyUI 最大迭代次数。

内置默认文本和内置提示词 ID 始终受到保护。

### Agent 扩展 Runtime 工具

桌面版还提供以下只读 Runtime 能力：`tags.describe`、`assets.listModels`、`comfy.submit`、`comfy.getResult`、`comfy.objectInfo`、`comfy.cancel` 和 `comfy.getImage`。`vision.processOne` 也可在外部 Agent 只提供一个本地 `imagePath` 时自动登记图片；仍然只处理这一张图片。
