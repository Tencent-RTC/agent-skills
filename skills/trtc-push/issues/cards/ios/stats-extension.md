# iOS 触达统计与 Notification Service Extension

## 与 MCP 的关系

本文件是 **知识卡**，不拥有独立主链。

- ROUTER `workflow_id`：`troubleshoot-ios`
- 关联 flow：`flows/ios/offline-not-received.md`
- 挂载：展示/统计子链知识
- 执行仍走 MCP 状态机；命中本卡后按挂载阶段取证，禁止用本卡替代 `complete_workflow_step`。

## 适用现象

当用户反馈以下任一现象时，优先使用本卡：

- iOS 推送能收到，但触达/展示统计不准或明显偏低。
- 文档要求 Extension，工程未集成 Notification Service Extension。
- 咨询统计延迟是否正常。

不适用于：

- 根本收不到推送 → `../../flows/ios/offline-not-received.md`。

## 共同根因

iOS 触达回执常依赖 Notification Service Extension 等上报能力；未集成或配置不完整会导致统计缺失。另有部分统计存在延迟，属预期而非故障。

常见错误模式：

- 把「统计为 0」当成「用户没收到」。
- 主 App 集成了 TIMPush，但未加 NSE Target。

## 必须收集的证据

- 用户是否真机收到通知（与统计分开）。
- 工程是否包含 Notification Service Extension。
- 控制台统计时间窗口与时延说明。
- SDK / 插件版本。

## 排查步骤

1. 先用真机确认实际到达，避免统计误导。
2. 核对是否按文档集成 Extension。
3. 解释统计延迟与采样差异。
4. 补齐 Extension 后对比同一时间窗数据。

## 解决方案

- 按官方文档集成 Notification Service Extension。
- 向用户说明部分指标延迟属预期。
- 统计仍异常且到达正常时，保留 TaskId 升级腾讯云侧。

## 验证信号

- 真机到达与触达趋势大致一致。
- Extension 进程在通知到达时可被触发（调试可见）。
