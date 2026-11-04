// 冷启动时 SDK 不会恢复登录，必须由你的业务在启动后重新登录，否则收不到任何来电。
// 放在"判断用户已登录过"的地方（AppDelegate / SceneDelegate / SwiftUI App 的启动逻辑）。
// userSig 要重新获取：调试期可用 GenerateTestUserSig，上线必须向业务后端请求。
TUILogin.login(Int32(sdkAppID), userID: userID, userSig: userSig) {
    // 成功
} fail: { code, message in
    // 失败
}
