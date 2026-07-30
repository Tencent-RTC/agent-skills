#!/usr/bin/env python3
"""Create, approve, and audit deterministic TRTC Call apply plans."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from project_probe import (
    _canonical_digest,
    probe_project,
    snapshot_project,
)


SCHEMA_VERSION = 1
CONFIRMATION_CATEGORIES = {
    "app-root",
    "dependencies",
    "native-config",
    "router",
}


class PlanError(RuntimeError):
    pass


def _read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise PlanError(f"无法读取 JSON：{path}: {error}") from error
    if not isinstance(value, dict):
        raise PlanError(f"JSON 顶层必须是对象：{path}")
    return value


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            payload,
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
        )
        + "\n",
        encoding="utf-8",
    )


def _plan_digest(plan: dict[str, Any]) -> str:
    immutable = {
        key: value
        for key, value in plan.items()
        if key not in {"plan_id", "confirmation", "execution_record"}
    }
    return _canonical_digest(immutable)


def _operation(
    operation_id: str,
    phase: str,
    action: str,
    target: str,
    category: str,
    *,
    source: str | None = None,
    content: str | None = None,
    status: str = "planned",
    reason: str | None = None,
) -> dict[str, Any]:
    return {
        "id": operation_id,
        "phase": phase,
        "action": action,
        "target": target,
        "source": source,
        "content": content,
        "category": category,
        "risk": "high" if category in CONFIRMATION_CATEGORIES else "medium",
        "requires_confirmation": True,
        "status": status,
        "reason": reason,
    }


def _anchor_status(condition: bool, reason: str) -> tuple[str, str | None]:
    return ("already-satisfied", reason) if condition else ("planned", None)


def _platform_status(
    target: str,
    condition: bool,
    skipped: set[str],
    reason: str,
) -> tuple[str, str | None]:
    if target in skipped:
        return "skipped-by-user", "用户选择跳过该平台文件"
    return _anchor_status(condition, reason)


def _build_operations(
    profile: dict[str, Any],
    variant: str,
    media_type: str,
    skipped_platform_files: set[str],
) -> list[dict[str, Any]]:
    operations: list[dict[str, Any]] = []
    existing_files = set(profile["snapshot"]["files"])
    app_entry = profile["app_entry"]
    existing_call = profile["existing_call"]
    dependencies = set(profile["dependencies"]["dependencies"])
    anchors = existing_call["anchors"]
    file_contracts = existing_call["file_contracts"]

    generated_files = [
        (
            "install-bootstrap",
            "lib/trtc_call/trtc_call_bootstrap.dart",
            "templates/lib/trtc_call/trtc_call_bootstrap.dart",
        ),
        (
            "install-service",
            "lib/trtc_call/call_service.dart",
            "templates/lib/trtc_call/call_service.dart",
        ),
        (
            "install-button",
            "lib/trtc_call/call_button.dart",
            "templates/lib/trtc_call/call_button.dart",
        ),
    ]
    generated_files.append(
        (
            "install-debug-signer",
            "lib/debug/generate_test_user_sig.dart",
            "templates/lib/debug/generate_test_user_sig.dart",
        )
    )
    for operation_id, target, source in generated_files:
        if target not in existing_files:
            status, reason = "planned", None
        elif file_contracts.get(target):
            status, reason = "already-satisfied", "目标文件已存在且契约完整"
        else:
            status, reason = (
                "manual-review",
                "目标文件已存在但契约不完整，禁止自动覆盖",
            )
        operations.append(
            _operation(
                operation_id,
                "code",
                "install",
                target,
                "generated-code",
                source=source,
                status=status,
                reason=reason,
            )
        )

    main_file = app_entry.get("main_file") or "lib/main.dart"
    class_file = app_entry.get("class_file") or main_file
    status, reason = _anchor_status(
        anchors["bootstrap"],
        "TrtcCallBootstrap.run 已存在",
    )
    operations.append(
        _operation(
            "patch-app-bootstrap",
            "code",
            "patch",
            main_file,
            "app-root",
            status=status,
            reason=reason,
        )
    )
    status, reason = _anchor_status(
        (
            anchors["delegates"]
            and (
                app_entry["app_entry_variant"] == "material-router-go-router"
                or anchors["observers"]
            )
        ),
        "App 根节点已包含本地化和 observer 参数",
    )
    operations.append(
        _operation(
            "patch-app-parameters",
            "code",
            "patch",
            class_file,
            "app-root",
            status=status,
            reason=reason,
        )
    )

    if app_entry["app_entry_variant"] == "material-router-go-router":
        router_file = app_entry["router"]["config_file"]
        router_satisfied = anchors["navigator_observer"]
        status, reason = _anchor_status(
            router_satisfied,
            "GoRouter 已包含 TUICallKit navigatorObserver",
        )
        operations.append(
            _operation(
                "patch-go-router-observer",
                "code",
                "patch",
                router_file or "<unresolved-go-router>",
                "router",
                status=status,
                reason=reason,
            )
        )

    for dependency, dep_content in (
        ("tencent_calls_uikit", "  tencent_calls_uikit: ^5.0.0"),
        ("flutter_localizations", "  flutter_localizations:\n    sdk: flutter"),
    ):
        status, reason = _anchor_status(
            dependency in dependencies,
            f"pubspec 已包含 {dependency}",
        )
        operations.append(
            _operation(
                f"dependency-{dependency.replace('_', '-')}",
                "code",
                "append-dependency",
                "pubspec.yaml",
                "dependencies",
                content=dep_content,
                status=status,
                reason=reason,
            )
        )
    if variant == "local-dev":
        status, reason = _anchor_status(
            "crypto" in dependencies,
            "pubspec 已包含 crypto",
        )
        operations.append(
            _operation(
                "dependency-crypto",
                "code",
                "append-dependency",
                "pubspec.yaml",
                "dependencies",
                status=status,
                reason=reason,
            )
        )

    platform = profile["platform_config"]
    ios_target = platform["ios"]["info_plist"]
    if ios_target:
        status, reason = _platform_status(
            ios_target,
            platform["ios"]["microphone_usage"],
            skipped_platform_files,
            "iOS 麦克风 Usage Description 已存在",
        )
        operations.append(
            _operation(
                "ios-microphone-permission",
                "platform",
                "append",
                ios_target,
                "native-config",
                status=status,
                reason=reason,
            )
        )
        if media_type in {"video", "both"}:
            status, reason = _platform_status(
                ios_target,
                platform["ios"]["camera_usage"],
                skipped_platform_files,
                "iOS 相机 Usage Description 已存在",
            )
            operations.append(
                _operation(
                    "ios-camera-permission",
                    "platform",
                    "append",
                    ios_target,
                    "native-config",
                    status=status,
                    reason=reason,
                )
            )

    manifest = platform["android"]["manifest"]
    if manifest:
        audio_permissions_ready = (
            platform["android"]["record_audio_permission"]
            and platform["android"]["internet_permission"]
        )
        status, reason = _platform_status(
            manifest,
            audio_permissions_ready,
            skipped_platform_files,
            "Android 录音和网络权限已存在",
        )
        operations.append(
            _operation(
                "android-audio-permissions",
                "platform",
                "append",
                manifest,
                "native-config",
                status=status,
                reason=reason,
            )
        )
        if media_type in {"video", "both"}:
            status, reason = _platform_status(
                manifest,
                platform["android"]["camera_permission"],
                skipped_platform_files,
                "Android 相机权限已存在",
            )
            operations.append(
                _operation(
                    "android-camera-permission",
                    "platform",
                    "append",
                    manifest,
                    "native-config",
                    status=status,
                    reason=reason,
                )
            )

    android_build = platform["android"]["build_file"]
    if android_build:
        build_ready = (
            (platform["android"]["min_sdk"] or 0) >= 21
            and platform["android"]["multidex_enabled"]
        )
        status, reason = _platform_status(
            android_build,
            build_ready,
            skipped_platform_files,
            "Android minSdk 和 multidex 已满足",
        )
        operations.append(
            _operation(
                "android-build-config",
                "platform",
                "patch",
                android_build,
                "native-config",
                status=status,
                reason=reason,
            )
        )
    return operations


def create_plan(
    project_root: Path,
    variant: str,
    media_type: str,
    *,
    phase: str = "all",
    profile: dict[str, Any] | None = None,
    skipped_platform_files: set[str] | None = None,
    skipped_operation_ids: set[str] | None = None,
) -> dict[str, Any]:
    if variant == "backend":
        raise PlanError(
            "当前版本暂不支持生产 UserSig 自动接入；请先按官方文档完成服务端 "
            "UserSig，再继续集成。未修改项目。"
        )
    root = project_root.resolve()
    current_profile = probe_project(root)
    selected_profile = profile or current_profile
    if selected_profile.get("project", {}).get("root") != str(root):
        raise PlanError("project profile 与当前项目根目录不一致")
    profile_payload = {
        key: value
        for key, value in selected_profile.items()
        if key != "profile_id"
    }
    if selected_profile.get("profile_id") != _canonical_digest(profile_payload):
        raise PlanError("project profile 内容已被修改，profile_id 校验失败")
    if selected_profile.get("profile_id") != current_profile.get("profile_id"):
        raise PlanError("project profile 已过期，请重新运行 project probe")

    skipped = skipped_platform_files or set()
    operations = _build_operations(
        selected_profile,
        variant,
        media_type,
        skipped,
    )
    if phase != "all":
        operations = [
            item for item in operations if item["phase"] == phase
        ]
    skipped_ids = skipped_operation_ids or set()
    known_operation_ids = {item["id"] for item in operations}
    unknown_skips = sorted(skipped_ids - known_operation_ids)
    if unknown_skips:
        raise PlanError(
            "skip operation 不存在于当前计划阶段："
            + ", ".join(unknown_skips)
        )
    for item in operations:
        if item["id"] in skipped_ids and item["status"] == "planned":
            item["status"] = "skipped-by-user"
            item["reason"] = "用户确认跳过该操作"
    blockers = list(selected_profile["blockers"])
    blockers.extend(
        {
            "code": "existing-generated-file-needs-review",
            "message": item["reason"],
            "paths": [item["target"]],
        }
        for item in operations
        if item["status"] == "manual-review"
    )
    planned = [item for item in operations if item["status"] == "planned"]
    required_categories = sorted(
        {
            item["category"]
            for item in planned
            if item["requires_confirmation"]
        }
    )
    approval_required = bool(required_categories)
    plan: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "project_root": str(root),
        "profile_id": selected_profile["profile_id"],
        "variant": variant,
        "media_type": media_type,
        "phase": phase,
        "baseline_snapshot": selected_profile["snapshot"],
        "operations": operations,
        "manual_steps": (
            [
                {
                    "target": "ios/Runner.xcodeproj/project.pbxproj",
                    "requirement": (
                        "IPHONEOS_DEPLOYMENT_TARGET >= 14.0；"
                        "已有更高版本保持不变"
                    ),
                },
                {
                    "target": "ios/Podfile",
                    "requirement": "按 integration-reference 配置 iOS 版本并执行 pod install",
                },
            ]
            if (
                phase in {"all", "platform"}
                and selected_profile["platform_config"]["ios"]["present"]
            )
            else []
        ),
        "blockers": blockers,
        "approval_gate": {
            "required": approval_required,
            "required_categories": required_categories,
        },
        "ready_for_confirmation": not blockers,
        "confirmation": {
            "status": "pending" if approval_required else "not-required",
            "approved_by": None,
            "approved_plan_id": None,
        },
    }
    plan["plan_id"] = _plan_digest(plan)
    return plan


def approve_plan(plan_path: Path, approved_by: str) -> dict[str, Any]:
    plan = _read_json(plan_path)
    if plan.get("plan_id") != _plan_digest(plan):
        raise PlanError("apply plan 内容已被修改，plan_id 校验失败")
    if not plan.get("ready_for_confirmation"):
        raise PlanError("apply plan 仍有 blocker，不能确认")
    root = Path(plan["project_root"])
    if snapshot_project(root) != plan.get("baseline_snapshot"):
        raise PlanError("项目在确认前已发生变化，请重新生成 apply plan")
    plan["confirmation"] = {
        "status": "approved",
        "approved_by": approved_by,
        "approved_plan_id": plan["plan_id"],
    }
    _write_json(plan_path, plan)
    return plan


def _change_kind(
    path: str,
    baseline: dict[str, str],
    current: dict[str, str],
) -> str:
    if path not in baseline and path in current:
        return "created"
    if path in baseline and path not in current:
        return "deleted"
    if baseline.get(path) != current.get(path):
        return "modified"
    return "unchanged"


def record_result(plan_path: Path) -> dict[str, Any]:
    plan = _read_json(plan_path)
    if plan.get("plan_id") != _plan_digest(plan):
        raise PlanError("apply plan 内容已被修改，plan_id 校验失败")
    confirmation = plan.get("confirmation") or {}
    if plan.get("approval_gate", {}).get("required") and (
        confirmation.get("status") != "approved"
        or confirmation.get("approved_plan_id") != plan.get("plan_id")
    ):
        raise PlanError("apply plan 尚未获得用户确认，不能记录 apply 结果")

    root = Path(plan["project_root"])
    baseline = plan["baseline_snapshot"]["files"]
    current_snapshot = snapshot_project(root)
    current = current_snapshot["files"]
    changed_paths = sorted(
        path
        for path in set(baseline) | set(current)
        if baseline.get(path) != current.get(path)
    )
    planned_targets = sorted(
        {
            item["target"]
            for item in plan["operations"]
            if item["status"] == "planned"
        }
    )
    planned_changes = [
        {
            "path": path,
            "status": _change_kind(path, baseline, current),
        }
        for path in planned_targets
    ]
    unplanned_changes = [
        {
            "path": path,
            "status": _change_kind(path, baseline, current),
        }
        for path in changed_paths
        if path not in planned_targets
    ]
    planned_but_unchanged = sorted(
        item["path"]
        for item in planned_changes
        if item["status"] == "unchanged"
    )
    missing_planned = sorted(
        item["path"]
        for item in planned_changes
        if item["status"] == "deleted"
    )
    if not planned_targets and not changed_paths:
        status = "no-op"
    elif (
        not unplanned_changes
        and not planned_but_unchanged
        and not missing_planned
    ):
        status = "matched"
    else:
        status = "diverged"
    result: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "plan_id": plan["plan_id"],
        "project_root": plan["project_root"],
        "status": status,
        "summary": {
            "planned_target_count": len(planned_targets),
            "changed_file_count": len(changed_paths),
            "unplanned_change_count": len(unplanned_changes),
            "planned_but_unchanged_count": len(planned_but_unchanged),
            "missing_planned_count": len(missing_planned),
        },
        "changes": {
            "planned": planned_changes,
            "unplanned": unplanned_changes,
        },
        "differences": {
            "planned_but_unchanged": planned_but_unchanged,
            "missing_planned": missing_planned,
        },
        "final_snapshot": current_snapshot,
    }
    result["result_id"] = _canonical_digest(result)
    return result


def _emit(payload: dict[str, Any]) -> None:
    print(
        json.dumps(
            payload,
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
        )
    )


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    create = subparsers.add_parser("create")
    create.add_argument("--project-root", type=Path, required=True)
    create.add_argument("--variant", choices=("backend", "local-dev"), required=True)
    create.add_argument(
        "--media-type",
        choices=("audio", "video", "both"),
        required=True,
    )
    create.add_argument(
        "--phase",
        choices=("platform", "code", "all"),
        default="all",
    )
    create.add_argument("--profile", type=Path)
    create.add_argument("--output", type=Path, required=True)
    create.add_argument(
        "--skip-platform-file",
        action="append",
        default=[],
    )
    create.add_argument(
        "--skip-operation",
        action="append",
        default=[],
    )

    approve = subparsers.add_parser("approve")
    approve.add_argument("--plan", type=Path, required=True)
    approve.add_argument("--approved-by", choices=("user",), required=True)

    record = subparsers.add_parser("record")
    record.add_argument("--plan", type=Path, required=True)
    record.add_argument("--output", type=Path, required=True)
    return parser


def main() -> int:
    args = _build_parser().parse_args()
    try:
        if args.command == "create":
            profile = _read_json(args.profile) if args.profile else None
            plan = create_plan(
                args.project_root,
                args.variant,
                args.media_type,
                phase=args.phase,
                profile=profile,
                skipped_platform_files=set(args.skip_platform_file),
                skipped_operation_ids=set(args.skip_operation),
            )
            _write_json(args.output, plan)
            _emit(plan)
            return 0 if plan["ready_for_confirmation"] else 1
        if args.command == "approve":
            _emit(approve_plan(args.plan, args.approved_by))
            return 0
        result = record_result(args.plan)
        _write_json(args.output, result)
        plan = _read_json(args.plan)
        plan["execution_record"] = {
            "path": str(args.output),
            "result_id": result["result_id"],
            "status": result["status"],
        }
        _write_json(args.plan, plan)
        _emit(result)
        return 0 if result["status"] in {"matched", "no-op"} else 1
    except PlanError as error:
        _emit({"status": "error", "message": str(error)})
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
