# 外部 Agent 协议约定

V1.4.191 使用本地 HTTP JSON-RPC 风格调用。所有调用最终进入 `Calls Tool Registry`，协议层不包含业务逻辑。

## 列出工具

```http
GET http://127.0.0.1:32145/tools/list
```

## 调用工具

```http
POST http://127.0.0.1:32145/tools/call
Content-Type: application/json
```

```json
{
  "id": "request-1",
  "tool": "vision.processOne",
  "arguments": {
    "imageId": "img_abc123",
    "mode": "ai",
    "instruction": "重点分析角色姿势"
  }
}
```

工具名使用稳定的业务名称，不要使用源码函数名。返回结果统一包含 `ok`；失败包含 `code` 和 `error`。

工具列表是动态的；客户端应在每次任务前重新请求 `/tools/list`，不要缓存 `comfy.render` 的可用状态。
返回的每个工具都带有 `group`：`runtime` 表示日常查询/识图/绘图能力，`admin` 表示会修改应用设置或提示词的管理能力。默认只返回 Runtime；用户在应用设置中打开“允许外部 Agent 修改提示词和 ComfyUI 迭代设置”后，才会返回 Admin 工具。响应中的 `permissions.write` 和 `groups` 可用于显示当前权限。

即使客户端绕过工具列表直接调用 Admin 名称，服务端仍会再次检查权限并返回 `PERMISSION_DENIED` 或 `AGENT_TOOL_UNAVAILABLE`。

## MCP

也可以把 `agent-tools/mcp-server.js` 配置为 MCP stdio server。它会转发到应用的本地 HTTP 服务：

```json
{
  "mcpServers": {
    "ai-tag-toolbox": {
      "command": "node",
      "args": ["<应用目录>/agent-tools/mcp-server.js"]
    }
  }
}
```

应用需要先启动，默认端口为 `32145`；自定义端口时同时设置 `AITAG_AGENT_PORT`。
