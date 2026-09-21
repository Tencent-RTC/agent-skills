# 创建体验账号和消息

## 作用

本流程通过 Chat 服务端 REST API 准备真实的测试账号和聊天内容，让客户打开 App 后可以直接体验，不使用本地假数据：

1. 客户有自己的 Chat userID 时，以该账号为中心选择两个测试伙伴
2. 客户没有可用的自有 Chat userID 时，使用 `demo_alice` 与 `demo_bob`
3. 建立中心账号与测试伙伴之间的双向好友关系
4. 创建或复用本次账号组合对应的测试群
5. 发送中心账号可直接看到的单聊和群聊文本消息

账号、好友和固定群可以重复使用；每次执行消息步骤都会新增消息，必须把可能出现重复消息说清楚。

## 账号决策

本文件中凡需客户选择、确认或补充信息，包括 userID、应用信息、管理员账号、区域和凭据提供方式，都必须按主 `SKILL.md` 的“结构化提问与等待”发起；不得直接在正文提问后结束。

先确定客户实际用于体验的 Chat userID：

- 已从登录结果、登录配置或客户描述获得准确 userID：将它作为中心账号，脚本传入 `--current-user <userID>`。脚本不修改该账号资料，并从 `demo_alice`、`demo_bob`、`demo_charlie` 中选择两个与它不重名的测试伙伴。
- 只知道代码中的变量名，无法确定运行时 userID：按主 `SKILL.md` 的“结构化提问与等待”一次只询问客户当前或准备登录的准确 userID，不能猜测。
- 客户确认没有可用的自有 Chat userID：不传 `--current-user`，使用 `demo_alice` 与 `demo_bob`，完成后继续引导或经授权帮助客户登录其中一个账号。

传入中心账号时，体验数据必须满足：

- 中心账号已存在于当前 Chat 应用；不存在时停止，先完成该账号的 Chat 登录或账号导入
- 中心账号分别与两个测试伙伴建立双向好友关系
- 专属测试群以中心账号为群主，两个测试伙伴为成员
- 每个测试伙伴都与中心账号双向发送一条单聊消息
- 群消息由测试伙伴发送，确保中心账号登录后能直接看到

不得因为固定脚本更方便而退回只创建 `demo_alice` 与 `demo_bob` 之间的数据。

## 前置条件

- `TIM_SDKAPPID`
- 管理员账号，默认 `administrator`
- `TIM_SECRETKEY` 或已生成的 `TIM_ADMIN_USERSIG`，二选一
- 数据中心区域：`cn`、`sgp`、`kr`、`jpn`、`ger`、`usa`、`idn`、`ksa`
- 可以访问对应 REST API 域名

管理员 UserSig 只用于服务端 REST；客户端登录仍使用目标用户自己的 UserSig。

如果客户使用生产 SecretKey，允许继续，但在方案、执行确认前和完成后分别说明：这会在当前 Chat 应用中创建真实测试账号、好友关系、群聊和消息，重复执行会新增重复消息；客户端持有 SecretKey 可被提取，生产仍推荐服务端签发 UserSig。

## 面向客户的说法

以下问题、确认和授权都必须按主 `SKILL.md` 的“结构化提问与等待”发起；下面的文本作为工具问题参数使用，不得先写进普通正文后结束。

登录链路已经接好但聊天页面还没完成时，工具问题文本使用“要不要我帮你创建几个测试账号，再准备一些好友、群聊和消息？等聊天页面接好后就能直接体验。”

最小聊天链路完成后，工具问题文本使用“要不要我帮你创建几个测试账号，再准备一些好友、群聊和消息？这样你打开 App 就能直接体验聊天。”

根据当前进度二选一，主动只问一次。
邀请问题的选项为“现在准备（推荐）”和“暂不准备”。

客户同意后，预览确认使用：

有中心账号时，工具问题文本使用“我会以你当前使用的 `<userID>` 为中心，创建两个测试伙伴，让他们和你互加好友、加入一个专属测试群，再发送几条你登录后能直接看到的消息。现在开始吗？”

无自有账号时，工具问题文本使用“我准备创建 `demo_alice` 和 `demo_bob`，让他们互加好友、加入一个测试群，再发几条聊天消息。完成后我会继续协助你使用其中一个账号登录体验。现在开始吗？”

两种预览确认的选项均为“现在开始（推荐）”和“暂不开始”。

不得对客户使用“造数”“灌数据”“seed”“远端对象”“dry-run”“幂等”等术语。脚本名、参数名和内部实现可以保留技术名称，但解释与询问必须使用“测试账号、好友、群聊、消息、先看一下、开始创建”等简单表达。

