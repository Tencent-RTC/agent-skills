# 安装、维护与集合接入

## 当前交付

目录名与 frontmatter 为 `trtc-chat-ios`，显示名为 iOS TUIChatKit，Skill 版本保留 `1.2.0`，独立于 npm 集合版本。集合安装由官方 CLI 分发到四个 IDE，与相邻 Root 共用隐私与上报运行时；仍兼容不带 Root 的独立使用。

可将整个目录复制到宿主支持的 Skill 目录，例如工程级 `.codebuddy/skills/trtc-chat-ios`；这里只说明安装方式，不自动写入用户目录。保留 `references/`、`scripts/` 的相对路径；Swift代码示例位于 `references/examples/`，无需单独的 `assets/` 目录。单独使用不要求相邻 Android 或根 Skill。

## 与 Android 结构的对应

版本 1.1.0 保留原有接入功能，改为按用途分层：`references/app` 放应用接入/公开定制/测试数据；`references/source` 放任务索引、架构、变更配方、经验和七个模块指南；`references/shared` 放公开API字典/边界/通用约束/故障分流；`references/maintenance` 只放安装发布维护。维护者测试集中在开发仓库顶层的 `tests/trtc-chat-ios/`，不随 npm 包或 Skill 安装分发。原 `assets` 中的三份Swift模板现统一归入 `references/examples`，供AI按需参考与适配，不自动加入宿主工程；源码内容保持不变。

主入口只做路由。新增文件必须挂到相应入口或模块指南，避免孤立文档；同一事实只在主负责指南详细讲解，其他文件用短链接，不把所有指南聚合进SKILL.md。平台差异：

- Android View/Compose 改为命令式 UIKit 基线，不混入独立 SwiftUI API。
- Activity/Insets 改为 UIViewController containment、导航、安全区和键盘。
- renderer/receiver DSL 改为 MessageContentView、静态注册和 CustomEditor 参数闭包。
- 默认强制 Call 改为按实际 iOS 工程需求接入，避免重复事件 subscriber。
- 不复制内部环境、远端测试账号或 SecretKey；测试数据工具在单独安装时明确属于可选外部能力。
- 不照抄特定宿主工具名，也不忽略宿主已有授权、权限和工具约束。

## 集合发布接入

- `bin/cli.js` 的 `SKILL_ALLOWLIST` 安装本目录；`package.json.files` 已包含整个 `skills/`。四个 IDE 共用安装逻辑，所有相对引用资源应一起分发。
- `skills/trtc/SKILL.md` 处理首次路由、SDKAppID 收集后的续接以及 active / paused / completed 恢复；iOS 判断优先于通用 Web Chat 回退。纯 IM 文档咨询保持 docs 路径。
- `skills/trtc/runtime/telemetry.js` 登记 owner `trtc-chat-ios`，product `chat`，framework `ios`；通过 `npm run build:telemetry` 更新 bundle。不添加独立发送器或绕过明确同意。
- Root / Host / owner 共用一次前台入口与最终归因；不要在域内再次采集 Prompt。收到隐私展示标记后，先按 Root 首次可见消息边界原文展示并结束本轮等待用户回复；不能接着交接或提业务问题。同意或拒绝保存后按 Root 恢复原任务，不等待整套任务结束，已展示不重复。
- `npm run test:chat-ios` 检查本 Skill，集合发布测试覆盖包安装与归因。修改运行时后重建 bundle 并运行原有上报回归。tarball 验收不能只看源目录存在。
- `scripts/update-version.js` 只更新集合统一版本，本 Skill 的 `1.2.0` 不加入其 TARGETS。版本更新后仍需重建 bundle；发布动作按维护者授权执行。

## 共享会话

只在集合安装且实际开始 / 续接代码任务时维护共享 session。先让 Root 完成 guard；不覆盖另一个尚未切换的产品任务，也不复制 Web Chat 的 phase / flow 状态机。

在已安装的 `trtc` 技能根目录执行以下工具，每个命令都设置 `TRTC_PROJECT_ROOT="<projectRoot>"`，不能把技能根误作客户工程：

```bash
TRTC_PROJECT_ROOT="<projectRoot>" python3 -m tools.session read --field state_version
# 仅明确返回 MissingError 时创建；损坏 / 未知版本不能覆盖
TRTC_PROJECT_ROOT="<projectRoot>" python3 -m tools.session create --product chat --platform ios
# read 得到当前 state_version N 后，CAS 写入路由与本次任务状态
TRTC_PROJECT_ROOT="<projectRoot>" python3 -m tools.session write-batch --expected-version N \
  --updates '{"product":"chat","platform":"ios","active_domain_skill":"trtc-chat-ios","status":"active"}'
```

create 之后也要先 read 再写；CAS 冲突重读并重试一次，仍失败则保留现场，不能假称状态已保存。不要清空 session.sdkappid、sdkappid_state、凭据来源或其他 flow_state。明确暂停时仅更新 status 为 paused；完成用户已确认的任务范围并说明验证结果后更新为 completed。重新开始已完成的代码任务再设 active；纯文档查询不新建 session。SDKAppID 的 session 业务使用与遥测同意是两个独立判断，未同意时不得借维护 session 扫描或上传体验数据。

