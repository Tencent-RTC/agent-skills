---
id: call/login-recovery
platform: flutter
tags: [login, kicked-offline, login-expired, usersig, loginEventStream, LoginEventListenerWidget]
api_docs:
  - title: LoginStore.shared.loginEventStream
    url: https://pub.dev/documentation/tencent_calls_uikit/latest/
---

# 登录态恢复

## 功能说明

处理两种登录态失效场景：

| 事件 | 触发条件 | 是否可自动恢复 |
|---|---|---|
| `kickedOffline` | 同账号在其他设备登录，当前设备被顶掉 | ❌ 另一设备已抢占，只能让用户重登 |
| `loginExpired` | UserSig 过期 | ✅ 可由后端刷新新 sig 后重登 |

SDK 版本要求：`tencent_calls_uikit >= 5.0.0`（使用 `LoginStore.shared.loginEventStream`，
不使用旧版 `TUICallEngine.addObserver(onKickedOffline:)`）。

## 核心概念

### 三种响应策略

| 策略 | 行为 | 适用场景 |
|---|---|---|
| `redirectLogin` | 收到事件 → SnackBar 提示 → 跳登录页 | 大多数场景，最稳妥 |
| `promptUser` | 收到事件 → 弹 AlertDialog → 用户确认后跳登录页 | 需要保留当前页面状态 |
| `autoRefresh` | `loginExpired` → 后端刷新 sig → 重登；`kickedOffline` 仍跳登录页 | 客服/自动化场景，需后端配合 |

### LoginEventListenerWidget

`templates/lib/trtc_call/login_event_listener.dart` 封装了三种策略，用户只需在首页 wrap
一层，不需要在 HomePage State 里自写 `initState` 订阅逻辑。

```dart
// 挂载点：login 后展示的第一个页面（HomePage 或路由根）
LoginEventListenerWidget(
  policy: LoginEventPolicy.redirectLogin,
  loginRoute: '/login',
  child: /* 原有 Widget */,
)
```

### 关键约束

**IM 控制台必须先配置"单端在线"**，否则 `kickedOffline` 永远不触发：

> trtc.io → 应用 → 功能配置 → 登录与消息 → 多端登录策略 → 单端在线 → 保存

`loginExpired` 不受此配置影响，任何时候都会触发。

### 与 basic call 的关系

basic call 已在 `CallService.loginWithSig` 内部保留一个空 listener（满足 SDK "login 前必须
先订阅"的硬性要求）。本 slice 在业务层**另起一个订阅**来实现策略逻辑，两个订阅并存、
互不干扰。

## 前置条件

- 已完成 basic call 集成（`lib/trtc_call/call_service.dart` 存在）
- IM 控制台已配置"单端在线"（kickedOffline 触发必要条件）

## 集成步骤

### Step 1 — INSTALL 模板文件

```
INSTALL templates/lib/trtc_call/login_event_listener.dart
     → lib/trtc_call/login_event_listener.dart
```

### Step 2 — PATCH 首页 build()

找到首页 Widget 的 `build()` 方法 `return` 语句，wrap 一层：

**redirectLogin + Navigator 命名路由**

```dart
// PATCH <首页文件> AT build() return 语句
return LoginEventListenerWidget(
  policy: LoginEventPolicy.redirectLogin,
  loginRoute: '/login',          // 替换为实际登录路由名
  child: /* 原有 return 的 Widget */,
);
```

**redirectLogin + GoRouter / 自建路由**

```dart
return LoginEventListenerWidget(
  policy: LoginEventPolicy.redirectLogin,
  onNavigateToLogin: (ctx) => GoRouter.of(ctx).go('/login'),
  child: /* 原有 Widget */,
);
```

**promptUser**（同上，policy 改为 `LoginEventPolicy.promptUser`）

**autoRefresh**

```dart
return LoginEventListenerWidget(
  policy: LoginEventPolicy.autoRefresh,
  loginRoute: '/login',
  onRefreshRequest: () async {
    // 从后端拿新 UserSig，返回三元组
    final resp = await yourApi.refreshUserSig(currentUserId);
    return (
      sdkAppId: TrtcCallBootstrap.sdkAppId!,
      userId: resp.userId,
      userSig: resp.userSig,
    );
    // 返回 null 时兜底跳登录页
  },
  child: /* 原有 Widget */,
);
```

### Step 3 — PATCH import

在首页文件顶部追加：

```dart
import 'trtc_call/login_event_listener.dart';
```

## 最佳实践

### ✅ ALWAYS

- **挂载在 login 后展示的第一个页面**（HomePage 或路由根），不要挂在子页面——login
  到 mount 之间有短窗口，挂太晚会漏事件
- **`autoRefresh` 必须提供 `onRefreshRequest`**，否则 Widget 在 initState 抛 StateError
- **GoRouter 场景用 `onNavigateToLogin` 回调**，不要传 `loginRoute`——GoRouter 不走
  `Navigator.pushNamedAndRemoveUntil`

### ❌ NEVER

- **不要期望 `kickedOffline` 能自动恢复**——另一台设备已抢占会话，无法静默重连
- **不要在 basic call 之前接这个 slice**——依赖 `CallService.loginWithSig` 已存在

## 调用时序

```
用户登录，CallService.loginWithSig() 成功
  │
  ▼
LoginEventListenerWidget 挂载，监听 loginEvents
  │
  ├─ 收到 kickedOffline
  │   ├─ redirectLogin → SnackBar + 跳登录页
  │   ├─ promptUser    → 弹 AlertDialog + 跳登录页
  │   └─ autoRefresh   → 跳登录页（无法自动恢复）
  │
  └─ 收到 loginExpired
      ├─ redirectLogin → SnackBar + 跳登录页
      ├─ promptUser    → 弹 AlertDialog + 跳登录页
      └─ autoRefresh   → onRefreshRequest() → 重登
                              └─ 失败 → 跳登录页
```

