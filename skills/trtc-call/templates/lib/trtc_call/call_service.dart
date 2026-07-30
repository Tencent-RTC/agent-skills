import 'dart:async';
import 'package:tencent_calls_uikit/tencent_calls_uikit.dart';

/// TUICallKit 调用边界。
///
/// 生产环境使用 [TencentCallSdkAdapter]；测试时注入 Fake，避免执行真实 SDK。
abstract interface class CallSdkAdapter {
  Stream<LoginEvent> get loginEvents;

  Future<void> login(int sdkAppId, String userId, String userSig);

  Future<void> startCall(String userId, CallMediaType mediaType);

  Future<void> startGroupCall(
    List<String> userIds,
    CallMediaType mediaType, {
    String chatGroupId = '',
  });

  Future<void> logout();
}

class TencentCallSdkAdapter implements CallSdkAdapter {
  const TencentCallSdkAdapter();

  @override
  Stream<LoginEvent> get loginEvents => LoginStore.shared.loginEventStream;

  @override
  Future<void> login(int sdkAppId, String userId, String userSig) async {
    final result = await TUICallKit.instance.login(sdkAppId, userId, userSig);
    if (!result.isSuccess) {
      throw Exception('登录失败 [${result.errorCode}]: ${result.errorMessage}');
    }
  }

  @override
  Future<void> startCall(String userId, CallMediaType mediaType) async {
    final result = await TUICallKit.instance.calls([userId], mediaType);
    if (!result.isSuccess) {
      throw Exception('发起通话失败 [${result.errorCode}]: ${result.errorMessage}');
    }
  }

  @override
  Future<void> startGroupCall(
    List<String> userIds,
    CallMediaType mediaType, {
    String chatGroupId = '',
  }) async {
    final params = CallParams(chatGroupId: chatGroupId);
    final result = await TUICallKit.instance.calls(userIds, mediaType, params);
    if (!result.isSuccess) {
      throw Exception('发起多人通话失败 [${result.errorCode}]: ${result.errorMessage}');
    }
  }

  @override
  Future<void> logout() async {
    await TUICallKit.instance.logout();
  }
}

/// TRTC Call 业务能力单例
///
/// 提供：
///   - [loginEvents]: 订阅登录事件流（kickedOffline / loginExpired）
///   - [loginWithSig]: 使用 UserSig 登录 TUICallKit
///   - [startCall] / [startGroupCall]: 发起 1v1 / 群组通话
///   - [logout]: 退出登录
///
/// 初始化（本地化 + navigatorObserver）由 `TrtcCallBootstrap.run` 完成，
/// 本类不负责 SDK 初始化，只承载登录 + 通话业务能力。
class CallService {
  static final CallService instance = CallService();

  final CallSdkAdapter _adapter;

  CallService({CallSdkAdapter? adapter})
    : _adapter = adapter ?? const TencentCallSdkAdapter();

  StreamSubscription<LoginEvent>? _loginEventSub;
  bool _isLoggedIn = false;

  bool get isLoggedIn => _isLoggedIn;

  /// 登录事件流
  ///
  /// - [LoginEvent.kickedOffline]：同一账号在其他设备登录，当前设备被踢
  /// - [LoginEvent.loginExpired]：UserSig 过期，需刷新后重新登录
  ///
  /// 来源：`atomic_x_core/lib/api/login/login_store.dart`（公开 API，通过
  /// `tencent_calls_uikit` export 链自动可用）。官方 dartdoc 明确 recommended
  /// 在 [TUICallKit.instance.login] 之前订阅。
  ///
  /// 底层是 broadcast stream，允许多处同时订阅（例如 CallService 内部保留
  /// 一个订阅确保 login 前有 listener，业务 UI 层可再独立订阅决策跳转）。
  Stream<LoginEvent> get loginEvents => _adapter.loginEvents;

  /// 使用 UserSig 登录 TUICallKit
  ///
  /// SDK 要求在 login 之前先订阅 [LoginStore.shared.loginEventStream]，
  /// 本方法内部已处理该订阅。
  ///
  /// - [sdkAppId] TRTC 应用的 SDKAppID。推荐从 `TrtcCallBootstrap.sdkAppId!` 获取
  ///              （Bootstrap.run 时传入后自动存储），避免多处 hardcode。
  /// - [userId] 你的业务 userId（复用你 App 已有的用户体系）
  /// - [userSig] 认证生命周期层提供的 UserSig
  ///
  /// ## 用法
  ///
  /// ```dart
  /// final userSig = await userSigProvider(userId);
  /// await CallService.instance.loginWithSig(TrtcCallBootstrap.sdkAppId!, userId, userSig);
  /// ```
  Future<void> loginWithSig(int sdkAppId, String userId, String userSig) async {
    _isLoggedIn = false;
    // 先订阅再登录（SDK 要求），避免极端情况下事件在订阅前触发
    await _loginEventSub?.cancel();
    _loginEventSub = _adapter.loginEvents.listen((_) {});

    try {
      await _adapter.login(sdkAppId, userId, userSig);
      _isLoggedIn = true;
    } catch (_) {
      await _loginEventSub?.cancel();
      _loginEventSub = null;
      rethrow;
    }
  }

  /// 发起 1v1 通话
  Future<void> startCall(String userId, CallMediaType mediaType) async {
    _ensureLoggedIn();
    await _adapter.startCall(userId, mediaType);
  }

  /// 发起多人通话
  ///
  /// [chatGroupId] 从 IM 群聊发起时传 groupId，纯临时多人通话留空即可。
  Future<void> startGroupCall(
    List<String> userIds,
    CallMediaType mediaType, {
    String chatGroupId = '',
  }) async {
    _ensureLoggedIn();
    await _adapter.startGroupCall(userIds, mediaType, chatGroupId: chatGroupId);
  }

  /// 退出登录（切换账号 / 用户主动登出时调用）
  Future<void> logout() async {
    _isLoggedIn = false;
    await _loginEventSub?.cancel();
    _loginEventSub = null;
    await _adapter.logout();
  }

  void _ensureLoggedIn() {
    if (!_isLoggedIn) {
      throw StateError('TRTC Call 尚未完成初始化，请稍后重试');
    }
  }
}
