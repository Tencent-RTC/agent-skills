---
name: trtc-chat-ohos
description: >
  Internal HarmonyOS NEXT / OpenHarmony ArkTS Chat UI domain skill for TUIKit
  AtomicX — enter ONLY via skills/trtc/SKILL.md after product=chat,
  platform=ohos routing. Not a standalone dispatcher entry. Handles existing app
  or Chat Demo integration, customization, troubleshooting, demo data and
  capability boundaries; reuse Root session, SDKAppID and privacy controls.
version: 1.0.0
agent_created: true
---

# 鸿蒙 Chat UI 集成助手

## 入口与事实基线

- **集合入口**：由相邻 `trtc/SKILL.md` 完成本轮 guard、意图确认及适用的 SDKAppID 收集后进入；若宿主先加载了本技能，先交回 Root，复用本轮已有前台入口结果。Root 不存在的独立安装可直接承接业务，但不另建上报通道。写入仍以本文件的文件级方案授权为准。
- 本技能只承接 `platform=ohos`；若目标是 iOS、Android、Flutter、Web 或其他平台，交回 Root 分流。适用 HarmonyOS ArkTS Stage 工程。事实基线是公开仓库 `Tencent-RTC/TUIKit_Harmony`（GitHub `https://github.com/Tencent-RTC/TUIKit_Harmony.git`，CNB `https://cnb.cool/tencent/cloud/trtc/TUIKit_Harmony`，官方文档 `https://cloud.tencent.com/document/product/269/125128`）：仓库根下 `atomic_x/`（`@tencentcloud/atomicx`，`src/main/Index.ets` 导出 AtomicX 组件）、`chat/uikit/`（`chatuikit`，导出 `ContactsPage`、`ConversationsPage`、`ChatPage`、`ChatDialog`）、`call/`（`@tencentcloud/tuicallkit`）、`chat/demo/`（示例）；`@tencentcloud/atomicxcore` 由 ohpm 中心仓库安装。下文源码路径均相对于该仓库根；客户若引用内部或改名的源码布局，以其实际 `oh-package.json5` / `build-profile.json5` 为准。不得搬运 Android View/Compose 的 `setup`、Gradle、renderer DSL 或 Insets API。
- 默认最小链路：登录 → 会话列表 → 完整 `conversationID` → 聊天页 → 双向文本收发；默认把 CallKit 源码依赖、宿主生命周期 attach/detach 和 `call.startCall` 消费一并列入方案，不另问是否需要 Call。客户完成集成后明确不要 Call，按[集成](references/integration.md#明确不需要-call-时)成套移除。
- 只管 Chat UI 主链路及默认 CallKit 接入/移除；Push、Room、生产 UserSig 签发、Call 深度定制按[能力边界](references/boundaries.md)拆分。

## 隐私与报告：只走 Root 共享路径

- 首个真实 Prompt **只在客户工程本地留存脱敏副本**等待同意。用户明确同意前，**不得上传任何提示词、SDKAppID 或业务事件**，不得扫描 SDKAppID 用于上报，不缓存其他未同意回合等待补发；**不收集 SecretKey、UserSig、管理员凭据或项目源码**用于上报。静默、继续使用、环境开关以及复述隐私告知均不是同意；本轮用户复述隐私规则不构成同意。安装/Hook 激活统计独立于体验数据同意；尊重 Root 对“关闭体验数据”与“关闭全部上报”的不同处理。
- 隐私门禁只约束体验数据是否上报，**不是业务实施的前置条件**：共享入口不存在或失败时照常接入且不上报；隐私询问仅按下述规则短暂停一轮，拒绝不阻止接入，提醒用尽仍未同意也继续业务且不上报。只复用 `../trtc/tools/reporting.py`；Host / Root / 本 owner 共用每轮一次前台 Prompt 入口及一次重试预算。尚未尝试入口时按 Root §-1 通过 JSON stdin 传 `route_hint=trtc-chat-ohos`、`product=chat`、`framework=ohos`；已成功入口不重报。业务结束后执行一次共享最终 `invoke --skillname trtc-chat-ohos --product chat --framework ohos`，已执行则复用结果；转交其他 owner 时按实际最终 owner 归因。收到 Runtime 展示标记后，先按 Root 的首次可见消息边界原样展示固定询问并结束当前回合等待用户回复，不能继续交接、业务提问或调用业务工具；同意或拒绝保存成功后按 Root 恢复原任务；不等整套接入结束，不交给 Stop，同轮已展示则不在最终回答重复。不上报任何控制回复，不将模糊回复当作同意；上报失败不扩大权限，Prompt 不进入 shell argv。
- 业务接入需要的 `sdkAppID/userID/userSig` 仅按客户账号链路使用，与“体验数据上报”严格隔离；创建体验消息的 REST 请求是客户单独确认的业务操作，不视作上报同意。详情见[公共约束](references/constraints.md)与[体验数据](references/demo-data.md)。
- 集合内代码任务按[共享会话与上报](references/suite-integration.md)维护 `product=chat, platform=ohos, active_domain_skill=trtc-chat-ohos`。复用 Root 已收集的 SDKAppID，不重复询问、不清空；缺失时返回 Root §B.2，不另造收集流程。明确暂停 / 完成时维护相应状态；纯 IM 事实 / REST / 计费 / API 咨询交给 `trtc-chat/docs/SKILL.md`，不为上报新建集成 session。

## 结构化提问与等待（所有业务文件共用）

1. 若本轮有待展示的隐私标记，先按上节在对话中展示，不能把业务提问当作可推迟展示的理由。再只读核查工程、已提供信息和当前会话实际可用的**宿主原生**结构化提问工具；不猜工具名。需要选择、确认、授权或补充信息时优先调用已暴露工具（例如宿主确实提供的 `AskUserQuestion`），找不到时继续检查宿主内置工具发现能力；不得为提问安装/调用 MCP 或第三方服务。
2. 一次只问一个问题；选择题列 2～4 个互斥、可执行选项，推荐项第一并标“推荐”，默认单选；userID 等自由文本使用自定义输入。
3. 只有确认没有等价内置工具或明确被模式/权限禁止、调用失败且无其他工具时，才降级为**一个明确的正文问题**，列编号选项或输入格式，结束本回合；收到回答前不执行依赖答案的操作。不能只说“等待确认”然后结束。
4. 集成、自定义、排障修复：先给文件级方案（目标链路、真实组件和源码证据、每一文件、依赖/凭据/兼容/安全区与键盘、Call、构建和客户验证、回退），**同一回合**发起审批：`按此方案执行（推荐）` / `调整方案` / `暂不执行`。只有展示方案后的明确“按此方案执行”才能写入；用户初始“直接改”、批准宽泛计划或仅选择源码版本均不能替代授权。方案改变就重新审批。拒绝/停止则结束，不反复追问。
5. 体验账号和消息属于远端真实写入：先预览并把具体影响用大白话展示，再另行确认；参见[体验数据](references/demo-data.md)。

## 先检查，再路由

- 只在当前客户工程及构建配置实际引用的本地路径中识别鸿蒙模块、`oh-package.json5`、`build-profile.json5`、`hvigorfile.ts`、锁文件、入口 UIAbility、现有登录、导航和窗口；不扫描整个 home。发现引用的 TUIKit 本地源码，先按[集成的源码版本核对](references/integration.md#本地-tuikit-harmony-源码版本核对)检查身份与上游默认分支；无法确认时明确写出未知并让客户选择保留或独立引入最新源码，不能默认最新版或原地覆盖。工程内没有源码时，出方案前可把公开上游只读克隆到**客户工程外的系统临时目录**核对真实 API，授权后再按[空白工程最小模板](references/blank-project-template.md)复制进工程。
- 缺失信息仅当改变方案时按上节补问；对版本、参数、配置是否被 UI 消费，以目标版本的源码为准。
- 意图命中多个时读取**所有**对应 reference；修改代码还须读[公共约束](references/constraints.md)，先排故，其余通常按集成 → 自定义 → 体验数据分阶段分别审批：
  1. 报错/空白/配置不生效/异常调用 → [排障](references/troubleshooting.md)
  2. 测试账号/好友/群聊/消息 → [体验数据](references/demo-data.md)
  3. 主题/开关/气泡/消息/菜单/action → [自定义](references/customization.md)
  4. 首次接入/已有 App/Demo 改造 → [集成](references/integration.md)；工程内没有任何 TUIKit 源码或依赖时同时读[空白工程最小模板](references/blank-project-template.md)
  5. 能否实现/职责划分/其他平台 → [能力边界](references/boundaries.md)
  6. 通用工程与安全约束 → [公共约束](references/constraints.md)
- 意图不明时按“结构化提问与等待”只问一次目标类别，不盲写。

## 主动推进与交付

1. 集成先给文件级方案、取得授权，复用真实 ArkTS `LoginStore.shared().login(...)`、`ConversationsPage`、`ChatDialog/ChatPage` 与 CallKit；不造假消息、不写 stub。使用客户工程现有 ohpm/hvigor/DevEco 工具构建或可行静态检查；不主动启动 App/模拟器。按[排障](references/troubleshooting.md#异常调用检查)检查本次改动的 ID、生命周期、重复请求、分页和失效对象。
2. 登录成功而聊天页面未完成时，主动**只问一次**：“要不要我帮你创建几个测试账号，再准备一些好友、群聊和消息？等聊天页面接好后就能直接体验。”最小链路完成后则改问：“要不要我帮你创建几个测试账号，再准备一些好友、群聊和消息？这样你打开 App 就能直接体验聊天。”选择 `现在准备（推荐）` / `暂不准备`；不得两种阶段都问，不说“造数/灌数据/seed/dry-run”。同意后先确定客户实际登录 userID，再按[体验数据](references/demo-data.md)预览并再次确认；拒绝不追问。
3. 如客户明确选择把 SecretKey 置于客户端以仿照 Demo 调试，**方案、发起写入审批前、交付时各说明一次**“客户端密钥可被提取，生产推荐服务端签发 UserSig”；调试选择可实施但不能称为生产安全方案，密钥不得进入上报或答案。按[公共约束](references/constraints.md#凭据与权限)处理。
4. 交付区分已构建/静态检查、因工具链未验证、待客户在设备验证、当前缺失的公开扩展点；不把本仓库新建文档称为已实际编译客户 App。
