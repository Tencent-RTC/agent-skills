---
id: call/call-observer
platform: flutter
tags: [observer, callback, TUICallObserver, TUICallEngine, onCallReceived, onCallBegin, onCallEnd, onUserJoin, onUserLeave]
api_docs:
  - title: TUICallObserver
    url: https://pub.dev/documentation/tencent_calls_engine/latest/
  - title: TUICallEngine.instance.addObserver
    url: https://pub.dev/documentation/tencent_calls_engine/latest/
---

# 通话状态监控

## 功能说明

监听通话生命周期和成员动态变化，让业务代码能感知通话状态并做出响应。
典型场景：通话计时统计、通话结束后页面跳转、在线状态更新、通话记录写入、
群组通话成员列表实时刷新。

要求 SDK：`tencent_calls_engine`（`tencent_calls_uikit` 的 transitive 依赖，自动可用）。

## 核心概念

### TUICallObserver

SDK 提供的回调集合类，包含通话生命周期和成员动态的所有事件。
通过 `TUICallEngine.instance.addObserver(observer)` 注册。

### 事件分类

| 分类 | 事件 | 触发时机 |
|------|------|---------|
| 通话生命周期 | `onCallReceived` | 收到来电（被叫方） |
| | `onCallBegin` | 通话接通（双方建立连接） |
| | `onCallEnd` | 通话正常结束 |
| | `onCallNotConnected` | 通话未接通（超时/拒接/取消） |
| 成员动态 | `onUserJoin` | 用户加入通话 |
| | `onUserLeave` | 用户离开通话 |
| | `onUserInviting` | 用户正在被邀请中 |
| | `onUserReject` | 用户拒接 |

### CallEndReason

通话结束原因枚举，在 `onCallEnd` 和 `onCallNotConnected` 中通过 `reason` 参数获取。

### 与 TUICallKit 内置 UI 的关系

TUICallKit 的内置通话 UI 已经内部使用了这些回调来更新界面。你注册的 observer
是**额外**的监听，与 SDK 内部互不干扰，可以同时存在。

## 前置条件

- 已完成 basic call 集成（`lib/trtc_call/call_service.dart` 存在）
- `CallService.instance.isLoggedIn == true`
- import 来自 `tencent_calls_engine`（非 `tencent_calls_uikit`）

## 集成步骤

### Step 1 — INSTALL 模板文件

```
INSTALL templates/lib/trtc_call/call_observer.dart
     → lib/trtc_call/call_observer.dart
```

### Step 2 — 在业务代码中使用

```dart
import 'trtc_call/call_observer.dart';

// 创建 observer 管理器（通常作为页面/服务的成员变量）
final callObserver = CallObserverManager();

// 登录成功后注册
callObserver.register(
  onCallReceived: (callId, callerId, calleeIds, mediaType, info) {
    // 例：更新 UI 显示来电状态
  },
  onCallBegin: (callId, mediaType, info) {
    // 例：开始计时、更新在线状态
  },
  onCallEnd: (callId, mediaType, reason, userId, totalTime, info) {
    // 例：记录通话时长、跳转评价页
  },
  onUserJoin: (userId) {
    // 例：刷新群组通话成员列表
  },
);

// 页面退出或登出时移除
callObserver.unregister();
```

## 最佳实践

### ✅ ALWAYS

- **必须在登录成功后注册 observer** —— SDK 内部依赖登录态分发事件，
  未登录时注册的 observer 可能收不到回调。
- **必须在不需要时调用 unregister()** —— 不移除会导致 observer 对象
  无法被 GC 回收，持续占用内存，且可能在页面已销毁后触发回调导致异常。
- **必须处理 onCallNotConnected 区分不同原因** —— 超时、拒接、取消
  对业务逻辑的处理不同（如超时需重试提示，拒接则不重试）。

### ❌ NEVER

- **绝不要在 observer 回调中执行耗时操作** —— 回调在主线程触发，
  阻塞会导致通话 UI 卡顿。即使"只是写个数据库"，也不可以——应异步处理。
- **绝不要注册多个相同功能的 observer** —— 每次 `register()` 前会自动
  移除旧的，但如果你手动创建多个 `CallObserverManager` 实例且都注册，
  同一事件会触发多次。全局只用一个实例。
- **绝不要在 onCallEnd 里直接调用 Navigator.pop/push** —— SDK 内部
  可能还在清理通话 UI，立即操作 Navigator 会冲突。应用 `Future.delayed`
  或 `WidgetsBinding.instance.addPostFrameCallback` 延迟处理。

