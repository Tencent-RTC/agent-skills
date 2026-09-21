# UniApp 推送集成排查流程

## 与 MCP 的关系

uni-app「收不到 / 注册失败」排障由 **MCP `troubleshoot-uniapp`** 状态机固化：

| state | 主链步骤 |
|-------|----------|
| `stage-0-investigation-plan` | 排查计划确认（开场闸口） |
| `stage-1-console-validity` | 控制台有效性（服务 + 目标端证书） |
| `stage-2-scenario` | 测法与形态（collect：基座、编译/运行期） |
| `stage-3-config-alignment` | 配置对齐（verify：原生 + nativeResources） |
| `stage-4-register-observation` | registerPush 观测 |
| `stage-5-token-binding` | 推送 token 绑定 |
| `stage-6-offline-test` | 离线发测 |
| `stage-7-analyze` → `stage-9-final-report` | 分析 / 修复 / 结论 |

打包 / 基座 / 插件导入属**集成问题**（SDK 安装路线）；MCP stage-2 已区分编译期 vs 运行期，编译期问题走打包/基座知识，本文件不替代 wizard。

## 分支处理

| 分支 | 判断信号 | 处理动作 |
|---|---|---|
| 控制台无效 | 插件未开/到期、证书无效 | `../../cards/common/console-validity-gate.md`；MCP stage-1 |
| 基座 / 路径 / config.json | 打包或配置层 | MCP stage-3 + 原生 flow |
| Android 厂商 | 某品牌收不到 | `../android/vendor-not-received.md` + `troubleshoot-android` |
| Android 收不到通用 | 场景不清 | `../android/offline-not-received.md` |
| Android 错误码 | registerPush fail | `../../cards/android/error-codes.md` |
| Android 已送达不弹 | 后台点击恢复 | `../android/delivered-not-displayed.md` |
| Android 点击无跳转 | 能收不跳 | `../android/click-no-action.md` |
| Android 强杀不达 | 强制停止后 | `../../cards/android/kill-process-offline.md` |
| FCM | 海外设备 / `FCM unavailable` | `../../cards/android/fcm-gms-domestic.md` |
| iOS | 证书/展示/点击/收不到 | `../ios/offline-not-received.md` + `troubleshoot-ios` |
| 鸿蒙 | HarmonyOS 或 APK | `../harmonyos/offline-not-received.md` + `troubleshoot-harmony` |

## 验证信号

- MCP stage-1 / stage-3 通过。
- registerPush 成功；能查到已绑定推送 token。
- 自定义基座 + 后台/杀进程离线测试可达或回执可解释。

## 何时升级 / 转交

- 原生证据齐全仍不达。
- 需产品确认基座 / HBuilderX 限制。
- 用户授权修改工程与配置后执行具体修复（走 wizard/集成路线）。
