# APNs P8 InvalidProviderToken

## 与 MCP 的关系

本文件是 **知识卡**，不拥有独立主链。

- ROUTER `workflow_id`：`troubleshoot-ios`
- 关联 flow：`flows/ios/offline-not-received.md`
- 挂载：主要挂 `stage-1` / `stage-3`
- 执行仍走 MCP 状态机；命中本卡后按挂载阶段取证，禁止用本卡替代 `complete_workflow_step`。

## 适用现象

当用户反馈以下任一现象时，优先使用本卡：

- APNs 返回 `403` / `InvalidProviderToken`。
- 仅使用 P8（Auth Key）证书时推送失败。
- 客户端能拿到 token，服务端/厂商侧鉴权失败。

不适用于：

- p12 过期或环境不一致 → `certificate-businessid.md`。
- 客户端拿不到 deviceToken → `device-token-binding.md`。

## 共同根因

P8 推送依赖 Key ID、Team ID、Bundle ID 与客户端一致。任一填错或与生成 regId 时的 Bundle ID 不一致，APNs 会拒绝 Provider Token。

常见错误模式：

- 控制台 Key ID / Team ID 抄错。
- 多 Bundle 应用混用同一套 P8 配置。
- 客户端与服务端 Bundle ID 不一致。

## 必须收集的证据

- 控制台 P8 的 Key ID、Team ID、Bundle ID。
- 客户端工程 Bundle ID。
- 错误回执全文。
- 证书 ID / businessID。

## 排查步骤

1. 确认失败形态是厂商鉴权而非客户端无 token。
2. 逐项核对 Key ID、Team ID、Bundle ID。
3. 确认生成 RegistrationID 的 Bundle 与推送配置一致。
4. 修正后不要轻易删除重建证书（避免 businessID 变化）；优先编辑更新。

## 解决方案

- 在 IM 控制台更正 P8 三元组与 Bundle ID。
- 多应用场景为每个 Bundle 配置匹配证书，注意套餐配额。
- 更新后用同一设备重新注册再测离线推送。

## 验证信号

- 不再出现 `InvalidProviderToken`。
- 离线推送可达。