---

## 集成执行

> AI 帮用户跑 login-recovery 集成时按本节执行（步骤顺序不可调换）。
> 用户只是查询功能时读上方知识节即可，无需执行本节。

### E1 — IM 控制台前置引导

告知用户并 `AskUserQuestion` 单选：

> 要让"被踢下线"事件真正触发，需要先去 IM 控制台把多端登录策略改为"单端在线"：
> trtc.io → 你的应用 → 功能配置 → 登录与消息 → 多端登录策略 → 单端在线 → 保存
> （`loginExpired` 不受此配置影响，任何时候都会触发）

| # | label | value |
|---|---|---|
| 1 | 已配好单端在线 | `configured` |
| 2 | 暂时不配，只处理 loginExpired | `skip-console` |

写 `slice_login_recovery.im_console = <value>`，进 E2。

### E2 — 策略选择

`AskUserQuestion` 单选：

> 账号登录失效时，App 应该怎么响应？

| # | label | value |
|---|---|---|
| 1 | 跳回登录页（推荐）| `redirectLogin` |
| 2 | 弹窗提示，由用户决定 | `promptUser` |
| 3 | 静默重连（loginExpired 时自动刷新 UserSig，需后端配合）| `autoRefresh` |

写 `slice_login_recovery.policy = <value>`。`autoRefresh` → E3，其他 → E4。

### E3 — [autoRefresh only] 后端刷新接口

普通对话追问：

> `autoRefresh` 需要你后端提供刷新 UserSig 的接口。已有接口吗？

- 已有（含 URL / 方法名）→ 写 `refresh_endpoint = {status: ready, url: <url>}`
- 已有（无细节）→ 写 `{status: ready}`，用户在 `onRefreshRequest` 里自己实现
- 尚未 → 写 `{status: stub_needed}`，E5 额外生成 stub

进 E4。

### E4 — 确认路由方案

从 session `project_scan.route_scheme` + `q7_login_route` 读取（Phase 3a 已扫描）。
若 session 无此字段（slice 单独触发），快速 Read `lib/main.dart` 推断。

| route_scheme | 处理 |
|---|---|
| `navigator_named` | 用 `q7_login_route`（默认 `/login`）传 `loginRoute` 参数 |
| `go_router` / `auto_route` / 自建 | 用 `onNavigateToLogin` 回调，不传 `loginRoute` |

写 `slice_login_recovery.route_scheme = <value>`，进 E5。

### E5 — INSTALL + PATCH

**INSTALL**：
```
templates/lib/trtc_call/login_event_listener.dart → lib/trtc_call/login_event_listener.dart
```

**识别首页 Widget**：从 `project_scan.app_class_name` 或 `lib/main.dart` 的 `home:` 找到首页文件。

**PATCH 首页 build() return 语句**（按 policy × route_scheme 选对应代码示例，见上方§集成步骤）：
- 把原 `return <Widget>` 改为 `return LoginEventListenerWidget(... child: <Widget>)`
- `autoRefresh + stub_needed`：`onRefreshRequest` 先写 `return null`（占位），E5 末尾再 INSTALL stub

**PATCH import**（首页文件顶部追加，路径按目标文件相对 `lib/trtc_call/` 计算）：

- 目标文件在 `lib/` 直接下（如 `lib/home.dart`）→ `import 'trtc_call/login_event_listener.dart';`
- 目标文件在 `lib/pages/` 等一级子目录下 → `import '../trtc_call/login_event_listener.dart';`
- 目标文件在 `lib/pages/chat/` 等二级子目录下 → `import '../../trtc_call/login_event_listener.dart';`

**[stub_needed only] INSTALL stub**：
```
templates/snippets/slices/refresh-user-sig-stub.dart → lib/trtc_call/refresh_user_sig_stub.dart
```
*(stub 文件待建；未落地前告知用户"刷新接口 stub 还在开发中，onRefreshRequest 先留 `return null`")*

### E6 — Verify + 收尾

`RUN flutter analyze`，确认 0 error。

Grep 检查：
- `lib/trtc_call/login_event_listener.dart` 存在
- 首页文件含 `LoginEventListenerWidget`
- 首页文件含 `LoginEventPolicy.<policy>`

告知用户 3 个注意点：
1. 去第二台设备用同账号登录，触发策略验证
2. [go_router / 自建] `onNavigateToLogin` 里的跳转逻辑需填入你的路由方法
3. [autoRefresh] `onRefreshRequest` 需对接后端刷新接口

写 session `active_slice = null`，`active_flow = playbook-done`，回 Phase 7 菜单。

## 排障指南

### kickedOffline 事件不触发

```
检查 IM 控制台：trtc.io → 功能配置 → 登录与消息 → 多端登录策略
  ├─ 仍是"多端在线" → 改为"单端在线"并保存，等约 1 分钟生效
  └─ 已是"单端在线" → 检查 LoginEventListenerWidget 是否挂载在首页
```

### autoRefresh 后仍跳登录页

```
onRefreshRequest 返回了 null 或抛了异常
  ├─ 后端接口 404 / 500 → 检查 refreshUserSig 接口
  ├─ UserSig 仍然过期 → 检查后端签名逻辑（有效期通常 7 天）
  └─ 方法体里忘记 return → 确保最后 return 了三元组
```

### flutter analyze 报 non_constant_identifier_names

`LoginEvent.kickedOffline` 是 enum 值，确认 `tencent_calls_uikit` 版本 >= 5.0.0。

## 关联知识

- `call/basic-call`（基础通话，本 slice 的前置依赖）
