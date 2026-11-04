#if DEBUG
do {
    // 仅本地联调：用 SDK 自带的 GenerateTestUserSig 在客户端签发 UserSig。
    // sdkAppID / secretKey 来自 Debug/TRTCDebugConfig.swift（secretKey 由你自己填写）。
    // 上线前必须改为向你的业务后端请求 userSig，并删除这段 #if DEBUG 代码。
    let sdkAppID = TRTCDebugConfig.sdkAppID
    let userSig = GenerateTestUserSig.genTestUserSig(
        userID: userID, sdkAppID: sdkAppID, secretKey: TRTCDebugConfig.secretKey)
    TUILogin.login(Int32(sdkAppID), userID: userID, userSig: userSig) {
        // 登录成功。
        // 注意：此刻通话引擎可能还没初始化完成，不要在这里立即发起呼叫，请由用户点击触发。
    } fail: { code, message in
        // 登录失败：错误码含义见排障表（如 70020 SDKAppID 错误、9512 网络不通）。
    }
}
#else
// Release：userSig 必须由你的业务后端签发，拿到后调用 TUILogin.login(Int32(sdkAppID), userID:userSig:succ:fail:)。
#endif
