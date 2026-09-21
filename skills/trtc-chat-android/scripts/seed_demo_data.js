#!/usr/bin/env node
'use strict';
// Seed preset Chat demo data via Tencent Cloud IM REST API.
// Standard library only. Default mode is dry-run (zero network).

const crypto = require('crypto');
const zlib = require('zlib');
const https = require('https');

const CONFIG = {
  SDKAPPID: Number(process.env.TIM_SDKAPPID || 0),
  SECRETKEY: process.env.TIM_SECRETKEY || '',
  ADMIN: process.env.TIM_ADMIN || 'administrator',
  ADMIN_USERSIG: process.env.TIM_ADMIN_USERSIG || '',
  REGION: process.env.TIM_REGION || 'cn',
  CURRENT_USER: process.env.TIM_CURRENT_USER || '',
  USERSIG: '',
  USER1: {
    UserID: 'demo_alice',
    Nick: 'Alice',
    FaceUrl: 'https://im.sdk.qcloud.com/download/tuikit-resource/avatar/avatar_2.png',
  },
  USER2: {
    UserID: 'demo_bob',
    Nick: 'Bob',
    FaceUrl: 'https://im.sdk.qcloud.com/download/tuikit-resource/avatar/avatar_3.png',
  },
  USER3: {
    UserID: 'demo_charlie',
    Nick: 'Charlie',
    FaceUrl: 'https://im.sdk.qcloud.com/download/tuikit-resource/avatar/avatar_4.png',
  },
  GROUP: {
    GroupId: 'DemoPublicGroup',
    Name: 'Demo Public Group',
    FaceUrl: 'https://im.sdk.qcloud.com/download/tuikit-resource/group-avatar/group_avatar_11.png',
  },
  MSG_U1_TO_U2: 'Hi Bob! This is Alice. Welcome to the Chat demo.',
  MSG_U2_TO_U1: 'Hi Alice! Glad to join. The Chat UIKit looks great.',
  MSG_GROUP: 'Welcome to the demo group! Feel free to say hello.',
};

function currentUser() {
  return String(CONFIG.CURRENT_USER || '').trim();
}

function demoCandidates() {
  return [CONFIG.USER1, CONFIG.USER2, CONFIG.USER3];
}

function selectedPartners() {
  const uid = currentUser();
  return demoCandidates().filter((user) => user.UserID !== uid).slice(0, 2);
}

function participantIds() {
  const partners = selectedPartners().map((user) => user.UserID);
  const uid = currentUser();
  return uid ? [uid].concat(partners) : partners;
}

function groupId() {
  const uid = currentUser();
  if (!uid) return CONFIG.GROUP.GroupId;
  const digest = crypto.createHash('sha256').update(uid, 'utf8').digest('hex').slice(0, 12);
  return 'DemoPublicGroup_' + digest;
}

function groupOwner() {
  return currentUser() || selectedPartners()[0].UserID;
}

function groupMemberIds() {
  const owner = groupOwner();
  return participantIds().filter((uid) => uid !== owner);
}

function friendshipPairs() {
  const uid = currentUser();
  const partners = selectedPartners().map((user) => user.UserID);
  if (!uid) return [[partners[0], partners[1]], [partners[1], partners[0]]];
  const pairs = [];
  for (const partner of partners) {
    pairs.push([uid, partner], [partner, uid]);
  }
  return pairs;
}

function c2cMessages() {
  const uid = currentUser();
  const partners = selectedPartners();
  if (!uid) {
    return [
      [partners[0].UserID, partners[1].UserID, CONFIG.MSG_U1_TO_U2],
      [partners[1].UserID, partners[0].UserID, CONFIG.MSG_U2_TO_U1],
    ];
  }
  const messages = [];
  for (const partner of partners) {
    messages.push(
      [partner.UserID, uid, "Hi! I'm " + partner.Nick + '. Welcome to the Chat demo.'],
      [uid, partner.UserID, 'Hi ' + partner.Nick + '! Glad to try the Chat UIKit.']
    );
  }
  return messages;
}

