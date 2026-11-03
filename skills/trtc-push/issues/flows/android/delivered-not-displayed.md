---
doc_source:
  - ts-chain-display
  - faq-android-notification-settings
  - faq-android-vivo-10302
  - faq-android-oppo
  - faq-android-force-stop
  - faq-android-xiaomi-vivo-store
  - faq-common-only-few
  - faq-common-custom-msg-offline
doc_revision: c67d65f4
---

# 已送达但终端未展示 / 延迟排查流程

## 与 MCP 的关系

本文件是 **分支知识**，不拥有独立主链。

- ROUTER `workflow_id`：`troubleshoot-android`
- 主链 owner：`flows/android/offline-not-received.md`
- 本文件挂载：主要挂 `stage-6-offline-test` 之后的展示分支（建议仍做 stage-1 服务校验）
- 执行仍走上述 MCP workflow（进入后先过 `stage-0-investigation-plan`）；本文件不能替代 engine，也不能跳过主链门控（stage-1 有效性、stage-3 配置等）。

## 入口现象

服务端接口、腾讯云控制台或厂商回执显示推送成功，但用户设备未展示通知、延迟很久才收到，
或切换网络后通知集中到达。

这类问题不要回到“重新接入厂商 SDK”的默认路径。先分清链路已经走到哪一层。

## 首轮证据

- 发送时间、TaskId / MsgKey / 厂商 messageId。
- 推送类型：在线 / 离线 / 控制台测试 / REST API。
- 目标 UserID / RegistrationID。
- 厂商回执码和回执文案。
- 设备品牌、系统版本、网络状态。
- App 状态：前台、后台、杀进程。
- 通知权限、锁屏通知、自启动、后台运行状态、勿扰模式。
- 消息分类 / Channel / Category / 优先级参数。

## 排查顺序

按 Catalog 主链推进：

0. **通道回执成功但无展示**（用 TaskId / messageId 确认已到厂商或设备侧）。
1. **系统通知权限 / 锁屏 / 静默**：通知栏没有记录 → 检查该应用的通知类别或通知渠道是否被关闭；通知栏有记录、锁屏不弹 → 检查锁屏通知开关。
2. **厂商展示条件**（OPPO 消息分类 / ChannelID 等）。
3. **消息分类 / 营销限流**。
4. **保留 TaskId / 厂商 messageId** 便于升级。

补充执行细节：

1. 先用 TaskId / messageId 判断是否到腾讯云 Push、厂商、设备。
2. 如果未到厂商，回到 `offline-not-received.md` / `register-failed.md` / `vendor-not-received.md`。
3. 如果厂商返回成功，检查终端展示条件。
4. 检查通知权限、锁屏通知、自启动、后台运行限制、勿扰模式（官网《设备通知栏设置对推送有什么影响？》）。
5. 检查 Android 通知渠道重要性、前台通知开关、厂商消息分类权益。
6. 检查近期是否有厂商限流（见消息分类 / 限额）；vivo 设备超过 14 天没有和 vivo 推送服务器建立长连接时 regId 会失效（官网《vivo 推送报错 10302》），属注册链路，见 `register-failed.md`。
7. 仍无法解释时，携带厂商 messageId / token 转厂商侧确认。

## 分支处理

| 分支 | 判断信号 | 处理动作 |
|---|---|---|
| 设备权限 / 后台限制 | 开启自启动后恢复，或后台/杀进程才异常 | 引导用户开启权限和后台白名单 |
| OPPO 消息分类 / ChannelID | OPPO 系；分类配置不符、通知栏关闭或不展示 | 查 `../../cards/android/oppo-channel-display.md` |
| 厂商消息分类 / 限流 | 只收少量、延迟、违规推送、营销类限制 | 查 `../../cards/android/message-category-limit.md` |
| 小米 / vivo 通道策略 | 黑名单、未上架、关闭通道 | 查 `../../cards/android/xiaomi-vivo-store-channel.md` |
| 华为：已送达、锁屏不弹 | 「设备通知栏设置」类问题 | 检查系统通知与锁屏通知；华为还可检查「状态栏显示通知图标」「通知铃声 / 静默通知」 |
| 小米：已送达、锁屏不弹 | 通知栏有记录无弹窗 | 检查锁屏通知、通知类别和 MIUI 锁屏开关 |
| OPPO：没有通知或锁屏不弹 | 安装后通知常默认关闭 | 先打开该应用通知开关；锁屏不弹时先区分通知栏无记录还是有记录无弹窗，再查锁屏通知 |
| 厂商最后一跳 | 厂商返回成功但设备不展示 | 用 messageId / token 找厂商确认 |
| 前台展示开关 | 前台收到回调但不弹通知栏 | 检查 `disablePostNotificationInForeground` 等开关 |
| 自定义消息无 desc | 自定义消息默认不推 | 发送时补齐 `offlinePushInfo.desc` |
| regId / token 失效 | 厂商回执提示用户 ID / token 无效；vivo 设备超过 14 天未与 vivo 推送服务器建立长连接，或卸载重装 / 清除数据 | 回到注册链路：`register-failed.md` / `../../cards/common/registration-binding.md` |
| 点击问题被误报为不展示 | 用户其实收到了但点不开 | 查 `click-no-action.md` → `../../cards/android/notification-click-jump.md` |

## 验证信号

- 权限或分类修正后，同一设备能稳定展示通知。
- 厂商回执和终端展示结果一致。
- 强杀 App 后离线通知可达。
- 延迟问题可通过厂商回执或设备策略解释。

## 何时升级 / 转交

- 厂商 messageId 返回成功，但同一设备持续不展示。
- 厂商规则、限流、分类审核状态无法从腾讯云侧确认。
- 需要查询厂商最后一跳日志。
