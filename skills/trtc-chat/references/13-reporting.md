# 13 - 统一记录约定（Path A / B / C / D 共用）

## 生产路径

本文件遵循 `../../trtc/SKILL.md` §-1 的共享 Host/Root 契约。Root Dispatcher + Node Runtime 是唯一生产上报链路；Path A/B/C/D 只维护业务 session 和回答内容，不另建 Prompt、归因或路径事件。

1. **共享一次前台入口**：由 Host 执行 `prompt --input-stdin --require-input`。若本轮已尝试过该入口，Root / Path A/B/C/D 复用结果、原事件和剩余重试预算；普通 stdout 为空也不代表没有执行。只有直接进入且本轮尚未尝试前台入口时，才按 Root §-1 补偿。Hook 本地暂存不能替代该前台入口。
2. **明确同意后才上报**：未同意时只脱敏暂存首条，不上传提示词、SDKAppID 或接入体验数据，不补报其他未同意回合；拒绝、模糊回复和继续使用都不构成同意。安装及 Hook 统计沿用独立规则，全局关闭仍生效。
3. **共享一次最终归因**：读取最终 owner 并完成业务工作、准备好正常回答后，由当前 Agent 按共享契约执行一次最终 owner `invoke`。归因使用实际执行的 owner frontmatter name；进入子 flow、Path D 或返回 Root 都不再新建调用。没有实际 owner 的澄清或控制回合不虚构 owner。路由中的 Read / STOP 只结束路由匹配，不取消这一共享后置步骤。
4. **前台展示提示**：收到 `TRTC_REPORTING_NOTICE_REQUIRED_V1` 时，在最终业务回答末尾原样附加 `<当前 trtc skill 目录>/runtime/continuation-notice.md` 的对应语言文案。交接时保留本轮待展示要求，不重新领取提示，不等待 Host Stop。Stop 只补发、恢复已授权事件，不展示隐私询问。
5. **控制回复优先**：仅在可见的有效隐私询问上下文中识别同意、拒绝、模糊回复；通过包含 `text` 的完整 stdin envelope 处理，控制回复不进入业务路由或普通 Prompt 上报。仅在返回对应确认 marker 后确认选择已记录。

动态澄清前沿用共享 `context --question`；固定选项继续按业务流程使用宿主结构化提问工具。辅助步骤失败不重新提交 Prompt，也不阻塞正常业务；未确认的发送或隐私选择不得说成成功。

## 字段与 SDKAppID

- Prompt 原文只通过 JSON 序列化后的 stdin 交给共享 helper，不拼入命令参数、环境变量或项目临时文件。
- product / framework / owner 的归因以及会话绑定、SDKAppID 授权、脱敏、去重、队列和 ACK 都由 Root/Node Runtime 负责；业务 Path 不手工构造 payload 或轮换会话 ID。
- SDKAppID 未知时省略，不写 `0`；拒绝体验上报时，不为遥测扫描或发送 SDKAppID。
- 唯一的显式 SDKAppID 采集例外是共享 `capture-sdkappid` helper：仅在 domain fallback 首次收到用户明确提供的 ID 且成功保存后调用；复用 root 已收集的 ID 时不重复采集。该 helper 同样遵守隐私门禁，上报失败不影响集成。

## 对外表达与旧路径

正常业务回答无需解释内部 event、payload 或路径节点。隐私询问、用户的关闭请求和选择确认必须如实处理，不受“禁止提及上报”的旧文案约束。

Path A/B/C/D 不再把上报 Bash 当作每个业务阶段的 postcondition，也不通过修改问答 YAML 触发发送。不得执行旧的 `send`、`send-query`、`send-docs-query`、`skill_start`、`slice_done` 等独立上报路径；按统一链路维护本轮唯一事件。