function groupMessageSender() {
  return selectedPartners()[0].UserID;
}

const REGION_HOST = {
  cn: 'console.tim.qq.com',
  sgp: 'adminapisgp.im.qcloud.com',
  kr: 'adminapikr.im.qcloud.com',
  jpn: 'adminapijpn.im.qcloud.com',
  ger: 'adminapiger.im.qcloud.com',
  usa: 'adminapiusa.im.qcloud.com',
  idn: 'adminapiidn.im.qcloud.com',
  ksa: 'adminapiksa.im.qcloud.com',
};

const ADD_SOURCE = 'AddSource_Type_Demo';
const GROUP_EXISTS_CODES = { 10025: true };
let dieThrows = false;
function expectedCalls() {
  const calls = [];
  if (currentUser()) calls.push('v4/im_open_login_svc/account_check');
  calls.push(
    'v4/im_open_login_svc/multiaccount_import',
    'v4/im_open_login_svc/account_check'
  );
  calls.push(...friendshipPairs().map(() => 'v4/sns/friend_import'));
  calls.push(...friendshipPairs().map(() => 'v4/sns/friend_get_list'));
  calls.push(
    'v4/group_open_http_svc/create_group',
    'v4/group_open_http_svc/get_group_info',
    'v4/group_open_http_svc/get_role_in_group'
  );
  calls.push(...c2cMessages().map(() => 'v4/openim/sendmsg'));
  calls.push(
    'v4/group_open_http_svc/send_group_msg',
    'v4/group_open_http_svc/group_msg_get_simple'
  );
  return calls;
}

function out(msg) {
  process.stdout.write((msg === undefined ? '' : msg) + '\n');
}

function die(label, resp) {
  if (dieThrows) throw new Error(label);
  out('');
  out('[FAIL] ' + label);
  if (resp !== undefined) out(JSON.stringify(resp, null, 2));
  process.exit(1);
}

function genUsersig(sdkappid, secretkey, identifier, expire) {
  expire = expire || 86400 * 180;
  const curr = Math.floor(Date.now() / 1000);
  const raw =
    'TLS.identifier:' + identifier + '\n' +
    'TLS.sdkappid:' + sdkappid + '\n' +
    'TLS.time:' + curr + '\n' +
    'TLS.expire:' + expire + '\n';
  const sig = crypto.createHmac('sha256', secretkey).update(raw, 'utf8').digest('base64');
  const doc = {
    'TLS.ver': '2.0',
    'TLS.identifier': String(identifier),
    'TLS.sdkappid': Number(sdkappid),
    'TLS.expire': Number(expire),
    'TLS.time': Number(curr),
    'TLS.sig': sig,
  };
  const packed = zlib.deflateSync(Buffer.from(JSON.stringify(doc), 'utf8'));
  return packed.toString('base64').replace(/\+/g, '*').replace(/\//g, '-').replace(/=/g, '_');
}

function rand32() {
  return 1 + Math.floor(Math.random() * 4294967295);
}

let apiPost = function (service, command, body) {
  return httpPost(service, command, body);
};

function httpPost(service, command, body) {
  return new Promise((resolve) => {
    const host = REGION_HOST[CONFIG.REGION] || REGION_HOST.cn;
    const qs = new URLSearchParams({
      sdkappid: String(CONFIG.SDKAPPID),
      identifier: CONFIG.ADMIN,
      usersig: CONFIG.USERSIG,
      random: String(rand32()),
      contenttype: 'json',
    }).toString();
    const data = Buffer.from(JSON.stringify(body), 'utf8');
    const req = https.request(
      {
        host: host,
        path: '/' + service + '/' + command + '?' + qs,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': data.length },
        timeout: 20000,
      },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (text += c));
        res.on('end', () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            die('HTTP ' + res.statusCode + ' when calling ' + service + '/' + command + '\n' + text);
          }
          try {
            resolve(JSON.parse(text));
          } catch (e) {
            die('Non-JSON response from ' + service + '/' + command + ':\n' + text);
          }
        });
      }
    );
    req.on('error', (e) => die('Network error when calling ' + service + '/' + command + ': ' + e.message));
    req.on('timeout', () => {
      req.destroy();
      die('Timeout when calling ' + service + '/' + command);
    });
    req.write(data);
    req.end();
  });
}

