#!/usr/bin/env node
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// skills/trtc/runtime/continuation-notice.js
var continuation_notice_default;
var init_continuation_notice = __esm({
  "skills/trtc/runtime/continuation-notice.js"() {
    continuation_notice_default = {
      "version": 1,
      "body": "为了帮助我们了解 Skill 的使用场景并持续优化表现，是否同意收集经脱敏的提示词，以及项目中可识别的 TRTC SDKAppID（如有）？\n我们不会主动收集或上传 SecretKey、UserSig、Token、密码、私钥等敏感凭证，也不会上传项目源码。提示词会在上传前进行脱敏处理。",
      "allow_label": "同意继续体验数据上报",
      "deny_label": "停止后续体验数据上报",
      "locales": {
        "zh-CN": {
          "body": "为了帮助我们了解 Skill 的使用场景并持续优化表现，是否同意收集经脱敏的提示词，以及项目中可识别的 TRTC SDKAppID（如有）？\n我们不会主动收集或上传 SecretKey、UserSig、Token、密码、私钥等敏感凭证，也不会上传项目源码。提示词会在上传前进行脱敏处理。",
          "allow_label": "同意继续体验数据上报",
          "deny_label": "停止后续体验数据上报"
        },
        "en-US": {
          "body": "To help us understand how the Skill is used and improve it, do you agree to let us collect de-identified prompts and any identifiable TRTC SDKAppID in your project?\nWe do not proactively collect or upload SecretKey, UserSig, Token, passwords, private keys, or source code. Prompts are redacted before upload.",
          "allow_label": "Agree and continue experience data collection",
          "deny_label": "Stop future experience data collection"
        }
      },
      "markers": {
        "notice_required": "TRTC_REPORTING_NOTICE_REQUIRED_V1",
        "allowed": "TRTC_REPORTING_ALLOWED_V1",
        "allow_retry": "TRTC_REPORTING_ALLOW_RETRY_V1",
        "choice_retry": "TRTC_REPORTING_CHOICE_RETRY_V1",
        "disabled": "TRTC_REPORTING_DISABLED_V1",
        "disable_retry": "TRTC_REPORTING_DISABLE_RETRY_V1"
      }
    };
  }
});

// skills/trtc/runtime/notice-locale.js
function normalizeNoticeLocale(value) {
  if (typeof value !== "string")
    return null;
  const key = value.trim().toLowerCase().replace(/_/g, "-");
  return LOCALE_ALIASES[key] || (SUPPORTED_NOTICE_LOCALES.includes(value) ? value : null);
}
function localeFromEnvironment(env = process.env) {
  var _a;
  const raw = (env == null ? void 0 : env.LC_ALL) || (env == null ? void 0 : env.LC_MESSAGES) || (env == null ? void 0 : env.LANG) || (env == null ? void 0 : env.LANGUAGE);
  return normalizeNoticeLocale((_a = raw == null ? void 0 : raw.split(".")[0]) == null ? void 0 : _a.split(":")[0]) || null;
}
function detectNoticeLocale(text, env = process.env, explicit = null) {
  const requested = normalizeNoticeLocale(explicit);
  if (requested)
    return requested;
  if (typeof text === "string") {
    if (/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Cyrillic}]/u.test(text)) {
      return DEFAULT_NOTICE_LOCALE;
    }
    if (/\p{Script=Han}/u.test(text))
      return "zh-CN";
    if (/[A-Za-z]/u.test(text))
      return "en-US";
  }
  return localeFromEnvironment(env) || DEFAULT_NOTICE_LOCALE;
}
function noticeForLocale(locale) {
  var _a;
  const normalized = normalizeNoticeLocale(locale) || DEFAULT_NOTICE_LOCALE;
  const localized = (_a = continuation_notice_default.locales) == null ? void 0 : _a[normalized];
  return localized ? { ...continuation_notice_default, ...localized, locale: normalized } : { ...continuation_notice_default, locale: normalized };
}
function noticeTextForLocale(locale) {
  const notice = noticeForLocale(locale);
  return `${notice.body}

${notice.allow_label}    ${notice.deny_label}`;
}
function isNoticeReplayText(text) {
  if (typeof text !== "string")
    return false;
  return SUPPORTED_NOTICE_LOCALES.some((locale) => text === noticeTextForLocale(locale));
}
function choiceFromLocalizedText(text) {
  if (typeof text !== "string")
    return null;
  const normalized = text.trim().replace(/[。.!！?？\s]+$/u, "");
  for (const locale of SUPPORTED_NOTICE_LOCALES) {
    const notice = noticeForLocale(locale);
    if (normalized === notice.allow_label)
      return "allowed";
    if (normalized === notice.deny_label)
      return "denied";
  }
  return null;
}
var DEFAULT_NOTICE_LOCALE, SUPPORTED_NOTICE_LOCALES, LOCALE_ALIASES;
var init_notice_locale = __esm({
  "skills/trtc/runtime/notice-locale.js"() {
    init_continuation_notice();
    DEFAULT_NOTICE_LOCALE = "en-US";
    SUPPORTED_NOTICE_LOCALES = Object.freeze(["zh-CN", "en-US"]);
    LOCALE_ALIASES = Object.freeze({
      zh: "zh-CN",
      "zh-cn": "zh-CN",
      "zh-hans": "zh-CN",
      "zh-sg": "zh-CN",
      en: "en-US",
      "en-us": "en-US",
      "en-gb": "en-US",
      "en-au": "en-US"
    });
  }
});

// skills/trtc/runtime/identity.js
function sleepSync(ms) {
  if (ms <= 0)
    return;
  Atomics.wait(SLEEP_BUF, 0, 0, ms);
}
function backoffMs(attempt) {
  return Math.min(40, 5 * (1 << Math.min(attempt, 4)));
}
function monotonicNow() {
  return import_node_perf_hooks.performance.now();
}
function resolveStateRoot(env = process.env, platform = process.platform) {
  const explicit = env == null ? void 0 : env.TRTC_TELEMETRY_STATE_ROOT;
  const explicitIsAbsolute = typeof explicit === "string" && explicit.length > 0 && (platform === "win32" ? import_node_path.default.win32.isAbsolute(explicit) : import_node_path.default.isAbsolute(explicit));
  if (explicitIsAbsolute)
    return explicit;
  if (platform === "darwin") {
    return (0, import_node_path.join)((0, import_node_os.homedir)(), "Library", "Application Support", "tencent-rtc-skill");
  }
  if (platform === "win32") {
    const local = env.LOCALAPPDATA;
    if (local)
      return import_node_path.default.win32.join(local, "TencentRTC", "Skill");
    const profile = env.USERPROFILE || (0, import_node_os.homedir)();
    return import_node_path.default.win32.join(profile, "AppData", "Local", "TencentRTC", "Skill");
  }
  const xdg = env.XDG_STATE_HOME;
  if (xdg && xdg.length > 0)
    return (0, import_node_path.join)(xdg, "tencent-rtc-skill");
  return (0, import_node_path.join)((0, import_node_os.homedir)(), ".local", "state", "tencent-rtc-skill");
}
function resolveEphemeralRoot(platform = process.platform) {
  const base = (0, import_node_os.tmpdir)();
  if (platform === "win32" || typeof process.getuid !== "function") {
    return (0, import_node_path.join)(base, "tencent-rtc-skill-ephemeral");
  }
  return (0, import_node_path.join)(base, `tencent-rtc-skill-${process.getuid()}`);
}
function isPosix(platform = process.platform) {
  return platform !== "win32";
}
function ensureDir(dir, platform = process.platform, opts = {}) {
  const mkdir = typeof opts._mkdirSync === "function" ? opts._mkdirSync : import_node_fs.mkdirSync;
  mkdir(dir, { recursive: true, mode: isPosix(platform) ? 448 : void 0 });
  if (isPosix(platform)) {
    try {
      (0, import_node_fs.chmodSync)(dir, 448);
    } catch {
    }
  }
}
function fsyncDirBestEffort(dir) {
  let fd;
  try {
    fd = (0, import_node_fs.openSync)(dir, "r");
    (0, import_node_fs.fsyncSync)(fd);
  } catch (err) {
    if (err && (err.code === "EINVAL" || err.code === "ENOSYS" || err.code === "EPERM" || err.code === "EACCES" || err.code === "ENOENT")) {
      return;
    }
    throw err;
  } finally {
    if (fd !== void 0) {
      try {
        (0, import_node_fs.closeSync)(fd);
      } catch {
      }
    }
  }
}
function isSafeIdentifier(s) {
  return typeof s === "string" && SAFE_IDENTIFIER_RE.test(s);
}
function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0)
    return null;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if (!err)
      return null;
    if (err.code === "ESRCH")
      return false;
    return null;
  }
}
function peekIdentity(identityPath) {
  let raw;
  try {
    raw = (0, import_node_fs.readFileSync)(identityPath, "utf8");
  } catch (err) {
    if (err && err.code === "ENOENT")
      return null;
    throw err;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed && isSafeIdentifier(parsed.useragent))
    return parsed.useragent;
  return null;
}
function quarantineCorruptIdentity(identityPath, now) {
  const stamp = typeof now === "function" ? now() : Date.now();
  const dst = `${identityPath}.corrupt.${stamp}`;
  try {
    (0, import_node_fs.renameSync)(identityPath, dst);
  } catch (err) {
    if (err && err.code === "ENOENT")
      return;
    try {
      (0, import_node_fs.unlinkSync)(identityPath);
    } catch (u) {
      if (u && u.code === "ENOENT")
        return;
      throw err;
    }
  }
}
function writeOwnerFile(lockDir, token, ts) {
  const p = (0, import_node_path.join)(lockDir, OWNER_FILE);
  const fd = (0, import_node_fs.openSync)(p, "w", 384);
  try {
    (0, import_node_fs.writeSync)(fd, JSON.stringify({ token, pid: process.pid, ts }));
    (0, import_node_fs.fsyncSync)(fd);
  } finally {
    (0, import_node_fs.closeSync)(fd);
  }
}
function readOwnerFileOrNull(lockDir) {
  try {
    const raw = (0, import_node_fs.readFileSync)((0, import_node_path.join)(lockDir, OWNER_FILE), "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.token === "string" && Number.isFinite(parsed.ts) && parsed.ts > 0) {
      return parsed;
    }
    return null;
  } catch (err) {
    if (err && err.code === "ENOENT")
      return null;
    if (err instanceof SyntaxError)
      return null;
    throw err;
  }
}
function readCleanupMutexOwner(path2) {
  try {
    const stat = (0, import_node_fs.lstatSync)(path2);
    if (stat.isDirectory())
      return readOwnerFileOrNull(path2);
    const parsed = JSON.parse((0, import_node_fs.readFileSync)(path2, "utf8"));
    return parsed && typeof parsed.token === "string" && Number.isFinite(parsed.ts) ? parsed : null;
  } catch {
    return null;
  }
}
function writeCleanupCandidate(path2, token, nowMs) {
  const fd = (0, import_node_fs.openSync)(path2, "wx", 384);
  try {
    (0, import_node_fs.writeSync)(fd, JSON.stringify({ pid: process.pid, ts: nowMs, token }));
    (0, import_node_fs.fsyncSync)(fd);
  } finally {
    (0, import_node_fs.closeSync)(fd);
  }
}
function tryAcquireCleanupMutex(cleanupLockDir, opts = {}) {
  const now = opts.now || Date.now;
  const liveness = opts.isPidAlive || isPidAlive;
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = (0, import_node_crypto.randomBytes)(16).toString("hex");
    const candidate = `${cleanupLockDir}.candidate-${process.pid}-${token}`;
    try {
      writeCleanupCandidate(candidate, token, now());
      (0, import_node_fs.linkSync)(candidate, cleanupLockDir);
      (0, import_node_fs.unlinkSync)(candidate);
      return { path: cleanupLockDir, token };
    } catch (err) {
      try {
        (0, import_node_fs.unlinkSync)(candidate);
      } catch {
      }
      if (!err || !["EEXIST", "EPERM"].includes(err.code))
        throw err;
      if (err.code === "EPERM" && !(0, import_node_fs.existsSync)(cleanupLockDir))
        throw err;
    }
    const owner = readCleanupMutexOwner(cleanupLockDir);
    if (!owner || now() - owner.ts <= STALE_LOCK_MS || liveness(owner.pid) !== false) {
      return null;
    }
    const scratch = `${cleanupLockDir}.recovered-${process.pid}-${(0, import_node_crypto.randomBytes)(8).toString("hex")}`;
    try {
      (0, import_node_fs.renameSync)(cleanupLockDir, scratch);
    } catch (err) {
      if (err && (err.code === "ENOENT" || err.code === "EEXIST" || err.code === "ENOTEMPTY"))
        continue;
      throw err;
    }
    const moved = readCleanupMutexOwner(scratch);
    if ((moved == null ? void 0 : moved.token) === owner.token && moved.ts === owner.ts && liveness(moved.pid) === false) {
      (0, import_node_fs.rmSync)(scratch, { recursive: true, force: true });
    } else {
      try {
        (0, import_node_fs.renameSync)(scratch, cleanupLockDir);
      } catch {
      }
      return null;
    }
  }
  return null;
}
function releaseCleanupMutex(lock) {
  if (!lock || typeof lock.path !== "string" || typeof lock.token !== "string")
    return;
  const owner = readCleanupMutexOwner(lock.path);
  if (!owner || owner.token !== lock.token)
    return;
  try {
    (0, import_node_fs.unlinkSync)(lock.path);
  } catch {
  }
}
function verifyAndCleanStaleLock(lockDir, expected, opts = {}) {
  if (!expected || typeof expected.token !== "string") {
    return { cleaned: false, reason: "bad_expected" };
  }
  const cleanupLockDir = opts.cleanupLockDir || defaultCleanupLockDir(lockDir);
  const now = opts.now || Date.now;
  const liveness = opts.isPidAlive || isPidAlive;
  const cleanupLock = tryAcquireCleanupMutex(cleanupLockDir, { now, isPidAlive: liveness });
  if (!cleanupLock) {
    return { cleaned: false, reason: "cleanup_busy" };
  }
  try {
    const current = readOwnerFileOrNull(lockDir);
    if (!current)
      return { cleaned: false, reason: "owner_gone" };
    if (current.token !== expected.token || current.ts !== expected.ts) {
      return { cleaned: false, reason: "owner_changed" };
    }
    const alive = liveness(current.pid);
    if (alive === true)
      return { cleaned: false, reason: "holder_alive" };
    if (alive === null)
      return { cleaned: false, reason: "liveness_unknown" };
    try {
      (0, import_node_fs.unlinkSync)((0, import_node_path.join)(lockDir, OWNER_FILE));
    } catch (err) {
      if (err && err.code === "ENOENT")
        return { cleaned: false, reason: "owner_race" };
      throw err;
    }
    try {
      (0, import_node_fs.rmdirSync)(lockDir);
    } catch (err) {
      if (err && (err.code === "ENOENT" || err.code === "ENOTEMPTY")) {
        return { cleaned: false, reason: "lock_race" };
      }
      throw err;
    }
    return { cleaned: true };
  } finally {
    releaseCleanupMutex(cleanupLock);
  }
}
function maintainIdentityState(stateRoot, opts = {}) {
  var _a;
  const identityPath = (0, import_node_path.join)(stateRoot, IDENTITY_FILE);
  const cleanupLockDir = (0, import_node_path.join)(stateRoot, CLEANUP_LOCK_DIR);
  if (!(0, import_node_fs.existsSync)(cleanupLockDir))
    return { cleaned: false, reason: "mutex_missing" };
  const liveness = opts.isPidAlive || isPidAlive;
  const owner = readCleanupMutexOwner(cleanupLockDir);
  if (owner && liveness(owner.pid) !== false) {
    return { cleaned: false, reason: "holder_not_dead" };
  }
  const identity = peekIdentity(identityPath);
  if (identity)
    return { cleaned: false, reason: "identity_present" };
  if (owner)
    return { cleaned: false, reason: "identity_missing" };
  let sampledStat;
  let age;
  try {
    sampledStat = (0, import_node_fs.lstatSync)(cleanupLockDir);
    age = (((_a = opts.now) == null ? void 0 : _a.call(opts)) ?? Date.now()) - sampledStat.mtimeMs;
  } catch {
    return { cleaned: false, reason: "stat_failed" };
  }
  if (!sampledStat.isDirectory())
    return { cleaned: false, reason: "unowned_nonlegacy_mutex" };
  if (age <= (opts.legacyGraceMs ?? LEGACY_CLEANUP_MUTEX_GRACE_MS)) {
    return { cleaned: false, reason: "legacy_mutex_fresh" };
  }
  const mainOwner = readOwnerFileOrNull((0, import_node_path.join)(stateRoot, LOCK_DIR));
  if (!mainOwner || liveness(mainOwner.pid) !== false) {
    return { cleaned: false, reason: "main_owner_not_dead" };
  }
  const scratch = `${cleanupLockDir}.maintenance-${process.pid}-${(0, import_node_crypto.randomBytes)(8).toString("hex")}`;
  try {
    (0, import_node_fs.renameSync)(cleanupLockDir, scratch);
  } catch (err) {
    if ((err == null ? void 0 : err.code) === "ENOENT")
      return { cleaned: false, reason: "mutex_gone" };
    return { cleaned: false, reason: "rename_failed" };
  }
  let movedStat;
  try {
    movedStat = (0, import_node_fs.lstatSync)(scratch);
  } catch {
    return { cleaned: false, reason: "scratch_missing" };
  }
  if (movedStat.dev !== sampledStat.dev || movedStat.ino !== sampledStat.ino || readCleanupMutexOwner(scratch)) {
    try {
      (0, import_node_fs.renameSync)(scratch, cleanupLockDir);
    } catch {
    }
    return { cleaned: false, reason: "mutex_replaced" };
  }
  (0, import_node_fs.rmSync)(scratch, { recursive: true, force: true });
  return { cleaned: true, reason: "legacy_unowned" };
}
function defaultCleanupLockDir(lockDir) {
  return (0, import_node_path.join)((0, import_node_path.dirname)(lockDir), CLEANUP_LOCK_DIR);
}
function tryLegacy(legacyPaths, migrate) {
  if (!Array.isArray(legacyPaths) || legacyPaths.length === 0)
    return null;
  const defaultMigrate = (raw) => {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed.useragent === "string" ? parsed.useragent : null;
    } catch {
      return null;
    }
  };
  const fn = typeof migrate === "function" ? migrate : defaultMigrate;
  for (const legacyPath of legacyPaths) {
    let raw;
    try {
      raw = (0, import_node_fs.readFileSync)(legacyPath, "utf8");
    } catch {
      continue;
    }
    let candidate;
    try {
      candidate = fn(raw, legacyPath);
    } catch {
      candidate = null;
    }
    if (isSafeIdentifier(candidate))
      return candidate;
  }
  return null;
}
function getOrCreate(opts = {}) {
  const env = opts.env || process.env;
  const platform = opts.platform || process.platform;
  const primary = opts.stateRoot || resolveStateRoot(env, platform);
  try {
    return finalize(tryWriteAt(primary, "device", opts, platform));
  } catch (err) {
    if (!isRecoverableRootError(err))
      throw err;
  }
  const ephemeral = opts.ephemeralRoot || resolveEphemeralRoot(platform);
  return finalize(tryWriteAt(ephemeral, "ephemeral", opts, platform));
}
function finalize(result) {
  if (result.identity_scope !== "device" && result.identity_scope !== "ephemeral") {
    throw new Error(`identity: invalid identity_scope=${String(result.identity_scope)}`);
  }
  if (!isSafeIdentifier(result.useragent)) {
    throw new Error(`identity: invalid useragent=${String(result.useragent)}`);
  }
  return result;
}
function isRecoverableRootError(err) {
  if (!err)
    return false;
  return err.code === "EACCES" || err.code === "EROFS" || err.code === "EPERM" || err.code === "ENOSPC" || err.code === "EDQUOT";
}
function tryWriteAt(root, scope, opts, platform) {
  ensureDir(root, platform, opts);
  const identityPath = (0, import_node_path.join)(root, IDENTITY_FILE);
  const lockDir = (0, import_node_path.join)(root, LOCK_DIR);
  const now = opts.now || Date.now;
  const mnow = opts.monotonicNow || monotonicNow;
  const startMono = mnow();
  const deadlineMono = Number.isFinite(opts.maxWaitMs) ? startMono + opts.maxWaitMs : Infinity;
  const eager = peekIdentity(identityPath);
  if (eager)
    return { useragent: eager, identity_scope: scope };
  const ownerToken2 = (0, import_node_crypto.randomBytes)(16).toString("hex");
  let acquired = false;
  for (let attempt = 0; attempt < MAX_LOCK_ATTEMPTS; attempt++) {
    const midpeek = peekIdentity(identityPath);
    if (midpeek)
      return { useragent: midpeek, identity_scope: scope };
    const budget = deadlineMono - mnow();
    if (budget <= 0) {
      const last = peekIdentity(identityPath);
      if (last)
        return { useragent: last, identity_scope: scope };
      const err = new Error("identity: acquisition timed out");
      err.code = "ETIMEDOUT";
      throw err;
    }
    try {
      (0, import_node_fs.mkdirSync)(lockDir);
      writeOwnerFile(lockDir, ownerToken2, now());
      acquired = true;
      break;
    } catch (err) {
      if (!err || err.code !== "EEXIST")
        throw err;
    }
    const ownerInfo = readOwnerFileOrNull(lockDir);
    const nowMs = now();
    if (ownerInfo == null || nowMs - ownerInfo.ts <= STALE_LOCK_MS) {
      const wait = Math.min(backoffMs(attempt), Math.max(1, budget));
      sleepSync(wait);
      continue;
    }
    const outcome = verifyAndCleanStaleLock(lockDir, ownerInfo, {
      now,
      isPidAlive: opts.isPidAlive
    });
    if (!outcome.cleaned) {
      const wait = Math.min(backoffMs(attempt), Math.max(1, budget));
      sleepSync(wait);
    }
  }
  if (!acquired) {
    const last = peekIdentity(identityPath);
    if (last)
      return { useragent: last, identity_scope: scope };
    const err = new Error(`identity: unable to acquire ${lockDir} after ${MAX_LOCK_ATTEMPTS} attempts`);
    err.code = "ELOCKED";
    throw err;
  }
  try {
    const inside = peekIdentity(identityPath);
    if (inside)
      return { useragent: inside, identity_scope: scope };
    if ((0, import_node_fs.existsSync)(identityPath)) {
      quarantineCorruptIdentity(identityPath, now);
    }
    const legacy = tryLegacy(opts.legacyPaths, opts.migrate);
    const useragent = legacy || (0, import_node_crypto.randomUUID)();
    const tmpPath = `${identityPath}.tmp.${process.pid}.${(0, import_node_crypto.randomBytes)(4).toString("hex")}`;
    const fd = (0, import_node_fs.openSync)(tmpPath, "wx", 384);
    try {
      (0, import_node_fs.writeSync)(fd, JSON.stringify({ useragent, created_at: now() }));
      (0, import_node_fs.fsyncSync)(fd);
    } finally {
      (0, import_node_fs.closeSync)(fd);
    }
    (0, import_node_fs.renameSync)(tmpPath, identityPath);
    if (isPosix(platform)) {
      try {
        (0, import_node_fs.chmodSync)(identityPath, 384);
      } catch {
      }
    }
    fsyncDirBestEffort((0, import_node_path.dirname)(identityPath));
    return { useragent, identity_scope: scope };
  } finally {
    releaseOurLock(lockDir, ownerToken2);
  }
}
function releaseOurLock(lockDir, ownerToken2) {
  const current = readOwnerFileOrNull(lockDir);
  if (!current || current.token !== ownerToken2)
    return;
  try {
    (0, import_node_fs.unlinkSync)((0, import_node_path.join)(lockDir, OWNER_FILE));
  } catch (err) {
    if (err && err.code !== "ENOENT")
      return;
  }
  try {
    (0, import_node_fs.rmdirSync)(lockDir);
  } catch {
  }
}
var import_node_crypto, import_node_fs, import_node_os, import_node_perf_hooks, import_node_path, IDENTITY_FILE, LOCK_DIR, CLEANUP_LOCK_DIR, OWNER_FILE, STALE_LOCK_MS, LEGACY_CLEANUP_MUTEX_GRACE_MS, MAX_LOCK_ATTEMPTS, SAFE_IDENTIFIER_RE, SLEEP_BUF;
var init_identity = __esm({
  "skills/trtc/runtime/identity.js"() {
    import_node_crypto = require("node:crypto");
    import_node_fs = require("node:fs");
    import_node_os = require("node:os");
    import_node_perf_hooks = require("node:perf_hooks");
    import_node_path = __toESM(require("node:path"), 1);
    IDENTITY_FILE = "identity.json";
    LOCK_DIR = "identity.lock";
    CLEANUP_LOCK_DIR = "identity.cleanup.lock";
    OWNER_FILE = "OWNER";
    STALE_LOCK_MS = 3e4;
    LEGACY_CLEANUP_MUTEX_GRACE_MS = 24 * 60 * 60 * 1e3;
    MAX_LOCK_ATTEMPTS = 100;
    SAFE_IDENTIFIER_RE = /^[A-Za-z0-9._-]{8,128}$/;
    SLEEP_BUF = new Int32Array(new SharedArrayBuffer(4));
  }
});

