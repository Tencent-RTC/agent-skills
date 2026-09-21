#!/usr/bin/env python3
# Seed preset Chat demo data via Tencent Cloud IM REST API.
# Standard library only. Default mode is dry-run (zero network).

import argparse
import base64
import hashlib
import hmac
import json
import os
import random
import sys
import time
import zlib
from urllib import error, parse, request


def parse_sdkappid(raw):
    if raw is None:
        return 0
    text = str(raw).strip()
    if text == "":
        return 0
    try:
        return int(text)
    except ValueError:
        return None


_sdkappid_env = parse_sdkappid(os.environ.get("TIM_SDKAPPID", ""))

CONFIG = {
    "SDKAPPID": _sdkappid_env if _sdkappid_env is not None else 0,
    "SDKAPPID_INVALID": _sdkappid_env is None,
    "SECRETKEY": os.environ.get("TIM_SECRETKEY", ""),
    "ADMIN": os.environ.get("TIM_ADMIN", "administrator"),
    "ADMIN_USERSIG": os.environ.get("TIM_ADMIN_USERSIG", ""),
    "REGION": os.environ.get("TIM_REGION", "cn"),
    "CURRENT_USER": os.environ.get("TIM_CURRENT_USER", ""),
    "USERSIG": "",
    "USER1": {
        "UserID": "demo_alice",
        "Nick": "Alice",
        "FaceUrl": "https://im.sdk.qcloud.com/download/tuikit-resource/avatar/avatar_2.png",
    },
    "USER2": {
        "UserID": "demo_bob",
        "Nick": "Bob",
        "FaceUrl": "https://im.sdk.qcloud.com/download/tuikit-resource/avatar/avatar_3.png",
    },
    "USER3": {
        "UserID": "demo_charlie",
        "Nick": "Charlie",
        "FaceUrl": "https://im.sdk.qcloud.com/download/tuikit-resource/avatar/avatar_4.png",
    },
    "GROUP": {
        "GroupId": "DemoPublicGroup",
        "Name": "Demo Public Group",
        "FaceUrl": "https://im.sdk.qcloud.com/download/tuikit-resource/group-avatar/group_avatar_11.png",
    },
    "MSG_U1_TO_U2": "Hi Bob! This is Alice. Welcome to the Chat demo.",
    "MSG_U2_TO_U1": "Hi Alice! Glad to join. The Chat UIKit looks great.",
    "MSG_GROUP": "Welcome to the demo group! Feel free to say hello.",
}


def current_user():
    return str(CONFIG.get("CURRENT_USER") or "").strip()


def demo_candidates():
    return [CONFIG["USER1"], CONFIG["USER2"], CONFIG["USER3"]]


def selected_partners():
    uid = current_user()
    candidates = [user for user in demo_candidates() if user["UserID"] != uid]
    return candidates[:2]


def participant_ids():
    partners = [user["UserID"] for user in selected_partners()]
    uid = current_user()
    return ([uid] + partners) if uid else partners


def group_id():
    uid = current_user()
    if not uid:
        return CONFIG["GROUP"]["GroupId"]
    digest = hashlib.sha256(uid.encode("utf-8")).hexdigest()[:12]
    return "DemoPublicGroup_" + digest


def group_owner():
    return current_user() or selected_partners()[0]["UserID"]


def group_member_ids():
    owner = group_owner()
    return [uid for uid in participant_ids() if uid != owner]


def friendship_pairs():
    uid = current_user()
    partners = [user["UserID"] for user in selected_partners()]
    if not uid:
        return [(partners[0], partners[1]), (partners[1], partners[0])]
    pairs = []
    for partner in partners:
        pairs.extend([(uid, partner), (partner, uid)])
    return pairs


def c2c_messages():
    uid = current_user()
    partners = selected_partners()
    if not uid:
        return [
            (partners[0]["UserID"], partners[1]["UserID"], CONFIG["MSG_U1_TO_U2"]),
            (partners[1]["UserID"], partners[0]["UserID"], CONFIG["MSG_U2_TO_U1"]),
        ]
    messages = []
    for partner in partners:
        messages.extend([
            (
                partner["UserID"],
                uid,
                "Hi! I'm %s. Welcome to the Chat demo." % partner["Nick"],
            ),
            (
                uid,
                partner["UserID"],
                "Hi %s! Glad to try the Chat UIKit." % partner["Nick"],
            ),
        ])
    return messages


