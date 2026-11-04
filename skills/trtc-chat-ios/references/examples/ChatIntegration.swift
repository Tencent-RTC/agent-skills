import AtomicXCore
import Combine
import Foundation
import TUIChatKit
import UIKit

enum ChatLoginService {
    static func login(
        sdkAppID: Int32,
        userID: String,
        userSig: String,
        completion: @escaping (Result<Void, ErrorInfo>) -> Void
    ) {
        LoginStore.shared.login(sdkAppID: sdkAppID, userID: userID, userSig: userSig) { result in
            DispatchQueue.main.async {
                completion(result)
            }
        }
    }

    static func logout(completion: @escaping (Result<Void, ErrorInfo>) -> Void) {
        LoginStore.shared.logout { result in
            DispatchQueue.main.async {
                completion(result)
            }
        }
    }
}

final class ChatFlowCoordinator {
    private weak var presenter: UIViewController?
    private var navigationController: UINavigationController?

    init(presenter: UIViewController) {
        self.presenter = presenter
    }

    func start() {
        precondition(Thread.isMainThread)
        guard navigationController == nil, let presenter,
              presenter.presentedViewController == nil else { return }
        let page = ConversationsPage(onConversationClick: { [weak self] info in
            self?.showChat(conversation: info.conversation, locateMessage: info.locateMessage)
        })
        let root = ChatConversationsContainer(page: page, onClose: { [weak self] in
            self?.finish()
        })
        let navigation = UINavigationController(rootViewController: root)
        navigation.setNavigationBarHidden(true, animated: false)
        navigation.modalPresentationStyle = .fullScreen
        navigationController = navigation
        presenter.present(navigation, animated: true)
    }

    func showChat(conversation: ConversationInfo, locateMessage: MessageInfo? = nil) {
        precondition(Thread.isMainThread)
        let input = ChatMessageInputConfig(isShowVideoCall: false, isShowAudioCall: false)
        let page = ChatPage(
            conversation: conversation,
            locateMessage: locateMessage,
            messageInputConfig: input,
            isShowMoreButton: false,
            onBack: { [weak self] in
                self?.navigationController?.popViewController(animated: true)
            }
        )
        page.hidesBottomBarWhenPushed = true
        navigationController?.setNavigationBarHidden(true, animated: false)
        navigationController?.pushViewController(page, animated: true)
    }

    func showDirectChat(peerUserID: String, title: String) {
        precondition(Thread.isMainThread)
        guard !peerUserID.isEmpty else { return }
        var conversation = ConversationInfo(conversationID: ChatUtil.getC2CConversationID(peerUserID))
        conversation.type = .c2c
        conversation.title = title
        showChat(conversation: conversation)
    }

    func showGroupChat(groupID: String, title: String) {
        precondition(Thread.isMainThread)
        guard !groupID.isEmpty else { return }
        var conversation = ConversationInfo(conversationID: ChatUtil.getGroupConversationID(groupID))
        conversation.type = .group
        conversation.title = title
        showChat(conversation: conversation)
    }

    func showDirectSettings(peerUserID: String) {
        precondition(Thread.isMainThread)
        guard !peerUserID.isEmpty else { return }
        let config = C2CChatSettingConfig(
            isShowSendMessage: false, isShowVoiceCall: false, isShowVideoCall: false
        )
        let page = C2CChatSettingViewController(userID: peerUserID, config: config)
        navigationController?.pushViewController(page, animated: true)
    }

    func showGroupSettings(groupID: String) {
        precondition(Thread.isMainThread)
        guard !groupID.isEmpty else { return }
        let config = GroupChatSettingConfig(isShowDoNotDisturb: true)
        let page = GroupChatSettingViewController(groupID: groupID, config: config)
        navigationController?.pushViewController(page, animated: true)
    }

    func finish() {
        precondition(Thread.isMainThread)
        navigationController?.dismiss(animated: true) { [weak self] in
            self?.navigationController = nil
        }
    }
}

private final class ChatConversationsContainer: UIViewController {
    private let page: ConversationsPage
    private let onClose: () -> Void

    init(page: ConversationsPage, onClose: @escaping () -> Void) {
        self.page = page
        self.onClose = onClose
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) is unavailable")
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        let close = UIButton(type: .system)
        close.setTitle(NSLocalizedString("CloseChat", comment: ""), for: .normal)
        close.addTarget(self, action: #selector(closeChat), for: .touchUpInside)
        close.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(close)
        addChild(page)
        view.addSubview(page.view)
        page.view.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            close.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            close.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 16),
            close.heightAnchor.constraint(greaterThanOrEqualToConstant: 44),
            page.view.topAnchor.constraint(equalTo: close.bottomAnchor),
            page.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            page.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            page.view.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])
        page.didMove(toParent: self)
    }

    @objc private func closeChat() {
        onClose()
    }
}

final class EmbeddedChatController: UIViewController {
    private let page: ChatPage

    init(conversation: ConversationInfo, onBack: @escaping () -> Void) {
        page = ChatPage(
            conversation: conversation,
            messageInputConfig: ChatMessageInputConfig(isShowVideoCall: false, isShowAudioCall: false),
            isShowMoreButton: false,
            onBack: onBack
        )
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) is unavailable")
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        addChild(page)
        view.addSubview(page.view)
        page.view.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            page.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            page.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            page.view.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            page.view.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])
        page.didMove(toParent: self)
    }
}

final class ConversationObserver {
    private let store = ConversationListStore.create()
    private var cancellables = Set<AnyCancellable>()
    private var generation: UInt = 0

    func start(
        onChange: @escaping ([ConversationInfo]) -> Void,
        onFailure: @escaping (ErrorInfo) -> Void
    ) {
        precondition(Thread.isMainThread)
        stop()
        let requestGeneration = generation
        store.state
            .subscribe(StatePublisherSelector(keyPath: \ConversationListState.conversationList))
            .receive(on: DispatchQueue.main)
            .sink { [weak self] items in
                guard let self, self.generation == requestGeneration else { return }
                onChange(items)
            }
            .store(in: &cancellables)
        store.loadConversations(option: ConversationLoadOption()) { [weak self] result in
            if case .failure(let error) = result {
                DispatchQueue.main.async { [weak self] in
                    guard let self, self.generation == requestGeneration else { return }
                    onFailure(error)
                }
            }
        }
    }

    func setGroupNotifications(
        groupID: String,
        muted: Bool,
        completion: @escaping (Result<Void, ErrorInfo>) -> Void
    ) {
        precondition(Thread.isMainThread)
        precondition(!groupID.isEmpty)
        store.setReceiveMessageOpt(
            conversationID: ChatUtil.getGroupConversationID(groupID),
            opt: muted ? .notNotify : .receive
        ) { result in
            DispatchQueue.main.async {
                completion(result)
            }
        }
    }

    func stop() {
        precondition(Thread.isMainThread)
        generation &+= 1
        cancellables.removeAll()
    }
}
