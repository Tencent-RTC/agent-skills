---
id: call/call-invitation
platform: flutter
tags: [invitation, group-call, invite, add-member, CallStore, invite]
api_docs:
  - title: CallStore.shared.invite
    url: https://pub.dev/documentation/atomic_x_core/latest/
---

# 通话中追加邀请

## 功能说明

在已进行的群组通话中邀请新成员加入。被邀请方收到来电弹窗，接受后进入当前通话房间。
典型场景：多人协作会议中拉入新同事、家庭群聊通话中追加家人、客服转接给第三方。

要求 SDK 版本 `tencent_calls_uikit >= 5.0.0`。群组通话总人数上限为 9 人（含自己）。

## 核心概念

### ⚠️ 关键约束：UIKit 内置按钮仅限 IM 群聊场景

`tencent_calls_uikit` 通话界面右上角的「添加成员」按钮，其渲染条件**硬绑定 `chatGroupId`**：

```dart
// call_main_widget.dart（SDK 内部）
_buildInviterUserBtnWidget() {
  return CallStore.shared.state.activeCall.value.chatGroupId.isNotEmpty
      ? Positioned(/* 邀请按钮 */)
      : const SizedBox();   // chatGroupId 为空 → 不渲染
}
```

且点开后的候选人列表是 `getGroupMemberList(chatGroupId)` 从 **IM 群成员**拉取的
（`invite_user_widget.dart`），不是「任意 userId 搜索」。

结论：

| 场景 | 内置按钮 | 说明 |
|------|:---:|------|
| 从 IM 群聊发起的通话（传真实 `chatGroupId`） | ✅ 出现 | 候选人 = 群成员列表 |
| 纯临时多人通话（不传 `chatGroupId`） | ❌ 不出现 | 无内置邀请入口 |

> 因此：**临时多人通话要邀请，必须自建按钮**，调下面 `CallStore.shared.invite()`。
> 本能力提供的是「引擎层 API」，不是「开箱即用的 UI」。

### 底层 API

邀请动作本身在 engine 层是真实可用的，不依赖 `chatGroupId`：

```dart
// atomic_x_core 的 CallStore（tencent_calls_uikit 已 re-export）
Future<CompletionHandler> invite(List<String> participantIds, CallParams? params);
```

内置邀请页 `_inviteUser()` 调用的正是 `CallStore.shared.invite(userIdList, CallParams())`
（传空 `CallParams()`），所以即使是临时通话，只要你有入口，也能把人拉进来。

### 人数限制

群组通话最多 9 人（含发起者）。邀请时应确保 `当前人数 + 新邀请人数 ≤ 9`，
超出时 SDK 返回错误。

## 用法（自建按钮场景）

```dart
import 'package:tencent_calls_uikit/tencent_calls_uikit.dart'; // re-export CallStore

// 你自建通话 UI 的「邀请」按钮回调里：
final result = await CallStore.shared.invite(
  ['user_003', 'user_004'],
  CallParams(),
);
if (!result.isSuccess) {
  // 处理 result.errorCode / result.errorMessage
}
```

## 最佳实践

### ✅ ALWAYS

- **必须在群组通话进行中调用** —— 非通话状态下调用语义混乱（等同于发起新通话）。
- **必须确保总人数不超过 9 人** —— 超出时 SDK 返回错误，应在调用前计算当前人数 + 新邀请人数。
- **必须自建邀请入口（临时通话场景）** —— 临时多人通话无内置按钮，不自己写按钮用户就无交互。

### ❌ NEVER

- **绝不要假设内置按钮在任何群组通话都出现** —— 它只在 `chatGroupId` 非空时渲染。
- **绝不要在 1v1 通话中调用追加邀请** —— 1v1 不支持中途追加成员。
- **绝不要把 mediaType 设为与当前通话不同的类型** —— 同房间所有成员必须用相同媒体类型。

## 排障指南

| 症状 | 原因 | 处理 |
|------|------|------|
| 通话界面没有「添加成员」按钮 | `chatGroupId` 为空（临时多人通话） | 设计行为；自建按钮调 `invite()` |
| 有按钮但点开是空列表 | 传了不存在/无效的 `chatGroupId` | 确认传入真实 IM 群 ID |
| 调用 `invite()` 后被邀请方收不到来电 | 被邀请方未完成 basic call 集成 / 未登录 | 对方补齐集成并登录 |
| `invite()` 返回 error | 人数超限 / 用户不存在 / 网络异常 | 按 `errorCode` 处理 |

## 关联知识

- `call/group-call`（群组通话发起，本能力是其通话中扩展）
- `call/basic-call`（基础通话，前置依赖）
