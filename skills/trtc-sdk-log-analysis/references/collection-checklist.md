# SDK 日志收集清单

## 给用户的最小请求

请提供以下信息，并把导出的文件直接上传，或放到项目内的 `.trtc-logs/` 目录：

1. **故障现象**：例如进房失败、无声、黑屏、卡顿、掉线、崩溃或通话挂起；
2. **故障时间**：开始时间、结束时间（含时区）；
3. **平台和运行形态**：Web / Android / iOS Simulator / iOS 真机 / Windows / macOS / Electron / 小程序 / Flutter 等；
4. **产品**：TRTC/LiteAV、IM、TUI/Call/Room/Live，或应用自身日志；
5. **SDK、框架和应用版本**：未知可以写“未知”；
6. **涉及设备或端**：例如主叫 iOS、被叫 Android，或浏览器名称。

不需要用户先筛选根因。优先提供故障时间窗口附近的原始文件，Agent 会在分析阶段区分来源。

## 建议收集的文件

按故障类型选择最小集合：

| 场景 | 最小文件集合 |
|---|---|
| TRTC 进房、推拉流、音视频质量 | TRTC/LiteAV 文件日志 + 应用日志 |
| TUI Call / Room / Live | TRTC/LiteAV + IM 日志 + 应用日志 |
| IM 消息、登录、群组 | IM 日志 + 应用日志 |
| 黑屏、无声、卡顿、掉线 | 对端/本端相关 SDK 日志 + 应用日志，必要时补网络或系统日志 |
| Crash 或挂起 | Crash 堆栈/系统报告 + 故障窗口内 SDK 和应用日志 |
| Web/H5 或小程序 | 浏览器 console/vConsole 导出 + 页面应用日志；若有原生容器，再补对应 SDK 日志 |

## 用户操作边界

- 只导出故障时间窗口附近的日志，避免上传全部历史文件；
- 将文件压缩后放入工作区时，建议目录名为 `.trtc-logs/`；
- 不要把 `SDKAppID`、`UserID`、`RoomID`、IP、token 或业务正文粘贴到聊天消息中，交给本地分析器脱敏；
- iOS 真机、Android 私有目录、Windows AppData、macOS sandbox 和远端设备通常需要通过 IDE/设备工具导出，Agent 1.0 不直接读取；
- 如果只有 `.clog/.xlog`，同时提供解码后的 `.log/.txt`，除非本地已配置可信 decoder。

## Agent 回收确认

收到文件后，先回显以下事实，不要复述日志正文：

- 实际收到的文件名、大小和类型；
- 推断的来源（TRTC / IM / TUI / app / crash / unknown）；
- 采用的时间窗口；
- 缺失但会影响结论的端、版本或日志源。