// skills/trtc/runtime/control.js
function isCanonicalOption(text) {
  return choiceFromLocalizedText(text);
}
function controlKey(projectKey2, option) {
  if (!PROJECT_KEY_RE.test(projectKey2) || !["allowed", "denied"].includes(option))
    return null;
  const fingerprint = (0, import_node_crypto2.createHash)("sha256").update(option === "allowed" ? ALLOW_LABEL : DENY_LABEL).digest("hex");
  return (0, import_node_crypto2.createHash)("sha256").update(projectKey2).update("\0").update(fingerprint).update("\0").update(String(NOTICE_VERSION)).digest("hex");
}
function validProjectKey(value) {
  return typeof value === "string" && PROJECT_KEY_RE.test(value);
}
function validControlKey(value) {
  return typeof value === "string" && CONTROL_KEY_RE.test(value);
}
function validAttempt(value) {
  return typeof value === "string" && ATTEMPT_RE.test(value);
}
function controlDir(stateRoot, projectKey2) {
  if (!validProjectKey(projectKey2))
    return null;
  return (0, import_node_path2.join)(stateRoot, "telemetry", "control", projectKey2);
}
function paths(stateRoot, projectKey2) {
  const dir = controlDir(stateRoot, projectKey2);
  if (!dir)
    return null;
  return {
    dir,
    notice: (0, import_node_path2.join)(dir, "notice-v1.json"),
    tombstone: (0, import_node_path2.join)(dir, "deny-v1.tombstone"),
    lock: (0, import_node_path2.join)(dir, OWNER_FILE2),
    sendLock: (0, import_node_path2.join)(dir, SEND_OWNER_FILE),
    producerDir: (0, import_node_path2.join)(dir, PRODUCER_DIR),
    turns: (0, import_node_path2.join)(dir, "control-turns")
  };
}
function ensureDir2(path2) {
  (0, import_node_fs2.mkdirSync)(path2, { recursive: true, mode: process.platform === "win32" ? void 0 : 448 });
}
function writeAll(fd, value) {
  const body = Buffer.from(typeof value === "string" ? value : JSON.stringify(value));
  let offset = 0;
  while (offset < body.length)
    offset += (0, import_node_fs2.writeSync)(fd, body, offset, body.length - offset);
}
function fsyncDirBestEffort2(dir, opts = {}) {
  try {
    if (typeof opts._fsyncDir === "function") {
      opts._fsyncDir(dir);
      return { ok: true, injected: true };
    }
    const dfd = (0, import_node_fs2.openSync)(dir, "r");
    try {
      (0, import_node_fs2.fsyncSync)(dfd);
    } finally {
      (0, import_node_fs2.closeSync)(dfd);
    }
    return { ok: true };
  } catch (err) {
    if (UNSUPPORTED_DIR_FSYNC.has(err == null ? void 0 : err.code))
      return { ok: true, unsupported: true };
    return { ok: false, code: (err == null ? void 0 : err.code) || "directory_fsync_failed" };
  }
}
function durabilizeFile(path2, dir, opts = {}) {
  try {
    const fd = (0, import_node_fs2.openSync)(path2, "r+");
    try {
      (0, import_node_fs2.fsyncSync)(fd);
    } finally {
      (0, import_node_fs2.closeSync)(fd);
    }
    const synced = fsyncDirBestEffort2(dir, opts);
    return synced.ok;
  } catch {
    return false;
  }
}
function atomicWrite(path2, value, opts = {}) {
  const dir = (0, import_node_path2.dirname)(path2);
  ensureDir2(dir);
  const tmp = (0, import_node_path2.join)(dir, `.${(0, import_node_crypto2.randomBytes)(8).toString("hex")}.control.tmp`);
  let fd;
  try {
    fd = (0, import_node_fs2.openSync)(tmp, "wx", process.platform === "win32" ? void 0 : 384);
    writeAll(fd, `${JSON.stringify(value)}
`);
    (0, import_node_fs2.fsyncSync)(fd);
    (0, import_node_fs2.closeSync)(fd);
    fd = void 0;
    (0, import_node_fs2.renameSync)(tmp, path2);
    const synced = fsyncDirBestEffort2(dir, opts);
    if (!synced.ok)
      throw Object.assign(new Error("directory_fsync_failed"), { code: synced.code });
    return true;
  } catch {
    if (fd !== void 0)
      try {
        (0, import_node_fs2.closeSync)(fd);
      } catch {
      }
    try {
      (0, import_node_fs2.unlinkSync)(tmp);
    } catch {
    }
    return false;
  }
}
function readJson(path2) {
  try {
    const raw = (0, import_node_fs2.readFileSync)(path2, "utf8");
    const value = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}
function lstatRegularFile(path2) {
  try {
    const stat = (0, import_node_fs2.lstatSync)(path2);
    if (!stat.isFile() || stat.isSymbolicLink())
      return { status: "invalid" };
    return { status: "regular" };
  } catch (err) {
    if ((err == null ? void 0 : err.code) === "ENOENT")
      return { status: "missing" };
    return { status: "error", reason: (err == null ? void 0 : err.code) || "lstat_failed" };
  }
}
function readAny(path2) {
  try {
    return (0, import_node_fs2.readFileSync)(path2, "utf8");
  } catch {
    return null;
  }
}
function ownerToken() {
  return (0, import_node_crypto2.randomBytes)(16).toString("hex");
}
function acquireControlReservation(stateRoot, projectKey2, opts = {}) {
  const p = paths(stateRoot, projectKey2);
  if (!p)
    return null;
  ensureDir2(p.dir);
  const deadline = Number.isFinite(opts.deadlineMono) ? opts.deadlineMono : performanceNow() + (opts.timeoutMs ?? 250);
  const token = ownerToken();
  const body = JSON.stringify({ pid: process.pid, token, ts: Date.now() });
  while (performanceNow() < deadline) {
    try {
      const fd = (0, import_node_fs2.openSync)(p.lock, "wx", process.platform === "win32" ? void 0 : 384);
      try {
        writeAll(fd, body);
        (0, import_node_fs2.fsyncSync)(fd);
      } finally {
        (0, import_node_fs2.closeSync)(fd);
      }
      return { path: p.lock, token };
    } catch (err) {
      if ((err == null ? void 0 : err.code) !== "EEXIST")
        return null;
      let old = null;
      try {
        old = JSON.parse((0, import_node_fs2.readFileSync)(p.lock, "utf8"));
      } catch {
      }
      let stale = false;
      try {
        const age = Date.now() - (0, import_node_fs2.statSync)(p.lock).mtimeMs;
        stale = age > (opts.staleGraceMs ?? LOCK_GRACE_MS) && (typeof (old == null ? void 0 : old.pid) !== "number" || !isProcessAlive(old.pid));
      } catch {
        stale = false;
      }
      if (stale) {
        try {
          (0, import_node_fs2.renameSync)(p.lock, `${p.lock}.stale.${token}`);
        } catch {
        }
        try {
          (0, import_node_fs2.unlinkSync)(`${p.lock}.stale.${token}`);
        } catch {
        }
      }
      sleepSync2(Math.min(10, Math.max(1, deadline - performanceNow())));
    }
  }
  return null;
}
function releaseControlReservation(lock) {
  if (!(lock == null ? void 0 : lock.path) || !(lock == null ? void 0 : lock.token))
    return;
  try {
    const owner = readJson(lock.path);
    if ((owner == null ? void 0 : owner.token) === lock.token)
      (0, import_node_fs2.unlinkSync)(lock.path);
  } catch {
  }
}
function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err == null ? void 0 : err.code) !== "ESRCH";
  }
}
function performanceNow() {
  var _a, _b;
  return Number(((_b = (_a = globalThis.performance) == null ? void 0 : _a.now) == null ? void 0 : _b.call(_a)) ?? Date.now());
}
function sleepSync2(ms) {
  if (ms > 0)
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
function validateNotice(value, projectKey2) {
  if (!value || typeof value !== "object" || !validProjectKey(projectKey2))
    return null;
  if (value.version !== NOTICE_VERSION || value.project_key !== projectKey2 || !NOTICE_STATES.includes(value.status) || value.notice_version !== NOTICE_VERSION || typeof value.event_id !== "string" || value.event_id.length === 0 || !validAttempt(value.notice_attempt_id) || !Number.isFinite(value.created_at))
    return null;
  if (value.sessionid !== null && typeof value.sessionid !== "string")
    return null;
  if (value.notice_locale !== void 0 && !normalizeNoticeLocale(value.notice_locale))
    return null;
  return { ...value, notice_locale: normalizeNoticeLocale(value.notice_locale) || "zh-CN" };
}
function validateTurn(value, projectKey2, expectedKey) {
  if (!value || typeof value !== "object" || value.version !== NOTICE_VERSION || value.project_key !== projectKey2 || !validControlKey(value.control_key) || value.control_key !== expectedKey || !CONTROL_STATES.includes(value.control_status) || !["allowed", "denied"].includes(value.control_kind) || value.notice_version !== NOTICE_VERSION || !Number.isFinite(value.created_at))
    return null;
  return { ...value };
}
function readNoticeReceipt(stateRoot, projectKey2) {
  const p = paths(stateRoot, projectKey2);
  if (!p)
    return { status: "invalid" };
  const file = lstatRegularFile(p.notice);
  if (file.status === "missing")
    return { status: "missing" };
  if (file.status !== "regular")
    return { status: "corrupt" };
  const value = validateNotice(readJson(p.notice), projectKey2);
  return value ? { status: "valid", value } : { status: "corrupt" };
}
function writeNoticeReceipt(stateRoot, projectKey2, receipt) {
  const p = paths(stateRoot, projectKey2);
  if (!p || !validAttempt(receipt == null ? void 0 : receipt.notice_attempt_id))
    return { status: "error", reason: "invalid_receipt" };
  const lock = acquireControlReservation(stateRoot, projectKey2, { timeoutMs: 100 });
  if (!lock)
    return { status: "error", reason: "control_busy" };
  try {
    const existing = readNoticeReceipt(stateRoot, projectKey2);
    if (existing.status === "valid")
      return { status: "already_present", receipt: existing.value };
    if (existing.status === "corrupt")
      return { status: "error", reason: "receipt_corrupt" };
    const value = {
      version: NOTICE_VERSION,
      notice_version: NOTICE_VERSION,
      status: "pending_output",
      project_key: projectKey2,
      event_id: receipt.event_id,
      sessionid: receipt.sessionid ?? null,
      notice_attempt_id: receipt.notice_attempt_id,
      created_at: Number.isFinite(receipt.created_at) ? receipt.created_at : Date.now(),
      notice_locale: normalizeNoticeLocale(receipt.notice_locale) || "zh-CN"
    };
    if (!atomicWrite(p.notice, value))
      return { status: "error", reason: "receipt_write_failed" };
    return { status: "created", receipt: value };
  } finally {
    releaseControlReservation(lock);
  }
}
function noticeStatus(stateRoot, projectKey2, attemptId, sessionid = null) {
  const p = paths(stateRoot, projectKey2);
  if (!p || !validAttempt(attemptId))
    return { status: "not_found" };
  const lock = acquireControlReservation(stateRoot, projectKey2, { timeoutMs: 100 });
  if (!lock)
    return { status: "retry", marker: CONTROL_RETRY };
  try {
    const receipt = readNoticeReceipt(stateRoot, projectKey2);
    if (receipt.status !== "valid")
      return { status: receipt.status === "missing" ? "not_found" : "retry", marker: CONTROL_RETRY };
    const value = receipt.value;
    if (value.notice_attempt_id !== attemptId || value.sessionid !== null && sessionid !== null && value.sessionid !== sessionid)
      return { status: "not_found" };
    if (value.status === "pending_output") {
      const next = { ...value, status: "awaiting_choice" };
      if (!atomicWrite(p.notice, next))
        return { status: "retry", marker: CONTROL_RETRY };
      return { status: "required", notice_version: NOTICE_VERSION };
    }
    if (value.status === "awaiting_choice")
      return { status: "already_awaiting" };
    return { status: "terminal", notice_status: value.status };
  } finally {
    releaseControlReservation(lock);
  }
}
function updateNoticeStatus(stateRoot, projectKey2, expected, status) {
  const p = paths(stateRoot, projectKey2);
  if (!p || !NOTICE_STATES.includes(status))
    return { status: "error", reason: "invalid_status" };
  const lock = acquireControlReservation(stateRoot, projectKey2, { timeoutMs: 100 });
  if (!lock)
    return { status: "retry", reason: "control_busy" };
  try {
    const current = readNoticeReceipt(stateRoot, projectKey2);
    if (current.status !== "valid")
      return { status: "retry", reason: current.status };
    if (expected && (current.value.status !== expected || expected.event_id && current.value.event_id !== expected.event_id)) {
      return { status: "conflict", value: current.value };
    }
    const next = { ...current.value, status };
    return atomicWrite(p.notice, next) ? { status: "updated", value: next } : { status: "error", reason: "notice_write_failed" };
  } finally {
    releaseControlReservation(lock);
  }
}
function readDenyTombstone(stateRoot, projectKey2) {
  const p = paths(stateRoot, projectKey2);
  if (!p)
    return { status: "invalid" };
  const file = lstatRegularFile(p.tombstone);
  if (file.status === "missing")
    return { status: "missing" };
  if (file.status !== "regular")
    return { status: "corrupt" };
  const raw = readAny(p.tombstone);
  if (!raw)
    return { status: "corrupt" };
  const value = readJson(p.tombstone);
  if (!value || value.version !== NOTICE_VERSION || value.project_key !== projectKey2 || value.notice_version !== NOTICE_VERSION || value.control_kind !== "denied" || !validControlKey(value.control_key) || !Number.isFinite(value.created_at))
    return { status: "corrupt" };
  return { status: "valid", value };
}
function readProjectDenyGate(stateRoot, projectKey2) {
  const result = readDenyTombstone(stateRoot, projectKey2);
  if (result.status === "missing")
    return { status: "missing", allowed: true };
  if (result.status === "valid")
    return { status: "valid", allowed: false, value: result.value };
  if (result.status === "invalid")
    return { status: "invalid", allowed: false };
  return { status: "corrupt", allowed: false, reason: result.reason || "tombstone_unreadable" };
}
function quarantineDenyTombstone(stateRoot, projectKey2, opts = {}) {
  const p = paths(stateRoot, projectKey2);
  if (!p)
    return { status: "retryable", reason: "invalid_project_key" };
  let stat;
  try {
    stat = (0, import_node_fs2.lstatSync)(p.tombstone);
  } catch (err) {
    if ((err == null ? void 0 : err.code) === "ENOENT")
      return { status: "missing" };
    return { status: "retryable", reason: (err == null ? void 0 : err.code) || "tombstone_lstat_failed" };
  }
  if (!stat.isFile() && !stat.isSymbolicLink()) {
    return { status: "retryable", reason: "tombstone_special_file" };
  }
  try {
    ensureDir2((0, import_node_path2.join)(p.dir, "quarantine"));
    const destination = (0, import_node_path2.join)(p.dir, "quarantine", `deny-v1.${Date.now()}.${(0, import_node_crypto2.randomBytes)(8).toString("hex")}.quarantine`);
    (0, import_node_fs2.renameSync)(p.tombstone, destination);
    const synced = fsyncDirBestEffort2(p.dir, opts);
    if (!synced.ok) {
      try {
        (0, import_node_fs2.renameSync)(destination, p.tombstone);
        return { status: "retryable", reason: synced.code || "quarantine_dir_fsync_failed", restored: true };
      } catch {
        try {
          const fd = (0, import_node_fs2.openSync)(p.tombstone, "wx", process.platform === "win32" ? void 0 : 384);
          try {
            writeAll(fd, '{"quarantine_pending":true}\n');
          } finally {
            (0, import_node_fs2.closeSync)(fd);
          }
          return { status: "retryable", reason: synced.code || "quarantine_dir_fsync_failed", fail_closed: true };
        } catch (markerErr) {
          if ((markerErr == null ? void 0 : markerErr.code) === "EEXIST") {
            return { status: "retryable", reason: synced.code || "quarantine_dir_fsync_failed", fail_closed: true };
          }
          return { status: "retryable", reason: "quarantine_restore_failed", fail_closed: false };
        }
      }
    }
    return { status: "quarantined", path: destination };
  } catch (err) {
    return { status: "retryable", reason: (err == null ? void 0 : err.code) || "tombstone_quarantine_failed" };
  }
}
function acquireFileReservation(lockPath2, owner, opts = {}) {
  const timeoutMs = Number.isFinite(opts.timeoutMs) ? Math.max(0, opts.timeoutMs) : 100;
  const deadline = Number.isFinite(opts.deadlineMono) ? opts.deadlineMono : performanceNow() + timeoutMs;
  const token = ownerToken();
  const body = JSON.stringify({ ...owner, pid: process.pid, token, created_at: Date.now() });
  if (opts._dirReady !== true)
    ensureDir2((0, import_node_path2.dirname)(lockPath2));
  let firstAttempt = true;
  while (firstAttempt || performanceNow() <= deadline) {
    firstAttempt = false;
    try {
      const fd = (0, import_node_fs2.openSync)(lockPath2, "wx", process.platform === "win32" ? void 0 : 384);
      try {
        writeAll(fd, `${body}
`);
        if (opts._hookMode !== true)
          (0, import_node_fs2.fsyncSync)(fd);
      } finally {
        (0, import_node_fs2.closeSync)(fd);
      }
      return { path: lockPath2, token };
    } catch (err) {
      if ((err == null ? void 0 : err.code) !== "EEXIST")
        return null;
      let stale = false;
      let sampled = null;
      try {
        const stat = (0, import_node_fs2.statSync)(lockPath2);
        const value = JSON.parse((0, import_node_fs2.readFileSync)(lockPath2, "utf8"));
        sampled = value;
        const age = Date.now() - stat.mtimeMs;
        stale = age > (opts.staleGraceMs ?? LOCK_GRACE_MS) && typeof (value == null ? void 0 : value.pid) === "number" && !isProcessAlive(value.pid);
      } catch {
        stale = false;
      }
      if (stale) {
        const stalePath = `${lockPath2}.stale.${token}`;
        try {
          (0, import_node_fs2.renameSync)(lockPath2, stalePath);
          const moved = JSON.parse((0, import_node_fs2.readFileSync)(stalePath, "utf8"));
          if ((moved == null ? void 0 : moved.token) === (sampled == null ? void 0 : sampled.token) && (moved == null ? void 0 : moved.pid) === (sampled == null ? void 0 : sampled.pid)) {
            (0, import_node_fs2.unlinkSync)(stalePath);
          } else {
            try {
              (0, import_node_fs2.linkSync)(stalePath, lockPath2);
            } catch {
            }
            try {
              (0, import_node_fs2.unlinkSync)(stalePath);
            } catch {
            }
          }
        } catch {
          try {
            (0, import_node_fs2.unlinkSync)(stalePath);
          } catch {
          }
        }
      }
      const left = deadline - performanceNow();
      if (left > 0)
        sleepSync2(Math.min(10, left));
    }
  }
  return null;
}
function releaseFileReservation(lock) {
  if (!(lock == null ? void 0 : lock.path) || !(lock == null ? void 0 : lock.token))
    return;
  const releasing = `${lock.path}.releasing.${lock.token}`;
  try {
    (0, import_node_fs2.renameSync)(lock.path, releasing);
  } catch {
    return;
  }
  try {
    const value = JSON.parse((0, import_node_fs2.readFileSync)(releasing, "utf8"));
    if ((value == null ? void 0 : value.token) === lock.token)
      (0, import_node_fs2.unlinkSync)(releasing);
    else {
      try {
        (0, import_node_fs2.linkSync)(releasing, lock.path);
      } catch {
      }
      try {
        (0, import_node_fs2.unlinkSync)(releasing);
      } catch {
      }
    }
  } catch {
    try {
      (0, import_node_fs2.unlinkSync)(releasing);
    } catch {
    }
  }
}
function acquireProjectSendReservation(stateRoot, projectKey2, opts = {}) {
  const p = paths(stateRoot, projectKey2);
  return p ? acquireFileReservation(p.sendLock, { project_key: projectKey2, kind: "send" }, opts) : null;
}
function releaseProjectSendReservation(lock) {
  releaseFileReservation(lock);
}
function beginProducerLease(stateRoot, projectKey2, opts = {}) {
  const p = paths(stateRoot, projectKey2);
  if (!p)
    return { blocked: true, retryable: false, reason: "invalid_project_key" };
  if (opts._hookMode === true) {
    try {
      if (!READY_PRODUCER_DIRS.has(p.producerDir)) {
        ensureDir2(p.producerDir);
        READY_PRODUCER_DIRS.add(p.producerDir);
      }
    } catch {
      return { blocked: true, retryable: true, reason: "lease_dir_unavailable" };
    }
    const lease = acquireFileReservation((0, import_node_path2.join)(p.producerDir, `${process.pid}-${ownerToken()}.json`), {
      project_key: projectKey2,
      kind: "producer"
    }, { timeoutMs: Math.min(25, opts.timeoutMs ?? 25), staleGraceMs: opts.staleGraceMs, _hookMode: true, _dirReady: true });
    return lease ? { lease, blocked: false } : { blocked: true, retryable: true, reason: "lease_busy" };
  }
  const gate = readProjectDenyGate(stateRoot, projectKey2);
  if (!gate.allowed)
    return { blocked: true, retryable: gate.status !== "valid", reason: `deny_${gate.status}` };
  const sendLock = acquireProjectSendReservation(stateRoot, projectKey2, opts);
  if (!sendLock)
    return { blocked: true, retryable: true, reason: "send_busy" };
  try {
    const recheck = readProjectDenyGate(stateRoot, projectKey2);
    if (!recheck.allowed)
      return { blocked: true, retryable: recheck.status !== "valid", reason: `deny_${recheck.status}` };
    ensureDir2(p.producerDir);
    const lease = acquireFileReservation((0, import_node_path2.join)(p.producerDir, `${process.pid}-${ownerToken()}.json`), {
      project_key: projectKey2,
      kind: "producer"
    }, { timeoutMs: opts.leaseTimeoutMs ?? opts.timeoutMs ?? 25, staleGraceMs: opts.staleGraceMs, _hookMode: opts._hookMode === true });
    if (!lease)
      return { blocked: true, retryable: true, reason: "lease_busy" };
    return { lease, blocked: false };
  } finally {
    releaseProjectSendReservation(sendLock);
  }
}
function endProducerLease(lease) {
  releaseFileReservation(lease);
}
function listActiveProducerLeases(stateRoot, projectKey2, opts = {}) {
  const p = paths(stateRoot, projectKey2);
  if (!p)
    return { active: 0, reclaimed: 0, busy: 0, error: "invalid_project_key" };
  try {
    ensureDir2(p.producerDir);
  } catch {
    return { active: 0, reclaimed: 0, busy: 1, error: "lease_dir_unreadable" };
  }
  let names;
  try {
    names = (0, import_node_fs2.readdirSync)(p.producerDir);
  } catch {
    return { active: 0, reclaimed: 0, busy: 1, error: "lease_scan_failed" };
  }
  let active = 0;
  let reclaimed = 0;
  let busy = 0;
  for (const name of names) {
    if (!name.endsWith(".json"))
      continue;
    const path2 = (0, import_node_path2.join)(p.producerDir, name);
    let value;
    try {
      const stat = (0, import_node_fs2.lstatSync)(path2);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        busy++;
        continue;
      }
      value = JSON.parse((0, import_node_fs2.readFileSync)(path2, "utf8"));
    } catch {
      busy++;
      continue;
    }
    if ((value == null ? void 0 : value.project_key) !== projectKey2 || typeof value.pid !== "number") {
      busy++;
      continue;
    }
    let alive = null;
    try {
      alive = isProcessAlive(value.pid);
    } catch {
      alive = null;
    }
    if (alive === false && Date.now() - (value.created_at || 0) > (opts.staleGraceMs ?? LOCK_GRACE_MS)) {
      try {
        (0, import_node_fs2.unlinkSync)(path2);
        reclaimed++;
      } catch {
        busy++;
      }
    } else if (alive === true || alive === null)
      active++;
  }
  return { active, reclaimed, busy };
}
function writeDenyTombstoneFromHook(stateRoot, projectKey2, controlKeyValue, opts = {}) {
  const p = paths(stateRoot, projectKey2);
  if (!p || !validControlKey(controlKeyValue))
    return { status: "retryable", reason: "invalid_project_or_control_key" };
  const deadline = performanceNow() + Math.min(25, Number.isFinite(opts.timeoutMs) ? Math.max(0, opts.timeoutMs) : 25);
  try {
    const dirStat = (0, import_node_fs2.lstatSync)(p.dir);
    if (!dirStat.isDirectory() || dirStat.isSymbolicLink())
      return { status: "retryable", reason: "control_dir_invalid", marker: DISABLE_RETRY };
  } catch {
    return { status: "retryable", reason: "control_dir_missing", marker: DISABLE_RETRY };
  }
  if (performanceNow() > deadline)
    return { status: "retryable", reason: "deadline" };
  const value = {
    version: NOTICE_VERSION,
    project_key: projectKey2,
    notice_version: NOTICE_VERSION,
    control_kind: "denied",
    control_key: controlKeyValue,
    created_at: Date.now(),
    random_token: (0, import_node_crypto2.randomBytes)(16).toString("hex")
  };
  try {
    const fd = (0, import_node_fs2.openSync)(p.tombstone, "wx", process.platform === "win32" ? void 0 : 384);
    try {
      writeAll(fd, `${JSON.stringify(value)}
`);
    } finally {
      (0, import_node_fs2.closeSync)(fd);
    }
    if (performanceNow() > deadline)
      return { status: "retryable", reason: "deadline_after_close", marker: DISABLE_RETRY };
    return { status: "pending", tombstone: value, marker: DISABLE_RETRY };
  } catch (err) {
    if ((err == null ? void 0 : err.code) === "EEXIST")
      return { status: "already_present", marker: DISABLE_RETRY };
    return { status: "retryable", reason: (err == null ? void 0 : err.code) || "tombstone_write_failed", marker: DISABLE_RETRY };
  }
}
function writeDenyTombstone(stateRoot, projectKey2, controlKeyValue, opts = {}) {
  const p = paths(stateRoot, projectKey2);
  if (!p || !validControlKey(controlKeyValue))
    return { status: "error", reason: "invalid_control_key" };
  ensureDir2(p.dir);
  const existingPath = lstatRegularFile(p.tombstone);
  if (existingPath.status === "invalid") {
    return { status: "error", reason: "tombstone_conflict" };
  }
  if (existingPath.status === "error") {
    return { status: "error", reason: existingPath.reason || "tombstone_stat_failed" };
  }
  if (existingPath.status === "regular") {
    const existing = readDenyTombstone(stateRoot, projectKey2);
    return existing.status === "valid" && existing.value.control_key === controlKeyValue ? durabilizeFile(p.tombstone, p.dir, opts) ? { status: "already_present", tombstone: existing.value } : { status: "error", reason: "tombstone_durability_failed" } : { status: "error", reason: "tombstone_conflict" };
  }
  const value = {
    version: NOTICE_VERSION,
    project_key: projectKey2,
    notice_version: NOTICE_VERSION,
    control_kind: "denied",
    control_key: controlKeyValue,
    created_at: Date.now(),
    random_token: (0, import_node_crypto2.randomBytes)(16).toString("hex")
  };
  try {
    const fd = (0, import_node_fs2.openSync)(p.tombstone, "wx", process.platform === "win32" ? void 0 : 384);
    try {
      writeAll(fd, `${JSON.stringify(value)}
`);
      (0, import_node_fs2.fsyncSync)(fd);
    } finally {
      (0, import_node_fs2.closeSync)(fd);
    }
    const synced = fsyncDirBestEffort2(p.dir, opts);
    if (!synced.ok)
      return { status: "error", reason: synced.code || "directory_fsync_failed" };
    return { status: "created", tombstone: value };
  } catch (err) {
    if ((err == null ? void 0 : err.code) === "EEXIST") {
      const raced = lstatRegularFile(p.tombstone);
      if (raced.status !== "regular")
        return { status: "error", reason: "tombstone_conflict" };
      const existing = readDenyTombstone(stateRoot, projectKey2);
      return existing.status === "valid" && existing.value.control_key === controlKeyValue ? durabilizeFile(p.tombstone, p.dir, opts) ? { status: "already_present", tombstone: existing.value } : { status: "error", reason: "tombstone_durability_failed" } : { status: "error", reason: "tombstone_conflict" };
    }
    return { status: "error", reason: (err == null ? void 0 : err.code) || "tombstone_write_failed" };
  }
}
function turnPath(p, key) {
  return (0, import_node_path2.join)(p.turns, `${key}.json`);
}
function readControlTurn(stateRoot, projectKey2, key) {
  const p = paths(stateRoot, projectKey2);
  if (!p || !validControlKey(key))
    return { status: "invalid" };
  const path2 = turnPath(p, key);
  const file = lstatRegularFile(path2);
  if (file.status === "missing")
    return { status: "missing" };
  if (file.status !== "regular")
    return { status: "corrupt" };
  const value = validateTurn(readJson(path2), projectKey2, key);
  return value ? { status: "valid", value } : { status: "corrupt" };
}
function writeControlTurn(stateRoot, projectKey2, key, value, opts = {}) {
  const p = paths(stateRoot, projectKey2);
  if (!p || !validControlKey(key))
    return { status: "error", reason: "invalid_control_key" };
  ensureDir2(p.turns);
  const path2 = turnPath(p, key);
  const next = {
    version: NOTICE_VERSION,
    project_key: projectKey2,
    notice_version: NOTICE_VERSION,
    control_key: key,
    control_kind: value.control_kind,
    control_status: value.control_status,
    created_at: Number.isFinite(value.created_at) ? value.created_at : Date.now()
  };
  if (opts.firstWriter) {
    try {
      const fd = (0, import_node_fs2.openSync)(path2, "wx", process.platform === "win32" ? void 0 : 384);
      try {
        writeAll(fd, `${JSON.stringify(next)}
`);
        (0, import_node_fs2.fsyncSync)(fd);
      } finally {
        (0, import_node_fs2.closeSync)(fd);
      }
      const synced = fsyncDirBestEffort2(p.turns, opts);
      if (!synced.ok)
        return { status: "error", reason: synced.code || "directory_fsync_failed" };
      return { status: "created", value: next };
    } catch (err) {
      if ((err == null ? void 0 : err.code) === "EEXIST") {
        const existing = readControlTurn(stateRoot, projectKey2, key);
        return existing.status === "valid" ? { status: "already_present", value: existing.value } : { status: "error", reason: "control_conflict" };
      }
      return { status: "error", reason: (err == null ? void 0 : err.code) || "control_write_failed" };
    }
  }
  if (!atomicWrite(path2, next, opts))
    return { status: "error", reason: "control_write_failed" };
  return { status: "updated", value: next };
}
var import_node_crypto2, import_node_fs2, import_node_path2, NOTICE_VERSION, NOTICE_STATES, CONTROL_STATES, ALLOW_LABEL, DENY_LABEL, ALLOWED, CONTROL_RETRY, ALLOW_RETRY, DISABLED, DISABLE_RETRY, NOTICE_REQUIRED, PROJECT_KEY_RE, CONTROL_KEY_RE, ATTEMPT_RE, OWNER_FILE2, SEND_OWNER_FILE, PRODUCER_DIR, LOCK_GRACE_MS, UNSUPPORTED_DIR_FSYNC, READY_PRODUCER_DIRS;
var init_control = __esm({
  "skills/trtc/runtime/control.js"() {
    import_node_crypto2 = require("node:crypto");
    import_node_fs2 = require("node:fs");
    import_node_path2 = require("node:path");
    init_continuation_notice();
    init_notice_locale();
    NOTICE_VERSION = continuation_notice_default.version;
    NOTICE_STATES = Object.freeze([
      "pending_output",
      "awaiting_choice",
      "allow_pending",
      "deny_pending",
      "allowed",
      "denied",
      "ignored"
    ]);
    CONTROL_STATES = Object.freeze([
      "allowed_pending",
      "allowed",
      "deny_pending",
      "denied",
      "retryable"
    ]);
    ALLOW_LABEL = continuation_notice_default.allow_label;
    DENY_LABEL = continuation_notice_default.deny_label;
    ALLOWED = continuation_notice_default.markers.allowed;
    CONTROL_RETRY = continuation_notice_default.markers.choice_retry;
    ALLOW_RETRY = continuation_notice_default.markers.allow_retry;
    DISABLED = continuation_notice_default.markers.disabled;
    DISABLE_RETRY = continuation_notice_default.markers.disable_retry;
    NOTICE_REQUIRED = continuation_notice_default.markers.notice_required;
    PROJECT_KEY_RE = /^[a-f0-9]{32}$/;
    CONTROL_KEY_RE = /^[a-f0-9]{64}$/;
    ATTEMPT_RE = /^[a-f0-9]{32}$/;
    OWNER_FILE2 = ".control-owner";
    SEND_OWNER_FILE = ".send-owner";
    PRODUCER_DIR = "producer-leases";
    LOCK_GRACE_MS = 5e3;
    UNSUPPORTED_DIR_FSYNC = /* @__PURE__ */ new Set(["EINVAL", "ENOSYS", "EPERM", "EACCES", "ENOENT"]);
    READY_PRODUCER_DIRS = /* @__PURE__ */ new Set();
  }
});

