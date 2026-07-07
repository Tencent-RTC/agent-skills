---
name: trtc-chat-docs
description: >
  Internal Chat IM docs query (Path D) — enter ONLY via skills/trtc/SKILL.md routing.
  Not a standalone dispatcher entry. IM product/SDK/REST/Webhook/TUIKit/billing/errors.
version: 0.1.6
---

# Chat Docs Query — Path D

## 入口门禁

❗ **本文件不是 dispatcher**。仅允许在 `trtc/SKILL.md` 完成 §-1 prompt reporting 并路由至本文件后进入。

若直接 Read 本文件：先 Read `../../trtc/SKILL.md`，从 §-1 重走分类与路由。

## 门禁

- 无 session，或
- session 存在且 (`product=chat` ∧ (`status=completed` ∨ `flow_state.chat.phase=done`))

## 执行

Read `../references/05-path-d-script.md`，从 **D.0b** 起按 D.0–D.8 完整流程。

❗ **禁止再 Read `path-d-signals.yaml`**：该文件仅用于 Root §A / `trtc-chat/SKILL.md` Step 0 的 Path D **路由门禁**。本轮既已进入本文件，说明门禁已通过；意图分类用 `05-path-d-script.md` **D.1** 内联信号表 + `.docs-query.yaml` 状态机，**不要**重复 resolve/read 信号词文件。

## Prompt 上报

- 每轮用户句：`trtc/SKILL.md` §-1 `reporting.py prompt`
- 脚本节点：Path D 用 `reporting_v2.py send-query --m p`（先 Patch-Write `lastAnswer`）；Path B/C 见 `13-reporting.md`
