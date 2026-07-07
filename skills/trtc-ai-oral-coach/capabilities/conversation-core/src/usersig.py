# -*- coding: utf-8 -*-
"""UserSig 三套签发（用户 / 机器人 / 数字人）—— 复用腾讯云官方 TLSSigAPIv2。"""
from __future__ import annotations

from . import TLSSigAPIv2  # noqa: F401  —— 同目录官方库


def _api(sdk_app_id: int, secret: str):
    return TLSSigAPIv2.TLSSigAPIv2(sdk_app_id, secret)


def gen_user_sig(sdk_app_id: int, sdk_secret_key: str, user_id: str,
                 expire_seconds: int = 86400) -> str:
    if not user_id or len(user_id) > 32:
        raise ValueError(f"invalid userId: {user_id!r}")
    return _api(sdk_app_id, sdk_secret_key).genUserSig(user_id, expire_seconds)


def sign_trio(sdk_app_id: int, sdk_secret_key: str, user_id: str,
              expire_seconds: int = 86400) -> dict:
    """一次签三套：真人用户 / AI 机器人 / 数字人。"""
    robot_id  = f"{user_id}_robot"
    avatar_id = f"{user_id}_avatar"
    api = _api(sdk_app_id, sdk_secret_key)
    return {
        "sdkappid":        sdk_app_id,
        "user_id":         user_id,
        "user_sig":        api.genUserSig(user_id, expire_seconds),
        "robot_user_id":   robot_id,
        "robot_user_sig":  api.genUserSig(robot_id, expire_seconds),
        "avatar_user_id":  avatar_id,
        "avatar_user_sig": api.genUserSig(avatar_id, expire_seconds),
    }
