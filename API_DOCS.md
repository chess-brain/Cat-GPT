# CatGPT API 文档

## 认证

- Header 支持两种方式之一：
  - `Authorization: Bearer cat_xxx`
  - `X-API-Key: cat_xxx`

API Key 需在控制台创建（登录管理员后进入 `/console`）。

## 1) 发送消息

`POST /api/v1/messages`

请求体：

```json
{
  "sessionId": "可选，不传则自动创建",
  "content": "你好",
  "deepThink": true,
  "webSearch": false
}
```

返回：

```json
{
  "id": "message_id",
  "sessionId": "session_id",
  "status": "queued",
  "createdAt": 1717050000000
}
```

## 2) 拉取消息

`GET /api/v1/messages?sessionId=xxx`

返回：

```json
{
  "sessionId": "xxx",
  "pending": true,
  "pendingCount": 1,
  "messages": [
    {
      "id": "message_id",
      "role": "user|assistant",
      "content": "文本",
      "status": "pending|answered|sent",
      "createdAt": 1717050000000
    }
  ]
}
```

## 说明

- 本项目是人工后台回复模型，`status=queued`/`pending=true` 表示等待后台人员回复。
- 拿到 `sessionId` 后持续轮询 `GET /api/v1/messages` 即可获取回复。

