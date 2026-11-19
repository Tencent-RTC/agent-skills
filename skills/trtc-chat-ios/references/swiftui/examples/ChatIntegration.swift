import AtomicXCore
import Combine
import SwiftUI
import TUIChatKit_Swift
import UIKit

struct ChatCredentials {
    let sdkAppID: Int32
    let userID: String
    let userSig: String
}

enum ChatCredentialsResult {
    case ready(ChatCredentials)
    case missingConfiguration(String)
}

enum ChatLoginAlert: Identifiable {
    case missingConfiguration(String)
    case loginFailed(code: Int, message: String)

    var id: String {
        switch self {
        case .missingConfiguration(let detail):
            return "missing:" + detail
        case .loginFailed(let code, let message):
            return "failed:\(code):" + message
        }
    }
}

final class ChatLoginModel: ObservableObject {
    @Published private(set) var isLoggedIn = LoginStore.shared.state.value.loginStatus == .logined
    @Published private(set) var isLoggingIn = false
    @Published var alert: ChatLoginAlert?
    private var cancellables = Set<AnyCancellable>()

    init() {
        LoginStore.shared.state
            .subscribe(StatePublisherSelector(keyPath: \LoginState.loginStatus))
            .receive(on: DispatchQueue.main)
            .sink { [weak self] status in
                self?.isLoggedIn = status == .logined
            }
            .store(in: &cancellables)
    }

    func loginIfNeeded(_ loadCredentials: () -> ChatCredentialsResult) {
        precondition(Thread.isMainThread)
        guard !isLoggedIn, !isLoggingIn else { return }
        switch loadCredentials() {
        case .missingConfiguration(let detail):
            alert = .missingConfiguration(detail)
        case .ready(let credentials):
            isLoggingIn = true
            LoginStore.shared.login(
                sdkAppID: credentials.sdkAppID,
                userID: credentials.userID,
                userSig: credentials.userSig
            ) { [weak self] result in
                DispatchQueue.main.async {
                    guard let self else { return }
                    self.isLoggingIn = false
                    if case .failure(let error) = result {
                        self.alert = .loginFailed(code: error.code, message: error.message)
                    }
                }
            }
        }
    }

    func logout(completion: @escaping (Result<Void, ErrorInfo>) -> Void) {
        LoginStore.shared.logout { result in
            DispatchQueue.main.async {
                completion(result)
            }
        }
    }
}

struct ChatRootView: View {
    @ObservedObject private var themeState = ThemeState.shared
    @StateObject private var loginModel = ChatLoginModel()
    let loadCredentials: () -> ChatCredentialsResult

    var body: some View {
        NavigationView {
            Group {
                if loginModel.isLoggedIn {
                    ChatConversationsScreen()
                } else if loginModel.isLoggingIn {
                    ProgressView()
                } else {
                    Button(NSLocalizedString("ChatRetryLogin", comment: "")) {
                        loginModel.loginIfNeeded(loadCredentials)
                    }
                }
            }
            .navigationBarHidden(true)
        }
        .navigationViewStyle(StackNavigationViewStyle())
        .environmentObject(themeState)
        .preferredColorScheme(themeState.isDarkMode ? .dark : .light)
        .onAppear {
            loginModel.loginIfNeeded(loadCredentials)
        }
        .alert(item: $loginModel.alert) { alert in
            switch alert {
            case .missingConfiguration(let detail):
                return Alert(title: Text("请先填写 SDKAppID 和 SecretKey"), message: Text(detail))
            case .loginFailed(let code, let message):
                return Alert(title: Text(NSLocalizedString("ChatLoginFailed", comment: "")), message: Text("\(code) \(message)"))
            }
        }
    }
}

struct ChatConversationsScreen: View {
    @State private var navigationInfo: NavigationInfo?
    @State private var isChatActive = false

