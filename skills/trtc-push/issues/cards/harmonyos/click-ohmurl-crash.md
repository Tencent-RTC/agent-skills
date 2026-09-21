# HarmonyOS 点击推送崩溃（OHMUrl）

## 与 MCP 的关系

本文件是 **知识卡**，不拥有独立主链。

- ROUTER `workflow_id`：`troubleshoot-harmony`
- 关联 flow：`flows/harmonyos/offline-not-received.md`
- 挂载：点击分支知识（OHMUrl）
- 执行仍走 MCP 状态机；命中本卡后按挂载阶段取证，禁止用本卡替代 `complete_workflow_step`。

## 适用现象

当用户反馈以下任一现象时，优先使用本卡：

- HarmonyOS 点击离线通知后应用崩溃。
- 崩溃栈或配置涉及 `useNormalizedOHMUrl` / HAR 路由。
- 推送能展示，点击即崩。

不适用于：

- 注册失败 / 80300002 → `../../flows/harmonyos/offline-not-received.md`。
- Flutter 鸿蒙未适配 → 同 flow 产品边界说明。

## 共同根因

点击跳转依赖鸿蒙路由/HAR 配置；开启规范化 OHMUrl 等与推送扩展字段不兼容时，可能在点击处理路径崩溃。

常见错误模式：

- 只测展示、未测点击。
- 路由表与推送 ext 不一致仍强行跳转。

## 必须收集的证据

- 完整崩溃栈。
- 是否启用 `useNormalizedOHMUrl` 等路由规范化。
- 推送 ext / 跳转目标。
- TIMPush / HAR 版本。

## 排查步骤

1. 确认是点击路径崩溃而非注册失败。
2. 对照官方鸿蒙跳转文档检查路由与规范化开关。
3. 用最小 ext 复现。
4. 仍复现则记录版本与栈，转 SDK 角色。

## 解决方案

- 按文档调整 OHMUrl / 路由配置，避免不兼容组合。
- 暂时去掉有问题的跳转字段，先保证点击打开 App 不崩。
- 升级到文档推荐版本后再启用复杂跳转。

## 验证信号

- 点击通知不再崩溃，可到达目标页或安全落地页。