function assertOk(resp, label) {
  if (resp.ActionStatus !== 'OK' || Number(resp.ErrorCode) !== 0) die(label, resp);
}

async function step1() {
  const uid = currentUser();
  const partners = selectedPartners();
  out('==> Step 1/5: prepare users');
  if (uid) {
    out('    [CHECK] v4/im_open_login_svc/account_check (' + uid + ')');
    const existing = await apiPost('v4/im_open_login_svc', 'account_check', {
      CheckItem: [{ UserID: uid }],
    });
    assertOk(existing, 'current user account_check failed');
    const currentStatus = {};
    (existing.ResultItem || []).forEach((it) => (currentStatus[it.UserID] = it.AccountStatus));
    if (currentStatus[uid] !== 'Imported') {
      die('current user ' + uid + ' is not imported; log in or import it before creating demo data', existing);
    }
    out('    [CHECK] current user ' + uid + ' = Imported');
  }

  out('    [CALL] v4/im_open_login_svc/multiaccount_import');
  const resp = await apiPost('v4/im_open_login_svc', 'multiaccount_import', {
    AccountList: partners.map((user) => ({
      UserID: user.UserID,
      Nick: user.Nick,
      FaceUrl: user.FaceUrl,
    })),
  });
  assertOk(resp, 'import users failed');
  const fails = resp.FailAccounts || [];
  if (fails.length) die('user import failed: ' + fails.join(', '), resp);
  out('    [OK] import request succeeded');

  out('    [CHECK] v4/im_open_login_svc/account_check');
  const chk = await apiPost('v4/im_open_login_svc', 'account_check', {
    CheckItem: participantIds().map((userId) => ({ UserID: userId })),
  });
  assertOk(chk, 'account_check failed');
  const status = {};
  (chk.ResultItem || []).forEach((it) => (status[it.UserID] = it.AccountStatus));
  for (const userId of participantIds()) {
    if (status[userId] !== 'Imported') {
      die('account ' + userId + ' not imported (status=' + status[userId] + ')', chk);
    }
    out('    [CHECK] ' + userId + ' = Imported');
  }
  out('    [PASS] step 1');
  out('');
}

async function importFriend(fromAcc, toAcc) {
  const resp = await apiPost('v4/sns', 'friend_import', {
    From_Account: fromAcc,
    AddFriendItem: [{ To_Account: toAcc, AddSource: ADD_SOURCE }],
  });
  assertOk(resp, 'friend_import ' + fromAcc + ' -> ' + toAcc + ' failed');
  const items = resp.ResultItem || [];
  if (!items.length || Number(items[0].ResultCode) !== 0) {
    die('friend_import ' + fromAcc + ' -> ' + toAcc + ' failed', resp);
  }
}

async function checkFriend(fromAcc, toAcc) {
  const resp = await apiPost('v4/sns', 'friend_get_list', {
    From_Account: fromAcc,
    To_Account: [toAcc],
    TagList: ['Tag_Profile_IM_Nick', 'Tag_SNS_IM_Remark'],
  });
  assertOk(resp, 'friend_get_list ' + fromAcc + ' -> ' + toAcc + ' failed');
  for (const it of resp.InfoItem || []) {
    if (it.To_Account === toAcc && Number(it.ResultCode) === 0) return;
  }
  die('friend relation missing: ' + fromAcc + ' -> ' + toAcc, resp);
}