// skills/trtc/runtime/outbox.js
function isSafeEventId(id) {
  return typeof id === "string" && id.length > 0 && EVENT_ID_RE.test(id) && !WINDOWS_RESERVED_RE.test(id);
}
function resolveTelemetryRoot(stateRoot) {
  return (0, import_node_path3.join)(stateRoot, TELEMETRY_DIR);
}
function subdirs(root) {
  const tel = resolveTelemetryRoot(root);
  return {
    tel,
    pending: (0, import_node_path3.join)(tel, PENDING),
    outbox: (0, import_node_path3.join)(tel, OUTBOX),
    rejected: (0, import_node_path3.join)(tel, REJECTED),
    dropped: (0, import_node_path3.join)(tel, DROPPED),
    legacy: (0, import_node_path3.join)(tel, LEGACY_UNATTRIBUTED)
  };
}
function isPosix2() {
  return process.platform !== "win32";
}
function ensureDir3(dir) {
  (0, import_node_fs3.mkdirSync)(dir, { recursive: true, mode: isPosix2() ? 448 : void 0 });
  if (isPosix2()) {
    try {
      (0, import_node_fs3.chmodSync)(dir, 448);
    } catch {
    }
  }
}
function ensureLayout(root) {
  const d = subdirs(root);
  ensureDir3(d.tel);
  ensureDir3(d.pending);
  ensureDir3(d.outbox);
  ensureDir3(d.rejected);
  ensureDir3(d.dropped);
  return d;
}
function _syncSleep(ms) {
  if (ms <= 0)
    return;
  Atomics.wait(_syncSleepBuf, 0, 0, ms);
}
function _reservationPathFor(pendingDir, eventId) {
  return (0, import_node_path3.join)(pendingDir, `${RESERVATION_PREFIX}${eventId}`);
}
function _acquireReservationByPending(pendingDir, eventId, opts = {}) {
  if (!isSafeEventId(eventId)) {
    throw new TypeError(
      `acquireReservation: eventId must be a safe filename fragment: ${JSON.stringify(eventId)}`
    );
  }
  const lockPath2 = _reservationPathFor(pendingDir, eventId);
  const token = (0, import_node_crypto3.randomBytes)(16).toString("hex");
  const startMs = (opts.now || Date.now)();
  const body = `${process.pid}
${startMs}
${token}
`;
  const timeoutMs = num(opts.reservationTimeoutMs, DEFAULT_RESERVATION_TIMEOUT_MS);
  const deadlineMono = import_node_perf_hooks3.performance.now() + timeoutMs;
  let backoff = RESERVATION_BACKOFF_START_MS;
  while (true) {
    let fd;
    try {
      fd = (0, import_node_fs3.openSync)(lockPath2, "wx", 384);
    } catch (err) {
      if (err && err.code === "EEXIST") {
        const remainingMs = deadlineMono - import_node_perf_hooks3.performance.now();
        if (remainingMs <= 0)
          return null;
        _syncSleep(Math.min(backoff, remainingMs));
        backoff = Math.min(backoff * 2, RESERVATION_BACKOFF_MAX_MS);
        continue;
      }
      throw err;
    }
    try {
      writeAll2(fd, body);
    } finally {
      (0, import_node_fs3.closeSync)(fd);
    }
    return { path: lockPath2, token };
  }
}
function acquireReservation(root, eventId, opts = {}) {
  const d = ensureLayout(root);
  return _acquireReservationByPending(d.pending, eventId, opts);
}
function releaseReservation(lock) {
  if (!lock)
    return;
  if (typeof lock !== "object" || typeof lock.path !== "string" || typeof lock.token !== "string") {
    throw new TypeError(
      "releaseReservation: expected {path, token} handle from acquireReservation; legacy string form was removed in round-11 to preserve the token-based ownership protocol. Got: " + JSON.stringify(lock)
    );
  }
  const { path: path2, token } = lock;
  let body;
  try {
    body = (0, import_node_fs3.readFileSync)(path2, "utf8");
  } catch (err) {
    if (err && err.code === "ENOENT")
      return;
    throw err;
  }
  const parts = body.split("\n");
  if (parts.length < 3 || parts[2] !== token)
    return;
  try {
    (0, import_node_fs3.unlinkSync)(path2);
  } catch (err) {
    if (err && err.code !== "ENOENT")
      throw err;
  }
}
function payloadFilename(eventId) {
  return `${eventId}.json`;
}
function isFinalEventFile(name) {
  if (name.startsWith("."))
    return false;
  if (name.endsWith(".tmp"))
    return false;
  return FINAL_FILENAME_RE.test(name);
}
function writeAll2(fd, body) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  let offset = 0;
  while (offset < buf.length) {
    offset += (0, import_node_fs3.writeSync)(fd, buf, offset, buf.length - offset);
  }
}
function _atomicCreateNoClobber(finalPath, body, opts = {}) {
  const dir = (0, import_node_path3.dirname)(finalPath);
  let fd;
  try {
    fd = (0, import_node_fs3.openSync)(finalPath, "wx", 384);
  } catch (err) {
    if (err && err.code === "EEXIST") {
      return { path: finalPath, deduped: true, degraded: true };
    }
    throw err;
  }
  try {
    writeAll2(fd, body);
    if (!opts._skipFileFsync)
      (0, import_node_fs3.fsyncSync)(fd);
  } finally {
    (0, import_node_fs3.closeSync)(fd);
  }
  if (isPosix2()) {
    try {
      (0, import_node_fs3.chmodSync)(finalPath, 384);
    } catch {
    }
  }
  if (!opts._skipDirFsync)
    fsyncDirBestEffort3(dir);
  return { path: finalPath, deduped: false, degraded: true };
}
function atomicCreateOrDedupe(finalPath, body, opts = {}) {
  const dir = (0, import_node_path3.dirname)(finalPath);
  const tmp = (0, import_node_path3.join)(dir, `.${(0, import_node_crypto3.randomBytes)(4).toString("hex")}.${(0, import_node_path3.basename)(finalPath)}.tmp`);
  const fd = (0, import_node_fs3.openSync)(tmp, "wx", 384);
  try {
    writeAll2(fd, body);
    if (!opts._skipFileFsync)
      (0, import_node_fs3.fsyncSync)(fd);
  } finally {
    (0, import_node_fs3.closeSync)(fd);
  }
  let deduped = false;
  try {
    (0, import_node_fs3.linkSync)(tmp, finalPath);
  } catch (err) {
    if (err && err.code === "EEXIST") {
      deduped = true;
    } else if (err && LINK_UNSUPPORTED_CODES.has(err.code)) {
      try {
        (0, import_node_fs3.unlinkSync)(tmp);
      } catch {
      }
      return _atomicCreateNoClobber(finalPath, body, opts);
    } else {
      try {
        (0, import_node_fs3.unlinkSync)(tmp);
      } catch {
      }
      throw err;
    }
  }
  try {
    (0, import_node_fs3.unlinkSync)(tmp);
  } catch {
  }
  if (!deduped) {
    if (isPosix2()) {
      try {
        (0, import_node_fs3.chmodSync)(finalPath, 384);
      } catch {
      }
    }
    if (!opts._skipDirFsync)
      fsyncDirBestEffort3(dir);
  }
  return { path: finalPath, deduped, degraded: false };
}
function fsyncDirBestEffort3(dir) {
  let fd;
  try {
    fd = (0, import_node_fs3.openSync)(dir, "r");
    (0, import_node_fs3.fsyncSync)(fd);
  } catch (err) {
    if (err && (err.code === "EINVAL" || err.code === "ENOSYS" || err.code === "EPERM" || err.code === "EACCES" || err.code === "ENOENT"))
      return;
    throw err;
  } finally {
    if (fd !== void 0) {
      try {
        (0, import_node_fs3.closeSync)(fd);
      } catch {
      }
    }
  }
}
function readEvent(filePath) {
  let raw;
  try {
    raw = (0, import_node_fs3.readFileSync)(filePath, "utf8");
  } catch (err) {
    if (err && err.code === "ENOENT")
      return null;
    throw err;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
function listDir(dirPath) {
  let entries;
  try {
    entries = (0, import_node_fs3.readdirSync)(dirPath);
  } catch (err) {
    if (err && err.code === "ENOENT")
      return [];
    throw err;
  }
  return entries.filter(isFinalEventFile).sort().map((n) => (0, import_node_path3.join)(dirPath, n));
}
function listPending(root) {
  return listDir(subdirs(root).pending);
}
function listOutbox(root) {
  return listDir(subdirs(root).outbox);
}
function listRejected(root) {
  return listDir(subdirs(root).rejected);
}
function remove(filePath) {
  try {
    (0, import_node_fs3.unlinkSync)(filePath);
  } catch (err) {
    if (err && err.code === "ENOENT")
      return;
    throw err;
  }
}
function purgeProjectPromptEvents(root, targetProjectKey, opts = {}) {
  if (typeof targetProjectKey !== "string" || !/^[a-f0-9]{32}$/.test(targetProjectKey)) {
    throw new TypeError("purgeProjectPromptEvents: targetProjectKey must be a 32-char hex key");
  }
  const result = { removed: 0, busy: 0, skipped: 0 };
  for (const path2 of [...listPending(root), ...listOutbox(root), ...listRejected(root)]) {
    const event = readEvent(path2);
    if (!event || event.method !== "prompt" || event.__project_key !== targetProjectKey) {
      result.skipped++;
      continue;
    }
    const filename = (0, import_node_path3.basename)(path2);
    const eid = filename.endsWith(".json") ? filename.slice(0, -5) : "";
    if (!isSafeEventId(eid)) {
      result.skipped++;
      continue;
    }
    const lock = acquireReservation(root, eid, {
      ...opts,
      reservationTimeoutMs: Math.min(opts.reservationTimeoutMs ?? 25, 25)
    });
    if (!lock) {
      result.busy++;
      continue;
    }
    try {
      const current = readEvent(path2);
      if (current && current.method === "prompt" && current.__project_key === targetProjectKey) {
        remove(path2);
        result.removed++;
      }
    } finally {
      releaseReservation(lock);
    }
  }
  return result;
}
function purgeProjectEvents(root, targetProjectKey, opts = {}) {
  if (typeof targetProjectKey !== "string" || !/^[a-f0-9]{32}$/.test(targetProjectKey)) {
    throw new TypeError("purgeProjectEvents: targetProjectKey must be a 32-char hex key");
  }
  const result = {
    removed: 0,
    busy: 0,
    skipped: 0,
    errors: [],
    scans: 0,
    fixed_point: false,
    active_leases: 0,
    lease_busy: 0,
    legacy_unattributed: { found: 0, quarantined: 0, blocked: 0 },
    by_bucket: { pending: 0, outbox: 0, rejected: 0 }
  };
  let d;
  try {
    d = ensureLayout(root);
  } catch (err) {
    result.errors.push({ code: (err == null ? void 0 : err.code) || "layout_unavailable" });
    result.errors.push({ code: "purge_retryable" });
    return result;
  }
  try {
    ensureDir3(d.legacy);
  } catch (err) {
    result.errors.push({ code: (err == null ? void 0 : err.code) || "legacy_quarantine_unavailable" });
    result.errors.push({ code: "purge_retryable" });
    return result;
  }
  const maxScans = Math.max(2, Number.isFinite(opts.maxScans) ? opts.maxScans : 3);
  const buckets = [d.pending, d.outbox, d.rejected];
  const bucketName = /* @__PURE__ */ new Map([[d.pending, "pending"], [d.outbox, "outbox"], [d.rejected, "rejected"]]);
  let scanErrors = 0;
  const enumerate = () => {
    const files = [];
    for (const dir of buckets) {
      let names;
      try {
        names = (0, import_node_fs3.readdirSync)(dir);
      } catch (err) {
        if ((err == null ? void 0 : err.code) === "ENOENT")
          continue;
        scanErrors++;
        result.errors.push({ bucket: bucketName.get(dir), code: (err == null ? void 0 : err.code) || "scan_failed" });
        continue;
      }
      for (const name of names) {
        if (isFinalEventFile(name))
          files.push({ dir, path: (0, import_node_path3.join)(dir, name), name });
      }
    }
    return files;
  };
  for (let pass = 0; pass < maxScans; pass++) {
    result.scans++;
    let activeTarget = 0;
    let activeLegacy = 0;
    let passBusy = 0;
    scanErrors = 0;
    let passErrors = 0;
    const files = enumerate();
    passErrors += scanErrors;
    for (const item of files) {
      let event;
      try {
        event = readEvent(item.path);
      } catch (err) {
        result.errors.push({ bucket: bucketName.get(item.dir), code: (err == null ? void 0 : err.code) || "read_failed" });
        passErrors++;
        continue;
      }
      const project = event == null ? void 0 : event.__project_key;
      const validKey = typeof project === "string" && /^[a-f0-9]{32}$/.test(project);
      if (!validKey) {
        activeLegacy++;
        result.legacy_unattributed.found++;
        const rawEid = item.name.replace(/\.json$/, "");
        const eid2 = isSafeEventId(rawEid) ? rawEid : `legacy-${Date.now()}-${(0, import_node_crypto3.randomBytes)(4).toString("hex")}`;
        let lock2 = null;
        if (isSafeEventId(rawEid)) {
          lock2 = acquireReservation(root, rawEid, { reservationTimeoutMs: Math.min(opts.reservationTimeoutMs ?? 25, 25) });
          if (!lock2) {
            result.busy++;
            passBusy++;
            result.legacy_unattributed.blocked++;
            continue;
          }
        }
        try {
          const destination = (0, import_node_path3.join)(d.legacy, `${eid2}-${Date.now()}-${(0, import_node_crypto3.randomBytes)(4).toString("hex")}.json`);
          try {
            (0, import_node_fs3.renameSync)(item.path, destination);
            result.legacy_unattributed.quarantined++;
          } catch (err) {
            if ((err == null ? void 0 : err.code) !== "ENOENT") {
              result.errors.push({ bucket: bucketName.get(item.dir), event_id: eid2, code: (err == null ? void 0 : err.code) || "quarantine_failed" });
              passErrors++;
              result.legacy_unattributed.blocked++;
            }
          }
        } finally {
          if (lock2)
            releaseReservation(lock2);
        }
        continue;
      }
      if (project !== targetProjectKey) {
        result.skipped++;
        continue;
      }
      activeTarget++;
      const eid = item.name.replace(/\.json$/, "");
      if (!isSafeEventId(eid)) {
        result.busy++;
        passErrors++;
        result.errors.push({ bucket: bucketName.get(item.dir), code: "unsafe_event_id" });
        continue;
      }
      const lock = acquireReservation(root, eid, { reservationTimeoutMs: Math.min(opts.reservationTimeoutMs ?? 25, 25) });
      if (!lock) {
        result.busy++;
        passBusy++;
        continue;
      }
      try {
        const current = readEvent(item.path);
        if ((current == null ? void 0 : current.__project_key) === targetProjectKey) {
          try {
            remove(item.path);
            result.removed++;
            result.by_bucket[bucketName.get(item.dir)]++;
          } catch (err) {
            passErrors++;
            result.errors.push({ bucket: bucketName.get(item.dir), event_id: eid, code: (err == null ? void 0 : err.code) || "remove_failed" });
          }
        }
      } finally {
        releaseReservation(lock);
      }
    }
    let leases = { active: 0, busy: 0 };
    try {
      leases = listActiveProducerLeases(root, targetProjectKey, opts);
    } catch (err) {
      leases = { active: 0, busy: 1, error: (err == null ? void 0 : err.code) || "lease_scan_failed" };
    }
    result.active_leases = leases.active;
    result.lease_busy = leases.busy;
    if (leases.busy > 0) {
      result.busy += leases.busy;
      passBusy += leases.busy;
    }
    if (leases.error) {
      result.errors.push({ code: leases.error });
      passErrors++;
    }
    const residualClaims = buckets.some((dir) => {
      try {
        return (0, import_node_fs3.readdirSync)(dir).some((n) => n.startsWith(".claim-") || n.startsWith(".reserve-") || n.endsWith(".tmp"));
      } catch {
        return true;
      }
    });
    if (activeTarget === 0 && activeLegacy === 0 && passBusy === 0 && passErrors === 0 && leases.active === 0 && leases.busy === 0 && !leases.error && !residualClaims) {
      result.fixed_point = true;
      break;
    }
  }
  if (!result.fixed_point)
    result.errors.push({ code: "purge_retryable" });
  return result;
}
function currentMs(opts) {
  const now = opts && opts.now;
  return typeof now === "function" ? now() : Date.now();
}
function requireEventId(event) {
  const id = event && event.event_id;
  if (typeof id !== "string" || id.length === 0) {
    throw new Error("outbox: event.event_id required");
  }
  if (!EVENT_ID_RE.test(id)) {
    throw new Error(`outbox: unsafe event_id ${JSON.stringify(id)}`);
  }
  if (WINDOWS_RESERVED_RE.test(id)) {
    throw new Error(`outbox: reserved event_id ${JSON.stringify(id)}`);
  }
  return id;
}
function withTime(event, opts) {
  const t = event.time;
  return { ...event, time: t === void 0 || t === null ? currentMs(opts) : t };
}
function checkProjectWriteGate(root, event, opts = {}) {
  const eventKey = event == null ? void 0 : event.__project_key;
  const requestedKey = opts.projectKey ?? eventKey;
  const enforcing = opts.enforceProjectGate === true || eventKey !== void 0 || opts.projectKey !== void 0;
  if (!enforcing && opts._legacyFixtureCompat === true)
    return { allowed: true, status: "legacy_compat" };
  if (!enforcing)
    return { allowed: false, status: "legacy_unattributed", reason: "project_key_required" };
  if (typeof requestedKey !== "string" || !/^[a-f0-9]{32}$/.test(requestedKey)) {
    return { allowed: false, status: "legacy_unattributed", reason: "invalid_project_key" };
  }
  if (eventKey !== void 0 && eventKey !== requestedKey) {
    return { allowed: false, status: "legacy_unattributed", reason: "project_key_mismatch" };
  }
  const gate = readProjectDenyGate(root, requestedKey);
  return gate.allowed ? { allowed: true, status: "missing", projectKey: requestedKey } : { allowed: false, status: gate.status, reason: gate.reason || `deny_${gate.status}`, projectKey: requestedKey };
}
function blockedWriteResult(eid, gate) {
  return {
    status: "blocked",
    event_id: eid,
    reason: gate.status === "legacy_unattributed" ? "legacy_unattributed" : "reporting_disabled",
    gate: gate.status
  };
}
function writePending(root, event, opts = {}) {
  const d = ensureLayout(root);
  const eid = requireEventId(event);
  const gate = checkProjectWriteGate(root, event, opts);
  if (!gate.allowed)
    return blockedWriteResult(eid, gate);
  let lockPath2 = null;
  if (!opts._locked) {
    lockPath2 = acquireReservation(root, eid, opts);
    if (!lockPath2) {
      const err = new Error(`writePending: reservation timeout for ${eid}`);
      err.code = "RESERVATION_TIMEOUT";
      throw err;
    }
  }
  try {
    const outboxPath = (0, import_node_path3.join)(d.outbox, payloadFilename(eid));
    if ((0, import_node_fs3.existsSync)(outboxPath)) {
      const existing = readEvent(outboxPath);
      const incomingKey = gate.projectKey;
      const existingKey = existing == null ? void 0 : existing.__project_key;
      if (!existing || incomingKey && existingKey !== incomingKey || !incomingKey && existingKey) {
        return {
          status: "blocked",
          event_id: eid,
          reason: "outbox_conflict",
          gate: "outbox_conflict"
        };
      }
      return { path: outboxPath, deduped: true, degraded: false, reason: "in_outbox" };
    }
    const finalPath = (0, import_node_path3.join)(d.pending, payloadFilename(eid));
    const outcome = atomicCreateOrDedupe(finalPath, JSON.stringify(withTime(event, opts)), {
      _skipDirFsync: opts._hookMode === true,
      _skipFileFsync: opts._hookMode === true
    });
    const postGate = checkProjectWriteGate(root, event, opts);
    if (!postGate.allowed) {
      const current = readEvent(finalPath);
      const owned = current && (!gate.projectKey || current.__project_key === gate.projectKey);
      if (!outcome.deduped && owned) {
        try {
          (0, import_node_fs3.unlinkSync)(finalPath);
        } catch (err) {
          if ((err == null ? void 0 : err.code) !== "ENOENT")
            throw err;
        }
      }
      return blockedWriteResult(eid, postGate);
    }
    if ((0, import_node_fs3.existsSync)(outboxPath)) {
      try {
        (0, import_node_fs3.unlinkSync)(finalPath);
      } catch (err) {
        if (!err || err.code !== "ENOENT")
          throw err;
      }
      return { path: outboxPath, deduped: true, degraded: outcome.degraded, reason: "raced_outbox" };
    }
    const droppedPath = (0, import_node_path3.join)(d.dropped, payloadFilename(eid));
    try {
      (0, import_node_fs3.unlinkSync)(droppedPath);
    } catch (err) {
      if (!err || err.code !== "ENOENT")
        throw err;
    }
    return outcome;
  } finally {
    if (lockPath2)
      releaseReservation(lockPath2);
  }
}
function writePendingFromHook(root, event, opts = {}) {
  const callerBudget = Number.isFinite(opts.reservationTimeoutMs) ? Math.max(0, opts.reservationTimeoutMs) : HOOK_RESERVATION_TIMEOUT_MS;
  return writePending(root, event, {
    ...opts,
    reservationTimeoutMs: Math.min(HOOK_RESERVATION_TIMEOUT_MS, callerBudget),
    // Hook telemetry is best-effort: retain atomic publication but skip
    // file + directory fsync so the IDE request path is not gated on APFS
    // flush latency. See the Hook performance release gate.
    _hookMode: true
  });
}
function writeOutbox(root, event, opts = {}) {
  const d = ensureLayout(root);
  const eid = requireEventId(event);
  const gate = checkProjectWriteGate(root, event, opts);
  if (!gate.allowed)
    return blockedWriteResult(eid, gate);
  let lockPath2 = null;
  if (!opts._locked) {
    lockPath2 = acquireReservation(root, eid, opts);
    if (!lockPath2) {
      const err = new Error(`writeOutbox: reservation timeout for ${eid}`);
      err.code = "RESERVATION_TIMEOUT";
      throw err;
    }
  }
  try {
    const finalPath = (0, import_node_path3.join)(d.outbox, payloadFilename(eid));
    const outcome = atomicCreateOrDedupe(finalPath, JSON.stringify(withTime(event, opts)), {
      _skipDirFsync: opts._hookMode === true,
      _skipFileFsync: opts._hookMode === true
    });
    const postGate = checkProjectWriteGate(root, event, opts);
    if (!postGate.allowed) {
      const current = readEvent(finalPath);
      const owned = current && (!gate.projectKey || current.__project_key === gate.projectKey);
      if (!outcome.deduped && owned) {
        try {
          (0, import_node_fs3.unlinkSync)(finalPath);
        } catch (err) {
          if ((err == null ? void 0 : err.code) !== "ENOENT")
            throw err;
        }
      }
      return blockedWriteResult(eid, postGate);
    }
    const committed = readEvent(finalPath);
    const ownsCommitted = committed && (!gate.projectKey || committed.__project_key === gate.projectKey);
    if (!ownsCommitted)
      return blockedWriteResult(eid, { status: "legacy_unattributed", reason: "event_owner_mismatch" });
    const pendingPath = (0, import_node_path3.join)(d.pending, payloadFilename(eid));
    try {
      (0, import_node_fs3.unlinkSync)(pendingPath);
    } catch (err) {
      if (!err || err.code !== "ENOENT")
        throw err;
    }
    const droppedPath = (0, import_node_path3.join)(d.dropped, payloadFilename(eid));
    try {
      (0, import_node_fs3.unlinkSync)(droppedPath);
    } catch (err) {
      if (!err || err.code !== "ENOENT")
        throw err;
    }
    return outcome;
  } finally {
    if (lockPath2)
      releaseReservation(lockPath2);
  }
}
function writeOutboxFromHook(root, event, opts = {}) {
  const callerBudget = Number.isFinite(opts.reservationTimeoutMs) ? Math.max(0, opts.reservationTimeoutMs) : HOOK_RESERVATION_TIMEOUT_MS;
  return writeOutbox(root, event, {
    ...opts,
    reservationTimeoutMs: Math.min(HOOK_RESERVATION_TIMEOUT_MS, callerBudget),
    _hookMode: true
  });
}
function updateOutboxMetadata(root, eventId, meta, opts = {}) {
  if (!isSafeEventId(eventId)) {
    throw new TypeError(`updateOutboxMetadata: unsafe eventId ${JSON.stringify(eventId)}`);
  }
  if (!meta || typeof meta !== "object") {
    throw new TypeError("updateOutboxMetadata: meta must be an object");
  }
  for (const k of Object.keys(meta)) {
    if (!SENDER_METADATA_WHITELIST.has(k)) {
      throw new TypeError(
        `updateOutboxMetadata: key "${k}" not in sender metadata whitelist. Allowed: ${[...SENDER_METADATA_WHITELIST].join(", ")}`
      );
    }
  }
  const d = ensureLayout(root);
  let lock = null;
  if (!opts._locked) {
    lock = acquireReservation(root, eventId, opts);
    if (!lock) {
      return { ok: false, error: "reservation_timeout" };
    }
  }
  try {
    const filePath = (0, import_node_path3.join)(d.outbox, payloadFilename(eventId));
    const event = readEvent(filePath);
    if (event === null) {
      return { ok: false, error: "event_not_found" };
    }
    const updated = { ...event, ...meta };
    const body = JSON.stringify(updated);
    const tmp = (0, import_node_path3.join)(d.outbox, `.${(0, import_node_crypto3.randomBytes)(4).toString("hex")}.${eventId}.json.tmp`);
    let fd;
    try {
      fd = (0, import_node_fs3.openSync)(tmp, "wx", 384);
    } catch (err) {
      return { ok: false, error: `tmp_create: ${err.code}` };
    }
    try {
      writeAll2(fd, body);
      (0, import_node_fs3.fsyncSync)(fd);
    } finally {
      (0, import_node_fs3.closeSync)(fd);
    }
    try {
      (0, import_node_fs3.renameSync)(tmp, filePath);
    } catch (err) {
      try {
        (0, import_node_fs3.unlinkSync)(tmp);
      } catch {
      }
      return { ok: false, error: `rename: ${err.code}` };
    }
    fsyncDirBestEffort3(d.outbox);
    return { ok: true };
  } finally {
    if (lock)
      releaseReservation(lock);
  }
}
function sanitizeEnrichment(enrichment) {
  const out = {};
  if (!enrichment || typeof enrichment !== "object")
    return out;
  for (const k of Object.keys(enrichment)) {
    if (ALLOWED_ENRICHMENT_KEYS.has(k))
      out[k] = enrichment[k];
  }
  return out;
}
function _buildMergedEvent(base, enrichment) {
  if (base == null || typeof base !== "object") {
    throw new TypeError("_buildMergedEvent: base event must be an object");
  }
  const merged = { ...base, ...sanitizeEnrichment(enrichment) };
  merged.event_id = base.event_id;
  merged.time = base.time;
  if (base.method !== void 0)
    merged.method = base.method;
  if (base.text !== void 0)
    merged.text = base.text;
  if (base.schema_version !== void 0)
    merged.schema_version = base.schema_version;
  if (base.client_generation !== void 0)
    merged.client_generation = base.client_generation;
  if (base.platform !== void 0)
    merged.platform = base.platform;
  return merged;
}
function moveToRejected(root, srcPath, reason, opts = {}) {
  const d = ensureLayout(root);
  const body = readEvent(srcPath);
  if (body == null) {
    const err = new Error(`outbox: cannot read source ${srcPath}`);
    err.code = "ENOENT";
    throw err;
  }
  let eid;
  try {
    eid = requireEventId(body);
  } catch (err) {
    if (opts.fallbackEventId && isSafeEventId(opts.fallbackEventId)) {
      eid = opts.fallbackEventId;
    } else {
      throw err;
    }
  }
  const wrapped = { ...body, __rejected: { reason, ts: currentMs(opts) } };
  const dst = (0, import_node_path3.join)(d.rejected, payloadFilename(eid));
  atomicCreateOrDedupe(dst, JSON.stringify(wrapped));
  remove(srcPath);
  const cap = opts.rejectedMax || DEFAULT_REJECTED_MAX;
  const rejected = listRejected(root);
  if (rejected.length > cap) {
    const excess = rejected.length - cap;
    for (let i = 0; i < excess; i++)
      remove(rejected[i]);
  }
  return { path: dst };
}
function num(v, fallback) {
  return Number.isFinite(v) ? v : fallback;
}
var import_node_crypto3, import_node_fs3, import_node_path3, import_node_perf_hooks3, TELEMETRY_DIR, PENDING, OUTBOX, REJECTED, DROPPED, LEGACY_UNATTRIBUTED, DEFAULT_MAX_AGE_MS, DEFAULT_MAX_BYTES2, DEFAULT_REJECTED_MAX, DEFAULT_ORPHAN_TMP_MAX_AGE_MS, DEFAULT_CORRUPT_GRACE_MS, EVENT_ID_RE, WINDOWS_RESERVED_RE, FINAL_FILENAME_RE, ALLOWED_ENRICHMENT_KEYS, RESERVATION_PREFIX, DEFAULT_RESERVATION_TIMEOUT_MS, HOOK_RESERVATION_TIMEOUT_MS, DEFAULT_RESERVATION_ORPHAN_GRACE_MS, RESERVATION_BACKOFF_START_MS, RESERVATION_BACKOFF_MAX_MS, _syncSleepBuf, LINK_UNSUPPORTED_CODES, SENDER_METADATA_WHITELIST;
var init_outbox = __esm({
  "skills/trtc/runtime/outbox.js"() {
    import_node_crypto3 = require("node:crypto");
    import_node_fs3 = require("node:fs");
    import_node_path3 = require("node:path");
    init_identity();
    import_node_perf_hooks3 = require("node:perf_hooks");
    init_control();
    TELEMETRY_DIR = "telemetry";
    PENDING = "pending";
    OUTBOX = "outbox";
    REJECTED = "rejected";
    DROPPED = "dropped";
    LEGACY_UNATTRIBUTED = "legacy-unattributed";
    DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1e3;
    DEFAULT_MAX_BYTES2 = 10 * 1024 * 1024;
    DEFAULT_REJECTED_MAX = 200;
    DEFAULT_ORPHAN_TMP_MAX_AGE_MS = 24 * 60 * 60 * 1e3;
    DEFAULT_CORRUPT_GRACE_MS = 60 * 1e3;
    EVENT_ID_RE = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
    WINDOWS_RESERVED_RE = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i;
    FINAL_FILENAME_RE = /^([A-Za-z0-9._-]{1,128})\.json$/;
    ALLOWED_ENRICHMENT_KEYS = /* @__PURE__ */ new Set([
      "useragent",
      "identity_scope",
      "identity_pending",
      "skillname",
      "product",
      "framework",
      "flow_id",
      "turn_id",
      "sdkappid",
      "delivery_guarantee"
    ]);
    RESERVATION_PREFIX = ".reserve-";
    DEFAULT_RESERVATION_TIMEOUT_MS = 1e3;
    HOOK_RESERVATION_TIMEOUT_MS = 25;
    DEFAULT_RESERVATION_ORPHAN_GRACE_MS = 60 * 1e3;
    RESERVATION_BACKOFF_START_MS = 1;
    RESERVATION_BACKOFF_MAX_MS = 10;
    _syncSleepBuf = new Int32Array(new SharedArrayBuffer(4));
    LINK_UNSUPPORTED_CODES = /* @__PURE__ */ new Set(["ENOTSUP", "EOPNOTSUPP", "EPERM", "EXDEV"]);
    SENDER_METADATA_WHITELIST = /* @__PURE__ */ new Set([
      "__sender_retry_count",
      "__sender_retry_after"
    ]);
  }
});

// skills/trtc/runtime/hook-activation.js
function activationRoot(stateRoot) {
  return (0, import_node_path4.join)(stateRoot, "telemetry", ACTIVATION_DIR);
}
function readSeed(path2) {
  try {
    const seed = (0, import_node_fs4.readFileSync)(path2, "utf8").trim();
    return /^[a-f0-9]{64}$/.test(seed) ? seed : null;
  } catch {
    return null;
  }
}
function ensureActivationDeviceSeed(stateRoot, opts = {}) {
  const dir = activationRoot(stateRoot);
  const path2 = (0, import_node_path4.join)(dir, DEVICE_SEED_FILE);
  const existing = readSeed(path2);
  if (existing)
    return existing;
  if (Number.isFinite(opts.deadlineMono) && import_node_perf_hooks4.performance.now() >= opts.deadlineMono)
    return null;
  try {
    (0, import_node_fs4.mkdirSync)(dir, { recursive: true, mode: process.platform === "win32" ? void 0 : 448 });
  } catch {
    return null;
  }
  const seed = (0, import_node_crypto4.randomBytes)(32).toString("hex");
  const tmp = (0, import_node_path4.join)(dir, `.device-seed-${process.pid}-${(0, import_node_crypto4.randomBytes)(6).toString("hex")}.tmp`);
  let fd;
  try {
    fd = (0, import_node_fs4.openSync)(tmp, "wx", process.platform === "win32" ? void 0 : 384);
    (0, import_node_fs4.writeSync)(fd, `${seed}
`, null, "utf8");
    (0, import_node_fs4.fsyncSync)(fd);
    (0, import_node_fs4.closeSync)(fd);
    fd = void 0;
    try {
      (0, import_node_fs4.linkSync)(tmp, path2);
    } catch (err) {
      if ((err == null ? void 0 : err.code) !== "EEXIST")
        throw err;
    }
    try {
      (0, import_node_fs4.unlinkSync)(tmp);
    } catch {
    }
    return readSeed(path2);
  } catch (err) {
    if (fd !== void 0)
      try {
        (0, import_node_fs4.closeSync)(fd);
      } catch {
      }
    try {
      (0, import_node_fs4.unlinkSync)(tmp);
    } catch {
    }
    return null;
  }
}
function deriveActivationEventId(deviceSeed, projectKey2, ide, version) {
  if (!/^[a-f0-9]{64}$/.test(String(deviceSeed)))
    throw new TypeError("invalid activation device seed");
  const digest2 = (0, import_node_crypto4.createHash)("sha256").update(`${deviceSeed}\0${projectKey2}\0${ide}\0${version}`).digest("hex").slice(0, 40);
  return `ha_${digest2}`;
}
function activationAckPath(stateRoot, eventId) {
  if (!SAFE_EVENT_ID_RE.test(String(eventId)))
    throw new TypeError("invalid activation event id");
  return (0, import_node_path4.join)(activationRoot(stateRoot), ACK_DIR, `${eventId}.ack`);
}
function isHookActivationAcked(stateRoot, eventId) {
  try {
    return (0, import_node_fs4.readFileSync)(activationAckPath(stateRoot, eventId), "utf8").trim() === eventId;
  } catch {
    return false;
  }
}
function acknowledgeHookActivation(stateRoot, event) {
  if ((event == null ? void 0 : event.text) !== "hook_activated" || !SAFE_EVENT_ID_RE.test(String(event.event_id)) || event.__activation_key !== event.event_id) {
    return { applicable: false, acked: false };
  }
  const path2 = activationAckPath(stateRoot, event.event_id);
  const dir = (0, import_node_path4.join)(activationRoot(stateRoot), ACK_DIR);
  (0, import_node_fs4.mkdirSync)(dir, {
    recursive: true,
    mode: process.platform === "win32" ? void 0 : 448
  });
  const tmp = (0, import_node_path4.join)(dir, `.ack-${process.pid}-${(0, import_node_crypto4.randomBytes)(6).toString("hex")}.tmp`);
  let fd;
  try {
    fd = (0, import_node_fs4.openSync)(tmp, "wx", process.platform === "win32" ? void 0 : 384);
    (0, import_node_fs4.writeSync)(fd, `${event.event_id}
`, null, "utf8");
    (0, import_node_fs4.fsyncSync)(fd);
    (0, import_node_fs4.closeSync)(fd);
    fd = void 0;
    let deduped = false;
    try {
      (0, import_node_fs4.linkSync)(tmp, path2);
    } catch (err) {
      if ((err == null ? void 0 : err.code) === "EEXIST")
        deduped = true;
      else
        throw err;
    }
    try {
      (0, import_node_fs4.unlinkSync)(tmp);
    } catch {
    }
    if (!isHookActivationAcked(stateRoot, event.event_id))
      throw new Error("activation ack publish failed");
    return { applicable: true, acked: true, path: path2, ...deduped ? { deduped: true } : {} };
  } catch (err) {
    if (fd !== void 0)
      try {
        (0, import_node_fs4.closeSync)(fd);
      } catch {
      }
    try {
      (0, import_node_fs4.unlinkSync)(tmp);
    } catch {
    }
    throw err;
  }
}
var import_node_crypto4, import_node_fs4, import_node_path4, import_node_perf_hooks4, ACTIVATION_DIR, DEVICE_SEED_FILE, ACK_DIR, SAFE_EVENT_ID_RE;
var init_hook_activation = __esm({
  "skills/trtc/runtime/hook-activation.js"() {
    import_node_crypto4 = require("node:crypto");
    import_node_fs4 = require("node:fs");
    import_node_path4 = require("node:path");
    import_node_perf_hooks4 = require("node:perf_hooks");
    ACTIVATION_DIR = "hook-activation";
    DEVICE_SEED_FILE = "device-seed";
    ACK_DIR = "acked";
    SAFE_EVENT_ID_RE = /^ha_[a-f0-9]{40}$/;
  }
});

// skills/trtc/runtime/redact.js
function isRedactableIPv4(addr) {
  const parts = addr.split(".");
  if (parts.length !== 4)
    return false;
  const nums = new Array(4);
  for (let i = 0; i < 4; i++) {
    const p = parts[i];
    if (!/^\d{1,3}$/.test(p))
      return false;
    const n = Number(p);
    if (n < 0 || n > 255)
      return false;
    nums[i] = n;
  }
  const [a, b, c] = nums;
  if (a === 0)
    return true;
  if (a === 10)
    return true;
  if (a === 127)
    return true;
  if (a === 169 && b === 254)
    return true;
  if (a === 172 && b >= 16 && b <= 31)
    return true;
  if (a === 192 && b === 0 && c === 0 && nums[3] >= 0 && nums[3] <= 7)
    return true;
  if (a === 192 && b === 0 && c === 0 && (nums[3] === 170 || nums[3] === 171))
    return true;
  if (a === 192 && b === 0 && c === 2)
    return true;
  if (a === 192 && b === 168)
    return true;
  if (a === 198 && (b === 18 || b === 19))
    return true;
  if (a === 198 && b === 51 && c === 100)
    return true;
  if (a === 203 && b === 0 && c === 113)
    return true;
  if (a >= 240)
    return true;
  return false;
}
function redactText(text) {
  if (!text)
    return text;
  let out = text;
  out = out.replace(PEM_PRIVATE_KEY_RE, REDACTED);
  out = out.replace(BEARER_RE, `Bearer ${REDACTED}`);
  out = out.replace(JWT_RE, REDACTED);
  out = out.replace(CLOUD_ACCESS_ID_RE, REDACTED);
  for (const pattern of SECRET_LABEL_PAIRED_RES) {
    out = out.replace(pattern, (...args) => {
      const groups = args[args.length - 1];
      return `${groups.label}${groups.open}${REDACTED}${groups.close}`;
    });
  }
  for (const pattern of SECRET_LABEL_UNCLOSED_RES) {
    out = out.replace(pattern, (...args) => {
      const groups = args[args.length - 1];
      return `${groups.label}${groups.open}${REDACTED}`;
    });
  }
  out = out.replace(SECRET_LABEL_UNQUOTED_RE, (...args) => {
    const groups = args[args.length - 1];
    return `${groups.label}${REDACTED}`;
  });
  out = out.replace(COOKIE_HEADER_RE, (...args) => {
    const groups = args[args.length - 1];
    return `${groups.label}: ${REDACTED}`;
  });
  out = out.replace(URL_SECRET_QUERY_RE, (...args) => {
    const groups = args[args.length - 1];
    return `${groups.prefix}${REDACTED}`;
  });
  out = out.replace(SECRET_HEX_RE, REDACTED);
  out = out.replace(EMAIL_RE, REDACTED);
  out = out.replace(CN_MOBILE_RE, REDACTED);
  out = out.replace(UNIX_USER_PATH_RE, (...args) => {
    const groups = args[args.length - 1];
    return `${groups.prefix}${USER_REDACTED}`;
  });
  out = out.replace(WINDOWS_USER_PATH_RE, (...args) => {
    const groups = args[args.length - 1];
    return `${groups.prefix}${USER_REDACTED}`;
  });
  out = out.replace(IPV4_RE, (m) => isRedactableIPv4(m) ? REDACTED : m);
  for (const pattern of AUTHORIZATION_PAIRED_RES) {
    out = out.replace(pattern, (...args) => {
      const groups = args[args.length - 1];
      return `${groups.open}${groups.leading}${groups.prefix}${REDACTED}${groups.close}`;
    });
  }
  for (const pattern of AUTHORIZATION_UNCLOSED_RES) {
    out = out.replace(pattern, (...args) => {
      const groups = args[args.length - 1];
      return `${groups.open}${groups.leading}${groups.prefix}${REDACTED}`;
    });
  }
  out = out.replace(AUTHORIZATION_BASIC_RE, (...args) => {
    const groups = args[args.length - 1];
    return `${groups.boundary}${groups.prefix}${REDACTED}`;
  });
  out = out.replace(AUTHORIZATION_PARAMS_UNQUOTED_RE, (...args) => {
    const groups = args[args.length - 1];
    return `${groups.boundary}${groups.prefix}${REDACTED}`;
  });
  return out;
}
function sanitizeReportText(text) {
  const redacted = redactText(text);
  if (typeof redacted !== "string")
    return redacted;
  const buf = Buffer.from(redacted, "utf8");
  if (buf.length <= MAX_REPORTED_TEXT_BYTES)
    return redacted;
  const markerBytes = Buffer.byteLength(TRUNCATION_MARKER, "utf8");
  const available = MAX_REPORTED_TEXT_BYTES - markerBytes;
  if (available <= 0)
    return TRUNCATION_MARKER;
  const headBytes = Math.floor(available * 3 / 4);
  const tailBytes = available - headBytes;
  const head = safeUtf8Head(buf, headBytes);
  const tail = safeUtf8Tail(buf, tailBytes);
  return `${head}${TRUNCATION_MARKER}${tail}`;
}
function safeUtf8Head(buf, size) {
  if (size >= buf.length)
    return buf.toString("utf8");
  let end = size;
  while (end > 0 && (buf[end] & 192) === 128)
    end--;
  return buf.subarray(0, end).toString("utf8");
}
function safeUtf8Tail(buf, size) {
  if (size >= buf.length)
    return buf.toString("utf8");
  let start = buf.length - size;
  while (start < buf.length && (buf[start] & 192) === 128)
    start++;
  return buf.subarray(start).toString("utf8");
}
var REDACTED, USER_REDACTED, MAX_REPORTED_TEXT_BYTES, TRUNCATION_MARKER, PEM_PRIVATE_KEY_RE, BEARER_RE, JWT_RE, CLOUD_ACCESS_ID_RE, SECRET_LABEL_PREFIX, SECRET_LABEL_PAIRED_RES, SECRET_LABEL_UNCLOSED_RES, SECRET_LABEL_UNQUOTED_RE, COOKIE_HEADER_RE, URL_SECRET_QUERY_RE, SECRET_HEX_RE, EMAIL_RE, CN_MOBILE_RE, UNIX_USER_PATH_RE, WINDOWS_USER_PATH_RE, IPV4_RE, AUTHORIZATION_PAIRED_RES, AUTHORIZATION_UNCLOSED_RES, AUTHORIZATION_BASIC_RE, AUTHORIZATION_PARAMS_UNQUOTED_RE;
var init_redact = __esm({
  "skills/trtc/runtime/redact.js"() {
    REDACTED = "[REDACTED]";
    USER_REDACTED = "[USER]";
    MAX_REPORTED_TEXT_BYTES = 32 * 1024;
    TRUNCATION_MARKER = "\n...[TRUNCATED FOR REPORTING]...\n";
    PEM_PRIVATE_KEY_RE = /-----BEGIN(?: [A-Z0-9]+)? PRIVATE KEY-----[\s\S]*?-----END(?: [A-Z0-9]+)? PRIVATE KEY-----/gs;
    BEARER_RE = /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi;
    JWT_RE = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g;
    CLOUD_ACCESS_ID_RE = /\b(?:AKIA|AKID)[A-Z0-9]{12,}\b/g;
    SECRET_LABEL_PREFIX = `(?<label>["'“”‘’]?(?:secret[\\t _-]*(?:key|id)?|api[\\t _-]*key|access[\\t _-]*token|refresh[\\t _-]*token|id[\\t _-]*token|auth(?:orization)?[\\t _-]*token|client[\\t _-]*secret|private[\\t _-]*key|password|passwd|pwd|usersig|session[\\t _-]*(?:token|secret)|credential|密钥|密码|令牌|访问令牌|用户签名)["'“”‘’]?[\\t ]*[:：=][\\t ]*)`;
    SECRET_LABEL_PAIRED_RES = Object.freeze([
      new RegExp(`${SECRET_LABEL_PREFIX}(?<open>")(?<value>(?:\\\\[^\\r\\n]|[^"\\\\\\r\\n])+)(?<close>")`, "gi"),
      new RegExp(`${SECRET_LABEL_PREFIX}(?<open>')(?<value>(?:\\\\[^\\r\\n]|[^'\\\\\\r\\n])+)(?<close>')`, "gi"),
      new RegExp(`${SECRET_LABEL_PREFIX}(?<open>“)(?<value>[^”\\r\\n]+)(?<close>”)`, "gi"),
      new RegExp(`${SECRET_LABEL_PREFIX}(?<open>‘)(?<value>[^’\\r\\n]+)(?<close>’)`, "gi")
    ]);
    SECRET_LABEL_UNCLOSED_RES = Object.freeze([
      new RegExp(`${SECRET_LABEL_PREFIX}(?<open>")(?<value>(?:\\\\[^\\r\\n]|[^"\\\\\\r\\n])+)(?=\\r?$)`, "gim"),
      new RegExp(`${SECRET_LABEL_PREFIX}(?<open>')(?<value>(?:\\\\[^\\r\\n]|[^'\\\\\\r\\n])+)(?=\\r?$)`, "gim"),
      new RegExp(`${SECRET_LABEL_PREFIX}(?<open>“)(?<value>[^”\\r\\n]+)(?=\\r?$)`, "gim"),
      new RegExp(`${SECRET_LABEL_PREFIX}(?<open>‘)(?<value>[^’\\r\\n]+)(?=\\r?$)`, "gim")
    ]);
    SECRET_LABEL_UNQUOTED_RE = new RegExp(
      `${SECRET_LABEL_PREFIX}(?<value>[^\\s,\\uff0c;\\uff1b&"'“”‘’]+)`,
      "gi"
    );
    COOKIE_HEADER_RE = /\b(?<label>cookie|set-cookie)\s*:\s*(?<value>[^\r\n]+)/gim;
    URL_SECRET_QUERY_RE = new RegExp(
      "(?<prefix>[?&](?:access[_-]?token|auth|authorization|credential|key|password|secret|session[_-]?token|sig|signature|token|usersig)=)(?<value>[^&#\\s]+)",
      "gi"
    );
    SECRET_HEX_RE = /\b[0-9a-fA-F]{32,}\b/g;
    EMAIL_RE = /(?<![\w.+-])[\w.+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?![\w.-])/g;
    CN_MOBILE_RE = /(?<!\d)(?:\+?86[\s-]?)?1[3-9]\d{9}(?!\d)/g;
    UNIX_USER_PATH_RE = new RegExp(
      String.raw`(?<prefix>/(?:Users|home)/)[^/\s]+`,
      "g"
    );
    WINDOWS_USER_PATH_RE = new RegExp(
      String.raw`(?<prefix>\b[A-Z]:\\Users\\)[^\\/\s]+`,
      "gi"
    );
    IPV4_RE = /(?<!\d)(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}(?!\d)/g;
    AUTHORIZATION_PAIRED_RES = Object.freeze([
      /(?<open>")(?<leading>[\t ]*)(?<prefix>authorization[\t ]*:[\t ]*(?:digest|oauth)\b[\t ]+)(?<value>(?:\\[^\r\n]|[^"\\\r\n])+)(?<close>")/gim,
      /(?<open>')(?<leading>[\t ]*)(?<prefix>authorization[\t ]*:[\t ]*(?:digest|oauth)\b[\t ]+)(?<value>(?:\\[^\r\n]|[^'\\\r\n])+)(?<close>')/gim,
      /(?<open>“)(?<leading>[\t ]*)(?<prefix>authorization[\t ]*:[\t ]*(?:digest|oauth)\b[\t ]+)(?<value>[^”\r\n]+)(?<close>”)/gim,
      /(?<open>‘)(?<leading>[\t ]*)(?<prefix>authorization[\t ]*:[\t ]*(?:digest|oauth)\b[\t ]+)(?<value>[^’\r\n]+)(?<close>’)/gim
    ]);
    AUTHORIZATION_UNCLOSED_RES = Object.freeze([
      /(?<open>")(?<leading>[\t ]*)(?<prefix>authorization[\t ]*:[\t ]*(?:digest|oauth)\b[\t ]+)(?<value>(?:\\[^\r\n]|[^"\\\r\n])+)(?=\r?$)/gim,
      /(?<open>')(?<leading>[\t ]*)(?<prefix>authorization[\t ]*:[\t ]*(?:digest|oauth)\b[\t ]+)(?<value>(?:\\[^\r\n]|[^'\\\r\n])+)(?=\r?$)/gim,
      /(?<open>“)(?<leading>[\t ]*)(?<prefix>authorization[\t ]*:[\t ]*(?:digest|oauth)\b[\t ]+)(?<value>[^”\r\n]+)(?=\r?$)/gim,
      /(?<open>‘)(?<leading>[\t ]*)(?<prefix>authorization[\t ]*:[\t ]*(?:digest|oauth)\b[\t ]+)(?<value>[^’\r\n]+)(?=\r?$)/gim
    ]);
    AUTHORIZATION_BASIC_RE = /(?<boundary>^|[^A-Za-z0-9_-])(?<prefix>authorization[\t ]*:[\t ]*basic\b[\t ]+)(?<value>[A-Za-z0-9._~+\/-]+=*)(?=$|[^A-Za-z0-9._~+\/=-])/gim;
    AUTHORIZATION_PARAMS_UNQUOTED_RE = /(?<boundary>^|[^A-Za-z0-9_'"“”‘’-])(?<prefix>authorization[\t ]*:[\t ]*(?:digest|oauth)\b[\t ]+)(?<value>[^\r\n]+)/gim;
  }
});

// skills/trtc/runtime/schema.js
function makeEnvelope(partial = {}) {
  const p = partial ?? {};
  return {
    ...p,
    platform: PLATFORM,
    schema_version: SCHEMA_VERSION,
    client_generation: CLIENT_GENERATION_V2,
    event_id: p.event_id ?? (0, import_node_crypto7.randomUUID)(),
    time: p.time ?? Date.now()
  };
}
function toCLSContents(event) {
  if (event == null || typeof event !== "object") {
    throw new TypeError("event must be a non-null object");
  }
  const conflicting = [];
  for (const wire of WIRE_ONLY_KEYS) {
    if (Object.prototype.hasOwnProperty.call(event, wire)) {
      conflicting.push(wire);
    }
  }
  if (conflicting.length > 0) {
    throw new Error(
      `event contains wire-side field(s) ${conflicting.map((k) => `"${k}"`).join(", ")} — use the internal name (version/skillname/product/sessionid) instead`
    );
  }
  const out = {};
  for (const [key, value] of Object.entries(event)) {
    if (value === void 0 || value === null)
      continue;
    if (key.startsWith("__"))
      continue;
    if (WIRE_STRIPPED_INTERNAL_KEYS.has(key))
      continue;
    const wireKey = INTERNAL_TO_WIRE[key] ?? key;
    if (typeof value === "string") {
      out[wireKey] = value;
    } else if (typeof value === "number" || typeof value === "boolean") {
      out[wireKey] = String(value);
    } else {
      out[wireKey] = JSON.stringify(value);
    }
  }
  return out;
}
function validateEvent(event) {
  if (event == null || typeof event !== "object") {
    throw new TypeError("event must be a non-null object");
  }
  if (event.platform !== PLATFORM) {
    throw new Error(`platform must be "${PLATFORM}"`);
  }
  if (event.schema_version !== SCHEMA_VERSION) {
    throw new Error(`schema_version must be ${SCHEMA_VERSION}`);
  }
  if (event.client_generation !== CLIENT_GENERATION_V2) {
    throw new Error(`client_generation must be "${CLIENT_GENERATION_V2}"`);
  }
  if (typeof event.event_id !== "string" || event.event_id.length === 0) {
    throw new Error("event_id is required");
  }
  if (typeof event.time !== "number" || !Number.isFinite(event.time)) {
    throw new Error("time must be a finite number (ms since epoch)");
  }
  if (typeof event.method !== "string") {
    throw new Error("method is required");
  }
  if (!VALID_METHODS.has(event.method)) {
    throw new Error(`method "${event.method}" is not a recognized method`);
  }
  switch (event.method) {
    case METHOD.EVENT:
      if (!VALID_EVENT_TEXTS.has(event.text)) {
        throw new Error(`text "${event.text}" is not a recognized event type`);
      }
      break;
    case METHOD.PROMPT:
      if (typeof event.text !== "string") {
        throw new Error("prompt event must have text");
      }
      break;
    case METHOD.FEEDBACK:
      if (event.feedback !== "0" && event.feedback !== "1") {
        throw new Error('feedback event must have feedback in {"0","1"}');
      }
      break;
  }
  return true;
}
var import_node_crypto7, EVENT_TYPES, VALID_EVENT_TEXTS, SCHEMA_VERSION, CLIENT_GENERATION_V2, CLIENT_GENERATION_LEGACY, PLATFORM, METHOD, VALID_METHODS, INTERNAL_TO_WIRE, WIRE_ONLY_KEYS, WIRE_STRIPPED_INTERNAL_KEYS;
var init_schema = __esm({
  "skills/trtc/runtime/schema.js"() {
    import_node_crypto7 = require("node:crypto");
    EVENT_TYPES = Object.freeze({
      INSTALL_COMPLETED: "install_completed",
      INSTALL_FAILED: "install_failed",
      UPGRADE_STARTED: "upgrade_started",
      UPGRADE_COMPLETED: "upgrade_completed",
      UPGRADE_FAILED: "upgrade_failed",
      HOOK_ACTIVATED: "hook_activated",
      TEST_RUN_STARTED: "test_run_started",
      TEST_RUN_COMPLETED: "test_run_completed",
      MCP_STARTED: "mcp_started",
      MCP_TOOL_INVOKED: "mcp_tool_invoked"
    });
    VALID_EVENT_TEXTS = new Set(Object.values(EVENT_TYPES));
    SCHEMA_VERSION = 2;
    CLIENT_GENERATION_V2 = "v2";
    CLIENT_GENERATION_LEGACY = "legacy";
    PLATFORM = "skill";
    METHOD = Object.freeze({
      PROMPT: "prompt",
      EVENT: "event",
      FEEDBACK: "feedback"
    });
    VALID_METHODS = new Set(Object.values(METHOD));
    INTERNAL_TO_WIRE = Object.freeze({
      version: "verison",
      // preserve historic CLS typo (rollout Q1)
      skillname: "level",
      product: "type",
      sessionid: "userid"
    });
    WIRE_ONLY_KEYS = new Set(Object.values(INTERNAL_TO_WIRE));
    WIRE_STRIPPED_INTERNAL_KEYS = /* @__PURE__ */ new Set([
      "identity_pending",
      // C20: first-use opt-out control fields — internal state only
      "continuation_choice",
      "continuation_choice_version",
      "continuation_choice_updated_at",
      "continuation_notice_required",
      "continuation_notice_version",
      "notice_attempt_id",
      "preference_revision"
    ]);
  }
});

