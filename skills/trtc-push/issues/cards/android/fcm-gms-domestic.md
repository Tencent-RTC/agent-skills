# FCM / GMS 国内环境限制

## 与 MCP 的关系

本文件是 **知识卡**，不拥有独立主链。

- ROUTER `workflow_id`：`troubleshoot-android`
- 关联 flow：`flows/android/register-failed.md / vendor-not-received.md`
- 挂载：主要挂 `stage-3` / `stage-4`（FCM/GMS）
- 执行仍走 MCP 状态机；命中本卡后按挂载阶段取证，禁止用本卡替代 `complete_workflow_step`。

## 适用现象

当用户反馈以下现象时，优先使用本卡：

- 日志出现 `FCM unavailable`、`FCM register exception` 或 Firebase 初始化异常。
- 国内 Android / 三星设备走 FCM 通道失败，或询问国内如何测 Google FCM。
- 已在 `error-codes.md` 确认 `800005` 码义后，`errMsg` 明确指向 FCM/GMS。

不适用于：

- 裸报 `800005` 且尚未区分本机厂商 vs FCM：先读 `error-codes.md` 的 **800005** 节。
- 已明确走华为、小米、OPPO、vivo、荣耀、魅族厂商通道的配置/注册失败：
  `../../flows/android/vendor-not-received.md`。

## 共同根因

FCM 依赖 GMS / Google Play 服务和可访问 Google 服务的网络环境。国内出厂 Android 设备
通常不预装 GMS，或即使安装 GMS 也受网络、后台、自启动和系统限制影响，无法稳定完成
FCM 注册和离线投递。

> 说明：TIMPush `800005` 的权威码义是「本机通道注册推送失败」，本卡只覆盖其中
> **FCM/GMS 子因**，不代表 800005 仅等于 FCM 问题。

## 必须收集的证据

- 设备品牌、型号、系统版本、销售区域。
- 是否预装或可用 Google Play 服务 / GMS。
- `registerPush` 错误码和完整 `errMsg`。
- `google-services.json` 是否放在正确 App 模块。
- Firebase / FCM 是否初始化成功。
- 是否强制使用 FCM 通道（如海外场景配置）。
- App 是否具备通知权限、自启动和后台运行能力。

## 排查步骤

1. 若用户只给了 `800005`：先打开 `error-codes.md#800005`，确认是否真的是 FCM 子因。
2. 确认实际走的是 FCM 通道还是国内厂商通道。
3. 如果设备是国内三星或普通国内 Android 机，先确认是否具备可用 GMS。
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