    var body: some View {
        ConversationsPage(onConversationClick: { info in
            navigationInfo = info
            isChatActive = true
        })
        .navigationBarHidden(true)
        .background(
            NavigationLink(destination: chatDestination, isActive: $isChatActive) {
                EmptyView()
            }
            .hidden()
        )
    }

    @ViewBuilder
    private var chatDestination: some View {
        if let info = navigationInfo {
            ChatScreen(conversation: info.conversation, locateMessage: info.locateMessage)
        }
    }
}

enum ChatSettingsTarget {
    case c2c(userID: String)
    case group(groupID: String)
}

struct ChatScreen: View {
    @Environment(\.dismiss) private var dismiss
    @State private var settingsTarget: ChatSettingsTarget?
    @State private var isSettingsActive = false
    let conversation: ConversationInfo
    var locateMessage: MessageInfo? = nil

    var body: some View {
        ChatPage(
            conversation: conversation,
            locateMessage: locateMessage,
            messageInputConfig: ChatMessageInputConfig(isShowVideoCall: false, isShowAudioCall: false),
            onBack: { dismiss() },
            onMoreClick: { openSettings() }
        )
        .navigationBarHidden(true)
        .background(ChatSwipeBackSupport())
        .background(
            NavigationLink(destination: settingsDestination, isActive: $isSettingsActive) {
                EmptyView()
            }
            .hidden()
        )
    }

    private func openSettings() {
        if conversation.type == .group, let groupID = ChatUtil.getGroupID(conversation.conversationID) {
            settingsTarget = .group(groupID: groupID)
        } else if let userID = ChatUtil.getUserID(conversation.conversationID) {
            settingsTarget = .c2c(userID: userID)
        } else {
            return
        }
        isSettingsActive = true
    }

    @ViewBuilder
    private var settingsDestination: some View {
        switch settingsTarget {
        case .c2c(let userID):
            C2CChatSettingView(
                userID: userID,
                config: C2CChatSettingConfig(isShowSendMessage: false, isShowVoiceCall: false, isShowVideoCall: false),
                onContactDelete: { closeChat() },
                onBack: { isSettingsActive = false }
            )
            .navigationBarHidden(false)
        case .group(let groupID):
            GroupChatSettingView(
                groupID: groupID,
                config: GroupChatSettingConfig(isShowDoNotDisturb: true),
                onGroupDelete: { closeChat() },
                onBack: { isSettingsActive = false }
            )
            .navigationBarHidden(false)
        case nil:
            EmptyView()
        }
    }

    private func closeChat() {
        isSettingsActive = false
        dismiss()
    }
}

enum ChatHostingFactory {
    static func makeChatController(conversation: ConversationInfo, onBack: @escaping () -> Void) -> UIViewController {
        let root = NavigationView {
            ChatPage(conversation: conversation, isShowMoreButton: false, onBack: onBack)
                .navigationBarHidden(true)
        }
        .navigationViewStyle(StackNavigationViewStyle())
        .environmentObject(ThemeState.shared)
        let controller = UIHostingController(rootView: root)
        controller.hidesBottomBarWhenPushed = true
        return controller
    }
}

struct ChatSwipeBackSupport: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> Controller {
        Controller()
    }

    func updateUIViewController(_ uiViewController: Controller, context: Context) {}

    final class Controller: UIViewController {
        private weak var popGesture: UIGestureRecognizer?
        private weak var previousDelegate: UIGestureRecognizerDelegate?

        override func viewDidAppear(_ animated: Bool) {
            super.viewDidAppear(animated)
            guard let navigationController = navigationController,
                  navigationController.viewControllers.count > 1,
                  let gesture = navigationController.interactivePopGestureRecognizer else { return }
            previousDelegate = gesture.delegate
            popGesture = gesture
            gesture.delegate = nil
            gesture.isEnabled = true
        }

        override func viewWillDisappear(_ animated: Bool) {
            super.viewWillDisappear(animated)
            if let gesture = popGesture, gesture.delegate == nil {
                gesture.delegate = previousDelegate
            }
            popGesture = nil
            previousDelegate = nil
        }
    }
}
