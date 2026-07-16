# Android 厂商通道注册失败 / 收不到排查流程

## 入口现象

用户反馈 Android 厂商通道不通、`registerPush failed`、控制台测试收不到、厂商离线
通知不达，或某个厂商设备异常。

这类问题必须先按厂商和阶段拆分：配置阶段、注册阶段、token 上报阶段、厂商送达阶段、
终端展示阶段。

## 首轮证据

- 受影响厂商：huawei / honor / xiaomi / oppo / vivo / meizu / fcm。
- 测试设备品牌、型号、系统版本，必须与受影响厂商匹配。
- `applicationId`。
- 厂商控制台包名、AppID / AppKey / AppSecret。
- 厂商配置文件：`agconnect-services.json`、`mcs-services.json`、`google-services.json`。
- `timpush-configs.json`。
- 签名 SHA-256（华为 / 荣耀必查）。
- `registerPush` 成功 / 失败日志和错误码。
- 控制台测试的 UserID / RegistrationID、推送类型和发送时间。

## 排查顺序

1. 先确认测试设备能覆盖目标厂商通道；不要用华为机判断小米通道。
2. 确认 `applicationId` 与厂商控制台包名一致。
3. 核对厂商 AppID / AppKey / AppSecret 与腾讯云控制台证书配置。
4. 核对 Gradle 依赖、厂商 Maven、插件和 manifest placeholders。
5. 核对厂商 JSON 文件位置和内容。
6. 对华为 / 荣耀计算当前包 SHA-256，并与厂商控制台一致。
7. 收集 `registerPush` 日志，确认 token 是否上报。
8. 如果厂商回执成功但终端未展示，转 `delivered-not-displayed.md`。

## 分支处理

| 分支 | 判断信号 | 处理动作 |
|---|---|---|
| 华为 / 荣耀 AGConnect 问题 | `800006`、`Huawei appId missing`、`certificate fingerprint empty` | 查 `../../cards/android/vendor-huawei.md` |
| FCM / GMS 环境问题 | `800005`、`FCM unavailable` | 查 `../../cards/android/fcm-gms-domestic.md` |
| 包名 / 签名不一致 | 厂商控制台与安装包不一致 | 修正控制台或重新打包 |
| 厂商证书数量上限 | `cert limit exceeded` | 查 `../../cards/common/console-certificate-quota.md` |
| token 已上报但收不到 | 厂商返回成功或有 messageId | 转送达后不展示流程 |
| 控制台提示 ID 不存在 | 查不到设备记录 | 查 `../../cards/common/registration-binding.md` |

## 验证信号

- `registerPush success`。
- `RegistrationID` 非空。
- 控制台排查工具能查到目标设备。
- 在线测试推送可达。
- 强杀 App 后厂商离线推送可达。

## 何时升级 / 转交

- 腾讯云侧已拿到厂商成功回执，但设备仍不展示。
- 厂商 messageId 明确返回异常且文档无公开解释。
- 用户厂商控制台权益、消息分类或限流状态需要厂商侧确认。
