#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""add-capability.py —— 能力清单/契约辅助 + 接入代码生成。

架构说明：本 Skill 的所有能力**随仓库发布**，conversation-core/server.py 用
try_load_capability 预接线（目录在即挂载）。因此 **Path A 无需装配即可运行**。
本脚本主要服务 Path B：
  --list                          列出全部能力 + 其 endpoints（读 manifest）
  --contract <names...>           打印所选能力的 inbound/outbound API 契约
  --target-project <dir>          写集成说明 + 接入代码（--apply 时渲染适配器模板；
                                  不传 --apply 则只写 API 契约 Markdown）
  --apply                         启用适配器代码生成（配合 --target-project 使用）
  --tech-stack <stack>            指定技术栈：web / python / auto（默认 auto 自动检测）

输出 --json 时打印机器可读结果。
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

SKILL_ROOT = Path(__file__).resolve().parent.parent
CAPS = SKILL_ROOT / "capabilities"
ADAPTERS_DIR = SKILL_ROOT / "auto_adapters"

# 极简 YAML 读取（只取我们需要的 endpoints / business_contract.external_apis）——
# 避免强依赖 pyyaml；用行扫描解析 manifest 的关键块。
def _read_manifest(cap: str) -> dict:
    f = CAPS / cap / "manifest.yaml"
    info = {"name": cap, "endpoints": [], "inbound": [], "outbound": []}
    if not f.exists():
        return info
    text = f.read_text(encoding="utf-8")
    for line in text.splitlines():
        s = line.strip()
        if s.startswith("- { method:") or s.startswith("- {method:"):
            info["endpoints"].append(s.lstrip("- ").strip())
        if "direction: inbound" in s:
            info["inbound"].append(s)
        if "direction: outbound" in s:
            info["outbound"].append(s)
    return info


ALL_CAPS = ["conversation-core", "scenario-roleplay", "quick-correct",
            "reply-suggestion", "ability-report", "custom-learning-kb"]


def cmd_list(as_json: bool) -> None:
    data = [{"name": c, "installed": (CAPS / c / "manifest.yaml").exists()} for c in ALL_CAPS]
    if as_json:
        print(json.dumps({"capabilities": data}, ensure_ascii=False))
    else:
        print("能力清单（随仓库发布，目录在即可用）:")
        for d in data:
            print(f"  [{'x' if d['installed'] else ' '}] {d['name']}")


# inbound API 契约（口语陪练几乎全 inbound：我们暴露给用户前端调）
INBOUND_CONTRACT = """\
# AI Speaking Coach —— 后端 API 契约（Path B 集成）

> 口语陪练是「API 提供者」：以下 inbound 接口由本服务暴露，你的前端来调。
> 换大脑：改 .env 的 REPORT_LLM_*，或覆盖各能力 src/prompts / 实现 user_custom adapter。

## 基础（conversation-core，必装）
- POST /api/v1/config        签发 UserSig 三套 + 下发前端配置       body: {userid}
- POST /api/v1/agent/start   进房启动 voice agent                   body: {RoomId, Scenario, Level, Style, Voice, OpeningQuestion, AiRole?, MyRole?, SceneDescription?, SceneCustomized?, AgentConfig{UserId,UserSig,TargetUserId}, UserConfig?}
- POST /api/v1/agent/stop    停止                                    body: {TaskId}
- POST /api/v1/agent/farewell 告别语 + StopAfterPlay 一站式结束      body: {TaskId, Lang?, FarewellText?}
- POST /api/v1/agent/invoke  push-to-talk 手动触发 AI 回复           body: {TaskId, Text?}
- GET  /api/v1/health        三 LED 自检

## 教练能力（inbound）
- POST /api/v1/scene/generate  🎲 生成 aiRole/myRole/scene 一字段    body: {Field, Scenario, Level, Style, Language, Context}
- POST /api/v1/correct         单句纠正（why 支持 en/zh/ja/ko）       body: {UserSentence, Scenario, Level, ScenarioTopic?, AiFollowup?, TurnId?, UILanguage?}
- POST /api/v1/suggest         3 条接话建议                           body: {AiLastMessage, Scenario, Level, Style, ScenarioTopic?, RecentTranscript?, HintId?}
- POST /api/v1/report          4 维能力报告                           body: {Scenario, Level, Style, DurationSec, Transcript[], Language}

## custom-learning-kb（可选，唯一 outbound：去拉你的教研库）
- POST /api/v1/kb/retrieve     检索教研片段                           body: {query, top_k?}
  outbound → Dify/Coze/你的 REST（.env KB_ADAPTER 切换；非 localhost 强制 HTTPS，禁内网）

## 自定义消息（媒体面，前后端约定）
- 10000 字幕(云→端) / 10001 AI状态(云→端) / 20000 文字输入(端→云) / 20001 打断(端→云)
"""


def cmd_contract(names, as_json: bool) -> None:
    caps = names or ALL_CAPS
    infos = [_read_manifest(c) for c in caps]
    if as_json:
        print(json.dumps({"contract": infos}, ensure_ascii=False))
    else:
        print(INBOUND_CONTRACT)


# ── 适配器渲染 ────────────────────────────────────────────────────

