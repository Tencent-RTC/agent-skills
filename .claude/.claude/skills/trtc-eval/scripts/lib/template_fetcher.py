"""Template fetcher — copies platform template to workspace."""
import shutil
from pathlib import Path

PLATFORM_TO_DIR = {"ios": "ios-demo", "android": "android-demo", "web": "web-demo"}


def copy_template(platform: str, case_dir: Path, templates_root: Path) -> Path:
    """Copy templates/{platform}-demo/ to {case_dir}/workspace/.

    Returns the workspace path.
    """
    dir_name = PLATFORM_TO_DIR.get(platform)
    if dir_name is None:
        raise ValueError(f"Unknown platform: {platform}")
    src = templates_root / dir_name
    if not (src / "INJECTION.json").exists():
        raise FileNotFoundError(
            f"{src}/INJECTION.json missing — run ./bootstrap.sh first"
        )
    dst = case_dir / "workspace"
    if dst.exists():
        shutil.rmtree(dst)
    shutil.copytree(
        src, dst, symlinks=False,
        ignore=shutil.ignore_patterns(
            "build", "DerivedData", "node_modules", ".gradle", "Pods/Pods.xcodeproj",
            # _builtin/ is the source pool that flow_codegen.generate reads at
            # build time. Each case's workspace only needs the specific .ts
            # files its DSL references — flow_codegen copies (and rewrites)
            # them into workspace/src/autorun/ directly. Keeping _builtin/
            # out of the workspace avoids shipping unused builtin code and
            # avoids shadowing the rewritten copies.
            "_builtin",
        ),
    )
    # Copy pinned_commit for audit
    pinned_meta = dst / ".eval-meta"
    pinned_meta.mkdir(exist_ok=True)
    (pinned_meta / "template_sha.txt").write_text(
        (src / "INJECTION.json").read_text()
    )
    return dst