async function step2() {
  const pairs = friendshipPairs();
  out('==> Step 2/5: import friend relations');
  for (const [fromAcc, toAcc] of pairs) {
    out('    [CALL] v4/sns/friend_import (' + fromAcc + ' -> ' + toAcc + ')');
    await importFriend(fromAcc, toAcc);
  }
  out('    [OK] friend import succeeded');

  out('    [CHECK] v4/sns/friend_get_list');
  for (const [fromAcc, toAcc] of pairs) {
    await checkFriend(fromAcc, toAcc);
    out('    [CHECK] ' + fromAcc + ' contains ' + toAcc);
  }
  out('    [PASS] step 2');
  out('');
}

async function step3() {
  const g = CONFIG.GROUP;
  const targetGroupId = groupId();
  out('==> Step 3/5: create or reuse Public group');
  out('    [CALL] v4/group_open_http_svc/create_group');
  const body = {
    Owner_Account: groupOwner(),
    Type: 'Public',
    Name: g.Name,
    FaceUrl: g.FaceUrl,
    MemberList: groupMemberIds().map((uid) => ({ Member_Account: uid })),
  };
  if (targetGroupId) body.GroupId = targetGroupId;

  const resp = await apiPost('v4/group_open_http_svc', 'create_group', body);
  const errorCode = Number(resp.ErrorCode);
  let groupIdValue;
  if (errorCode === 0) {
    groupIdValue = resp.GroupId;
    out('    [OK] group created GroupId=' + groupIdValue);
  } else if (GROUP_EXISTS_CODES[errorCode] && targetGroupId) {
    groupIdValue = targetGroupId;
    out('    [OK] group exists, reuse GroupId=' + groupIdValue + ' (ErrorCode=' + errorCode + ')');
  } else {
    die('create_group failed', resp);
  }

  out('    [CHECK] v4/group_open_http_svc/get_group_info');
  const chk = await apiPost('v4/group_open_http_svc', 'get_group_info', { GroupIdList: [groupIdValue] });
  assertOk(chk, 'get_group_info failed');
  const infos = chk.GroupInfo || [];
  if (!infos.length || Number(infos[0].ErrorCode) !== 0) {
    die('group ' + groupIdValue + ' missing or unavailable', chk);
  }
  if (Number(infos[0].MemberNum) !== participantIds().length) {
    die('group ' + groupIdValue + ' expected ' + participantIds().length + ' members', chk);
  }
  out('    [CHECK] group exists: ' + infos[0].GroupId + ' (Type=' + infos[0].Type + ', members=' + infos[0].MemberNum + ')');

  out('    [CHECK] v4/group_open_http_svc/get_role_in_group');
  const rolesResp = await apiPost('v4/group_open_http_svc', 'get_role_in_group', {
    GroupId: groupIdValue,
    User_Account: participantIds(),
  });
  assertOk(rolesResp, 'get_role_in_group failed');
  const roles = {};
  (rolesResp.UserIdList || []).forEach((item) => (roles[item.Member_Account] = item.Role));
  if (roles[groupOwner()] !== 'Owner') die('group ' + groupIdValue + ' owner mismatch', rolesResp);
  for (const member of groupMemberIds()) {
    if (roles[member] !== 'Member' && roles[member] !== 'Admin') {
      die('group ' + groupIdValue + ' missing member ' + member, rolesResp);
    }
  }
  out('    [CHECK] owner and members match the plan');
  out('    [PASS] step 3');
  out('');
  return groupIdValue;
}

async function sendC2C(fromAcc, toAcc, text) {
  const resp = await apiPost('v4/openim', 'sendmsg', {
    SyncOtherMachine: 1,
    From_Account: fromAcc,
    To_Account: toAcc,
    MsgRandom: rand32(),
    MsgBody: [{ MsgType: 'TIMTextElem', MsgContent: { Text: text } }],
  });
  assertOk(resp, 'sendmsg ' + fromAcc + ' -> ' + toAcc + ' failed');
  if (!resp.MsgKey) die('sendmsg ' + fromAcc + ' -> ' + toAcc + ' missing MsgKey', resp);
  return resp.MsgKey;
}

