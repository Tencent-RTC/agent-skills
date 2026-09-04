# IM SDK xlog 日志解读速查（Title 锚点 + 关键字段）

> 拿到 IM SDK xlog 日志后，按 **Title 锚点**（如 `LogRequestEnd` / `OnUserSigExpired` / `HandleNewMessage`）秒定位业务流程。
> 本 Skill 的 `scripts/analyze-local.js` 仅在已配置可信本地 decoder 时解码 IM `.xlog`；否则先获取解码后的文本，再用本文档解读。

---

## 一、xlog 日志通用格式

```
年-月-日 时:分:秒.毫秒 进程号-线程号/包名 D|I|W|E/imsdk: TIM: |-<源文件>:<行号>  <Title>  |<key1>:<value1>|<key2>:<value2>|...
```

| 字段 | 含义 |
|------|------|
| `D / I / W / E` | 日志级别（Debug / Info / Warning / Error） |
| `imsdk: TIM:` | IM SDK 固定前缀，便于 grep |
| `<源文件>:<行号>` | C++ 源码定位 |
| **`<Title>`** | **关键 grep 锚点**——本文档按 Title 索引 |
| `\|<key>:<value>` | 字段流，竖线分隔 |

> 示例：`I/imsdk: TIM: |-login.cpp:736  LogRequestBegin  |sdkappid:1400xxxxxx|userid:fff` → grep `LogRequestBegin` 跳到登录流程

---

## 二、初始化及登录

### SDK 初始化（含 IP 策略）

| Title | 含义 |
|-------|------|
| `Init` | 初始化开始（含 sdkappid / sdk version / platform / device_type 等字段） |
| `PrintIPList` | 打印 IP 列表（来源 5 类：`http dns / local dns / hardcode / server push / anycast`） |
| `OnConnectComplete` | IM 建连完成（含 `connect cost time` / `ping cost time` / `successful address`） |

关键字段：
- `ip_source`：IP 来源——重连时 SDK 优先用本地缓存（`anycast / server push`）
- `successful address`：最终建连成功的 IP:port，**"建连慢"直接看 cost time**

### 登录动作

| Title | 含义 |
|-------|------|
| `LogRequestBegin` | 登录开始（`Login begin\|sdkappid:...\|userid:...\|is_auto_login:no\|current status:UnLogined`） |
| `RequestA2D2Online` | 发送换票 + 上线请求 |
| `HandleA2D2OnlineResponse` | 响应换票（`tinyid` = userId 映射后台的 ID） |
| `HandleOnlineResponse` | 响应上线（`server_time` / `client address`） |
| `StartHeartbeat` | 启动心跳（**默认 120s 间隔**） |
| `LogRequestEnd` | 登录结束（成功 `error_code:0`，含 `time cost` 总耗时） |
| `HandleServerConfigResponse` | 服务端配置（report_log_level / network_enable_local_iplist_prior 等） |
| `OnSynchronizeConversationList` | 会话同步完成 |
| `NotifySynchronizeServerInfoResult` | 漫游信息同步全部完成 |

> 6.2 后登录会额外同步"所有群最新 20 条消息"（前提：业务添加了信令监听）。

### 登出

`LogRequestBegin|Logout begin` → `StopHeartbeat` → `RequestOffline` → `HandleOfflineResponse` → `LogRequestEnd|Logout success`

### 被踢

| Title | 含义 |
|-------|------|
| `HandleKickoutNotify` | **收到被踢通知** |
| `OnKickout` | **被踢回调**（含 `kick_offline_type` + `platform` = 另一台登录设备的平台） |

> 客户问"为什么被踢" → 看 `platform` 字段：账号同时在 X 平台登录，IM 默认不允许多端在线，本端被踢。
> 解决方向：业务做单点登录控制，或启用多设备登录能力（付费功能）。

### UserSig 过期

