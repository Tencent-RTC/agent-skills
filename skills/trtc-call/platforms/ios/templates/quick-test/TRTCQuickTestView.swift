import SwiftUI
import TUICore
import AtomicXCore
import TUICallKit_Swift

// 仅用于本地联调的最小验证页：输入 userID 登录，再输入被叫 userID 发起语音/视频通话。
// 上线前请删除本文件，并把 App 入口还原成你自己的根视图。
// sdkAppID / secretKey 来自 Debug/TRTCDebugConfig.swift（secretKey 由你自己填写）。
struct TRTCQuickTestView: View {
    @State private var userID = ""
    @State private var calleeUserID = ""
    @State private var isLoggedIn = false
    @State private var message = ""

    var body: some View {
        VStack(spacing: 16) {
            Text("TRTC Call 验证页").font(.headline)

            TextField("我的 User ID", text: $userID)
                .textFieldStyle(.roundedBorder)
                .modifier(TRTCPlainInput())
                .disabled(isLoggedIn)
            Button(isLoggedIn ? "已登录" : "登录") { login() }
                .buttonStyle(TRTCQuickButtonStyle(prominent: true))
                .disabled(userID.isEmpty || isLoggedIn)

            Divider()

            TextField("被叫 User ID", text: $calleeUserID)
                .textFieldStyle(.roundedBorder)
                .modifier(TRTCPlainInput())
            HStack(spacing: 12) {
                Button("语音通话") { makeCall(video: false) }
                    .buttonStyle(TRTCQuickButtonStyle(prominent: false))
                Button("视频通话") { makeCall(video: true) }
                    .buttonStyle(TRTCQuickButtonStyle(prominent: true))
            }
            .disabled(!isLoggedIn || calleeUserID.isEmpty)

            if !message.isEmpty {
                Text(message).font(.caption).foregroundColor(.red)
            }
            Text("登录成功后等几秒再呼叫；若提示 -1201，稍后重试。")
                .font(.footnote).foregroundColor(.secondary)
        }
        .padding()
    }

    private func login() {
        #if DEBUG
        let sdkAppID = TRTCDebugConfig.sdkAppID
        let userSig = GenerateTestUserSig.genTestUserSig(
            userID: userID, sdkAppID: sdkAppID, secretKey: TRTCDebugConfig.secretKey)
        TUILogin.login(Int32(sdkAppID), userID: userID, userSig: userSig) {
            isLoggedIn = true
            message = ""
        } fail: { code, errorMessage in
            message = "登录失败：\(errorMessage ?? "") (\(code))"
        }
        #else
        message = "Release 构建不会在客户端签发 UserSig，请改为向你的业务后端获取。"
        #endif
    }

    // 必须由用户点击触发，不要放在登录成功回调、onAppear 里自动执行。
    private func makeCall(video: Bool) {
        TUICallKit.createInstance().calls(
            userIdList: [calleeUserID],
            mediaType: video ? .video : .audio,
            params: nil
        ) { result in
            switch result {
            case .success:
                message = ""
            case .failure(let error):
                message = "呼叫失败：\(error.message) (\(error.code))"
            }
        }
    }
}

// 不用 .bordered / .borderedProminent（它们要求 iOS 15），保证 iOS 14 也能编译。
private struct TRTCQuickButtonStyle: ButtonStyle {
    let prominent: Bool
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .foregroundColor(prominent ? .white : .accentColor)
            .background(prominent ? Color.accentColor : Color.accentColor.opacity(0.15))
            .cornerRadius(8)
            .opacity(isEnabled ? (configuration.isPressed ? 0.7 : 1) : 0.4)
    }
}

private struct TRTCPlainInput: ViewModifier {
    func body(content: Content) -> some View {
        if #available(iOS 15.0, *) {
            content.textInputAutocapitalization(.never).disableAutocorrection(true)
        } else {
            content.autocapitalization(.none).disableAutocorrection(true)
        }
    }
}