async function step4() {
  out('==> Step 4/5: send C2C text');
  for (const [fromAcc, toAcc, text] of c2cMessages()) {
    out('    [CALL] v4/openim/sendmsg (' + fromAcc + ' -> ' + toAcc + ')');
    const key = await sendC2C(fromAcc, toAcc, text);
    out('    [CHECK] sent MsgKey=' + key);
  }
  out('    [PASS] step 4');
  out('');
}

async function step5(groupId) {
  const sender = groupMessageSender(), text = CONFIG.MSG_GROUP;
  out('==> Step 5/5: send group text');
  out('    [CALL] v4/group_open_http_svc/send_group_msg');
  const resp = await apiPost('v4/group_open_http_svc', 'send_group_msg', {
    GroupId: groupId,
    From_Account: sender,
    Random: rand32(),
    MsgBody: [{ MsgType: 'TIMTextElem', MsgContent: { Text: text } }],
  });
  assertOk(resp, 'send_group_msg failed');
  out('    [OK] group message sent MsgSeq=' + resp.MsgSeq);

  out('    [CHECK] v4/group_open_http_svc/group_msg_get_simple');
  const chk = await apiPost('v4/group_open_http_svc', 'group_msg_get_simple', {
    GroupId: groupId,
    ReqMsgNumber: 10,
  });
  assertOk(chk, 'group_msg_get_simple failed');
  let found = false;
  for (const m of chk.RspMsgList || []) {
    for (const elem of m.MsgBody || []) {
      if (elem.MsgType === 'TIMTextElem' && elem.MsgContent && elem.MsgContent.Text === text) {
        found = true;
        break;
      }
    }
    if (found) break;
  }
  if (!found) die('group history missing the sent text', chk);
  out('    [CHECK] group history contains the message');
  out('    [PASS] step 5');
  out('');
}

async function runSteps() {
  await step1();
  await step2();
  const groupId = await step3();
  await step4();
  await step5(groupId);
  return groupId;
}

function regionHost() {
  if (!REGION_HOST[CONFIG.REGION]) {
    die('unknown region=' + CONFIG.REGION + ', expected: ' + Object.keys(REGION_HOST).join(', '));
  }
  return REGION_HOST[CONFIG.REGION];
}

function printPlan(mode) {
  const uid = currentUser();
  const pairs = friendshipPairs();
  const messages = c2cMessages();
  out('MODE: ' + mode);
  out('HOST: ' + regionHost());
  out('CURRENT_USER: ' + (uid || '(none)'));
  out('USERS: ' + participantIds().join(','));
  out('IMPORTED_USERS: ' + selectedPartners().map((user) => user.UserID).join(','));
  out('LOGIN_USER: ' + (uid || selectedPartners()[0].UserID));
  out('GROUP: ' + groupId());
  out('GROUP_OWNER: ' + groupOwner());
  out('GROUP_MEMBERS: ' + groupMemberIds().join(','));
  out('FRIENDS: ' + pairs.map((pair) => pair[0] + '->' + pair[1]).join(','));
  out('C2C: ' + messages.map((item) => item[0] + '->' + item[1]).join(','));
  out('GROUP_MESSAGE_FROM: ' + groupMessageSender());
  out('WARNING: remote writes create real data; repeated apply adds messages');
  out(uid
    ? 'PLAN 1: verify current user -> multiaccount_import -> account_check'
    : 'PLAN 1: multiaccount_import -> account_check');
  out('PLAN 2: friend_import x' + pairs.length + ' -> friend_get_list x' + pairs.length);
  out('PLAN 3: create_group -> get_group_info -> get_role_in_group');
  out('PLAN 4: sendmsg x' + messages.length);
  out('PLAN 5: send_group_msg -> group_msg_get_simple');
  if (mode === 'DRY-RUN') {
    out('DRY-RUN: no network requests were sent');
  }
}