def group_message_sender():
    return selected_partners()[0]["UserID"]


REGION_HOST = {
    "cn": "console.tim.qq.com",
    "sgp": "adminapisgp.im.qcloud.com",
    "kr": "adminapikr.im.qcloud.com",
    "jpn": "adminapijpn.im.qcloud.com",
    "ger": "adminapiger.im.qcloud.com",
    "usa": "adminapiusa.im.qcloud.com",
    "idn": "adminapiidn.im.qcloud.com",
    "ksa": "adminapiksa.im.qcloud.com",
}

ADD_SOURCE = "AddSource_Type_Demo"
GROUP_EXISTS_CODES = {10025}

_api_post_impl = None
_die_raises = False


def out(msg=""):
    print(msg, flush=True)


def die(label, resp=None):
    if _die_raises:
        raise RuntimeError(label)
    out("")
    out("[FAIL] " + label)
    if resp is not None:
        out(json.dumps(resp, ensure_ascii=False, indent=2))
    sys.exit(1)


def gen_usersig(sdkappid, secretkey, identifier, expire=86400 * 180):
    curr_time = int(time.time())
    raw = (
        "TLS.identifier:" + str(identifier) + "\n"
        + "TLS.sdkappid:" + str(sdkappid) + "\n"
        + "TLS.time:" + str(curr_time) + "\n"
        + "TLS.expire:" + str(expire) + "\n"
    )
    sig = base64.b64encode(
        hmac.new(secretkey.encode("utf-8"), raw.encode("utf-8"), hashlib.sha256).digest()
    ).decode("utf-8")
    doc = {
        "TLS.ver": "2.0",
        "TLS.identifier": str(identifier),
        "TLS.sdkappid": int(sdkappid),
        "TLS.expire": int(expire),
        "TLS.time": int(curr_time),
        "TLS.sig": sig,
    }
    compressed = zlib.compress(json.dumps(doc).encode("utf-8"))
    b64 = base64.b64encode(compressed).decode("utf-8")
    return b64.replace("+", "*").replace("/", "-").replace("=", "_")


def rand32():
    return random.randint(1, 4294967295)


def http_post(service, command, body):
    host = REGION_HOST.get(CONFIG["REGION"], REGION_HOST["cn"])
    query = parse.urlencode({
        "sdkappid": CONFIG["SDKAPPID"],
        "identifier": CONFIG["ADMIN"],
        "usersig": CONFIG["USERSIG"],
        "random": rand32(),
        "contenttype": "json",
    })
    url = "https://%s/%s/%s?%s" % (host, service, command, query)
    payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
    req = request.Request(
        url, data=payload, headers={"Content-Type": "application/json"}, method="POST"
    )
    try:
        with request.urlopen(req, timeout=20) as resp:
            if resp.status < 200 or resp.status >= 300:
                detail = resp.read().decode("utf-8", "ignore")
                die("HTTP %s when calling %s/%s\n%s" % (resp.status, service, command, detail))
            text = resp.read().decode("utf-8")
    except error.HTTPError as e:
        detail = e.read().decode("utf-8", "ignore")
        die("HTTP %s when calling %s/%s\n%s" % (e.code, service, command, detail))
    except error.URLError as e:
        die("Network error when calling %s/%s: %s" % (service, command, e.reason))
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        die("Non-JSON response from %s/%s:\n%s" % (service, command, text))


def api_post(service, command, body):
    if _api_post_impl is not None:
        return _api_post_impl(service, command, body)
    return http_post(service, command, body)


def assert_ok(resp, label):
    if resp.get("ActionStatus") != "OK" or resp.get("ErrorCode", -1) != 0:
        die(label, resp)


