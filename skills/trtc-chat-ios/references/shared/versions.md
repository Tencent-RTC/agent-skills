# 实际依赖优先：目录、签名与能力核对

首次接入或文件/参数与指南不一致时读本页；不是每个局部源码任务重复读所有版本信息。

## 不按版本号猜API

`Podfile.lock` 分别记录TUIChatKit、AtomicXCore、TXIMSDK_Plus_iOS_XCFramework；三者的版本号不是同一个值。`:path`开发Pod的锁文件只记录podspec版本，源码可在不升号时变化，所以源码构造器和实际构建引用是最终证据。

先核对锁文件、EXTERNAL SOURCES/checkout位置、当前target的源码，再生成调用。若下载的Pod与本地开发分支不同，保留客户已装依赖，不通过自动升级解决Skill过时问题。

## 两种已发现的源码形态

| 形态 | 页面定位 | 修改/接入规则 |
| --- | --- | --- |
| 重构源码布局 | `page/ChatPage.swift` + `page/impl/ChatPageImpl.swift` | 公开wrapper传参和生命周期转发给Impl；该形态的本地基线存在showsNavigationBar |
| 发布Pod平铺页面 | 以实际Pod源码根定位 `ChatPage.swift`，常见上层目录为 `Pods/TUIChatKit/TUIChatKit` | 不假定存在page/impl；公开构造器是否有导航开关直接查文件，没有就不能传 |

本轮实际核验的客户发布TUIChatKit9.1.7822没有 `showsNavigationBar`，ChatPage在Pod的 `TUIChatKit/ChatPage.swift`。“平铺”只指页面入口，组件仍按 `components/**` 分层。构造器接收非optional的消息/输入配置协议，省略参数会采用默认配置，但不能显式传 `messageListConfig: nil` 或 `messageInputConfig: nil`；页面自身持有导航栏；原开发分支接具体可选Config并分离Impl。它们不能混成统一API，内部protocol的访问级别也需分版本核对。不能把导航开关写成所有版本都不存在，也不能坚持开发分支签名适用于发布Pod。

另一个实际编译发现：发布版 `ChatMessageInputConfig.actionCustomizer` 为get-only，定义和init在 `components/messageinput/MessageInputView.swift`，开发分支在独立Config文件且可写。通用示例用init的 `actionCustomizer:` 参数，两种版本均验证；不把所有Config的字段和setter能力假定一致。

本Skill通用ChatIntegration模板不传该可选参数：保留ChatPage自己的导航条，隐藏宿主系统UINavigationBar，onBack由宿主处理。需要去掉组件导航条时，只有当前公开构造器确实支持该参数才用；不支持时选择保留组件导航或经授权修改UI源码，不用反射/遍历私有subview隐藏它。

## 定位器

`locate_source.py` 只检查固定候选目录和ChatPage本体/扩展的公开init，识别 `refactored` / `flat`；`initializer_parameters`为外部标签提示，`_`表示不能命名调用。存在条件编译时 `supports_shows_navigation_bar=null`，应查当前编译条件/类型检查，而不是取任意分支的true。没有podspec但确实导入UIKit/AtomicXCore的ChatPage源码时仍可识别发布包，不扫描整个Pods树。

平铺导航任务直接给ChatPage.swift；其他模块的基线文件不存在时仍报告partial，按当前符号继续在该模块找，不自动映射成假Impl。参数名提示属于词法线索，不证明访问性/全部类型兼容，最终普通import类型检查。

## 构建记录与兼容承诺

历史开发源码组合：TUIChatKit本地podspec9.1.7821、Demo锁Core4.3.11/IM9.1.7822，曾用Xcode16.0/iOS18 Simulator SDK构建并通过外部模板typecheck。它是带日期/源码来源的验证记录，不是“推荐所有客户使用此版本”。

本轮实测组合（2026-10-30）：客户lock为TUIChatKit9.1.7822、Core4.3.11、TXIMSDK_Plus_iOS_XCFramework9.1.7824；使用已安装依赖，Xcode16.0/iOS18 Simulator SDK构建TUIChatKit Pod目标成功，修订后的三份模板普通import外部typecheck通过（Swift5、arm64 iOS15 Simulator）。仅为此目标/模板的编译证据，未运行客户App、真实IM登录或iOS26 runtime。更新依赖前重新核编译器和切片，不仅修改SWIFT_VERSION。

## 快速决策

- `Extra argument showsNavigationBar`：查当前ChatPage init，移除不存在参数，保留一个导航条负责人。
- 索引page路径不存在：先试确切Pod源码根中的ChatPage.swift，不默认重新clone。
- UIKit内部文档提到Impl，但实际没有：按平铺页面本体读生命周期/布局，再查实际组件；别创建空的同名Impl。
- 公共颜色/Config同名：同样需看版本取值和消费者；名字相同不等于行为一致。
