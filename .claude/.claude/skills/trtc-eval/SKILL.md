---
name: trtc-eval
description: >
  Evaluates the quality of the trtc skill and its knowledge base by
  running AI-generated code against a curated eval set and scoring both
  static constraint compliance and runtime SDK behavior. Use when the
  user mentions 跑分, 评测, eval, benchmark, 回归, quality check, or
  asks to compare skill versions. Internal-only tool for TRTC knowledge
  maintainers.
---

# TRTC 评测工具

## 触发条件
- 用户 prompt 中出现：跑分 / 评测 / eval / benchmark / 回归 / 看看效果 / 质量对比
- 如果含过滤条件（如 "只跑 iOS 的"、"只跑 smoke"），记录下来并在 Step 1 应用到用例筛选

## 执行步骤（你，主 Agent，严格按顺序执行）

> **工作目录**：所有 `python scripts/...` 命令都从本 skill 目录运行。开始前先 `cd .claude/skills/trtc-eval/`（脚本通过 `__file__` 解析 skill_root，所以 cwd 实际不影响数据路径，但保持习惯让命令简短）。
> **eval-runs 路径**：每次运行的产物落在仓库根的 `.claude/eval-runs/{ts}/`，不在 skill 目录里。下面示例统一用相对 skill 目录的 `../../../.claude/eval-runs/{ts}` 表示。

### Step 1：加载 eval set

- 执行 `python scripts/selfcheck.py --phase=pre-run` 校验环境
  - 校验失败 → 停止，把 selfcheck.json 摘要给用户，让用户修
- 读取 `tests/benchmark/cases.json`
- 按用户过滤条件筛出要跑的用例列表
- 创建本次运行目录 `../../../.claude/eval-runs/{ISO8601}/`，写 run.manifest.json

**必须产出的证据（缺一不可）：**
- [ ] selfcheck pre-run 输出 `passed=true`（附 selfcheck.json 中 checks 全部 ok）
- [ ] run.manifest.json 已写入且 `case_count > 0`
- [ ] eval-runs/{ts}/ 目录已创建

⛔ **门控规则**：
- selfcheck 任何一项 check.ok=false → **立即停止**，不得进入 Step 2
- case_count == 0（筛选后无用例）→ 告知用户筛选条件无匹配，不进入 Step 2
- "我先跑着，selfcheck 的 warning 之后再修" ← 这个想法是错的。修完再跑

---

### Step 2：串行调用 orchestrator 跑每条用例

对筛出的每条用例（**串行，不并发**），用 `execute_command` 工具调用 orchestrator：

```bash
python scripts/case_runner_orchestrator.py \
  --case-id={test_id} \
  --run-dir=../../../.claude/eval-runs/{ts}
```

**关键约束**：
- 一次只跑一条用例，串行执行（首版避免并发导致真机资源冲突）
- orchestrator 内部串联 7 个步骤（run_ai → evaluator → demo_build → log_stream_start → demo_run → log_stream_stop → runtime_monitor），它是 `trace.jsonl` 的唯一写入者
- orchestrator 的 stdout 只输出**一行 JSON**：`{"test_id":"...","exit_code":0,"summary_path":"<相对路径>"}`。你只读这一行即可。
- **绝对不要 `cat` 或读取** `ai_raw_output.md` / `runtime.log` / `compile.log` —— 这是上下文污染源。
- 如果你需要看分数，**只读** `{run_dir}/cases/{test_id}/summary.json`。

**必须产出的证据（每条用例）：**
- [ ] orchestrator stdout JSON 已捕获（含 test_id + exit_code + summary_path）
- [ ] summary.json 已读取且包含 final_score 和 passed 字段

⛔ **门控规则**：
- orchestrator exit_code != 0 → 记录失败但继续下一条（单条失败不阻塞整体）
- **失败升级触发**（见下方「失败升级协议」）：连续失败达到阈值 → 暂停或终止

---

### Step 3：汇总 & 出报告

- 所有用例跑完后，执行 `python scripts/report.py build --run-dir=../../../.claude/eval-runs/{ts}`
- （可选）如果用户要求 diff：`python scripts/report.py diff --baseline=<旧 run_dir> --current=<新 run_dir>`
- 执行 `python scripts/selfcheck.py --phase=post-run --run-dir=../../../.claude/eval-runs/{ts}` 再次自查
- 把 `report.md` 路径和 `selfcheck.json` 中的 `verdict` 字段一起给用户