| Title | 含义 |
|-------|------|
| `RequestHeartbeat` | 心跳请求（每 120s） |
| `HandleHeartbeatResponse\|error_code:-10001\|error_message:key is expired.` | **心跳响应 UserSig 过期** |
| `OnUserSigExpired` | 触发 UserSig 过期回调（业务需重新生成 UserSig + login） |

> 过期不只通过心跳触发——收发消息/改资料/已读等任何 IM 请求都会触发。
> 建议业务：调整 UserSig 有效期 + 在 `onUserSigExpired` 回调里自动重新登录。

---

## 三、消息相关

### 消息子类型（`message_sub_type` 字段）

| 子类型 | 含义 |
|--------|------|
| `0x0` | 信令消息（自定义消息形式） |
| `0x6` | **普通消息**（C2C / Group 文本/图片/语音/视频/文件等） |
| `0x14` | **群 tip 消息**（成员加入/退出通知） |
| `0x17` | **群 system 消息**（解散/被踢/创建，由 `@TIM#SYSTEM` 发出） |
| `0x20` | **好友关系链更新消息** |
| `0x38` | 特殊群 tip（不存漫游） |

### 拉取历史消息

`GetHistoryMessageList` → `OnGetLocalMessageList`（本地库） → `OnGetCloudMessageList`（云端，`is_all_message_fetched:1` = 全部拉完） → `HandleNewMessage|message_source:c2c history message from cloud`

### 发送消息

| Title | 含义 |
|-------|------|
| `SendMessageComplete` | **发送完成**（`error code:0` = 成功；失败看 error message） |

关键字段：
- `message_status`：发送中 / 成功 / 失败 / 删除 / 撤回 / 本地消息
- `IsOnlineOnly`：`true` = 在线消息（不存离线）
- `client_time` / `server_time`：时差大说明网络/排队问题
- `sequence` / `random`：消息唯一标识（两端对账用）
- `message_elements`：`[text] / [custom] / [face] / [image] / [sound] / [video] / [file] / [location]`

### 接收消息

| Title | 含义 |
|-------|------|
| `HandleNewMessage\|message_source:receive message` | 接收消息 |
| `HandleUpdateC2CUnreadInfo` | 同步服务端最新未读数（仅 C2C） |
| `HandleConvertMessageTinyIDResponse` | 消息同步响应（`abstract_message_count` = 摘要消息数） |

Group 特有字段：`group_id` / `group_type:Public/Private` / `need_read_receipt`

### 删除 / 撤回 / 免打扰

| 操作 | Title |
|------|-------|
| 删云端（双向） | `DeleteMessages` |
| 仅删本地 | `DeleteLocalMessages` |
| 撤回 | `RecallMessage` / 接收方 `OnReceiveMessageRevoked` |
| 插入本地 | `InsertLocalMessage` |
| 清空 | `ClearC2CHistoryMessage` / `ClearGroupHistoryMessage` |
| 免打扰 | `SetC2CReceiveMessageOpt` / `SetGroupReceiveMessageOpt` |

---

## 四、会话相关

| 流程 | 关键 Title |
|------|-----------|
| 拉会话列表 | `RequestSynchronize` + `PrintConversation` + `HandleSynchronizeResponse` |
| 未读数更新 | `HandleUpdateC2CUnreadInfo` / `OnGroupUnreadInfoChanged` |
| 置顶 | `MarkConversation` + `HandlePinConversationResponse` |
| 删除会话 | `DeleteConversation` + `HandleDeleteConversationResponse` |
| 已读上报 | `MarkC2CMessageAsRead` / `MarkGroupMessageAsRead` |
| 已读回执 | `OnRecvC2CReadReceipt` / `OnRecvMessageReadReceipts` |
| 未读总数 | `GetTotalUnreadMessageCount` |

> `conversation_key` 格式：C2C = `c2c_<userId>`；Group = `group_<groupId>`。
> grep `conversation_key:c2c_` 只看 C2C 会话日志。

