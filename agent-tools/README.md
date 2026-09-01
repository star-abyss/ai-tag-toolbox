# 外部 Agent 工具入口（V1.4.131）

应用启动后会自动开启本地工具服务。

- 说明：[外部Agent工具说明.md](./外部Agent工具说明.md)
- 机器清单：[tools.manifest.json](./tools.manifest.json)
- 协议：[protocol.md](./protocol.md)
- MCP 入口：`mcp-server.js`
- 默认地址：`http://127.0.0.1:32145`

外部 Agent 不需要读取 `src/` 源码，只需调用 `/tools/list` 获取工具定义，再向 `/tools/call` 发送工具名和参数。
