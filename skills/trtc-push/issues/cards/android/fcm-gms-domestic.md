# FCM / GMS 国内环境限制

## 适用现象

当用户反馈以下现象时，优先使用本卡：

- Android / 三星设备 `registerPush failed`，错误码包含 `800005`。
- 日志出现 `FCM unavailable`、`FCM register exception` 或 Firebase 初始化异常。
- 国内 Android 设备使用 FCM 通道，控制台或服务端显示发送成功但设备收不到。
- 用户询问国内手机如何测试 Google FCM 推送。

不适用于已明确走华为、小米、OPPO、vivo、荣耀、魅族厂商通道的注册失败；那类问题走
`../../flows/android/vendor-not-received.md`。

## 共同根因

FCM 依赖 GMS / Google Play 服务和可访问 Google 服务的网络环境。国内出厂 Android 设备
通常不预装 GMS，或即使安装 GMS 也受网络、后台、自启动和系统限制影响，无法稳定完成
FCM 注册和离线投递。

## 必须收集的证据

- 设备品牌、型号、系统版本、销售区域。
- 是否预装或可用 Google Play 服务 / GMS。
- `registerPush` 错误码和完整 `errMsg`。
- `google-services.json` 是否放在正确 App 模块。
- Firebase / FCM 是否初始化成功。
- 是否强制使用 FCM 通道（如海外场景配置）。
- App 是否具备通知权限、自启动和后台运行能力。

## 排查步骤

1. 先确认实际走的是 FCM 通道还是国内厂商通道。
2. 如果设备是国内三星或普通国内 Android 机，先确认是否具备可用 GMS。
3. 查看 `registerPush` 是否返回 `800005` / `FCM unavailable`。
4. 核对 `google-services.json`、Firebase 初始化和 FCM Sender ID。
5. 使用 Pixel、国际版真机或带 Google Play 的模拟器做对照测试。
6. 如果 FCM 注册成功但仍收不到，继续检查自启动、后台、电池优化和通知权限。
7. 国内业务场景优先配置国内厂商通道，不要把 FCM 当作稳定兜底通道。

## 解决方案

- 国内 Android 设备优先接入对应厂商通道。
- FCM 测试使用 Pixel / 国际版设备 / 带 Google Play 的模拟器。
- 修正 `google-services.json` 和 Firebase 初始化问题。
- 若业务必须走 FCM，明确告知国内设备环境不可控，需要用户自测 FCM 控制台下发和网络可达性。

## 验证信号

- FCM 设备上 `registerPush` 成功。
- 能拿到非空 FCM token / TIMPush `RegistrationID`。
- Firebase 初始化无异常。
- FCM 控制台或腾讯云控制台测试推送能在目标设备收到。
