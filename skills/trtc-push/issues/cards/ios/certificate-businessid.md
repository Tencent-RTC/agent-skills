# iOS 证书 ID / businessID 配置失效

## 适用现象

当用户反馈以下现象时，优先使用本卡：

- iOS 在线消息正常，但离线推送收不到。
- 更换、删除、重建 APNs 证书后，原安装包离线推送失效。
- `timpush-configs.json` 中证书编号 / `businessID` 与控制台当前证书不一致。
- 控制台接入测试可以触发部分链路，但真实离线消息仍不达。

不适用于“证书、token、businessID 均正确，但杀进程后短时间系统不投递”的问题；那类
问题应走 `../../flows/ios/offline-not-received.md` 的系统投递/通知权限分支。

## 共同根因

iOS 离线推送依赖客户端上报的 APNs token 和当前腾讯云应用下的证书 ID / `businessID`
匹配。删除重建证书、换 SDKAppID、下载了错误应用的 `timpush-configs.json`，或客户端
写死旧证书 ID，都会导致服务端按错误证书链路投递。

## 必须收集的证据

- 当前 App 的 Bundle ID。
- 当前腾讯云应用 `SDKAppID`。
- 控制台 iOS 证书 ID / `businessID`。
- 客户端包内 `timpush-configs.json` 的证书编号。
- APNs 证书类型（P8 / P12）、环境（Sandbox / Production）、过期时间。
- 客户端是否拿到 `deviceToken` 并完成 TIMPush 注册。
- 证书是否被删除重建，是否需要兼容已发布旧包。

## 排查步骤

1. 先区分在线消息、离线 APNs、通知展示三个阶段。
2. 核对 `SDKAppID`：IM 应用、Push 控制台和客户端配置必须指向同一应用。
3. 核对 Bundle ID：APNs 证书绑定的 Bundle ID 必须与 App 实际 Bundle ID 一致。
4. 核对 `timpush-configs.json`：证书编号 / `businessID` 必须来自当前控制台证书。
5. 核对 APNs 环境：开发包、Release 包、Sandbox / Production 证书不能混用。
6. 如果用户删除重建过证书，确认旧包是否写死旧证书 ID；必要时评估后端恢复映射或发版
   更新配置。
7. 如证书链路正确，再进入 `../../flows/ios/offline-not-received.md` 继续排查 token、权限、
   系统投递延迟或插件问题。

## 解决方案

- 重新从正确 `SDKAppID` 的控制台下载 `timpush-configs.json`，随 App 重新打包。
- 修正客户端配置中的证书 ID / `businessID`。
- APNs 证书删除重建后，如果旧包无法发版更新，需要后端或控制台侧确认是否能恢复旧
  证书 ID 映射；不能恢复时必须发版。
- 证书过期时优先编辑更新原证书，避免删除重建导致 `businessID` 改变。

## 验证信号

- 客户端日志中可看到 `deviceToken`。
- TIMPush 注册成功，且 token 绑定到当前证书 ID / `businessID`。
- 控制台排查工具能查到目标用户的 iOS token。
- Release 包在杀进程后能收到离线 APNs 通知。
