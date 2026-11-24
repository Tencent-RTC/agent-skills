"""Platform adapters registry."""
from .base import PlatformAdapter, Device
from .ios import IOSAdapter
from .android import AndroidAdapter
from .web import WebAdapter

_ADAPTERS: dict[str, type[PlatformAdapter]] = {
    "ios": IOSAdapter,
    "android": AndroidAdapter,
    "web": WebAdapter,
}


def get_adapter(platform: str) -> PlatformAdapter:
    """Return a PlatformAdapter instance for the given platform."""
    cls = _ADAPTERS.get(platform)
    if cls is None:
        raise ValueError(f"Unsupported platform: {platform}. Available: {list(_ADAPTERS.keys())}")
    return cls()