## 本 Skill 本地检查

已安装的 Skill 可用 Python 3.9+ 执行 `python3 -B scripts/validate_skill.py`，检查 frontmatter、目录名、相对链接、资源布局、配方章节、任务索引、模板约束和Python语法，无需开发测试目录。

维护者在集合开发仓库根目录执行 `npm run test:chat-ios`；命令会显式传入 `tests/trtc-chat-ios/acceptance.json` 并运行该目录的 Python 测试。显式指定的验收文件缺失会失败；发布安装后的资源检查不依赖它。均不联网、不读取App凭据、不启动模拟器。

更新代码基线时，针对 `tasks.json` 的UI任务在真实UI根运行 `locate_source.py --task <任务> --root <已确认目录> --check-symbols`；`tab-badge`改传明确的Demo Sources根，`config`预期只返回select-module。缺失文件/符号必须更新或记录不适用，不把索引命中当作API兼容证明。脚本默认只返回当前任务切片，别要求用户先读完整JSON。

Swift 模板分别放入依赖当前 TUIChatKit/AtomicXCore 的 App target 类型检查或完整构建。单独 `swiftc -parse` 只能证明语法；已有旧 framework 不能替代当前源码 API 验证。模板中的类型为宿主自有示例，不是 kit 内置类。

模型验收清单保留在开发仓库的 `tests/trtc-chat-ios/acceptance.json`，不属于用户交付资源。结构检查只确认案例存在，不代表模型在每个案例上的端到端效果通过。

以下版本条目是原 Skill 的历史维护记录，不代表本次集合接入已重跑真实 App / Pod 构建。当前补齐的验收清单与本地测试以本段后的说明为准。

1.0.0基线验证（2026-10-28）：使用 Xcode 16.0 / iOS Simulator 18.0 SDK 构建本地TUIChatKit Pod成功，两份Swift模板及六段参考代码通过普通import外部类型检查（Swift5、arm64 iOS15 Simulator），未用stub/@testable；依赖头文件及旧构建缓存有警告。本次1.1.0未更改这些模板或业务Swift源码，不重复声称运行了App。

1.1.0新增验证：分层链接/大小预算/配方与索引检查、定位器20项自动测试；另外用实际命令式UI和Demo源码校验路径与符号，避免只用索引生成fixture自证。22个模型验收场景仍是待执行的行为评估清单，不等于完成端到端测试。

1.2.0客户评审修订（2026-10-30）：新增按需 `shared/credentials.md` 与 `shared/versions.md`、DEBUG签名模板、发布平铺目录识别及参数能力检查。验证36项本地自动测试（含5项真实Swift/Python签名离线交叉验证），以及客户已装9.1.7822/Core4.3.11/IM9.1.7824的Pod目标构建、三份模板和六段App参考代码外部typecheck。未升级/克隆依赖、未运行App/模拟器、未用真实密钥登录或执行REST。

另尝试复用旧开发基线构建产物进行模板复检，但其依赖搜索目录已不可用，报 `No such module AtomicXCore`；没有使用stub绕过，也未重跑该开发组合的完整构建。因此本轮模板兼容实测仅以客户发布Pod为准，1.0开发组合仍属历史验证。

客户建议不是全部照搬：60010不作为签名通过证据，6032不限定唯一原因；实际源码主题键是mode而非themeMode；颜色按背景而非isSelf选；UISegmentedControl和Simulator超时处理均保留取证与局部操作，不默认替换全部控件/关闭所有设备。31个模型验收场景仍待端到端执行，不能以单元测试代替UI或云端行为验证。

本次集合接入补齐 20 项定位器测试、5 项 Swift/Python 离线签名交叉验证，并提供 22 个待执行模型验收场景（`status=not_run`）；历史记录中的其他测试数不代表这些场景已执行。

评估弱模型时至少记录：正确选中的主指南、实际读取源码路径、无关读取/扩大搜索次数、缺省和联动是否遗漏、任务完成正确性。只减少文件数不是成功标准。入口和模块的字符预算有自动检查，但字符数不等于token数；未绑定模型分词器或实测前，不宣称降低了固定百分比token/耗时。

打包时从新建暂存目录复制 Skill，排除 `.DS_Store`、`__pycache__` 与临时日志，然后执行宿主的 Skill 打包/校验流程；不要将 Finder 元数据、验证构建产物或 SDK 二进制放入压缩包。

## 维护规则

升级基线时重新读取公开 API 和访问级别、Config Defaults、配置消费者、podspec/lock、资源包及 Core swiftinterface，再复跑模板检查。API 地图记录来源而非复制整个仓库；禁止在分发包中加入 Pods、SDK 二进制、构建目录、登录凭据或维护者绝对路径。