def step1_import_users():
    uid = current_user()
    partners = selected_partners()
    out("==> Step 1/5: prepare users")
    if uid:
        out("    [CHECK] v4/im_open_login_svc/account_check (%s)" % uid)
        existing = api_post(
            "v4/im_open_login_svc",
            "account_check",
            {"CheckItem": [{"UserID": uid}]},
        )
        assert_ok(existing, "current user account_check failed")
        current_status = {
            it.get("UserID"): it.get("AccountStatus")
            for it in existing.get("ResultItem", [])
        }
        if current_status.get(uid) != "Imported":
            die(
                "current user %s is not imported; log in or import it before creating demo data"
                % uid,
                existing,
            )
        out("    [CHECK] current user %s = Imported" % uid)

    out("    [CALL] v4/im_open_login_svc/multiaccount_import")
    body = {
        "AccountList": [
            {
                "UserID": user["UserID"],
                "Nick": user["Nick"],
                "FaceUrl": user["FaceUrl"],
            }
            for user in partners
        ]
    }
    resp = api_post("v4/im_open_login_svc", "multiaccount_import", body)
    assert_ok(resp, "import users failed")
    fail_accounts = resp.get("FailAccounts") or []
    if fail_accounts:
        die("user import failed: %s" % ", ".join(fail_accounts), resp)
    out("    [OK] import request succeeded")

    out("    [CHECK] v4/im_open_login_svc/account_check")
    chk = api_post(
        "v4/im_open_login_svc",
        "account_check",
        {"CheckItem": [{"UserID": uid} for uid in participant_ids()]},
    )
    assert_ok(chk, "account_check failed")
    status = {it.get("UserID"): it.get("AccountStatus") for it in chk.get("ResultItem", [])}
    for uid in participant_ids():
        if status.get(uid) != "Imported":
            die("account %s not imported (status=%s)" % (uid, status.get(uid)), chk)
        out("    [CHECK] %s = Imported" % uid)
    out("    [PASS] step 1")
    out("")


def _import_friend(from_acc, to_acc):
    body = {
        "From_Account": from_acc,
        "AddFriendItem": [{"To_Account": to_acc, "AddSource": ADD_SOURCE}],
    }
    resp = api_post("v4/sns", "friend_import", body)
    assert_ok(resp, "friend_import %s -> %s failed" % (from_acc, to_acc))
    items = resp.get("ResultItem", [])
    if not items or items[0].get("ResultCode", -1) != 0:
        die("friend_import %s -> %s failed" % (from_acc, to_acc), resp)


def _check_friend(from_acc, to_acc):
    body = {
        "From_Account": from_acc,
        "To_Account": [to_acc],
        "TagList": ["Tag_Profile_IM_Nick", "Tag_SNS_IM_Remark"],
    }
    resp = api_post("v4/sns", "friend_get_list", body)
    assert_ok(resp, "friend_get_list %s -> %s failed" % (from_acc, to_acc))
    for it in resp.get("InfoItem", []):
        if it.get("To_Account") == to_acc and it.get("ResultCode", -1) == 0:
            return
    die("friend relation missing: %s -> %s" % (from_acc, to_acc), resp)


def step2_import_friends():
    pairs = friendship_pairs()
    out("==> Step 2/5: import friend relations")
    for from_acc, to_acc in pairs:
        out("    [CALL] v4/sns/friend_import (%s -> %s)" % (from_acc, to_acc))
        _import_friend(from_acc, to_acc)
    out("    [OK] friend import succeeded")

    out("    [CHECK] v4/sns/friend_get_list")
    for from_acc, to_acc in pairs:
        _check_friend(from_acc, to_acc)
        out("    [CHECK] %s contains %s" % (from_acc, to_acc))
    out("    [PASS] step 2")
    out("")


