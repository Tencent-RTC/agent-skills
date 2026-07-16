# meeting-ops

多人房间场景的扇出编排能力：给定一组 `targetUserId`，批量起停 [conversation-core](../conversation-core) 会话，并维护房间级状态（当前跑的是什么业务、有哪些 bot 在线）。

## 这个能力包不做什么

**不做权限校验。** `session/start` / `session/stop` 是特权操作（会触发真实的云服务调用，产生费用），但"谁能调用"完全交给集成方自己的业务系统判断——你的会议室/直播间/App 大概率已经有一套用户角色体系了，不需要我们重新发明一套。

集成时请遵循：

```
[你的前端] -> [你的后端：校验调用者是房主/管理员] -> 通过才转发 -> [meeting-ops /session/start]
```

Path A 默认场景（`scenarios/meeting-interpreter`）里能看到一个具体实现：用内存字典记录"谁建的房就是谁的房主"，仅供演示参考，**不要直接搬到生产环境**——生产场景请接入你自己系统里真实的房主/管理员判断逻辑。

## 这个能力包做什么

- 按参会人列表批量调用 `conversation-core` 起一路会话（每个人一路，各自独立的 `agent_user_id`）
- 维护 `room_id -> {capability, params, tasks[]}` 的内存态，供状态查询/幂等重启使用
- 与具体业务（比如"翻译"）解耦：通过 `capability` 字段 + 动态加载约定接口连接，不直接依赖 `realtime-translation`

## API

| Method | Path | 说明 |
|---|---|---|
| POST | `/api/v1/meeting/session/start` | 批量起会话（特权操作） |
| POST | `/api/v1/meeting/session/stop` | 批量停会话（特权操作） |
| GET | `/api/v1/meeting/session/state` | 查询房间扇出状态（只读） |

请求示例（起翻译扇出）：

```json
POST /api/v1/meeting/session/start
{
  "room_id": "12345",
  "room_id_type": 1,
  "participants": ["user_a", "user_b"],
  "capability": "realtime-translation",
  "params": { "mode": "zh-en" }
}
```

## 复用到其他场景

只要新业务能力包在 `src/service.py` 里实现 `build_lifecycle_config(params) -> AgentLifecycleConfig`，就可以直接把 `capability` 字段换成新能力包的目录名，无需修改 `meeting-ops` 任何代码。
