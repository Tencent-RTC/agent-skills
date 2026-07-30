import 'dart:async';

import 'package:flutter/material.dart';
import 'package:tencent_calls_uikit/tencent_calls_uikit.dart';
import 'call_service.dart';

typedef CallButtonErrorHandler =
    FutureOr<void> Function(Object error, StackTrace stackTrace);

class CallButtonTargetError implements Exception {
  final String message;

  const CallButtonTargetError(this.message);

  @override
  String toString() => message;
}

/// TRTC 单个通话触发按钮
///
/// 单一组件覆盖 audio / video 两种媒体形式（q3=audio / video / both 都用同一组件，
/// 只是在 call site 传不同的 [mediaType] 与 [icon]）。
///
/// ## 用法
///
/// ```dart
/// // 语音通话
/// CallButton(
///   onGetUserId: () async => targetUser.userId,
///   mediaType: CallMediaType.audio,
///   icon: Icons.call,
/// )
///
/// // 视频通话
/// CallButton(
///   onGetUserId: () async => targetUser.userId,
///   mediaType: CallMediaType.video,
///   icon: Icons.videocam,
/// )
///
/// // 语音 + 视频并排（q3=both）
/// Row(children: [
///   CallButton(
///     onGetUserId: () async => targetUser.userId,
///     mediaType: CallMediaType.audio,
///     icon: Icons.call,
///   ),
///   const SizedBox(width: 8),
///   CallButton(
///     onGetUserId: () async => targetUser.userId,
///     mediaType: CallMediaType.video,
///     icon: Icons.videocam,
///   ),
/// ])
/// ```
///
/// ## 设计说明
///
/// - `onGetUserId` 是异步 callback，覆盖两种业务场景：
///   - 已知 userId：`() async => 'target_user_001'`
///   - 动态查询：`() async => await api.resolveUserId(...)`
/// - [child] / [icon] / [style] 可复用现有按钮视觉
/// - [onError] 可接入业务错误提示；未传时才使用默认 SnackBar
/// - [service] 可在测试中注入使用 Fake adapter 的 CallService
/// - 从解析 userId 开始即进入 loading，防止异步查询期间重复点击
class CallButton extends StatefulWidget {
  final Future<String> Function() onGetUserId;
  final CallMediaType mediaType;
  final IconData? icon;
  final Widget? child;
  final Widget? loadingChild;
  final ButtonStyle? style;
  final String? tooltip;
  final double iconSize;
  final Key? buttonKey;
  final CallService? service;
  final CallButtonErrorHandler? onError;

  const CallButton({
    super.key,
    required this.onGetUserId,
    required this.mediaType,
    this.icon,
    this.child,
    this.loadingChild,
    this.style,
    this.tooltip,
    this.iconSize = 32,
    this.buttonKey,
    this.service,
    this.onError,
  }) : assert(icon != null || child != null);

  @override
  State<CallButton> createState() => _CallButtonState();
}

class _CallButtonState extends State<CallButton> {
  bool _calling = false;

  @override
  Widget build(BuildContext context) {
    return IconButton(
      key:
          widget.buttonKey ??
          ValueKey<String>('trtc-call-button-${widget.mediaType.name}'),
      icon: _calling
          ? widget.loadingChild ??
                const SizedBox(
                  width: 20,
                  height: 20,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
          : widget.child ?? Icon(widget.icon),
      iconSize: widget.iconSize,
      style: widget.style,
      tooltip: widget.tooltip,
      onPressed: _calling ? null : _onPressed,
    );
  }

  Future<void> _onPressed() async {
    if (_calling) {
      return;
    }
    setState(() => _calling = true);
    try {
      final userId = (await widget.onGetUserId()).trim();
      if (userId.isEmpty) {
        throw const CallButtonTargetError('请先输入对方 userId');
      }
      await (widget.service ?? CallService.instance).startCall(
        userId,
        widget.mediaType,
      );
    } catch (error, stackTrace) {
      await _handleError(error, stackTrace);
    } finally {
      if (mounted) setState(() => _calling = false);
    }
  }

  Future<void> _handleError(Object error, StackTrace stackTrace) async {
    if (widget.onError != null) {
      await widget.onError!(error, stackTrace);
      return;
    }
    if (!mounted) {
      return;
    }
    final message = error is CallButtonTargetError
        ? error.message
        : '发起通话失败: $error';
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(message)));
  }
}
