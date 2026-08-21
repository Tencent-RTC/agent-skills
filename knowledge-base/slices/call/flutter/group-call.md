---
id: call/group-call
platform: flutter
tags: [group-call, multi-party, calls, join, callId, CallParams, groupId]
api_docs:
  - title: TUICallKit.instance.calls
    url: https://pub.dev/documentation/tencent_calls_uikit/latest/
  - title: TUICallKit.instance.join
    url: https://pub.dev/documentation/tencent_calls_uikit/latest/
---

# 群组通话（多人通话）

## 功能说明

发起和加入多人音视频通话。支持最多 9 人（含自己）同时在线通话。
典型场景包括：多人协作会议、家庭通话、小组讨论、在线问诊多方会诊。

与 Conference（会议）的区别：群组通话是轻量级的多人通话，无需创建房间、
无主持人角色、无屏幕共享等会议功能。适合人数少（≤9）、即时发起的场景。

要求 SDK 版本 `tencent_calls_uikit >= 5.0.0`。

## 核心概念

### 发起 vs 加入

| 操作 | API | 适用角色 |
|------|-----|---------|
| 发起群组通话 | `GroupCall.start(userIds, mediaType, groupId)` | 主叫方 |
| 加入已有通话 | `GroupCall.join(callId)` | 被邀请方 / 后加入方 |

### groupId 的作用

| 场景 | groupId | 效果 |
|------|---------|------|
| 从 IM 群聊发起 | 传 IM 群组 ID | 被叫方来电界面显示群聊名称和上下文 |
| 纯临时多人通话 | 传空字符串 `''` | SDK 内部生成临时通话房间 |

groupId 不影响通话能力本身，只影响被叫方的来电展示信息。

### callId 的来源

`callId` 是每次通话的唯一标识，用于 `join()` 加入已有通话：
- 被叫方：从来电回调中获取（SDK 内部处理，通常无需手动使用）
- 业务场景：服务端下发通话链接时携带 callId，用户点击后调用 `join(callId)` 加入

### 人数限制

群组通话最多 **9 人**（含发起者）。`userIds` 列表最多 8 人。
超出限制时 SDK 返回错误。

### 与 CallService.startGroupCall 的关系

`CallService.instance.startGroupCall` 是 basic-call 集成时自动安装的基础方法，
功能等同于 `GroupCall.start`。本 slice 的 `GroupCall` 工具类额外提供：
- `join(callId)` 能力（CallService 不含）
- 参数校验（人数上限检查）
- 可选 `timeout` 参数
- 统一的 `GroupCallError` 错误类型

## 前置条件

- 已完成 basic call 集成（`lib/trtc_call/call_service.dart` 存在）
- `CallService.instance.isLoggedIn == true`
- [IM 群聊场景] 需要有效的 IM 群组 ID

## 集成步骤

### Step 1 — INSTALL 模板文件

```
INSTALL templates/lib/trtc_call/group_call.dart
     → lib/trtc_call/group_call.dart
```

### Step 2 — 在业务代码中使用

**发起群组通话（从 IM 群聊）**

```dart
import 'trtc_call/group_call.dart';

// 从群聊发起视频通话（群内其他 3 个成员）
await GroupCall.start(
  userIds: ['member_a', 'member_b', 'member_c'],
  mediaType: CallMediaType.video,
  groupId: 'im_group_123',
);
```

**发起临时多人通话**

```dart
// 无 IM 群，临时拉 2 人语音通话
await GroupCall.start(
  userIds: ['friend_001', 'friend_002'],
  mediaType: CallMediaType.audio,
);
```

**自定义超时**

```dart
// 60 秒等待接听（默认 30 秒）
await GroupCall.start(
  userIds: ['user_a', 'user_b'],
  mediaType: CallMediaType.video,
  timeout: 60,
);
```

**加入已有通话**

```dart
// 通过 callId 加入（callId 由服务端或分享链接提供）
await GroupCall.join(callId: 'call_abc_123');
```

无需 PATCH 现有文件。在你的群聊页面"发起通话"按钮或通话邀请链接处理中调用即可。

## 最佳实践

### ✅ ALWAYS

- **必须在发起前计算总人数** —— `userIds.length + 1（自己）≤ 9`，
  超出时 SDK 返回错误而非静默截断。应在 UI 层限制可选人数。
- **必须确保所有被叫方已完成 basic call 集成** —— 未集成的用户收不到来电弹窗，
  主叫方会看到对方"未应答"超时。
- **必须处理 GroupCallError** —— 常见失败：人数超限、groupId 无效、网络断开。
  向用户展示明确错误信息，不要静默失败。

### ❌ NEVER

- **绝不要传入超过 8 个 userId** —— 含自己共 9 人是硬限制。
  即使"多传几个让 SDK 自己截断"，也不可以——SDK 直接报错而非截断。
- **绝不要把不同 mediaType 的用户混在同一个群组通话** —— 同一通话房间
  所有成员必须使用相同的媒体类型。分别想用音频和视频的需求应分成两个通话。
