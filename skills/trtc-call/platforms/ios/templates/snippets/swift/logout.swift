// 登出。切换账号：先登出再登录新账号；不登出直接登录新账号也可行。
// 登出后调用 calls 会返回 6013 或 -1201，请把界面上的呼叫入口置灰或隐藏。
// 不要用 LoginStore.state.loginStatus 判断是否已登出（TUILogin.logout 之后它仍是 logined），请用你自己的登录态。
TUILogin.logout({
    // 成功
}, fail: { code, message in
    // 失败
})
