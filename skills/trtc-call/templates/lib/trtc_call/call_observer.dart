import 'package:tencent_calls_uikit/tencent_calls_uikit.dart';

/// 通话状态监控
///
/// 封装 [CallEventListener] 的注册和管理，让业务代码能监听通话生命周期变化。
///
/// ## 用法
///
/// ```dart
/// final observer = CallObserverManager();
///
/// // 注册（登录成功后）
/// observer.register(
///   onCallReceived: (callId, mediaType, userData) {
///     print('收到来电');
///   },
///   onCallStarted: (callId, mediaType) {
///     print('通话开始');
///   },
///   onCallEnded: (callId, mediaType, reason, userId) {
///     print('通话结束');
///     // 读取通话时长：CallStore.shared.state.activeCall.value?.duration
///   },
/// );
///
/// // 不再需要时移除
/// observer.unregister();
/// ```
class CallObserverManager {
  CallEventListener? _listener;

  /// 注册通话事件监听
  ///
  /// 所有回调均为可选，按需传入。
  /// 重复调用会先移除旧 listener 再注册新的。
  void register({
    /// 通话流程开始（主叫方，calls 发出后触发）
    void Function(String callId, CallMediaType mediaType)? onCallStarted,

    /// 收到来电邀请（被叫方触发）
    /// [userData] 主叫方传入的自定义数据
    void Function(String callId, CallMediaType mediaType, String userData)?
        onCallReceived,

    /// 通话结束（统一出口：挂断/超时/拒接/取消/对方设备接听）
    /// 通话时长：读 `CallStore.shared.state.activeCall.value?.duration`
    void Function(
            String callId, CallMediaType mediaType, CallEndReason reason, String userId)?
        onCallEnded,
  }) {
    unregister();

    _listener = CallEventListener(
      onCallStarted: onCallStarted,
      onCallReceived: onCallReceived,
      onCallEnded: onCallEnded,
    );

    CallStore.shared.addListener(_listener!);
  }

  /// 移除通话事件监听
  void unregister() {
    if (_listener != null) {
      CallStore.shared.removeListener(_listener!);
      _listener = null;
    }
  }

  /// 当前是否已注册
  bool get isRegistered => _listener != null;
}
