# SDK 日志路径指引（1.0）

本文件只用于生成**用户导出指引**。路径是按产品、平台和版本整理的候选，不代表 Agent 可以直接访问，也不能替代代码里的自定义日志目录。优先级应为：用户明确路径 → 代码中的自定义配置 → 版本化官方规则 → 用户验证后的候选。

## TRTC / LiteAV

| 平台 | 默认候选位置或导出方式 | 说明 |
|---|---|---|
| iOS | App sandbox `Documents/log` | 真机通常通过 Xcode/设备容器导出；Simulator 需从对应 App container 导出 |
| macOS | App sandbox `Documents/log` | 非沙箱应用要结合应用配置；优先检查 `setLogDirPath` 自定义目录 |
| Windows 8.8+ | `%appdata%/liteav/log` | 需要确认 SDK 版本和实际用户目录 |
| Windows 8.8 以前 | `%appdata%/tencent/liteav/log` | 作为旧版本候选，不要与新路径混为一谈 |
| Android | App 私有目录 `files/log/liteav/` | 私有目录通常需要 Android Studio/应用导出；历史版本还可能使用外部存储候选 |
| Android 历史候选 | `/sdcard/log/tencent/liteav`、`/sdcard/Android/data/<包名>/files/log/tencent/liteav/`、`/sdcard/Android/data/<包名>/files/log/liteav/` | 必须按版本和实际存在性确认 |
| Web/H5 | 浏览器 DevTools console、页面侧 vConsole 或业务导出 | 不假设存在本地 TRTC 文件日志 |
| Electron | 映射宿主 Windows/macOS 规则，并补充主进程/渲染进程 console | 打包路径和 SDK 版本可能改变实际位置 |

官方参考：

- [TRTC 日志接口与默认路径](https://trtc.io/zh/document/50754)
- [TRTC 各版本日志路径与 `.xlog/.clog`](https://trtc.io/zh/document/54895)

## IM / Chat

| 平台 | 默认候选位置或导出方式 | 说明 |
|---|---|---|
| iOS | App sandbox `Library/Caches/com_tencent_imsdk_log` | 与 TRTC 的 `Documents/log` 不同 |
| Android 4.8.50+ | `/sdcard/Android/data/<包名>/files/log/tencent/imsdk` | 旧版本路径按官方文档和实际存在性确认 |
| Windows | 程序运行目录下 `com_tencent_imsdk_log/` | 先确认实际 executable/runtime 目录 |
| macOS / Electron / Web | 无目标版本明确规则时，进入“待确认”，使用应用导出、console 或官方文档核验 | 不要沿用 TRTC 路径 |

IM 本地日志通常有保留期，收集时优先按故障时间窗口筛选。官方参考：[IM SDK 日志路径、保留期和日志监听器](https://trtc.io/zh/document/47968)。

## 跨端框架与上层产品

- Flutter、React Native：先识别实际运行目标，再使用 iOS、Android、Windows、macOS 或 Web 的底层规则；不要把 Flutter/RN 工程目录当成 SDK 日志目录。
- Unity、Unreal：同时询问构建目标、原生 SDK 插件和引擎 console；日志位置继承宿主 OS/设备。
- TUICallKit、TUIRoomKit、TUILiveKit：按依赖同时收集 TRTC/LiteAV 和 IM 日志，并在文件清单中分别标记来源。
- 小程序：优先通过开发者工具、体验版 vConsole 或平台导出；不要假设能从 IDE 工作区自动找到设备运行日志。

## 非 SDK 日志补充

当 SDK 日志不足以解释现象时，引导用户补充最小的同时间窗口文件：

- iOS/macOS：Xcode 或系统 Console 导出的 Crash/应用日志；
- Android：Android Studio/logcat 导出的文本或系统 Crash 报告；
- Windows：应用自身日志或用户从 Event Viewer 导出的相关事件；
- Web/Electron：浏览器或 Electron console 导出，以及应用日志；
- 远端生产设备：由用户、客服、设备管理或运维系统导出，不要求本地 Agent 直接访问。

这些是辅助证据，不应被误标为 TRTC/IM SDK 日志。