function prepareApplyCredentials() {
  if (!Number.isFinite(CONFIG.SDKAPPID) || !Number.isInteger(CONFIG.SDKAPPID) || CONFIG.SDKAPPID < 0) {
    die('invalid SDKAppID. Set TIM_SDKAPPID or --sdkappid to a positive integer.');
  }
  if (!CONFIG.SDKAPPID) die('missing SDKAppID. Set TIM_SDKAPPID or --sdkappid.');
  if (CONFIG.ADMIN_USERSIG) {
    CONFIG.USERSIG = CONFIG.ADMIN_USERSIG;
  } else if (CONFIG.SECRETKEY) {
    CONFIG.USERSIG = genUsersig(CONFIG.SDKAPPID, CONFIG.SECRETKEY, CONFIG.ADMIN);
  } else {
    die('missing credentials. Provide TIM_SECRETKEY/--secretkey or TIM_ADMIN_USERSIG/--usersig.');
  }
}

function mockSuccess(service, command, body, calls) {
  calls.push(service + '/' + command);
  const key = service + '/' + command;
  if (key === 'v4/im_open_login_svc/multiaccount_import') {
    const actualIds = (body.AccountList || []).map((item) => item.UserID);
    const expectedIds = selectedPartners().map((user) => user.UserID);
    if (JSON.stringify(actualIds) !== JSON.stringify(expectedIds) || actualIds.indexOf(currentUser()) >= 0) {
      die('self-test imported users mismatch', body);
    }
    return { ActionStatus: 'OK', ErrorCode: 0, FailAccounts: [] };
  }
  if (key === 'v4/im_open_login_svc/account_check') {
    const checkedIds = (body.CheckItem || []).map((item) => item.UserID);
    if (checkedIds.length === 1 && currentUser()
        && JSON.stringify(checkedIds) !== JSON.stringify([currentUser()])) {
      die('self-test current user check mismatch', body);
    }
    return {
      ActionStatus: 'OK',
      ErrorCode: 0,
      ResultItem: (body.CheckItem || []).map((it) => ({
        UserID: it.UserID,
        ResultCode: 0,
        AccountStatus: 'Imported',
      })),
    };
  }
  if (key === 'v4/sns/friend_import') {
    const toAcc = body.AddFriendItem[0].To_Account;
    const actualPair = [body.From_Account, toAcc];
    if (!friendshipPairs().some((pair) => JSON.stringify(pair) === JSON.stringify(actualPair))) {
      die('self-test friend pair mismatch', body);
    }
    return { ActionStatus: 'OK', ErrorCode: 0, ResultItem: [{ To_Account: toAcc, ResultCode: 0 }] };
  }
  if (key === 'v4/sns/friend_get_list') {
    const toAcc = body.To_Account[0];
    return { ActionStatus: 'OK', ErrorCode: 0, InfoItem: [{ To_Account: toAcc, ResultCode: 0 }] };
  }
  if (key === 'v4/group_open_http_svc/create_group') {
    const actualMembers = (body.MemberList || []).map((item) => item.Member_Account);
    if (body.Owner_Account !== groupOwner()
        || JSON.stringify(actualMembers) !== JSON.stringify(groupMemberIds())
        || body.GroupId !== groupId()) {
      die('self-test group request mismatch', body);
    }
    return { ActionStatus: 'OK', ErrorCode: 0, GroupId: body.GroupId || groupId() };
  }
  if (key === 'v4/group_open_http_svc/get_group_info') {
    const gid = body.GroupIdList[0];
    return {
      ActionStatus: 'OK',
      ErrorCode: 0,
      GroupInfo: [{
        GroupId: gid,
        ErrorCode: 0,
        Type: 'Public',
        Name: CONFIG.GROUP.Name,
        MemberNum: participantIds().length,
      }],
    };
  }
  if (key === 'v4/group_open_http_svc/get_role_in_group') {
    if (body.GroupId !== groupId()
        || JSON.stringify(body.User_Account) !== JSON.stringify(participantIds())) {
      die('self-test group role request mismatch', body);
    }
    return {
      ActionStatus: 'OK',
      ErrorCode: 0,
      UserIdList: participantIds().map((uid) => ({
        Member_Account: uid,
        Role: uid === groupOwner() ? 'Owner' : 'Member',
      })),
    };
  }
  if (key === 'v4/openim/sendmsg') {
    const actual = [
      body.From_Account,
      body.To_Account,
      body.MsgBody && body.MsgBody[0] && body.MsgBody[0].MsgContent
        ? body.MsgBody[0].MsgContent.Text
        : undefined,
    ];
    if (!c2cMessages().some((message) => JSON.stringify(message) === JSON.stringify(actual))) {
      die('self-test C2C request mismatch', body);
    }
    return { ActionStatus: 'OK', ErrorCode: 0, MsgKey: 'key_' + body.To_Account };
  }
  if (key === 'v4/group_open_http_svc/send_group_msg') {
    if (body.GroupId !== groupId() || body.From_Account !== groupMessageSender()) {
      die('self-test group message request mismatch', body);
    }
    return { ActionStatus: 'OK', ErrorCode: 0, MsgSeq: 1 };
  }
  if (key === 'v4/group_open_http_svc/group_msg_get_simple') {
    return {
      ActionStatus: 'OK',
      ErrorCode: 0,
      RspMsgList: [{
        From_Account: groupMessageSender(),
        MsgBody: [{ MsgType: 'TIMTextElem', MsgContent: { Text: CONFIG.MSG_GROUP } }],
      }],
    };
  }
  die('unexpected mock call ' + key);
}

