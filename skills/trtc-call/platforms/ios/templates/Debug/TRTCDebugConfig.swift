// TRTC 本地调试配置（仅 Debug 构建）。
//
// 重要：
// 1. 整个文件包在 #if DEBUG 内，Release 构建不会包含 sdkAppID / secretKey。
// 2. secretKey 请由你自己在本地填写。不要发给 AI，不要提交到 git（本文件已加入 .gitignore）。
// 3. 客户端持有 SecretKey 只适合本地联调。上线前必须改为由你的业务后端签发 UserSig，
//    并删除对本文件的所有引用。
// 4. 调试时 TUICallKit_Swift 自带的 GenerateTestUserSig 会把 SecretKey 打印到 Xcode 控制台。
//    把控制台日志贴给别人之前，请先删除含 secretKey / hmac / string to sign 的行。
//
// SecretKey 获取位置：腾讯云 TRTC 控制台 -> 应用管理 -> 应用信息 -> 快速上手 -> 密钥管理。
#if DEBUG
enum TRTCDebugConfig {
    static let sdkAppID: Int = 0 // TRTC_SDK_APP_ID
    static let secretKey: String = ""
}
#endif
