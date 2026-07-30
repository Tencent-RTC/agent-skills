import 'dart:async';
import 'package:flutter/material.dart';
import 'package:tencent_calls_uikit/tencent_calls_uikit.dart';
import 'call_service.dart';

/// 登录事件处理策略（Q5 三分支）
enum LoginEventPolicy {
  /// 直接跳登录页（默认，推荐）
  ///
  /// 收到 kickedOffline / loginExpired 任一事件都跳到 [LoginEventListenerWidget.loginRoute]。
  redirectLogin,

  /// 弹窗提示后跳登录页
  ///
  /// 收到事件先弹 AlertDialog，用户确认后再跳。
  promptUser,

  /// UserSig 过期时静默刷新，被踢下线仍跳登录页
  ///
  /// loginExpired → 调用 [LoginEventListenerWidget.onRefreshRequest] 拿新 sig 重登
  /// kickedOffline → 跳登录页（另一设备已抢占，无法自动恢复）
  autoRefresh,
}

/// 跳登录页的自定义实现回调
///
/// 用于用户不使用 Flutter Navigator 命名路由（例如 GoRouter / AutoRoute / 自建）时。
/// 传入后，本 Widget 内所有"跳登录页"动作都调用此函数，不再走
/// `Navigator.pushNamedAndRemoveUntil`。
typedef NavigateToLoginCallback = FutureOr<void> Function(BuildContext context);

/// 登录事件监听 Widget（Q5 订阅代码的独立封装）
///
/// 把 [CallService.instance.loginEvents] 订阅逻辑收敛到一个组件里，用户只需
/// 在自己的根页面（首页 / 通话入口页）用它 wrap 一层。
///
/// ## 挂载位置很关键
///
/// 请 wrap 在**登录后展示的首个页面**（例如 HomePage），或者更高层的路由根。
/// 挂载太晚（例如在具体子页面里）会导致 login 后到 mount 之间的短窗口内漏事件。
///
/// ## 用法
///
/// ### 使用 Navigator 命名路由（默认）
///
/// ```dart
/// class HomePage extends StatelessWidget {
///   @override
///   Widget build(BuildContext context) => LoginEventListenerWidget(
///     policy: LoginEventPolicy.redirectLogin,
///     loginRoute: '/login',
///     child: Scaffold(...你的原有 UI...),
///   );
/// }
/// ```
///
/// ### 使用 GoRouter / 自定义路由
///
/// ```dart
/// LoginEventListenerWidget(
///   policy: LoginEventPolicy.redirectLogin,
///   onNavigateToLogin: (ctx) => GoRouter.of(ctx).go('/login'),
///   child: ...,
/// )
/// ```
///
/// ## 为什么单独出一个 Widget
///
/// Q5 的订阅代码原本要塞进用户自己 HomePage 的 State 类里（initState 订阅、
/// dispose 取消、写一个 _onLoginEvent 方法），AI 无法通过 INSTALL 单文件完成。
/// 抽成独立 Widget 后，用户只需 wrap 一层，AI 只需 INSTALL 本文件。
class LoginEventListenerWidget extends StatefulWidget {
  final Widget child;
  final LoginEventPolicy policy;

  /// Navigator 命名路由：登录页的路由名。
  ///
  /// 当 [onNavigateToLogin] 为 null 时使用；调用
  /// `Navigator.of(context).pushNamedAndRemoveUntil(loginRoute, (_) => false)`。
  ///
  /// 用户不用 Flutter Navigator 命名路由（GoRouter / AutoRoute / 自建）时，
  /// 请传 [onNavigateToLogin]，[loginRoute] 被忽略。
  final String loginRoute;

  /// 跳登录页的自定义实现（GoRouter / AutoRoute / 自建路由方案使用）
  ///
  /// 传入后优先于 [loginRoute]。
  final NavigateToLoginCallback? onNavigateToLogin;

