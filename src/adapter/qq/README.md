# QQ NapCat 适配器

## 概述

NapCat 反向 WebSocket 适配器允许 ArxsBot 连接到 NapCat（QQ 机器人框架）。

## 架构流程

```
OneBot11 消息 (JSON)
    ↓
NapcatClient (reverse WS server, port 6090)
    ↓
qqEventMapper (转换为 ArxsBot Event)
    ↓
Dispatcher (路由 + 意图识别)
    ↓
Handlers (生成 Actions)
    ↓
qqActionAdapter (转换回 OneBot11 格式)
    ↓
WebSocket 发送回 NapCat
```

## 配置

在 `config/default.yaml` 中配置：

```yaml
adapters:
  qq:
    enabled: true           # 是否启用 QQ 适配器
    wsPort: 6090           # 反向 WS 服务监听端口
```

## OneBot11 消息格式

目前仅支持文本消息。格式示例：

```json
{
  "time": 1234567890,
  "self_id": 1000000,
  "post_type": "message",
  "message_type": "group",
  "group_id": 123456,
  "user_id": 987654,
  "message_id": 1,
  "message": [
    {
      "type": "text",
      "data": { "text": "Hello bot!" }
    }
  ],
  "raw_message": "Hello bot!",
  "sender": {
    "user_id": 987654,
    "nickname": "TestUser",
    "card": "TestUser"
  }
}
```

## 测试适配器

1. 启动 bot：
```bash
pnpm dev
```

2. 在另一个终端测试 NapCat 消息：
```bash
tsx scripts/test-napcat.ts
```

3. 预期输出：
```
→ Sending test message: Hello bot!
← Received response from bot:
{
  "action": "send_group_msg",
  "params": {
    "group_id": 123456,
    "message": [
      {
        "type": "text",
        "data": {
          "text": "Hello bot! (echo)"
        }
      }
    ]
  }
}
```

## 支持的操作

### send_group_msg（发送群消息）

目前仅实现了群组消息发送。消息包含模拟的人类延迟（900-1500ms）以显得更自然。

```json
{
  "action": "send_group_msg",
  "params": {
    "group_id": 123456,
    "message": [
      {
        "type": "text",
        "data": { "text": "Response message" }
      }
    ]
  }
}
```

## 未来改进

- [ ] 支持私聊消息
- [ ] 支持多种消息类型（图片、语音、文件等）
- [ ] 支持更多 OneBot11 操作（react、recall、kick 等）
- [ ] 连接管理和自动重连
- [ ] 鉴权/密钥验证
- [ ] 多连接支持
