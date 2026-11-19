# 声明式 SwiftUI 套件入口

## 先确认是不是这套源码

声明式套件是独立的 `TUIChatKit_Swift`：Pod 名和模块名都是 `TUIChatKit_Swift`（代码中 `import TUIChatKit_Swift`），页面是 `struct ... : View`，资源包是 `ChatUIKitBundle`。命令式套件是 `TUIChatKit`（`ChatPage: UIViewController`、资源包 `TUIChatKitBundle`），二者 API 不能混用。

按以下证据判断，命中任一即走本分支：

- `Podfile` / `Podfile.lock` 中有 `TUIChatKit_Swift`，或宿主 `import TUIChatKit_Swift`。
- 源码根有 `TUIChatKit_Swift.podspec`，或 `page/ChatPage.swift` 中是 `public struct ChatPage: View`。
- 用户明确说“声明式 / SwiftUI 版 Chat 组件”。

只是“SwiftUI 宿主 App 承载命令式 `ChatPage` 控制器”时仍属命令式路径，见 [命令式接入](../app/integration.md#导航与页面生命周期)。两个信号同时存在且无法判断时，只问一次客户实际使用哪个 Pod。新接入且客户未指明套件时，不能因为宿主用了 SwiftUI 就直接选声明式，先按 [套件选择](../shared/kit-selection.md) 判断。

## 第一跳：只选需要的文件

| 用户目标 | 首次读取 |
| --- | --- |
| 修改组件源码、修内部 bug、新增公开配置 | [声明式源码任务索引](source/index.md)，再读命中的模块指南 |
| 首次接入、依赖来源、环境对象、导航、Call 选择 | [声明式接入](integration.md) |
| 登录参数来源、客户端 SecretKey 调试、交付提示 | [声明式接入·登录](integration.md#登录)（规则与命令式共用） |
| UserSig 生成/编码、70003/60010/6032、首次收发 | [凭据与账号](../shared/credentials.md) |
| 用公开开关、外观、菜单、自定义消息定制 App | [声明式定制](customization.md) |
| 查公开构造器、哪些类型不能在 App 中调用 | [声明式 API 地图](api-map.md) |
| 构建/登录失败但不知道归属 | [排障分流](../shared/troubleshooting.md)，定位后切到声明式源码模块 |
| 只问能力与三层职责 | [能力边界](../shared/boundaries.md) |

首次源码任务的目标读取集合为“入口 + 本页 + 声明式任务索引 + 1 个模块指南 + 2～4 个首读文件”。不要再读命令式模块指南，除非任务明确要求对齐命令式行为；命令式文档里的 `UIViewController`、child containment、`MessageContentView` 等结论不能直接套到这里。

## 共用与不共用

- 共用：[凭据](../shared/credentials.md)、[签名模板](../examples/DebugSignature.swift)、[公共约束](../shared/constraints.md) 的凭据/副作用/验证声明部分、[测试数据](../app/demo-data.md)、[能力边界](../shared/boundaries.md) 的三层职责。
- 不共用：命令式 [API 地图](../shared/api-map.md)、[应用定制](../app/customization.md)、命令式源码索引与七个模块指南、`references/examples` 下的两份 UIKit 模板（`ChatIntegration.swift`、`CustomMessage.swift`）。声明式对应内容都在本目录。

基线：2026-11-18 内部开发源码（podspec 9.1.7822）与已发布 Pod 9.1.7821 的静态核对，见 [声明式接入·版本](integration.md#目录与版本)。