  /// 仅 [LoginEventPolicy.autoRefresh] 使用。
  ///
  /// 触发时机：收到 [LoginEvent.loginExpired] 事件。
  /// 应实现：从后端拿新 UserSig，返回 (sdkAppId, userId, userSig) 三元组。
  /// 内部会用该三元组调 [CallService.loginWithSig] 重新登录。
  ///
  /// 失败时（抛异常或返回 null）会兜底跳登录页。
  final Future<({int sdkAppId, String userId, String userSig})?> Function()?
      onRefreshRequest;

  const LoginEventListenerWidget({
    super.key,
    required this.child,
    this.policy = LoginEventPolicy.redirectLogin,
    this.loginRoute = '/login',
    this.onNavigateToLogin,
    this.onRefreshRequest,
  });

  @override
  State<LoginEventListenerWidget> createState() =>
      _LoginEventListenerWidgetState();
}

class _LoginEventListenerWidgetState extends State<LoginEventListenerWidget> {
  StreamSubscription<LoginEvent>? _sub;

  @override
  void initState() {
    super.initState();
    // release 模式下也检查 autoRefresh 必备的回调
    if (widget.policy == LoginEventPolicy.autoRefresh &&
        widget.onRefreshRequest == null) {
      throw StateError(
        'LoginEventListenerWidget: policy=autoRefresh 时必须提供 onRefreshRequest',
      );
    }
    _sub = CallService.instance.loginEvents.listen(_onLoginEvent);
  }

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }

  Future<void> _onLoginEvent(LoginEvent event) async {
    if (!mounted) return;
    switch (widget.policy) {
      case LoginEventPolicy.redirectLogin:
        _showEventHintThenNavigate(event);
        break;
      case LoginEventPolicy.promptUser:
        _showLoginExpiredDialog(event);
        break;
      case LoginEventPolicy.autoRefresh:
        await _handleAutoRefresh(event);
        break;
    }
  }

  /// redirectLogin 分支：跳登录页前给用户一个短暂 SnackBar 提示，避免"莫名被弹到登录页"
  void _showEventHintThenNavigate(LoginEvent event) {
    final msg = event == LoginEvent.kickedOffline
        ? '账号已在其他设备登录'
        : '登录已过期';
    ScaffoldMessenger.maybeOf(context)?.showSnackBar(
      SnackBar(content: Text('$msg，请重新登录'), duration: const Duration(seconds: 2)),
    );
    _navigateToLogin();
  }

  void _showLoginExpiredDialog(LoginEvent event) {
    final msg = event == LoginEvent.kickedOffline
        ? '账号已在其他设备登录'
        : '登录已过期，请重新登录';
    showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (_) => AlertDialog(
        title: const Text('登录失效'),
        content: Text(msg),
        actions: [
          TextButton(
            onPressed: () {
              Navigator.of(context).pop();
              _navigateToLogin();
            },
            child: const Text('重新登录'),
          ),
        ],
      ),
    );
  }

  Future<void> _handleAutoRefresh(LoginEvent event) async {
    // kickedOffline 无法自动恢复（另一台设备已抢占），跳登录页
    if (event == LoginEvent.kickedOffline) {
      _navigateToLogin();
      return;
    }

    // loginExpired：调业务侧刷新 UserSig 后重登
    try {
      final credentials = await widget.onRefreshRequest!.call();
      if (credentials == null) {
        if (mounted) _navigateToLogin();
        return;
      }
      await CallService.instance.loginWithSig(
        credentials.sdkAppId,
        credentials.userId,
        credentials.userSig,
      );
    } catch (_) {
      if (mounted) _navigateToLogin();
    }
  }

  /// 跳登录页：优先用 [widget.onNavigateToLogin] 回调（GoRouter / 自定义路由），
  /// 否则走 Navigator 命名路由。
  void _navigateToLogin() {
    if (!mounted) return;
    final custom = widget.onNavigateToLogin;
    if (custom != null) {
      // ignore: discarded_futures
      Future.sync(() => custom(context));
      return;
    }
    Navigator.of(context)
        .pushNamedAndRemoveUntil(widget.loginRoute, (_) => false);
  }

  @override
  Widget build(BuildContext context) => widget.child;
}
