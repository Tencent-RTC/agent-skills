# playbook: embed-in-app (q1 = backend)

> **触发条件**：`form = embed-in-app` AND `q1_usersig_source = backend`。
>
> **当前版本范围**：生产 UserSig 自动接入暂未开放。本 playbook 只提供官方安全指引，
> 不生成客户端请求骨架，不修改用户项目，不创建 apply plan。

## 必须执行

1. 告知用户：正式环境必须在服务端生成 UserSig，SecretKey 严禁进入 Flutter 客户端。
2. 提供官方文档：
   `https://trtc.io/zh/document/35166?product=call&menulabel=uikit&platform=web`
3. 告知服务端实现必须满足：
   - SecretKey 仅保存在服务端环境变量或密钥管理系统；
   - UserSig 接口验证 App 现有业务登录态；
   - 服务端根据已认证用户确定或严格校验用于签名的 TRTC UserID；
   - 使用官方服务端 UserSig 生成代码；
   - App 在 TUICallKit 登录前获取 UserSig。
4. 写 session：

```yaml
phase1a_blocked: backend-usersig-integration-deferred
pending_todos:
  - field: backend_usersig_provider
    location: backend
    note: 按官方文档完成服务端 UserSig 后，再继续 TRTC Call 生产接入
```

5. 向用户明确说明：

> 当前版本暂不自动修改生产项目。请先按官方文档完成服务端 UserSig 能力；完成后可回来
> 继续接入。若只是希望先跑通 Call，请重新选择 local-dev，本地调试路径不得用于上线。

6. `STOP`。禁止进入 project probe、apply plan、平台修改、代码修改或 verifier。

## 禁止

- 禁止生成固定的 UserSig HTTP endpoint、请求字段或响应字段。
- 禁止猜测用户的网络库、鉴权 Header、后端框架或业务用户映射。
- 禁止生成客户端签名降级方案。
- 禁止把文档 handoff 表述为“生产接入已完成”。
