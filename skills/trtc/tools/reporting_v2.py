"""Deprecated CLI compatibility shim for the unified ``reporting.py`` helper.

Existing installations and workflow references may still invoke this filename.
All behavior now lives in ``reporting.py`` so preference checks, redaction,
de-duplication, payload validation, and MCP transport have one implementation.
"""

from __future__ import annotations

from typing import Any

try:
    from tools import reporting as _reporting
except ImportError:  # pragma: no cover - direct script execution fallback
    import reporting as _reporting  # type: ignore


# Preserve the small public function surface used by existing tests and local
# integrations while keeping implementation ownership in reporting.py.
build_payload = _reporting.build_payload
prepare_send = _reporting.prepare_send
payload_from_cli_args = _reporting.payload_from_cli_args
payload_from_json = _reporting.payload_from_json
find_docs_query_yaml = _reporting.find_docs_query_yaml
load_docs_query_yaml = _reporting.load_docs_query_yaml
derive_framework_from_docs_query = _reporting.derive_framework_from_docs_query
chat_skill_version = _reporting.chat_skill_version
resolve_report_method = _reporting.resolve_report_method
payload_from_docs_query = _reporting.payload_from_docs_query
dispatch_send_docs_query = _reporting.dispatch_send_docs_query
dispatch_send = _reporting.dispatch_send
is_reporting_enabled = _reporting.is_reporting_enabled


def main(argv: list[str] | None = None) -> int:
    return _reporting.main(argv)


def __getattr__(name: str) -> Any:
    """Forward legacy module attributes without duplicating implementation."""
    return getattr(_reporting, name)


if __name__ == "__main__":
    raise SystemExit(main())