**必须产出的证据：**
- [ ] report.md 文件存在且非空
- [ ] selfcheck post-run 的 `verdict` 字段值（OK 或 TAINTED）
- [ ] scoreboard.csv 行数 == run.manifest.json 中的 case_count

⛔ **门控规则**：
- verdict == TAINTED → 必须在报告中**醒目标注**结果不可信，告知用户哪些 Gate 失败
- 不得在 verdict=TAINTED 时说"评测完成"——应说"评测完成但结果存疑，详见 selfcheck"
- Step 3 完成后，如果有失败 case（failed > 0），继续执行 Step 4（Badcase 根因分析）

---

### Step 4：Badcase 根因分析

**触发条件**：Step 3 完成后，如果存在失败 case（failed > 0），自动执行本步。全部通过则跳过。

**执行方式**：主 Agent 通过 `Agent` 工具 spawn 一个子 Agent 执行分析。**主 Agent 不亲自读取任何 artifact 文件**——这是铁律 #1 的延伸：分析工作全部委托给子 Agent，子 Agent 有独立上下文，不会污染主 Agent。

**子 Agent prompt 模板**（主 Agent 用实际值替换 `{变量}` 后发给子 Agent）：

> 你是 TRTC 评测 Badcase 分析器。请分析本轮评测中所有失败 case 的根因，输出结构化报告。
>
> **评测目录**：`{run_dir}`
> **失败 case 列表**：{failed_case_ids}（从 report.md 中提取）
> **知识库根目录**：`{repo_root}/knowledge-base/`
>
> **对每条失败 case，依次执行：**
>
> 1. 读取 `{run_dir}/cases/{case_id}/summary.json` — 获取 failure_reason、static_result、dynamic_result
> 2. 读取 `{run_dir}/cases/{case_id}/compile.log` — 获取具体编译错误（仅 compile_fail case）
> 3. 读取 `{run_dir}/cases/{case_id}/ai_raw_output.md` — 获取 AI 生成的代码（只看出错的关键片段）
> 4. 读取对应的知识库 slice（根据 summary.json 中的 ability 字段定位）：
>    - 产品级：`knowledge-base/slices/{product}/{ability_name}.md`
>    - 平台级：`knowledge-base/slices/{product}/{platform}/{ability_name}.md`
> 5. 交叉比对：AI 代码错在哪 vs 知识库教了什么 vs SDK 真实类型（从编译错误推断）
>
> **根因归类标准**：
> - **知识库 slice 错误**：slice 中的代码示例与 SDK 真实类型不符（如参数名错误、使用字符串而非枚举）
> - **知识库 slice 缺失**：slice 未提供足够信息（如未说明返回值类型、未给出枚举导入方式）
> - **AI 推理错误**：知识库正确，但 AI 臆造了不存在的 API 或从错误来源解构
> - **外部因素**：skill 加载失败、依赖缺失等非知识库问题
>
> **输出文件**：`{run_dir}/{run_name}Badcase.md`
>
> **输出格式**：
> ```
> # {run_name} Badcase 分析报告
>
> ## 概述
> （总用例 / 失败 / 通过率 / 编译错误分类统计 / 根因归类统计）
>
> ## 错误模式分类
> （聚类相同根因的 case，每个模式说明涉及的 case、根因、修复建议）
>
> ## 逐 Case 详细分析
> ### {case_id} ({ability})
> - **编译错误**：
> - **AI 生成的关键代码片段**：
> - **知识库 slice 原文**：
> - **根因**：
> - **修复建议**：
>
> ## 修复优先级
> （按影响面降序的修复清单，标注 P0/P1/P2/P3）
>
> ## 总结
> ```

**必须产出的证据：**
- [ ] `{run_dir}/{run_name}Badcase.md` 文件存在且非空
- [ ] 报告中覆盖了所有失败 case（逐 Case 分析数量 == 失败 case 数量）

⛔ **门控规则**：
- 子 Agent 分析过程中读取的文件（compile.log、ai_raw_output.md 等）不会进入主 Agent 上下文，这不违反铁律 #1
- 如果子 Agent 执行失败或超时，记录失败但不阻塞收尾流程——Badcase 分析是增值环节，不是门控环节
- 主 Agent 只读取最终的 `{run_name}Badcase.md` 向用户汇报路径，不读取中间 artifact

