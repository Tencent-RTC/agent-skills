# 集合内的会话与上报

本页只说明 HarmonyOS Chat 如何使用集合公共能力。业务 API 与构建步骤仍按对应 reference 执行，不新增发送器、Hook 或隐私文案。

## 身份与入口

- owner：`trtc-chat-ohos`（与 frontmatter 的 name 一致）。
- product：`chat`；platform / framework：`ohos`。HarmonyOS NEXT、OpenHarmony、鸿蒙 ArkTS 均使用该值，不写 `harmonyos` 或套用 `android`。
- 集合由相邻 Root `trtc/SKILL.md` 路由；首次集成按 Root §B 确认意图、完成 §B.2 SDKAppID 收集后进入。已有工程维护按 Root 的代码任务分支进入，保留可信会话上下文。
- SDKAppID 等待回复优先于 active / paused 恢复；已收集过时直接复用。纯 IM 概念、REST、计费、API 查询由 `trtc-chat/docs/SKILL.md` 回答，最终归因采用实际 owner，不创建集成会话。

## 共享会话

仅集合内的代码任务维护 `.trtc-session.yaml`。从当前 IDE 安装的 `trtc` 技能根目录运行工具，明确传客户工程路径：

```bash
python3 -m tools.session read --project-root "<projectRoot>" --field state_version
# 仅确认 MissingError 后创建；损坏或未知 schema 不覆盖
python3 -m tools.session create --project-root "<projectRoot>" --product chat --platform ohos
# 重新 read 得到 state_version N 后 CAS 写入；下面的 N 须替换为实际整数
python3 -m tools.session write-batch --project-root "<projectRoot>" --expected-version N \
  --updates '{"product":"chat","platform":"ohos","active_domain_skill":"trtc-chat-ohos","status":"active"}'
```

CAS 冲突重读并重试一次；仍失败保留原状态，不声称保存成功。不清空 `sdkappid`、`sdkappid_state`、凭据来源或其他任务状态，不把 session 写进技能安装目录。明确暂停时仅更新 `status=paused`；完成确认的业务范围并说明实际验证结果后更新为 `completed`。恢复代码任务时再设 `active`。

## 前台入口与最终归因

Host、Root、当前 owner 共用每轮一次 Prompt 入口及一次失败重试预算。已有本轮成功入口（包括 awaiting_consent、queued、acknowledged）直接复用，不为调整归因重报 Prompt。

尚未尝试入口时，按 Root §-1 将完整消息序列化为 JSON，经 stdin 交给共享 `tools/reporting.py prompt --input-stdin --require-input`，携带 `cwd`、实际 `ide`、`route_hint=trtc-chat-ohos`、`product=chat`、`framework=ohos`；原始消息不进入 shell argv。

当前 owner 实际执行业务后，在最终回答之前执行一次共享 postlude：

```bash
python3 tools/reporting.py invoke --skillname trtc-chat-ohos --product chat --framework ohos --ide <当前IDE>
```

Prompt、context 与 invoke 分开执行。已执行同轮 invoke 则复用结果；转交其他 owner 时使用实际最终 owner。收到 Runtime 展示标记后，下一条最终回复原文展示固定询问并结束当前回合，等待真实用户回复；不能接着进行 Skill 交接、业务提问或调用业务工具，也不能等整套接入/审批结束才展示。唯一例外是为获取固定文案而读取 continuation-notice.md。同意或拒绝保存成功后，按 Root 恢复原业务任务；不重复上报原请求或控制回复。提醒次数用尽后仍未同意则继续业务且不上报，不无限等待；Stop 不能替代前台展示。

## 隐私与验证边界

明确同意前只暂存首条脱敏 Prompt，不上报体验数据、不扫描 SDKAppID 用于上报、不保留其他待补发 Prompt。未回答 / 模糊回复保持关闭，只有 Runtime 要求时才提醒，最多共两次展示。明确同意后释放原首条事件并保留 event_id，后续 Prompt 正常发送；明确拒绝清除待同意体验数据。控制回复从不上报。

业务使用的 SDKAppID 不等于遥测同意。Root 已确认的 SDKAppID 可供登录使用；是否附加到遥测由共享门禁决定。体验拒绝不影响安装 / Hook 统计；明确关闭全部上报才关闭全部通道。

CLS 字段预期：`method=prompt`、`level=trtc-chat-ohos`、`type=chat`、`framework=ohos`。`sdkappid` 只有来源合法且已同意时才出现。`queued` 仅代表持久化；对应事件 ACK 才能确认服务端接收。安装 / Hook 事件不能替代 Prompt 验收。

维护者在集合根运行 `npm run test:chat-ohos`、相关上报回归及同一 tarball 的四 IDE 安装协议测试。内部测试位于顶层 `tests/trtc-chat-ohos/`，不随 Skill 安装。真实 IDE 展示、模型路由和 DevEco / hvigor 构建分别记录，不能用协议测试代替。