## 排障指南

### 常见问题

| 问题 | 原因 | 处理 |
|------|------|------|
| 注册后收不到任何回调 | 未登录或 import 包错误 | 确认 `isLoggedIn == true`；确认 import 是 `tencent_calls_engine` |
| onCallReceived 不触发 | 被叫方未完成 basic call 集成 | 检查 NavigatorObserver 是否正确注入 |
| 页面退出后回调仍触发 | 未调用 `unregister()` | 在 `dispose()` 中调用 |
| 回调触发但 UI 已销毁 | observer 生命周期未与页面绑定 | 在回调开头检查 `mounted` 或使用 weak reference |

### 排障流程

```
├─ 注册成功但收不到回调？
│   ├─ 确认已登录（CallService.instance.isLoggedIn）
│   ├─ 确认 import 是 tencent_calls_engine（不是 tencent_calls_uikit）
│   └─ 确认对端发起了通话（回调只在有实际通话事件时触发）
├─ onCallEnd 的 totalTime 为 0？
│   └─ 通话未接通（实际应走 onCallNotConnected）
├─ 回调触发后 App 崩溃？
│   ├─ 检查是否在已销毁的 State 中操作 UI
│   └─ 检查是否在回调中做了阻塞主线程的操作
└─ 多次收到同一事件？
    └─ 检查是否注册了多个 observer 实例
```

## 关联知识

- `call/basic-call`（基础通话，本 slice 的前置依赖）
- `call/group-call`（群组通话，onUserJoin/onUserLeave 在此场景最常用）
- `call/call-invitation`（通话中邀请，onUserInviting 在此场景触发；注意：UIKit 内置邀请按钮仅 IM 群聊场景）

---

## 集成执行

> AI 帮用户跑 call-observer 集成时按本节执行（步骤顺序不可调换）。
> 用户只是查询功能时读上方知识节即可，无需执行本节。

### E1 — 确认需求

`AskUserQuestion` 单选：

> 你需要监听哪些通话事件？

| # | label | value |
|---|---|---|
| 1 | 通话生命周期（来电/接通/结束）| `lifecycle` |
| 2 | 群组成员动态（加入/离开/拒接）| `members` |
| 3 | 全部都要 | `all` |

写 `slice_call_observer.scope = <value>`，进 E2。

### E2 — INSTALL template

```
INSTALL templates/lib/trtc_call/call_observer.dart
     → lib/trtc_call/call_observer.dart
```

汇报：`[1/1] lib/trtc_call/call_observer.dart ✔`

### E3 — Verify + 用法展示

**Verify**：

```bash
flutter analyze --no-pub
```

确认 0 error。

Grep 检查：
- `lib/trtc_call/call_observer.dart` 存在
- 文件含 `class CallObserverManager`
- 文件含 `import 'package:tencent_calls_engine/tencent_calls_engine.dart'`

**展示用法**（按 scope 裁剪）：

scope = `lifecycle`：

> 通话状态监控已就绪。在登录成功后这样注册：
>
> ```dart
> import 'trtc_call/call_observer.dart';
>
> final callObserver = CallObserverManager();
>
> callObserver.register(
>   onCallReceived: (callId, callerId, calleeIds, mediaType, info) {
>     print('收到来电: $callerId');
>   },
>   onCallBegin: (callId, mediaType, info) {
>     print('通话开始');
>     // 开始计时 / 更新状态
>   },
>   onCallEnd: (callId, mediaType, reason, userId, totalTime, info) {
>     print('通话结束，时长: ${totalTime}s');
>     // 记录通话 / 跳转页面
>   },
> );
>
> // 退出时移除
> callObserver.unregister();
> ```

scope = `members`：

> 通话状态监控已就绪。在群组通话场景中这样使用：
>
> ```dart
> callObserver.register(
>   onUserJoin: (userId) {
>     // 刷新成员列表
>   },
>   onUserLeave: (userId) {
>     // 从列表中移除
>   },
>   onUserReject: (userId) {
>     // 标记该用户拒接
>   },
> );
> ```

scope = `all`：展示两组用法。

所有场景追加：

> 注意事项：
> 1. 登录成功后注册，登出或页面退出时 `unregister()`
> 2. 回调在主线程触发，不要做耗时操作
> 3. import 是 `tencent_calls_engine`（非 `tencent_calls_uikit`）

写 session `active_slice = null`，`active_flow = playbook-done`，回 Phase 7 菜单。
