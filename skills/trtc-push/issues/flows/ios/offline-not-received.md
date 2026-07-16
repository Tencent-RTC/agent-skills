# iOS 离线推送收不到 / 不展示排查流程

## 入口现象

用户反馈 iOS 集成后收不到离线推送、杀进程后不弹通知、换证书后不生效，或在线消息正常
但 APNs 离线通知异常。

这类问题不能直接合并成一个根因。常见分支包括证书 ID / `businessID`、APNs 环境、
`deviceToken` 未上报、通知权限、系统投递延迟和跨端插件问题。

## 首轮证据

- App Bundle ID。
- 腾讯云应用 `SDKAppID`。
- iOS 证书 ID / `businessID`。
- 客户端包内 `timpush-configs.json`。
- APNs 证书类型、环境和过期时间。
- `deviceToken` 获取日志。
- TIMPush 注册成功 / 失败日志。
- 测试时 App 状态：前台、后台、杀进程。
- 控制台排查工具中的发送记录、目标 UserID / RegistrationID。

## 排查顺序

1. 先确认问题属于在线消息、离线 APNs 还是通知展示。
2. 确认 IM 登录和 TIMPush 注册链路完整。
3. 确认是否拿到 `deviceToken`。
4. 核对 `timpush-configs.json` 中证书 ID / `businessID` 与控制台一致。
5. 核对 Bundle ID、APNs 证书、Sandbox / Production 环境。
6. 用控制台排查工具确认 token 和发送记录。
7. 检查通知权限、专注模式、系统投递延迟、App 前后台状态。
8. 如果是 Flutter / uni-app 等跨端插件，继续确认插件版本、云打包依赖和原生桥接日志。

## 分支处理

| 分支 | 判断信号 | 处理动作 |
|---|---|---|
| 证书 ID / `businessID` 不一致 | 控制台证书 ID 与包内配置不同 | 按 `../../cards/ios/certificate-businessid.md` 修正 |
| APNs 环境不匹配 | Debug / Release、Sandbox / Production 混用 | 使用匹配环境证书和安装包重测 |
| `deviceToken` 未上报 | 无 `deviceToken` 或注册失败日志 | 查系统 APNs 注册、权限、代理回调 |
| APNs code=3000 / aps-environment | `NSCocoaErrorDomain Code=3000`、未找到 aps-environment | 按 `../../cards/ios/aps-environment-3000.md` 修 entitlements / XcodeGen yml |
| token 已上报但不展示 | 控制台有发送记录，设备不弹 | 查通知权限、系统投递、App 状态 |
| 跨端插件问题 | 原生端正常，插件端异常 | 查插件版本、构建日志和桥接回调 |

## 验证信号

- `deviceToken` 非空。
- TIMPush 注册成功。
- 控制台能查到目标 token。
- Release 包杀进程后可收到离线 APNs 通知。
- 若问题是展示层，通知权限开启后能正常弹通知。

## 何时升级 / 转交

- token 已上报、证书与环境均正确，但 APNs 投递长时间无记录。
- 涉及已发布旧包兼容旧证书 ID / `businessID`，需要后端确认是否可恢复映射。
- iOS 新系统版本疑似影响插件回调，需要提供 xlog / crash / 最小复现给产研。
