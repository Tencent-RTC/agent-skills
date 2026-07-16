#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""三把钥匙免密校验脚本（AI 驱动配置流程的"原子工具"）。

流程：
1. AI 把用户贴过来的密钥用 write_to_file 写进 capabilities/conversation-core/.env
2. AI 调用 `python3 scripts/verify-credentials.py [--type tencent|trtc|llm]`
3. 本脚本只从 .env / 环境变量读取，绝不接受任何密钥作为命令行参数
4. 输出结构化 JSON 到 stdout；AI 解析后按 SKILL.md 里的错误码表回应用户

输出格式（始终是合法 JSON）：
    单项: {"ok": true,  "type": "tencent", "error": "",     "message": "...", "latency_ms": 320}
    单项: {"ok": false, "type": "trtc",    "error": "E002", "message": "...", "latency_ms": 0}
    批量: {"ok": true,  "type": "all", "items": [ ... ]}

退出码：0 表示全部通过；非 0 表示至少一项失败。

安全红线：
- 绝不接受命令行参数传入密钥
- 绝不把密钥明文回显到 stdout/stderr
- .env 权限（600）由写入方设置，本脚本不重复处理
"""
from __future__ import annotations

import argparse
import json
import sys
import warnings
from pathlib import Path

warnings.filterwarnings("ignore")

_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from lib import credential_validators as cv  # noqa: E402


def _print_json(data: dict) -> None:
    sys.stdout.write(json.dumps(data, ensure_ascii=False))
    sys.stdout.write("\n")
    sys.stdout.flush()


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="verify-credentials", description="三把钥匙免密校验（只从 .env 读取，输出结构化 JSON）")
    parser.add_argument("--type", choices=["tencent", "trtc", "llm", "all"], default="all", help="只校验单个钥匙；默认全部")
    parser.add_argument("--no-deep", action="store_true", help="TRTC 跳过深度 OpenAPI 校验，只做本地 UserSig 自洽检查")
    parser.add_argument("--env-file", default="", help="可选：指定 .env 路径（默认 capabilities/conversation-core/.env）")
    args = parser.parse_args(argv)

    cv.load_dotenv(Path(args.env_file) if args.env_file else None)

    if args.type == "tencent":
        result = cv.validate_tencent()
        _print_json(result.to_dict())
        return 0 if result.ok else 1

    if args.type == "trtc":
        result = cv.validate_trtc(deep=not args.no_deep)
        _print_json(result.to_dict())
        return 0 if result.ok else 1

    if args.type == "llm":
        result = cv.validate_llm()
        _print_json(result.to_dict())
        return 0 if result.ok else 1

    batch = cv.validate_all()
    _print_json(batch.to_dict())
    return 0 if batch.ok else 1


if __name__ == "__main__":
    sys.exit(main())