// skills/trtc/runtime/state.js
var state_exports = {};
__export(state_exports, {
  isOutbox: () => isOutbox,
  isPending: () => isPending,
  promote: () => promote
});
function pendingDirFor(root) {
  return (0, import_node_path10.join)(resolveTelemetryRoot(root), PENDING2);
}
function pendingPathFor(root, eventId) {
  return (0, import_node_path10.join)(pendingDirFor(root), `${eventId}.json`);
}
function outboxPathFor(root, eventId) {
  return (0, import_node_path10.join)(resolveTelemetryRoot(root), OUTBOX2, `${eventId}.json`);
}
function droppedPathFor(root, eventId) {
  return (0, import_node_path10.join)(resolveTelemetryRoot(root), DROPPED2, `${eventId}.json`);
}
function promoteClaimPath(root, eventId) {
  return (0, import_node_path10.join)(
    pendingDirFor(root),
    `.claim-${process.pid}-${(0, import_node_crypto10.randomBytes)(4).toString("hex")}.${eventId}.json`
  );
}
function safeStringifyForReason(v) {
  let s = null;
  try {
    s = JSON.stringify(v);
  } catch {
    s = null;
  }
  if (typeof s !== "string") {
    try {
      s = String(v);
    } catch {
      s = "<unrepresentable>";
    }
  }
  return s.slice(0, 64);
}
function cleanStaleTombstone(root, eventId) {
  try {
    (0, import_node_fs10.unlinkSync)(droppedPathFor(root, eventId));
  } catch (err) {
    if (err && err.code !== "ENOENT")
      throw err;
  }
}
function cleanStalePending(root, eventId) {
  try {
    (0, import_node_fs10.unlinkSync)(pendingPathFor(root, eventId));
  } catch (err) {
    if (err && err.code !== "ENOENT")
      throw err;
  }
}
function isPending(root, eventId) {
  if (!isSafeEventId(eventId))
    return false;
  return (0, import_node_fs10.existsSync)(pendingPathFor(root, eventId));
}
function isOutbox(root, eventId) {
  if (!isSafeEventId(eventId))
    return false;
  return (0, import_node_fs10.existsSync)(outboxPathFor(root, eventId));
}
function promote(root, eventId, enrichment, opts = {}) {
  if (!isSafeEventId(eventId)) {
    throw new TypeError(
      `promote: eventId must be a safe filename fragment (see isSafeEventId): ${JSON.stringify(eventId)}`
    );
  }
  const reservation = acquireReservation(root, eventId, opts);
  if (!reservation) {
    return { status: "not_found", event_id: eventId, error: "reservation_timeout" };
  }
  try {
    return _promoteLocked(root, eventId, enrichment, opts);
  } finally {
    releaseReservation(reservation);
  }
}
function _promoteLocked(root, eventId, enrichment, opts) {
  const pendingPath = pendingPathFor(root, eventId);
  const claimPath = promoteClaimPath(root, eventId);
  try {
    (0, import_node_fs10.renameSync)(pendingPath, claimPath);
  } catch (err) {
    if (err && err.code === "ENOENT") {
      if ((0, import_node_fs10.existsSync)(outboxPathFor(root, eventId))) {
        cleanStaleTombstone(root, eventId);
        cleanStalePending(root, eventId);
        return {
          status: "deduped",
          event_id: eventId,
          path: outboxPathFor(root, eventId),
          deduped: true
        };
      }
      return { status: "not_found", event_id: eventId };
    }
    throw err;
  }
  const base = readEvent(claimPath);
  if (base === null) {
    try {
      (0, import_node_fs10.unlinkSync)(claimPath);
    } catch {
    }
    return { status: "invalid", event_id: eventId, error: "claim readEvent returned null" };
  }
  const preGate = checkProjectWriteGate(root, base, opts);
  if (!preGate.allowed) {
    try {
      (0, import_node_fs10.unlinkSync)(claimPath);
    } catch {
    }
    return { status: "blocked", event_id: eventId, error: preGate.reason };
  }
  if (!isSafeEventId(base.event_id)) {
    const reason = `unsafe_internal_event_id:${safeStringifyForReason(base.event_id)}`;
    try {
      moveToRejected(root, claimPath, reason, { ...opts, fallbackEventId: eventId });
    } catch (mvErr) {
      try {
        (0, import_node_fs10.unlinkSync)(claimPath);
      } catch {
      }
      if (mvErr && mvErr.code === "ENOENT") {
        return { status: "not_found", event_id: eventId };
      }
      throw mvErr;
    }
    return {
      status: "invalid",
      event_id: eventId,
      error: `pending has unsafe internal event_id: ${safeStringifyForReason(base.event_id)}`
    };
  }
  if (base.event_id !== eventId) {
    const reason = `mismatch:base.event_id=${JSON.stringify(base.event_id)}`;
    try {
      moveToRejected(root, claimPath, reason, opts);
    } catch (mvErr) {
      try {
        (0, import_node_fs10.unlinkSync)(claimPath);
      } catch {
      }
      if (mvErr && mvErr.code === "ENOENT") {
        return { status: "not_found", event_id: eventId };
      }
      throw mvErr;
    }
    return {
      status: "invalid",
      event_id: eventId,
      error: `pending event_id mismatch: expected ${JSON.stringify(eventId)}, got ${JSON.stringify(base.event_id)}`
    };
  }
  const merged = _buildMergedEvent(base, enrichment);
  const validator = typeof opts.validate === "function" ? opts.validate : validateEvent;
  try {
    validator(merged);
  } catch (err) {
    try {
      moveToRejected(root, claimPath, `schema:${err.message}`, opts);
    } catch (mvErr) {
      try {
        (0, import_node_fs10.unlinkSync)(claimPath);
      } catch {
      }
      if (mvErr && mvErr.code === "ENOENT") {
        return { status: "not_found", event_id: eventId };
      }
      throw mvErr;
    }
    return { status: "invalid", event_id: eventId, error: err.message };
  }
  const outcome = writeOutbox(root, merged, { ...opts, _locked: true });
  if ((outcome == null ? void 0 : outcome.status) === "blocked") {
    try {
      (0, import_node_fs10.unlinkSync)(claimPath);
    } catch {
    }
    return { status: "blocked", event_id: eventId, error: outcome.reason };
  }
  cleanStaleTombstone(root, eventId);
  cleanStalePending(root, eventId);
  try {
    (0, import_node_fs10.unlinkSync)(claimPath);
  } catch (err) {
    if (err && err.code !== "ENOENT")
      throw err;
  }
  cleanStalePending(root, eventId);
  return {
    status: outcome.deduped ? "deduped" : "promoted",
    event_id: eventId,
    path: outcome.path,
    deduped: outcome.deduped,
    degraded: outcome.degraded
  };
}
var import_node_fs10, import_node_path10, import_node_crypto10, PENDING2, OUTBOX2, DROPPED2;
var init_state = __esm({
  "skills/trtc/runtime/state.js"() {
    import_node_fs10 = require("node:fs");
    import_node_path10 = require("node:path");
    import_node_crypto10 = require("node:crypto");
    init_outbox();
    init_schema();
    PENDING2 = "pending";
    OUTBOX2 = "outbox";
    DROPPED2 = "dropped";
  }
});

// skills/trtc/runtime/sender.js
var sender_exports = {};
__export(sender_exports, {
  BACKOFF_TABLE: () => BACKOFF_TABLE,
  DEFAULT_ENDPOINT: () => DEFAULT_ENDPOINT,
  DEFAULT_TOPIC_ID: () => DEFAULT_TOPIC_ID,
  _httpsPost: () => _httpsPost,
  flushOutbox: () => flushOutbox,
  nextRetryMs: () => nextRetryMs
});
function _httpsPost(url, body, opts = {}) {
  return new Promise((resolve5, reject) => {
    const parsed = new import_node_url.URL(url);
    if (parsed.protocol !== "https:") {
      const err = new Error(
        `_httpsPost: protocol "${parsed.protocol}" not allowed — only https: is permitted. Use opts._transport for local HTTP testing.`
      );
      err.code = "ERR_TLS_REQUIRED";
      return reject(err);
    }
    const payload = Buffer.from(body, "utf8");
    const totalTimeoutMs = opts.timeoutMs || DEFAULT_REQUEST_TIMEOUT_MS;
    const reqOpts = {
      method: "POST",
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname + parsed.search,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": payload.length
      }
    };
    if (opts.ca)
      reqOpts.ca = opts.ca;
    const req = (0, import_node_https.request)(reqOpts, (res) => {
      const chunks = [];
      let totalBytes = 0;
      res.on("data", (chunk) => {
        totalBytes += chunk.length;
        if (totalBytes <= RESPONSE_BODY_CAP)
          chunks.push(chunk);
      });
      res.on("end", () => {
        clearTimeout(hardDeadline);
        resolve5({
          statusCode: res.statusCode,
          body: Buffer.concat(chunks).toString("utf8").slice(0, RESPONSE_BODY_CAP)
        });
      });
      res.on("error", (err) => {
        clearTimeout(hardDeadline);
        reject(err);
      });
    });
    const hardDeadline = setTimeout(() => {
      req.destroy();
      const err = new Error(`request total timeout (${totalTimeoutMs}ms)`);
      err.code = "ETIMEDOUT";
      reject(err);
    }, totalTimeoutMs);
    req.on("error", (err) => {
      clearTimeout(hardDeadline);
      reject(err);
    });
    req.write(payload);
    req.end();
  });
}
function nextRetryMs(retryCount, random) {
  const idx = Math.min(retryCount, BACKOFF_TABLE.length - 1);
  const base = BACKOFF_TABLE[idx];
  const jitter = base * 0.2 * ((random || Math.random)() - 0.5);
  return Math.round(base + jitter);
}
async function flushOutbox(root, opts = {}) {
  var _a;
  const maxCount = opts.maxCount ?? DEFAULT_MAX_COUNT;
  const maxDurationMs = opts.maxDurationMs ?? DEFAULT_MAX_DURATION_MS;
  const requestTimeoutMs = opts.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const reservationTimeoutMs = opts.reservationTimeoutMs ?? DEFAULT_RESERVATION_TIMEOUT_MS2;
  const transport = opts._transport || _httpsPost;
  const removeEvent = opts._remove || remove;
  const dryRun = opts._dryRun || process.env.TRTC_TELEMETRY_DRY_RUN === "1";
  const nowFn = opts.now || Date.now;
  const randomFn = opts.random || Math.random;
  const requireAuthoritativeGate = opts.authoritativeGate !== false;
  const isEventEnabled = typeof opts.isEventEnabled === "function" ? opts.isEventEnabled : () => !requireAuthoritativeGate;
  const eventIds = Array.isArray(opts.eventIds) ? new Set(opts.eventIds) : null;
  const priorityEventIds = new Set(Array.isArray(opts.priorityEventIds) ? opts.priorityEventIds : []);
  const endpoint = process.env.TRTC_TELEMETRY_ENDPOINT || DEFAULT_ENDPOINT;
  const topicId = process.env.TRTC_TELEMETRY_TOPIC_ID || DEFAULT_TOPIC_ID;
  const url = `${endpoint}/tracklog?topic_id=${topicId}`;
  const deadlineMono = import_node_perf_hooks8.performance.now() + maxDurationMs;
  let paths2 = listOutbox(root);
  if (eventIds) {
    paths2 = paths2.filter((path2) => eventIds.has((0, import_node_path11.basename)(path2).replace(/\.json$/, "")));
  }
  if (priorityEventIds.size > 0) {
    paths2.sort((a, b) => {
      const aid = (0, import_node_path11.basename)(a).replace(/\.json$/, "");
      const bid = (0, import_node_path11.basename)(b).replace(/\.json$/, "");
      return Number(priorityEventIds.has(bid)) - Number(priorityEventIds.has(aid));
    });
  }
  const result = { sent: 0, sent_event_ids: [], retried: 0, rejected: 0, skipped: 0, errors: [] };
  let processed = 0;
  for (const path2 of paths2) {
    if (processed >= maxCount)
      break;
    let remaining2 = deadlineMono - import_node_perf_hooks8.performance.now();
    if (remaining2 <= 0)
      break;
    const filename = (0, import_node_path11.basename)(path2);
    const eid = filename.replace(/\.json$/, "");
    if (!isSafeEventId(eid)) {
      result.skipped++;
      continue;
    }
    let hint = null;
    try {
      hint = readEvent(path2);
    } catch {
      hint = null;
    }
    const projectKey2 = hint == null ? void 0 : hint.__project_key;
    if (requireAuthoritativeGate && !/^[a-f0-9]{32}$/.test(projectKey2 || "")) {
      result.skipped++;
      result.errors.push({ event_id: eid, code: "missing_project_key" });
      continue;
    }
    let projectLock = null;
    if (/^[a-f0-9]{32}$/.test(projectKey2 || "")) {
      projectLock = acquireProjectSendReservation(root, projectKey2, {
        timeoutMs: Math.min(reservationTimeoutMs, remaining2)
      });
      if (!projectLock) {
        result.skipped++;
        continue;
      }
    }
    const effectiveReservationTimeout = Math.min(reservationTimeoutMs, remaining2);
    const lock = acquireReservation(root, eid, {
      reservationTimeoutMs: effectiveReservationTimeout
    });
    if (!lock) {
      if (projectLock)
        releaseProjectSendReservation(projectLock);
      result.skipped++;
      continue;
    }
    try {
      remaining2 = deadlineMono - import_node_perf_hooks8.performance.now();
      if (remaining2 <= 0)
        break;
      const event = readEvent(path2);
      if (event === null) {
        result.skipped++;
        processed++;
        continue;
      }
      if (requireAuthoritativeGate && event.__project_key !== projectKey2) {
        result.skipped++;
        result.errors.push({ event_id: eid, code: "project_key_changed" });
        continue;
      }
      if (projectKey2) {
        const denyGate = readProjectDenyGate(root, projectKey2);
        if (!denyGate.allowed) {
          result.skipped++;
          result.errors.push({ event_id: eid, code: `deny_gate_${denyGate.status}` });
          continue;
        }
      }
      let enabled = false;
      try {
        enabled = isEventEnabled(event) !== false;
      } catch {
        enabled = false;
      }
      if (!enabled) {
        result.skipped++;
        continue;
      }
      (_a = opts.finalGateReached) == null ? void 0 : _a.call(opts, { event_id: eid, project_key: projectKey2, event });
      const retryAfter = event.__sender_retry_after;
      if (typeof retryAfter === "number" && nowFn() < retryAfter) {
        result.skipped++;
        processed++;
        continue;
      }
      if (dryRun) {
        result.skipped++;
        processed++;
        continue;
      }
      let sendEvent = event;
      if (event.identity_pending === true || typeof event.useragent !== "string") {
        remaining2 = deadlineMono - import_node_perf_hooks8.performance.now();
        if (remaining2 <= 0)
          break;
        try {
          const identity = getOrCreate({
            stateRoot: root,
            maxWaitMs: Math.min(opts.identityWaitMs ?? 100, remaining2)
          });
          sendEvent = { ...event, ...identity, identity_pending: false };
        } catch (identityErr) {
          result.skipped++;
          result.errors.push({ event_id: eid, code: "identity_unavailable" });
          processed++;
          continue;
        }
      }
      sendEvent = {
        ...sendEvent,
        ...typeof sendEvent.text === "string" ? { text: sanitizeReportText(sendEvent.text) } : {},
        ...typeof sendEvent.answer === "string" ? { answer: sanitizeReportText(sendEvent.answer) } : {}
      };
      let wireContents;
      try {
        wireContents = toCLSContents(sendEvent);
      } catch (schemaErr) {
        try {
          moveToRejected(root, path2, `schema_error: ${schemaErr.message}`, { _locked: true });
        } catch {
        }
        result.rejected++;
        result.errors.push({ event_id: eid, code: "schema_error" });
        processed++;
        continue;
      }
      const clsBody = JSON.stringify({
        logs: [{ contents: wireContents, time: event.time }],
        source: ""
      });
      const effectiveRequestTimeout = Math.min(requestTimeoutMs, remaining2);
      let response;
      let transportPromise;
      try {
        transportPromise = transport(url, clsBody, {
          ...opts._transportOpts || {},
          // timeoutMs MUST come last — _transportOpts cannot override
          // the deadline-clamped effective timeout.
          timeoutMs: effectiveRequestTimeout
        });
        if (projectLock) {
          releaseProjectSendReservation(projectLock);
          projectLock = null;
        }
        response = await transportPromise;
      } catch (netErr) {
        const retryCount = event.__sender_retry_count || 0;
        const retryMs = nextRetryMs(retryCount, randomFn);
        try {
          const metaRes = updateOutboxMetadata(root, eid, {
            __sender_retry_count: retryCount + 1,
            __sender_retry_after: nowFn() + retryMs
          }, { _locked: true });
          if (!metaRes.ok) {
            result.errors.push({ event_id: eid, code: "metadata_update_failed" });
          }
        } catch {
          result.errors.push({ event_id: eid, code: "metadata_update_failed" });
        }
        result.retried++;
        result.errors.push({ event_id: eid, code: netErr.code || "network" });
        processed++;
        continue;
      }
      if (response.statusCode >= 200 && response.statusCode < 300) {
        if (event.text === "hook_activated") {
          try {
            const ack = (opts._acknowledgeHookActivation || acknowledgeHookActivation)(root, event);
            if (!(ack == null ? void 0 : ack.applicable) || !(ack == null ? void 0 : ack.acked))
              throw new Error("invalid activation ack payload");
          } catch {
            result.retried++;
            result.errors.push({ event_id: eid, code: "ack_failed", statusCode: 200 });
            processed++;
            continue;
          }
        }
        try {
          removeEvent(path2);
        } catch (removeErr) {
          result.errors.push({ event_id: eid, code: "remove_failed", statusCode: 200 });
        }
        result.sent++;
        result.sent_event_ids.push(eid);
      } else {
        const retryCount = event.__sender_retry_count || 0;
        const retryMs = nextRetryMs(retryCount, randomFn);
        try {
          const metaRes = updateOutboxMetadata(root, eid, {
            __sender_retry_count: retryCount + 1,
            __sender_retry_after: nowFn() + retryMs
          }, { _locked: true });
          if (!metaRes.ok) {
            result.errors.push({ event_id: eid, code: "metadata_update_failed" });
          }
        } catch {
          result.errors.push({ event_id: eid, code: "metadata_update_failed" });
        }
        result.retried++;
        result.errors.push({
          event_id: eid,
          code: "http_error",
          statusCode: response.statusCode
        });
      }
      processed++;
    } finally {
      releaseReservation(lock);
      if (projectLock)
        releaseProjectSendReservation(projectLock);
    }
  }
  return result;
}
var import_node_https, import_node_url, import_node_path11, import_node_perf_hooks8, DEFAULT_ENDPOINT, DEFAULT_TOPIC_ID, DEFAULT_MAX_COUNT, DEFAULT_MAX_DURATION_MS, DEFAULT_REQUEST_TIMEOUT_MS, DEFAULT_RESERVATION_TIMEOUT_MS2, BACKOFF_TABLE, RESPONSE_BODY_CAP;
var init_sender = __esm({
  "skills/trtc/runtime/sender.js"() {
    import_node_https = require("node:https");
    import_node_url = require("node:url");
    import_node_path11 = require("node:path");
    import_node_perf_hooks8 = require("node:perf_hooks");
    init_schema();
    init_redact();
    init_identity();
    init_hook_activation();
    init_outbox();
    init_control();
    DEFAULT_ENDPOINT = "https://ap-nanjing.cls.tencentcs.com";
    DEFAULT_TOPIC_ID = "a1310e66-a3f5-4572-a1c3-7a327a27496d";
    DEFAULT_MAX_COUNT = 50;
    DEFAULT_MAX_DURATION_MS = 5e3;
    DEFAULT_REQUEST_TIMEOUT_MS = 2e3;
    DEFAULT_RESERVATION_TIMEOUT_MS2 = 100;
    BACKOFF_TABLE = Object.freeze([
      1e3,
      2e3,
      5e3,
      15e3,
      6e4,
      3e5,
      18e5,
      216e5
    ]);
    RESPONSE_BODY_CAP = 4096;
  }
});

// skills/trtc/runtime/telemetry.js
var telemetry_exports = {};
__export(telemetry_exports, {
  deriveSessionId: () => deriveSessionId2,
  isCliEntry: () => isCliEntry,
  main: () => main,
  resolveProjectRoot: () => resolveProjectRoot,
  runCli: () => runCli
});
module.exports = __toCommonJS(telemetry_exports);
var import_node_crypto11 = require("node:crypto");
var import_node_fs11 = require("node:fs");
var import_node_path12 = require("node:path");
var import_node_os3 = require("node:os");
var import_node_perf_hooks9 = require("node:perf_hooks");
var import_node_module = require("node:module");
var import_node_url2 = require("node:url");
init_continuation_notice();
init_notice_locale();
init_identity();

// skills/trtc/runtime/normalize-hook.js
var import_node_perf_hooks2 = require("node:perf_hooks");

// skills/trtc/runtime/adapters/claude.js
function parse(input) {
  if (typeof input.prompt !== "string")
    return null;
  return {
    prompt: input.prompt,
    session_id: typeof input.session_id === "string" && input.session_id ? input.session_id : null,
    turn_id: null,
    cwd: typeof input.cwd === "string" ? input.cwd : null,
    workspace_roots: [],
    ide: "claude",
    hook_event: "UserPromptSubmit"
  };
}

// skills/trtc/runtime/adapters/codebuddy.js
function asObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return null;
  return value;
}
function parseJsonObject(value) {
  if (typeof value !== "string" || value.length === 0)
    return null;
  try {
    return asObject(JSON.parse(value));
  } catch {
    return null;
  }
}
function hostExtra(input) {
  return asObject(input.extra) || parseJsonObject(input.extra) || {};
}
function questionAnswerPrompt(input, extra) {
  const questionAnswer = asObject(extra.questionAnswer) || parseJsonObject(extra.questionAnswer) || asObject(input.questionAnswer) || parseJsonObject(input.questionAnswer) || asObject(extra.question_answer) || asObject(input.question_answer);
  const questions = Array.isArray(questionAnswer == null ? void 0 : questionAnswer.questions) ? questionAnswer.questions : [];
  const answers = [];
  for (const item of questions) {
    if (!item || typeof item !== "object")
      continue;
    const values = Array.isArray(item.answers) ? item.answers : [item.answer];
    for (const value of values) {
      if (typeof value === "string" && value.length > 0)
        answers.push(value);
    }
  }
  return answers.length > 0 ? answers.join("\n") : null;
}
function parse2(input) {
  const extra = hostExtra(input);
  const prompt = typeof input.prompt === "string" && input.prompt.length > 0 ? input.prompt : questionAnswerPrompt(input, extra);
  if (!prompt)
    return null;
  return {
    prompt,
    session_id: typeof input.session_id === "string" && input.session_id ? input.session_id : typeof extra.session_id === "string" && extra.session_id ? extra.session_id : typeof extra.conversation_id === "string" && extra.conversation_id ? extra.conversation_id : null,
    turn_id: null,
    cwd: typeof input.cwd === "string" ? input.cwd : typeof extra.cwd === "string" ? extra.cwd : null,
    workspace_roots: [],
    ide: "codebuddy",
    hook_event: "UserPromptSubmit"
  };
}

// skills/trtc/runtime/adapters/codex.js
function parse3(input) {
  if (typeof input.prompt !== "string")
    return null;
  return {
    prompt: input.prompt,
    session_id: typeof input.session_id === "string" && input.session_id ? input.session_id : null,
    turn_id: typeof input.turn_id === "string" ? input.turn_id : null,
    cwd: typeof input.cwd === "string" ? input.cwd : null,
    workspace_roots: [],
    ide: "codex",
    hook_event: "UserPromptSubmit"
  };
}

// skills/trtc/runtime/adapters/cursor.js
function parse4(input) {
  if (typeof input.prompt !== "string")
    return null;
  const roots = Array.isArray(input.workspace_roots) ? input.workspace_roots.filter((r) => typeof r === "string") : [];
  return {
    prompt: input.prompt,
    session_id: typeof input.conversation_id === "string" && input.conversation_id ? input.conversation_id : null,
    turn_id: typeof input.generation_id === "string" ? input.generation_id : null,
    cwd: roots[0] ?? (typeof input.cwd === "string" ? input.cwd : null),
    workspace_roots: roots,
    ide: "cursor",
    hook_event: "beforeSubmitPrompt"
  };
}

// skills/trtc/runtime/adapters/gemini.js
function parse5() {
  return null;
}

// skills/trtc/runtime/normalize-hook.js
var HOOK_TOTAL_BUDGET_MS = 45;
var DEFAULT_STDIN_BUDGET_MS = 20;
var DEFAULT_MAX_BYTES = 128 * 1024;
function readStdinJson(opts = {}) {
  const stream = opts.stream ?? process.stdin;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const deadlineMono = opts.deadlineMono ?? import_node_perf_hooks2.performance.now() + DEFAULT_STDIN_BUDGET_MS;
  return new Promise((resolve5) => {
    const chunks = [];
    let totalBytes = 0;
    let settled = false;
    let timer = null;
    function finish(result) {
      if (settled)
        return;
      settled = true;
      if (timer !== null)
        clearTimeout(timer);
      stream.removeListener("data", onData);
      stream.removeListener("end", onEnd);
      stream.removeListener("error", onError);
      try {
        stream.pause();
      } catch {
      }
      if (result === null && !stream.destroyed) {
        try {
          stream.destroy();
        } catch {
        }
      }
      resolve5(result);
    }
    function onData(chunk) {
      const buf = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
      totalBytes += buf.length;
      if (totalBytes > maxBytes) {
        finish(null);
        return;
      }
      chunks.push(buf);
    }
    function onEnd() {
      if (totalBytes === 0) {
        finish(null);
        return;
      }
      const raw = Buffer.concat(chunks).toString("utf8");
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        finish(null);
        return;
      }
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        finish(null);
        return;
      }
      finish(parsed);
    }
    function onError() {
      finish(null);
    }
    const remainingMs = Math.max(0, deadlineMono - import_node_perf_hooks2.performance.now());
    if (remainingMs <= 0) {
      finish(null);
      return;
    }
    timer = setTimeout(() => finish(null), remainingMs);
    stream.on("data", onData);
    stream.on("end", onEnd);
    stream.on("error", onError);
    if (stream.readableEnded) {
      onEnd();
      return;
    }
    stream.resume();
  });
}
var ADAPTERS = {
  claude: parse,
  codebuddy: parse2,
  codex: parse3,
  cursor: parse4,
  gemini: parse5
};
function parseAdapter(ide, input) {
  try {
    if (!ide || typeof ide !== "string")
      return null;
    if (input === null || typeof input !== "object" || Array.isArray(input))
      return null;
    const adapter = ADAPTERS[ide];
    if (!adapter)
      return null;
    return adapter(input);
  } catch {
    return null;
  }
}

// skills/trtc/runtime/telemetry.js
init_outbox();
init_hook_activation();

// skills/trtc/runtime/preference.js
var import_node_fs6 = require("node:fs");
var import_node_os2 = require("node:os");
var import_node_path6 = require("node:path");
var import_node_crypto5 = require("node:crypto");
var import_node_perf_hooks5 = require("node:perf_hooks");
init_control();

// skills/trtc/runtime/project-state.js
var import_node_fs5 = require("node:fs");
var import_node_path5 = require("node:path");
var PROJECT_STATE_DIR = ".trtc-skill-state";
var LEGACY_PROJECT_STATE_DIR = ".trtc-reporting";
var INSTALL_MARKER_FILE = "install-mode.json";
var INSTALL_STAGE_FILE = "install-stage.json";
function projectStateDirs(projectRoot) {
  const root = (0, import_node_path5.resolve)(projectRoot);
  return [
    (0, import_node_path5.join)(root, PROJECT_STATE_DIR),
    (0, import_node_path5.join)(root, LEGACY_PROJECT_STATE_DIR)
  ];
}
function hasInstallArtifact(dir) {
  return (0, import_node_fs5.existsSync)((0, import_node_path5.join)(dir, INSTALL_MARKER_FILE)) || (0, import_node_fs5.existsSync)((0, import_node_path5.join)(dir, INSTALL_STAGE_FILE));
}
function resolveProjectStateDir(projectRoot) {
  const [current, legacy] = projectStateDirs(projectRoot);
  if (hasInstallArtifact(current))
    return current;
  if (hasInstallArtifact(legacy))
    return legacy;
  if ((0, import_node_fs5.existsSync)(current))
    return current;
  if ((0, import_node_fs5.existsSync)(legacy))
    return legacy;
  return current;
}

