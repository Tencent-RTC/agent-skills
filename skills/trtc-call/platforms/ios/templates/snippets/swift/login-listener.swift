// 被踢下线 / UserSig 过期的监听（写法来自官方 demo，编译确认；真实触发行为尚未验证）。
// 在某个常驻对象里调用 TUILogin.add(self) 注册，例如 viewDidLoad 或 App 启动处。
class TRTCLoginObserver: NSObject, TUILoginListener {
    func register() {
        TUILogin.add(self)
    }

    func onKickedOffline() {
        // 同账号在别处登录被踢：清理本地登录态，回到登录页。
    }

    func onUserSigExpired() {
        // UserSig 过期：重新向后端获取 userSig 并重新登录，或回到登录页。
    }

    func onConnecting() {}
    func onConnectSuccess() {}
    func onConnectFailed(_ code: Int32, err: String?) {}
}