---

## 五、群组相关

| 流程 | 关键 Title |
|------|-----------|
| 创建群 | `CreateGroup` + `HandleCreateGroupResponse` |
| 加群 / 退群 | `JoinGroup` / `QuitGroup` + 对应 `Handle...Response` |
| **被踢出群** | `OnReceiveGroupNotifyMessage`，`[group_system] group_system_type:kicked from group` + `operator_user_id` |
| **解散群** | `DeleteGroup` + `[group_system] group_system_type:group dismiss` + `operator_user_id` |
| 群主变更 | `TransferGroupOwner` + `group_system_type:owner change` |

> 被踢/解散都通过 **C2C 系统消息**（`@TIM#SYSTEM` + `message_sub_type:0x17`）通知，elem 是 `[group_system]`。
> 客户问"成员怎么知道自己被踢/群被解散" → 拿 `group_system_type` + `operator_user_id` 直接答。

---

## 六、用户相关（好友/黑名单）

| 流程 | 关键 Title / 字段 |
|------|------------------|
| 添加好友 | `AddFriend`，`friendship_change_type:add to friend list` |
| **添加黑名单** | `AddToBlackList` —— **会先 `delete from friend list` 再 `add to black list`**（拉黑好友先解绑） |
| 删除好友 | `DeleteFriend`，`friendship_change_type:delete from friend list` |

> 所有好友关系链变化都通过 `[friendship_change]` elem 通知。
> 客户问"拉黑了对方还是好友吗" → 日志显示先解绑好友 + 再加黑。

---

## 七、信令相关（音视频通话邀请）

> 信令消息本质是**自定义消息**，`message_elements` 固定 `[custom]`。

| 流程 | signaling xxx 取值 / Title |
|------|---------------------------|
| C2C 邀请 | `V2TIMSigMgrImpl\|signaling invite`（`inviteID` / `invitee` / `timeout:30`） |
| Group 邀请 | `signaling inviteInGroup`（`inviteID` / `groupID` / `inviteeList`） |
| 接收 / 同意 / 拒绝 / 取消 / 超时 | `receive invitation` / `accept invite` / `reject invite` / `signaling cancel` / `invite local timeout` |

> **信令排障思路**：grep `V2TIMSigMgrImpl` 拉出整个邀请生命周期，按 `inviteID` 串联两端日志。

---

## 八、搜索相关

| 流程 | Title | 关键字段 |
|------|-------|---------|
| 搜索消息 / 群组 / 群成员 | `SearchMessages` / `SearchGroups` / `SearchGroupMembers` | `keyword_list` / `search_field` |
| 搜索好友 | `SearchFriends` | `keyword_list`（最多 5 个） |

> ⚠️ 消息/群成员搜索是**旗舰版**功能，体验版/基础版调用会失败。

---

## 九、客户问题快查表

| 客户描述 | 跳转 | 关键看点 |
|---------|------|---------|
| "登录失败/超时" | 登录动作 | `LogRequestEnd error_code` + `time cost` |
| "建连慢/连不上" | 初始化 | `OnConnectComplete connect cost time` + `successful address` |
| "我被踢了" | 被踢 | `OnKickout platform` 字段 |
| "突然报 UserSig 过期" | UserSig 过期 | 业务需在回调中自动重新登录 |
| "对方收不到我的消息" | 发送+接收 | 双向比对 `sequence` / `random` |
| "群里突然没我了" | 群组 | `[group_system] group_system_type` |
| "拉黑了为什么对方还是好友" | 用户相关 | 先 delete 再 add 的原子动作 |
| "信令邀请没收到" | 信令 | 按 `inviteID` 串联两端 |

---

## 关联文档

- IM 错误码数据 → `../data/api/error-code.json`
- IM 错误码实体知识（6014/6206/6208/70001 等） → `trtc-product-concepts.md` §1
