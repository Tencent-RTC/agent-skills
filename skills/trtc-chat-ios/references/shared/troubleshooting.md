# iOS Chat 排障

## 取证顺序

先记录实际 App/Chat UI/Core/IM SDK 版本、设备/系统/Xcode、复现步骤、会话类型、完整第一处错误和最近改动；日志脱敏。不同时试多个猜测修复，不把跨版本经验说成确定根因。

沿“宿主生命周期 → 公开页面/配置 → Core 状态与动作 → IM SDK 回调”定位最后一个正常点。只检查涉及的调用和文件；不能为一次错误扫描全部磁盘。模块已知时直接用 [源码任务索引](../source/index.md) 的首读文件与修改配方，不必继续通读本页所有故障类别。

## 构建和资源

| 现象 | 优先核对 | 不要做 |
| --- | --- | --- |
| No such module TUIChatKit/AtomicXCore | workspace、目标依赖、pod install 结果、源文件和 framework search path | 生成同名 stub |
| 无法访问 init/成员 | 定义是否 public/open、App 是否跨模块、接口是否来自旧代 kit | 将所有 internal 改成 public |
| Module compiled with Swift / SDK version | 实际编译器、二进制构建编译器、swiftinterface、所选 Xcode | 仅设置 SWIFT_VERSION 就声称解决二进制不兼容 |
| Undefined symbols / duplicate symbols | Core、IM SDK、VoiceAI、RTC 和 Call 的最终依赖图及切片 | 同时链接两个 IM/RTC 变体或全局排除 arm64 |
| cmark 模块找不到 | podspec 与当前依赖是否一致，tui-cmark-gfm module map | 拷贝旧 vendor cmark/opus 绕过依赖 |
| 图标/语言丢失 | TUIChatKitBundle 是否生成/拷贝，资源 target membership | 清空全部 CocoaPods resource 脚本 |
| Simulator 链接失败 | XCFramework 当前平台/架构切片 | 将设备 framework 当模拟器库 |
| XcodeGen后No such module/Pods接线消失 | 检查生成是否覆盖xcodeproj；生成后按原锁文件重新pod install，再构建workspace | 每改Swift都重装或默认删锁 |
| CocoaPods Unicode Normalization not appropriate for ASCII-8BIT | 检查locale与Ruby编码；系统存在UTF-8 locale时单条命令设LANG/LC_ALL，如 `LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 pod spec cat <实际Pod名>` | 改全局环境或直接判podspec坏了 |
| 签名失败 | App team/profile/capability 与独立资源 bundle 签名区分 | 把 Demo team/AppGroup 当客户配置 |

`Podfile.lock` 是依赖解析证据；两个锁文件不一致先说明，不默认删锁。构建时保证失败 exit code 可见，完整 build 与 parse/typecheck 分开汇报。

## 构建结果与模拟器启动不是同一层

禁止 `xcodebuild ... | tail` 后凭 `$? == 0` 宣称构建成功。没有pipefail时该退出码可能属于tail。通用sh方式（将占位命令换成真实命令再执行）：

```bash
xcodebuild <实际构建参数> > build.log 2>&1
status=$?
tail -n 40 build.log
exit "$status"
```

若选择管道，Bash使用 `set -o pipefail` 或立即读取 `${PIPESTATUS[0]}`，zsh对应 `$pipestatus[1]`；不要在其他命令之后才取这些值。完整日志BUILD FAILED和实际退出码相互核对，不能只过滤成功行。

`OSStatus -1712` / `Could not launch Simulator.app` 属于启动/AppleEvent超时症状，不等于模拟器链接失败，也不能直接断言由“多台boot”造成：

1. 先检查所选DEVELOPER_DIR、xcodebuild -version/-showsdks、simctl list runtimes/devices、目标UDID和运行时可用状态。构建SDK、deployment target与运行runtime分开，旧SDK构建本身不证明一定不能在新runtime运行；关键是当前Xcode/CoreSimulator是否支持/识别该运行时。
2. 选一台当前工具链实际支持的设备；不混用Xcode16启动不受支持的iOS26 runtime。可选已安装且兼容的Xcode或其支持的destination，不擅自sudo改全局xcode-select。
3. 多设备/Simulator卡住可能是线索。需要重启时先确认其他测试是否在跑，经授权优先shutdown指定UDID，再关闭重开Simulator；不默认 `shutdown all`、killall或删除设备/数据。
4. 记录build、install、boot和launch分别在哪一步失败。用户未要求运行时仍只给步骤，不自动启动App/模拟器。

## Xcode 反复请求目录权限

分别核对 macOS 文件访问权限、工程实际所在目录、本地 Pod 相对路径、符号链接和构建脚本报错。目录在 Desktop 是线索，不是已证实根因；本地 Pod 引用上级源码本身不是损坏。