---

## 你（主 Agent）的铁律

> **类别说明（重要）**：以下 4 条是 **Prompt 软约束**，依赖 LLM 自觉遵守。
> 真正的结构防御在 orchestrator 独家写 trace、nonce 校验和 AST 扫描。
> 这一段的违反**不会**让 selfcheck 自动判 TAINTED，只会被事后审计登记。

1. 你**只读 `run.manifest.json`、每条用例的 `summary.json`、最终 `report.md`**。其它 artifact 不读
2. 任何时候需要"看看代码是否对"→ 你都应当调脚本，不亲自判
3. 禁止在主 Agent 上下文中执行评分公式（所有公式在 evaluator.py / runtime_monitor.py 里）
4. 禁止 mock 数据 —— 如果某步失败，把失败透传给报告，不要编造

---

## 合理化防火墙（机制13）

以下借口全部拒绝。**本流程没有有效的例外。没有。零个。**

| # | 你可能在想... | 为什么这是错的 | 你必须做 |
|---|---|---|---|
| 1 | "这个 case 失败了，我看看 ai_raw_output.md 看看哪里写错了" | 读 ai_raw_output.md 会导致上下文污染（~3000-8000 tokens），且人工判断代码质量不是你的工作。一旦你读了，后续 case 的解析准确度会下降 | 只读 summary.json。如需诊断，告诉用户自行查看 artifact 目录 |
| 2 | "compile.log 很短，看一眼应该没事" | 规则是绝对的，不分长短。一旦开了口子，你会不自觉地越读越多。每个文件都是潜在的上下文膨胀源 | 调 selfcheck 脚本。不自己看日志 |
| 3 | "这个 case 分数很低，让我重新跑一遍应该能好点" | 同样输入 + 同样知识库 = 几乎相同输出（LLM 温度接近 0）。低分说明知识库有 gap，重跑只是浪费时间 | 如实报告低分。在 report.md 的 errata 中标注 |
| 4 | "只有一条 case，不需要走完整 Step 1/2/3" | 即使一条 case 也必须走 selfcheck + orchestrator + report 全流程。跳步 = 无法审计 = 结果不可追溯 | 走完整三步流程。没有捷径 |
| 5 | "selfcheck 报了个 warning 但不影响跑分" | selfcheck 的每个检查都有存在的理由。warning 今天不影响，明天可能导致 TAINTED。忽略 warning = 积累技术债 | 修复 warning 再继续。或者明确告知用户有未解决的 warning |

如果你发现自己正在生成一个"为什么可以跳过某步"的理由：
→ 那个理由本身就是红旗
→ 你想跳过的那个步骤恰恰是你最需要的
→ 执行表格最右列的"必须做"动作

---

## 🚩 红旗思维拦截（机制14）

### 以下想法 = 你正在犯错 = 立即停止

💭 "让我帮用户改一下 cases.json 让分数高一点..."
   → **停**。你在作弊。cases.json 是测试集，不是优化目标。测试集独立于被测对象。

💭 "这个 case 的 must_include 设计得不合理，我跳过它..."
   → **停**。你不是 case 的裁判。case 设计问题应该在评测完成后作为反馈提出，不是在评测中跳过。如实跑，如实报。

💭 "orchestrator 报了个错但分数算出来了，应该没问题..."
   → **停**。有错误 = 结果不可信。检查 trace.jsonl 的对应步骤。错误可能导致上游数据缺失 → 下游评分偏高（假通过）。

💭 "我手动算一下分数应该是..."
   → **停**。铁律第 3 条：禁止在主 Agent 上下文中执行评分公式。所有公式在 evaluator.py / runtime_monitor.py 里。你的"手算"可能漏掉权重、阈值、健康惩罚等因子。

### 拦截后的强制动作

发现自己产生了上述任何想法：
1. 立即停止当前操作
2. 识别你正在试图跳过什么
3. 回到流程中被跳过的那个步骤
4. 从那里重新开始

---

## 失败升级协议（机制11）

### 连续失败计数规则

在 Step 2 的串行循环中，维护一个失败计数器。每条 case 完成后：
- exit_code == 0 → 计数器归零
- exit_code != 0 → 计数器 +1，记录失败类型

### 升级阶梯

