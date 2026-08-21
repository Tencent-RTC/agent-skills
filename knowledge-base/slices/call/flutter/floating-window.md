---
id: call/floating-window
platform: flutter
tags: [floating-window, pip, overlay, enableFloatWindow, picture-in-picture]
api_docs:
  - title: TUICallKit.instance.enableFloatWindow
    url: https://pub.dev/documentation/tencent_calls_uikit/latest/
---

# 悬浮窗

## 功能说明

通话中将通话界面缩小为悬浮窗，用户可在通话不中断的情况下浏览其他页面或切换 App。
典型场景：社交通话中查看消息、问诊通话中查阅病历、销售通话中查看商品。

悬浮窗按钮位于通话界面左上角，用户点击后进入悬浮窗模式。

要求 SDK 版本 `tencent_calls_uikit >= 5.0.0`。

## 核心概念

### 两个不同的能力：悬浮窗 vs 系统画中画

`enableFloatWindow` 控制的是**悬浮窗**，与**系统画中画（PiP）**是两回事，不要混为一谈：

| 能力 | 触发方式 | 实现机制 | 是否可切出 App |
|------|---------|---------|--------------|
| 悬浮窗（float window） | 通话界面左上角"缩小"按钮 | Flutter `OverlayEntry`（`CallPageType.floating`，121×181 的圆角浮层） | **否**——只在 App 前台可见，切出 App 即消失 |
| 系统画中画（PiP） | Android 按 Home 键自动进入 | 原生 MethodChannel `enablePictureInPicture` | 是——可悬浮在系统桌面/其他 App 之上 |

本 slice 只覆盖前者（悬浮窗）。PiP 是 SDK 在 Android 上自动启用的独立能力，
需要 `supportsPictureInPicture` + Android 8.0+，与悬浮窗按钮无关。

### enableFloatWindow

一行 API 开关，控制通话界面左上角是否出现"缩小"按钮：

```dart
TUICallKit.instance.enableFloatWindow(true);   // 开启
TUICallKit.instance.enableFloatWindow(false);  // 关闭（默认）
```

调用时机：登录成功后调用一次，全局生效。无需在每次通话前重复调用。

### 平台差异

| 平台 | 额外配置 | 说明 |
|------|---------|------|
| iOS | 无 | 悬浮窗为 App 内浮层，无系统权限要求 |
| Android | 无 | 悬浮窗为 App 内浮层，无系统权限要求 |

> ⚠️ 悬浮窗**不是**系统级悬浮窗（System Alert Window），不需要 `SYSTEM_ALERT_WINDOW`
> 权限，也不受厂商"悬浮窗权限"开关控制。它只是 Flutter 内部 overlay，仅在 App 前台生效。

### 悬浮窗状态

- 用户点击左上角按钮 → 通话界面缩小为悬浮窗
- 点击悬浮窗 → 恢复全屏通话界面
- 通话结束 → 悬浮窗自动消失
- 悬浮窗期间音视频流不中断（但切出 App 后悬浮窗不可见，通话仍在后台继续）

## 前置条件

- 已完成 basic call 集成
- `CallService.instance.isLoggedIn == true`

## 集成方式

本功能为一行 API 调用，已收录在 `playbooks/optional-tweaks.md` 的 `float-window` 项中。
通过 Phase 7.6 微调菜单选择"悬浮窗"即可自动接入。无需独立 template 文件。

## 最佳实践

### ✅ ALWAYS

- **必须在登录成功后调用** —— enableFloatWindow 依赖 SDK 内部状态，
  未登录时调用可能静默失效。
- **必须向用户说明悬浮窗只在 App 内生效** —— 切出 App 后悬浮窗不可见
  （通话仍在后台继续），这是 Flutter overlay 的设计行为，不是 bug。
- **必须区分「悬浮窗」和「系统画中画」** —— 前者是 App 内 overlay，后者
  才是切出 App 后仍可见的系统级能力，两者配置和触发方式不同。

### ❌ NEVER

- **绝不要在每次通话前重复调用 enableFloatWindow** —— 全局设置一次即可，
  重复调用虽不报错但浪费无意义。即使"保险起见多调一次"，也不必要。
- **绝不要向用户承诺"悬浮窗可在其他 App 之上显示"** —— 悬浮窗是 App 内
  overlay，切出 App 即不可见。需要系统级悬浮需另行实现（非 TUICallKit 能力）。
- **绝不要在悬浮窗显示时销毁承载通话的 Activity/Page** —— 虽然悬浮窗独立于页面，
  但底层通话引擎仍绑定在 App 进程中，强制销毁可能导致通话异常断开。

## 排障指南

### 常见问题

| 问题 | 原因 | 处理 |
|------|------|------|
| 通话界面没有缩小按钮 | 未调用 `enableFloatWindow(true)` | 登录成功后调用一次 |
| 切出 App 后悬浮窗消失了 | 悬浮窗是 App 内 overlay，非系统级 | 正常行为；需系统级悬浮请改用 PiP（按 Home 自动进入） |
| Android 按 Home 后进入小窗（PiP） | 系统画中画自动触发 | 正常行为；需 `supportsPictureInPicture` + Android 8.0+ |
| 悬浮窗消失后无法恢复 | 通话已结束 | 正常行为，非 bug |

### 排障流程

```
├─ 通话界面没有缩小按钮？
│   ├─ 是否调用了 enableFloatWindow(true)？
│   │   └─ 未调用 → 登录后添加调用
│   ├─ 调用时机是否正确（登录后）？
│   │   └─ 在登录前调用 → 移到登录成功后
│   └─ SDK 版本 >= 5.0.0？
├─ 切出 App 后悬浮窗不见了？
│   └─ 这是正常行为——悬浮窗只在 App 前台可见。
│       需要切出 App 仍可见，请确认 Android 走 PiP（按 Home 自动进入），
│       或告知用户系统级悬浮非 TUICallKit 能力
└─ iOS 无问题？
    └─ iOS 悬浮窗为 App 内 overlay，无额外配置需求
```

## 关联知识

- `call/basic-call`（基础通话，本功能的前置依赖）
- `call/device-control`（摄像头/麦克风，悬浮窗模式下设备状态保持不变）
