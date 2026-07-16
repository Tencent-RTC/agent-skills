# HarmonyOS / 鸿蒙推送不达与适配排查流程

## 入口现象

用户反馈鸿蒙设备收不到推送、控制台 RegID 无法测试、Android APK 在鸿蒙设备上离线不达、
或 Flutter / uni-app / HAR 接入鸿蒙后异常。

鸿蒙问题必须先区分系统和应用形态，不能直接套 Android 厂商通道流程。

## 首轮证据

- 系统类型：HarmonyOS NEXT / 纯血鸿蒙 / Android 兼容鸿蒙 / 普通华为 Android。
- 应用形态：原生 HarmonyOS、Android APK、Flutter、uni-app。
- 使用的 SDK / HAR / 插件版本。
- 是否使用客户端密钥或服务端密钥。
- 华为 / 鸿蒙推送控制台应用、包名、签名或证书配置。
- `registerPush` 日志、RegID / token、错误码。
- 是否涉及角标、title / desc 展示或点击跳转。

## 排查顺序

1. 先确认是否为 HarmonyOS NEXT / 纯血鸿蒙。
2. 确认应用是鸿蒙原生应用还是 Android APK 兼容模式。
3. 如果是纯血鸿蒙，确认当前 SDK / 插件是否支持鸿蒙原生 Push。
4. 如果是 Android 兼容模式，回到华为 AGConnect、包名、签名、`agconnect-services.json` 排查。
5. 核对使用的是客户端密钥还是服务端密钥。
6. 如果推送已到达但角标、title、desc 展示异常，按系统展示能力边界处理。
7. 跨端框架先确认插件支持范围，不要把能力缺失判断为配置错误。

## 分支处理

| 分支 | 判断信号 | 处理动作 |
|---|---|---|
| 纯血 HarmonyOS 使用 Android APK 方案 | NEXT / 纯血系统，Android 通道不通 | 改用鸿蒙原生 Push 接入 |
| Android 兼容模式华为通道异常 | `800006`、签名或 AGConnect 错误 | 查 `../../cards/android/vendor-huawei.md` |
| 密钥类型错误 | 使用服务器密钥注册客户端 Push | 改用客户端密钥 |
| 跨端插件不支持 | Flutter / uni-app 插件声明不支持鸿蒙 | 使用原生层混合接入或等待插件适配 |
| 系统展示差异 | title / desc / 角标行为异常 | 按鸿蒙系统展示规则和厂商限制解释 |

## 验证信号

- 系统形态和应用形态判断清楚。
- 原生鸿蒙或 Android 兼容路径使用正确 SDK / 通道。
- 注册成功并拿到非空 RegID / token。
- 控制台测试推送能在目标鸿蒙设备收到。

## 何时升级 / 转交

- HarmonyOS NEXT 适配能力未在当前 SDK / 插件中明确声明。
- HAR 崩溃、路径解析、字节码兼容等问题需要最小复现。
- 厂商系统展示行为需要华为 / 鸿蒙侧确认。
