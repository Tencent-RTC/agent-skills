# 能力边界

## 直接支持

直接支持命令式 UIKit 版 `TUIChatKit` 的应用接入，也支持其组件源码修改：页面/布局/交互修复、新增配置及公开API、消息/输入/会话/联系人/设置/主题/导航实现调整。源码任务从 [任务索引](../source/index.md) 定点进入；不要求先完整遍历源码，也不局限于外部扩展点。Core/IM SDK 实现修改仍取决于实际源码引用和用户范围。

区分宿主技术栈与所选套件：SwiftUI 宿主可承载完整 UIKit 控制器；但独立 `ios_swiftui` Chat 套件是另一套 API。旧 TUIKit 的 `TUIChatViewController`、`TUILogin` 与新 `ChatPage` / `LoginStore` 不能混用。Objective-C 宿主通过 App 自有 Swift wrapper 暴露 Foundation/UIKit 可表示的类型，不把 Swift struct/enum 全部直接写成 Objective-C 调用。

## 三层职责

| 层 | 负责 | 不应承担 |
| --- | --- | --- |
| 宿主 App / TUIChatKit | 页面、布局、交互、导航、UI 配置、消息展示与降级 | 服务端业务权限、伪造已读/免打扰状态 |
| AtomicXCore | Store 工厂、状态订阅、业务动作、Core 与 SDK 类型转换 | 将二进制 API facade 当成可随意编辑源码 |
| IM SDK / 服务端 | 消息、会话、群、接收选项、同步和推送策略等 | 凭 UI 开关推断底层状态已经修改 |

本 Skill 的 Core 示例先查已安装 swiftinterface；内部另有源码时仍需核对是否同版本，不能将它当作二进制实现的确定证明。

## 群免打扰示例

- `GroupChatSettingConfig(isShowDoNotDisturb: false)`：隐藏设置项，不改变状态。
- `ConversationListStore.setReceiveMessageOpt(conversationID:opt:completion:)`：修改会话的消息接收选项。当前普通开关写 `.notNotify` / `.receive`，不是群禁言。
- 通过 `ConversationInfo.receiveOption` 及状态更新展示结果；调用失败保留错误并回滚乐观 UI。
- `.notNotifyExceptMention` / `.notReceiveExceptMention` 为更细接收模式，不可用统一 bool 抹掉后再声称保留原设置。
- 会话数、会话自身 unreadCount、totalUnreadCount、@提醒与 APNs 推送是不同口径。修改 UI 角标不改变 SDK 总未读策略；离线推送还依赖服务端接收选项与 Push 配置。
- `isShow...: true` 不越过群类型/角色权限。会议群等权限规则先查当前实现。

## 单独拆分

- Call 深度定制、Apple CallKit/VoIP、Push/APNs/NSE：按目标版本另做方案，不自动加入最小 Chat。
- 生产 UserSig 签发、业务鉴权、内容审核、订单/支付服务：明确服务端边界。
- ASR、TTS、机器人和其他增值能力：查实际公开接口、依赖、套餐和服务支持。不从有按钮就推断已开通；不照搬实验接口超时或语言支持假设。
- IM SDK 内核缺陷：最小复现、版本、错误码、状态回调证据；不在 UI 层假造成功绕过。
- 发布仓库同步、npm 发布、签名、构建流水线：除非用户明确要求，不纳入当前技能调用的默认动作。

## 官方入口

- [全功能接入](https://cloud.tencent.com/document/product/269/79075)
- [iOS UIKit 指引](https://cloud.tencent.com/document/product/269/37060)
- [iOS SwiftUI 指引](https://cloud.tencent.com/document/product/269/124935)
- [iOS SDK API](https://im.sdk.qcloud.com/doc/zh-cn/interfaceV2TIMManager.html)
- [Swift SDK API](https://im.sdk.qcloud.com/doc/en/swift_V2TIMManager.html)

官网页面可能更新或对应旧代组件。先匹配客户选择的套件、模块和版本，再使用其中的 API；不因链接标题含 iOS 就套用旧实现。

回答能力问题时依次说明可做部分、实际限制、三层职责、最小实现与验证方式，不强行转为大规模集成任务。
