# 华为 / 荣耀厂商配置问题

## 适用现象

当用户反馈以下任一现象时，优先使用本卡：

- 华为 / 荣耀通道 `registerPush failed`。
- 日志包含 `errCode=800006`、`Huawei appId missing`。
- 日志包含 `certificate fingerprint empty` 或 `ApiException 907135702`。
- 华为 / 荣耀 Android 兼容通道注册失败，且现象指向 AppId、签名指纹或 AGConnect 配置。

不适用于：

- 厂商已返回成功但设备不展示通知。这类问题应走
  `../../flows/android/delivered-not-displayed.md`。
- HarmonyOS NEXT / 纯血鸿蒙原生 Push 接入问题。这类问题应走
  `../../flows/cross-platform/harmonyos.md`。

## 共同根因

华为 / 荣耀通道依赖厂商配置文件、Gradle 插件、包名和签名指纹共同生效。只添加
`com.tencent.timpush:huawei` 或荣耀依赖并不够；如果 AGConnect / MCS 配置文件没有被
构建解析，或当前安装包的 SHA-256 与厂商控制台不一致，厂商 SDK 运行时就读不到 AppId
或拒绝注册。

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

1. 先确认设备是普通 Android / Android 兼容鸿蒙，还是 HarmonyOS NEXT / 纯血鸿蒙。
2. 核对 `applicationId` 与厂商控制台包名完全一致。
3. 核对当前测试包 SHA-256 与厂商控制台填写的指纹一致。
4. 确认 App 模块应用了对应厂商 Gradle 插件。
5. 确认 `agconnect-services.json` / `mcs-services.json` 位于 App 模块根目录，不在
   `src/main/assets`。
6. 运行构建，确认日志显示配置文件被读取。
7. 重新安装到华为 / 荣耀真机，抓取 `registerPush` 日志。
8. 如果厂商注册成功但终端不展示，转 `../../flows/android/delivered-not-displayed.md`。

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
