import 'package:tencent_calls_uikit/tencent_calls_uikit.dart';
import 'call_service.dart';

/// 通话中设备控制工具
///
/// 封装 DeviceStore.shared 的摄像头、麦克风和音量控制能力，
/// 增加前置条件检查（登录态）。
///
/// ## 前置条件
///
/// 调用任何方法前必须已通过 [CallService.instance.loginWithSig] 完成登录。
///
/// ## 用法
///
/// ```dart
/// // 开启前置摄像头
/// await DeviceControl.openCamera();
///
/// // 切换到后置摄像头
/// DeviceControl.switchCamera(isFront: false);
///
/// // 关闭摄像头
/// DeviceControl.closeCamera();
///
/// // 开关麦克风
/// await DeviceControl.openMicrophone();
/// DeviceControl.closeMicrophone();
///
/// // 音量调节 [0, 100]
/// DeviceControl.setCaptureVolume(80);
/// DeviceControl.setOutputVolume(60);
/// ```
class DeviceControl {
  DeviceControl._();

  /// 开启本地摄像头（返回 Future，可 await 确认结果）
  static Future<CompletionHandler> openCamera({bool isFront = true}) {
    _ensureLoggedIn();
    return DeviceStore.shared.openLocalCamera(isFront);
  }

  /// 关闭本地摄像头
  static void closeCamera() {
    _ensureLoggedIn();
    DeviceStore.shared.closeLocalCamera();
  }

  /// 切换前后置摄像头（通话中无缝切换）
  static void switchCamera({bool isFront = true}) {
    _ensureLoggedIn();
    DeviceStore.shared.switchCamera(isFront);
  }

  /// 开启本地麦克风（返回 Future，可 await 确认结果）
  static Future<CompletionHandler> openMicrophone() {
    _ensureLoggedIn();
    return DeviceStore.shared.openLocalMicrophone();
  }

  /// 关闭本地麦克风
  static void closeMicrophone() {
    _ensureLoggedIn();
    DeviceStore.shared.closeLocalMicrophone();
  }

  /// 设置麦克风采集音量 [0, 100]
  static void setCaptureVolume(int volume) {
    _ensureLoggedIn();
    DeviceStore.shared.setCaptureVolume(volume.clamp(0, 100));
  }

  /// 设置扬声器播放音量 [0, 100]
  static void setOutputVolume(int volume) {
    _ensureLoggedIn();
    DeviceStore.shared.setOutputVolume(volume.clamp(0, 100));
  }

  static void _ensureLoggedIn() {
    if (!CallService.instance.isLoggedIn) {
      throw const DeviceControlError(-1, '请先完成登录后再操作设备');
    }
  }
}

class DeviceControlError implements Exception {
  final int code;
  final String message;

  const DeviceControlError(this.code, this.message);

  @override
  String toString() => 'DeviceControlError [$code]: $message';
}