def step3_create_group():
    g = CONFIG["GROUP"]
    owner = group_owner()
    members = group_member_ids()
    target_group_id = group_id()
    out("==> Step 3/5: create or reuse Public group")
    out("    [CALL] v4/group_open_http_svc/create_group")
    body = {
        "Owner_Account": owner,
        "Type": "Public",
        "Name": g["Name"],
        "FaceUrl": g["FaceUrl"],
        "MemberList": [{"Member_Account": uid} for uid in members],
    }
    if target_group_id:
        body["GroupId"] = target_group_id

    resp = api_post("v4/group_open_http_svc", "create_group", body)
    error_code = resp.get("ErrorCode", -1)
    if error_code == 0:
        group_id_value = resp.get("GroupId")
        out("    [OK] group created GroupId=%s" % group_id_value)
    elif error_code in GROUP_EXISTS_CODES and target_group_id:
        group_id_value = target_group_id
        out("    [OK] group exists, reuse GroupId=%s (ErrorCode=%s)"
            % (group_id_value, error_code))
    else:
        die("create_group failed", resp)

    out("    [CHECK] v4/group_open_http_svc/get_group_info")
    chk = api_post(
        "v4/group_open_http_svc",
        "get_group_info",
        {"GroupIdList": [group_id_value]},
    )
    assert_ok(chk, "get_group_info failed")
    infos = chk.get("GroupInfo", [])
    if not infos or infos[0].get("ErrorCode", -1) != 0:
        die("group %s missing or unavailable" % group_id_value, chk)
    info0 = infos[0]
    try:
        member_num = int(info0.get("MemberNum"))
    except (TypeError, ValueError):
        member_num = -1
    expected_members = len(participant_ids())
    if member_num != expected_members:
        die("group %s expected %s members" % (group_id_value, expected_members), chk)
    out("    [CHECK] group exists: %s (Type=%s, members=%s)"
        % (info0.get("GroupId"), info0.get("Type"), info0.get("MemberNum")))

    out("    [CHECK] v4/group_open_http_svc/get_role_in_group")
    roles_resp = api_post(
        "v4/group_open_http_svc",
        "get_role_in_group",
        {"GroupId": group_id_value, "User_Account": participant_ids()},
    )
    assert_ok(roles_resp, "get_role_in_group failed")
    roles = {
        item.get("Member_Account"): item.get("Role")
        for item in roles_resp.get("UserIdList", [])
    }
    if roles.get(owner) != "Owner":
        die("group %s owner mismatch" % group_id_value, roles_resp)
    for member in members:
        if roles.get(member) not in {"Member", "Admin"}:
            die("group %s missing member %s" % (group_id_value, member), roles_resp)
    out("    [CHECK] owner and members match the plan")
    out("    [PASS] step 3")
    out("")
    return group_id_value


def _send_c2c(from_acc, to_acc, text):
    body = {
        "SyncOtherMachine": 1,
        "From_Account": from_acc,
        "To_Account": to_acc,
        "MsgRandom": rand32(),
        "MsgBody": [{"MsgType": "TIMTextElem", "MsgContent": {"Text": text}}],
    }
    resp = api_post("v4/openim", "sendmsg", body)
    assert_ok(resp, "sendmsg %s -> %s failed" % (from_acc, to_acc))
    if not resp.get("MsgKey"):
        die("sendmsg %s -> %s missing MsgKey" % (from_acc, to_acc), resp)
    return resp.get("MsgKey")


def step4_send_c2c_messages():
    out("==> Step 4/5: send C2C text")
    for from_acc, to_acc, text in c2c_messages():
        out("    [CALL] v4/openim/sendmsg (%s -> %s)" % (from_acc, to_acc))
        key = _send_c2c(from_acc, to_acc, text)
        out("    [CHECK] sent MsgKey=%s" % key)
    out("    [PASS] step 4")
    out("")


def step5_send_group_message(group_id):
    sender = group_message_sender()
    text = CONFIG["MSG_GROUP"]
    out("==> Step 5/5: send group text")
    out("    [CALL] v4/group_open_http_svc/send_group_msg")
    body = {
        "GroupId": group_id,
        "From_Account": sender,
        "Random": rand32(),
        "MsgBody": [{"MsgType": "TIMTextElem", "MsgContent": {"Text": text}}],
    }
    resp = api_post("v4/group_open_http_svc", "send_group_msg", body)
    assert_ok(resp, "send_group_msg failed")
    out("    [OK] group message sent MsgSeq=%s" % resp.get("MsgSeq"))

    out("    [CHECK] v4/group_open_http_svc/group_msg_get_simple")
    chk = api_post(
        "v4/group_open_http_svc",
        "group_msg_get_simple",
        {"GroupId": group_id, "ReqMsgNumber": 10},
    )
    assert_ok(chk, "group_msg_get_simple failed")
    found = False
    for m in chk.get("RspMsgList", []):
        for elem in m.get("MsgBody", []) or []:
            if elem.get("MsgType") == "TIMTextElem" \
                    and (elem.get("MsgContent") or {}).get("Text") == text:
                found = True
                break
        if found:
            break
    if not found:
        die("group history missing the sent text", chk)
    out("    [CHECK] group history contains the message")
    out("    [PASS] step 5")
    out("")


def run_steps():
    step1_import_users()
    step2_import_friends()
    group_id = step3_create_group()
    step4_send_c2c_messages()
    step5_send_group_message(group_id)
    return group_id


