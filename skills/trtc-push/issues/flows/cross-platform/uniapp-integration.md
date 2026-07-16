# uni-app TIMPush 集成 / 云打包 / 运行时异常排查流程

## 入口现象

用户使用 uni-app / HBuilderX / UTS 插件接入 TIMPush，反馈云打包失败、`registerPush`
异常、某个平台收不到离线推送、角标或点击回调不符合预期。

uni-app 是跨端入口，不是单一根因。必须先判断问题落在构建、插件、iOS APNs、Android
厂商通道、配置文件还是业务参数。

## 首轮证据

- HBuilderX 版本。
- TencentCloud-Push / TIMPush 插件版本。
- 目标平台：iOS / Android / HarmonyOS。
- 云打包完整错误日志。
- `timpush-configs.json`。
- `registerPush` 成功 / 失败回调。
- 是否调用 `setRegistrationID`。
- 控制台证书 ID、厂商配置、目标设备品牌。
- 角标、点击回调或 ext/payload 相关参数。

## 排查顺序

1. 先区分编译期问题和运行期问题。
2. 编译期问题先看 HBuilderX、UTS 插件、CocoaPods / Gradle 依赖。
3. iOS 运行期问题转 `../ios/offline-not-received.md`。
4. Android 运行期问题转 `../android/vendor-not-received.md`。
5. 鸿蒙问题转 `harmonyos.md`。
6. 配置文件问题核对 `timpush-configs.json` 与控制台证书 ID / `businessID`。
7. 注册链路问题核对 `setRegistrationID` 和 `registerPush` 调用顺序。
8. 角标 / 点击问题转 `../common/badge.md` 或 `../common/server-api.md`。

## 分支处理

| 分支 | 判断信号 | 处理动作 |
|---|---|---|
| iOS 云打包 CocoaPods 依赖失败 | 找不到 `TXIMSDK_Plus_iOS_XCFramework` 等 Pod | 升级插件、等待云打包源同步或改用原生构建验证 |
| iOS 离线不达 | iOS 在线正常但离线无通知 | 转 iOS APNs 流程 |
| Android 厂商注册失败 | `800006`、`800008`、厂商 token 异常 | 转 Android 厂商流程 |
| 配置文件错误 | `timpush-configs.json`、证书 ID 不一致 | 重新下载正确应用配置 |
| 注册顺序错误 | 未绑定 UserID 或无回调 | 转 `../../cards/common/registration-binding.md` |
| 角标 / 点击回调 | 通知到达但角标/跳转异常 | 转角标或 API 流程 |

## 验证信号

- 云打包或本地构建通过。
- `registerPush` 成功回调。
- 对应平台可查到 token / RegistrationID。
- iOS / Android 分别通过离线推送验证。
- 角标 / 点击回调符合平台支持范围。

## 何时升级 / 转交

- 云打包平台依赖源未同步，需要插件或云打包服务侧确认。
- 插件版本支持范围不明确。
- 同一代码原生可用、uni-app 插件不可用，需要产研提供最小复现。
