---
doc_source:
  - faq-android-oppo
  - faq-android-oppo-desc-too-long
  - faq-android-oppo-rest-vs-client
doc_revision: 5b4c089c
---

# OPPO 通知栏不展示 / 收不到（消息分类与 ChannelID）

## 与 MCP 的关系

本文件是 **知识卡**，不拥有独立主链。

- ROUTER `workflow_id`：`troubleshoot-android`
- 关联 flow：`flows/android/delivered-not-displayed.md`
- 挂载：主要挂展示分支 / `stage-6`
- 执行仍走 MCP 状态机；命中本卡后按挂载阶段取证，禁止用本卡替代 `complete_workflow_step`。

## 适用现象

当用户反馈以下任一现象时，优先使用本卡：

- OPPO / realme / OnePlus 设备离线推送收不到或不弹通知。
- 其他厂商正常，仅 OPPO 系异常。
- 日志或回执显示发送成功，但通知栏无展示。
- 通过 REST API 下发能收到，客户端发消息收不到。
- 消息内容较长时收不到。

不适用于：

- 华为 `800006` / 指纹问题 → `vendor-huawei.md`。
- 厂商明确黑名单/未上架（小米·vivo）→ `xiaomi-vivo-store-channel.md`。
- 日限额「只能收到几条」→ `message-category-limit.md`。

## 共同根因

以官网 FAQ 为准（`doc_source`），**不要默认让用户去配 ChannelID**。OPPO 离线推送不展示的常见原因：

1. **消息分类配置与 OPPO 当前规则不符**：
   - 新接入的应用使用 `category` 和与之匹配的模板；IM 聊天消息申请「通讯与服务类」，`category` 填 `IM`。
   - 只有**已开通私信通道的存量应用**，才继续使用已登记的私信 ChannelID（`setAndroidOPPOChannelID`）。
2. **系统通知栏开关**：OPPO 安装应用后通知栏显示默认关闭。
3. **发送端没有携带离线推送参数**：REST API 能收到而客户端发消息收不到，说明 OPPO 厂商配置本身是通的，问题在客户端发消息时没传 `V2TIMOfflinePushInfo`。
4. **`desc` 过长**：厂商对 `desc` 内容有长度限制，过长收不到。
5. **强提醒（横幅、铃声、震动）**需单独向 OPPO 申请，仅应用二级分类属于聊天交友、电话短信、办公类才可申请；没有强提醒权益时不要配置 `notify_level=16`。

## 必须收集的证据

- 测试机是否为 OPPO 系，是否已强杀后测离线。
- **该应用属于新接入，还是已开通私信通道的存量应用**（决定走 `category` 还是 ChannelID）。
- 控制台 OPPO 证书里的默认 `category` 配置；发送侧是否传了 `category` / `notify_level`。
- 系统通知栏开关状态。
- 发送侧 `offlinePushInfo`：是否携带、`desc` 长度、自定义消息是否设置 `desc`。
- 控制台或厂商回执（TaskId / messageId）；REST 与客户端发送两条路径的差异。

## 排查步骤

1. 确认设备品牌匹配，走 `troubleshoot-android` 收配置与日志。
2. 先问清**新接入还是存量私信通道**：新接入核对 `category` + 模板；存量才核对 ChannelID 与 App 内同名渠道。
3. 核对通知栏权限开关。
4. 客户端发消息场景核对 `V2TIMOfflinePushInfo` 已传；自定义消息必须设 `desc`；`desc` 过长则缩短。
5. 回执成功仍不展示，转 `../../flows/android/delivered-not-displayed.md`。

## 解决方案

具体配置、`notify_level` 取值规则和申请入口，以官网 FAQ「OPPO 手机收不到推送，如何排查？」和 OPPO 厂商配置文档为准，这里只保留判断要点：

- 新接入：使用 `category` 与匹配模板，IM 聊天消息填 `IM`；不要引导配置 ChannelID。
- 存量私信通道：继续使用已登记的私信 ChannelID。
- 引导用户在系统设置里打开应用通知。
- 客户端发送消息补齐 `V2TIMOfflinePushInfo`，并控制 `desc` 长度。

## 验证信号

- 强杀 App 后，控制台离线测试在 OPPO 通知栏可见。
- 客户端发消息与 REST 下发两条路径均可达。
- 同一 RegistrationID 连续测试可重复触达（排除限额类问题）。
