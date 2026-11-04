// 必须由用户点击触发（通话按钮 / 联系人条目点击），不要放在登录成功回调、viewDidLoad、onAppear 里自动执行。
// calleeUserID 换成被叫的 userID；1v1 传单元素数组，群呼传多个。
TUICallKit.createInstance().calls(
    userIdList: [calleeUserID],
    mediaType: .video,
    params: nil
) { result in
    switch result {
    case .success:
        break
    case .failure(let error):
        // error.code / error.message：常见 -1201（未登录或登录刚完成）、101008（已在通话中）。
        _ = error
    }
}