`ENABLE_USER_SCRIPT_SANDBOXING` 的构建访问错误不等于 macOS TCC 授权弹窗。没有错误证据不关闭全工程沙盒、不重置 TCC、不删除 DerivedData、不要求完全磁盘访问；移动工程、系统授权调整等先征得用户同意。

## 登录与页面空白

- 登录失败：保留 `ErrorInfo.code/message`，再核对：`sdkAppID` 是否与签发 UserSig 的应用一致、`userID` 是否与签名中的用户一致、UserSig 是否过期或被踢下线、是否把管理员 UserSig 当成客户端用户 UserSig、网络和当前登录状态。70003解析失败等沿 [凭据指南](credentials.md) 检查，不能自己写普通Base64。客户端使用 SecretKey 参考 Demo 生成签名时，重复风险提示，但不能因此跳过实际错误码排查。
- 发送失败6032或20003：先查目标原始userID、应用归属与是否登录/导入注册；6032不是“发送代码必错”，也不是仅有“未登录”一种原因。60010是管理员权限不足，不当成签名通过全部验证的证据。
- 反复登录：检查是否在 viewWillAppear、SwiftUI update 或 cell bind 中触发，不并行开多套登录链。
- 会话为空：真实账号是否确有历史或新消息？登录是否成功？load 回调/分页/过滤如何？不先塞假数据。
- 点击无反应：ConversationsPage/ContactsPage 的公开回调是否接好？Coordinator 是否被提前释放？导航控制器是否存在？
- 返回/更多无反应：ChatPage 只调用可选 closure；未接 onBack/onMoreClick 就不会自动导航。
- 搜索不能定位：是否丢失 NavigationInfo.locateMessage？是否把 Any 搜索结果强转错类型？
- 重复导航条：系统 UINavigationBar 与组件自带条是否同时显示？
- 进入离开后未读/录音异常：检查 child controller containment、窗口可见性、应用前后台和回调持有者。

## 角标、群免打扰与已读

分别观察 `ConversationInfo.unreadCount`、`receiveOption`、`groupAtInfoList`、`ConversationListState.totalUnreadCount`；不要相互替代。

- 群设置开关控制使用 `.notNotify` / `.receive`，显示开关 `isShowDoNotDisturb` 不写入状态；查 setter 的 Result，不忽略失败。
- 当前会话 cell 与设置页对细分 receiveOption 的判断可能不同；新增 exceptMention 模式必须同步显示、菜单与未读口径，不能仅加一个枚举分支。
- 标记未读不必等于收到新消息；不把本地标记强行加进 SDK 总未读。
- 未读清除是业务动作，不为布局修复顺手清空所有会话。
- tab 角标放到根视图可能残留在聊天页；放入 tabBar 又可能受命中范围限制。根据真实 frame、坐标转换、hitTest 和导航转场取证，不在两种挂载点之间盲目切换。
- iOS 26 新样式需实际验证；未复现的新布局不能当作确认原因。禁止依赖私有子视图类名的长期兼容承诺，保持图标锚点稳定且跟随 Tab 可见性，区分布局动画与业务清除动画。

## 配置与自定义消息

1. 确认传给实际页面的配置，而非修改未被使用的局部副本。
2. 明确 ChatPage 默认右头像与显式空配置的差异。
3. 找到配置消费：JSON 定义存在不代表页面使用；hideSearch 不能凭字段名判定有效。
4. 自定义消息先验证 `.custom`、customData String、JSON businessID、注册时机及保留协议优先级。
5. 模糊摘要：确认注册了 summaryProvider 或公开摘要 matcher；不要只改消息内容 view。
6. 复用错乱：每次 bind 重置所有内容和任务，异步返回校验当前消息标识，多选时禁用业务跳转。
7. CustomEditor 崩溃：ID 是否空/重复，replace 是否改变 ID，是否提前 build，anchor 是否存在？
8. 品牌色/语言不刷新：ThemeState setter 的副作用、静态 CGColor、label 设置时机；按需重建页面，不改 internal 缓存。

## Call / Push / ASR

- 通话入口无反应：依赖是否实际加入、同账号初始化是否成功、Call 内 subscriber 是否注册、服务是否开通？没有 Call 时隐藏入口，而不是造空桥接器。
- 重复拨打：检查 App 与 Call 模块是否各订阅了一次相同通知。静态发现重复订阅风险不等于已复现，需对应事件记录。
- Push 无通知：先区分在线/离线、会话接收选项、APNs凭据/环境、Push登录注册与解绑，再查 NSE；不通过修改客户端角标冒充推送修复。
- ASR 无文本：检查麦克风/音频格式、依赖版本、服务权限和真实失败回调；UI 默认 enableRealtimeVoiceToText 不能证明服务可用。

默认不启动 App/模拟器；给出明确运行验收步骤。用户授权 UI 自动化后才接相应测试链，设备或账号不可用时报告阻塞，不使用探针成功冒充真实 Demo 修复。