def region_host():
    region = CONFIG["REGION"]
    if region not in REGION_HOST:
        die("unknown region=%s, expected: %s" % (region, ", ".join(REGION_HOST.keys())))
    return REGION_HOST[region]


def print_plan(mode):
    uid = current_user()
    pairs = friendship_pairs()
    messages = c2c_messages()
    out("MODE: " + mode)
    out("HOST: " + region_host())
    out("CURRENT_USER: " + (uid or "(none)"))
    out("USERS: " + ",".join(participant_ids()))
    out("IMPORTED_USERS: " + ",".join(user["UserID"] for user in selected_partners()))
    out("LOGIN_USER: " + (uid or selected_partners()[0]["UserID"]))
    out("GROUP: " + group_id())
    out("GROUP_OWNER: " + group_owner())
    out("GROUP_MEMBERS: " + ",".join(group_member_ids()))
    out("FRIENDS: " + ",".join("%s->%s" % pair for pair in pairs))
    out("C2C: " + ",".join("%s->%s" % (item[0], item[1]) for item in messages))
    out("GROUP_MESSAGE_FROM: " + group_message_sender())
    out("WARNING: remote writes create real data; repeated apply adds messages")
    if uid:
        out("PLAN 1: verify current user -> multiaccount_import -> account_check")
    else:
        out("PLAN 1: multiaccount_import -> account_check")
    out("PLAN 2: friend_import x%s -> friend_get_list x%s"
        % (len(pairs), len(pairs)))
    out("PLAN 3: create_group -> get_group_info -> get_role_in_group")
    out("PLAN 4: sendmsg x%s" % len(messages))
    out("PLAN 5: send_group_msg -> group_msg_get_simple")
    if mode == "DRY-RUN":
        out("DRY-RUN: no network requests were sent")


def prepare_apply_credentials():
    if CONFIG.get("SDKAPPID_INVALID") or CONFIG["SDKAPPID"] < 0:
        die("invalid SDKAppID. Set TIM_SDKAPPID or --sdkappid to a positive integer.")
    if not CONFIG["SDKAPPID"]:
        die("missing SDKAppID. Set TIM_SDKAPPID or --sdkappid.")
    if CONFIG["ADMIN_USERSIG"]:
        CONFIG["USERSIG"] = CONFIG["ADMIN_USERSIG"]
    elif CONFIG["SECRETKEY"]:
        CONFIG["USERSIG"] = gen_usersig(
            CONFIG["SDKAPPID"], CONFIG["SECRETKEY"], CONFIG["ADMIN"]
        )
    else:
        die("missing credentials. Provide TIM_SECRETKEY/--secretkey or TIM_ADMIN_USERSIG/--usersig.")