- **绝不要在 1v1 通话中调用 join() 试图加入** —— `join(callId)` 仅适用于
  群组通话。1v1 通话不支持中途加入第三方。

## 排障指南

### 常见错误码

| 错误码 | 含义 | 常见原因 | 处理动作 |
|--------|------|---------|---------|
| -1 | 前置条件不满足 | 未登录 / userIds 为空 / callId 为空 | 检查登录态和参数 |
| -2 | 人数超限 | userIds > 8 人 | 减少被叫人数至 ≤ 8 |
| SDK 错误 | groupId 无效 | IM 群不存在或用户不在群内 | 检查 groupId 是否来自有效的 IM 群 |
| SDK 错误 | callId 不存在 | 通话已结束或 callId 错误 | 检查 callId 是否过期或拼写错误 |
| SDK 错误 | 网络异常 | 网络断开 | 提示用户检查网络后重试 |

### 排障流程

症状：发起群组通话后部分成员收不到来电

```
├─ GroupCallError 是否抛出？
│   ├─ 是 → 按错误码处理（见上表）
│   └─ 否（调用成功但部分人没收到）→ 继续
├─ 未收到来电的成员是否已登录 TUICallKit？
│   ├─ 否 → 对方 App 未登录或未完成 basic call 集成
│   └─ 是 → 继续
├─ 未收到的成员是否在另一个通话中？
│   ├─ 是 → SDK 会回调 onUserLineBusy（对方忙线）
│   └─ 否 → 继续
├─ 未收到的成员设备是否正常联网？
│   ├─ 否 → 网络问题，非 SDK 问题
│   └─ 是 → 继续
├─ 两端 SDKAppID 是否一致？
│   └─ 不一致 → 不同应用无法互通
└─ 都正常 → 检查 SDK 版本 >= 5.0.0；检查 IM 控制台是否正常
```

症状：join(callId) 失败

```
├─ callId 来源是否正确？
│   ├─ 来自旧通话（已结束）→ callId 已过期
│   └─ 来自当前进行中通话 → 继续
├─ 自己是否已在该通话中？
│   ├─ 是 → 重复 join 无效
│   └─ 否 → 继续
├─ 通话人数是否已达 9 人？
│   ├─ 是 → 无法再加入
│   └─ 否 → 检查网络和 SDK 版本
```

## 关联知识

- `call/basic-call`（基础通话，本 slice 的前置依赖）
- `call/call-invitation`（通话中追加邀请，与本 slice 配合使用；注意：临时多人通话无内置邀请按钮）
- `call/device-control`（通话中设备控制）

---

## 集成执行

> AI 帮用户跑 group-call 集成时按本节执行（步骤顺序不可调换）。
> 用户只是查询功能时读上方知识节即可，无需执行本节。

### E1 — 确认场景

`AskUserQuestion` 单选：

> 你的群组通话场景是什么？

| # | label | value |
|---|---|---|
| 1 | 从 IM 群聊发起（有 groupId） | `im-group` |
| 2 | 临时拉人通话（无 IM 群） | `temporary` |
| 3 | 两种都需要 | `both` |

写 `slice_group_call.scenario = <value>`，进 E2。

### E2 — INSTALL template

```
INSTALL templates/lib/trtc_call/group_call.dart
     → lib/trtc_call/group_call.dart
```

汇报：`[1/1] lib/trtc_call/group_call.dart ✔`

### E3 — Verify + 用法展示

**Verify**：

```bash
flutter analyze --no-pub
```

确认 0 error。

Grep 检查：
- `lib/trtc_call/group_call.dart` 存在
- 文件含 `class GroupCall`
- 文件含 `import 'package:tencent_calls_uikit/tencent_calls_uikit.dart'`

**展示用法**（按 scenario 裁剪）：

scenario = `im-group`：

> 群组通话已就绪。在你的群聊页面这样使用：
>
> ```dart
> import 'trtc_call/group_call.dart';
>
> // 从群聊发起视频通话
> await GroupCall.start(
>   userIds: memberIds,              // 群内其他成员 ID 列表（≤8 人）
>   mediaType: CallMediaType.video,
>   groupId: 'your_im_group_id',    // IM 群组 ID
> );
> ```

scenario = `temporary`：

> 群组通话已就绪。在你的通话入口这样使用：
>
> ```dart
> import 'trtc_call/group_call.dart';
>
> // 临时发起多人语音通话
> await GroupCall.start(
>   userIds: ['friend_a', 'friend_b'],
>   mediaType: CallMediaType.audio,
> );
> ```

scenario = `both`：展示两种用法。

所有场景追加：

> 如需通过链接/邀请加入已有通话：
> ```dart
> await GroupCall.join(callId: 'call_id_from_invitation');
> ```
>
> 注意事项：
> 1. 总人数上限 9 人（含自己）
> 2. 如需通话中追加成员 → 见 `call/call-invitation`（注意：临时多人通话无内置邀请按钮，需自建按钮调 `CallStore.shared.invite`）
> 3. 被叫方必须完成 basic call 集成才能收到来电

写 session `active_slice = null`，`active_flow = playbook-done`，回 Phase 7 菜单。
