# AtomicX setCertificateID ≠ TIMPush registerPush

## 与 MCP 的关系

本文件是 **知识卡**，不拥有独立主链。

- ROUTER `workflow_id`：`troubleshoot-ios`
- 关联 flow：`flows/ios/offline-not-received.md`
- 挂载：API 边界负例卡（register 阶段禁止混用 AtomicX setCertificateID）
- 执行仍走 MCP 状态机；命中本卡后按挂载阶段取证，禁止用本卡替代 `complete_workflow_step`。

## 适用现象

当用户或 Agent 在 TIMPush 排障中出现以下混淆时使用本卡：

- 建议「补上 `LoginStore.shared.setCertificateID(apnsCertificateID:)`」来修 TIMPush 收不到推送
- 把 AtomicXCore `PushManager` 与 `TIMPushManager.registerPush` 当成同一条注册链路
- AtomicX Chat / SwiftUI Demo 已 Pod `TIMPush` 并实现 `TIMPushDelegate`，却仍按 CallKit 证书 API 排障

不适用于：

- 用户明确只要 CallKit / VoIP 来电推送、未接 TIMPush。这类问题超出本 Skill 主责，声明边界后转交 Call / AtomicX 角色。
- 纯 TIMPush 独立 App（无 AtomicX）——本卡无关，走 `flows/ios/offline-not-received.md`。

## 共同根因

AtomicXCore 与 TIMPush 是**两条可并存但语义不同**的推送能力：

| API / 组件 | 用途 | TIMPush 排障时 |
|---|---|---|
| `TIMPushManager.registerPush` + `TIMPushDelegate.businessID()` | TIMPush 离线推送正道：申请 APNs token、上报 IM、离线下发 | **本 Skill 主路径** |
| `LoginStore.setCertificateID` → AtomicX `PushManager` | AtomicX 内置 APNs/VoIP 证书同步（常见于 CallKit / 来电） | **不是** TIMPush `registerPush` 的替代或「缺的一步」 |
| CallKit / VoIP Extension | 音视频来电系统 UI | 超出 TIMPush 主责时声明边界 |

常见错误模式：

- 在已接 TIMPush 的 Demo 上推荐 `setCertificateID`，误导用户改无关路径
- 因 AtomicX 登录不发 `TUILoginSuccessNotification`，误以为「必须再走 setCertificateID」；正确做法是检查业务是否在 IM 登录成功后调用了 `TIMPushManager.registerPush`

## 必须收集的证据

- 工程是否 Pod / 依赖 `TIMPush`，AppDelegate 是否实现 `TIMPushDelegate`
- 是否调用 `TIMPushManager.registerPush`（及登录相对时序）
- 是否**同时**调用了 `setCertificateID`（有则注明用途：CallKit vs 误配）
- Xcode 日志：`APNs configuration success` / `registerPush` / `deviceToken`（TIMPush 关键字）

## 排查步骤

1. 确认用户目标是 **TIMPush 消息离线推送** 还是 **CallKit 来电**。
2. TIMPush 目标：只沿 `registerPush` + `businessID` + 证书环境链路排查；**不要**建议补 `setCertificateID`。
3. 若仅 CallKit / 未接 TIMPush：说明本 Skill 不适用，转交对应角色。
4. 若两者都要：分别验收两条链路，勿混用修复动作。

## 解决方案

- TIMPush 收不到：按 `flows/ios/offline-not-received.md` / `troubleshoot-ios`，聚焦 `registerPush` 与证书。
- **禁止**把「调用 setCertificateID」写入 TIMPush 修复计划。
- 排障模式未获用户授权前不改工程源码（见 `hard-rules.md` 零写入红线）。

## 验证信号

- 修复讨论中不再出现「用 setCertificateID 替代 registerPush」的建议
- 日志出现 TIMPush 侧 `APNs configuration success` / `registrationID=`（若业务已打日志）
