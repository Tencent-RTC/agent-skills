import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:tencent_calls_uikit/tencent_calls_uikit.dart';

/// TRTC Call 集成入口 —— Builder 注入模式
///
/// ## 用法（在 `main()` 里替换原来的 `runApp(MyApp())`）
///
/// ```dart
/// import 'trtc_call/trtc_call_bootstrap.dart';
///
/// void main() {
///   TrtcCallBootstrap.run(
///     sdkAppId: 0,          // TODO: 替换为你的 SDKAppID（腾讯云控制台 → TRTC → 应用管理）
///     builder: (trtcDelegates, trtcObservers) => MyApp(
///       trtcDelegates: trtcDelegates,
///       trtcObservers: trtcObservers,
///     ),
///   );
/// }
/// ```
///
/// 用户 `MaterialApp` 里的原有配置**完全保留**，只需把 [trtcDelegates] 和
/// [trtcObservers] 拼进自己的 `localizationsDelegates` 与 `navigatorObservers` 数组：
///
/// ```dart
/// class MyApp extends StatelessWidget {
///   final List<LocalizationsDelegate> trtcDelegates;
///   final List<NavigatorObserver> trtcObservers;
///   const MyApp({super.key, required this.trtcDelegates, required this.trtcObservers});
///
///   @override
///   Widget build(BuildContext context) => MaterialApp(
///     title: 'MyApp',
///     home: const HomePage(),
///     localizationsDelegates: [...trtcDelegates],       // 或 [...myOwn, ...trtcDelegates]
///     supportedLocales: const [Locale('zh', 'CN'), Locale('en', 'US')],
///     navigatorObservers: [...trtcObservers],           // 或 [...myOwn, ...trtcObservers]
///   );
/// }
/// ```
///
/// ## 为什么用 Builder 模式
///
/// - 标准 MaterialApp / CupertinoApp：delegate 与 observer 都由 builder 注入
/// - MaterialApp.router + GoRouter：delegate 注入 App，observer 注入 GoRouter 配置
/// - 用户已有 `localizationsDelegates` / `navigatorObservers` 完全保留，SDK 只提供追加项
/// - 多产品共存：Chat / Live 等 skill 各自出 Bootstrap，嵌套 builder 即可
///
/// ## SDKAppID single-source-of-truth
///
/// 调用 [run] 时传入的 [sdkAppId] 会存到 [TrtcCallBootstrap.sdkAppId] 静态属性，
/// 业务代码调用 [`CallService.instance.loginWithSig`] 时可直接从 Bootstrap 获取，
/// 避免用户在多处 hardcode 同一常量：
///
/// ```dart
/// final userSig = await api.fetchUserSig(userId);            // q1=backend
/// await CallService.instance.loginWithSig(
///   TrtcCallBootstrap.sdkAppId!,                             // 从 Bootstrap 取
///   userId,
///   userSig,
/// );
/// ```
class TrtcCallBootstrap {
  TrtcCallBootstrap._();

  /// SDKAppID 的进程内存储（由 [run] 传入时写入）
  ///
  /// 业务代码调用 [`CallService.instance.loginWithSig`] 时可通过此属性获取，
  /// 避免多处 hardcode。q1=backend 场景亦有效。
  static int? _sdkAppId;
  static int? get sdkAppId => _sdkAppId;

  /// TRTC Call 需要的本地化 delegate
  ///
  /// 用户拼进自己的 `MaterialApp.localizationsDelegates` 数组即可。
  static const List<LocalizationsDelegate<dynamic>> _trtcDelegates = [
    AtomicLocalizations.delegate,
    GlobalMaterialLocalizations.delegate,
    GlobalWidgetsLocalizations.delegate,
    GlobalCupertinoLocalizations.delegate,
  ];

  /// TRTC Call 需要的 NavigatorObserver
  ///
  /// 缺此项来电界面无法弹出。用户拼进自己的 `MaterialApp.navigatorObservers` 数组即可。
  static List<NavigatorObserver> get _trtcObservers => [
    TUICallKit.navigatorObserver,
  ];

  /// 启动 TRTC Call 集成 + 调用 [runApp]
  ///
  /// [sdkAppId] TRTC 应用的 SDKAppID。传入后会自动存到 [TrtcCallBootstrap.sdkAppId]。
  /// UserSig 获取方式由认证生命周期层负责，不进入公共 Bootstrap。
  ///
  /// [beforeRunApp] 高级 escape hatch：在 [runApp] 之前、SDK 初始化之后调用；
  /// 用于自定义额外初始化（如埋点 / crash reporter）。通常留空即可。
  ///
  /// [builder] 接收 TRTC 需要的 delegate 与 observer 列表，返回你自己组装好的
  /// `MaterialApp` / `CupertinoApp` / 其他 App Widget。
  static void run({
    required int sdkAppId,
    VoidCallback? beforeRunApp,
    required Widget Function(
      List<LocalizationsDelegate<dynamic>> trtcDelegates,
      List<NavigatorObserver> trtcObservers,
    )
    builder,
  }) {
    // 调用方（main.dart）必须在 run() 之前自行调用
    // WidgetsFlutterBinding.ensureInitialized()，尤其是 async main 场景。
    // 遵循 Flutter 惯例：各 SDK（Firebase / Supabase 等）要求调用方自己初始化 binding，
    // TrtcCallBootstrap 不例外。

    // 存到 Bootstrap 静态属性，供 CallService.loginWithSig 使用
    _sdkAppId = sdkAppId;

    beforeRunApp?.call();
    runApp(builder(_trtcDelegates, _trtcObservers));
  }
}
