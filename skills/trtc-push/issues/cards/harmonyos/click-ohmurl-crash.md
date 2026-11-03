---
doc_source:
  - faq-harmony-ohmurl
doc_revision: 45ad485e
---

# HarmonyOS 点击推送崩溃（OHMUrl）

## 与 MCP 的关系

本文件是 **知识卡**，不拥有独立主链。

- ROUTER `workflow_id`：`troubleshoot-harmony`
- 关联 flow：`flows/harmonyos/offline-not-received.md`
- 挂载：点击分支知识（OHMUrl）
- 执行仍走 MCP 状态机；命中本卡后按挂载阶段取证，禁止用本卡替代 `complete_workflow_step`。

## 适用现象

当用户反馈以下任一现象时，优先使用本卡：

- HarmonyOS 点击离线通知后应用崩溃。
- 崩溃栈或配置涉及 `useNormalizedOHMUrl` / HAR 路由。
- 推送能展示，点击即崩。

不适用于：

- 注册失败 / 80300002 → `../../flows/harmonyos/offline-not-received.md`（80300002 的鸿蒙原因见 `../android/error-codes.md`）。
- Flutter / uni-app 接入鸿蒙的配置问题 → 同 flow「Flutter / uni-app 接入鸿蒙」分支（官网接入页均有 HarmonyOS 页签）。
- 只是点击不跳转、没有崩溃 → 先按官网 FAQ 核对点击后续动作与回调注册。

## 必须收集的证据

本卡只负责取证，处理步骤以官网 FAQ「HarmonyOS 开启 useNormalizedOHMUrl 后点击通知崩溃，如何处理？」为准。

- 完整崩溃栈。
- 是否开启 `useNormalizedOHMUrl`；仅开启后才崩，还是关闭也崩。
- 当前 HarmonyOS TIMPush SDK / HAR 版本。
- 控制台「点击后续动作」当前取值，以及是否修改过默认的应用内指定界面。
- `onNotificationClicked` 在哪里注册（是否在 `UIAbility.onCreate()`）。
- 推送 ext / 跳转目标。

## 排查步骤

1. 确认是点击路径崩溃，而不是注册失败。
2. 按上面清单取证，缺哪项问哪项，不要凭猜测下结论。
3. 取证齐全后，按官网 FAQ 的处理步骤逐项核对（版本、点击后续动作、回调注册位置）。

## 解决方案

以官网 FAQ 为准，要点（会随文档变化，`doc_revision` 过期时以文档为准）：

- 升级到文档注明的最低 SDK 版本（`8.7.7203` 或更高）。
- 控制台「点击后续动作」设为「打开应用内指定界面」并保留默认值。
- 在 `UIAbility.onCreate()` 注册 `onNotificationClicked`。
- 仅开启 `useNormalizedOHMUrl` 才崩：暂时关闭该开关并收集崩溃堆栈，再提交工单。

## 验证信号

- 点击通知不再崩溃，并能进入预期页面。
- 开启 `useNormalizedOHMUrl` 后同样正常；否则带堆栈和版本提交工单。