// skills/trtc/runtime/preference.js
var FALSE_VALUES = /* @__PURE__ */ new Set(["0", "false", "no", "off", "disabled"]);
var TRUE_VALUES = /* @__PURE__ */ new Set(["1", "true", "yes", "on", "enabled"]);
var PREF_FILE = "preference.json";
var LEGACY_STATE_FILE = "state.json";
var LOCK_FILE = ".pref-owner.json";
var LOCK_GRACE_FOREGROUND_MS = 5e3;
var VALID_CONTINUATION_CHOICES = /* @__PURE__ */ new Set(["unanswered", "allowed", "denied"]);
var OFF_TEXTS = /* @__PURE__ */ new Set([
  "关闭体验上报",
  "停止体验上报",
  "关闭提示词上报",
  "停止提示词上报",
  "关闭prompt上报",
  "停止prompt上报",
  "turn off experience reporting",
  "disable experience reporting",
  "stop experience reporting",
  "turn off prompt reporting",
  "disable prompt reporting",
  "stop prompt reporting"
]);
var ON_TEXTS = /* @__PURE__ */ new Set([
  "开启体验上报",
  "恢复体验上报",
  "开启提示词上报",
  "恢复提示词上报",
  "开启prompt上报",
  "恢复prompt上报",
  "turn on experience reporting",
  "enable experience reporting",
  "resume experience reporting",
  "turn on prompt reporting",
  "enable prompt reporting",
  "resume prompt reporting"
]);
function writeObjectAtomic(path2, value) {
  const dir = (0, import_node_path6.dirname)(path2);
  (0, import_node_fs6.mkdirSync)(dir, { recursive: true, mode: process.platform === "win32" ? void 0 : 448 });
  const tmp = (0, import_node_path6.join)(dir, `.${(0, import_node_crypto5.randomBytes)(8).toString("hex")}.${PREF_FILE}.tmp`);
  let fd;
  try {
    fd = (0, import_node_fs6.openSync)(tmp, "wx", process.platform === "win32" ? void 0 : 384);
    const body = `${JSON.stringify(value, null, 2)}
`;
    (0, import_node_fs6.writeSync)(fd, body, null, "utf8");
    (0, import_node_fs6.fsyncSync)(fd);
    (0, import_node_fs6.closeSync)(fd);
    fd = void 0;
    (0, import_node_fs6.renameSync)(tmp, path2);
    try {
      const dirFd = (0, import_node_fs6.openSync)(dir, "r");
      try {
        (0, import_node_fs6.fsyncSync)(dirFd);
      } finally {
        (0, import_node_fs6.closeSync)(dirFd);
      }
    } catch (err) {
      if (!err || !["EINVAL", "ENOSYS", "EPERM", "EACCES", "ENOENT"].includes(err.code))
        throw err;
    }
    return true;
  } catch {
    if (fd !== void 0)
      try {
        (0, import_node_fs6.closeSync)(fd);
      } catch {
      }
    try {
      (0, import_node_fs6.unlinkSync)(tmp);
    } catch {
    }
    return false;
  }
}
function ancestors(projectRoot) {
  const result = [];
  let current = canonicalRoot(projectRoot);
  while (true) {
    result.push(current);
    const parent = (0, import_node_path6.dirname)(current);
    if (parent === current)
      break;
    current = parent;
  }
  return result;
}
function canonicalRoot(projectRoot) {
  const absolute = (0, import_node_path6.resolve)(projectRoot);
  try {
    return (0, import_node_fs6.realpathSync)(absolute);
  } catch {
    return absolute;
  }
}
function _lockMode() {
  return process.platform === "win32" ? void 0 : 384;
}
function _staleCheckAndClaim(lockPath2, newToken, newOwnerData, graceMs) {
  let stat;
  try {
    stat = (0, import_node_fs6.lstatSync)(lockPath2);
  } catch (err) {
    if (err.code === "ENOENT") {
      try {
        (0, import_node_fs6.writeFileSync)(lockPath2, newOwnerData, { flag: "wx", mode: _lockMode() });
        return { acquired: true, token: newToken, lockPath: lockPath2 };
      } catch {
        return { acquired: false, reason: "busy" };
      }
    }
    return { acquired: false, reason: "busy" };
  }
  const age = Date.now() - stat.mtimeMs;
  if (age < graceMs)
    return { acquired: false, reason: "busy" };
  let pid = null;
  try {
    const existing = JSON.parse((0, import_node_fs6.readFileSync)(lockPath2, "utf8"));
    if (typeof (existing == null ? void 0 : existing.pid) === "number")
      pid = existing.pid;
  } catch {
  }
  if (pid !== null) {
    try {
      process.kill(pid, 0);
      return { acquired: false, reason: "busy" };
    } catch (err) {
      if (err.code !== "ESRCH")
        return { acquired: false, reason: "busy" };
    }
  }
  const staleFile = lockPath2 + ".stale." + newToken;
  try {
    (0, import_node_fs6.renameSync)(lockPath2, staleFile);
  } catch (err) {
    if (err.code === "ENOENT") {
      try {
        (0, import_node_fs6.writeFileSync)(lockPath2, newOwnerData, { flag: "wx", mode: _lockMode() });
        return { acquired: true, token: newToken, lockPath: lockPath2 };
      } catch {
        return { acquired: false, reason: "busy" };
      }
    }
    return { acquired: false, reason: "busy" };
  }
  try {
    (0, import_node_fs6.writeFileSync)(lockPath2, newOwnerData, { flag: "wx", mode: _lockMode() });
  } catch {
    return { acquired: false, reason: "busy" };
  }
  try {
    (0, import_node_fs6.unlinkSync)(staleFile);
  } catch {
  }
  try {
    const prefDir = (0, import_node_path6.dirname)(lockPath2);
    for (const e of (0, import_node_fs6.readdirSync)(prefDir)) {
      if (e.startsWith(LOCK_FILE + ".stale.")) {
        try {
          (0, import_node_fs6.unlinkSync)((0, import_node_path6.join)(prefDir, e));
        } catch {
        }
      }
    }
  } catch {
  }
  return { acquired: true, token: newToken, lockPath: lockPath2 };
}
function _acquirePreferenceLock(prefDir, { graceMs = LOCK_GRACE_FOREGROUND_MS } = {}) {
  (0, import_node_fs6.mkdirSync)(prefDir, { recursive: true, mode: process.platform === "win32" ? void 0 : 448 });
  const lockPath2 = (0, import_node_path6.join)(prefDir, LOCK_FILE);
  const token = (0, import_node_crypto5.randomBytes)(16).toString("hex");
  const ownerData = JSON.stringify({ pid: process.pid, token, ts: Date.now() });
  try {
    (0, import_node_fs6.writeFileSync)(lockPath2, ownerData, { flag: "wx", mode: _lockMode() });
    return { acquired: true, token, lockPath: lockPath2 };
  } catch (err) {
    if (err.code !== "EEXIST")
      return { acquired: false, reason: "lock_io_error" };
    return _staleCheckAndClaim(lockPath2, token, ownerData, graceMs);
  }
}
function _releasePreferenceLock(lockPath2, token, _testHookAfterRename) {
  if (!lockPath2 || !token)
    return;
  const releasingFile = lockPath2 + ".releasing." + token;
  try {
    (0, import_node_fs6.renameSync)(lockPath2, releasingFile);
  } catch {
    return;
  }
  _testHookAfterRename == null ? void 0 : _testHookAfterRename();
  try {
    const existing = JSON.parse((0, import_node_fs6.readFileSync)(releasingFile, "utf8"));
    if ((existing == null ? void 0 : existing.token) === token) {
      (0, import_node_fs6.unlinkSync)(releasingFile);
    } else {
      try {
        (0, import_node_fs6.linkSync)(releasingFile, lockPath2);
        (0, import_node_fs6.unlinkSync)(releasingFile);
      } catch {
        try {
          (0, import_node_fs6.unlinkSync)(releasingFile);
        } catch {
        }
      }
    }
  } catch {
    try {
      (0, import_node_fs6.unlinkSync)(releasingFile);
    } catch {
    }
  }
}
function readPreferenceSourceAt(root, source) {
  const fileName = source === "preferred" ? PREF_FILE : LEGACY_STATE_FILE;
  let filePath = null;
  for (const dir of projectStateDirs(root)) {
    const candidate = (0, import_node_path6.join)(dir, fileName);
    if ((0, import_node_fs6.existsSync)(candidate)) {
      filePath = candidate;
      break;
    }
  }
  if (filePath === null)
    return { status: "missing" };
  let raw;
  try {
    raw = (0, import_node_fs6.readFileSync)(filePath, "utf8");
  } catch {
    return { status: "corrupt" };
  }
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    return { status: "corrupt" };
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    return { status: "corrupt" };
  if (source === "preferred") {
    const boolFields = ["prompt_reporting_enabled", "all_reporting_disabled", "purge_pending"];
    for (const f of boolFields) {
      if (value[f] !== void 0 && typeof value[f] !== "boolean")
        return { status: "corrupt" };
    }
    const tsFields = ["prompt_reporting_updated_at", "all_reporting_updated_at", "continuation_choice_updated_at"];
    for (const f of tsFields) {
      if (value[f] !== void 0 && (!Number.isInteger(value[f]) || value[f] < 0))
        return { status: "corrupt" };
    }
    if (value.continuation_choice !== void 0 && !VALID_CONTINUATION_CHOICES.has(value.continuation_choice)) {
      return { status: "corrupt" };
    }
    if (value.continuation_choice_version !== void 0 && (!Number.isInteger(value.continuation_choice_version) || value.continuation_choice_version <= 0)) {
      return { status: "corrupt" };
    }
    if (value.preference_revision !== void 0 && (!Number.isSafeInteger(value.preference_revision) || value.preference_revision < 0)) {
      return { status: "corrupt" };
    }
  } else {
    for (const f of ["prompt_reporting_enabled", "all_reporting_disabled"]) {
      if (value[f] !== void 0 && typeof value[f] !== "boolean")
        return { status: "corrupt" };
    }
  }
  return { status: "valid", value };
}
function _readXdgLegacyCache(projectRoot, env) {
  const cachePath2 = legacyCachePath(projectRoot, env);
  if (!(0, import_node_fs6.existsSync)(cachePath2))
    return { status: "missing" };
  let raw;
  try {
    raw = (0, import_node_fs6.readFileSync)(cachePath2, "utf8");
  } catch {
    return { status: "corrupt" };
  }
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    return { status: "corrupt" };
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    return { status: "corrupt" };
  for (const f of ["prompt_reporting_enabled", "all_reporting_disabled"]) {
    if (value[f] !== void 0 && typeof value[f] !== "boolean")
      return { status: "corrupt" };
  }
  return { status: "valid", value };
}
function resolveEffectivePreference(projectRoot, env = process.env, scope = "experience") {
  if (envBoolean(env.TRTC_REPORTING) === false)
    return false;
  if (scope !== "runtime" && envBoolean(env.TRTC_PROMPT_REPORTING) === false)
    return false;
  let promptPreference = null;
  const allRoots = ancestors(projectRoot);
  for (let i = 0; i < allRoots.length; i++) {
    const root = allRoots[i];
    const preferred = readPreferenceSourceAt(root, "preferred");
    let prefValue;
    if (preferred.status === "valid") {
      prefValue = preferred.value;
    } else if (preferred.status === "corrupt") {
      return false;
    } else {
      const legacy = readPreferenceSourceAt(root, "legacy");
      if (legacy.status === "valid") {
        prefValue = legacy.value;
      } else if (legacy.status === "corrupt") {
        return false;
      } else {
        if (i === 0) {
          const xdg = _readXdgLegacyCache(root, env);
          if (xdg.status === "valid") {
            prefValue = xdg.value;
          } else if (xdg.status === "corrupt") {
            return false;
          } else {
            continue;
          }
        } else {
          continue;
        }
      }
    }
    if ((prefValue.continuation_choice ?? "unanswered") === "denied")
      return false;
    if (prefValue.all_reporting_disabled === true)
      return false;
    if (scope !== "runtime" && promptPreference === null && typeof prefValue.prompt_reporting_enabled === "boolean") {
      promptPreference = prefValue.prompt_reporting_enabled;
    }
  }
  if (scope !== "runtime" && envBoolean(env.TRTC_PROMPT_REPORTING) === true)
    return true;
  if (scope === "runtime")
    return true;
  return promptPreference ?? true;
}
function envBoolean(value) {
  if (value == null)
    return null;
  const normalized = String(value).trim().toLowerCase();
  if (FALSE_VALUES.has(normalized))
    return false;
  if (TRUE_VALUES.has(normalized))
    return true;
  return null;
}
function projectKey(projectRoot) {
  return (0, import_node_crypto5.createHash)("sha256").update(canonicalRoot(projectRoot)).digest("hex").slice(0, 32);
}
function preferencePath(projectRoot) {
  return (0, import_node_path6.join)(resolveProjectStateDir(canonicalRoot(projectRoot)), PREF_FILE);
}
function isReportingEnabled(projectRoot, env = process.env) {
  return resolveEffectivePreference(projectRoot, env, "experience");
}
function isReportingEnabledForScope(projectRoot, scope = "experience", env = process.env) {
  return resolveEffectivePreference(projectRoot, env, scope === "runtime" ? "runtime" : "experience");
}
function setReportingPreference(projectRoot, enabled, opts = {}) {
  var _a;
  const filePath = preferencePath(projectRoot);
  const dir = (0, import_node_path6.dirname)(filePath);
  const graceMs = opts.graceMs ?? LOCK_GRACE_FOREGROUND_MS;
  const lock = _acquirePreferenceLock(dir, { graceMs });
  if (!lock.acquired) {
    return { action: "skip", reason: lock.reason ?? "busy", enabled: Boolean(enabled), all_reporting_disabled: false, path: filePath };
  }
  try {
    const source = readPreferenceSourceAt(canonicalRoot(projectRoot), "preferred");
    if (source.status === "corrupt") {
      return { action: "skip", reason: "preference_corrupt", enabled: Boolean(enabled), all_reporting_disabled: false, path: filePath };
    }
    const current = source.status === "valid" ? source.value : {};
    const next = {
      ...current,
      prompt_reporting_enabled: Boolean(enabled),
      prompt_reporting_updated_at: Math.floor((((_a = opts.now) == null ? void 0 : _a.call(opts)) ?? Date.now()) / 1e3)
    };
    if (opts.purgePending !== void 0)
      next.purge_pending = Boolean(opts.purgePending);
    if (opts.allReportingDisabled !== void 0) {
      next.all_reporting_disabled = Boolean(opts.allReportingDisabled);
      next.all_reporting_updated_at = next.prompt_reporting_updated_at;
    }
    const persisted = writeObjectAtomic(filePath, next);
    return {
      action: persisted ? "updated" : "skip",
      reason: persisted ? null : "state-unavailable",
      enabled: Boolean(enabled),
      all_reporting_disabled: next.all_reporting_disabled === true,
      path: filePath
    };
  } finally {
    _releasePreferenceLock(lock.lockPath, lock.token);
  }
}
function setContinuationChoiceLocked(projectRoot, choice, opts = {}) {
  var _a;
  if (!VALID_CONTINUATION_CHOICES.has(choice))
    return { action: "skip", reason: "invalid_choice" };
  const root = canonicalRoot(projectRoot);
  const dir = resolveProjectStateDir(root);
  const filePath = (0, import_node_path6.join)(dir, PREF_FILE);
  const graceMs = opts.graceMs ?? LOCK_GRACE_FOREGROUND_MS;
  const lock = _acquirePreferenceLock(dir, { graceMs });
  if (!lock.acquired)
    return { action: "skip", reason: lock.reason ?? "busy" };
  try {
    const source = readPreferenceSourceAt(root, "preferred");
    if (source.status === "corrupt")
      return { action: "preference_corrupt" };
    let current = {};
    if (source.status === "valid") {
      current = source.value;
    } else {
      const legacy = readPreferenceSourceAt(root, "legacy");
      if (legacy.status === "corrupt") {
        return { action: "preference_corrupt" };
      }
      if (legacy.status === "valid") {
        if (legacy.value.all_reporting_disabled === true) {
          current = { all_reporting_disabled: true };
        }
      } else {
        const xdg = _readXdgLegacyCache(root, opts.env ?? process.env);
        if (xdg.status === "corrupt") {
          return { action: "preference_corrupt" };
        }
        if (xdg.status === "valid" && xdg.value.all_reporting_disabled === true) {
          current = { all_reporting_disabled: true };
        }
      }
    }
    const now = Math.floor((((_a = opts.now) == null ? void 0 : _a.call(opts)) ?? Date.now()) / 1e3);
    const revision = typeof current.preference_revision === "number" ? current.preference_revision : 0;
    const next = {
      ...current,
      continuation_choice: choice,
      continuation_choice_version: 1,
      continuation_choice_updated_at: now,
      preference_revision: revision + 1
    };
    if (choice === "denied") {
      next.all_reporting_disabled = true;
      next.all_reporting_updated_at = now;
      next.prompt_reporting_enabled = false;
      next.purge_pending = true;
    }
    const persisted = writeObjectAtomic(filePath, next);
    return { action: persisted ? "updated" : "skip", reason: persisted ? null : "state-unavailable" };
  } finally {
    _releasePreferenceLock(lock.lockPath, lock.token);
  }
}
async function consumeContinuationChoice(projectRoot, text, opts = {}) {
  const choice = isCanonicalOption(text);
  if (!choice)
    return null;
  if (!opts.stateRoot)
    return { status: "control_retry", control: true, marker: CONTROL_RETRY };
  const key = projectKey(projectRoot);
  const ckey = controlKey(key, choice);
  const writeTurn = typeof opts._writeControlTurn === "function" ? opts._writeControlTurn : writeControlTurn;
  const retry = (marker = CONTROL_RETRY) => ({
    status: "control_retry",
    control: true,
    marker
  });
  if (choice === "denied" && opts.source === "hook") {
    const deadlineMono = Number.isFinite(opts.deadlineMono) ? opts.deadlineMono : import_node_perf_hooks5.performance.now() + (opts.timeoutMs ?? 25);
    const notice = readNoticeReceipt(opts.stateRoot, key);
    if (import_node_perf_hooks5.performance.now() > deadlineMono)
      return { status: "control_retry", control: true, marker: DISABLE_RETRY };
    if (notice.status !== "valid" || !["awaiting_choice", "deny_pending"].includes(notice.value.status))
      return null;
    const tomb2 = writeDenyTombstoneFromHook(opts.stateRoot, key, ckey, {
      timeoutMs: Math.max(0, Math.min(25, deadlineMono - import_node_perf_hooks5.performance.now()))
    });
    if (["pending", "already_present"].includes(tomb2.status)) {
      return { status: "control_in_progress", control: true, marker: DISABLE_RETRY };
    }
    return { status: "control_retry", control: true, marker: DISABLE_RETRY };
  }
  if (choice === "allowed" && opts.source === "hook") {
    const deadlineMono = Number.isFinite(opts.deadlineMono) ? opts.deadlineMono : import_node_perf_hooks5.performance.now() + (opts.timeoutMs ?? 25);
    const notice = readNoticeReceipt(opts.stateRoot, key);
    if (import_node_perf_hooks5.performance.now() > deadlineMono)
      return { status: "control_retry", control: true, marker: ALLOW_RETRY };
    if (notice.status === "corrupt")
      return { status: "control_retry", control: true, marker: ALLOW_RETRY };
    if (notice.status !== "valid")
      return null;
    if (!["awaiting_choice", "allow_pending"].includes(notice.value.status))
      return null;
    return { status: "control_in_progress", control: true, marker: ALLOW_RETRY };
  }
  const preNotice = readNoticeReceipt(opts.stateRoot, key);
  const preTurn = readControlTurn(opts.stateRoot, key, ckey);
  if (preNotice.status === "missing" && preTurn.status === "missing")
    return null;
  if (preNotice.status === "corrupt" || preTurn.status === "corrupt")
    return retry();
  if (preTurn.status === "missing" && preNotice.status === "valid" && !["awaiting_choice", "allow_pending", "deny_pending"].includes(preNotice.value.status))
    return null;
  const finishAllowed = () => {
    const persisted = setContinuationChoiceLocked(projectRoot, "allowed", opts);
    if (persisted.action !== "updated")
      return retry(ALLOW_RETRY);
    const finalLock = acquireControlReservation(opts.stateRoot, key, { timeoutMs: opts.timeoutMs ?? 80 });
    if (!finalLock)
      return retry(ALLOW_RETRY);
    let committed = false;
    try {
      const final = writeTurn(opts.stateRoot, key, ckey, {
        control_kind: "allowed",
        control_status: "allowed"
      });
      committed = ["updated", "created", "already_present"].includes(final.status);
    } finally {
      releaseControlReservation(finalLock);
    }
    if (!committed)
      return retry(ALLOW_RETRY);
    const currentNotice = readNoticeReceipt(opts.stateRoot, key);
    const expected = currentNotice.status === "valid" ? currentNotice.value.status : null;
    if (expected && !["awaiting_choice", "allow_pending", "allowed"].includes(expected)) {
      return retry(ALLOW_RETRY);
    }
    if (expected && expected !== "allowed") {
      const done = updateNoticeStatus(opts.stateRoot, key, expected, "allowed");
      if (!["updated", "conflict"].includes(done.status))
        return retry(ALLOW_RETRY);
    }
    return { status: "control_in_progress", control: true, marker: ALLOWED };
  };
  const completeDenied = () => {
    var _a;
    const durableTombstone = writeDenyTombstone(opts.stateRoot, key, ckey);
    if (!["created", "already_present"].includes(durableTombstone.status)) {
      return { status: "control_retry", control: true, marker: DISABLE_RETRY };
    }
    const persisted = setContinuationChoiceLocked(projectRoot, "denied", opts);
    if (persisted.action !== "updated")
      return { status: "control_retry", control: true, marker: DISABLE_RETRY };
    let purge = { busy: 0, errors: [] };
    if (typeof opts.purge === "function") {
      try {
        purge = opts.purge();
      } catch {
        purge = { busy: 1, errors: ["purge_failed"] };
      }
    }
    const finalLock = acquireControlReservation(opts.stateRoot, key, { timeoutMs: opts.timeoutMs ?? 80 });
    if (!finalLock || (purge == null ? void 0 : purge.busy) > 0 || ((_a = purge == null ? void 0 : purge.errors) == null ? void 0 : _a.length) > 0 || (purge == null ? void 0 : purge.active_leases) > 0 || (purge == null ? void 0 : purge.lease_busy) > 0) {
      if (finalLock)
        releaseControlReservation(finalLock);
      return { status: "control_retry", control: true, marker: DISABLE_RETRY };
    }
    const final = writeTurn(opts.stateRoot, key, ckey, {
      control_kind: "denied",
      control_status: "denied"
    });
    releaseControlReservation(finalLock);
    if (!["updated", "created", "already_present"].includes(final.status)) {
      return { status: "control_retry", control: true, marker: DISABLE_RETRY };
    }
    const done = updateNoticeStatus(opts.stateRoot, key, "deny_pending", "denied");
    if (!["updated", "conflict"].includes(done.status))
      return { status: "control_retry", control: true, marker: DISABLE_RETRY };
    return { status: "control_in_progress", control: true, marker: DISABLED };
  };
  let lock = acquireControlReservation(opts.stateRoot, key, { timeoutMs: opts.timeoutMs ?? 80 });
  if (!lock)
    return retry();
  let receipt;
  let turn;
  let tombstone;
  try {
    const notice = readNoticeReceipt(opts.stateRoot, key);
    receipt = notice.status === "valid" ? notice.value : null;
    tombstone = readDenyTombstone(opts.stateRoot, key);
    turn = readControlTurn(opts.stateRoot, key, ckey);
    if (tombstone.status === "valid" || tombstone.status === "corrupt") {
      if (choice === "denied") {
        if (tombstone.status === "corrupt") {
          releaseControlReservation(lock);
          lock = null;
          const disabled = setContinuationChoiceLocked(projectRoot, "denied", opts);
          if (disabled.action !== "updated")
            return { status: "control_retry", control: true, marker: DISABLE_RETRY };
          const quarantined = quarantineDenyTombstone(opts.stateRoot, key);
          if (!["quarantined", "missing"].includes(quarantined.status)) {
            return { status: "control_retry", control: true, marker: DISABLE_RETRY };
          }
          const recreated = writeDenyTombstone(opts.stateRoot, key, ckey);
          if (!["created", "already_present"].includes(recreated.status)) {
            return { status: "control_retry", control: true, marker: DISABLE_RETRY };
          }
          return completeDenied();
        }
        if (turn.status === "valid" && ["denied", "deny_pending", "retryable"].includes(turn.value.control_status)) {
          if (turn.value.control_status === "denied")
            return { status: "control_in_progress", control: true, marker: DISABLED };
          releaseControlReservation(lock);
          lock = null;
          return completeDenied();
        }
        if (tombstone.status === "valid" && turn.status === "missing") {
          releaseControlReservation(lock);
          lock = null;
          const controlLock = acquireControlReservation(opts.stateRoot, key, { timeoutMs: opts.timeoutMs ?? 80 });
          if (!controlLock)
            return { status: "control_retry", control: true, marker: DISABLE_RETRY };
          let created = false;
          try {
            const result = writeTurn(opts.stateRoot, key, ckey, {
              control_kind: "denied",
              control_status: "deny_pending"
            }, { firstWriter: true });
            created = ["created", "already_present"].includes(result.status);
          } finally {
            releaseControlReservation(controlLock);
          }
          if (!created)
            return { status: "control_retry", control: true, marker: DISABLE_RETRY };
          const currentNotice = readNoticeReceipt(opts.stateRoot, key);
          if (currentNotice.status === "valid" && currentNotice.value.status === "awaiting_choice") {
            const advanced = updateNoticeStatus(opts.stateRoot, key, "awaiting_choice", "deny_pending");
            if (!["updated", "conflict"].includes(advanced.status))
              return { status: "control_retry", control: true, marker: DISABLE_RETRY };
          }
          return completeDenied();
        }
        return { status: "control_retry", control: true, marker: DISABLE_RETRY };
      }
      return { status: "control_in_progress", control: true, marker: tombstone.status === "valid" ? DISABLED : CONTROL_RETRY };
    }
    if (turn.status === "corrupt")
      return retry();
    if (turn.status === "valid") {
      const state = turn.value.control_status;
      if (choice === "allowed" && state === "allowed")
        return { status: "control_in_progress", control: true, marker: ALLOWED };
      if (choice === "denied" && state === "denied")
        return { status: "control_in_progress", control: true, marker: DISABLED };
      if (choice === "allowed" && state === "allowed_pending") {
        releaseControlReservation(lock);
        lock = null;
        return finishAllowed();
      }
      if (state === "allowed_pending" || state === "deny_pending" || state === "retryable") {
        return { status: "control_in_progress", control: true, marker: state === "deny_pending" ? DISABLE_RETRY : CONTROL_RETRY };
      }
      return { status: "control_in_progress", control: true, marker: CONTROL_RETRY };
    }
    if (!receipt) {
      return null;
    }
    if (receipt.status === "pending_output") {
      return { status: "control_in_progress", control: true, marker: CONTROL_RETRY };
    }
    if (!["awaiting_choice", "allow_pending", "deny_pending"].includes(receipt.status)) {
      return { status: "control_in_progress", control: true, marker: CONTROL_RETRY };
    }
    if (choice === "allowed" && receipt.status !== "awaiting_choice") {
      return { status: "control_in_progress", control: true, marker: CONTROL_RETRY };
    }
    if (choice === "denied" && receipt.status !== "awaiting_choice") {
      return { status: "control_in_progress", control: true, marker: CONTROL_RETRY };
    }
    if (choice === "allowed") {
      const created = writeTurn(opts.stateRoot, key, ckey, {
        control_kind: choice,
        control_status: "allowed_pending"
      }, { firstWriter: true });
      if (!["created", "already_present"].includes(created.status)) {
        return { status: "control_retry", control: true, marker: CONTROL_RETRY };
      }
      releaseControlReservation(lock);
      lock = null;
      const advanced = updateNoticeStatus(opts.stateRoot, key, receipt.status, "allow_pending");
      if (!["updated", "conflict"].includes(advanced.status)) {
        return { status: "control_retry", control: true, marker: CONTROL_RETRY };
      }
    } else {
      releaseControlReservation(lock);
      lock = null;
      const tomb2 = opts.source === "hook" ? writeDenyTombstoneFromHook(opts.stateRoot, key, ckey, { timeoutMs: opts.timeoutMs ?? 25 }) : writeDenyTombstone(opts.stateRoot, key, ckey);
      if (!(opts.source === "hook" ? ["pending", "already_present"].includes(tomb2.status) : ["created", "already_present"].includes(tomb2.status))) {
        return { status: "control_retry", control: true, marker: DISABLE_RETRY };
      }
      if (opts.source === "hook")
        return { status: "control_in_progress", control: true, marker: DISABLE_RETRY };
      const controlLock = acquireControlReservation(opts.stateRoot, key, { timeoutMs: opts.timeoutMs ?? 80 });
      if (!controlLock)
        return { status: "control_retry", control: true, marker: DISABLE_RETRY };
      try {
        const created = writeTurn(opts.stateRoot, key, ckey, {
          control_kind: choice,
          control_status: "deny_pending"
        }, { firstWriter: true });
        if (!["created", "already_present"].includes(created.status)) {
          return { status: "control_retry", control: true, marker: DISABLE_RETRY };
        }
      } finally {
        releaseControlReservation(controlLock);
      }
      const advanced = updateNoticeStatus(opts.stateRoot, key, receipt.status, "deny_pending");
      if (!["updated", "conflict"].includes(advanced.status)) {
        return { status: "control_retry", control: true, marker: DISABLE_RETRY };
      }
    }
  } finally {
    releaseControlReservation(lock);
  }
  if (choice === "allowed") {
    return finishAllowed();
  }
  if (opts.source === "hook")
    return { status: "control_in_progress", control: true, marker: DISABLE_RETRY };
  const tomb = writeDenyTombstone(opts.stateRoot, key, ckey);
  if (!["created", "already_present"].includes(tomb.status)) {
    return { status: "control_retry", control: true, marker: DISABLE_RETRY };
  }
  return completeDenied();
}
function preferenceFromText(text) {
  if (typeof text !== "string")
    return null;
  let normalized = text.trim().replace(/\s+/g, " ").replace(/[。.!！?？ ]+$/u, "").toLowerCase();
  normalized = normalized.replace(/^(?:请帮我|麻烦帮我|麻烦|帮我|请|please\s+)?/iu, "").trim();
  if (OFF_TEXTS.has(normalized))
    return false;
  if (ON_TEXTS.has(normalized))
    return true;
  return null;
}
function legacyCachePath(projectRoot, env = process.env) {
  const key = (0, import_node_crypto5.createHash)("sha256").update(canonicalRoot(projectRoot)).digest("hex").slice(0, 16);
  const base = env.XDG_CACHE_HOME || (0, import_node_path6.join)((0, import_node_os2.homedir)(), ".cache");
  return (0, import_node_path6.join)(base, "trtc-traces", `reporting-state-${key}.json`);
}

// skills/trtc/runtime/telemetry.js
init_redact();

