# 能力边界

## 支持范围

本 Skill 对 Android View、Android Compose Chat UI、TUIKit、AtomicX Chat 直接提供：

- 已有 App 接入与 Chat Demo 改造
- 登录、会话列表、聊天页、联系人和搜索入口的接入建议
- 内置功能项、主题、气泡和页面配置
- 自定义消息 renderer、消息/会话 action、输入栏菜单
- 测试账号、好友、群聊和体验消息创建
- 构建、运行链路、配置和异常调用排查

Android View 与 Android Compose 是两套独立 Chat UI 实现，选择不由宿主技术栈强制决定：

1. 客户明确选择哪一版 Chat UI，就按其选择实施。
2. 客户未指定时默认 View 版。
3. Chat UI 与宿主技术栈相匹配通常能减少容器、生命周期、主题和导航的互操作成本，应作为建议而不是强制规则。
4. Compose 宿主可以接入 View 版 Chat UI，View 宿主也可以接入 Compose 版 Chat UI；方案必须说明使用的 Android 互操作边界及维护成本。
5. 所选 Chat UI 版本决定组件和 API，不能因为宿主使用另一种 UI 技术栈就混用两版 API。

iOS UIKit、SwiftUI、Flutter、uni-app 等平台属于条件支持：本 Skill 不预置这些平台的稳定 API 基线，但客户在知情后确认继续时，可以基于匹配的官网文档和客户工程真实源码协助集成、修改、排障和可行验证。

## Android Chat 与 CallKit

- Android Chat 首次集成默认包含 CallKit 源码或模块依赖、登录成功后的初始化以及 Chat 内通话入口。
- 默认不询问客户是否需要 Call，也不把 CallKit 单独描述为可选集成。
- 文件级方案仍需如实列出实际新增的模块、依赖、初始化代码、Manifest 和权限改动。
- 客户集成后明确不需要 Call 时，删除 CallKit 模块引用、App 依赖、初始化和相关 import，同时隐藏所选 Chat UI 中全部语音/视频通话入口。
- CallKit UI 或通话业务的深度定制、套餐开通、离线推送和通话服务故障应拆成独立任务。

## 先判断职责

按最小影响面选择实现位置：

1. 现有配置可以完成 → 使用 Chat UI 配置。
2. 官方扩展点可以完成 → 使用 renderer、action 或 customizer。
3. 只涉及导航、页面容器、业务权限或数据来源 → 修改宿主 App。
4. 涉及账号体系、生产 UserSig、业务鉴权或数据持久化 → 由客户服务端承担，Skill 只说明接口边界。
5. 涉及 SDK 内核缺陷 → 先用最小工程和证据复现，再交给 SDK 维护方。

不要为了一个开关或样式重写消息列表、会话列表或输入栏。

## 不在本 Skill 内实施

- 离线推送、CallKit 深度定制、直播或房间能力
- 生产 UserSig 签发服务的实现
- 与 Chat 无关的通用页面或业务功能
- 未经单独方案和授权的 Chat UI 内部源码修改

这些能力与 Chat UI 主链路可以协作，但应拆成独立任务，不能套用其他平台的 API。

## 平台入口

- [全功能接入](https://cloud.tencent.com/document/product/269/79075)
- [Android View](https://cloud.tencent.com/document/product/269/37059)
- [Android Compose](https://cloud.tencent.com/document/product/269/125127)
- [Flutter](https://cloud.tencent.com/document/product/269/125903)
- [iOS UIKit](https://cloud.tencent.com/document/product/269/37060)
- [iOS SwiftUI](https://cloud.tencent.com/document/product/269/124935)
- [uni-app 原生渲染](https://cloud.tencent.com/document/product/269/64507)
- [uni-app 标准版](https://cloud.tencent.com/document/product/269/124305)

列表不是固定支持矩阵。优先从全功能接入页选择当前仍有效、与客户目标平台和框架一致的文档。

## 其他平台继续流程

识别到 iOS、Flutter、uni-app 等条件支持平台时：

1. 明确说明：本 Skill 没有该平台的内置 API 基线，后续结论依赖当前官网文档、客户工程源码和本地可用工具链。
2. 提供匹配的官方入口，按主 `SKILL.md` 的“结构化提问与等待”询问客户是否仍要继续集成、修改或排障。
3. 客户确认后，核对平台、框架、版本、组件形态和目标能力，再读取官方指引及客户工程真实定义。
4. 按正常流程给出文件级方案；取得写入授权后直接协助修改，并执行当前环境可行的构建或静态检查。
5. 官网没有匹配方案、组件不支持目标平台或本地工具链不可用时，说明具体阻塞、可替代路径和需客户完成的验证，禁止编造 API。

不得仅因平台不属于 Android 而直接拒绝。不得把 Android View 或 Compose 的类名、配置和构建方式翻译后套到其他平台。

## 边界回答

回答能力问题时只给五项：

1. 可以支持的部分
2. 不由本 Skill 负责的部分
3. 当前平台是直接支持还是条件支持
4. 推荐拆分方式
5. 当前最小可行路径
