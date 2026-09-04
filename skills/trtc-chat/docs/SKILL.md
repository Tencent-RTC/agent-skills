---
name: trtc-chat-docs
description: >
  Internal Chat IM docs query (Path D) — enter ONLY via skills/trtc/SKILL.md routing.
  Not a standalone dispatcher entry. IM product/SDK/REST/Webhook/TUIKit/billing/errors.
version: 1.0.0
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

如果 D-f 处理的是运行时症状，而本地查表和官方检索仍没有可执行的诊断依据，Read `../../trtc-sdk-log-analysis/SKILL.md`，移交到手动日志收集与离线分析流程。不要暗示 Chat Path D 能自动读取设备 sandbox 或应用日志目录。

❗ **禁止再 Read `path-d-signals.yaml`**：该文件仅用于 Root §A / `trtc-chat/SKILL.md` Step 0 的 Path D **路由门禁**。本轮既已进入本文件，说明门禁已通过；意图分类用 `05-path-d-script.md` **D.1** 内联信号表 + `.docs-query.yaml` 状态机，**不要**重复 resolve/read 信号词文件。

## Reporting boundary

本 Skill 不是独立上报入口。Root/Host 负责每轮 Prompt、路由 `invoke` 和回答后的 Host Stop；本 Skill 不得自行调用 `send`/`send-query` 或重复调用 `invoke`。若被直接调用且 Host 未记录本轮，才按 Root 规则使用 stdin Prompt 兜底。
