# 通用 REST API 集成指南（L3 兜底：识别不出技术栈时的手动接入方式）

无论你的项目是什么技术栈，都可以直接调用 `conversation-core`（骨架必装）暴露的 REST API。是否再装 `realtime-translation` / `meeting-ops`，取决于你是「单目标」还是「多目标扇出」场景（见下方两条路径）。

## 0. 启动骨架

```bash
cd capabilities/conversation-core
cp .env.example .env   # 填好三把钥匙
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python -m src.server   # 默认 0.0.0.0:8020
```

## 1. 骨架通用接口

| Method | Path | 说明 |
|---|---|---|
| GET | `/api/v1/health` | 三把钥匙实时自检 |
| POST | `/api/v1/usersig` | 给任意 user_id 签发 UserSig（供旁听客户端等场景使用） |
| POST | `/api/v1/agent/start` | 起一路会话（单目标，room_id 由你给定） |
| POST | `/api/v1/agent/stop` | 停一路会话 |
| POST | `/api/v1/agent/control` | 文本注入 / 打断 |

## 2. 场景 A：单目标翻译（给一个人配一路 AI 翻译）

装 `realtime-translation` 后新增：

| Method | Path | 说明 |
|---|---|---|
| GET | `/api/v1/translation/modes` | 列出可用语言对（zh-en / zh-yue / en-yue） |
| POST | `/api/v1/translation/start` | 给单一目标起一路翻译会话 |
| POST | `/api/v1/translation/stop` | 停止 |

```bash
curl -X POST https://localhost:8020/api/v1/translation/start \
  -H "Content-Type: application/json" \
  -d '{
    "room_id": "你的房间号",
    "room_id_type": 0,
    "target_user_id": "要被翻译的那个人的 userId",
    "mode": "zh-en"
  }'
```

返回 `session_id`，之后用它调用 `/api/v1/translation/stop` 结束。

## 3. 场景 B：多目标扇出（多人房间，谁说话都翻译）

装 `meeting-ops`（依赖 `realtime-translation`）后新增：

| Method | Path | 说明 |
|---|---|---|
| POST | `/api/v1/meeting/session/start` | 按参会人列表批量起翻译会话（特权操作） |
| POST | `/api/v1/meeting/session/stop` | 批量停止 |
| GET | `/api/v1/meeting/session/state` | 查询房间当前扇出状态（只读） |

```bash
curl -X POST https://localhost:8020/api/v1/meeting/session/start \
  -H "Content-Type: application/json" \
  -d '{
    "room_id": "你的房间号",
    "room_id_type": 1,
    "participants": ["user_a", "user_b"],
    "capability": "realtime-translation",
    "params": { "mode": "zh-en" }
  }'
```

**⚠️ 安全要求（务必阅读）**：`meeting-ops` 的这两个端点是特权操作（会产生真实云服务调用费用），本能力包**不做任何调用者权限校验**。你必须在自己的后端加一层校验（比如"调用者是不是这个房间的管理员"），校验通过才转发到这里，绝不能让未经身份校验的客户端直接打到这些端点。详见 `room-owner-authz-note.md`。

## 4. 前端：如何收到 AI 的字幕/状态

如果你已有的会议/直播 SDK 没有把底层 TRTC engine 暴露出来供你监听自定义消息，参考 `../frontend_assets` 里的两个框架无关片段：

- `silent-listener.ts`：独立起一个静默旁听 TRTC 客户端，只收自定义消息不推流
- `subtitle-parser.ts`：解析 cmd 10000/10001，产出双语气泡 + 转写记录

拷进你的项目后按你的技术栈（Vue/React/纯 JS）简单包一层调用即可，两个文件都不依赖任何 UI 框架。

## 5. 安全合规

- **HTTPS**：生产环境务必启用（TRTC Web SDK 采集麦克风也要求安全上下文）
- **SecretKey 不下发到客户端**：骨架只把 `user_sig`（带 TTL）发给客户端，绝不暴露 `SDKSecretKey`
- **日志脱敏**：骨架内置 `RedactingFilter`；反向代理层也应避免记录 Authorization 头
