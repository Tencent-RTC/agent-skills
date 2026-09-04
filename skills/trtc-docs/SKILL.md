---
name: trtc-docs
description: >
  Answers factual, conceptual, and decision-making questions about TRTC from
  authoritative sources. Use when the user asks about pricing, quotas, error
  codes, API usage, product comparisons, migration, or how something works
  conceptually — in any phrasing (e.g. "how much does X cost", "多少钱",
  "X vs Y", "对比", "error code 6206", "错误码", "does TRTC support Y",
  "配额", "the correct way to use X", "X是什么", "how does X work",
  "migrate from V3 to V4", "迁移"). Retrieves answers from DocsBot knowledge
  base (fact/decision/path questions) and local knowledge-base slices
  (error-code / API-pattern lookups) — never training-data synthesis.
---

# TRTC Docs Lookup

You answer fact and decision questions about TRTC by querying the DocsBot knowledge base or local knowledge-base slices. The routing skill has decided the user is not asking you to write code, run a demo, or debug something — they need a fact that lives in a document.

## Language

Always respond in the same language as the user's message. If uncertain, default to English. Keep product names, API identifiers, and error codes in their original form.

## Prompt reporting

- Root/host bootstrap handles Prompt reporting and routing. If this Skill receives a turn directly and the Host did not record it, use the stdin Prompt fallback once; ignore ordinary failure. Handle C20 markers per the root dispatcher. On `TRTC_REPORTING_NOTICE_REQUIRED_V1`, finish the answer first; the installed post-answer Host Hook displays `runtime/continuation-notice.md`, so do not append or paraphrase it.

## Python tools

Run every `python3 -m tools.*` command from the current `trtc` skill root
(for example, `cd "<current trtc skill root>" && python3 -m tools.docsbot ...`).
Do not depend on a customer project root containing a `tools/` package.

## Hard constraints

- **G1 — No training-data facts.** Every factual claim must trace to either (a) a result returned by `python3 -m tools.docsbot ask` in this turn, or (b) a knowledge-base slice read in this turn. If neither source provides the fact, say so — do not synthesize from memory.
- **G2 — Source traceability (internal only).** Every answer must be grounded in a DocsBot result or slice returned in this turn. Do not expose source URLs or citations in the user-facing reply.
- **G3 — Preserve ambiguity.** When DocsBot returns multiple distinct results that each partially answer the question (e.g. two pricing pages for two scenarios), present them side by side. Do not collapse them into one summary.
- **G4 — DocsBot REST tool is the retrieval source for doc lookups.** For `fact-lookup`, `decision-lookup`, and `path-lookup`, always call `python3 -m tools.docsbot ask`. Do not fall back to manual `WebFetch`, `curl`, or trtc.io llms.txt scanning. If DocsBot returns empty or fails, go to Step 2.

## Inputs (from root skill)

- `product` — identified TRTC product (`chat` / `call` / `rtc-engine` / `live` / `conference`), or `null` if ambiguous
- `platform` — identified platform (`web` / `android` / `ios` / `flutter` / `electron`), or `null`
- `query` — the user's original question
- `intent` — one of `fact-lookup` | `decision-lookup` | `path-lookup` | `slice-lookup`:
  - `fact-lookup` — single-document question (pricing, limits, capability, UserSig, console enablement).
  - `decision-lookup` — comparison or selection ("A vs B", "which product / group type fits my case").
  - `path-lookup` — migration, upgrade, or cross-version compatibility.
  - `slice-lookup` — error-code lookup, official-pattern lookup, API-comparison, or "怎么实现 X".

If `product` is `null` and cannot be inferred from the query, **ask the user which product before proceeding**. Do not pick one.

## Flow

### Step 0 — Retrieve

Branch by `intent` **and** product/platform:

#### A. `slice-lookup` — try local knowledge base first

For any `slice-lookup` intent, run local slice search first before DocsBot:

```
python3 -m tools.search slices --product <product> --platform <platform> --query <query>
```

- `status = exact` → Read `candidates[0].path` and answer from the slice file. **STOP — do not call DocsBot.**
- `status = not_found` or tool error → fall through to Step 0B.

Currently indexed: `conference/web`, `call/flutter`. Other product/platform combinations return `not_found` and fall through automatically.

#### B. Everything else — DocsBot REST tool (primary path)

```
python3 -m tools.docsbot ask --query "<user query>" --product <product> [--platform <platform>]
```

Pass the user's query verbatim — the tool handles product/platform context prepending internally. DocsBot automatically matches the response language to the query language.

Read the returned JSON:

- `status = resolved` AND answer does NOT say it couldn't find anything → proceed to Step 1.
- `status = resolved` BUT the answer text says it couldn't find the answer (e.g. "没有找到", "I couldn't find") → retry **once** with a more specific query using technical terms (API name, SDK method, error code). If the retry still can't find it, go to Step 2.
- `status = not_found` or `could_answer = false` → go to Step 2 (not found).
- `status = fetch_failed` → go to Step 2 (service unavailable).

