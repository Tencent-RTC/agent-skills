import 'package:tencent_calls_uikit/tencent_calls_uikit.dart';
import 'call_service.dart';

/// 群组通话工具
///
/// 提供群组通话（多人通话）的发起和加入能力。
///
/// ## 用法
///
/// ```dart
/// // 发起群组视频通话
/// await GroupCall.start(
///   userIds: ['user_001', 'user_002'],
///   mediaType: CallMediaType.video,
///   groupId: 'im_group_123',
/// );
///
/// // 加入已有通话
/// await GroupCall.join(callId: 'call_abc_123');
/// ```
class GroupCall {
  GroupCall._();

  /// 发起群组通话
  ///
  /// [userIds] 被叫用户列表（不含自己），总人数 ≤ 9。
  /// [groupId] IM 群组 ID，纯临时通话留空。
  /// [timeout] 呼叫超时秒数，默认 30。
  static Future<void> start({
    required List<String> userIds,
    required CallMediaType mediaType,
    String groupId = '',
    int timeout = 30,
  }) async {
    _ensureLoggedIn();
    if (userIds.isEmpty) {
      throw const GroupCallError(-1, '被叫用户列表不能为空');
    }
    if (userIds.length > 8) {
      throw const GroupCallError(-2, '群组通话最多 9 人（含自己），被叫不能超过 8 人');
    }

    final params = CallParams(
      chatGroupId: groupId,
      timeout: timeout,
    );
    // 走 TUICallKit.instance（UIKit 层），复用其音视频权限门控：
    // 未授权时返回 -1101 并触发统一的无权限处理，而不是静默黑屏/无声。
    final result = await TUICallKit.instance.calls(userIds, mediaType, params);
    if (!result.isSuccess) {
      throw GroupCallError(
        result.errorCode,
        '发起群组通话失败 [${result.errorCode}]: ${result.errorMessage}',
      );
    }
  }

  /// 加入一个已有的群组通话
  ///
  /// [callId] 通话唯一标识。
  static Future<void> join({required String callId}) async {
    _ensureLoggedIn();
    if (callId.trim().isEmpty) {
      throw const GroupCallError(-1, 'callId 不能为空');
    }

    // TUICallKit.instance.join 与 calls 同理，复用权限门控。
    await TUICallKit.instance.join(callId.trim());
  }

  static void _ensureLoggedIn() {
    if (!CallService.instance.isLoggedIn) {
      throw const GroupCallError(-1, '请先完成登录后再发起/加入群组通话');
    }
  }
}

class GroupCallError implements Exception {
  final int code;
  final String message;

  const GroupCallError(this.code, this.message);

  @override
  String toString() => 'GroupCallError [$code]: $message';
}
