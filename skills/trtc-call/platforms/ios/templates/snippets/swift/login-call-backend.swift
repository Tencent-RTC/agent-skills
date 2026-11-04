// userSig 必须由你的业务后端签发，客户端不得持有 SecretKey。
// 下面的 sdkAppID / userSig 请替换为你后端返回的值。
TUILogin.login(Int32(sdkAppID), userID: userID, userSig: userSig) {
    // 登录成功。
    // 注意：此刻通话引擎可能还没初始化完成，不要在这里立即发起呼叫，请由用户点击触发。
} fail: { code, message in
    // 登录失败：错误码含义见排障表（如 70020 SDKAppID 错误、9512 网络不通）。
}
