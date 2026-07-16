# 权限校验说明：meeting-ops 为什么不内置房主/管理员判断

## 结论

`meeting-ops` 的 `/api/v1/meeting/session/start` 和 `/session/stop` 是特权操作端点（会触发真实的云服务调用，产生费用），但**本能力包完全不做任何调用者身份/权限校验**。

## 为什么这么设计

这不是接入 TRTC 能力本身的必要条件，是我们刻意做的边界收窄：

1. **你的系统大概率已经有权限体系了**。如果你在接入一个已有的会议室/直播间/App，你自己的后端应该已经知道"当前请求是谁发的、他是不是管理员"。让 `meeting-ops` 再实现一套自己的权限判断，反而会跟你已有的权限体系打架，或者变成"两套互不认识的权限系统"。

2. **权限规则因业务而异**。有的产品是"仅主持人可操作"，有的是"任何管理员都可以"，有的甚至是"付费用户才能开"——这些规则属于具体业务，不该固化进一个可复用能力包里。

## 你应该怎么做

在你自己的后端加一层转发前置校验：

```
[你的前端] --请求--> [你的后端]
                        │
                        ├─ 校验调用者身份 + 权限（用你已有的鉴权体系）
                        │
                        ├─ 通过 --转发--> [meeting-ops /api/v1/meeting/session/start]
                        │
                        └─ 不通过 --> 直接拒绝，不转发
```

伪代码示例（Node/Express 风格，其他语言逻辑相同）：

```js
app.post('/my-api/ai-translate/start', requireAuth, async (req, res) => {
  const room = await myRoomService.getRoom(req.body.roomId)
  if (room.ownerId !== req.user.id) {
    return res.status(403).json({ error: 'only room owner can start AI translation' })
  }
  const resp = await fetch('https://localhost:8020/api/v1/meeting/session/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      room_id: room.id,
      participants: room.participantUserIds,
      capability: 'realtime-translation',
      params: { mode: req.body.mode },
    }),
  })
  res.json(await resp.json())
})
```

## 参考实现（仅供理解思路，不要直接照搬到生产）

`scenarios/meeting-interpreter/backend/app/server.py` 里有一个**演示用**的房主校验实现（内存字典记录"建房人=房主"），那是我们自己的会议室 demo 的产品规则，仅用来说明"这一层校验该长什么样子"。生产环境请换成你自己系统里真实的权限判断逻辑，而不是照搬这个内存字典。
