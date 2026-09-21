# 华为 / 荣耀厂商配置问题

## 与 MCP 的关系

本文件是 **知识卡**，不拥有独立主链。

- ROUTER `workflow_id`：`troubleshoot-android`
- 关联 flow：`flows/android/vendor-not-received.md`
- 挂载：主要挂 `stage-3-config-alignment`
- 执行仍走 MCP 状态机；命中本卡后按挂载阶段取证，禁止用本卡替代 `complete_workflow_step`。

## 适用现象

当用户反馈以下任一现象时，优先使用本卡：

- 华为 / 荣耀通道 `registerPush failed`，且日志含 `Huawei appId missing`、
  `certificate fingerprint empty` 或 `ApiException 907135702`。
- 已在 `error-codes.md` 确认 `800006` 码义后，证据指向 AGConnect / 签名指纹 /
  AppId 配置。

不适用于：

- 裸报 `800006` 且尚未按「先本机厂商 → 再 FCM」排查：先读 `error-codes.md` 的
  **800006** 节。
- 华为服务端发送回执 `80300002`（对 Token 下发无权限）：`error-codes.md` 的
  **80300002** 节；勿与本卡客户端配置混淆。
- 厂商已返回成功但设备不展示通知 → `../../flows/android/delivered-not-displayed.md`。
- HarmonyOS NEXT / 纯血鸿蒙原生 Push → `../../flows/harmonyos/offline-not-received.md`。

## 共同根因

华为 / 荣耀通道依赖厂商配置文件、Gradle 插件、包名和签名指纹共同生效。只添加
`com.tencent.timpush:huawei` 或荣耀依赖并不够；如果 AGConnect / MCS 配置文件没有被
构建解析，或当前安装包的 SHA-256 与厂商控制台不一致，厂商 SDK 运行时就读不到 AppId
或拒绝注册。

> 说明：TIMPush `800006` 的权威码义是「本机通道失败后再试 FCM 也失败」。本卡只覆盖
> 本机通道侧的**华为/荣耀配置子因**，不代表 800006 仅等于华为指纹问题。

常见错误模式：

- App 模块未应用 `com.huawei.agconnect` 或荣耀 MCS 插件。
- `agconnect-services.json` / `mcs-services.json` 放错位置。
- debug 包使用了 release SHA-256，或 release 包使用了 debug SHA-256。
- 修改厂商控制台包名、指纹或应用配置后，没有重新下载 JSON 并重新构建。
- 在 HarmonyOS NEXT / 纯血鸿蒙上继续套 Android 厂商通道方案。

## 必须收集的证据

- 当前安装包的 `applicationId`。
- 当前测试包类型：debug / release / staging。
- 通过 MCP `compute_signing_sha256` 或 Gradle signingReport 得到的 SHA-256。
- 华为 / 荣耀控制台填写的包名和 SHA-256。
- `agconnect-services.json` / `mcs-services.json` 是否来自同一个厂商应用。
- 配置文件是否放在 App 模块根目录。
- 构建日志是否显示厂商配置文件被读取。
- `registerPush` 完整错误码和 `errMsg`。

## 排查步骤

1. 若用户只给了 `800006`：先打开 `error-codes.md#800006`，按「本机 → FCM」顺序排。
2. 确认设备是普通 Android / Android 兼容鸿蒙，还是 HarmonyOS NEXT / 纯血鸿蒙。
3. 核对 `applicationId` 与厂商控制台包名完全一致。
4. 核对当前测试包 SHA-256 与厂商控制台填写的指纹一致。
5. 确认 App 模块应用了对应厂商 Gradle 插件。
6. 确认 `agconnect-services.json` / `mcs-services.json` 位于 App 模块根目录，不在
   `src/main/assets`。
7. 运行构建，确认日志显示配置文件被读取。
8. 重新安装到华为 / 荣耀真机，抓取 `registerPush` 日志。
9. 如果厂商注册成功但终端不展示，转 `../../flows/android/delivered-not-displayed.md`。

## 解决方案

- 补齐华为 Maven 仓库、AGConnect classpath / plugin 或荣耀 MCS 插件。
- 下载最新 `agconnect-services.json` / `mcs-services.json` 并放到 App 模块根目录。
- 用当前测试包真实签名重新计算 SHA-256，并填入厂商控制台。
- 修改厂商控制台应用配置后，重新下载配置文件、重新构建并重新安装 APK。
- HarmonyOS NEXT / 纯血鸿蒙使用鸿蒙原生 Push 方案，不复用 Android 厂商通道。

## 验证信号

- 构建日志显示 `Using the AGConnect-Config file: <project>/app/agconnect-services.json`
  或荣耀配置文件被插件读取。
- `Huawei appId missing`、`certificate fingerprint empty`、`907135702` 消失。
- `registerPush success`。
- `RegistrationID` 非空。
- 强杀 App 后，控制台测试推送能触达华为 / 荣耀真机。
