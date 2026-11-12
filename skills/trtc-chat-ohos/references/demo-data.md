# 鸿蒙 Chat 体验账号、好友、群聊与消息

本流程创建**真实 Chat 服务端数据**，不在 ArkTS 里伪造好友/会话/消息；进入前按[入口](../SKILL.md)完成 Root 隐私门禁和结构化提问，遵守[公共约束](constraints.md)。登录/页面接线看[集成](integration.md)，失败看[排障](troubleshooting.md)，独立服务端职责看[边界](boundaries.md)，显示自定义内容看[自定义](customization.md)。业务 REST 写入的授权与体验数据**上报同意**互不替代：用户同意准备消息不等于同意上传 Prompt/SDKAppID/事件；本轮复述隐私规则也不构成同意。

## 主动邀请与参与账号

登录链路成功而聊天页面未完成时使用入口所列“等聊天页面接好后就能直接体验”问句；最小链路完成后改用“打开 App 就能直接体验聊天”问句。按[入口的结构化提问](../SKILL.md#结构化提问与等待所有业务文件共用)只问**一次**，选 `现在准备（推荐）` / `暂不准备`，拒绝不追问；不得把邀请当成远端写入授权。对客户说“测试账号、好友、群聊和消息”，不说“seed/dry-run/造数/灌数据”。

确定**客户实际上要用来体验的 Chat userID**：

- 已由客户确认的登录结果/配置获知准确值，则作为中心账号；只见到变量名或运行时值未知时，一次只问准确 userID，不根据代码中的占位符或设备缓存猜测。
- 客户已有或已登录自己的账号，以该账号为中心选取 `demo_alice`、`demo_bob`、`demo_charlie` 中两个不重名的伙伴；确认中心账号在目标 Chat 应用已存在。中心账号与两个伙伴互为好友，由中心账号作为测试群群主、两个伙伴进群，每个伙伴与中心账号双向发单聊、由伙伴发中心账号可见的群消息。**不得只准备两个 demo 账号之间的内容却声称客户已可见**。
- 仅在客户明确没有可用自有账号时，使用 `demo_alice` 和 `demo_bob` 双向加好友、建群、互发单聊/群聊；完成后按结构化提问选一个作为客户将登录的账号，取**该用户自己的 UserSig** 才能体验；如需改客户端登录配置，先另给文件级方案并授权。不可用管理员 UserSig 登录客户端。
- 参与账号、登录账号或目标应用改变时重新展示预览并再次确认。不要修改客户中心账号的资料。

## 前置与复用脚本

需要 `TIM_SDKAPPID`、管理员账号（脚本默认 `administrator`）、`TIM_SECRETKEY` **或** `TIM_ADMIN_USERSIG`、`TIM_REGION`（`cn/sgp/kr/jpn/ger/usa/idn/ksa`）以及通向对应 Chat REST 接口的网络。管理员签名仅服务端 REST，`LoginStore.shared().login(...)` 使用目标用户自己的签名。只请客户通过本地受控方式提供业务必需凭据，不复述在答案、命令日志或上报里；优先环境变量，避免把 SecretKey 放进 argv/仓库。若客户使用生产应用或生产 SecretKey，**方案、执行确认前、执行完成后**分别告知：会真的创建测试账号/好友/群及消息，重复执行会增加重复消息；客户端密钥可被提取，生产推荐服务端签发 UserSig。限制业务写入范围，不将这些凭据交给 `reporting.py`。

与客户端平台无关的 **Chat REST** 实现位于同级 Android 技能目录：`../trtc-chat-android/scripts/seed_demo_data.py`、`seed_demo_data.js`、`SeedDemoData.java`（相对**本技能目录**；客户安装后通常是 `<project>/.codebuddy/skills/trtc-chat-android/scripts/`，Claude/Cursor/Codex 分别在 `.claude/`、`.cursor/`、`.codex/` 下）。本技能**不内置脚本**；先由本技能目录解析出该脚本的绝对路径并确认存在，不存在时停止创建流程并说明缺少同级 Android 技能，不临时编写未经验证的 REST 实现。按环境选 Python 3 → Node → JDK 11+ 的首个可用实现（JDK 8 的编译到工程外临时目录方式先核对已有脚本说明），先查脚本自身 `--help`。以下 `SEED` 为解析出的脚本绝对路径；`--self-test`、默认预览不产生网络写入：

```sh
SEED="<本技能目录>/../trtc-chat-android/scripts/seed_demo_data.py"
python3 "$SEED" --self-test
python3 "$SEED" --current-user customer_8472
```

`customer_8472` 只是示例，必须替换为客户**已确认**的真实体验 userID；没有自有账号时省略 `--current-user`。Node 对应同目录的 `seed_demo_data.js`；JDK 11+ 对应 `java <同目录>/SeedDemoData.java`，用**相同模式和已确认参数**。脚本支持环境变量 `TIM_SDKAPPID/TIM_SECRETKEY/TIM_ADMIN/TIM_ADMIN_USERSIG/TIM_REGION/TIM_CURRENT_USER`，也支持 `--sdkappid/--secretkey/--admin/--usersig/--region/--current-user`；命令行覆盖环境变量，避免使用带密钥的命令行选项。区域先经结构化提问确认，不能根据 IP 猜测。不要以示例地址代替实际 REST endpoint。

## 预览 → 再次确认 → 实际创建

1. 先跑所选脚本的 `--self-test`；失败停止并排障。
2. 以已确定应用、区域和中心账号运行**不带 `--apply`**的默认预览；核对 host、会导入的伙伴/账号、好友方向、群主/成员、单聊/群聊消息方向与重复风险，确认此步骤没有网络写入。
3. 面向客户用大白话逐项展示：真实目标 Chat 应用、将新增哪些账号、谁与谁互加好友、群主/成员及由谁向谁发送消息、重复执行会重复消息，**不要展示密钥、完整 UserSig 或管理 URL 参数**。有中心账号的提问：“我会以你当前使用的 `<userID>` 为中心，创建两个测试伙伴，让他们和你互加好友、加入一个专属测试群，再发送几条你登录后能直接看到的消息。现在开始吗？”无自有账号：“我准备创建 `demo_alice` 和 `demo_bob`，让他们互加好友、加入一个测试群，再发几条聊天消息。完成后我会继续协助你使用其中一个账号登录体验。现在开始吗？”在**同一回合**用宿主原生结构化提问给 `现在开始（推荐）` / `暂不开始`；用户最初说“直接执行”不替代此项再次确认。
4. 仅获得客户对**本次预览内容**明确“现在开始”后，用完全相同参数加 `--apply`（如 `python3 "$SEED" --current-user customer_8472 --apply`），这是会影响共享服务端状态的操作；只要账号、区域或应用改变就重新预览与确认。无明确确认时不得执行。
5. 按脚本检查每一步结果：中心账号先为 `Imported`；导入伙伴后 `account_check`；加好友后各方向 `friend_get_list`；建群后 `get_group_info` 和中心账号 `get_role_in_group`；单聊发送 `sendmsg` 返回标识；群发后 `group_msg_get_simple` 找到消息。`10025` 仅在已存在固定群的群主、成员与计划**完全相同**时可复用，`10021` 群 ID 占用及其他错误立即停止；HTTP 状态、REST `ErrorCode/ErrorInfo` 和失败步骤要保留，但脱敏输出。前面成功不意味着后续步骤成功。
6. 汇总创建成功的账号 ID、群 ID、每一步结果和下一步用哪个**用户账号**登录 `LoginStore`；不展示凭据。说明重复执行会新增消息，登录后通过真实 `ConversationsPage` / `ChatDialog` 检查可见性；如果页面未接好，明确仍需完成[集成](integration.md)，不得把 REST 成功说成客户端已体验成功。