// skills/trtc/runtime/session-context.js
var import_node_crypto6 = require("node:crypto");
var import_node_fs7 = require("node:fs");
var import_node_path7 = require("node:path");
var import_node_perf_hooks6 = require("node:perf_hooks");
init_identity();
var BINDING_TTL_MS = 30 * 60 * 1e3;
var CONTEXT_TTL_MS = 30 * 60 * 1e3;
var FINGERPRINT_DEDUP_WINDOW_MS = 10 * 1e3;
var RESERVATION_STALE_GRACE_MS = 60 * 1e3;
var COORD_DIR = "session-context-v2";
var LOCK_DIR2 = "locks";
var BINDING_DIR = "bindings";
var CONTEXT_DIR = "contexts";
var STAGE_DIR = "stages";
function digest(...parts) {
  const hash = (0, import_node_crypto6.createHash)("sha256");
  for (const part of parts)
    hash.update(String(part)).update("\0");
  return hash.digest("hex");
}
function deriveSessionId(projectRoot, ide, rawHostSessionId) {
  if (typeof rawHostSessionId !== "string" || rawHostSessionId.length === 0)
    return null;
  return `sess_${digest(projectRoot, ide || "unknown", rawHostSessionId).slice(0, 32)}`;
}
function deriveProjectFallbackSession(projectRoot) {
  return `sess_project_${digest(projectRoot).slice(0, 24)}`;
}
function promptFingerprint(text) {
  return digest(text).slice(0, 32);
}
function coordinationRoot(projectRoot) {
  return (0, import_node_path7.join)(resolveProjectStateDir(projectRoot), COORD_DIR);
}
function safeSessionId(value) {
  return typeof value === "string" && /^sess_[a-f0-9_]{8,64}$/.test(value);
}
function ensurePrivateDir(path2) {
  (0, import_node_fs7.mkdirSync)(path2, { recursive: true, mode: process.platform === "win32" ? void 0 : 448 });
}
function readJson2(path2) {
  try {
    const value = JSON.parse((0, import_node_fs7.readFileSync)(path2, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}
function writeJsonAtomic(path2, value, opts = {}) {
  const dir = (0, import_node_path7.dirname)(path2);
  ensurePrivateDir(dir);
  const tmp = (0, import_node_path7.join)(dir, `.${(0, import_node_crypto6.randomBytes)(8).toString("hex")}.tmp`);
  let fd;
  try {
    fd = (0, import_node_fs7.openSync)(tmp, "wx", process.platform === "win32" ? void 0 : 384);
    writeAll3(fd, `${JSON.stringify(value)}
`);
    if (opts.durable !== false)
      (0, import_node_fs7.fsyncSync)(fd);
    (0, import_node_fs7.closeSync)(fd);
    fd = void 0;
    (0, import_node_fs7.renameSync)(tmp, path2);
    if (opts.durable !== false)
      try {
        const dirFd = (0, import_node_fs7.openSync)(dir, "r");
        try {
          (0, import_node_fs7.fsyncSync)(dirFd);
        } finally {
          (0, import_node_fs7.closeSync)(dirFd);
        }
      } catch (err) {
        if (!["EINVAL", "ENOSYS", "EPERM", "EACCES", "ENOENT"].includes(err == null ? void 0 : err.code))
          throw err;
      }
  } finally {
    if (fd !== void 0)
      try {
        (0, import_node_fs7.closeSync)(fd);
      } catch {
      }
    try {
      (0, import_node_fs7.unlinkSync)(tmp);
    } catch {
    }
  }
}
function bindingPath(projectRoot, sessionid) {
  return (0, import_node_path7.join)(coordinationRoot(projectRoot), BINDING_DIR, `${sessionid}.json`);
}
function contextPath(projectRoot, sessionid) {
  return (0, import_node_path7.join)(coordinationRoot(projectRoot), CONTEXT_DIR, `${sessionid}.json`);
}
function stagePath(projectRoot, sessionid, stageKey) {
  return (0, import_node_path7.join)(coordinationRoot(projectRoot), STAGE_DIR, `${digest(sessionid, stageKey)}.json`);
}
function listJson(dir) {
  try {
    return (0, import_node_fs7.readdirSync)(dir).filter((name) => /^sess_[a-f0-9_]{8,64}\.json$/.test(name));
  } catch {
    return [];
  }
}
function refreshBinding(projectRoot, sessionid, ide = "unknown", opts = {}) {
  var _a, _b;
  if (!safeSessionId(sessionid))
    throw new TypeError("invalid anonymous sessionid");
  if (opts.hookMode === true) {
    const now = ((_a = opts.now) == null ? void 0 : _a.call(opts)) ?? Date.now();
    const existing = readJson2(bindingPath(projectRoot, sessionid));
    if ((existing == null ? void 0 : existing.sessionid) === sessionid && Number.isFinite(existing.updated_at) && now - existing.updated_at < (opts.ttlMs ?? BINDING_TTL_MS) / 2) {
      return { status: "bound", sessionid };
    }
    writeJsonAtomic(bindingPath(projectRoot, sessionid), {
      sessionid,
      ide: typeof ide === "string" ? ide.slice(0, 64) : "unknown",
      updated_at: now
    }, { durable: false });
    return { status: "bound", sessionid };
  }
  const deadlineMono = opts.deadlineMono ?? import_node_perf_hooks6.performance.now() + (opts.timeoutMs ?? 1e3);
  const lock = acquireCoordinationReservation(projectRoot, "binding", "project", { ...opts, deadlineMono });
  if (!lock)
    return { status: "busy" };
  try {
    const now = ((_b = opts.now) == null ? void 0 : _b.call(opts)) ?? Date.now();
    writeJsonAtomic(bindingPath(projectRoot, sessionid), {
      sessionid,
      ide: typeof ide === "string" ? ide.slice(0, 64) : "unknown",
      updated_at: now
    }, { durable: opts.hookMode !== true });
    cleanupExpiredBindings(projectRoot, { now, ttlMs: opts.ttlMs });
    return { status: "bound", sessionid };
  } finally {
    releaseCoordinationReservation(lock);
  }
}
function cleanupExpiredBindings(projectRoot, opts = {}) {
  const now = opts.now ?? Date.now();
  const ttlMs = opts.ttlMs ?? BINDING_TTL_MS;
  const dir = (0, import_node_path7.join)(coordinationRoot(projectRoot), BINDING_DIR);
  let removed = 0;
  for (const name of listJson(dir)) {
    const path2 = (0, import_node_path7.join)(dir, name);
    const value = readJson2(path2);
    if (!value || !safeSessionId(value.sessionid) || !Number.isFinite(value.updated_at) || now - value.updated_at > ttlMs) {
      try {
        (0, import_node_fs7.unlinkSync)(path2);
        removed++;
      } catch {
      }
    }
  }
  return removed;
}
function listFreshBindings(projectRoot, opts = {}) {
  const now = opts.now ?? Date.now();
  const ttlMs = opts.ttlMs ?? BINDING_TTL_MS;
  const dir = (0, import_node_path7.join)(coordinationRoot(projectRoot), BINDING_DIR);
  const values = [];
  for (const name of listJson(dir)) {
    const value = readJson2((0, import_node_path7.join)(dir, name));
    if (!value || !safeSessionId(value.sessionid) || !Number.isFinite(value.updated_at))
      continue;
    if (now - value.updated_at <= ttlMs)
      values.push(value);
  }
  return values.sort((a, b) => a.sessionid.localeCompare(b.sessionid));
}
function resolveAnonymousSession(projectRoot, opts = {}) {
  if (safeSessionId(opts.sessionid))
    return { status: "resolved", sessionid: opts.sessionid, source: "explicit" };
  const bindings = listFreshBindings(projectRoot, opts);
  if (bindings.length === 1)
    return { status: "resolved", sessionid: bindings[0].sessionid, source: "binding" };
  if (bindings.length > 1)
    return { status: "ambiguous", sessions: bindings.map((v) => v.sessionid) };
  if (opts.allowFallback === false)
    return { status: "not_found" };
  return { status: "resolved", sessionid: deriveProjectFallbackSession(projectRoot), source: "fallback" };
}
function putContext(projectRoot, sessionid, question, opts = {}) {
  var _a;
  if (!safeSessionId(sessionid))
    throw new TypeError("invalid anonymous sessionid");
  if (typeof question !== "string" || question.length === 0)
    throw new TypeError("invalid context question");
  const lock = acquireCoordinationReservation(projectRoot, "context", sessionid, opts);
  if (!lock)
    return { status: "busy" };
  try {
    const now = ((_a = opts.now) == null ? void 0 : _a.call(opts)) ?? Date.now();
    writeJsonAtomic(contextPath(projectRoot, sessionid), {
      sessionid,
      question,
      created_at: now,
      expires_at: now + (opts.ttlMs ?? CONTEXT_TTL_MS),
      consumed_by_event_id: null
    });
    return { status: "stored", sessionid };
  } finally {
    releaseCoordinationReservation(lock);
  }
}
function readContext(projectRoot, sessionid, opts = {}) {
  if (!safeSessionId(sessionid))
    return null;
  const path2 = contextPath(projectRoot, sessionid);
  const value = readJson2(path2);
  const now = opts.now ?? Date.now();
  if (!value || value.sessionid !== sessionid || !Number.isFinite(value.expires_at) || value.expires_at < now) {
    if ((0, import_node_fs7.existsSync)(path2))
      try {
        (0, import_node_fs7.unlinkSync)(path2);
      } catch {
      }
    return null;
  }
  return value;
}
function hasContext(projectRoot, sessionid) {
  return safeSessionId(sessionid) && (0, import_node_fs7.existsSync)(contextPath(projectRoot, sessionid));
}
function markContextConsumed(projectRoot, sessionid, eventId, expectedCreatedAt) {
  const path2 = contextPath(projectRoot, sessionid);
  const value = readJson2(path2);
  if (!value || value.sessionid !== sessionid || value.created_at !== expectedCreatedAt)
    return false;
  if (value.consumed_by_event_id && value.consumed_by_event_id !== eventId)
    return false;
  writeJsonAtomic(path2, { ...value, consumed_by_event_id: eventId });
  return true;
}
function readStageReceipt(projectRoot, sessionid, stageKey) {
  const value = readJson2(stagePath(projectRoot, sessionid, stageKey));
  return value && value.sessionid === sessionid ? value : null;
}
function writeStageReceipt(projectRoot, sessionid, stageKey, value, opts = {}) {
  if (!safeSessionId(sessionid))
    throw new TypeError("invalid anonymous sessionid");
  writeJsonAtomic(stagePath(projectRoot, sessionid, stageKey), {
    sessionid,
    event_id: value.event_id,
    source: value.source,
    claimed_sources: Array.isArray(value.claimed_sources) ? [...new Set(value.claimed_sources.filter((v) => typeof v === "string"))].slice(0, 8) : [],
    time: value.time
  }, { durable: opts.durable !== false });
}
function sleepSync3(ms) {
  if (ms > 0)
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
function writeAll3(fd, body) {
  const buffer = Buffer.from(body);
  let offset = 0;
  while (offset < buffer.length)
    offset += (0, import_node_fs7.writeSync)(fd, buffer, offset, buffer.length - offset);
}
function parseOwner(raw) {
  try {
    const owner = JSON.parse(raw);
    if (!owner || !Number.isInteger(owner.pid) || owner.pid <= 0)
      return null;
    if (typeof owner.token !== "string" || !/^[a-f0-9]{32}$/.test(owner.token))
      return null;
    if (!Number.isFinite(owner.ts))
      return null;
    return owner;
  } catch {
    return null;
  }
}
function lockPath(projectRoot, namespace, key) {
  const root = coordinationRoot(projectRoot);
  const dir = (0, import_node_path7.join)(root, LOCK_DIR2);
  (0, import_node_fs7.mkdirSync)(dir, { recursive: true, mode: process.platform === "win32" ? void 0 : 448 });
  return (0, import_node_path7.join)(dir, `${digest(namespace, key)}.lock`);
}
function tryRecoverStale(path2, sampledRaw, opts) {
  const owner = parseOwner(sampledRaw);
  if (owner) {
    if (opts.now() - owner.ts <= opts.staleGraceMs)
      return false;
    if (opts.pidAlive(owner.pid) !== false)
      return false;
  } else {
    let mtimeMs;
    try {
      mtimeMs = (0, import_node_fs7.statSync)(path2).mtimeMs;
    } catch {
      return false;
    }
    if (opts.now() - mtimeMs <= opts.staleGraceMs)
      return false;
  }
  const scratch = `${path2}.steal-${process.pid}-${(0, import_node_crypto6.randomBytes)(8).toString("hex")}`;
  try {
    (0, import_node_fs7.renameSync)(path2, scratch);
  } catch (err) {
    if ((err == null ? void 0 : err.code) === "ENOENT")
      return true;
    return false;
  }
  let moved = "";
  try {
    moved = (0, import_node_fs7.readFileSync)(scratch, "utf8");
  } catch {
  }
  if (moved !== sampledRaw) {
    try {
      (0, import_node_fs7.linkSync)(scratch, path2);
    } catch (err) {
      if ((err == null ? void 0 : err.code) !== "EEXIST")
        throw err;
    }
  }
  try {
    (0, import_node_fs7.unlinkSync)(scratch);
  } catch {
  }
  return moved === sampledRaw;
}
function acquireCoordinationReservation(projectRoot, namespace, key, opts = {}) {
  const path2 = lockPath(projectRoot, namespace, key);
  const deadlineMono = Number.isFinite(opts.deadlineMono) ? opts.deadlineMono : import_node_perf_hooks6.performance.now() + (opts.timeoutMs ?? 1e3);
  const now = opts.now || Date.now;
  const pidAlive = opts.isPidAlive || isPidAlive;
  const staleGraceMs = opts.staleGraceMs ?? RESERVATION_STALE_GRACE_MS;
  let backoff = 1;
  while (import_node_perf_hooks6.performance.now() < deadlineMono) {
    const token = (0, import_node_crypto6.randomBytes)(16).toString("hex");
    let fd;
    try {
      fd = (0, import_node_fs7.openSync)(path2, "wx", process.platform === "win32" ? void 0 : 384);
      writeAll3(fd, JSON.stringify({ pid: process.pid, ts: now(), token }));
      (0, import_node_fs7.closeSync)(fd);
      fd = void 0;
      return { path: path2, token };
    } catch (err) {
      if (fd !== void 0)
        try {
          (0, import_node_fs7.closeSync)(fd);
        } catch {
        }
      if ((err == null ? void 0 : err.code) !== "EEXIST") {
        try {
          (0, import_node_fs7.unlinkSync)(path2);
        } catch {
        }
        throw err;
      }
      let raw = "";
      try {
        raw = (0, import_node_fs7.readFileSync)(path2, "utf8");
      } catch (readErr) {
        if ((readErr == null ? void 0 : readErr.code) === "ENOENT")
          continue;
        throw readErr;
      }
      tryRecoverStale(path2, raw, { now, pidAlive, staleGraceMs });
      const remaining2 = deadlineMono - import_node_perf_hooks6.performance.now();
      if (remaining2 <= 0)
        break;
      sleepSync3(Math.min(backoff, remaining2));
      backoff = Math.min(backoff * 2, 10);
    }
  }
  return null;
}
function releaseCoordinationReservation(lock) {
  var _a;
  if (!lock || typeof lock.path !== "string" || typeof lock.token !== "string") {
    throw new TypeError("reservation handle must contain path and token");
  }
  let raw;
  try {
    raw = (0, import_node_fs7.readFileSync)(lock.path, "utf8");
  } catch (err) {
    if ((err == null ? void 0 : err.code) === "ENOENT")
      return false;
    throw err;
  }
  if (((_a = parseOwner(raw)) == null ? void 0 : _a.token) !== lock.token)
    return false;
  try {
    (0, import_node_fs7.unlinkSync)(lock.path);
    return true;
  } catch (err) {
    if ((err == null ? void 0 : err.code) === "ENOENT")
      return false;
    throw err;
  }
}

// skills/trtc/runtime/telemetry.js
init_schema();

// skills/trtc/runtime/sdkappid-resolver.js
var import_node_fs8 = require("node:fs");
var import_node_path8 = require("node:path");
var import_node_crypto8 = require("node:crypto");
var import_node_perf_hooks7 = require("node:perf_hooks");
var RESOLVER_VERSION = "18.4";
var TIER1_FILES = /* @__PURE__ */ new Set([
  "config.dart",
  "main.ts",
  "main.js",
  "App.vue",
  "GenerateTestUserSig.java",
  "GenerateTestUserSig.swift",
  "GenerateTestUserSig.h",
  "GenerateTestUserSig.js",
  "GenerateTestUserSig-es.js",
  "generateTestUserSig.js",
  "generate_test_user_sig.dart"
]);
var TIER3_FILES = /* @__PURE__ */ new Set([
  "TLSSigAPIv2.java",
  "TLSSigAPIv2.js",
  "TLSSigAPIv2.py",
  "TLSSigAPIv2.php",
  "TLSSigAPITest.go"
]);
var TIER2_EXTENSIONS = /* @__PURE__ */ new Set([
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".vue",
  ".dart"
]);
var WEB_TIER2_EXTENSIONS = /* @__PURE__ */ new Set([
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".vue"
]);
var SKIP_DIRS = /* @__PURE__ */ new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  "vendor",
  "vendors",
  "Pods",
  "DerivedData",
  ".gradle",
  ".idea",
  ".next",
  ".nuxt",
  "build",
  "dist",
  "coverage",
  "target",
  "out",
  ".cache",
  // Agent-owned configuration, installed Skills, worktrees and caches are
  // not user application source. Entering them can associate another
  // worktree/template's SDKAppID with the current project.
  ".agents",
  ".claude",
  ".codebuddy",
  ".codex",
  ".cursor",
  ".gemini",
  ".windsurf",
  ".worktrees"
]);
var SKIP_DIRS_LOWER = new Set([...SKIP_DIRS].map((name) => name.toLowerCase()));
var FIELD_NAMES = ["SDKAPPID", "SDKAppID", "sdkAppId", "sdkappid", "public_SDKAPPID"];
var FIELD_PATTERN = FIELD_NAMES.join("|");
var SEMANTIC_CONTEXT_RE = /GenerateTestUserSig|genTestUserSig|UserSig|TLSSigAPIv2|genSig|LoginStore\.shared\.login|TUIKit|TUICallKit|TUILiveKit|TUIRoomKit/;
var SEMANTIC_TOKENS = [
  "GenerateTestUserSig",
  "genTestUserSig",
  "UserSig",
  "TLSSigAPIv2",
  "genSig",
  "LoginStore",
  "TUIKit",
  "TUICallKit",
  "TUILiveKit",
  "TUIRoomKit",
  "useLoginStore",
  "useLoginState",
  "TRTC",
  "enterRoom",
  "roomkit",
  // R05 conference.login — '@tencentcloud/roomkit-web-vue3'/'roomkit-web-react' imports
  // R18 generic Web config fallback. These tokens only prefilter files; the
  // structured adapter still performs AST/context validation before extracting.
  "sdkAppId",
  "SDKAppID",
  "sdkappid",
  "SDKAPPID",
  "SDK_APP_ID",
  "sdk_app_id",
  "trtcConfig",
  "rtcConfig",
  "trtcOptions",
  "rtcOptions",
  "trtcSettings",
  "rtcSettings"
];
var SCOPE_MANIFESTS = [
  "pubspec.yaml",
  "package.json",
  "build.gradle",
  "Podfile",
  "pyproject.toml",
  "go.mod",
  ".trtc-session.yaml"
];
var PREFILTER_MAX_BYTES = 64 * 1024;
var DEFAULT_MAX_FILES = 200;
var DEFAULT_MAX_FILE_BYTES = 1024 * 1024;
var DEFAULT_MAX_DIRS = 5e3;
var DEFAULT_DEADLINE_MS = 500;
var WEB_MAX_FILE_BYTES = 256 * 1024;
function resolveActiveScope(cwd, projectRoot) {
  let current;
  let root;
  try {
    root = (0, import_node_fs8.realpathSync)((0, import_node_path8.resolve)(projectRoot));
    current = (0, import_node_fs8.realpathSync)((0, import_node_path8.resolve)(cwd));
  } catch {
    return { scopeRoot: projectRoot, scopeManifest: null };
  }
  const rel = (0, import_node_path8.relative)(root, current);
  if (rel.startsWith("..") || (0, import_node_path8.isAbsolute)(rel))
    return { scopeRoot: root, scopeManifest: null };
  while (true) {
    for (const manifest of SCOPE_MANIFESTS) {
      try {
        if ((0, import_node_fs8.existsSync)((0, import_node_path8.join)(current, manifest))) {
          return { scopeRoot: current, scopeManifest: manifest };
        }
      } catch {
      }
    }
    try {
      const entries = (0, import_node_fs8.readdirSync)(current);
      if (entries.some((e) => e.endsWith(".xcodeproj") || e.endsWith(".xcworkspace"))) {
        const match = entries.find((e) => e.endsWith(".xcodeproj") || e.endsWith(".xcworkspace"));
        return { scopeRoot: current, scopeManifest: match };
      }
    } catch {
    }
    const parent = (0, import_node_path8.resolve)(current, "..");
    if (parent === current)
      break;
    const parentRel = (0, import_node_path8.relative)(root, parent);
    if (parentRel.startsWith("..") || (0, import_node_path8.isAbsolute)(parentRel))
      break;
    current = parent;
  }
  return { scopeRoot: root, scopeManifest: null };
}
function hasSemanticToken(buffer) {
  for (const token of SEMANTIC_TOKENS) {
    if (buffer.includes(token))
      return true;
  }
  return false;
}
function empty(status = "not_found") {
  return {
    status,
    sdkappid: null,
    source_type: null,
    source_path_hint: null,
    matched_field: null,
    candidates_count: 0,
    conflict: status === "conflict"
  };
}
function validSdkAppId(value) {
  const text = String(value ?? "").trim().replace(/^["']|["']$/g, "").trim();
  if (!/^[0-9]+$/.test(text) || /^0+$/.test(text))
    return null;
  if (/PLACEHOLDER|x{3,}|your|demo/i.test(text))
    return null;
  return text;
}
function literalSdkAppId(value) {
  const text = String(value ?? "").trim();
  if (!/^(?:[0-9]+|"[0-9]+"|'[0-9]+')$/.test(text))
    return null;
  return validSdkAppId(text);
}
function sourceTypeFor(name) {
  if (name.startsWith("GenerateTestUserSig") || name === "generateTestUserSig.js" || name === "generate_test_user_sig.dart") {
    return "test_usersig";
  }
  if (name.startsWith("TLSSigAPI") || name === "TLSSigAPITest.go")
    return "server_sig";
  return "literal_config";
}
function isTier2SourceFile(name) {
  const lower = String(name).toLowerCase();
  if (/\.d\.ts$/.test(lower))
    return false;
  if (/\.(?:min|bundle)\.(?:js|mjs|cjs)$/.test(lower))
    return false;
  const dot = lower.lastIndexOf(".");
  return dot >= 0 && TIER2_EXTENSIONS.has(lower.slice(dot));
}
function resultFor(candidates) {
  if (candidates.length === 0)
    return empty();
  const byValue = /* @__PURE__ */ new Map();
  for (const candidate of candidates) {
    if (!byValue.has(candidate.sdkappid))
      byValue.set(candidate.sdkappid, candidate);
  }
  if (byValue.size > 1) {
    return { ...empty("conflict"), candidates_count: candidates.length };
  }
  const winner = byValue.values().next().value;
  return {
    status: "resolved",
    sdkappid: winner.sdkappid,
    source_type: winner.source_type,
    source_path_hint: winner.source_path_hint ?? null,
    matched_field: winner.matched_field ?? null,
    candidates_count: candidates.length,
    conflict: false
  };
}
function delimiterIsEscaped(input, index) {
  let backslashes = 0;
  for (let i = index - 1; i >= 0 && input[i] === "\\"; i--)
    backslashes++;
  return (backslashes & 1) === 1;
}
function lexSource(input, deadlineMono, fileName = "") {
  const lowerName = String(fileName).toLowerCase();
  const hashComments = lowerName.endsWith(".py") || lowerName.endsWith(".php");
  const slashLineComments = !lowerName.endsWith(".py");
  const htmlComments = lowerName.endsWith(".vue");
  let source = "";
  let code = "";
  let quote = null;
  let blockEnd = null;
  let escaped = false;
  for (let i = 0; i < input.length; i++) {
    if ((i & 4095) === 0 && import_node_perf_hooks7.performance.now() > deadlineMono)
      return null;
    const ch = input[i];
    const next = input[i + 1];
    if (blockEnd) {
      if (input.startsWith(blockEnd, i)) {
        source += " ".repeat(blockEnd.length);
        code += " ".repeat(blockEnd.length);
        i += blockEnd.length - 1;
        blockEnd = null;
      } else if (ch === "\n") {
        source += "\n";
        code += "\n";
      } else {
        source += " ";
        code += " ";
      }
      continue;
    }
    if (quote) {
      if (quote.length === 3 && input.startsWith(quote, i) && !delimiterIsEscaped(input, i)) {
        source += quote;
        code += "   ";
        i += 2;
        quote = null;
        escaped = false;
        continue;
      }
      source += ch;
      code += ch === "\n" ? "\n" : " ";
      if (quote.length === 1) {
        if (escaped)
          escaped = false;
        else if (ch === "\\")
          escaped = true;
        else if (ch === quote)
          quote = null;
      }
      continue;
    }
    if ((ch === '"' || ch === "'") && input[i + 1] === ch && input[i + 2] === ch) {
      quote = ch.repeat(3);
      source += quote;
      code += "   ";
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      source += ch;
      code += " ";
      continue;
    }
    if (ch === "/" && next === "*") {
      source += "  ";
      code += "  ";
      blockEnd = "*/";
      i++;
      continue;
    }
    if (htmlComments && input.startsWith("<!--", i)) {
      source += "    ";
      code += "    ";
      blockEnd = "-->";
      i += 3;
      continue;
    }
    if (slashLineComments && ch === "/" && next === "/") {
      while (i < input.length && input[i] !== "\n") {
        source += " ";
        code += " ";
        i++;
      }
      if (i < input.length) {
        source += "\n";
        code += "\n";
      }
      continue;
    }
    if (hashComments && ch === "#" && next !== "[") {
      while (i < input.length && input[i] !== "\n") {
        source += " ";
        code += " ";
        i++;
      }
      if (i < input.length) {
        source += "\n";
        code += "\n";
      }
      continue;
    }
    source += ch;
    code += ch;
  }
  return import_node_perf_hooks7.performance.now() > deadlineMono ? null : { source, code };
}
function maskedText(input) {
  return input.replace(/[^\r\n]/g, " ");
}
function htmlTagEnd(input, start, deadlineMono) {
  let quote = null;
  for (let i = start; i < input.length; i++) {
    if ((i & 255) === 0 && import_node_perf_hooks7.performance.now() > deadlineMono)
      return null;
    const ch = input[i];
    if (quote) {
      if (ch === quote)
        quote = null;
      continue;
    }
    if (ch === '"' || ch === "'")
      quote = ch;
    else if (ch === ">")
      return i;
  }
  return -1;
}
function lexVueSource(input, deadlineMono) {
  const lower = input.toLowerCase();
  const regions = [];
  const scriptRanges = [];
  const stack = [];
  const voidElements = /* @__PURE__ */ new Set([
    "area",
    "base",
    "br",
    "col",
    "embed",
    "hr",
    "img",
    "input",
    "link",
    "meta",
    "param",
    "source",
    "track",
    "wbr"
  ]);
  for (let i = 0; i < input.length; ) {
    if ((i & 4095) === 0 && import_node_perf_hooks7.performance.now() > deadlineMono)
      return null;
    if (input.startsWith("<!--", i)) {
      const close = input.indexOf("-->", i + 4);
      if (close < 0)
        return null;
      i = close + 3;
      continue;
    }
    if (input[i] === "<") {
      const closing = input[i + 1] === "/";
      const nameStart = i + (closing ? 2 : 1);
      let nameEnd = nameStart;
      while (/[A-Za-z0-9:_-]/.test(input[nameEnd] || ""))
        nameEnd++;
      const next = input[nameEnd];
      if (nameEnd === nameStart || !(next === ">" || next === "/" || /\s/.test(next || ""))) {
        i++;
        continue;
      }
      const tagEnd = htmlTagEnd(input, i, deadlineMono);
      if (tagEnd === null)
        return null;
      if (tagEnd < 0)
        return null;
      const originalName = input.slice(nameStart, nameEnd);
      const tagName = originalName.toLowerCase();
      const tag = input.slice(i, tagEnd + 1);
      const selfClosing = /\/\s*>$/.test(tag);
      if (!closing && tagName === "script") {
        const bodyStart = tagEnd + 1;
        let closeStart = lower.indexOf("</script", bodyStart);
        while (closeStart >= 0) {
          const closeNext = input[closeStart + 8];
          if (closeNext === ">" || /\s/.test(closeNext || ""))
            break;
          closeStart = lower.indexOf("</script", closeStart + 2);
        }
        if (closeStart < 0)
          return null;
        const closeEnd = htmlTagEnd(input, closeStart, deadlineMono);
        if (closeEnd === null || closeEnd < 0)
          return null;
        if (stack.length === 0) {
          const body = input.slice(bodyStart, closeStart);
          const views = lexSource(body, deadlineMono, "component.ts");
          if (!views)
            return null;
          regions.push({ start: bodyStart, end: closeStart, views });
          scriptRanges.push([bodyStart, closeStart]);
        }
        i = closeEnd + 1;
        continue;
      }
      if (!closing && originalName === "TUIKit" && stack[0] === "template") {
        const views = lexSource(tag, deadlineMono, "component.ts");
        if (!views)
          return null;
        regions.push({ start: i, end: tagEnd + 1, views });
      }
      if (closing) {
        const openIndex = stack.lastIndexOf(tagName);
        if (openIndex >= 0)
          stack.length = openIndex;
      } else if (!selfClosing && !voidElements.has(tagName)) {
        stack.push(tagName);
      }
      i = tagEnd + 1;
      continue;
    }
    i++;
  }
  if (import_node_perf_hooks7.performance.now() > deadlineMono)
    return null;
  regions.sort((a, b) => a.start - b.start);
  const scriptEnds = new Set(scriptRanges.map(([, end]) => end));
  const source = [];
  const code = [];
  let cursor = 0;
  for (const region of regions) {
    if (region.start < cursor)
      continue;
    let gap = maskedText(input.slice(cursor, region.start));
    if (scriptEnds.has(cursor) && gap.length > 0)
      gap = `
${gap.slice(1)}`;
    source.push(gap, region.views.source);
    code.push(gap, region.views.code);
    cursor = region.end;
  }
  let tail = maskedText(input.slice(cursor));
  if (scriptEnds.has(cursor) && tail.length > 0)
    tail = `
${tail.slice(1)}`;
  source.push(tail);
  code.push(tail);
  const result = { source: source.join(""), code: code.join(""), scriptRanges };
  return import_node_perf_hooks7.performance.now() > deadlineMono ? null : result;
}
function lexFileSource(input, deadlineMono, fileName) {
  return String(fileName).toLowerCase().endsWith(".vue") ? lexVueSource(input, deadlineMono) : lexSource(input, deadlineMono, fileName);
}
function matchStartsInCode(file, match) {
  return Number.isInteger(match.index) && /\S/.test(file.code[match.index] || "");
}
function isGenericInvocationStart(code, index, end) {
  let depth = 0;
  for (let i = index; i < end; i++) {
    const ch = code[i];
    if (ch === "<")
      depth++;
    else if (ch === ">") {
      depth--;
      if (depth === 0) {
        let next = i + 1;
        while (next < end && /\s/.test(code[next]))
          next++;
        return code[next] === "(";
      }
      if (depth < 0)
        return false;
    } else if (depth > 0 && (ch === ";" || ch === "\n"))
      return false;
  }
  return false;
}
function topLevelCallArguments(file, openParen, deadlineMono, maxChars = 2e3) {
  const args = [];
  let start = openParen + 1;
  const delimiters = [];
  const end = Math.min(file.code.length, openParen + 1 + maxChars);
  for (let i = openParen + 1; i < end; i++) {
    if ((i & 255) === 0 && import_node_perf_hooks7.performance.now() > deadlineMono)
      return null;
    const ch = file.code[i];
    if (ch === "<" && (delimiters.at(-1) === ">" || isGenericInvocationStart(file.code, i, end)))
      delimiters.push(">");
    else if (ch === "(")
      delimiters.push(")");
    else if (ch === "[")
      delimiters.push("]");
    else if (ch === "{")
      delimiters.push("}");
    else if (ch === ")" || ch === "]" || ch === "}" || ch === ">") {
      if (ch === ">" && delimiters.at(-1) !== ">")
        continue;
      if (ch === ")" && delimiters.length === 0) {
        args.push([start, i]);
        return { status: "ok", args };
      }
      if (delimiters.pop() !== ch)
        return { status: "malformed", args: [] };
    } else if (ch === "," && delimiters.length === 0) {
      args.push([start, i]);
      start = i + 1;
    }
  }
  return import_node_perf_hooks7.performance.now() > deadlineMono ? null : { status: "malformed", args: [] };
}
function relativeHint(root, path2) {
  return (0, import_node_path8.relative)(root, path2).split(import_node_path8.sep).join("/");
}
function sessionSdkAppId(input, deadlineMono) {
  const lines = String(input).split(/\r?\n/);
  let credentialsIndent = null;
  for (const raw of lines) {
    if (import_node_perf_hooks7.performance.now() > deadlineMono)
      return null;
    if (!raw.trim() || /^\s*#/.test(raw))
      continue;
    const indent = raw.match(/^\s*/)[0].replace(/\t/g, "        ").length;
    const line = raw.trim();
    if (credentialsIndent === null) {
      if (/^credentials\s*:\s*(?:#.*)?$/.test(line))
        credentialsIndent = indent;
      continue;
    }
    if (indent <= credentialsIndent) {
      credentialsIndent = /^credentials\s*:\s*(?:#.*)?$/.test(line) ? indent : null;
      continue;
    }
    const match = line.match(/^sdkappid\s*:\s*(["']?[0-9]+["']?)\s*(?:#.*)?$/);
    if (match)
      return validSdkAppId(match[1]);
  }
  return null;
}
function directBindings(file, deadlineMono, { immutableOnly = false, allowedAt = null } = {}) {
  const bindings = /* @__PURE__ */ new Map();
  const permits = typeof allowedAt === "function" ? allowedAt : () => true;
  const assignment = immutableOnly ? /\b(?:const|final)\s+(?:(?:int|number|Int|UInt32|long|String|var|dynamic)\s+)?([A-Za-z_$][\w$]*)\b\s*(?::\s*(?:int|number|Int|UInt32|long))?\s*=\s*([^,;}\]\n]+)/g : /\b([A-Za-z_$][\w$]*)\b\s*(?::\s*(?:int|number|Int|UInt32|long))?\s*(?::=|=)\s*([^,;}\]\n]+)/g;
  for (const match of file.source.matchAll(assignment)) {
    if (import_node_perf_hooks7.performance.now() > deadlineMono)
      return null;
    if (!matchStartsInCode(file, match))
      continue;
    if (!permits(match.index))
      continue;
    const id = match[1];
    const sdkappid = literalSdkAppId(match[2]);
    if (!sdkappid)
      continue;
    const allAssignments = new RegExp(String.raw`\b${id.replace(/[$]/g, "\\$&")}\b\s*(?:(?::[^=;\n]+)?=|:=)`, "g");
    let assignments = 0;
    for (const occurrence of file.source.matchAll(allAssignments)) {
      if (import_node_perf_hooks7.performance.now() > deadlineMono)
        return null;
      if (matchStartsInCode(file, occurrence) && permits(occurrence.index))
        assignments++;
    }
    if (assignments === 1)
      bindings.set(id, sdkappid);
  }
  return bindings;
}
function dartTopLevelBindings(file, deadlineMono) {
  let depth = 0;
  for (let i = 0; i < file.code.length; i++) {
    if ((i & 4095) === 0 && import_node_perf_hooks7.performance.now() > deadlineMono)
      return null;
    const ch = file.code[i];
    if (ch === "{")
      depth++;
    else if (ch === "}") {
      depth--;
      if (depth < 0)
        return null;
    }
  }
  if (depth !== 0)
    return null;
  const bindings = /* @__PURE__ */ new Map();
  let scanDepth = 0;
  let scanPos = 0;
  function advanceTo(target) {
    while (scanPos < target) {
      const ch = file.code[scanPos];
      if (ch === "{")
        scanDepth++;
      else if (ch === "}")
        scanDepth--;
      scanPos++;
    }
  }
  const constRe = /\bconst\s+(?:int\s+|var\s+)?([A-Za-z_$][\w$]*)\s*=/g;
  for (const match of file.code.matchAll(constRe)) {
    if (import_node_perf_hooks7.performance.now() > deadlineMono)
      return null;
    advanceTo(match.index);
    if (scanDepth !== 0)
      continue;
    const eqOffset = match[0].lastIndexOf("=");
    const valueStart = match.index + eqOffset + 1;
    const semicolonPos = file.source.indexOf(";", valueStart);
    if (semicolonPos < 0)
      continue;
    const valueStr = file.source.slice(valueStart, semicolonPos).trim();
    const sdkappid = literalSdkAppId(valueStr);
    if (!sdkappid)
      continue;
    const name = match[1];
    const dupRe = new RegExp(String.raw`\bconst\s+(?:int\s+|var\s+)?${name.replace(/[$]/g, "\\$&")}\s*=`, "g");
    let count = 0;
    let countDepth = 0;
    for (const dup of file.code.matchAll(dupRe)) {
      if (import_node_perf_hooks7.performance.now() > deadlineMono)
        return null;
      let d2 = 0;
      for (let i2 = 0; i2 < dup.index; i2++) {
        const c2 = file.code[i2];
        if (c2 === "{")
          d2++;
        else if (c2 === "}")
          d2--;
      }
      if (d2 === 0)
        count++;
    }
    if (count === 1)
      bindings.set(name, sdkappid);
  }
  return bindings;
}
function restrictedTier2Candidates(file, deadlineMono) {
  if (!SEMANTIC_CONTEXT_RE.test(file.code))
    return [];
  const bindings = dartTopLevelBindings(file, deadlineMono);
  if (bindings === null)
    return null;
  const out = [];
  const loginRe = /\bTUICallKit\.instance\.login\s*\(/g;
  for (const match of file.code.matchAll(loginRe)) {
    if (import_node_perf_hooks7.performance.now() > deadlineMono)
      return null;
    const openParen = match.index + match[0].lastIndexOf("(");
    const parsed = topLevelCallArguments(file, openParen, deadlineMono);
    if (!parsed)
      return null;
    if (parsed.status === "malformed")
      return null;
    if (parsed.args.length < 1)
      continue;
    const [valueStart, valueEnd] = parsed.args[0];
    const value = file.source.slice(valueStart, valueEnd).trim();
    const codeValue = file.code.slice(valueStart, valueEnd).trim();
    const sdkappid = literalSdkAppId(value) || (/^[A-Za-z_$][\w$]*$/.test(codeValue) ? bindings.get(codeValue) : null);
    if (sdkappid)
      out.push({ sdkappid, source_type: "runtime_call", source_path_hint: file.hint, matched_field: null });
  }
  return out;
}
function tier1Candidates(file, deadlineMono) {
  if (!TIER1_FILES.has(file.name) || !SEMANTIC_CONTEXT_RE.test(file.code))
    return [];
  const regex = new RegExp(String.raw`\b(${FIELD_PATTERN})\b\s*(?::\s*(?:int|number|Int|UInt32|long))?\s*[:=]\s*([^,;}\]\n]+)`, "g");
  const out = [];
  for (const match of file.source.matchAll(regex)) {
    if (import_node_perf_hooks7.performance.now() > deadlineMono)
      return null;
    if (!matchStartsInCode(file, match))
      continue;
    const sdkappid = literalSdkAppId(match[2]);
    if (!sdkappid)
      continue;
    out.push({ sdkappid, source_type: sourceTypeFor(file.name), source_path_hint: file.hint, matched_field: match[1] });
  }
  return out;
}
function tier3Candidates(file, deadlineMono) {
  if (!TIER3_FILES.has(file.name) || !SEMANTIC_CONTEXT_RE.test(file.code))
    return [];
  const out = [];
  const bindings = directBindings(file, deadlineMono);
  if (!bindings)
    return null;
  const call = /(?:new\s+TLSSigAPIv2(?:\.Api)?|\bNewTLSSigAPIv2|\bTLSSigAPIv2(?:\.Api)?|\b[Gg]enSig)\s*\(\s*(\$?[A-Za-z_$][\w$]*|[0-9]+)/g;
  for (const match of file.source.matchAll(call)) {
    if (import_node_perf_hooks7.performance.now() > deadlineMono)
      return null;
    if (!matchStartsInCode(file, match))
      continue;
    const identifier = match[1].replace(/^\$/, "");
    const sdkappid = validSdkAppId(match[1]) || bindings.get(identifier);
    if (sdkappid)
      out.push({ sdkappid, source_type: "server_sig", source_path_hint: file.hint, matched_field: null });
  }
  return out;
}
function insideRoot(root, candidate) {
  const rel = (0, import_node_path8.relative)(root, candidate);
  return rel === "" || !rel.startsWith(`..${import_node_path8.sep}`) && rel !== ".." && !(0, import_node_path8.isAbsolute)(rel);
}
function isSkippedDir(name) {
  return SKIP_DIRS_LOWER.has(String(name).toLowerCase());
}
function entersSkippedDir(root, candidate) {
  const rel = (0, import_node_path8.relative)(root, candidate);
  return rel.split(import_node_path8.sep).some(isSkippedDir);
}
function sameInode(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}
function readBoundedRegularFile(path2, root, maxBytes, deadlineMono) {
  let fd;
  try {
    if (import_node_perf_hooks7.performance.now() > deadlineMono)
      return { status: "invalid" };
    const noFollow = typeof import_node_fs8.constants.O_NOFOLLOW === "number" ? import_node_fs8.constants.O_NOFOLLOW : 0;
    fd = (0, import_node_fs8.openSync)(path2, import_node_fs8.constants.O_RDONLY | noFollow);
    const opened = (0, import_node_fs8.fstatSync)(fd);
    if (!opened.isFile())
      return { status: "skip" };
    if (opened.size > maxBytes)
      return { status: "invalid" };
    const before = (0, import_node_fs8.lstatSync)(path2);
    if (before.isSymbolicLink() || !sameInode(opened, before))
      return { status: "invalid" };
    const canonical = (0, import_node_fs8.realpathSync)(path2);
    if (!insideRoot(root, canonical))
      return { status: "invalid" };
    const after = (0, import_node_fs8.lstatSync)(path2);
    if (after.isSymbolicLink() || !sameInode(opened, after))
      return { status: "invalid" };
    const chunks = [];
    let total = 0;
    while (total <= maxBytes) {
      if (import_node_perf_hooks7.performance.now() > deadlineMono)
        return { status: "invalid" };
      const size = Math.min(64 * 1024, maxBytes + 1 - total);
      const buffer = Buffer.allocUnsafe(size);
      const read = (0, import_node_fs8.readSync)(fd, buffer, 0, size, total);
      if (read === 0)
        break;
      chunks.push(buffer.subarray(0, read));
      total += read;
    }
    if (total > maxBytes)
      return { status: "invalid" };
    const finalStat = (0, import_node_fs8.fstatSync)(fd);
    if (!sameInode(opened, finalStat) || finalStat.size > maxBytes)
      return { status: "invalid" };
    if (import_node_perf_hooks7.performance.now() > deadlineMono)
      return { status: "invalid" };
    return {
      status: "ok",
      canonical,
      content: Buffer.concat(chunks, total).toString("utf8"),
      snapshot: { ino: finalStat.ino, size: finalStat.size, mtimeMs: finalStat.mtimeMs }
    };
  } catch (error) {
    if ((error == null ? void 0 : error.code) === "ENOENT" || (error == null ? void 0 : error.code) === "ELOOP")
      return { status: "skip" };
    return { status: "invalid" };
  } finally {
    if (fd !== void 0) {
      try {
        (0, import_node_fs8.closeSync)(fd);
      } catch {
      }
    }
  }
}
function collectFiles(root, allowedFiles, opts, deadlineMono, budget) {
  const maxBytes = Number.isInteger(opts.max_file_bytes) && opts.max_file_bytes > 0 ? opts.max_file_bytes : DEFAULT_MAX_FILE_BYTES;
  const found = /* @__PURE__ */ new Map();
  let invalid = false;
  const allows = typeof allowedFiles === "function" ? allowedFiles : (name) => allowedFiles.has(name);
  function add(path2) {
    if (found.has(path2))
      return;
    const cached = budget.fileCache.get(path2);
    if (cached) {
      if (cached._rawOnly) {
        if (import_node_perf_hooks7.performance.now() > deadlineMono) {
          invalid = true;
          return;
        }
        const rawContent = cached._rawOnlyContent || cached.rawContent;
        if (!rawContent) {
          invalid = true;
          return;
        }
        const views2 = lexFileSource(rawContent, deadlineMono, cached.name);
        if (!views2) {
          invalid = true;
          return;
        }
        const lexed = {
          name: cached.name,
          path: cached.path,
          hint: cached.hint,
          source: views2.source,
          code: views2.code,
          vueScriptRanges: views2.scriptRanges ?? null,
          rawContent: null,
          _snapshot: cached._snapshot
        };
        budget.fileCache.set(path2, lexed);
        budget.fileCache.set(cached.path, lexed);
        found.set(cached.path, lexed);
        return;
      }
      found.set(cached.path, cached);
      return;
    }
    if (import_node_perf_hooks7.performance.now() > deadlineMono) {
      invalid = true;
      return;
    }
    if (budget.files <= 0) {
      invalid = true;
      return;
    }
    const read = readBoundedRegularFile(path2, root, maxBytes, deadlineMono);
    if (read.status === "invalid") {
      invalid = true;
      return;
    }
    if (read.status !== "ok")
      return;
    const canonicalCached = budget.fileCache.get(read.canonical);
    if (canonicalCached) {
      if (canonicalCached._rawOnly) {
        if (import_node_perf_hooks7.performance.now() > deadlineMono) {
          invalid = true;
          return;
        }
        const rawContent = canonicalCached._rawOnlyContent || canonicalCached.rawContent;
        if (!rawContent) {
          invalid = true;
          return;
        }
        const views2 = lexFileSource(rawContent, deadlineMono, canonicalCached.name);
        if (!views2) {
          invalid = true;
          return;
        }
        const lexed2 = {
          name: canonicalCached.name,
          path: canonicalCached.path,
          hint: canonicalCached.hint,
          source: views2.source,
          code: views2.code,
          vueScriptRanges: views2.scriptRanges ?? null,
          rawContent: null,
          _snapshot: canonicalCached._snapshot
        };
        budget.fileCache.set(path2, lexed2);
        budget.fileCache.set(read.canonical, lexed2);
        found.set(lexed2.path, lexed2);
        return;
      }
      budget.fileCache.set(path2, canonicalCached);
      found.set(canonicalCached.path, canonicalCached);
      return;
    }
    budget.files--;
    if (typeof allowedFiles === "function" && !hasSemanticToken(read.content))
      return;
    const views = lexFileSource(read.content, deadlineMono, (0, import_node_path8.basename)(read.canonical));
    if (!views) {
      invalid = true;
      return;
    }
    const file = {
      name: (0, import_node_path8.basename)(read.canonical),
      path: read.canonical,
      hint: relativeHint(root, read.canonical),
      source: views.source,
      code: views.code,
      vueScriptRanges: views.scriptRanges ?? null,
      // rawContent stored for web files when structured adapter is active (production or test injection)
      rawContent: opts._webAdapter || opts._loadWebAdapter ? read.content : null,
      // snapshot stored so concurrent modification can be detected after adapter returns
      _snapshot: opts._webAdapter || opts._loadWebAdapter ? read.snapshot : null
    };
    budget.fileCache.set(path2, file);
    budget.fileCache.set(read.canonical, file);
    found.set(read.canonical, file);
  }
  for (const preferred of Array.isArray(opts.preferred_paths) ? opts.preferred_paths : []) {
    const candidate = (0, import_node_path8.resolve)(root, String(preferred));
    if (insideRoot(root, candidate) && !entersSkippedDir(root, candidate) && allows((0, import_node_path8.basename)(candidate)))
      add(candidate);
  }
  const stack = [root];
  while (stack.length > 0 && !invalid) {
    if (import_node_perf_hooks7.performance.now() > deadlineMono) {
      invalid = true;
      break;
    }
    const dir = stack.pop();
    if (!budget.dirsSeen.has(dir)) {
      if (budget.dirs <= 0) {
        invalid = true;
        break;
      }
      budget.dirs--;
      budget.dirsSeen.add(dir);
    }
    let entries = budget.directoryCache.get(dir);
    if (!entries) {
      try {
        entries = (0, import_node_fs8.readdirSync)(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      budget.directoryCache.set(dir, entries);
    }
    for (const entry of entries) {
      if (invalid)
        break;
      const path2 = (0, import_node_path8.join)(dir, entry.name);
      if (entry.isSymbolicLink())
        continue;
      if (entry.isDirectory()) {
        if (!isSkippedDir(entry.name))
          stack.push(path2);
      } else if (entry.isFile() && allows(entry.name))
        add(path2);
    }
  }
  return invalid ? null : [...found.values()];
}
function collectTier2RawFiles(root, opts, deadlineMono, budget) {
  const maxBytes = Number.isInteger(opts.max_file_bytes) && opts.max_file_bytes > 0 ? opts.max_file_bytes : DEFAULT_MAX_FILE_BYTES;
  const found = /* @__PURE__ */ new Map();
  let invalid = false;
  const rawCache = /* @__PURE__ */ new Map();
  function add(path2) {
    if (found.has(path2))
      return;
    const cached = budget.fileCache.get(path2);
    if (cached) {
      const rawFromCache = {
        name: cached.name,
        path: cached.path,
        hint: cached.hint,
        rawContent: cached.rawContent || cached._rawOnlyContent || null,
        _preLexed: cached.source !== void 0 && !cached._rawOnly ? { source: cached.source, code: cached.code, vueScriptRanges: cached.vueScriptRanges ?? null } : null,
        _lexFailed: false,
        _snapshot: cached._snapshot || null
      };
      rawCache.set(path2, rawFromCache);
      found.set(cached.path, rawFromCache);
      return;
    }
    if (rawCache.has(path2)) {
      found.set(rawCache.get(path2).path, rawCache.get(path2));
      return;
    }
    if (import_node_perf_hooks7.performance.now() > deadlineMono) {
      invalid = true;
      return;
    }
    if (budget.files <= 0) {
      invalid = true;
      return;
    }
    const read = readBoundedRegularFile(path2, root, maxBytes, deadlineMono);
    if (read.status === "invalid") {
      invalid = true;
      return;
    }
    if (read.status !== "ok")
      return;
    if (rawCache.has(read.canonical)) {
      rawCache.set(path2, rawCache.get(read.canonical));
      found.set(rawCache.get(read.canonical).path, rawCache.get(read.canonical));
      return;
    }
    budget.files--;
    if (!hasSemanticToken(read.content))
      return;
    const rawName = (0, import_node_path8.basename)(read.canonical);
    const rawExt = (0, import_node_path8.extname)(rawName).toLowerCase();
    const snapshot = read.snapshot || null;
    const isWebFile = WEB_TIER2_EXTENSIONS.has(rawExt);
    const rawFile = {
      name: rawName,
      path: read.canonical,
      hint: relativeHint(root, read.canonical),
      rawContent: read.content,
      _preLexed: null,
      _lexFailed: false,
      _snapshot: snapshot
    };
    if (isWebFile) {
      const rawOnlyCacheEntry = {
        name: rawName,
        path: read.canonical,
        hint: relativeHint(root, read.canonical),
        _rawOnly: true,
        _rawOnlyContent: read.content,
        _snapshot: snapshot,
        rawContent: opts._webAdapter || opts._loadWebAdapter ? read.content : null
      };
      budget.fileCache.set(path2, rawOnlyCacheEntry);
      budget.fileCache.set(read.canonical, rawOnlyCacheEntry);
    } else {
      const views = lexFileSource(read.content, deadlineMono, rawName);
      rawFile._preLexed = views ? { source: views.source, code: views.code, vueScriptRanges: views.scriptRanges ?? null } : null;
      rawFile._lexFailed = !views;
      if (views) {
        const fullFile = {
          name: rawName,
          path: read.canonical,
          hint: relativeHint(root, read.canonical),
          source: views.source,
          code: views.code,
          vueScriptRanges: views.scriptRanges ?? null,
          rawContent: null,
          _snapshot: snapshot
        };
        budget.fileCache.set(path2, fullFile);
        budget.fileCache.set(read.canonical, fullFile);
      }
    }
    rawCache.set(path2, rawFile);
    rawCache.set(read.canonical, rawFile);
    found.set(read.canonical, rawFile);
  }
  for (const preferred of Array.isArray(opts.preferred_paths) ? opts.preferred_paths : []) {
    const candidate = (0, import_node_path8.resolve)(root, String(preferred));
    if (insideRoot(root, candidate) && !entersSkippedDir(root, candidate) && isTier2SourceFile((0, import_node_path8.basename)(candidate))) {
      add(candidate);
    }
  }
  const stack = [root];
  while (stack.length > 0 && !invalid) {
    if (import_node_perf_hooks7.performance.now() > deadlineMono) {
      invalid = true;
      break;
    }
    const dir = stack.pop();
    if (!budget.dirsSeen.has(dir)) {
      if (budget.dirs <= 0) {
        invalid = true;
        break;
      }
      budget.dirs--;
      budget.dirsSeen.add(dir);
    }
    let entries = budget.directoryCache.get(dir);
    if (!entries) {
      try {
        entries = (0, import_node_fs8.readdirSync)(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      budget.directoryCache.set(dir, entries);
    }
    for (const entry of entries) {
      if (invalid)
        break;
      const path2 = (0, import_node_path8.join)(dir, entry.name);
      if (entry.isSymbolicLink())
        continue;
      if (entry.isDirectory()) {
        if (!isSkippedDir(entry.name))
          stack.push(path2);
      } else if (entry.isFile() && isTier2SourceFile(entry.name))
        add(path2);
    }
  }
  if (invalid)
    return null;
  const allFiles = [...found.values()];
  const webFiles = allFiles.filter((f) => WEB_TIER2_EXTENSIONS.has((0, import_node_path8.extname)(f.name).toLowerCase()));
  const dartFiles = allFiles.filter((f) => (0, import_node_path8.extname)(f.name).toLowerCase() === ".dart");
  return { webFiles, dartFiles };
}
function runWebTier2(webFiles, webAdapter, deadlineMono) {
  const candidates = [];
  for (const rawFile of webFiles) {
    if (!rawFile.rawContent)
      continue;
    if (Buffer.byteLength(rawFile.rawContent, "utf8") > WEB_MAX_FILE_BYTES) {
      return { candidates: [], invalid: true, failure: null };
    }
    if (import_node_perf_hooks7.performance.now() > deadlineMono)
      return { candidates: [], invalid: true, failure: null };
    let result;
    try {
      result = webAdapter.extract({
        source: rawFile.rawContent,
        relativePath: rawFile.hint || rawFile.name,
        ext: (0, import_node_path8.extname)(rawFile.name),
        byteLength: Buffer.byteLength(rawFile.rawContent, "utf8")
      });
    } catch {
      return { candidates: [], invalid: true, failure: "extract_error" };
    }
    if (!result || typeof result.status !== "string" || !Array.isArray(result.candidates)) {
      return { candidates: [], invalid: true, failure: "contract_error" };
    }
    if (import_node_perf_hooks7.performance.now() > deadlineMono)
      return { candidates: [], invalid: true, failure: null };
    const snapshot = rawFile._snapshot;
    if (snapshot) {
      try {
        const afterStat = (0, import_node_fs8.lstatSync)(rawFile.path);
        if (afterStat.ino !== snapshot.ino || afterStat.size !== snapshot.size || afterStat.mtimeMs !== snapshot.mtimeMs) {
          return { candidates: [], invalid: true, failure: null };
        }
      } catch {
        return { candidates: [], invalid: true, failure: null };
      }
    }
    if (result.status === "invalid") {
      return { candidates: [], invalid: true, failure: null };
    }
    for (const c of result.candidates) {
      const sdkappid = validSdkAppId(c == null ? void 0 : c.sdkappid);
      if (sdkappid)
        candidates.push({ sdkappid, source_type: "runtime_call", source_path_hint: rawFile.hint, matched_field: null });
    }
  }
  return { candidates, invalid: false, failure: null };
}
function runRestrictedLegacyTier2(dartFiles, deadlineMono) {
  const candidates = [];
  for (const rawFile of dartFiles) {
    if (rawFile._lexFailed)
      return { candidates: [], invalid: true };
    let file;
    if (rawFile._preLexed) {
      file = {
        name: rawFile.name,
        path: rawFile.path,
        hint: rawFile.hint,
        source: rawFile._preLexed.source,
        code: rawFile._preLexed.code,
        vueScriptRanges: rawFile._preLexed.vueScriptRanges
      };
    } else if (rawFile.rawContent) {
      const views = lexFileSource(rawFile.rawContent, deadlineMono, rawFile.name);
      if (!views || import_node_perf_hooks7.performance.now() > deadlineMono)
        return { candidates: [], invalid: true };
      file = {
        name: rawFile.name,
        path: rawFile.path,
        hint: rawFile.hint,
        source: views.source,
        code: views.code,
        vueScriptRanges: views.scriptRanges ?? null
      };
    } else {
      continue;
    }
    const extracted = restrictedTier2Candidates(file, deadlineMono);
    if (!extracted || import_node_perf_hooks7.performance.now() > deadlineMono)
      return { candidates: [], invalid: true };
    candidates.push(...extracted);
  }
  return { candidates, invalid: false };
}
function tier0(root, opts, deadlineMono) {
  const candidates = [];
  const explicit = validSdkAppId(opts.sdkappid);
  if (explicit)
    candidates.push({ sdkappid: explicit, source_type: "literal_config", source_path_hint: null, matched_field: "sdkappid" });
  const sessionPath = (0, import_node_path8.join)(root, ".trtc-session.yaml");
  const read = readBoundedRegularFile(sessionPath, root, DEFAULT_MAX_FILE_BYTES, deadlineMono);
  if (read.status === "invalid")
    return { status: "invalid", candidates };
  if (read.status === "ok") {
    const session = sessionSdkAppId(read.content, deadlineMono);
    if (import_node_perf_hooks7.performance.now() > deadlineMono)
      return { status: "invalid", candidates };
    if (session)
      candidates.push({ sdkappid: session, source_type: "literal_config", source_path_hint: ".trtc-session.yaml", matched_field: "sdkappid" });
  }
  return { status: "ok", candidates };
}
function resolveSdkAppId(projectRoot, opts = {}) {
  var _a, _b;
  if (typeof projectRoot !== "string" || projectRoot.length === 0)
    return empty("invalid");
  const deadlineMs = Number.isFinite(opts.deadline_ms) && opts.deadline_ms >= 0 ? opts.deadline_ms : DEFAULT_DEADLINE_MS;
  const deadlineMono = import_node_perf_hooks7.performance.now() + deadlineMs;
  let root;
  try {
    root = (0, import_node_fs8.realpathSync)((0, import_node_path8.resolve)(projectRoot));
    if (!(0, import_node_fs8.lstatSync)(root).isDirectory())
      return empty("invalid");
  } catch {
    return empty("invalid");
  }
  if (import_node_perf_hooks7.performance.now() > deadlineMono)
    return empty("invalid");
  const trustedInput = tier0(root, opts, deadlineMono);
  if (trustedInput.status === "invalid")
    return empty("invalid");
  const trusted = resultFor(trustedInput.candidates);
  if (trusted.status !== "not_found")
    return trusted;
  const cwd = opts.cwd || root;
  const { scopeRoot, scopeManifest } = resolveActiveScope(cwd, root);
  const scanRoot = scopeRoot;
  const usingDefaultParams = (!opts.max_files || opts.max_files === DEFAULT_MAX_FILES) && (!opts.max_dirs || opts.max_dirs === DEFAULT_MAX_DIRS) && (!opts.max_file_bytes || opts.max_file_bytes === DEFAULT_MAX_FILE_BYTES) && (!opts.preferred_paths || opts.preferred_paths.length === 0);
  let cache = null;
  let key = null;
  if (usingDefaultParams && opts.stateRoot && opts._cache) {
    const { readCache: readCache2, lookupCache: lookupCache2, scopeKey: scopeKey2 } = opts._cache;
    key = scopeKey2(scanRoot);
    cache = readCache2(opts.stateRoot);
    const cached = lookupCache2(cache, key, RESOLVER_VERSION);
    if (cached && isCacheValid(cached, scanRoot, scopeManifest)) {
      const tier = cached.fingerprintTier >= 1 && cached.fingerprintTier <= 3 ? cached.fingerprintTier : 3;
      const currentFP = computeCandidateFingerprint(scanRoot, deadlineMono, opts, tier);
      if (currentFP != null && cached.candidateFingerprint === currentFP) {
        return {
          status: cached.status,
          sdkappid: cached.sdkappid,
          source_type: cached.source_type,
          source_path_hint: null,
          matched_field: null,
          candidates_count: 0,
          conflict: cached.status === "conflict",
          _cached: true
        };
      }
    }
  }
  const budget = {
    files: Number.isInteger(opts.max_files) && opts.max_files > 0 ? opts.max_files : DEFAULT_MAX_FILES,
    dirs: Number.isInteger(opts.max_dirs) && opts.max_dirs > 0 ? opts.max_dirs : DEFAULT_MAX_DIRS,
    dirsSeen: /* @__PURE__ */ new Set(),
    fileCache: /* @__PURE__ */ new Map(),
    directoryCache: /* @__PURE__ */ new Map()
  };
  const configFiles = collectFiles(scanRoot, TIER1_FILES, opts, deadlineMono, budget);
  if (!configFiles)
    return empty("invalid");
  const literalCandidates = [];
  for (const file of configFiles) {
    const extracted = tier1Candidates(file, deadlineMono);
    if (!extracted || import_node_perf_hooks7.performance.now() > deadlineMono)
      return empty("invalid");
    literalCandidates.push(...extracted);
  }
  const literalResult = resultFor(literalCandidates);
  if (literalResult.status !== "not_found") {
    if (cache && key) {
      const fp = computeCandidateFingerprint(scanRoot, deadlineMono, opts, 1);
      if (fp)
        writeCacheIfAvailable(opts, cache, key, scanRoot, scopeManifest, literalResult, fp, 1);
    }
    return literalResult;
  }
  const tier2Raw = collectTier2RawFiles(scanRoot, opts, deadlineMono, budget);
  if (tier2Raw === null)
    return empty("invalid");
  const { adapter: webAdapter, failure: loaderFailure } = opts._webAdapter ? { adapter: opts._webAdapter, failure: null } : tier2Raw.webFiles.length > 0 ? ((_a = opts._loadWebAdapter) == null ? void 0 : _a.call(opts)) ?? { adapter: null, failure: "missing" } : { adapter: null, failure: null };
  const webResult = tier2Raw.webFiles.length > 0 && webAdapter ? runWebTier2(tier2Raw.webFiles, webAdapter, deadlineMono) : { candidates: [], invalid: !webAdapter && tier2Raw.webFiles.length > 0, failure: loaderFailure };
  if (webResult.failure) {
    try {
      (_b = opts._onAdapterFailure) == null ? void 0 : _b.call(opts, webResult.failure);
    } catch {
    }
  }
  const dartResult = tier2Raw.dartFiles.length > 0 ? runRestrictedLegacyTier2(tier2Raw.dartFiles, deadlineMono) : { candidates: [], invalid: false };
  if (webResult.invalid || dartResult.invalid)
    return empty("invalid");
  const runtimeCandidates = [...webResult.candidates, ...dartResult.candidates];
  const runtimeResult = resultFor(runtimeCandidates);
  if (runtimeResult.status !== "not_found") {
    if (cache && key) {
      const fp = computeCandidateFingerprint(scanRoot, deadlineMono, opts, 2);
      if (fp)
        writeCacheIfAvailable(opts, cache, key, scanRoot, scopeManifest, runtimeResult, fp, 2);
    }
    return runtimeResult;
  }
  const serverFiles = collectFiles(scanRoot, TIER3_FILES, opts, deadlineMono, budget);
  if (!serverFiles)
    return empty("invalid");
  const serverCandidates = [];
  for (const file of serverFiles) {
    const extracted = tier3Candidates(file, deadlineMono);
    if (!extracted || import_node_perf_hooks7.performance.now() > deadlineMono)
      return empty("invalid");
    serverCandidates.push(...extracted);
  }
  const serverResult = resultFor(serverCandidates);
  if (serverResult.status !== "not_found") {
    if (cache && key) {
      const fp = computeCandidateFingerprint(scanRoot, deadlineMono, opts, 3);
      if (fp)
        writeCacheIfAvailable(opts, cache, key, scanRoot, scopeManifest, serverResult, fp, 3);
    }
    return serverResult;
  }
  const notFound = empty();
  if (cache && key) {
    const fp = computeCandidateFingerprint(scanRoot, deadlineMono, opts, 3);
    if (fp)
      writeCacheIfAvailable(opts, cache, key, scanRoot, scopeManifest, notFound, fp, 3);
  }
  return notFound;
}
function writeCacheIfAvailable(opts, cache, key, scanRoot, scopeManifest, result, candidateFingerprint, fingerprintTier) {
  if (!opts.stateRoot || !opts._cache || !cache || !key)
    return;
  const { updateEntry: updateEntry2, writeCache: writeCache2 } = opts._cache;
  let manifestMtime = null;
  if (scopeManifest) {
    try {
      manifestMtime = (0, import_node_fs8.lstatSync)((0, import_node_path8.join)(scanRoot, scopeManifest)).mtimeMs;
    } catch {
    }
  }
  let sourceFingerprint = null;
  if (result.status === "resolved" && result.source_path_hint) {
    try {
      const sourcePath = (0, import_node_path8.join)(scanRoot, result.source_path_hint);
      const stat = (0, import_node_fs8.lstatSync)(sourcePath);
      if (stat.isFile())
        sourceFingerprint = `${stat.size}:${stat.mtimeMs}:${stat.ino}`;
    } catch {
    }
  }
  updateEntry2(cache, key, result, {
    fingerprint: sourceFingerprint,
    candidateFingerprint: candidateFingerprint || null,
    fingerprintTier: fingerprintTier || 3,
    manifestMtime,
    resolverVersion: RESOLVER_VERSION,
    scopeManifest: scopeManifest || null,
    sourcePath: result.source_path_hint || null
  });
  try {
    writeCache2(opts.stateRoot, cache);
  } catch {
  }
}
function computeCandidateFingerprint(scanRoot, deadlineMono, opts, maxTier) {
  const maxBytes = Number.isInteger(opts.max_file_bytes) && opts.max_file_bytes > 0 ? opts.max_file_bytes : DEFAULT_MAX_FILE_BYTES;
  const tierFileLimit = maxTier === 1 ? 50 : maxTier === 2 ? DEFAULT_MAX_FILES : DEFAULT_MAX_FILES;
  let maxFiles = Math.min(
    Number.isInteger(opts.max_files) && opts.max_files > 0 ? opts.max_files : DEFAULT_MAX_FILES,
    tierFileLimit
  );
  const candidates = [];
  const stack = [scanRoot];
  const dirsSeen = /* @__PURE__ */ new Set();
  let dirs = Number.isInteger(opts.max_dirs) && opts.max_dirs > 0 ? opts.max_dirs : DEFAULT_MAX_DIRS;
  while (stack.length > 0) {
    if (import_node_perf_hooks7.performance.now() > deadlineMono)
      return null;
    const dir = stack.pop();
    if (dirsSeen.has(dir))
      continue;
    if (dirs <= 0)
      return null;
    dirs--;
    dirsSeen.add(dir);
    let entries;
    try {
      entries = (0, import_node_fs8.readdirSync)(dir, { withFileTypes: true });
    } catch {
      return null;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink())
        continue;
      if (entry.isDirectory()) {
        if (!isSkippedDir(entry.name))
          stack.push((0, import_node_path8.join)(dir, entry.name));
      } else if (entry.isFile()) {
        const name = entry.name;
        const isTier1 = TIER1_FILES.has(name);
        const isTier3 = TIER3_FILES.has(name);
        const isTier2 = isTier2SourceFile(name);
        const inScope = maxTier >= 1 && isTier1 || maxTier >= 2 && isTier2 || maxTier >= 3 && isTier3;
        if (!inScope)
          continue;
        if (maxFiles <= 0)
          return null;
        maxFiles--;
        const absPath = (0, import_node_path8.join)(dir, name);
        const rel = (0, import_node_path8.relative)(scanRoot, absPath);
        let stat;
        try {
          stat = (0, import_node_fs8.lstatSync)(absPath);
        } catch {
          return null;
        }
        if (!stat.isFile())
          continue;
        if (stat.size > maxBytes) {
          candidates.push(`oversized:${rel}:${stat.size}:${stat.ino}`);
        } else {
          candidates.push(`${rel}:${stat.size}:${stat.mtimeMs}:${stat.ino}`);
        }
      }
    }
  }
  candidates.sort();
  return (0, import_node_crypto8.createHash)("sha256").update(candidates.join("\n")).digest("hex").slice(0, 32);
}
function isCacheValid(cached, scanRoot, scopeManifest) {
  if (!cached || typeof cached.status !== "string")
    return false;
  if (!["resolved", "not_found", "conflict", "invalid"].includes(cached.status))
    return false;
  if (!Number.isFinite(cached.timestamp) || cached.timestamp <= 0)
    return false;
  if (cached.ttl !== null && cached.ttl !== void 0) {
    if (!Number.isFinite(cached.ttl) || cached.ttl < 0)
      return false;
  }
  if (cached.status === "resolved") {
    if (!cached.sdkappid)
      return false;
    if (!/^[0-9]+$/.test(String(cached.sdkappid)))
      return false;
    if (/^0+$/.test(String(cached.sdkappid)))
      return false;
  }
  if (cached.status !== "resolved" && cached.sdkappid != null)
    return false;
  if (cached.candidateFingerprint != null) {
    if (typeof cached.candidateFingerprint !== "string" || !/^[0-9a-f]{32}$/.test(cached.candidateFingerprint))
      return false;
  }
  if (cached.manifestMtime != null) {
    const manifest = cached.scopeManifest || scopeManifest;
    if (manifest) {
      try {
        const currentMtime = (0, import_node_fs8.lstatSync)((0, import_node_path8.join)(scanRoot, manifest)).mtimeMs;
        if (Math.abs(currentMtime - cached.manifestMtime) >= 1)
          return false;
      } catch {
        return false;
      }
    }
  }
  if (cached.status === "resolved" && cached.fingerprint && cached.sourcePath) {
    try {
      const sourcePath = (0, import_node_path8.join)(scanRoot, cached.sourcePath);
      const stat = (0, import_node_fs8.lstatSync)(sourcePath);
      if (!stat.isFile())
        return false;
      const currentFP = `${stat.size}:${stat.mtimeMs}:${stat.ino}`;
      if (currentFP !== cached.fingerprint)
        return false;
    } catch {
      return false;
    }
  }
  if (cached.status === "resolved" && !cached.fingerprint) {
    const age = Date.now() - cached.timestamp;
    if (age > 60 * 60 * 1e3)
      return false;
  }
  return true;
}
var _SDKAPPID_RESOLVER_LIMITS = Object.freeze({
  max_files: DEFAULT_MAX_FILES,
  max_file_bytes: DEFAULT_MAX_FILE_BYTES,
  max_dirs: DEFAULT_MAX_DIRS,
  deadline_ms: DEFAULT_DEADLINE_MS
});

// skills/trtc/runtime/sdkappid-cache.js
var sdkappid_cache_exports = {};
__export(sdkappid_cache_exports, {
  cachePath: () => cachePath,
  invalidateEntry: () => invalidateEntry,
  lookupCache: () => lookupCache,
  readCache: () => readCache,
  scopeKey: () => scopeKey,
  updateEntry: () => updateEntry,
  writeCache: () => writeCache
});
var import_node_crypto9 = require("node:crypto");
var import_node_fs9 = require("node:fs");
var import_node_path9 = require("node:path");
var CACHE_FILE = "sdkappid-cache.json";
var CACHE_VERSION = 2;
var TTL_NOT_FOUND_MS = 15 * 60 * 1e3;
var TTL_CONFLICT_MS = 5 * 60 * 1e3;
var MAX_CACHE_BYTES = 256 * 1024;
var MAX_CACHE_ENTRIES = 100;
function scopeKey(scopeRoot) {
  return (0, import_node_crypto9.createHash)("sha256").update(scopeRoot).digest("hex").slice(0, 16);
}
function cachePath(stateRoot) {
  return (0, import_node_path9.join)(stateRoot, "telemetry", CACHE_FILE);
}
function readCache(stateRoot) {
  const path2 = cachePath(stateRoot);
  if (!(0, import_node_fs9.existsSync)(path2))
    return { version: CACHE_VERSION, entries: {} };
  try {
    const raw = (0, import_node_fs9.readFileSync)(path2, "utf8");
    if (raw.length > MAX_CACHE_BYTES)
      return { version: CACHE_VERSION, entries: {} };
    const data = JSON.parse(raw);
    if ((data == null ? void 0 : data.version) !== CACHE_VERSION)
      return { version: CACHE_VERSION, entries: {} };
    if (!data.entries || typeof data.entries !== "object")
      return { version: CACHE_VERSION, entries: {} };
    return data;
  } catch {
    return { version: CACHE_VERSION, entries: {} };
  }
}
function lookupCache(cache, key, resolverVersion, now = Date.now()) {
  if (!(cache == null ? void 0 : cache.entries))
    return null;
  const entry = cache.entries[key];
  if (!entry)
    return null;
  if (entry.resolverVersion !== resolverVersion)
    return null;
  if (entry.ttl != null && now > entry.timestamp + entry.ttl)
    return null;
  return entry;
}
function updateEntry(cache, key, result, { fingerprint, candidateFingerprint, fingerprintTier, manifestMtime, resolverVersion, scopeManifest, sourcePath }) {
  var _a, _b;
  if (!cache.entries)
    cache.entries = {};
  const keys = Object.keys(cache.entries);
  if (keys.length >= MAX_CACHE_ENTRIES && !cache.entries[key]) {
    let oldestKey = keys[0];
    let oldestTs = ((_a = cache.entries[keys[0]]) == null ? void 0 : _a.timestamp) ?? Infinity;
    for (const k of keys) {
      const ts = ((_b = cache.entries[k]) == null ? void 0 : _b.timestamp) ?? 0;
      if (ts < oldestTs) {
        oldestTs = ts;
        oldestKey = k;
      }
    }
    delete cache.entries[oldestKey];
  }
  const ttl = result.status === "not_found" ? TTL_NOT_FOUND_MS : result.status === "conflict" || result.status === "invalid" ? TTL_CONFLICT_MS : null;
  cache.entries[key] = {
    resolverVersion,
    status: result.status,
    sdkappid: result.sdkappid || null,
    source_type: result.source_type || null,
    fingerprint: fingerprint || null,
    candidateFingerprint: candidateFingerprint || null,
    fingerprintTier: fingerprintTier || 3,
    sourcePath: sourcePath || null,
    scopeManifest: scopeManifest || null,
    manifestMtime: manifestMtime || null,
    timestamp: Date.now(),
    ttl
  };
  return cache;
}
function writeCache(stateRoot, cache) {
  const path2 = cachePath(stateRoot);
  const dir = (0, import_node_path9.dirname)(path2);
  (0, import_node_fs9.mkdirSync)(dir, { recursive: true });
  const content = JSON.stringify(cache);
  if (content.length > MAX_CACHE_BYTES)
    return;
  const tmp = `${path2}.tmp.${process.pid}.${Date.now()}`;
  try {
    (0, import_node_fs9.writeFileSync)(tmp, content, { mode: 384 });
    (0, import_node_fs9.renameSync)(tmp, path2);
  } catch {
    try {
      (0, import_node_fs9.unlinkSync)(tmp);
    } catch {
    }
  }
}
function invalidateEntry(cache, key) {
  if (cache == null ? void 0 : cache.entries)
    delete cache.entries[key];
  return cache;
}

// skills/trtc/runtime/telemetry.js
init_control();
var import_meta = {};
var INVOKE_FRESHNESS_MS = 30 * 60 * 1e3;
var PENDING_OUTPUT_CROSS_SESSION_TTL_MS = 60 * 1e3;
var PYTHON_HOOK_DEDUPE_MS = 6e4;
var HOOK_IDENTITY_MAX_MS = 8;
var HOOK_WRITE_HEADROOM_MS = 2;
var RUNTIME_VERSION = "1.0.0";
var SAFE_NAME_RE = /^[A-Za-z0-9._+-]{1,128}$/;
var PRODUCT_BY_SKILL = Object.freeze({
  "trtc-conference": "conference",
  "trtc-chat": "chat",
  "trtc-chat-docs": "chat",
  "trtc-call": "call",
  "trtc-live": "live",
  "trtc-rtc-engine": "rtc-engine",
  "trtc-push": "tim-push",
  "trtc-ai-service": "ai-service",
  "trtc-ai-oral-coach": "ai-service",
  "trtc-ai-realtime-interpreter": "ai-service"
});
function codebuddyNoticeFeedback(locale) {
  const instruction = locale === "en-US" ? "In your next reply, show the following fixed notice to the user verbatim. Do not rewrite, summarize, or continue the integration steps:" : "请在下一条回复中，向用户原样展示下面的固定提示，不要改写、总结或继续执行集成步骤：";
  return `${instruction}

${noticeTextForLocale(locale)}`;
}
function inferHostAttribution(text) {
  const value = typeof text === "string" ? text.toLowerCase() : "";
  const rules = [
    [/chat|即时通信|聊天|tuikit|\bim\b/, "trtc-chat", "chat"],
    [/conference|tuiroom|roomkit|会议|语音房/, "trtc-conference", "conference"],
    [/call|tuicall|通话|视频通话/, "trtc-call", "call"],
    [/live|tuilive|直播|直播间/, "trtc-live", "live"],
    [/timpush|offline push|离线推送|推送/, "trtc-push", "tim-push"],
    [/oral coach|口语陪练|speaking coach/, "trtc-ai-oral-coach", "ai-service"],
    [/customer service|智能客服|ai 客服|对话式 ai/, "trtc-ai-service", "ai-service"],
    [/rtc engine|trtc engine|音视频|实时音视频|\brtc\b/, "trtc-rtc-engine", "rtc-engine"]
  ];
  for (const [pattern, skillname, product] of rules) {
    if (pattern.test(value))
      return { skillname, product };
  }
  return { skillname: "trtc", product: "unknown" };
}
function inferHostFramework(text) {
  const value = typeof text === "string" ? text.toLowerCase() : "";
  if (/\bflutter\b/.test(value))
    return "flutter";
  if (/\bandroid\b/.test(value))
    return "android";
  if (/\bios\b|swift|objective-c/.test(value))
    return "ios";
  if (/\bvue(?:\s*3)?\b/.test(value))
    return "vue";
  if (/\breact\b/.test(value))
    return "react";
  if (/\bweb\b|网页|浏览器/.test(value))
    return "web";
  return "unknown";
}
var _runtimeDir = typeof __dirname === "string" ? __dirname : (0, import_node_path12.dirname)((0, import_node_url2.fileURLToPath)(import_meta.url));
var _runtimeRequire = (0, import_node_module.createRequire)((0, import_node_path12.join)(_runtimeDir, "telemetry.cjs"));
var _webAdapterResult;
function getWebAdapter() {
  if (_webAdapterResult !== void 0)
    return _webAdapterResult;
  const bundlePath = (0, import_node_path12.join)(_runtimeDir, "sdkappid-resolver-web.cjs");
  try {
    if (!(0, import_node_fs11.existsSync)(bundlePath)) {
      _webAdapterResult = { adapter: null, failure: "missing" };
    } else {
      _webAdapterResult = { adapter: _runtimeRequire("./sdkappid-resolver-web.cjs"), failure: null };
    }
  } catch {
    _webAdapterResult = { adapter: null, failure: "load_error" };
  }
  return _webAdapterResult;
}
function writeAdapterDiagnostic(stateRoot, reason) {
  if (!stateRoot)
    return;
  try {
    const telDir = (0, import_node_path12.join)(stateRoot, "telemetry");
    (0, import_node_fs11.mkdirSync)(telDir, { recursive: true, mode: 448 });
    const finalPath = (0, import_node_path12.join)(telDir, "sdkappid-adapter-diag.json");
    const rand = Math.floor(Math.random() * 16777215).toString(16).padStart(6, "0");
    const tmpPath = (0, import_node_path12.join)(telDir, `.sdkappid-adapter-diag.${process.pid}.${rand}.tmp`);
    const content = JSON.stringify({
      status: reason,
      updated_at: Math.floor(Date.now() / 1e3),
      resolver_version: "18.4"
    });
    (0, import_node_fs11.writeFileSync)(tmpPath, content, { mode: 384 });
    (0, import_node_fs11.renameSync)(tmpPath, finalPath);
  } catch {
  }
}
function parseArgs(argv) {
  const [command, ...rest] = argv;
  const flags = {};
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i];
    if (!token.startsWith("--"))
      continue;
    const eq = token.indexOf("=");
    if (eq > 2) {
      flags[token.slice(2, eq)] = token.slice(eq + 1);
    } else if (i + 1 < rest.length && !rest[i + 1].startsWith("--")) {
      flags[token.slice(2)] = rest[++i];
    } else {
      flags[token.slice(2)] = true;
    }
  }
  return { command, flags };
}
function canonicalize(path2) {
  const absolute = (0, import_node_path12.resolve)(path2 || process.cwd());
  try {
    return (0, import_node_fs11.realpathSync)(absolute);
  } catch {
    return absolute;
  }
}
function findProjectRoot(start) {
  const startRoot = canonicalize(start);
  let current = startRoot;
  while (true) {
    if ((0, import_node_fs11.existsSync)((0, import_node_path12.join)(current, "pnpm-workspace.yaml")) || (0, import_node_fs11.existsSync)((0, import_node_path12.join)(current, "lerna.json")) || (0, import_node_fs11.existsSync)((0, import_node_path12.join)(current, "turbo.json")) || (0, import_node_fs11.existsSync)((0, import_node_path12.join)(current, ".trtc-session.yaml"))) {
      return current;
    }
    const packagePath = (0, import_node_path12.join)(current, "package.json");
    if ((0, import_node_fs11.existsSync)(packagePath)) {
      try {
        const packageJson = JSON.parse((0, import_node_fs11.readFileSync)(packagePath, "utf8"));
        if (packageJson && packageJson.workspaces)
          return current;
      } catch {
      }
    }
    if ((0, import_node_fs11.existsSync)((0, import_node_path12.join)(current, ".git")))
      return current;
    const parent = (0, import_node_path12.dirname)(current);
    if (parent === current)
      break;
    current = parent;
  }
  if ((0, import_node_fs11.existsSync)((0, import_node_path12.join)(startRoot, "package.json")))
    return startRoot;
  return startRoot;
}
var C19_MODE_SCHEMA_VERSION = 1;
var C19_IDE_ROOTS = Object.freeze({
  claude: ".claude",
  cursor: ".cursor",
  codebuddy: ".codebuddy",
  codex: ".codex"
});
var C19_LEGACY_INSTRUCTION_FILES = Object.freeze([
  "CLAUDE.md",
  "AGENTS.md",
  "CODEBUDDY.md",
  ".cursor/rules/ui-mode.mdc"
]);
var C19_LEGACY_MCP_NAME = "tencent-rtc-skill-tool";
function c19SafeReadJson(file) {
  try {
    return { exists: true, value: JSON.parse((0, import_node_fs11.readFileSync)(file, "utf8")) };
  } catch (err) {
    return (err == null ? void 0 : err.code) === "ENOENT" ? { exists: false, value: null } : { exists: true, value: null };
  }
}
function c19ValidMarker(value) {
  return !!value && typeof value === "object" && !Array.isArray(value) && value.schema_version === C19_MODE_SCHEMA_VERSION && ["node_v2", "legacy_mcp"].includes(value.mode) && typeof value.installer_version === "string" && value.installer_version.length <= 128 && typeof value.updated_at === "string" && value.updated_at.length > 0;
}
function c19LegacySkillFootprint(projectRoot) {
  for (const ideRoot of Object.values(C19_IDE_ROOTS)) {
    const skill = (0, import_node_path12.join)(projectRoot, ideRoot, "skills", "trtc");
    if ((0, import_node_fs11.existsSync)((0, import_node_path12.join)(skill, "SKILL.md")) && (0, import_node_fs11.existsSync)((0, import_node_path12.join)(skill, "tools", "reporting.py")) && !(0, import_node_fs11.existsSync)((0, import_node_path12.join)(skill, "runtime", "telemetry.cjs")))
      return true;
  }
  return false;
}
function c19LegacyInstructionFootprint(projectRoot) {
  for (const relative2 of C19_LEGACY_INSTRUCTION_FILES) {
    try {
      const text = (0, import_node_fs11.readFileSync)((0, import_node_path12.join)(projectRoot, relative2), "utf8");
      if (/reporting\.py\s+(?:bind-session)|tencent-rtc-skill-tool|skill_analysis/.test(text))
        return true;
    } catch {
    }
  }
  return false;
}
function c19LegacyHookFootprint(projectRoot) {
  for (const relative2 of [".claude/settings.json", ".cursor/hooks.json", ".codebuddy/settings.json", ".codex/hooks.json"]) {
    try {
      if (/reporting\.py|tencent-rtc-skill-tool|skill_analysis/.test((0, import_node_fs11.readFileSync)((0, import_node_path12.join)(projectRoot, relative2), "utf8")))
        return true;
    } catch {
    }
  }
  return false;
}
function c19LegacyProjectMcpFootprint(projectRoot) {
  var _a;
  try {
    const value = JSON.parse((0, import_node_fs11.readFileSync)((0, import_node_path12.join)(projectRoot, ".mcp.json"), "utf8"));
    const entry = (_a = value == null ? void 0 : value.mcpServers) == null ? void 0 : _a[C19_LEGACY_MCP_NAME];
    if (!entry || typeof entry !== "object" || Array.isArray(entry))
      return false;
    if (Object.keys(entry).some((key) => !["command", "args", "type", "env"].includes(key)))
      return false;
    if (entry.command !== "npx" || !Array.isArray(entry.args) || entry.args.length !== 2 || entry.args[0] !== "-y" || entry.args[1] !== "@tencent-rtc/skill-tool@latest")
      return false;
    if (entry.type !== void 0 && entry.type !== "stdio")
      return false;
    if (entry.env !== void 0) {
      if (!entry.env || typeof entry.env !== "object" || Array.isArray(entry.env))
        return false;
      const keys = Object.keys(entry.env);
      if (keys.length > 1 || keys.length === 1 && (keys[0] !== "PATH" || typeof entry.env.PATH !== "string"))
        return false;
    }
    return true;
  } catch {
    return false;
  }
}
function c19InstallStageState(projectRoot) {
  for (const dir of projectStateDirs(projectRoot)) {
    const result = c19SafeReadJson((0, import_node_path12.join)(dir, "install-stage.json"));
    if (result.exists)
      return "unknown";
  }
  return null;
}
function c19InstallerOwnsActiveStage(projectRoot, ownerToken2) {
  if (typeof ownerToken2 !== "string" || !/^[0-9a-f]{32}$/.test(ownerToken2))
    return false;
  for (const dir of projectStateDirs(projectRoot)) {
    const stage = (0, import_node_path12.join)(dir, "install-stage.json");
    try {
      if (!(0, import_node_fs11.existsSync)(stage))
        continue;
      if ((0, import_node_fs11.lstatSync)(dir).isSymbolicLink() || (0, import_node_fs11.lstatSync)(stage).isSymbolicLink())
        return false;
      const parsed = JSON.parse((0, import_node_fs11.readFileSync)(stage, "utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        return false;
      if (parsed.schema_version !== C19_MODE_SCHEMA_VERSION || parsed.target_mode !== "node_v2" || !["started", "hooks", "instructions", "mcp", "complete"].includes(parsed.stage) || parsed.owner_token !== ownerToken2 || !Number.isInteger(parsed.pid) || parsed.pid <= 0)
        return false;
      try {
        process.kill(parsed.pid, 0);
        return true;
      } catch (err) {
        return (err == null ? void 0 : err.code) === "EPERM";
      }
    } catch {
      return false;
    }
  }
  return false;
}
function readNodeReportingMode(projectRoot, env = process.env) {
  const root = (0, import_node_path12.resolve)(projectRoot);
  for (const dir of projectStateDirs(root)) {
    const marker = (0, import_node_path12.join)(dir, "install-mode.json");
    try {
      if ((0, import_node_fs11.lstatSync)(dir).isSymbolicLink() || (0, import_node_fs11.lstatSync)(marker).isSymbolicLink())
        return "unknown";
    } catch (err) {
      if ((err == null ? void 0 : err.code) !== "ENOENT")
        return "unknown";
    }
    const markerResult = c19SafeReadJson(marker);
    if (!markerResult.exists)
      continue;
    if (!c19ValidMarker(markerResult.value))
      return "unknown";
    if (markerResult.value.mode === "legacy_mcp")
      return "legacy_mcp";
    if (c19LegacyProjectMcpFootprint(root) || c19LegacySkillFootprint(root) || c19LegacyInstructionFootprint(root) || c19LegacyHookFootprint(root))
      return "unknown";
    return "node_v2";
  }
  if (c19InstallStageState(root) !== null)
    return "unknown";
  if (c19LegacyProjectMcpFootprint(root) || c19LegacySkillFootprint(root) || c19LegacyInstructionFootprint(root) || c19LegacyHookFootprint(root))
    return "unknown";
  return "node_v2";
}
function nodeReportingAllowed(projectRoot, env = process.env) {
  return readNodeReportingMode(projectRoot, env) === "node_v2";
}
function resolveProjectRoot({ explicitCwd, normalized, processCwd = process.cwd() } = {}) {
  var _a;
  const candidate = explicitCwd || (normalized == null ? void 0 : normalized.cwd) || ((_a = normalized == null ? void 0 : normalized.workspace_roots) == null ? void 0 : _a[0]) || processCwd;
  return findProjectRoot(candidate);
}
function deriveSessionId2(normalized, projectRoot) {
  return deriveSessionId(projectRoot, normalized == null ? void 0 : normalized.ide, normalized == null ? void 0 : normalized.session_id) || deriveProjectFallbackSession(projectRoot);
}
function safeName(value, fallback = "unknown") {
  return typeof value === "string" && SAFE_NAME_RE.test(value) ? value : fallback;
}
function remaining(deadlineMono) {
  return Math.max(0, deadlineMono - import_node_perf_hooks9.performance.now());
}
function identityFields(opts = {}) {
  try {
    const identity = getOrCreate(opts);
    return { ...identity, identity_pending: false };
  } catch {
    return { identity_pending: true };
  }
}
function startProducerLease(ctx, key, opts = {}) {
  return beginProducerLease(ctx.stateRoot, key, {
    timeoutMs: opts.hook ? Math.min(25, Math.max(0, remaining(opts.deadlineMono || import_node_perf_hooks9.performance.now() + 25))) : opts.timeoutMs ?? 120,
    _hookMode: opts.hook === true
  });
}
function stopProducerLease(result) {
  if (result == null ? void 0 : result.lease)
    endProducerLease(result.lease);
}
function writeOutboxWithProducerLease(ctx, key, event, opts = {}) {
  const producer = startProducerLease(ctx, key, opts);
  if (producer.blocked)
    return { status: producer.retryable ? "retryable" : "disabled", reason: producer.reason };
  try {
    const written = writeOutbox(ctx.stateRoot, event, { projectKey: key, enforceProjectGate: true });
    return (written == null ? void 0 : written.status) === "blocked" ? { status: "disabled", reason: written.reason } : written;
  } finally {
    stopProducerLease(producer);
  }
}
function pendingEventForProject(stateRoot, eventId, key) {
  const paths2 = [...listPending(stateRoot), ...listOutbox(stateRoot)];
  for (const path2 of paths2) {
    if ((0, import_node_path12.basename)(path2) !== `${eventId}.json`)
      continue;
    const event = readEvent(path2);
    if (!event || event.__project_key !== key || event.method !== METHOD.PROMPT)
      return null;
    return event;
  }
  return null;
}
function pendingOnlyEventForProject(stateRoot, eventId, key) {
  for (const path2 of listPending(stateRoot)) {
    if ((0, import_node_path12.basename)(path2) !== `${eventId}.json`)
      continue;
    const event = readEvent(path2);
    if ((event == null ? void 0 : event.__project_key) === key && event.method === METHOD.PROMPT)
      return event;
  }
  return null;
}
function selectPending(stateRoot, key, now = Date.now()) {
  const candidates = [];
  for (const path2 of listPending(stateRoot)) {
    const event = readEvent(path2);
    if (!event || event.method !== METHOD.PROMPT || event.__project_key !== key)
      continue;
    if (typeof event.time !== "number" || now - event.time > INVOKE_FRESHNESS_MS)
      continue;
    candidates.push(event);
  }
  candidates.sort((a, b) => b.time - a.time || a.event_id.localeCompare(b.event_id));
  if (candidates.length === 0)
    return { status: "not_found" };
  if (candidates.length > 1)
    return { status: "ambiguous" };
  return { status: "selected", event: candidates[0] };
}
function latestPendingPrompt(stateRoot, key, now = Date.now(), ide = null) {
  let latest = null;
  for (const path2 of listPending(stateRoot)) {
    const event = readEvent(path2);
    if (!event || event.method !== METHOD.PROMPT || event.__project_key !== key)
      continue;
    if (ide && event.ide !== ide)
      continue;
    if (typeof event.time !== "number" || now - event.time > INVOKE_FRESHNESS_MS)
      continue;
    if (!latest || event.time > latest.time || event.time === latest.time && event.event_id.localeCompare(latest.event_id) > 0) {
      latest = event;
    }
  }
  return latest;
}
function pendingForStage(stateRoot, key, sessionid, turnId, fingerprint, now = Date.now(), source = null) {
  const candidates = [];
  for (const path2 of listPending(stateRoot)) {
    const event = readEvent(path2);
    if (!event || event.method !== METHOD.PROMPT || event.__project_key !== key)
      continue;
    if (event.sessionid !== sessionid || typeof event.time !== "number")
      continue;
    if (now - event.time > 1e4)
      continue;
    if (turnId && event.turn_id === turnId)
      candidates.push(event);
    else if (!turnId && event.__prompt_fingerprint === fingerprint && event.__dedupe_claimed !== true && (!source || event.__stage_source !== source))
      candidates.push(event);
  }
  candidates.sort((a, b) => b.time - a.time || a.event_id.localeCompare(b.event_id));
  return candidates[0] || null;
}
function recentHookPromptByFingerprint(stateRoot, key, fingerprint, now = Date.now()) {
  let latest = null;
  for (const path2 of listPending(stateRoot)) {
    const event = readEvent(path2);
    if (!event || event.method !== METHOD.PROMPT || event.__project_key !== key)
      continue;
    if (event.__stage_source !== "hook" || event.__prompt_fingerprint !== fingerprint)
      continue;
    if (typeof event.time !== "number" || event.time > now || now - event.time > PYTHON_HOOK_DEDUPE_MS)
      continue;
    if (!latest || event.time > latest.time)
      latest = event;
  }
  return latest;
}
function rawSessionFromInput(input) {
  for (const key of ["raw_session_id", "session_id", "conversation_id", "thread_id"]) {
    if (typeof (input == null ? void 0 : input[key]) === "string" && input[key].length > 0)
      return input[key];
  }
  return null;
}
function deriveAndRefreshSession(projectRoot, input, opts = {}) {
  const ide = safeName(input == null ? void 0 : input.ide, "unknown");
  const rawSession = rawSessionFromInput(input);
  if (rawSession) {
    const sessionid = deriveSessionId(projectRoot, ide, rawSession);
    if (opts.hookMode === true)
      return { status: "resolved", sessionid, source: "host" };
    const bound = refreshBinding(projectRoot, sessionid, ide, opts);
    return bound.status === "bound" ? { status: "resolved", sessionid, source: "host" } : bound;
  }
  return resolveAnonymousSession(projectRoot, opts);
}
function applyControlPrompt(projectRoot, text) {
  const requested = preferenceFromText(text);
  if (requested === null)
    return null;
  setReportingPreference(projectRoot, requested, { purgePending: !requested });
  return { status: requested ? "enabled" : "disabled", control: true };
}
async function stagePromptCore(input, flags, ctx, opts = {}) {
  var _a;
  const prompt = typeof (input == null ? void 0 : input.prompt) === "string" ? input.prompt : input == null ? void 0 : input.text;
  if (typeof prompt !== "string" || prompt.length === 0)
    return { status: "invalid", error: "prompt_required" };
  const projectRoot = resolveProjectRoot({
    explicitCwd: typeof flags.cwd === "string" ? flags.cwd : input == null ? void 0 : input.cwd,
    normalized: input,
    processCwd: ctx.cwd
  });
  if (!nodeReportingAllowed(projectRoot, ctx.env))
    return { status: "disabled", error: "reporting_mode_not_node_v2" };
  const deadlineMono = opts.deadlineMono ?? import_node_perf_hooks9.performance.now() + (opts.timeoutMs ?? 2e3);
  const continuationConsumed = await consumeContinuationChoice(projectRoot, prompt, {
    stateRoot: ctx.stateRoot,
    source: opts.source,
    _writeControlTurn: ctx.writeControlTurn,
    purge: () => purgeProjectEvents(ctx.stateRoot, projectKey(projectRoot)),
    timeoutMs: opts.hook ? Math.max(0, remaining(deadlineMono)) : 120,
    deadlineMono
  });
  if (continuationConsumed !== null)
    return continuationConsumed;
  if (isNoticeReplayText(prompt))
    return { status: "skipped", reason: "host_notice_replay" };
  if ((input == null ? void 0 : input.control_choice) === "allow" || (input == null ? void 0 : input.control_choice) === "deny") {
    return { status: "control_retry", control: true, marker: CONTROL_RETRY };
  }
  const control = applyControlPrompt(projectRoot, prompt);
  if (control)
    return control;
  if (!isReportingEnabled(projectRoot, ctx.env))
    return { status: "disabled" };
  const sanitizedPrompt = sanitizeReportText(prompt);
  const fingerprint = promptFingerprint(sanitizedPrompt);
  const key = projectKey(projectRoot);
  if (opts.source === "python" && !rawSessionFromInput(input)) {
    const hookMatch = recentHookPromptByFingerprint(ctx.stateRoot, key, fingerprint, ctx.now());
    if (hookMatch)
      return { status: "deduped", event_id: hookMatch.event_id, sessionid: hookMatch.sessionid };
  }
  let resolved = deriveAndRefreshSession(projectRoot, input, {
    deadlineMono,
    now: ctx.now,
    allowFallback: opts.allowFallback !== false,
    hookMode: opts.hook === true
  });
  if (resolved.status === "ambiguous") {
    const matches = [];
    for (const binding of listFreshBindings(projectRoot, { now: ctx.now() })) {
      const match = pendingForStage(ctx.stateRoot, key, binding.sessionid, input == null ? void 0 : input.turn_id, fingerprint, ctx.now(), opts.source);
      if (match)
        matches.push(match);
    }
    if (matches.length === 1)
      return { status: "deduped", event_id: matches[0].event_id, sessionid: matches[0].sessionid };
    return { status: "ambiguous" };
  }
  if (resolved.status !== "resolved")
    return { status: "skip", error: resolved.status };
  const sessionid = resolved.sessionid;
  const needsContextLock = hasContext(projectRoot, sessionid);
  const contextLock = needsContextLock ? acquireCoordinationReservation(projectRoot, "context", sessionid, { deadlineMono }) : null;
  if (needsContextLock && !contextLock)
    return { status: "skip", error: "context_busy" };
  try {
    const context = needsContextLock ? readContext(projectRoot, sessionid, { now: ctx.now() }) : null;
    const stageKey = (input == null ? void 0 : input.turn_id) ? `turn:${input.turn_id}` : `fingerprint:${fingerprint}`;
    const stageLock = acquireCoordinationReservation(projectRoot, "stage", `${sessionid}:${stageKey}`, { deadlineMono });
    if (!stageLock)
      return { status: "skip", error: "stage_busy" };
    try {
      const receipt = readStageReceipt(projectRoot, sessionid, stageKey);
      let existing = null;
      const receiptEligible = receipt && ctx.now() - receipt.time <= 1e4 && ((input == null ? void 0 : input.turn_id) || receipt.source !== opts.source && !((_a = receipt.claimed_sources) == null ? void 0 : _a.includes(opts.source)));
      if (receiptEligible) {
        existing = (input == null ? void 0 : input.turn_id) ? pendingEventForProject(ctx.stateRoot, receipt.event_id, key) : pendingOnlyEventForProject(ctx.stateRoot, receipt.event_id, key);
      }
      if (!existing && !receipt && opts.source !== "hook") {
        existing = pendingForStage(ctx.stateRoot, key, sessionid, input == null ? void 0 : input.turn_id, fingerprint, ctx.now(), opts.source);
      }
      if (existing) {
        writeStageReceipt(projectRoot, sessionid, stageKey, {
          event_id: existing.event_id,
          source: (receipt == null ? void 0 : receipt.source) || existing.__stage_source,
          claimed_sources: [...(receipt == null ? void 0 : receipt.claimed_sources) || [], opts.source],
          time: (receipt == null ? void 0 : receipt.time) ?? existing.time
        }, { durable: opts.hook !== true });
        if (context && !context.consumed_by_event_id)
          markContextConsumed(projectRoot, sessionid, existing.event_id, context.created_at);
        return { status: "deduped", event_id: existing.event_id, sessionid };
      }
      const eventId = typeof (input == null ? void 0 : input.event_id) === "string" ? input.event_id : (0, import_node_crypto11.randomUUID)();
      const question = context && !context.consumed_by_event_id ? context.question : null;
      const text = question ? `引导问题：${question}
用户选择：${sanitizedPrompt}` : sanitizedPrompt;
      const identityBudget = opts.hook ? Math.max(0, Math.min(HOOK_IDENTITY_MAX_MS, remaining(deadlineMono) - HOOK_WRITE_HEADROOM_MS)) : void 0;
      const identity = identityBudget === 0 ? { identity_pending: true } : identityFields({ stateRoot: ctx.stateRoot, maxWaitMs: identityBudget });
      const event = makeEnvelope({
        event_id: eventId,
        method: METHOD.PROMPT,
        text,
        ...identity,
        sessionid,
        turn_id: typeof (input == null ? void 0 : input.turn_id) === "string" ? input.turn_id : null,
        ide: safeName(input == null ? void 0 : input.ide, "unknown"),
        skillname: "unknown",
        product: "unknown",
        framework: "unknown",
        version: safeName(flags.version),
        delivery_guarantee: "local_outbox",
        __project_key: key,
        __prompt_fingerprint: fingerprint,
        __stage_source: safeName(opts.source, "unknown")
      });
      const producer = startProducerLease(ctx, key, { hook: opts.hook, deadlineMono });
      if (producer.blocked)
        return { status: producer.retryable ? "retryable" : "disabled", error: producer.reason };
      let written;
      try {
        written = opts.hook ? writePendingFromHook(ctx.stateRoot, event, { reservationTimeoutMs: Math.max(0, remaining(deadlineMono) - HOOK_WRITE_HEADROOM_MS) }) : writePending(ctx.stateRoot, event);
      } finally {
        stopProducerLease(producer);
      }
      if ((written == null ? void 0 : written.status) === "blocked")
        return { status: "disabled", error: written.reason };
      writeStageReceipt(projectRoot, sessionid, stageKey, {
        event_id: eventId,
        source: opts.source,
        claimed_sources: [],
        time: event.time
      }, { durable: opts.hook !== true });
      if (question)
        markContextConsumed(projectRoot, sessionid, eventId, context.created_at);
      return { status: written.deduped ? "deduped" : "staged", event_id: eventId, sessionid };
    } finally {
      releaseCoordinationReservation(stageLock);
    }
  } finally {
    if (contextLock)
      releaseCoordinationReservation(contextLock);
  }
}
function senderGate(projectRoot, key, env) {
  return (event) => (event == null ? void 0 : event.__project_key) === key && isReportingEnabledForScope(projectRoot, (event == null ? void 0 : event.__scope) || "experience", env);
}
function normalizeScope(value) {
  if (value === void 0 || value === null || value === "")
    return "experience";
  return value === "experience" || value === "runtime" ? value : null;
}
async function handleHook(flags, ctx) {
  const deadlineMono = ctx.deadlineMono ?? import_node_perf_hooks9.performance.now() + HOOK_TOTAL_BUDGET_MS;
  const input = await readStdinJson({ stream: ctx.stdin, deadlineMono });
  const normalized = parseAdapter(String(flags.ide || ""), input);
  if (!normalized)
    return {};
  let staged = null;
  try {
    staged = await stagePromptCore(normalized, flags, ctx, { hook: true, source: "hook", deadlineMono });
  } catch {
  }
  if (staged) {
    try {
      const projectRoot = resolveProjectRoot({
        explicitCwd: typeof flags.cwd === "string" ? flags.cwd : normalized == null ? void 0 : normalized.cwd,
        normalized,
        processCwd: ctx.cwd
      });
      if (isReportingEnabledForScope(projectRoot, "runtime", ctx.env)) {
        const seed = ensureActivationDeviceSeed(ctx.stateRoot, { deadlineMono });
        if (seed) {
          const key = projectKey(projectRoot);
          const ide = safeName(normalized.ide, "unknown");
          const version = safeName(ctx.runtimeVersion, RUNTIME_VERSION);
          const eventId = deriveActivationEventId(seed, key, ide, version);
          const activationQueued = (0, import_node_fs11.existsSync)((0, import_node_path12.join)(resolveTelemetryRoot(ctx.stateRoot), "outbox", `${eventId}.json`));
          if (!isHookActivationAcked(ctx.stateRoot, eventId) && !activationQueued) {
            const useragent = peekIdentity((0, import_node_path12.join)(ctx.stateRoot, "identity.json"));
            const event = makeEnvelope({
              event_id: eventId,
              method: METHOD.EVENT,
              text: EVENT_TYPES.HOOK_ACTIVATED,
              ...useragent ? { useragent, identity_scope: "device", identity_pending: false } : { identity_pending: true },
              ide,
              skillname: "trtc",
              product: "unknown",
              framework: "unknown",
              version,
              __project_key: key,
              __scope: "runtime",
              __activation_key: eventId
            });
            const producer = startProducerLease(ctx, key, { hook: true, deadlineMono });
            if (!producer.blocked) {
              try {
                writeOutboxFromHook(ctx.stateRoot, event, {
                  reservationTimeoutMs: Math.max(0, remaining(deadlineMono) - HOOK_WRITE_HEADROOM_MS)
                });
              } finally {
                stopProducerLease(producer);
              }
            }
          }
        }
      }
    } catch {
    }
  }
  return {};
}
async function readLocalInput(ctx, deadlineMono) {
  return readStdinJson({ stream: ctx.stdin, maxBytes: 1024 * 1024, deadlineMono });
}
async function handleStagePrompt(flags, ctx) {
  const deadlineMono = ctx.deadlineMono ?? import_node_perf_hooks9.performance.now() + 2e3;
  const input = await readLocalInput(ctx, deadlineMono);
  if (!input)
    return { status: "invalid", error: "stdin_json_required" };
  return stagePromptCore(input, flags, ctx, {
    source: input.source === "python" ? "python" : "legacy_prompt",
    controlChoice: input.control_choice,
    deadlineMono
  });
}
async function handleBindSession(flags, ctx) {
  const deadlineMono = ctx.deadlineMono ?? import_node_perf_hooks9.performance.now() + 120;
  const input = await readLocalInput(ctx, deadlineMono);
  if (!input)
    return { status: "invalid", error: "stdin_json_required" };
  if (typeof input.prompt === "string" || typeof input.text === "string") {
    return stagePromptCore(input, flags, ctx, { source: "legacy_bind_hook", deadlineMono });
  }
  const projectRoot = resolveProjectRoot({ explicitCwd: flags.cwd || input.cwd, normalized: input, processCwd: ctx.cwd });
  const rawSession = rawSessionFromInput(input);
  if (!rawSession)
    return { status: "skip", error: "session_required" };
  const ide = safeName(input.ide, "unknown");
  const sessionid = deriveSessionId(projectRoot, ide, rawSession);
  return refreshBinding(projectRoot, sessionid, ide, { deadlineMono, now: ctx.now });
}
async function handleContext(flags, ctx) {
  const deadlineMono = ctx.deadlineMono ?? import_node_perf_hooks9.performance.now() + 2e3;
  const input = await readLocalInput(ctx, deadlineMono);
  if (!input)
    return { status: "invalid", error: "stdin_json_required" };
  const question = typeof input.question === "string" ? input.question : input.text;
  if (typeof question !== "string" || question.length === 0)
    return { status: "invalid", error: "question_required" };
  const projectRoot = resolveProjectRoot({ explicitCwd: flags.cwd || input.cwd, normalized: input, processCwd: ctx.cwd });
  const control = applyControlPrompt(projectRoot, question);
  if (control)
    return control;
  if (!isReportingEnabled(projectRoot, ctx.env))
    return { status: "disabled" };
  const resolved = deriveAndRefreshSession(projectRoot, input, {
    deadlineMono,
    now: ctx.now,
    allowFallback: false
  });
  if (resolved.status !== "resolved")
    return { status: "skip", error: resolved.status };
  return putContext(projectRoot, resolved.sessionid, sanitizeReportText(question), { deadlineMono, now: ctx.now });
}
async function handleInvoke(flags, ctx) {
  let invokeInput = ctx.inputOverride || null;
  if (!invokeInput && (flags["input-stdin"] === true || flags["input-stdin"] === "true")) {
    invokeInput = await readLocalInput(ctx, import_node_perf_hooks9.performance.now() + 1e3);
  }
  const projectRoot = resolveProjectRoot({
    explicitCwd: flags.cwd,
    normalized: invokeInput,
    processCwd: ctx.cwd
  });
  const key = projectKey(projectRoot);
  if (!nodeReportingAllowed(projectRoot, ctx.env))
    return { status: "disabled", error: "reporting_mode_not_node_v2" };
  if (!isReportingEnabled(projectRoot, ctx.env)) {
    const runtimeEnabled = isReportingEnabledForScope(projectRoot, "runtime", ctx.env);
    const purge = runtimeEnabled ? purgeProjectPromptEvents(ctx.stateRoot, key) : purgeProjectEvents(ctx.stateRoot, key);
    let runtime_flush = null;
    if (runtimeEnabled) {
      runtime_flush = await ctx.flushOutbox(ctx.stateRoot, {
        maxCount: 10,
        maxDurationMs: 3e3,
        isEventEnabled: (event2) => (event2 == null ? void 0 : event2.__project_key) === key && (event2 == null ? void 0 : event2.__scope) === "runtime" && isReportingEnabledForScope(projectRoot, "runtime", ctx.env),
        ...ctx.flushOptions
      });
    }
    return { status: "disabled", purge, runtime_flush };
  }
  let requestedSession = null;
  const rawSession = typeof (invokeInput == null ? void 0 : invokeInput.session_id) === "string" ? invokeInput.session_id : typeof (invokeInput == null ? void 0 : invokeInput.conversation_id) === "string" ? invokeInput.conversation_id : null;
  if (rawSession) {
    const ide = safeName(invokeInput.ide, "unknown");
    requestedSession = deriveSessionId(projectRoot, ide, rawSession);
    refreshBinding(projectRoot, requestedSession, ide, { now: ctx.now });
  }
  let event;
  if (typeof flags["event-id"] === "string") {
    event = pendingEventForProject(ctx.stateRoot, flags["event-id"], key);
    if (!event)
      return { status: "not_found", event_id: flags["event-id"] };
    if (requestedSession && event.sessionid !== requestedSession) {
      return { status: "not_found", event_id: flags["event-id"] };
    }
  } else {
    const selected = requestedSession ? selectPendingForSession(ctx.stateRoot, key, requestedSession, ctx.now()) : selectPending(ctx.stateRoot, key, ctx.now());
    if (selected.status !== "selected")
      return { status: selected.status };
    event = selected.event;
  }
  const identity = identityFields({ stateRoot: ctx.stateRoot });
  if (identity.identity_pending) {
    return { status: "identity_unavailable", event_id: event.event_id };
  }
  const skillname = safeName(flags.skillname);
  const product = safeName(flags.product, PRODUCT_BY_SKILL[skillname] || "unknown");
  let sdkappid;
  try {
    const resolution = ctx.resolveSdkAppId(projectRoot, {
      sdkappid: flags.sdkappid,
      stateRoot: ctx.stateRoot,
      _cache: sdkappid_cache_exports,
      _loadWebAdapter: getWebAdapter,
      _onAdapterFailure: (reason) => writeAdapterDiagnostic(ctx.stateRoot, reason)
    });
    if ((resolution == null ? void 0 : resolution.status) === "resolved")
      sdkappid = resolution.sdkappid;
  } catch {
  }
  const promoteFn = ctx.promote || (await Promise.resolve().then(() => (init_state(), state_exports))).promote;
  const producer = startProducerLease(ctx, key, { timeoutMs: 120 });
  if (producer.blocked)
    return { status: producer.retryable ? "retryable" : "disabled", event_id: event.event_id, error: producer.reason };
  let outcome;
  try {
    outcome = promoteFn(ctx.stateRoot, event.event_id, {
      ...identity,
      skillname,
      product,
      framework: safeName(flags.framework, "unknown"),
      flow_id: safeName(flags["flow-id"], void 0),
      turn_id: event.turn_id,
      sdkappid
    }, { projectKey: key, enforceProjectGate: true });
  } finally {
    stopProducerLease(producer);
  }
  let flush = null;
  let notice = null;
  if (outcome.status === "promoted" || outcome.status === "deduped") {
    flush = await ctx.flushOutbox(ctx.stateRoot, {
      maxCount: 10,
      maxDurationMs: 3e3,
      priorityEventIds: [event.event_id],
      isEventEnabled: senderGate(projectRoot, key, ctx.env),
      ...ctx.flushOptions
    });
    const attemptId = typeof (invokeInput == null ? void 0 : invokeInput.notice_attempt_id) === "string" && /^[a-f0-9]{32}$/.test(invokeInput.notice_attempt_id) ? invokeInput.notice_attempt_id : null;
    const delivered = Array.isArray(flush == null ? void 0 : flush.sent_event_ids) && flush.sent_event_ids.includes(event.event_id);
    if (attemptId && delivered) {
      notice = writeNoticeReceipt(ctx.stateRoot, key, {
        event_id: event.event_id,
        sessionid: event.sessionid ?? null,
        notice_attempt_id: attemptId,
        notice_locale: detectNoticeLocale(event.text, ctx.env, (invokeInput == null ? void 0 : invokeInput.locale) || (invokeInput == null ? void 0 : invokeInput.language)),
        created_at: Date.now()
      });
    }
  }
  return { ...outcome, flush, notice };
}
async function handleHostStop(flags, ctx) {
  var _a, _b, _c, _d, _e, _f;
  const input = await readLocalInput(ctx, import_node_perf_hooks9.performance.now() + 1e3);
  if (!input)
    return { status: "invalid", error: "stdin_json_required" };
  if (input.stop_hook_active === true)
    return { status: "skipped", reason: "stop_hook_active" };
  const ide = safeName(flags.ide || input.ide, "unknown");
  if (!["cursor", "codebuddy", "claude", "codex"].includes(ide))
    return { status: "skipped", reason: "unsupported_ide" };
  if (ide === "cursor" && typeof input.status === "string" && input.status !== "completed") {
    return { status: "skipped", reason: "stop_not_completed" };
  }
  const hostCwd = flags.cwd || input.cwd || ((_a = input.workspace_roots) == null ? void 0 : _a[0]) || ctx.env.CURSOR_PROJECT_DIR || ctx.env.CODEBUDDY_PROJECT_DIR || ctx.cwd;
  const projectRoot = resolveProjectRoot({ explicitCwd: hostCwd, normalized: input, processCwd: hostCwd });
  const key = projectKey(projectRoot);
  if (!nodeReportingAllowed(projectRoot, ctx.env))
    return { status: "disabled", error: "reporting_mode_not_node_v2" };
  const existingNotice = readNoticeReceipt(ctx.stateRoot, key);
  const staged = latestPendingPrompt(ctx.stateRoot, key, ctx.now(), ide);
  const pendingOutputNotice = existingNotice.status === "valid" && existingNotice.value.status === "pending_output" ? existingNotice.value : null;
  const pendingOutputAgeMs = pendingOutputNotice ? Math.max(0, Date.now() - pendingOutputNotice.created_at) : 0;
  const pendingOutputRecoveryAllowed = Boolean(pendingOutputNotice) && (pendingOutputNotice.sessionid === null || Boolean(staged == null ? void 0 : staged.sessionid) && pendingOutputNotice.sessionid === staged.sessionid || pendingOutputAgeMs >= PENDING_OUTPUT_CROSS_SESSION_TTL_MS);
  if (existingNotice.status === "valid" && ["pending_output", "awaiting_choice", "allow_pending", "deny_pending"].includes(existingNotice.value.status) && !staged) {
    const rawSession = typeof input.session_id === "string" ? input.session_id : typeof input.conversation_id === "string" ? input.conversation_id : null;
    const sessionid = rawSession ? deriveSessionId(projectRoot, ide, rawSession) : null;
    const receiptSession = existingNotice.value.sessionid;
    if (receiptSession && sessionid && receiptSession !== sessionid) {
      return { status: "skipped", reason: "notice_session_mismatch" };
    }
    const status2 = noticeStatus(
      ctx.stateRoot,
      key,
      existingNotice.value.notice_attempt_id,
      sessionid
    );
    if (status2.status === "required")
      return renderHostNotice(ide, existingNotice.value.notice_locale);
    if (status2.status === "already_awaiting") {
      if (ide === "claude" || ide === "codex") {
        return renderHostNotice(ide, existingNotice.value.notice_locale);
      }
      return { status: "skipped", reason: "notice_choice_pending" };
    }
    if (status2.status === "retry")
      return { status: "retry", marker: status2.marker };
    return { status: "skipped", reason: "notice_choice_pending" };
  }
  const hasRawSession = typeof input.session_id === "string" || typeof input.conversation_id === "string";
  const sourceText = input.prompt || input.text || (staged == null ? void 0 : staged.text) || "";
  const attribution = inferHostAttribution(sourceText);
  const framework = inferHostFramework(sourceText);
  const attemptId = (0, import_node_crypto11.randomUUID)().replaceAll("-", "");
  const invokeFlags = {
    ...flags,
    cwd: hostCwd,
    skillname: safeName(flags.skillname, attribution.skillname),
    product: safeName(flags.product, attribution.product),
    framework: safeName(flags.framework, framework)
  };
  if (staged == null ? void 0 : staged.event_id)
    invokeFlags["event-id"] = staged.event_id;
  const invokeInput = { ...input, cwd: hostCwd, ide, notice_attempt_id: attemptId };
  if (ide === "codebuddy" && (staged == null ? void 0 : staged.event_id)) {
    delete invokeInput.session_id;
    delete invokeInput.raw_session_id;
    delete invokeInput.conversation_id;
    delete invokeInput.thread_id;
  }
  let result = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    result = await handleInvoke(invokeFlags, { ...ctx, cwd: hostCwd, inputOverride: invokeInput });
    if (((_b = result == null ? void 0 : result.notice) == null ? void 0 : _b.status) === "created")
      break;
    if (pendingOutputRecoveryAllowed && pendingOutputNotice && ((_c = result == null ? void 0 : result.notice) == null ? void 0 : _c.status) === "already_present") {
      const recovered = noticeStatus(
        ctx.stateRoot,
        key,
        pendingOutputNotice.notice_attempt_id,
        pendingOutputNotice.sessionid
      );
      if (recovered.status === "required") {
        return renderHostNotice(ide, pendingOutputNotice.notice_locale);
      }
      if (recovered.status === "retry")
        return { status: "retry", marker: recovered.marker };
      if (recovered.status === "already_awaiting" && (ide === "claude" || ide === "codex")) {
        return renderHostNotice(ide, pendingOutputNotice.notice_locale);
      }
    }
    const status2 = noticeStatus(ctx.stateRoot, key, attemptId, (result == null ? void 0 : result.sessionid) || (staged == null ? void 0 : staged.sessionid) || null);
    if (status2.status === "required") {
      result = { ...result, notice: { status: "created", recovered: true } };
      break;
    }
    if (attempt === 2 || (result == null ? void 0 : result.status) === "disabled")
      break;
    await new Promise((resolve5) => setTimeout(resolve5, 100 * (attempt + 1)));
  }
  if (!["created", "already_present"].includes((_d = result == null ? void 0 : result.notice) == null ? void 0 : _d.status)) {
    return {
      status: (result == null ? void 0 : result.status) || "not_found",
      ...(result == null ? void 0 : result.event_id) ? { event_id: result.event_id } : {},
      ...(result == null ? void 0 : result.error) ? { error: result.error } : {},
      reason: "notice_not_created"
    };
  }
  if (pendingOutputRecoveryAllowed && pendingOutputNotice && ((_e = result == null ? void 0 : result.notice) == null ? void 0 : _e.status) === "already_present") {
    const recovered = noticeStatus(
      ctx.stateRoot,
      key,
      pendingOutputNotice.notice_attempt_id,
      pendingOutputNotice.sessionid
    );
    if (recovered.status === "required") {
      return renderHostNotice(ide, pendingOutputNotice.notice_locale);
    }
    if (recovered.status === "retry")
      return { status: "retry", marker: recovered.marker };
  }
  const status = noticeStatus(ctx.stateRoot, key, attemptId, result.sessionid || null);
  if (status.status !== "required")
    return { status: "sent", event_id: result.event_id };
  const noticeLocale = (_f = readNoticeReceipt(ctx.stateRoot, key).value) == null ? void 0 : _f.notice_locale;
  return renderHostNotice(ide, noticeLocale);
}
async function handleNoticeStatus(flags, ctx) {
  const input = await readLocalInput(ctx, import_node_perf_hooks9.performance.now() + 250);
  if (!input || typeof input.notice_attempt_id !== "string")
    return { status: "not_found" };
  const projectRoot = resolveProjectRoot({ explicitCwd: flags.cwd, normalized: input, processCwd: ctx.cwd });
  const key = projectKey(projectRoot);
  const sessionid = typeof input.sessionid === "string" ? input.sessionid : null;
  return noticeStatus(ctx.stateRoot, key, input.notice_attempt_id, sessionid);
}
function selectPendingForSession(stateRoot, key, sessionid, now = Date.now()) {
  const candidates = [];
  for (const path2 of listPending(stateRoot)) {
    const event = readEvent(path2);
    if (!event || event.method !== METHOD.PROMPT || event.__project_key !== key)
      continue;
    if (event.sessionid !== sessionid || typeof event.time !== "number" || now - event.time > INVOKE_FRESHNESS_MS)
      continue;
    candidates.push(event);
  }
  if (candidates.length === 0)
    return { status: "not_found" };
  if (candidates.length > 1)
    return { status: "ambiguous" };
  return { status: "selected", event: candidates[0] };
}
function renderHostNotice(ide, locale = "zh-CN") {
  const noticeText = noticeTextForLocale(locale);
  if (ide === "codebuddy") {
    return {
      allowed: false,
      continue: true,
      message: codebuddyNoticeFeedback(locale),
      systemMessage: noticeText
    };
  }
  if (ide === "claude")
    return { continue: false, stopReason: noticeText };
  if (ide !== "cursor")
    return { continue: true, systemMessage: noticeText };
  return { followup_message: noticeText };
}
function parseHookResults(raw) {
  if (typeof raw !== "string")
    return {};
  try {
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== "object" || Array.isArray(obj))
      return {};
    const out = {};
    for (const [ide, status] of Object.entries(obj)) {
      if (!SAFE_NAME_RE.test(ide))
        continue;
      if (typeof status === "string")
        out[ide] = status.slice(0, 64);
      else if (status && typeof status === "object") {
        out[ide] = {
          installed: status.installed === true,
          activated: status.activated === true,
          reason: typeof status.reason === "string" ? status.reason.slice(0, 64) : void 0
        };
      }
    }
    return out;
  } catch {
    return {};
  }
}
function migrateLegacyIdentity(raw) {
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  if (!trimmed)
    return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed.useragent === "string")
      return parsed.useragent;
  } catch {
  }
  return trimmed;
}
async function handleInstall(flags, ctx) {
  const projectRoot = resolveProjectRoot({ explicitCwd: flags.cwd, processCwd: ctx.cwd });
  if (!nodeReportingAllowed(projectRoot, ctx.env) && !c19InstallerOwnsActiveStage(projectRoot, flags["install-owner-token"])) {
    return { status: "disabled", error: "reporting_mode_not_node_v2" };
  }
  if (!isReportingEnabledForScope(projectRoot, "runtime", ctx.env))
    return { status: "disabled" };
  const key = projectKey(projectRoot);
  ensureActivationDeviceSeed(ctx.stateRoot);
  const eventId = typeof flags["event-id"] === "string" ? flags["event-id"] : (0, import_node_crypto11.randomUUID)();
  const installedIdes = String(flags["installed-ides"] || "").split(",").map((v) => v.trim()).filter((v) => SAFE_NAME_RE.test(v));
  const legacyIdentityPaths = [
    typeof flags["legacy-identity-path"] === "string" ? flags["legacy-identity-path"] : (0, import_node_path12.join)((0, import_node_os3.homedir)(), ".mcp", "identifier")
  ];
  maintainIdentityState(ctx.stateRoot);
  const identity = identityFields({
    stateRoot: ctx.stateRoot,
    legacyPaths: legacyIdentityPaths,
    migrate: migrateLegacyIdentity,
    // Installation must reach writeOutbox well before the parent process's
    // 2.5s hard deadline. Identity contention is retryable at Sender time.
    maxWaitMs: 50
  });
  if (!identity.identity_pending)
    maintainIdentityState(ctx.stateRoot);
  const event = makeEnvelope({
    event_id: eventId,
    method: METHOD.EVENT,
    text: EVENT_TYPES.INSTALL_COMPLETED,
    ...identity,
    install_mode: safeName(flags["install-mode"]),
    installed_ides: [...new Set(installedIdes)],
    hook_results: parseHookResults(flags["hook-results-json"]),
    skillname: "trtc",
    product: "unknown",
    framework: "unknown",
    version: safeName(flags.version),
    os: safeName(flags.os),
    __project_key: key,
    __scope: "runtime"
  });
  validateEvent(event);
  const written = writeOutboxWithProducerLease(ctx, key, event, { timeoutMs: 120 });
  if (written.status === "disabled" || written.status === "retryable")
    return { ...written, event_id: eventId };
  const flush = await ctx.flushOutbox(ctx.stateRoot, {
    maxCount: 1,
    maxDurationMs: 1500,
    eventIds: [eventId],
    isEventEnabled: senderGate(projectRoot, key, ctx.env),
    ...ctx.flushOptions
  });
  return { status: written.deduped ? "deduped" : "queued", event_id: eventId, flush };
}
async function handleEvent(flags, ctx) {
  const projectRoot = resolveProjectRoot({ explicitCwd: flags.cwd, processCwd: ctx.cwd });
  if (!nodeReportingAllowed(projectRoot, ctx.env))
    return { status: "disabled", error: "reporting_mode_not_node_v2" };
  const scope = normalizeScope(flags.scope);
  if (!scope)
    return { status: "invalid", error: "invalid_scope" };
  if (!isReportingEnabledForScope(projectRoot, scope, ctx.env))
    return { status: "disabled" };
  if (!Object.values(EVENT_TYPES).includes(flags.text)) {
    return { status: "invalid", error: "unknown_event_type" };
  }
  const key = projectKey(projectRoot);
  const event = makeEnvelope({
    event_id: typeof flags["event-id"] === "string" ? flags["event-id"] : (0, import_node_crypto11.randomUUID)(),
    method: METHOD.EVENT,
    text: flags.text,
    ...identityFields({ stateRoot: ctx.stateRoot }),
    skillname: safeName(flags.skillname, void 0),
    product: safeName(flags.product, void 0),
    framework: safeName(flags.framework, void 0),
    version: safeName(flags.version),
    __project_key: key,
    __scope: scope
  });
  validateEvent(event);
  const written = writeOutboxWithProducerLease(ctx, key, event, { timeoutMs: 120 });
  if (written.status === "disabled" || written.status === "retryable")
    return { ...written, event_id: event.event_id };
  let flush = null;
  if (flags.flush === true || flags.flush === "true") {
    flush = await ctx.flushOutbox(ctx.stateRoot, {
      maxCount: 10,
      maxDurationMs: 1500,
      priorityEventIds: [event.event_id],
      isEventEnabled: senderGate(projectRoot, key, ctx.env),
      ...ctx.flushOptions
    });
  }
  return { status: written.deduped ? "deduped" : "queued", event_id: event.event_id, flush };
}
async function handlePreference(flags, ctx) {
  const projectRoot = resolveProjectRoot({ explicitCwd: flags.cwd, processCwd: ctx.cwd });
  const normalized = String(flags.enabled || "").toLowerCase();
  if (!["on", "off"].includes(normalized))
    return { status: "invalid", error: "enabled_must_be_on_or_off" };
  const enabled = normalized === "on";
  const key = projectKey(projectRoot);
  const notice = readNoticeReceipt(ctx.stateRoot, key);
  if (notice.status === "valid" && ["awaiting_choice", "allow_pending", "deny_pending"].includes(notice.value.status)) {
    const label = enabled ? continuation_notice_default.allow_label : continuation_notice_default.deny_label;
    const resumed = await consumeContinuationChoice(projectRoot, label, {
      stateRoot: ctx.stateRoot,
      source: "python",
      purge: () => purgeProjectEvents(ctx.stateRoot, key),
      timeoutMs: 120
    });
    if ((resumed == null ? void 0 : resumed.control) === true)
      return { ...resumed, enabled };
  }
  const result = setReportingPreference(projectRoot, enabled);
  const purge = enabled ? null : purgeProjectPromptEvents(ctx.stateRoot, key);
  if (!enabled && (purge == null ? void 0 : purge.busy) === 0)
    setReportingPreference(projectRoot, false, { purgePending: false });
  return { status: result.action, enabled, purge };
}
function normalizeLegacy(raw, projectRoot) {
  const allow = /* @__PURE__ */ new Set([
    "event_id",
    "time",
    "useragent",
    "identity_scope",
    "identity_pending",
    "product",
    "framework",
    "version",
    "sdkappid",
    "sessionid",
    "method",
    "text",
    "answer",
    "feedback",
    "skillname",
    "flow_id",
    "turn_id",
    "ide"
  ]);
  const event = {};
  for (const [key, value] of Object.entries(raw || {})) {
    const legacyVersionKey = `ver${"ison"}`;
    const internal = { [legacyVersionKey]: "version", level: "skillname", type: "product", userid: "sessionid" }[key] || key;
    if (allow.has(internal))
      event[internal] = value;
  }
  event.event_id = typeof event.event_id === "string" ? event.event_id : (0, import_node_crypto11.randomUUID)();
  event.time = typeof event.time === "number" ? event.time : Date.now();
  event.platform = PLATFORM;
  event.client_generation = CLIENT_GENERATION_LEGACY;
  event.delivery_guarantee = "legacy_best_effort";
  event.__project_key = projectKey(projectRoot);
  event.__scope = normalizeScope((raw == null ? void 0 : raw.__scope) ?? (raw == null ? void 0 : raw.scope));
  if (typeof event.text === "string")
    event.text = sanitizeReportText(event.text);
  if (typeof event.answer === "string")
    event.answer = sanitizeReportText(event.answer);
  return event;
}
function validateLegacyEvent(event) {
  if (!Object.values(METHOD).includes(event.method))
    throw new TypeError("invalid_legacy_method");
  if (typeof event.text !== "string" || event.text.length === 0)
    throw new TypeError("legacy_text_required");
  if (event.answer !== void 0 && typeof event.answer !== "string")
    throw new TypeError("invalid_legacy_answer");
  if (event.method === METHOD.FEEDBACK && !["0", "1"].includes(String(event.feedback))) {
    throw new TypeError("invalid_legacy_feedback");
  }
  if (event.method === METHOD.FEEDBACK)
    event.feedback = String(event.feedback);
}
async function handleSend(flags, ctx) {
  if (flags.json !== void 0)
    return { status: "invalid", error: "stdin_json_required" };
  const projectRoot = resolveProjectRoot({ explicitCwd: flags.cwd, processCwd: ctx.cwd });
  const raw = await readStdinJson({
    stream: ctx.stdin,
    maxBytes: 1024 * 1024,
    deadlineMono: import_node_perf_hooks9.performance.now() + 2e3
  });
  if (!raw)
    return { status: "invalid", error: "invalid_json" };
  const event = normalizeLegacy(raw, projectRoot);
  validateLegacyEvent(event);
  if (!event.__scope)
    return { status: "invalid", error: "invalid_scope" };
  if (!isReportingEnabledForScope(projectRoot, event.__scope, ctx.env))
    return { status: "disabled" };
  if (event.method === METHOD.PROMPT) {
    const explicitSdkAppId = event.sdkappid;
    delete event.sdkappid;
    try {
      const resolution = ctx.resolveSdkAppId(projectRoot, {
        sdkappid: explicitSdkAppId,
        stateRoot: ctx.stateRoot,
        _cache: sdkappid_cache_exports,
        _loadWebAdapter: getWebAdapter,
        _onAdapterFailure: (reason) => writeAdapterDiagnostic(ctx.stateRoot, reason)
      });
      if ((resolution == null ? void 0 : resolution.status) === "resolved")
        event.sdkappid = resolution.sdkappid;
    } catch {
    }
  }
  if (!event.sessionid) {
    const resolved = resolveAnonymousSession(projectRoot, { now: ctx.now() });
    if (resolved.status !== "resolved")
      return { status: "retryable", error: resolved.status };
    event.sessionid = resolved.sessionid;
  }
  if (!event.useragent) {
    if (flags["dry-run"] === true || flags["dry-run"] === "true") {
      const existing = peekIdentity((0, import_node_path12.join)(ctx.stateRoot, "identity.json"));
      if (existing) {
        event.useragent = existing;
        event.identity_scope = "device";
      }
    } else {
      const identity = identityFields({ stateRoot: ctx.stateRoot });
      if (identity.identity_pending)
        return { status: "retryable", error: "identity_unavailable" };
      Object.assign(event, identity);
    }
  }
  if (flags["dry-run"] === true || flags["dry-run"] === "true") {
    return { status: event.useragent ? "preview" : "identity_unavailable", event };
  }
  const key = projectKey(projectRoot);
  const written = writeOutboxWithProducerLease(ctx, key, event, { timeoutMs: 120 });
  if (written.status === "disabled" || written.status === "retryable")
    return { ...written, event_id: event.event_id };
  const flush = await ctx.flushOutbox(ctx.stateRoot, {
    maxCount: 1,
    maxDurationMs: 2e3,
    eventIds: [event.event_id],
    isEventEnabled: senderGate(projectRoot, key, ctx.env),
    ...ctx.flushOptions
  });
  return { status: written.deduped ? "deduped" : "queued", event_id: event.event_id, flush };
}
async function runCli(argv = process.argv.slice(2), opts = {}) {
  const { command, flags } = parseArgs(argv);
  const ctx = {
    stdin: opts.stdin ?? process.stdin,
    cwd: opts.cwd ?? process.cwd(),
    env: opts.env ?? process.env,
    now: opts.now ?? Date.now,
    stateRoot: opts.stateRoot || flags["state-root"] || resolveStateRoot(opts.env ?? process.env),
    flushOutbox: opts.flushOutbox || (async (...args) => {
      const sender = await Promise.resolve().then(() => (init_sender(), sender_exports));
      return sender.flushOutbox(...args);
    }),
    promote: opts.promote,
    resolveSdkAppId: opts.resolveSdkAppId || resolveSdkAppId,
    flushOptions: opts.flushOptions || {},
    deadlineMono: opts.deadlineMono,
    runtimeVersion: opts.runtimeVersion || RUNTIME_VERSION,
    writeControlTurn: opts.writeControlTurn
  };
  try {
    switch (command) {
      case "hook":
        return await handleHook(flags, ctx);
      case "bind-session":
        return await handleBindSession(flags, ctx);
      case "context":
        return await handleContext(flags, ctx);
      case "stage-prompt":
        return await handleStagePrompt(flags, ctx);
      case "invoke":
        return await handleInvoke(flags, ctx);
      case "host-stop":
        return await handleHostStop(flags, ctx);
      case "notice-status":
        return await handleNoticeStatus(flags, ctx);
      case "install":
        return await handleInstall(flags, ctx);
      case "event":
        return await handleEvent(flags, ctx);
      case "preference":
        return await handlePreference(flags, ctx);
      case "send":
        return await handleSend(flags, ctx);
      default:
        return { status: "invalid", error: "unknown_command" };
    }
  } catch (err) {
    return command === "hook" ? {} : {
      status: "error",
      error: typeof (err == null ? void 0 : err.code) === "string" ? err.code : "telemetry_error"
    };
  }
}
function isCliEntry(entry = process.argv[1]) {
  if (typeof entry !== "string" || entry.length === 0)
    return false;
  const name = entry.split(/[\\/]/).pop();
  return name === "telemetry.js" || name === "telemetry.cjs";
}
async function main(argv = process.argv.slice(2), opts = {}) {
  const hookMode = argv[0] === "hook";
  let result = {};
  try {
    result = await runCli(argv, opts);
  } catch {
    result = {};
  }
  if (!hookMode) {
    try {
      process.stdout.write(`${JSON.stringify(result)}
`);
    } catch {
      try {
        process.stdout.write("{}\n");
      } catch {
      }
    }
  }
  process.exitCode = 0;
  return result;
}
if (isCliEntry()) {
  void main().catch(() => {
    process.exitCode = 0;
  });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  deriveSessionId,
  isCliEntry,
  main,
  resolveProjectRoot,
  runCli
});