async function selfTest() {
  const originalCurrentUser = CONFIG.CURRENT_USER;
  const expectedPartners = {
    '': ['demo_alice', 'demo_bob'],
    customer_8472: ['demo_alice', 'demo_bob'],
    demo_alice: ['demo_bob', 'demo_charlie'],
  };
  for (const testCurrentUser of ['', 'customer_8472', 'demo_alice']) {
    CONFIG.CURRENT_USER = testCurrentUser;
    const actualPartners = selectedPartners().map((user) => user.UserID);
    if (JSON.stringify(actualPartners) !== JSON.stringify(expectedPartners[testCurrentUser])) {
      die('self-test partner selection mismatch', actualPartners);
    }
    const calls = [];
    apiPost = function (service, command, body) {
      return Promise.resolve(mockSuccess(service, command, body, calls));
    };
    const gid = await runSteps();
    if (calls.join('\n') !== expectedCalls().join('\n')) {
      die('self-test call order mismatch: ' + JSON.stringify(calls));
    }
    if (testCurrentUser && participantIds().indexOf(testCurrentUser) < 0) {
      die('self-test current user missing from participants');
    }
    if (gid !== groupId()) {
      die('self-test group id mismatch', { expected: groupId(), actual: gid });
    }
  }

  CONFIG.CURRENT_USER = 'customer_8472';
  const missingCalls = [];
  apiPost = function (service, command, body) {
    const key = service + '/' + command;
    if (key === 'v4/im_open_login_svc/account_check' && (body.CheckItem || []).length === 1) {
      missingCalls.push(key);
      return Promise.resolve({
        ActionStatus: 'OK',
        ErrorCode: 0,
        ResultItem: [{
          UserID: currentUser(),
          ResultCode: 0,
          AccountStatus: 'NotImported',
        }],
      });
    }
    return Promise.resolve(mockSuccess(service, command, body, missingCalls));
  };
  dieThrows = true;
  let missingUserFailed = false;
  try {
    await step1();
  } catch (e) {
    missingUserFailed = Boolean(e && String(e.message).indexOf('not imported') >= 0);
  } finally {
    dieThrows = false;
  }
  if (!missingUserFailed) die('self-test expected an unimported current user to stop');

  const reuseCalls = [];
  CONFIG.CURRENT_USER = 'customer_8472';
  apiPost = function (service, command, body) {
    const key = service + '/' + command;
    if (key === 'v4/group_open_http_svc/create_group') {
      reuseCalls.push(key);
      return Promise.resolve({ ActionStatus: 'FAIL', ErrorCode: 10025, ErrorInfo: 'used' });
    }
    return Promise.resolve(mockSuccess(service, command, body, reuseCalls));
  };
  const gid = await step3();
  if (gid !== groupId()) die('self-test group reuse failed', { GroupId: gid });
  if (reuseCalls.join(',') !== 'v4/group_open_http_svc/create_group,v4/group_open_http_svc/get_group_info,v4/group_open_http_svc/get_role_in_group') {
    die('self-test reuse call order mismatch: ' + JSON.stringify(reuseCalls));
  }
  CONFIG.CURRENT_USER = originalCurrentUser;
  apiPost = function (service, command, body) {
    return httpPost(service, command, body);
  };
  out('SELF-TEST PASS');
}