| 阈值 | 触发条件 | 动作 |
|------|----------|------|
| **2 次连续编译失败**（同平台） | orchestrator exit_code == 2 连续出现 2 次，且 case 平台相同 | **暂停**。运行 `selfcheck --phase=pre-run` 重新检查环境。报告给用户："连续 2 个 {platform} case 编译失败，可能是模板过期或依赖缺失。建议运行 `./bootstrap.sh` 后重试" |
| **3 次连续 CLI 超时** | orchestrator exit_code == 124 连续出现 3 次 | **终止整个 run**。不再继续后续 case。报告给用户："CLI 连续超时 3 次，可能是网络问题或 AI CLI 认证过期。请检查 `claude --version` 和网络连接" |
| **全部 dynamic_score == 0** | Step 2 全部完成后，检查所有 summary.json 的 dynamic_result.score，若全部为 0 | **不出最终 pass/fail 结论**。报告给用户："所有 case 的动态评分为 0，这几乎确定是运行环境问题（模拟器/设备/puppeteer），不是知识库质量问题。请检查设备状态" |

### 关键判断

如果连续失败发生在**不同 case 但相同模式**（如所有 iOS case 都编译失败、所有 web case 都超时）：
→ 这几乎确定是环境/工具链问题，不是单个 case 的代码质量问题
→ 停止修补症状（不重跑），报告根因诊断

### 绝对禁止
- 第 4 次、第 5 次继续跑同类型失败的 case（3 次就是上限）
- "再试一次，这次应该可以了"（连续超时 = 系统性问题，不是运气）
- 不升级直接跳过失败的 case 继续跑后面的（跳过可以，但计数器不归零）

---

## 🔒 验证门（机制16）

### 协议（5 步，全部强制）

1. **识别**：我即将声称什么？（例如："所有 case 跑完了"、"评测结果可信"）
2. **确定命令**：什么命令能证明这个声明？
3. **执行**：全新运行该命令（不是从记忆中、不是从之前的输出）
4. **阅读**：完整读取输出（包括退出码）
5. **确认**：输出是否支撑我的声明？是 → 附带证据。否 → 修复后重新验证

### 本技能的验证清单

| 声明 | 验证命令 | 通过标准 |
|---|---|---|
| "所有 case 跑完了" | `ls ../../../.claude/eval-runs/{ts}/cases/*/summary.json \| wc -l` | 数量 == run.manifest.json 中的 case_count |
| "评测结果可信" | `python scripts/selfcheck.py --phase=post-run --run-dir=...` | exit code 0 且 verdict=OK |
| "报告已生成" | `test -f ../../../.claude/eval-runs/{ts}/report.md && wc -c < report.md` | 文件存在且字节数 > 100 |
| "Badcase 分析已完成" | `test -f ../../../.claude/eval-runs/{ts}/{run_name}Badcase.md && wc -c < ...` | 文件存在且字节数 > 200（无失败 case 时可跳过） |

### 禁止的语言（没有验证证据时）

以下词汇在没有运行验证命令前**绝对禁止使用**：
- "评测完成了" / "跑完了" / "搞定了"
- "结果没问题" / "应该是可信的"
- "所有 case 都通过了"（没有数 summary.json 就不知道有几个通过）
- "分数是 X"（没有读 report.md 就不知道分数）
- "我确认过了"（没有命令输出 = 没有确认过）

### 要求的语言格式

✅ 正确："评测完成。selfcheck post-run verdict=OK。12 条 case 中 10 条通过，2 条失败。详见 report.md: `{path}`"
✅ 正确："评测完成但结果存疑。selfcheck verdict=TAINTED，Gate B nonce_present 检查失败。建议检查模板是否正确输出 EVAL_RUN_NONCE"

❌ 错误："评测跑完了，看起来还行。"（没有附带任何证据）
❌ 错误："应该都通过了。"（"应该" = 红旗词）

### 反替换规则（机制 16 补充）

> **背景**：曾发生过 AI 正确执行了验证命令（输出 `user_id: kra`），但在写摘要表格时从上下文旧记忆中取了 `krab`。命令跑了，证据对了，转述错了。

**根因**：上下文窗口同时存在新值和旧值时，LLM 在生成摘要时可能采样到高频出现的旧值（stale context substitution）。

**规则**：