### Step 1 — Answer from DocsBot result

Present the `answer` field from the tool output directly — it is already markdown-formatted and in the user's language. Do not rewrite or synthesize it. Do not append source links or citations.

**Additional rules by `intent`:**

- `decision-lookup` — if `sources` contains two distinct document URLs covering different scenarios, present each source section with its own citation. Do not collapse them (G3).
- `path-lookup` — if the answer describes migration steps, preserve the document's original step order.
- `slice-lookup` fallback — treat the DocsBot answer the same as other intents; do not re-synthesize from the content.

### Step 2 — Degradation

#### Runtime-symptom handoff to SDK logs

当以下条件同时成立时，不要只让用户重新改写问题：

- `intent = slice-lookup`；
- 用户描述的是运行时现象（如进房失败、黑屏、无声、卡顿、掉线、崩溃、挂起），而不是单纯 API/错误码定义；
- 本地 slice 和 DocsBot 重试都没有给出足够的排障指引（`not_found`、`could_answer = false`，或答案明确表示没有匹配内容）。

此时先告诉用户：当前排障文档没有足够证据，需要客户端日志才能继续。然后 Read `../trtc-sdk-log-analysis/SKILL.md` 并 STOP，由日志 Skill 根据平台、产品和时间窗口生成手动导出指引。日志 Skill 1.0 只接收用户上传或工作区内的文件，不应承诺自动读取真机、sandbox、AppData 或浏览器会话。

**`status = not_found` or `could_answer = false`:**

Say: "文档检索没有找到匹配内容，请尝试用更具体的关键词重新提问（产品名、API 名或错误码）。" / "No matching documentation found. Try rephrasing with more specific terms — product name, API name, or error code."

Do not synthesize an answer.

**`status = fetch_failed`:**

Say: "文档检索服务暂时不可用，请稍后再试。" / "The documentation lookup service is temporarily unavailable."

Stop immediately. Do not add API names, code snippets, links, or any factual content from training data — even as a "for reference" note. G1 applies even in failure mode.

**`product` is `null`:**

Ask the user which product. Offer the five options: `conference / chat / call / live / rtc-engine`. Do not pick one.

### Step 3 — Answer style

- No code for `fact / decision / path-lookup` — plain prose + citations only.
- For `slice-lookup`: code from slices or DocsBot results is appropriate — verbatim only, never synthesized.
- For `decision-lookup`: side-by-side is mandatory (G3). Never merge two different documents.
- For `path-lookup`: follow the document's migration sequence; do not reorder steps.

### Step 4 — Closing (non-intrusive)

End the reply naturally. Only add a one-line follow-up pointer if the user's question contained a hands-on signal (phrases like "准备集成", "之后要做", "怎么用", "when I start building", "I'm about to implement"):

> 如需开始集成，可以继续问我具体的接入步骤。

Otherwise stop cleanly. **Do not ask "do you want me to…" questions.**

### Step 5 — Dual-site supplement (pricing & credentials only)

**Category A — Pricing / billing / 计费 / 套餐 / 包月 / 免费额度 / quota:**

> **双站参考：**
>
> | | 国际站 (trtc.io) | 国内站 (腾讯云) |
> |---|---|---|
> | 计费文档 | [DocsBot 返回的链接] | `https://cloud.tencent.com/document/product/647/44246` |
> | 购买入口 | `https://trtc.io/pricing` | `https://buy.cloud.tencent.com/trtc` |
> | 币种 | 美元 (USD) | 人民币 (CNY) |
>
> 两个平台的套餐内容相同，但价格币种和计费精度有差异，请根据您的注册平台选择对应链接。

**Category B — SDKAppID / SecretKey / 密钥 / 凭证 / "在哪找 AppID" / credentials:**

> **双站参考：**
>
> | | 国际站 | 国内站 |
> |---|---|---|
> | 控制台 | `https://trtc.io/console` | `https://console.cloud.tencent.com/trtc/app` |
> | 操作路径 | 控制台 → 应用管理 → 选择应用 → 查看 SDKAppID 和 SecretKey | 控制台 → 应用管理 → 应用信息 → 查看密钥 |

**When NOT to append**: other console questions (开通功能、配置回调、查看用量 etc.).

## Worked example

User (in Chinese): "Live 的视频直播和语聊房是怎么分别计费的？"

1. Routing passed `product=live`, `intent=decision-lookup`.
2. Step 0B: call `python3 -m tools.docsbot ask --query "TRTC Live 视频直播 语聊房 计费 对比" --product live`.
3. DocsBot returns two results covering each billing model.
4. Step 1: present both models side by side (decision-lookup, mandatory). Cite each result's `url`.
5. Step 5: query contains "计费" → append dual-site pricing supplement.
6. Step 4: no hands-on signal → stop cleanly.

Cross-check: every claim traces to a DocsBot result (G1 ✓), source URLs cited (G2 ✓), both docs presented separately (G3 ✓), DocsBot used for retrieval (G4 ✓).
