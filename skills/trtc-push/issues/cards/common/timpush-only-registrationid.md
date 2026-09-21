# 仅接入 TIMPush / RegistrationID 推送

## 与 MCP 的关系

本文件是 **知识卡**，无独立 MCP workflow。

- 关联：按需引用
- 定位：无独立 workflow；RegistrationID 语义知识，绑定观测见 stage-5
- 端侧运行时排障仍进对应 `troubleshoot-*`。

## 适用现象

当用户反馈以下任一现象时，优先使用本卡：

- 「只接 TIMPush，不需要 IM SDK」。
- 询问是否只能用 RegistrationID 推送。
- TPNS 停服后只想保留推送能力。

不适用于：

- 已接 Chat 仍 RegistrationID 不存在 → `registration-binding.md`。
- 套餐到期停服 → `../../flows/common/console-product-limits.md`。

## 共同根因

推送服务支持以 Push 插件为主接入；在未使用 Chat 用户体系时，推送目标通常使用设备 `RegistrationID`。这不是缺陷，而是目标寻址方式不同。

常见错误模式：

- 控制台用 UserID 测试，但设备从未以该 UserID 登录绑定。
- 以为必须完整接入 IM 会话能力才能推送。

## 必须收集的证据

- 是否集成 Chat SDK / 是否登录 UserID。
- 推送目标字段（UserID vs RegistrationID）。
- `getRegistrationID` 是否成功。

## 排查步骤

1. 确认业务是否需要会话/漫游等 Chat 能力。
2. 仅推送场景：引导 RegistrationID 获取与服务端按 RegistrationID 推送。
3. 若混用 UserID，确认登录绑定链路完整。

## 解决方案

- 说明可按快速接入文档只接 Push。
- 服务端/控制台测试改用有效 RegistrationID。
- 需要 UserID 推送时，必须完成登录与绑定。

## 验证信号

- `getRegistrationID` 非空。
- 以该 RegistrationID 离线测试可达。