def mock_success(service, command, body, calls):
    calls.append(service + "/" + command)
    key = service + "/" + command
    if key == "v4/im_open_login_svc/multiaccount_import":
        actual_ids = [item.get("UserID") for item in body.get("AccountList", [])]
        expected_ids = [user["UserID"] for user in selected_partners()]
        if actual_ids != expected_ids or current_user() in actual_ids:
            die("self-test imported users mismatch", body)
        return {"ActionStatus": "OK", "ErrorCode": 0, "FailAccounts": []}
    if key == "v4/im_open_login_svc/account_check":
        checked_ids = [item.get("UserID") for item in body.get("CheckItem", [])]
        if len(checked_ids) == 1 and current_user() and checked_ids != [current_user()]:
            die("self-test current user check mismatch", body)
        items = []
        for it in body.get("CheckItem", []):
            items.append({
                "UserID": it.get("UserID"),
                "ResultCode": 0,
                "AccountStatus": "Imported",
            })
        return {"ActionStatus": "OK", "ErrorCode": 0, "ResultItem": items}
    if key == "v4/sns/friend_import":
        pair = (body.get("From_Account"), body["AddFriendItem"][0].get("To_Account"))
        if pair not in friendship_pairs():
            die("self-test friend pair mismatch", body)
        to_acc = body["AddFriendItem"][0]["To_Account"]
        return {
            "ActionStatus": "OK",
            "ErrorCode": 0,
            "ResultItem": [{"To_Account": to_acc, "ResultCode": 0}],
        }
    if key == "v4/sns/friend_get_list":
        to_acc = body["To_Account"][0]
        return {
            "ActionStatus": "OK",
            "ErrorCode": 0,
            "InfoItem": [{"To_Account": to_acc, "ResultCode": 0}],
        }
    if key == "v4/group_open_http_svc/create_group":
        actual_members = [
            item.get("Member_Account") for item in body.get("MemberList", [])
        ]
        if body.get("Owner_Account") != group_owner() \
                or actual_members != group_member_ids() \
                or body.get("GroupId") != group_id():
            die("self-test group request mismatch", body)
        return {
            "ActionStatus": "OK",
            "ErrorCode": 0,
            "GroupId": body.get("GroupId") or group_id(),
        }
    if key == "v4/group_open_http_svc/get_group_info":
        gid = body["GroupIdList"][0]
        return {
            "ActionStatus": "OK",
            "ErrorCode": 0,
            "GroupInfo": [{
                "GroupId": gid,
                "ErrorCode": 0,
                "Type": "Public",
                "Name": CONFIG["GROUP"]["Name"],
                "MemberNum": len(participant_ids()),
            }],
        }
    if key == "v4/group_open_http_svc/get_role_in_group":
        if body.get("GroupId") != group_id() \
                or body.get("User_Account") != participant_ids():
            die("self-test group role request mismatch", body)
        return {
            "ActionStatus": "OK",
            "ErrorCode": 0,
            "UserIdList": [
                {
                    "Member_Account": uid,
                    "Role": "Owner" if uid == group_owner() else "Member",
                }
                for uid in participant_ids()
            ],
        }
    if key == "v4/openim/sendmsg":
        actual = (
            body.get("From_Account"),
            body.get("To_Account"),
            body.get("MsgBody", [{}])[0].get("MsgContent", {}).get("Text"),
        )
        if actual not in c2c_messages():
            die("self-test C2C request mismatch", body)
        return {"ActionStatus": "OK", "ErrorCode": 0, "MsgKey": "key_" + body["To_Account"]}
    if key == "v4/group_open_http_svc/send_group_msg":
        if body.get("GroupId") != group_id() \
                or body.get("From_Account") != group_message_sender():
            die("self-test group message request mismatch", body)
        return {"ActionStatus": "OK", "ErrorCode": 0, "MsgSeq": 1}
    if key == "v4/group_open_http_svc/group_msg_get_simple":
        return {
            "ActionStatus": "OK",
            "ErrorCode": 0,
            "RspMsgList": [{
                "From_Account": group_message_sender(),
                "MsgBody": [{
                    "MsgType": "TIMTextElem",
                    "MsgContent": {"Text": CONFIG["MSG_GROUP"]},
                }],
            }],
        }
    die("unexpected mock call %s" % key)


def expected_calls():
    calls = []
    if current_user():
        calls.append("v4/im_open_login_svc/account_check")
    calls.extend([
        "v4/im_open_login_svc/multiaccount_import",
        "v4/im_open_login_svc/account_check",
    ])
    calls.extend(["v4/sns/friend_import"] * len(friendship_pairs()))
    calls.extend(["v4/sns/friend_get_list"] * len(friendship_pairs()))
    calls.extend([
        "v4/group_open_http_svc/create_group",
        "v4/group_open_http_svc/get_group_info",
        "v4/group_open_http_svc/get_role_in_group",
    ])
    calls.extend(["v4/openim/sendmsg"] * len(c2c_messages()))
    calls.extend([
        "v4/group_open_http_svc/send_group_msg",
        "v4/group_open_http_svc/group_msg_get_simple",
    ])
    return calls


