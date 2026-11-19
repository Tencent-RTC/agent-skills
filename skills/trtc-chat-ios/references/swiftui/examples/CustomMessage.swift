import AtomicXCore
import Foundation
import SwiftUI
import TUIChatKit_Swift
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

    static func register() {
        precondition(Thread.isMainThread)
        guard !didRegister else { return }
        didRegister = true
        MessageListView.registerCustomMessageCell(
            businessID: OrderCard.identifier,
            summaryProvider: { payload in
                OrderCard.decode(payload.customData)?.title
                    ?? NSLocalizedString("UnsupportedOrderMessage", comment: "")
            },
            contentViewBuilder: { payload in
                AnyView(OrderMessageContent(card: OrderCard.decode(payload.customData)))
            }
        )
    }
}

struct OrderMessageContent: View {
    @EnvironmentObject private var themeState: ThemeState
    let card: OrderCard?

    private var text: String {
        card?.title ?? NSLocalizedString("UnsupportedOrderMessage", comment: "")
    }

    var body: some View {
        Text(text)
            .font(themeState.fonts.caption1Regular)
            .foregroundColor(themeState.colors.textColorPrimary)
            .multilineTextAlignment(.leading)
            .padding(.horizontal, CGFloat(themeState.spacing.bubbleSpacing))
            .padding(.vertical, CGFloat(themeState.spacing.iconIconSpacing))
            .accessibilityLabel(text)
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

enum OrderInputActions {
    static let actionID = "app.input.order"

    static func makeInputConfig(onPickOrder: @escaping () -> Void) -> ChatMessageInputConfig {
        ChatMessageInputConfig(actionCustomizer: { editor in
            editor.add(MessageInputMenuAction(
                ID: actionID,
                title: NSLocalizedString("SendOrder", comment: ""),
                iconName: "",
                icon: UIImage(systemName: "shippingbox"),
                onClick: onPickOrder
            ))
        })
    }
}
