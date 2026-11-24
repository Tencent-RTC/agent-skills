"""dep_installer — Install dependencies declared by AI before compilation.

Reads dependencies.json (produced by run_ai.py) and invokes the appropriate
package manager for the target platform.

Supported platforms and their package managers:
  - ios       → CocoaPods (pod install)
  - android   → Gradle (dependencies injected into build.gradle)
  - web       → npm install
  - flutter   → pub (flutter pub add)
  - uniapp    → npm install (same as web)
"""
import json
import re
import subprocess
from pathlib import Path


def install(platform: str, workspace: Path, dep_file: Path, log_dir: Path) -> int:
    """Install dependencies for the given platform.

    Args:
        platform: one of ios/android/web/flutter/uniapp
        workspace: path to the demo project workspace
        dep_file: path to dependencies.json
        log_dir: directory to write install logs

    Returns 0 on success, non-zero on failure.
    """
    deps = json.loads(dep_file.read_text())
    if not deps:
        return 0

    handler = _HANDLERS.get(platform)
    if handler is None:
        return 0  # Unknown platform — skip dep install gracefully
    return handler(workspace, deps, log_dir)


# ---------------------------------------------------------------------------
# Platform-specific handlers
# ---------------------------------------------------------------------------

def _install_cocoapods(workspace: Path, deps: dict, log_dir: Path) -> int:
    """Patch Podfile with declared pods and run `pod install`."""
    pods = deps.get("cocoapods", [])
    if not pods:
        return 0

    podfile = workspace / "Podfile"
    if not podfile.exists():
        _write_log(log_dir, "pod_install.log", "ERROR: Podfile not found in workspace\n")
        return 1

    content = podfile.read_text()

    # Build the pod lines to insert
    pod_lines = "\n".join(f"  pod '{p}'" for p in pods)

    # Insert pods after the "# Pods for ..." comment, or before last `end`
    marker_pattern = re.compile(r"(#\s*Pods for \w+)")
    match = marker_pattern.search(content)
    if match:
        insert_pos = match.end()
        content = content[:insert_pos] + "\n" + pod_lines + content[insert_pos:]
    else:
        # Fallback: insert before the last `end`
        last_end = content.rfind("\nend")
        if last_end != -1:
            content = content[:last_end] + "\n" + pod_lines + content[last_end:]

    podfile.write_text(content)

    # Run pod install
    return _run_cmd(
        ["pod", "install", "--repo-update"],
        cwd=workspace,
        log_path=log_dir / "pod_install.log",
        timeout=600,
    )


def _install_gradle(workspace: Path, deps: dict, log_dir: Path) -> int:
    """Inject dependencies into app/build.gradle and sync."""
    artifacts = deps.get("gradle", [])
    if not artifacts:
        return 0

    # Find build.gradle (Groovy) or build.gradle.kts (Kotlin DSL)
    build_gradle = workspace / "app" / "build.gradle"
    if not build_gradle.exists():
        build_gradle = workspace / "app" / "build.gradle.kts"
    if not build_gradle.exists():
        _write_log(log_dir, "gradle_dep.log", "ERROR: app/build.gradle[.kts] not found\n")
        return 1

    content = build_gradle.read_text()
    is_kts = build_gradle.suffix == ".kts"

    # Build dependency lines
    if is_kts:
        dep_lines = "\n".join(f'    implementation("{a}")' for a in artifacts)
    else:
        dep_lines = "\n".join(f"    implementation '{a}'" for a in artifacts)

    # Insert into the dependencies { ... } block
    dep_block_pattern = re.compile(r"(dependencies\s*\{)")
    match = dep_block_pattern.search(content)
    if match:
        insert_pos = match.end()
        content = content[:insert_pos] + "\n" + dep_lines + content[insert_pos:]
    else:
        # Append a dependencies block
        content += f"\ndependencies {{\n{dep_lines}\n}}\n"

    build_gradle.write_text(content)

    # Gradle sync happens implicitly during build — no separate install step needed
    _write_log(log_dir, "gradle_dep.log",
               f"Injected {len(artifacts)} dependencies into {build_gradle.name}\n")
    return 0


def _install_npm(workspace: Path, deps: dict, log_dir: Path) -> int:
    """Add npm packages via `npm install <pkg1> <pkg2> ...`."""
    packages = deps.get("npm", [])
    if not packages:
        return 0

    package_json = workspace / "package.json"
    if not package_json.exists():
        _write_log(log_dir, "npm_install.log", "ERROR: package.json not found\n")
        return 1

    return _run_cmd(
        ["npm", "install", "--save"] + packages,
        cwd=workspace,
        log_path=log_dir / "npm_install.log",
        timeout=300,
    )


def _install_pub(workspace: Path, deps: dict, log_dir: Path) -> int:
    """Add Flutter pub packages via `flutter pub add <pkg1> <pkg2> ...`."""
    packages = deps.get("pub", [])
    if not packages:
        return 0

    pubspec = workspace / "pubspec.yaml"
    if not pubspec.exists():
        _write_log(log_dir, "pub_add.log", "ERROR: pubspec.yaml not found\n")
        return 1

    # flutter pub add supports multiple packages in one call
    return _run_cmd(
        ["flutter", "pub", "add"] + packages,
        cwd=workspace,
        log_path=log_dir / "pub_add.log",
        timeout=300,
    )


# ---------------------------------------------------------------------------
# Platform → handler mapping
# ---------------------------------------------------------------------------

_HANDLERS = {
    "ios": _install_cocoapods,
    "android": _install_gradle,
    "web": _install_npm,
    "flutter": _install_pub,
    "uniapp": _install_npm,  # UniApp uses npm for plugin dependencies
}


# ---------------------------------------------------------------------------
# Utilities
# ---------------------------------------------------------------------------

def _run_cmd(cmd: list[str], cwd: Path, log_path: Path, timeout: int = 300) -> int:
    """Run a subprocess, logging output to file. Returns exit code."""
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with open(log_path, "w") as log_f:
        try:
            proc = subprocess.run(
                cmd,
                cwd=str(cwd),
                stdout=log_f,
                stderr=subprocess.STDOUT,
                check=False,
                timeout=timeout,
            )
            return proc.returncode
        except FileNotFoundError:
            log_f.write(f"ERROR: command not found: {cmd[0]}\n")
            return 127
        except subprocess.TimeoutExpired:
            log_f.write(f"ERROR: timeout ({timeout}s) exceeded\n")
            return 124


def _write_log(log_dir: Path, filename: str, content: str) -> None:
    """Write a simple log message to log_dir/filename."""
    log_dir.mkdir(parents=True, exist_ok=True)
    (log_dir / filename).write_text(content)