def self_test():
    global _api_post_impl, _die_raises
    original_current_user = CONFIG["CURRENT_USER"]
    expected_partners = {
        "": ["demo_alice", "demo_bob"],
        "customer_8472": ["demo_alice", "demo_bob"],
        "demo_alice": ["demo_bob", "demo_charlie"],
    }
    for test_current_user in ("", "customer_8472", "demo_alice"):
        CONFIG["CURRENT_USER"] = test_current_user
        actual_partners = [user["UserID"] for user in selected_partners()]
        if actual_partners != expected_partners[test_current_user]:
            die("self-test partner selection mismatch", actual_partners)
        calls = []

        def poster(service, command, body, target=calls):
            return mock_success(service, command, body, target)

        _api_post_impl = poster
        gid = run_steps()
        if calls != expected_calls():
            die("self-test call order mismatch: %s" % calls)
        if test_current_user and test_current_user not in participant_ids():
            die("self-test current user missing from participants")
        if gid != group_id():
            die("self-test group id mismatch", {"expected": group_id(), "actual": gid})

    CONFIG["CURRENT_USER"] = "customer_8472"
    missing_calls = []

    def missing_user_poster(service, command, body):
        key = service + "/" + command
        if key == "v4/im_open_login_svc/account_check" \
                and len(body.get("CheckItem", [])) == 1:
            missing_calls.append(key)
            return {
                "ActionStatus": "OK",
                "ErrorCode": 0,
                "ResultItem": [{
                    "UserID": current_user(),
                    "ResultCode": 0,
                    "AccountStatus": "NotImported",
                }],
            }
        return mock_success(service, command, body, missing_calls)

    _api_post_impl = missing_user_poster
    _die_raises = True
    missing_user_failed = False
    try:
        step1_import_users()
    except RuntimeError as exc:
        missing_user_failed = "not imported" in str(exc)
    finally:
        _die_raises = False
    if not missing_user_failed:
        die("self-test expected an unimported current user to stop")

    reuse_calls = []
    CONFIG["CURRENT_USER"] = "customer_8472"

    def reuse_poster(service, command, body):
        key = service + "/" + command
        if key == "v4/group_open_http_svc/create_group":
            reuse_calls.append(key)
            return {"ActionStatus": "FAIL", "ErrorCode": 10025, "ErrorInfo": "used"}
        return mock_success(service, command, body, reuse_calls)

    _api_post_impl = reuse_poster
    gid = step3_create_group()
    if gid != group_id():
        die("self-test group reuse failed", {"GroupId": gid})
    if reuse_calls != [
        "v4/group_open_http_svc/create_group",
        "v4/group_open_http_svc/get_group_info",
        "v4/group_open_http_svc/get_role_in_group",
    ]:
        die("self-test reuse call order mismatch: %s" % reuse_calls)
    CONFIG["CURRENT_USER"] = original_current_user
    _api_post_impl = None
    out("SELF-TEST PASS")


def parse_args():
    p = argparse.ArgumentParser(
        description=(
            "Seed preset Chat demo data via Tencent Cloud IM REST API. "
            "Default mode is dry-run (zero network). "
            "Environment: TIM_SDKAPPID, TIM_SECRETKEY, TIM_ADMIN, "
            "TIM_ADMIN_USERSIG, TIM_REGION, TIM_CURRENT_USER."
        )
    )
    p.add_argument("--sdkappid", type=int, default=None, help="Console SDKAppID")
    p.add_argument("--secretkey", help="Account secret key (used to sign admin UserSig)")
    p.add_argument("--admin", help="Admin identifier (default administrator)")
    p.add_argument("--usersig", help="Admin UserSig (skip local signing if provided)")
    p.add_argument("--region", help="Region key: " + ", ".join(REGION_HOST.keys()))
    p.add_argument("--current-user", help="Existing Chat userID at the center of demo data")
    p.add_argument("--apply", action="store_true", help="Execute remote writes")
    p.add_argument("--self-test", action="store_true", help="Offline mock of the five REST steps")
    return p.parse_args()


def apply_cli(args):
    if args.sdkappid is not None:
        CONFIG["SDKAPPID"] = args.sdkappid
        CONFIG["SDKAPPID_INVALID"] = False
    if args.secretkey is not None:
        CONFIG["SECRETKEY"] = args.secretkey
    if args.admin is not None:
        CONFIG["ADMIN"] = args.admin
    if args.usersig is not None:
        CONFIG["ADMIN_USERSIG"] = args.usersig
    if args.region is not None:
        CONFIG["REGION"] = args.region
    if args.current_user is not None:
        CONFIG["CURRENT_USER"] = args.current_user


def main():
    args = parse_args()
    apply_cli(args)
    if getattr(CONFIG["REGION"], "strip", None):
        CONFIG["REGION"] = (CONFIG["REGION"] or "").strip() or "cn"
    CONFIG["CURRENT_USER"] = current_user()
    if args.self_test:
        self_test()
        return
    if not args.apply:
        print_plan("DRY-RUN")
        return
    print_plan("APPLY")
    prepare_apply_credentials()
    run_steps()


if __name__ == "__main__":
    main()
