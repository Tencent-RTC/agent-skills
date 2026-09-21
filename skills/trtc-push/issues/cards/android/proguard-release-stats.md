# Release 包推送统计异常（ProGuard）

## 与 MCP 的关系

本文件是 **知识卡**，不拥有独立主链。

- ROUTER `workflow_id`：`troubleshoot-android`
- 关联 flow：`flows/android/offline-not-received.md`
- 挂载：配置/发布相关知识（可在 stage-3 或分析阶段引用）
- 执行仍走 MCP 状态机；命中本卡后按挂载阶段取证，禁止用本卡替代 `complete_workflow_step`。

## 适用现象

当用户反馈以下任一现象时，优先使用本卡：

- Debug 包推送与统计正常，Release/minify 包触达统计异常。
- 混淆开启后推送相关能力异常。

不适用于：

- Debug/Release 都收不到 → 先走注册与厂商流程，不是本卡。

## 共同根因

R8/ProGuard 过度混淆 TIMPush 或厂商 SDK 相关类，导致上报/统计链路在 Release 失效。

常见错误模式：

- 未按文档添加 keep 规则。
- 只 keep 了业务类，未 keep 推送插件类。

## 必须收集的证据

- `minifyEnabled` / shrink 配置。
- 现有 proguard 规则文件。
- Debug vs Release 对比结果。
- SDK 版本。

## 排查步骤

1. 确认问题仅出现在 minify Release。
2. 对照官方 keep 规则查缺。
3. 补规则后重打 Release 验证统计。

## 解决方案

- 按 TIMPush Android 文档添加 ProGuard keep。
- 同步检查厂商 SDK 要求的 keep。
- 验证时使用同一 RegistrationID 对比 Debug/Release。

## 验证信号

- Release 包触达/统计与 Debug 趋势一致。
- 离线推送本身在 Release 仍可达。
