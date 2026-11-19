# 实际依赖优先：目录、签名与能力核对

首次接入或文件/参数与指南不一致时读本页；不是每个局部源码任务重复读所有版本信息。本页针对命令式 `TUIChatKit`；声明式 `TUIChatKit_Swift` 的版本与发布差异见 [声明式接入·版本](../swiftui/integration.md#目录与版本)。

## 不按版本号猜API

`Podfile.lock` 分别记录TUIChatKit、AtomicXCore、TXIMSDK_Plus_iOS_XCFramework；三者的版本号不是同一个值。`:path`开发Pod的锁文件只记录podspec版本，源码可在不升号时变化，所以源码构造器和实际构建引用是最终证据。

先核对锁文件、EXTERNAL SOURCES/checkout位置、当前target的源码，再生成调用。若下载的Pod与本地开发分支不同，保留客户已装依赖，不通过自动升级解决Skill过时问题。

## 两种已发现的源码形态

| 形态 | 页面定位 | 修改/接入规则 |
| --- | --- | --- |
| 重构布局（当前发布版 9.1.7825） | `page/ChatPage.swift` + `page/impl/ChatPageImpl.swift`；Pod 源码根 `Pods/TUIChatKit/TUIChatKit` | 公开wrapper传参和生命周期转发给Impl；`ChatPage` 有 `showsNavigationBar` |
| 旧发布Pod平铺页面（如 9.1.7822） | 以实际Pod源码根定位 `ChatPage.swift` | 不假定存在page/impl；公开构造器是否有导航开关直接查文件，没有就不能传 |

**以已发布版本为准。** 2026-11-18 核对：CocoaPods 与 GitHub 的 9.1.7825 与内部开发主干源码一致。与此前各版本相比，9.1.7825 的公开 API 有以下变化，旧工程升级或按旧记忆写调用时要逐项核对：

- 消息列表、输入、会话动作、联系人四个配置（`ChatMessageListConfig`、`ChatMessageInputConfig`、`ConversationActionConfig`、`ContactListConfig`）的公开属性改为无 `user` 前缀的可选存储属性，如 `config.isShowVideoCall = false`；`nil` 表示缺省，缺省解析在 internal `_xxx`。单聊/群设置配置仍为 `userXxx` 存储加同名公开计算属性。
- 自定义消息注册与占位从 `MessageListView` 移到 `MessageListHelper`：`registerCustomMessageCell(businessID:summaryProvider:makeContentView:)`、`registerCustomMessageSummary(matcher:)`、`addPlaceholder` / `removePlaceholder`。
- 更多面板内置动作 ID 为 `MessageInputDefaultActionIDs`（旧名 `MessageInputActionIDs` 已不存在）。
- `MessageContentContext` 公开了 `config`、`messageListStore`（weak）、`onMediaTap`、`onMergedMessageTap`、`showsReadReceipt`、`detailTimeText`。
- `ChatMessageInputConfig.actionCustomizer` 为可写存储属性。
- 源码文件重命名：`components/messagelist/MessageConfig.swift` → `MessageListConfig.swift`，`config/MessageListConfig.swift` → `config/MessageListConfig+Default.swift`，原 `components/common/MessageListHelper.swift` → `MessageDisplayHelper.swift`（新的 `components/messagelist/MessageListHelper.swift` 是公开注册入口），删除 `MessageListConfig+Internal.swift`、`MessageInputConfig+Internal.swift`。

历史记录：客户此前的 9.1.7822 为平铺 `ChatPage`，没有 `showsNavigationBar`，构造器接收非 optional 的配置协议，`actionCustomizer` 为 get-only 且定义在 `MessageInputView.swift`。客户仍在旧版本时按其实际文件写调用，不把 9.1.7825 签名套到旧版。

本Skill通用ChatIntegration模板不传该可选参数：保留ChatPage自己的导航条，隐藏宿主系统UINavigationBar，onBack由宿主处理。需要去掉组件导航条时，只有当前公开构造器确实支持该参数才用；不支持时选择保留组件导航或经授权修改UI源码，不用反射/遍历私有subview隐藏它。

## 定位器

`locate_source.py` 只检查固定候选目录和ChatPage本体/扩展的公开init，识别 `refactored` / `flat`；`initializer_parameters`为外部标签提示，`_`表示不能命名调用。存在条件编译时 `supports_shows_navigation_bar=null`，应查当前编译条件/类型检查，而不是取任意分支的true。没有podspec但确实导入UIKit/AtomicXCore的ChatPage源码时仍可识别发布包，不扫描整个Pods树。

平铺导航任务直接给ChatPage.swift；其他模块的基线文件不存在时仍报告partial，按当前符号继续在该模块找，不自动映射成假Impl。参数名提示属于词法线索，不证明访问性/全部类型兼容，最终普通import类型检查。

## 构建记录与兼容承诺

历史开发源码组合：TUIChatKit本地podspec9.1.7821、Demo锁Core4.3.11/IM9.1.7822，曾用Xcode16.0/iOS18 Simulator SDK构建并通过外部模板typecheck。它是带日期/源码来源的验证记录，不是“推荐所有客户使用此版本”。

本轮实测组合（2026-10-30）：客户lock为TUIChatKit9.1.7822、Core4.3.11、TXIMSDK_Plus_iOS_XCFramework9.1.7824；使用已安装依赖，Xcode16.0/iOS18 Simulator SDK构建TUIChatKit Pod目标成功，修订后的三份模板普通import外部typecheck通过（Swift5、arm64 iOS15 Simulator）。仅为此目标/模板的编译证据，未运行客户App、真实IM登录或iOS26 runtime。更新依赖前重新核编译器和切片，不仅修改SWIFT_VERSION。

发布版实测（2026-11-18）：空工程只依赖 `TUIChatKit 9.1.7825`（解析 Core 4.3.11、IM 9.1.7834），Xcode 16.0/iOS 18 Simulator SDK 完整编译通过，App target 中包含 `ChatIntegration.swift`、`CustomMessage.swift`、`DebugSignature.swift` 三份模板（Swift5、arm64 iOS15 Simulator，普通 import，无 stub）。未运行 App 或真实登录。

## 快速决策

- `Extra argument showsNavigationBar`：查当前ChatPage init，移除不存在参数，保留一个导航条负责人。
- `Type 'MessageListView' has no member 'registerCustomMessageCell'`：9.1.7825 起改用 `MessageListHelper.registerCustomMessageCell`。
- `Cannot find 'MessageInputActionIDs'`：改用 `MessageInputDefaultActionIDs`。
- `Value has no member 'userIsShowXxx'`：四个主配置已去掉 `user` 前缀，直接用 `isShowXxx`。
- 索引page路径不存在：先试确切Pod源码根中的ChatPage.swift，不默认重新clone。
- UIKit内部文档提到Impl，但实际没有：按平铺页面本体读生命周期/布局，再查实际组件；别创建空的同名Impl。
- 公共颜色/Config同名：同样需看版本取值和消费者；名字相同不等于行为一致。
