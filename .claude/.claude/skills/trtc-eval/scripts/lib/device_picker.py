"""Device picker — selects a device based on platform and policy."""
import subprocess

from scripts.lib.platforms import get_adapter
from scripts.lib.platforms.base import Device

POLICIES = {"prefer-real", "prefer-simulator", "real-only", "simulator-only"}

_sdk_version_cache: str | None = None


def _get_ios_sdk_version() -> str:
    """Return the current Xcode iphonesimulator SDK version (e.g. '26.1')."""
    global _sdk_version_cache
    if _sdk_version_cache is not None:
        return _sdk_version_cache
    try:
        proc = subprocess.run(
            ["xcrun", "--sdk", "iphonesimulator", "--show-sdk-version"],
            capture_output=True, text=True, check=False,
        )
        if proc.returncode == 0:
            _sdk_version_cache = proc.stdout.strip()
        else:
            _sdk_version_cache = ""
    except FileNotFoundError:
        _sdk_version_cache = ""
    return _sdk_version_cache


def _runtime_matches_sdk(d: Device, sdk_version: str) -> bool:
    """Check if a simulator's runtime matches the given SDK version."""
    if not sdk_version:
        return True  # Can't determine — don't penalize
    # runtime format: com.apple.CoreSimulator.SimRuntime.iOS-26-1
    # sdk_version format: 26.1
    runtime_suffix = "iOS-" + sdk_version.replace(".", "-")
    runtime = d.extra.get("runtime", "")
    return runtime_suffix in runtime


def _sort_key(d: Device, policy: str, sdk_version: str) -> tuple:
    """Build a composite sort key: (kind_pref, sdk_match, booted_state)."""
    # Kind preference
    if policy in ("prefer-real", "real-only"):
        kind_rank = 0 if d.kind == "real" else 1
    else:
        kind_rank = 0 if d.kind == "simulator" else 1

    # SDK compatibility (0=match, 1=mismatch)
    sdk_rank = 0 if _runtime_matches_sdk(d, sdk_version) else 1

    # Boot state (0=Booted, 1=Shutdown)
    boot_rank = 0 if d.extra.get("state") == "Booted" else 1

    return (kind_rank, sdk_rank, boot_rank)


def pick(platform: str, policy: str = "prefer-simulator") -> Device | None:
    """Pick a device for the given platform according to EVAL_DEVICE_POLICY.

    Returns None if no suitable device is available.
    Priority order: kind preference > SDK version match > Booted state.
    """
    if policy not in POLICIES:
        raise ValueError(f"invalid EVAL_DEVICE_POLICY: {policy}")
    adapter = get_adapter(platform)
    devices = adapter.discover_devices(policy)

    if policy == "real-only":
        devices = [d for d in devices if d.kind == "real"]
    elif policy == "simulator-only":
        devices = [d for d in devices if d.kind == "simulator"]

    # Get SDK version for iOS platform matching
    sdk_version = _get_ios_sdk_version() if platform == "ios" else ""

    devices.sort(key=lambda d: _sort_key(d, policy, sdk_version))

    return devices[0] if devices else None
