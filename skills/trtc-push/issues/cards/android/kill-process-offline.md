# 强杀后收不到离线推送

## 与 MCP 的关系

本文件是 **知识卡**，不拥有独立主链。

- ROUTER `workflow_id`：`troubleshoot-android`
- 关联 flow：`flows/android/offline-not-received.md`
- 挂载：主要挂 `stage-2-scenario` / `stage-6-offline-test`
- 执行仍走 MCP 状态机；命中本卡后按挂载阶段取证，禁止用本卡替代 `complete_workflow_step`。

## 适用现象

当用户反馈以下任一现象时，优先使用本卡：

- 前台或后台能收到，彻底杀死应用后收不到。
- CallKit / 来电场景：杀进程后无来电推送通知。
- 用户说「IM 显示发送成功」但强杀后无通知栏。

不适用于：

- 前台在线回调有、本来就不走通知栏 → 先澄清在线/离线语义。
- 明确厂商限额模式 → `message-category-limit.md`。

## 共同根因

强杀后不再有 IM 长连接，必须依赖厂商离线通道。若厂商证书未配、registerPush/token 未绑定、测试走了在线推送、或设备厂商通道不可用，就会出现「活着能收、杀死不能收」。

常见错误模式：

- 用在线推送/前台回调证明「离线已通」。
- 测试时未强杀，或从多任务划掉但进程仍在。
- 只配了部分厂商证书，问题机品牌未覆盖。

## 必须收集的证据

- 是否真正强杀（强制停止）后测试。
- 设备品牌与控制台已配置厂商证书列表。
- `registerPush` / `RegistrationID` / `pushLogin` / offline token 日志。
- 控制台测试选择的是「离线」还是「在线」。
- Call 场景是否同时依赖 CallKit 推送扩展。

## 排查步骤

1. 要求强制停止后，用控制台离线测试工具复测。
2. 核对该品牌证书与 `timpush-configs.json`。
3. 收齐注册绑定链路证据（见 `../../cards/common/registration-binding.md`）。
4. 区分 Chat 消息 PushFlag / OfflinePushInfo 是否允许离线。
5. 若注册成功且离线任务失败，按厂商转入 store/Channel/分类卡片。

## 解决方案

- 补齐对应厂商证书与客户端依赖，完成 registerPush。
- 验证务必强杀 + 离线测试类型。
- 业务发送带齐 `offlinePushInfo`；自定义消息设 `desc`。
- Call 来电场景同时核对 CallKit/VoIP 扩展是否在范围内（超出则说明边界）。

## 验证信号

- 强制停止后，离线测试通知栏可达。
- 日志仍有历史 RegistrationID，控制台能查到设备。

