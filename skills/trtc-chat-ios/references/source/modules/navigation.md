# 导航、安全区、键盘与页面生命周期

## 何时读取

返回/更多按钮无效、双导航条、嵌入页面后未读不清或录音不停、键盘遮挡/重复留白、Tab角标穿透/转场跳动。先判断发生在组件ChatPage还是宿主Home Tab；后者不要误改消息cell。

## 首读（相对 U）

| 文件 | 符号/职责 |
| --- | --- |
| `page/ChatPage.swift` | 公开构造与viewWillAppear/viewWillDisappear/viewDidLayoutSubviews转发 |
| `page/impl/ChatPageImpl.swift` | 页面组装、owner、返回/更多、输入与列表联动 |
| `components/messagelist/view/MessageListViewImpl.swift` | hostVisibilityDidChange、可见性与已读/滚动消费 |
| `components/common/CustomNavigationBarViewController.swift` | 自带导航基础类；App跨模块不是open扩展点 |

宿主专属问题再从实际App入口查D中的 `Sources/Navigation/ChatFlowCoordinator.swift`、`Sources/Pages/Home/HomeTabBarController+UnreadBadges.swift` 及Home布局回调。D可能被发布改写/不存在，应沿宿主当前引用找，而非要求客户下载内部Demo。

## 调用链

宿主持有VC/coordinator → Page façade持有private impl → impl创建输入/列表并接事件 → facade转发生命周期 → list根据host可见/应用active/window状态清会话未读；离页协调停止输入录音。逐消息回执是另一条判断链，见messages指南。

`page/impl/PageImplementation.swift` 是NSObject+weak owner，不是child UIViewController。child containment针对宿主嵌入ChatPage，不要机械把Impl也包成child。`components/common/RTCBaseView.swift` 在首次didMoveToWindow才执行建树/约束/绑定/样式；热缓存状态回调可能先于setupViewStyle，改首帧样式时需核对这个顺序。

以上Impl链只适用于重构基线；发布Pod的平铺ChatPage可能直接负责布局和生命周期，先读实际文件。会话点击携带NavigationInfo.conversation与locateMessage进入ChatPage；onBack/onMoreClick由宿主接线。部分版有showsNavigationBar、客户9.1.7822反馈无该参数，未核实不能传；默认保留组件条并隐藏宿主系统条，见 [能力检查](../../shared/versions.md)。

## 修改配方

### 返回、关闭和更多导航

先看按钮实际handler是否有闭包，再看宿主是否注入及coordinator是否被持有。`ChatPageImpl.handleBackTapped` 仅调用onBack；`components/common/impl/CustomNavigationBarViewControllerImpl.swift` 才有onBack→pop→dismiss兜底，不能把它套到ChatPage。根会话页没有返回闭包时提供宿主退出入口，不靠不可见系统返回按钮。修改页面内部可以用internal导航实现；不能在App侧子类化final或非open类。

保留搜索locateMessage透传；原始userID/groupID通过ChatUtil形成会话ID；返回聊天列表和关闭整个Chat flow分开处理。隐藏系统条后真正退出flow要恢复原状态，或使用独立模态导航栈隔离。

### 嵌入页面/容器

按 addChild → addSubview/constraints → didMove 完成；移除用willMove/removeFromSuperview/removeFromParent。确认Page的生命周期仍转发到impl；不手动重复调用viewWillAppear“补齐”缺失的containment。检查重建是否丢草稿、定位、未读状态。

### 键盘/安全区

先确认输入栏约束、键盘通知/高度来源、list bottom inset与滚动跟随的各自负责者；只有需要时继续读输入模块的布局/面板代码。使用窗口坐标转换与实际safeArea，不写死状态栏/Tab高度。宿主已有键盘调整时，避免与ChatPage双重加高；更多/表情面板替换键盘需验证动画完成与交互取消。

改输入高度不只改一个bottom常量：列表可见区域、滚动到底部策略、首屏定位和发送后跟随都可能需要联动。正在阅读历史消息时不要强行拉到底部。

### Tab未读角标转场与命中

此任务通常在宿主Home实现：确认未读来源、角标父视图、图标锚点坐标、window/tab可见性和hitTest，再选最小修复。根view可能覆盖聊天页，tabBar子视图可能有超出bounds的命中限制；不能从历史经验直接选择某个父视图。

返回时记录中间布局与最终锚点，避免不稳定fallback污染最后位置。禁止笼统禁用全部UIView动画；区分位置赋值与用户拖拽清除反馈。清除请求成功/失败与布局刷新是两套状态，不用清空未读“验证”位置修复。

## 不变量

- Store/Combine/通知绑定生命周期唯一；重复进入不产生多个消费者。
- 只有真实可见且active的聊天页触发相应已读；布局重排不能偷偷更改业务状态。
- 离页/后台录音清理与取消迟到回调不能因导航重构丢失。
- 系统bar、组件bar、safeArea和keyboard每项有明确负责人。
- 探针或旧iOS验证不能证明新iOS真实App相同；私有Tab子视图名不能当稳定API。

## 最小回归

push/pop/dismiss、交互返回取消、切Tab、应用前后台；根列表能退出；onBack/onMore点击有处理；双导航栏不出现。键盘显示隐藏、表情/更多切换、多行输入、横竖屏/RTL/不同safeArea；搜索定位仍正确、历史滚动不跳。未读0↔非0、免打扰会话、角标拖拽成功/失败和不同Tab数量。

录音或发送取消问题继续 [输入模块](input.md)；消息首屏/滚动缓存问题继续 [消息模块](messages.md)。历史角标回归细节按需看 [经验](../lessons.md)。