1. **引用 evidence_block，不要重组**：selfcheck pre-run 输出包含 `evidence_block` 字段，其中有所有凭证的原值（sdk_app_id、user_id、sig_fingerprint、sig_identifier、sig_expires、identity_match）。向用户报告时**直接引用 evidence_block 中的值**，不要从上下文记忆中拼凑
2. **逐字复制，标注来源**：如果必须从命令输出中提取具体值（user_id、分数、路径等），从**最近一次**命令输出中逐字复制，并标注来源：「evidence_block.user_id="kra"」
3. **自检方法**：写下一个具体值后，问自己：这个值出现在我刚执行的命令输出的哪一行？如果答不上来 → 你可能在用记忆而不是输出 → 重新执行命令
4. **高危场景**：同一字段在上下文中出现过多个不同值时（如 user_id 在历史日志中是 A，在 config.json 中是 B），**必须**明确标注值的来源

---

## 结构化收尾（机制9）

### 评测完成后的收尾流程（Step 4 之后执行）

#### 第一步：环境清理

- 检查是否有残留的 `runtime.log.pid` 文件，对应进程是否仍在运行
  - 如果进程仍在 → 发送 SIGTERM
- 如果本次 run 使用了模拟器且用户未指定保留 → 提示用户是否关闭模拟器

#### 第二步：向用户展示后续选项

报告给用户后，提供以下选项（不主动执行，等用户选择）：

| 选项 | 命令 | 适用场景 |
|------|------|---------|
| 对比上次 run | `python scripts/report.py diff --baseline=<旧> --current=<新>` | 有历史 run 时 |
| 查看 Badcase 分析 | `cat {run_dir}/{run_name}Badcase.md` | 有失败 case 时（Step 4 产出） |
| 查看错题本 | `cat {run_dir}/errata.md` | 有失败 case 时 |
| 清理本次产物 | `rm -rf {run_dir}` | 用户确认不再需要 |
| 保留并结束 | （无操作） | 默认选项 |

#### 第三步：不主动追问

评测报告交付后，**不要**问"还要做什么？"。用户会在需要时继续对话。

---

## 失败记忆（机制15）

### 这些规则为什么存在

以下每条规则都对应一次真实的失败场景。这些不是假设——它们是从实际运行中总结的经验。

| 规则 | 对应的失败事件 | 造成的损失 |
|---|---|---|
| **只读 summary.json**（铁律 #1） | 曾读了 ai_raw_output.md（7000 tokens），注入上下文后导致后续 case 的 orchestrator stdout JSON 解析出错（被上下文中的旧 JSON 干扰） | 整个 run 的后半段结果不可信，浪费 30+ 分钟重跑 |
| **selfcheck 不可跳过**（门控规则） | 跳过 pre-run 直接跑，结果发现 UserSig 已过期（config.json 中的签名有效期已过），所有 case 的 runtime.log 为空，动态评分全部为 0 | 浪费 45 分钟真机运行时间，产出了一份全是 0 分的误导性报告 |
| **orchestrator 是唯一 trace 写入者** | 早期设计中让子脚本各自写 trace.jsonl，并发写入导致 JSON 行交错损坏 | selfcheck Gate C 判定所有 case TAINTED，等同于整个评测基础设施不可信 |
| **引用 evidence_block，不要重组**（反替换规则） | AI 执行 selfcheck 输出 `user_id: kra`，但在写摘要表格时从上下文旧记忆（v2 runtime.log 中的 `krab`）中取值，向用户报告了错误的 user_id | 用户无法信任 AI 报告的任何具体字段值；如果 user_id/sig 错配未被发现，会导致整轮评测 login 全部失败 |
| **identity_match 校验**（creds_identity_match） | config.json 的 user_id=`kra` 与 UserSig 内嵌的 TLS.identifier=`krab` 不一致，但旧版 selfcheck 没有交叉校验，导致用错配的凭证跑完整轮评测才在 runtime.log 中发现 | 20 条 case 全部 login 失败（`UserSig 已过期` 或身份不匹配），动态评分全部为 0 或极低 |

### 结论

上面的每条规则都是用真实的时间浪费换来的。
跳过任何一条 = 愿意再经历一次上述事故。

当你觉得某条规则"多余"或"这次可以跳过"时：
→ 回来读一遍对应的失败事件
→ 问自己：我愿意承受同样的后果吗？
→ 如果不愿意 → 遵守规则
