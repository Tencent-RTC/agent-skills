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
- 通知权限、自启动、后台运行、电池优化状态。
- 消息分类 / Channel / Category / 优先级参数。

## 排查顺序

按 Catalog 主链推进：

0. **通道回执成功但无展示**（用 TaskId / messageId 确认已到厂商或设备侧）。
1. **系统通知权限 / 锁屏 / 静默**。
2. **厂商展示条件**（OPPO ChannelID 等）。
3. **消息分类 / 营销限流**。
4. **保留 TaskId / 厂商 messageId** 便于升级。

补充执行细节：

1. 先用 TaskId / messageId 判断是否到腾讯云 Push、厂商、设备。
2. 如果未到厂商，回到 `offline-not-received.md` / `register-failed.md` / `vendor-not-received.md`。
3. 如果厂商返回成功，检查终端展示条件。
4. 检查通知权限、自启动、后台限制、电池优化、免打扰。
5. 检查 Android 通知渠道重要性、前台通知开关、厂商消息分类权益。
6. 检查设备联网状态、厂商 token 是否无效、近期是否有厂商限流。
7. 仍无法解释时，携带厂商 messageId / token 转厂商侧确认。

## 分支处理

| 分支 | 判断信号 | 处理动作 |
|---|---|---|
| 设备权限 / 后台限制 | 开启自启动后恢复，或后台/杀进程才异常 | 引导用户开启权限和后台白名单 |
| OPPO ChannelID | OPPO 系；缺 Channel 或不展示 | 查 `../../cards/android/oppo-channel-display.md` |
| 厂商消息分类 / 限流 | 只收少量、延迟、违规推送、营销类限制 | 查 `../../cards/android/message-category-limit.md` |
| 小米 / vivo 通道策略 | 黑名单、未上架、关闭通道 | 查 `../../cards/android/xiaomi-vivo-store-channel.md` |
| 厂商最后一跳 | 厂商返回成功但设备不展示 | 用 messageId / token 找厂商确认 |
| 前台展示开关 | 前台收到回调但不弹通知栏 | 检查 `disablePostNotificationInForeground` 等开关 |
| 自定义消息无 desc | 自定义消息默认不推 | 发送时补齐 `offlinePushInfo.desc` |
| token 无效 / 长期未联网 | 厂商回执无效 token 或设备久未联网 | 重新打开 App 注册，刷新 token |
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
