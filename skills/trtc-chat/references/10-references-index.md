# 10 - References 自我导航索引

> dispatcher 不确定要读哪个 reference 时，先 `read_file` 本文件作为目录。

## 10.1 索引表

| 文件 | 何时读 | 主要内容 |
|---|---|---|
| `01-detect-project.md` | Step 1 探测开始 | 集成信号（`tuikit-atomicx-vue3`）/ platform / 风格 / session（session_context.chat） 探测细则 |
| `02-path-a-script.md` | 判断为路径 A | A.1 → A.5 完整脚本（项目概况反馈 / 凭据 / 基础功能 / 跑通 / 引导菜单） |
| `02-path-a-questions.md` | A.2 信息收集阶段 | 凭证/模式/功能勾选/客服号等所有结构化问答定义（Q.1-Q.3b）|
| `02-path-a-scaffold-template.md` | A.3.0.0 空目录建项目时 | 脚手架命令 / 依赖安装 / alias 配置代码块（由 A.3.0.0 按需读取） |
| `03-path-b-script.md` | 判断为路径 B | B.1 → B.5 完整脚本（项目概况反馈 / 听需求 / 命中 / 写代码 / 自检）|
| `04-path-c-script.md` | 判断为路径 C | C.1 → C.4 完整脚本（维护模式：减法/追问/排查/样式调整，不加载 slice）|
| `04-uikit-redirect.md` | 用户主动问 UIKit 边界 | 占位 + 统一回答模板 |
| `05-path-d-script.md` | 判断为路径 D（纯咨询/通用排障） | D.0 → D.8 完整脚本（无需项目上下文的轻量咨询）|
| `05-slice-loading.md` | 命中 slice / 多候选 / 兜底 | 命中流程 + 排序 + 未命中处理 |
| `06-hard-rules.md` | 写代码 / 自检前 | SDK API / UI 底线 / 增量安全的全量规则 + 反例 |
| `06-a-defensive-coding.md` | 写代码/自检前（与 06 并行读） | 防御编程统一规范（try/catch 范式 / 错误反馈形式 / 错误码映射 / 状态锁 / 入参校验）|
| `08-state-config.md` | 读写 session / **KB 路径（`tools.kb`）** | `.trtc-session.yaml` 字段 + `tools.session` API + §8.0 |
| `09-troubleshoot.md` | 用户报错 / 卡住（Path C C.3 或 Path D D.4f；直读时见文件内上报去重表） | 错误码 / 症状对照 / 求助话术模板。超出本表范围的错误码→转知识咨询流检索官方文档 |
| `10-references-index.md` | 不确定读哪个 | 本文件 |
| `11-what-to-do-next-template.md` | A.4 / B.5 收尾写集成指引 | WHAT-TO-DO-NEXT.md 模板 + 占位符 + 拼装规则 |
| `12-page-composition.md` | A.3 各轮写完后组合父组件 | Full Chat / Direct Chat 胶水层约束（状态中转 / 接线 / `:key` 规则）|
| `13-reporting.md` | 路径 A/B/C/D 执行边界 | Root `prompt`/`invoke` 与 Host Stop 的统一记录约定（Skill 不直接调用发送命令）|
| `14-official-docs.md` | 路径 C 知识咨询流 | 检索规则（平台探测/检索策略/知识边界/错误码匹配/置信度/反馈）|
| `python3 -m tools.kb resolve docs/chat/sdk/{platform}/index.md` | SDK 知识咨询 URL 数据 | 按平台分目录（web/android/ios），每个目录下 index.md 含 A-E 领域 URL 映射表 |
| `python3 -m tools.kb resolve docs/chat/uikit/{platform}/index.md` | TUIKit 组件知识咨询 URL 数据 | 按平台分目录（android/ios/flutter/uniapp/vue3/react），每个目录下 index.md 含组件 URL 映射表 |
| `python3 -m tools.kb resolve docs/chat/product.md` | 产品计费与配置 URL 数据 | 不分平台，所有平台共享 |
| `python3 -m tools.kb resolve docs/chat/restapi.md` | 服务端 REST API URL 数据 | 不分平台 |
| `python3 -m tools.kb resolve docs/chat/webhook.md` | 服务端回调 URL 数据 | 不分平台 |

## 10.2 决策树（dispatcher 自我导航）

```
当前在做什么？
├─ 刚开始一段会话 → read 01
├─ 探测结束，要分流 → read 02 或 03 或 04（按 Step 2 分流条件）
├─ 路径 A / A.3.0.0 空目录建项目 → read 02-path-a-scaffold-template
├─ 用户主动问 UIKit / 闭源 UIKit → read 04（uikit-redirect）
├─ 要在 slice 库里找匹配 → read 05（slice-loading）
├─ 准备写代码 / 自检 → read 06（hard-rules）+ read 06-a（defensive-coding，并行）
├─ 要写 / 读 session → read 08（state-config）；经 `tools.session`，禁止直接编辑 `.trtc-session.yaml`
├─ 用户报错 / 卡住 → read 09（troubleshoot）
├─ 用户咨询 SDK 知识（集成/登录/API/错误码）→ read 14（official-docs）规则 → 再 Bash `python3 -m tools.kb resolve docs/chat/sdk/{platform}/index.md` → Read 获取 URL
├─ 用户粘贴报错且无项目上下文 → read 05（path-d）
├─ A.4 / B.5 收尾要写集成指引 → read 11（what-to-do-next-template）
├─ A.3 写完要组合父组件胶水层 → read 12（page-composition）
├─ 需要执行上报 → read 13（reporting）
└─ 我也不知道 → 现在你已经在这里了
```

## 10.3 缓存策略建议

LLM 在一次会话中多次需要的：

- `06-hard-rules.md` —— 几乎每次写代码都要查，**首次加载后保留在上下文**
- `08-state-config.md` —— 写 state 时反复查 schema，**首次加载后保留**

只在特定分支用一次的：

- `02-path-a-script.md` / `03-path-b-script.md` —— 用完就放，下次会话再加载
- `04-uikit-redirect.md` —— 用户主动问 UIKit 边界才加载，否则不读