function printHelp() {
  out('Usage: node seed_demo_data.js [--sdkappid N] [--secretkey K] [--admin A] [--usersig S] [--region R] [--current-user ID] [--apply] [--self-test]');
  out('Default mode is dry-run (zero network). Use --apply to execute remote writes.');
  out('Environment: TIM_SDKAPPID, TIM_SECRETKEY, TIM_ADMIN, TIM_ADMIN_USERSIG, TIM_REGION, TIM_CURRENT_USER.');
  out('Region keys: ' + Object.keys(REGION_HOST).join(', '));
}

function requireArg(argv, index, name) {
  if (index >= argv.length || String(argv[index]).indexOf('--') === 0) {
    die('missing value for ' + name);
  }
  return argv[index];
}

function parseArgs() {
  const a = process.argv.slice(2);
  const flags = { apply: false, selfTest: false, help: false };
  for (let i = 0; i < a.length; i++) {
    const k = a[i];
    if (k === '--sdkappid') CONFIG.SDKAPPID = Number(requireArg(a, ++i, '--sdkappid'));
    else if (k === '--secretkey') CONFIG.SECRETKEY = requireArg(a, ++i, '--secretkey');
    else if (k === '--admin') CONFIG.ADMIN = requireArg(a, ++i, '--admin');
    else if (k === '--usersig') CONFIG.ADMIN_USERSIG = requireArg(a, ++i, '--usersig');
    else if (k === '--region') CONFIG.REGION = requireArg(a, ++i, '--region');
    else if (k === '--current-user') CONFIG.CURRENT_USER = requireArg(a, ++i, '--current-user');
    else if (k === '--apply') flags.apply = true;
    else if (k === '--self-test') flags.selfTest = true;
    else if (k === '-h' || k === '--help') flags.help = true;
    else die('unknown argument: ' + k);
  }
  return flags;
}

async function main() {
  const flags = parseArgs();
  if (typeof CONFIG.REGION === 'string') {
    CONFIG.REGION = CONFIG.REGION.trim() || 'cn';
  }
  CONFIG.CURRENT_USER = currentUser();
  if (flags.help) {
    printHelp();
    return;
  }
  if (flags.selfTest) {
    await selfTest();
    return;
  }
  if (!flags.apply) {
    printPlan('DRY-RUN');
    return;
  }
  printPlan('APPLY');
  prepareApplyCredentials();
  await runSteps();
}

main().catch((e) => die('uncaught: ' + (e && e.stack ? e.stack : e)));
