import AtomicXCore
import Foundation
import TUIChatKit
import UIKit

struct OrderCard: Codable {
    static let identifier = "app.order.v1"
    static let maximumJSONBytes = 16_384

    let businessID: String
    let version: Int
    let orderID: String
    let title: String

    init(orderID: String, title: String) {
        businessID = Self.identifier
        version = 1
        self.orderID = orderID
        self.title = title
    }

    var isValid: Bool {
        businessID == Self.identifier && version == 1
            && !orderID.isEmpty && orderID.count <= 128
            && !title.isEmpty && title.count <= 256
    }

    static func decode(_ text: String) -> OrderCard? {
        guard text.utf8.count <= maximumJSONBytes,
              let card = try? JSONDecoder().decode(OrderCard.self, from: Data(text.utf8)),
              card.isValid else { return nil }
        return card
    }
}

enum OrderMessageRegistration {
    private static var didRegister = false

    static func register(maximumContentWidth: CGFloat) {
        precondition(Thread.isMainThread)
        precondition(maximumContentWidth.isFinite && maximumContentWidth > 32)
        guard !didRegister else { return }
        didRegister = true
        MessageListView.registerCustomMessageCell(
            businessID: OrderCard.identifier,
            summaryProvider: { payload in
                OrderCard.decode(payload.customData)?.title
                    ?? NSLocalizedString("UnsupportedOrderMessage", comment: "")
            },
            makeContentView: {
                OrderMessageContentView(maximumWidth: maximumContentWidth)
            }
        )
    }
}

final class OrderMessageContentView: UIView, MessageContentView {
    private let label = UILabel()

    init(maximumWidth: CGFloat) {
        super.init(frame: .zero)
        label.numberOfLines = 0
        label.textAlignment = .natural
        label.font = .preferredFont(forTextStyle: .body)
        label.adjustsFontForContentSizeCategory = true
        label.preferredMaxLayoutWidth = maximumWidth - 32
        label.translatesAutoresizingMaskIntoConstraints = false
        addSubview(label)
        NSLayoutConstraint.activate([
            label.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 16),
            label.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -16),
            label.topAnchor.constraint(equalTo: topAnchor, constant: 12),
            label.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -12),
            widthAnchor.constraint(lessThanOrEqualToConstant: maximumWidth)
        ])
        isAccessibilityElement = true
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) is unavailable")
    }

    func bind(message: MessageInfo, context: MessageContentContext) {
        let card: OrderCard?
        if case .custom(let payload) = message.messagePayload {
            card = OrderCard.decode(payload.customData)
        } else {
            card = nil
        }
        label.text = card?.title ?? NSLocalizedString("UnsupportedOrderMessage", comment: "")
        label.textColor = TUIChatKitTheme.colors.textColorPrimary
        accessibilityLabel = label.text
        isUserInteractionEnabled = false
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        let width = max(0, bounds.width - 32)
        if width > 0, abs(label.preferredMaxLayoutWidth - width) > 0.5 {
            label.preferredMaxLayoutWidth = width
        }
    }
}

final class OrderMessageSender {
    enum ValidationError: Error {
        case invalidCard
        case payloadTooLarge
    }

    private let store: MessageInputStore

    init(conversationID: String) {
        precondition(!conversationID.isEmpty)
        store = MessageInputStore.create(conversationID: conversationID)
    }

    func send(
        card: OrderCard,
        needReadReceipt: Bool,
        completion: @escaping (Result<Void, Error>) -> Void
    ) {
        precondition(Thread.isMainThread)
        do {
            guard card.isValid else { throw ValidationError.invalidCard }
            let data = try JSONEncoder().encode(card)
            guard data.count <= OrderCard.maximumJSONBytes else {
                throw ValidationError.payloadTooLarge
            }
            let payload = CustomSendMessagePayload(
                customData: String(decoding: data, as: UTF8.self),
                description: card.title
            )
            var option = SendMessageOption()
            option.needReadReceipt = needReadReceipt
            store.sendMessage(payload: .custom(payload), option: option) { result in
                DispatchQueue.main.async {
                    switch result {
                    case .success:
                        completion(.success(()))
                    case .failure(let error):
                        completion(.failure(error))
                    }
                }
            }
        } catch {
            completion(.failure(error))
        }
    }
}
