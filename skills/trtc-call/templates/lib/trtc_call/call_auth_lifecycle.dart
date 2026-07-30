import 'dart:async';

import 'call_service.dart';
import 'trtc_call_bootstrap.dart';

typedef UserSigProvider = Future<String> Function(String userId);
typedef UserIdNormalizer = String Function(String rawUserId);

/// Keeps TUICallKit authentication aligned with the app authentication state.
///
/// Call [syncUser] for every authentication state change:
/// - pass a user ID after sign-in, registration, and session restoration;
/// - pass `null` after sign-out.
class CallAuthLifecycle {
  final UserSigProvider userSigProvider;
  final UserIdNormalizer? normalizeUserId;
  final CallService callService;

  String? _currentUserId;
  Future<void> _pendingTransition = Future<void>.value();

  CallAuthLifecycle({
    required this.userSigProvider,
    this.normalizeUserId,
    CallService? callService,
  }) : callService = callService ?? CallService.instance;

  Future<void> syncUser(String? rawUserId) {
    final previousTransition = _pendingTransition;
    final release = Completer<void>();
    _pendingTransition = release.future;

    return previousTransition.then((_) async {
      try {
        await _applyUser(rawUserId);
      } finally {
        release.complete();
      }
    });
  }

  Future<void> _applyUser(String? rawUserId) async {
    if (rawUserId == null || rawUserId.trim().isEmpty) {
      await _logoutCurrentUser();
      return;
    }

    final trimmedUserId = rawUserId.trim();
    final userId = normalizeUserId?.call(trimmedUserId) ?? trimmedUserId;
    if (userId.trim().isEmpty) {
      throw StateError('TRTC Call userId cannot be empty');
    }
    if (_currentUserId == userId) {
      return;
    }

    await _logoutCurrentUser();
    final userSig = await userSigProvider(userId);
    if (userSig.isEmpty) {
      throw StateError('TRTC Call userSig cannot be empty');
    }
    final sdkAppId = TrtcCallBootstrap.sdkAppId;
    if (sdkAppId == null || sdkAppId <= 0) {
      throw StateError('TRTC Call SDKAppID is not configured');
    }
    await callService.loginWithSig(sdkAppId, userId, userSig);
    _currentUserId = userId;
  }

  Future<void> _logoutCurrentUser() async {
    if (_currentUserId == null) {
      return;
    }
    await callService.logout();
    _currentUserId = null;
  }
}