def _read_adapter_manifest() -> dict:
    """极简 YAML 扫描读取 auto_adapters/manifest.yaml 关键字段。"""
    f = ADAPTERS_DIR / "manifest.yaml"
    if not f.exists():
        return {"adapters": [], "fallback_templates": {}}
    text = f.read_text(encoding="utf-8")
    info: dict = {"adapters": [], "fallback_templates": {}, "default_variables": {}}
    current_adapter = None
    for line in text.splitlines():
        s = line.strip()
        # default_variables 块
        if s.startswith("SKELETON_BASE_URL:") or s.startswith("API_PREFIX:") or s.startswith("PORT:"):
            k, v = s.split(":", 1)
            info.setdefault("default_variables", {})[k.strip()] = v.strip().strip('"')
        # adapters 列表项
        if s.startswith("- name:"):
            current_adapter = {"name": s.split(":", 1)[1].strip().strip('"')}
            info["adapters"].append(current_adapter)
        elif current_adapter is not None:
            if s.startswith("path:"):
                current_adapter["path"] = s.split(":", 1)[1].strip().strip('"')
            elif s.startswith("tech_stack:"):
                raw = s.split(":", 1)[1].strip().strip("[]")
                current_adapter["tech_stack"] = [t.strip().strip('"') for t in raw.split(",")]
        # fallback_templates
        if ":" in s and any(k in s for k in ("generic_integration:", "kb_custom_sample:")):
            k, v = s.split(":", 1)
            info["fallback_templates"][k.strip()] = v.strip().strip('"')
    return info


def _detect_tech_stack(target_dir: Path) -> str:
    """自动检测项目技术栈（简短版）。"""
    files = {f.name.lower() for f in target_dir.iterdir() if f.is_file()}
    if "package.json" in files:
        return "web"
    if "requirements.txt" in files or "pyproject.toml" in files or "setup.py" in files:
        return "python"
    return ""


def _resolve_adapter(tech_stack: str, manifest: dict) -> dict:
    """根据 tech_stack 匹配适配器；返回 {name, path, tpl_file} 或 None（L3 降级）。"""
    ts = tech_stack.lower()
    for ad in manifest.get("adapters", []):
        if ts in [t.lower() for t in ad.get("tech_stack", [])]:
            ad_dir = ADAPTERS_DIR / ad["path"]
            # 找第一个 .tpl 文件
            tpl_files = list(ad_dir.glob("*.tpl"))
            if tpl_files:
                return {
                    "name": ad["name"],
                    "path": str(ad_dir),
                    "tpl_file": str(tpl_files[0]),
                    "level": "L1",
                }
    # L3 降级
    fb = manifest.get("fallback_templates", {})
    generic = fb.get("generic_integration", "integration_templates/generic-integration.md")
    return {"name": "generic", "level": "L3", "tpl_file": str(ADAPTERS_DIR / generic)}


def _substitute_vars(content: str, target_dir: Path, tech_stack: str) -> str:
    """替换 .tpl 中的 ${VARIABLE} 占位符。"""
    content = content.replace("${SKELETON_BASE_URL}", "http://localhost:8000")
    content = content.replace("${API_PREFIX}", "/api/v1")
    content = content.replace("${PORT}", "8000")
    return content


def _render_adapter(target_dir: Path, tech_stack: str, as_json: bool) -> dict:
    """渲染适配器代码到目标目录。"""
    manifest = _read_adapter_manifest()
    if tech_stack == "auto":
        tech_stack = _detect_tech_stack(target_dir)
    if not tech_stack:
        tech_stack = "web"  # 兜底默认

    adapter = _resolve_adapter(tech_stack, manifest)
    tpl_path = Path(adapter["tpl_file"])
    if not tpl_path.exists():
        return {"ok": False, "error": f"template not found: {tpl_path}"}

    content = tpl_path.read_text(encoding="utf-8")
    content = _substitute_vars(content, target_dir, tech_stack)

    # 确定输出文件名：.tpl → 去掉 .tpl 后缀
    out_name = tpl_path.name.replace(".tpl", "")
    out_path = target_dir / out_name
    out_path.write_text(content, encoding="utf-8")

    return {
        "ok": True,
        "level": adapter["level"],
        "tech_stack": tech_stack,
        "artifact": str(out_path),
        "template": str(tpl_path),
    }


def cmd_target(target: str, names, as_json: bool, apply: bool = False,
               tech_stack: str = "auto") -> None:
    tp = Path(target).resolve()
    tp.mkdir(parents=True, exist_ok=True)

    # 始终写 API 契约文档
    contract_out = tp / "INTEGRATION_SPEAKING_COACH.md"
    contract_out.write_text(INBOUND_CONTRACT, encoding="utf-8")

    results = {"ok": True, "contract": str(contract_out), "adapters": []}

    if apply:
        adapter_result = _render_adapter(tp, tech_stack, as_json)
        results["adapters"].append(adapter_result)
        if not adapter_result["ok"]:
            results["ok"] = False

    if as_json:
        print(json.dumps(results, ensure_ascii=False))
    else:
        msgs = [f"✓ 集成说明已写入: {contract_out}"]
        for ar in results.get("adapters", []):
            if ar["ok"]:
                msgs.append(f"✓ [{ar['level']}] {ar['tech_stack']} 接入代码已生成: {ar['artifact']}")
            else:
                msgs.append(f"✗ 适配器渲染失败: {ar.get('error', 'unknown')}")
        for m in msgs:
            print(m)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("names", nargs="*", help="能力名（可空=全部）")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--contract", action="store_true")
    ap.add_argument("--target-project", default="")
    ap.add_argument("--apply", action="store_true", help="启用适配器代码生成")
    ap.add_argument("--tech-stack", default="auto",
                    help="技术栈：web / python / auto（默认自动检测）")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    if args.list:
        cmd_list(args.json)
    elif args.target_project:
        cmd_target(args.target_project, args.names, args.json,
                   apply=args.apply, tech_stack=args.tech_stack)
    else:
        cmd_contract(args.names, args.json)


if __name__ == "__main__":
    main()