## 选择脚本

AI 自行检测环境，按以下顺序选择第一个可用实现：

1. `python3 scripts/seed_demo_data.py`
2. `node scripts/seed_demo_data.js`
3. JDK 11+：`java scripts/SeedDemoData.java`
4. JDK 8：先编译到临时目录，再运行 `SeedDemoData`

三种脚本的参数、默认数据、步骤与检查结果必须一致，且只使用标准库。

## 固定流程

1. 先运行 `--self-test`，失败则停止。
2. 不带 `--apply` 运行；脚本只打印 host、参与账号、实际导入账号、下一步登录账号、好友方向、群主与成员、消息方向、五步 REST 计划和重复消息风险，零网络写入。
3. 把脚本预览转换成大白话展示给客户，明确列出将创建的测试账号、好友关系、群聊和消息；不要原样抛出内部术语。
4. 在同一回合按主 `SKILL.md` 的“结构化提问与等待”发起再次确认；不得默默停止，确认返回前不得执行写入。
5. 确认后用相同参数加 `--apply`。
6. 任一步主请求或检查失败立即停止，保留 `ErrorCode`、`ErrorInfo` 和步骤名。
7. 完成后汇总用户 ID、群 ID、成功步骤和客户端登录所需的下一步；不输出完整凭据。

客户最初说“直接执行”不能代替看到创建内容预览后的再次确认。

## 参数

三种脚本都支持：

- 环境变量：`TIM_SDKAPPID`、`TIM_SECRETKEY`、`TIM_ADMIN`、`TIM_ADMIN_USERSIG`、`TIM_REGION`、`TIM_CURRENT_USER`
- 命令行：`--sdkappid`、`--secretkey`、`--admin`、`--usersig`、`--region`、`--current-user`
- 模式：`--self-test`、默认预览、`--apply`

命令行参数覆盖环境变量。具体说明使用脚本 `--help`，不要在本 reference 复制完整参数手册。

```bash
python3 scripts/seed_demo_data.py --self-test
python3 scripts/seed_demo_data.py --current-user customer_8472
# 客户确认本次预览后：
python3 scripts/seed_demo_data.py --current-user customer_8472 --apply
```

客户没有可用的自有 Chat userID 时才省略 `--current-user`。

## 每步检查

- 有中心账号时：先确认中心账号为 `Imported`；导入测试伙伴后，`account_check` 返回三个参与账号均为 `Imported`
- 无中心账号时：导入后 `account_check` 返回两个体验账号均为 `Imported`
- 导入好友后：所有计划方向的 `friend_get_list` 都包含对方
- 建群后：`get_group_info` 返回目标群和预期成员数量；有中心账号时，`get_role_in_group` 确认中心账号是群主且两个测试伙伴都在群内；无中心账号时确认 `demo_alice` 是群主且 `demo_bob` 在群内
- 单聊后：每次 `sendmsg` 均成功并返回消息标识
- 群消息后：`group_msg_get_simple` 能找到本次消息

只有创建接口返回 `10025` 且群主、成员身份与本次计划完全匹配时才复用固定群。`10021` 表示群 ID 已被其他人使用，必须停止；其他错误也不能吞掉或继续下一步。

## 完成后的登录动作

- 使用中心账号：明确告诉客户继续使用该账号即可看到两个测试伙伴、专属群和消息。
- 使用默认体验账号：按主 `SKILL.md` 的“结构化提问与等待”让客户在 `demo_alice` 和 `demo_bob` 中明确选择下一步登录账号，并按客户工程现有登录链路取得该账号自己的 UserSig。需要修改登录配置或代码时，先给文件级方案并取得授权。
- 不得把管理员 UserSig 当作客户端用户 UserSig，也不得输出完整凭据。

## 官方接口

- [导入多个账号](https://cloud.tencent.com/document/product/269/4919)
- [查询账号](https://cloud.tencent.com/document/product/269/38417)
- [导入好友](https://cloud.tencent.com/document/product/269/8301)
- [拉取指定好友](https://cloud.tencent.com/document/product/269/8609)
- [创建群组](https://cloud.tencent.com/document/product/269/1615)
- [获取群详细资料](https://cloud.tencent.com/document/product/269/1616)
- [查询用户在群组中的身份](https://cloud.tencent.com/document/product/269/1626)
- [单发单聊消息](https://cloud.tencent.com/document/product/269/2282)
- [群内发送普通消息](https://cloud.tencent.com/document/product/269/1629)
- [拉取群历史消息](https://cloud.tencent.com/document/product/269/2738)
