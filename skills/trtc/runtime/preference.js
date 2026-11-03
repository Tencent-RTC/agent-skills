// preference.js — dependency-free, project-scoped telemetry preference.
//
// The dedicated preference.json is authoritative for the Node runtime.  The
// legacy Python state.json remains readable so an upgrade never resurrects a
// preference that the user already made.  No project path is written to the
// device state root; callers use a one-way project key on queued events.

import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { ALLOWED, ALLOW_RETRY, DISABLED, DISABLE_RETRY, NOTICE_REQUIRED, isCanonicalOption } from './control.js';
import { projectStateDirs, resolveProjectStateDir } from './project-state.js';
import { CONSENT_TTL_MS, CONSENT_VERSION, claimConsentNotice, readConsentState, updateConsentState } from './consent.js';
import { isRuntimeEvent } from './event-scope.js';

const FALSE_VALUES = new Set(['0', 'false', 'no', 'off', 'disabled']);
const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on', 'enabled']);
const PREF_FILE = 'preference.json';
const LEGACY_STATE_FILE = 'state.json';
const LOCK_FILE = '.pref-owner.json';
const LOCK_GRACE_FOREGROUND_MS = 5000;

const VALID_CONTINUATION_CHOICES = new Set(['unanswered', 'allowed', 'denied']);

const OFF_TEXTS = new Set([
  '关闭体验上报', '停止体验上报', '关闭提示词上报', '停止提示词上报',
  '关闭prompt上报', '停止prompt上报', 'turn off experience reporting',
  'disable experience reporting', 'stop experience reporting',
  'turn off prompt reporting', 'disable prompt reporting', 'stop prompt reporting',
]);
const ON_TEXTS = new Set([
  '开启体验上报', '恢复体验上报', '开启提示词上报', '恢复提示词上报',
  '开启prompt上报', '恢复prompt上报', 'turn on experience reporting',
  'enable experience reporting', 'resume experience reporting',
  'turn on prompt reporting', 'enable prompt reporting', 'resume prompt reporting',
]);

function readObject(path) {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}

function writeObjectAtomic(path, value) {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true, mode: process.platform === 'win32' ? undefined : 0o700 });
  const tmp = join(dir, `.${randomBytes(8).toString('hex')}.${PREF_FILE}.tmp`);
  let fd;
  try {
    fd = openSync(tmp, 'wx', process.platform === 'win32' ? undefined : 0o600);
    const body = `${JSON.stringify(value, null, 2)}\n`;
    writeSync(fd, body, null, 'utf8');
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(tmp, path);
    try {
      const dirFd = openSync(dir, 'r');
      try { fsyncSync(dirFd); } finally { closeSync(dirFd); }
    } catch (err) {
      if (!err || !['EINVAL', 'ENOSYS', 'EPERM', 'EACCES', 'ENOENT'].includes(err.code)) throw err;
    }
    return true;
  } catch {
    if (fd !== undefined) try { closeSync(fd); } catch { /* ignore */ }
    try { unlinkSync(tmp); } catch { /* ignore */ }
    return false;
  }
}

function ancestors(projectRoot) {
  const result = [];
  let current = canonicalRoot(projectRoot);
  while (true) {
    result.push(current);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return result;
}

function canonicalRoot(projectRoot) {
  const absolute = resolve(projectRoot);
  try { return realpathSync(absolute); } catch { return absolute; }
}

// ---------------------------------------------------------------------------
// Owner-token lock — shared by all preference read-modify-write operations.
// graceMs: how old a lock must be before it is considered stale.
// ---------------------------------------------------------------------------

function _lockMode() { return process.platform === 'win32' ? undefined : 0o600; }

function _staleCheckAndClaim(lockPath, newToken, newOwnerData, graceMs) {
  // Step 1: lstat for mtime
  let stat;
  try { stat = lstatSync(lockPath); }
  catch (err) {
    if (err.code === 'ENOENT') {
      // Released between EEXIST and lstat; retry acquire once.
      try {
        writeFileSync(lockPath, newOwnerData, { flag: 'wx', mode: _lockMode() });
        return { acquired: true, token: newToken, lockPath };
      } catch { return { acquired: false, reason: 'busy' }; }
    }
    return { acquired: false, reason: 'busy' };
  }
  // Step 2: age check
  const age = Date.now() - stat.mtimeMs;
  if (age < graceMs) return { acquired: false, reason: 'busy' };
  // Step 3: read PID
  let pid = null;
  try {
    const existing = JSON.parse(readFileSync(lockPath, 'utf8'));
    if (typeof existing?.pid === 'number') pid = existing.pid;
  } catch { /* parse failed — rely on mtime */ }
  // Step 4: PID liveness
  if (pid !== null) {
    try {
      process.kill(pid, 0);
      return { acquired: false, reason: 'busy' }; // process alive
    } catch (err) {
      if (err.code !== 'ESRCH') return { acquired: false, reason: 'busy' };
      // ESRCH: dead → stale
    }
  }
  // Step 5: atomic rename to claim
  const staleFile = lockPath + '.stale.' + newToken;
  try { renameSync(lockPath, staleFile); }
  catch (err) {
    if (err.code === 'ENOENT') {
      try {
        writeFileSync(lockPath, newOwnerData, { flag: 'wx', mode: _lockMode() });
        return { acquired: true, token: newToken, lockPath };
      } catch { return { acquired: false, reason: 'busy' }; }
    }
    return { acquired: false, reason: 'busy' };
  }
  // Write new owner with O_EXCL
  try {
    writeFileSync(lockPath, newOwnerData, { flag: 'wx', mode: _lockMode() });
  } catch { return { acquired: false, reason: 'busy' }; } // competitor won
  // Step 6: clean up stale files (best-effort)
  try { unlinkSync(staleFile); } catch { /* ignore */ }
  try {
    const prefDir = dirname(lockPath);
    for (const e of readdirSync(prefDir)) {
      if (e.startsWith(LOCK_FILE + '.stale.')) {
        try { unlinkSync(join(prefDir, e)); } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }
  return { acquired: true, token: newToken, lockPath };
}

export function _acquirePreferenceLock(prefDir, { graceMs = LOCK_GRACE_FOREGROUND_MS } = {}) {
  mkdirSync(prefDir, { recursive: true, mode: process.platform === 'win32' ? undefined : 0o700 });
  const lockPath = join(prefDir, LOCK_FILE);
  const token = randomBytes(16).toString('hex');
  const ownerData = JSON.stringify({ pid: process.pid, token, ts: Date.now() });
  try {
    writeFileSync(lockPath, ownerData, { flag: 'wx', mode: _lockMode() });
    return { acquired: true, token, lockPath };
  } catch (err) {
    if (err.code !== 'EEXIST') return { acquired: false, reason: 'lock_io_error' };
    return _staleCheckAndClaim(lockPath, token, ownerData, graceMs);
  }
}

export function _releasePreferenceLock(lockPath, token, _testHookAfterRename) {
  if (!lockPath || !token) return;
  const releasingFile = lockPath + '.releasing.' + token;
  try { renameSync(lockPath, releasingFile); }
  catch { return; } // ENOENT: already reclaimed; other errors: keep lock
  _testHookAfterRename?.(); // for barrier tests only — not present in production calls
  try {
    const existing = JSON.parse(readFileSync(releasingFile, 'utf8'));
    if (existing?.token === token) {
      unlinkSync(releasingFile);
    } else {
      // Token mismatch: the .releasing.* file contains another owner's lock data.
      // Restore it via a no-clobber hard-link so we don't silently lose that lock.
      // If a new owner has already acquired lockPath (linkSync → EEXIST), we just
      // clean up our .releasing.* file and leave the new lock untouched.
      try {
        linkSync(releasingFile, lockPath); // atomic no-clobber: EEXIST if new owner present
        unlinkSync(releasingFile);         // restored: remove the temporary .releasing.* name
      } catch {
        try { unlinkSync(releasingFile); } catch { /* ignore */ }
      }
    }
  } catch {
    try { unlinkSync(releasingFile); } catch { /* ignore */ }
  }
}

// ---------------------------------------------------------------------------
// Three-state preference source reader.
// Returns { status: 'missing' | 'valid' | 'corrupt', value? }.
// ---------------------------------------------------------------------------

export function readPreferenceSourceAt(root, source) {
  const fileName = source === 'preferred' ? PREF_FILE : LEGACY_STATE_FILE;
  let filePath = null;
  for (const dir of projectStateDirs(root)) {
    const candidate = join(dir, fileName);
    if (existsSync(candidate)) { filePath = candidate; break; }
  }
  if (filePath === null) return { status: 'missing' };
  let raw;
  try { raw = readFileSync(filePath, 'utf8'); }
  catch { return { status: 'corrupt' }; }
  let value;
  try { value = JSON.parse(raw); }
  catch { return { status: 'corrupt' }; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { status: 'corrupt' };
  if (source === 'preferred') {
    const boolFields = ['prompt_reporting_enabled', 'all_reporting_disabled', 'purge_pending'];
    for (const f of boolFields) {
      if (value[f] !== undefined && typeof value[f] !== 'boolean') return { status: 'corrupt' };
    }
    const tsFields = ['prompt_reporting_updated_at', 'all_reporting_updated_at', 'continuation_choice_updated_at'];
    for (const f of tsFields) {
      if (value[f] !== undefined && (!Number.isInteger(value[f]) || value[f] < 0)) return { status: 'corrupt' };
    }
    if (value.continuation_choice !== undefined && !VALID_CONTINUATION_CHOICES.has(value.continuation_choice)) {
      return { status: 'corrupt' };
    }
    if (value.continuation_choice_version !== undefined &&
        (!Number.isInteger(value.continuation_choice_version) || value.continuation_choice_version <= 0)) {
      return { status: 'corrupt' };
    }
    if (value.preference_revision !== undefined &&
        (!Number.isSafeInteger(value.preference_revision) || value.preference_revision < 0)) {
      return { status: 'corrupt' };
    }
    if (value.experience_consent_id !== undefined
      && (typeof value.experience_consent_id !== 'string' || !/^[a-f0-9]{32}$/.test(value.experience_consent_id))) {
      return { status: 'corrupt' };
    }
    if (value.continuation_choice === 'allowed' && value.continuation_choice_version === CONSENT_VERSION
      && !value.experience_consent_id) return { status: 'corrupt' };
  } else {
    // legacy: validate only the two boolean fields
    for (const f of ['prompt_reporting_enabled', 'all_reporting_disabled']) {
      if (value[f] !== undefined && typeof value[f] !== 'boolean') return { status: 'corrupt' };
    }
  }
  return { status: 'valid', value };
}

// ---------------------------------------------------------------------------
// XDG legacy-cache reader — one-time backward-compat read at project root.
// The installer (bin/cli.js) migrates this data on every upgrade, but users
// who upgrade without re-running the installer need the Runtime to see it.
// ---------------------------------------------------------------------------

function _readXdgLegacyCache(projectRoot, env) {
  const cachePath = legacyCachePath(projectRoot, env);
  if (!existsSync(cachePath)) return { status: 'missing' };
  let raw;
  try { raw = readFileSync(cachePath, 'utf8'); }
  catch { return { status: 'corrupt' }; }
  let value;
  try { value = JSON.parse(raw); }
  catch { return { status: 'corrupt' }; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { status: 'corrupt' };
  for (const f of ['prompt_reporting_enabled', 'all_reporting_disabled']) {
    if (value[f] !== undefined && typeof value[f] !== 'boolean') return { status: 'corrupt' };
  }
  return { status: 'valid', value };
}

// ---------------------------------------------------------------------------
// Unified effective-preference resolver.
// scope: 'experience' (default) or 'runtime'.
// ---------------------------------------------------------------------------

function resolveEffectivePreference(projectRoot, env = process.env, scope = 'experience') {
  // 1. TRTC_REPORTING=off → false (all scopes, highest priority)
  if (envBoolean(env.TRTC_REPORTING) === false) return false;
  // 2. TRTC_PROMPT_REPORTING=off → false (non-runtime scope only)
  if (scope !== 'runtime' && envBoolean(env.TRTC_PROMPT_REPORTING) === false) return false;
  let promptPreference = null;
  let explicitConsent = null;
  const allRoots = ancestors(projectRoot);
  // 3. Ancestor walk with authority aggregation
  for (let i = 0; i < allRoots.length; i++) {
    const root = allRoots[i];
    const preferred = readPreferenceSourceAt(root, 'preferred');
    let prefValue;
    if (preferred.status === 'valid') {
      prefValue = preferred.value;
    } else if (preferred.status === 'corrupt') {
      return false; // fail-closed
    } else {
      // preferred missing → try legacy (state.json)
      const legacy = readPreferenceSourceAt(root, 'legacy');
      if (legacy.status === 'valid') {
        prefValue = legacy.value;
      } else if (legacy.status === 'corrupt') {
        return false; // fail-closed
      } else {
        // Both preferred and legacy missing at this root.
        // At the project root (first ancestor only), also check the XDG cache path
        // for one-time backwards compatibility with pre-C20.1b installations.
        if (i === 0) {
          const xdg = _readXdgLegacyCache(root, env);
          if (xdg.status === 'valid') {
            prefValue = xdg.value;
          } else if (xdg.status === 'corrupt') {
            return false; // fail-closed
          } else {
            continue; // all three sources missing → try parent
          }
        } else {
          continue; // ancestor has no preference → try further parent
        }
      }
    }
    // V1 refusals also meant global opt-out. Preserve that historical
    // boundary; V2 refusals affect experience data only.
    if (prefValue.continuation_choice === 'denied'
      && (scope !== 'runtime' || prefValue.continuation_choice_version !== CONSENT_VERSION)) return false;
    // all_reporting_disabled is unconditional — cannot be bypassed by any env var
    if (prefValue.all_reporting_disabled === true) return false;
    // cache prompt_reporting_enabled — runtime scope ignores this flag
    if (scope !== 'runtime' && promptPreference === null && typeof prefValue.prompt_reporting_enabled === 'boolean') {
      promptPreference = prefValue.prompt_reporting_enabled;
    }
    if (explicitConsent === null && prefValue.continuation_choice === 'allowed') {
      explicitConsent = prefValue;
    }
  }
  if (scope === 'runtime') return true;
  // A settings/env "on" is not consent. Eligibility to hold/show a notice
  // is separate, so a first-time user can be asked with sending disabled.
  if (scope !== 'eligibility' && !explicitConsent) return false;
  if (envBoolean(env.TRTC_PROMPT_REPORTING) === true) return true;
  return promptPreference ?? true;
}

function envBoolean(value) {
  if (value == null) return null;
  const normalized = String(value).trim().toLowerCase();
  if (FALSE_VALUES.has(normalized)) return false;
  if (TRUE_VALUES.has(normalized)) return true;
  return null;
}

export function projectKey(projectRoot) {
  return createHash('sha256').update(canonicalRoot(projectRoot)).digest('hex').slice(0, 32);
}

export function preferencePath(projectRoot) {
  return join(resolveProjectStateDir(canonicalRoot(projectRoot)), PREF_FILE);
}

/** Resolve experience-reporting preference with environment overrides first. */
export function isReportingEnabled(projectRoot, env = process.env) {
  return resolveEffectivePreference(projectRoot, env, 'experience');
}

/** Runtime diagnostics ignore prompt/experience opt-out but never global opt-out. */
export function isReportingEnabledForScope(projectRoot, scope = 'experience', env = process.env) {
  return resolveEffectivePreference(projectRoot, env, scope === 'runtime' ? 'runtime' : 'experience');
}

export function canRequestExperienceConsent(projectRoot, env = process.env) {
  return resolveEffectivePreference(projectRoot, env, 'eligibility');
}

// Local-only authorization generation. Newly authorized projects must never
// release a V1 default-on backlog. Existing explicit V1 agreements still work.
export function consentFields(projectRoot) {
  for (const root of ancestors(projectRoot)) {
    const pref = readPreferenceSourceAt(root, 'preferred');
    if (pref.status === 'valid' && pref.value.continuation_choice === 'allowed') {
      return pref.value.experience_consent_id ? { __consent_id: pref.value.experience_consent_id } : {};
    }
  }
  return {};
}

export function isEventReportingEnabled(projectRoot, event, env = process.env) {
  if (isRuntimeEvent(event)) return isReportingEnabledForScope(projectRoot, 'runtime', env);
  if (!isReportingEnabled(projectRoot, env)) return false;
  const fields = consentFields(projectRoot);
  return !fields.__consent_id || event?.__consent_id === fields.__consent_id;
}

/** Persist only preference data; never copy session/prompt state. */
export function setReportingPreference(projectRoot, enabled, opts = {}) {
  const filePath = preferencePath(projectRoot);
  const dir = dirname(filePath);
  const graceMs = opts.graceMs ?? LOCK_GRACE_FOREGROUND_MS;
  const lock = _acquirePreferenceLock(dir, { graceMs });
  if (!lock.acquired) {
    return { action: 'skip', reason: lock.reason ?? 'busy', enabled: Boolean(enabled), all_reporting_disabled: false, path: filePath };
  }
  try {
    // Use three-state read: corrupt → skip write (don't overwrite)
    const source = readPreferenceSourceAt(canonicalRoot(projectRoot), 'preferred');
    if (source.status === 'corrupt') {
      return { action: 'skip', reason: 'preference_corrupt', enabled: Boolean(enabled), all_reporting_disabled: false, path: filePath };
    }
    let current = source.status === 'valid' ? source.value : {};
    if (source.status === 'missing') {
      const legacy = readPreferenceSourceAt(canonicalRoot(projectRoot), 'legacy');
      const fallback = legacy.status === 'missing' ? _readXdgLegacyCache(projectRoot, opts.env ?? process.env) : legacy;
      if (fallback.status === 'corrupt') return { action: 'skip', reason: 'preference_corrupt', path: filePath };
      if (fallback.status === 'valid') {
        // Copy preferences only, never old prompt/session payloads. A soft
        // settings write must not shadow an older global opt-out.
        for (const field of ['all_reporting_disabled', 'continuation_choice', 'continuation_choice_version']) {
          if (fallback.value[field] !== undefined) current[field] = fallback.value[field];
        }
      }
    }
    const next = {
      ...current,
      prompt_reporting_enabled: Boolean(enabled),
      preference_revision: (current.preference_revision || 0) + 1,
      prompt_reporting_updated_at: Math.floor((typeof opts.now === 'function' ? opts.now() : (opts.now ?? Date.now())) / 1000),
    };
    if (opts.purgePending !== undefined) next.purge_pending = Boolean(opts.purgePending);
    if (opts.allReportingDisabled !== undefined) {
      next.all_reporting_disabled = Boolean(opts.allReportingDisabled);
      next.all_reporting_updated_at = next.prompt_reporting_updated_at;
    }
    const persisted = writeObjectAtomic(filePath, next);
    return {
      action: persisted ? 'updated' : 'skip',
      reason: persisted ? null : 'state-unavailable',
      enabled: Boolean(enabled),
      all_reporting_disabled: next.all_reporting_disabled === true,
      path: filePath,
    };
  } finally {
    _releasePreferenceLock(lock.lockPath, lock.token);
  }
}

/** Read authoritative three-state preference for the project root (preferred only). */
export function readPreferenceState(projectRoot) {
  return readPreferenceSourceAt(canonicalRoot(projectRoot), 'preferred');
}

/** Recognize canonical C20 continuation-choice option labels (exact match, leading/trailing whitespace and trailing punctuation tolerated). */
export function continuationChoiceFromText(text) {
  return isCanonicalOption(text);
}

/**
 * Atomically persist a continuation choice under the preference lock.
 * Returns { action: 'updated' | 'skip' | 'preference_corrupt', reason? }.
 * V2 'denied' disables experience only and preserves the global setting.
 * 'allowed' never widens a pre-existing all_reporting_disabled=true.
 * Corrupt preferred file → returns 'preference_corrupt', file bytes unchanged.
 */
export function setContinuationChoiceLocked(projectRoot, choice, opts = {}) {
  if (!VALID_CONTINUATION_CHOICES.has(choice)) return { action: 'skip', reason: 'invalid_choice' };
  const root = canonicalRoot(projectRoot);
  const dir = resolveProjectStateDir(root);
  const filePath = join(dir, PREF_FILE);
  const graceMs = opts.graceMs ?? LOCK_GRACE_FOREGROUND_MS;
  const lock = _acquirePreferenceLock(dir, { graceMs });
  if (!lock.acquired) return { action: 'skip', reason: lock.reason ?? 'busy' };
  try {
    const source = readPreferenceSourceAt(root, 'preferred');
    if (source.status === 'corrupt') return { action: 'preference_corrupt' };
    // When preferred is absent, check legacy to carry over global-off or detect corruption.
    let current = {};
    if (source.status === 'valid') {
      current = source.value;
    } else {
      const legacy = readPreferenceSourceAt(root, 'legacy');
      if (legacy.status === 'corrupt') {
        // Preferred missing + legacy corrupt → fail-closed; do not create an enabled preferred.
        return { action: 'preference_corrupt' };
      }
      if (legacy.status === 'valid') {
        if (legacy.value.all_reporting_disabled === true) {
          current = { all_reporting_disabled: true };
        }
        // legacy valid but no global-off: start fresh (let 'allowed' restore prompt reporting)
      } else {
        // Both preferred and legacy missing → check XDG cache (same hierarchy as resolver).
        const xdg = _readXdgLegacyCache(root, opts.env ?? process.env);
        if (xdg.status === 'corrupt') {
          return { action: 'preference_corrupt' };
        }
        if (xdg.status === 'valid' && xdg.value.all_reporting_disabled === true) {
          current = { all_reporting_disabled: true };
        }
        // XDG missing or no global-off → start fresh
      }
    }
    const now = Math.floor((typeof opts.now === 'function' ? opts.now() : (opts.now ?? Date.now())) / 1000);
    if (opts.expectedRevision !== undefined && (current.preference_revision || 0) !== opts.expectedRevision) {
      return { action: 'skip', reason: 'preference_changed' };
    }
    if (choice === 'allowed' && current.continuation_choice === 'denied') {
      return { action: 'skip', reason: 'denied_precedence' };
    }
    const revision = typeof current.preference_revision === 'number' ? current.preference_revision : 0;
    const next = {
      ...current,
      continuation_choice: choice,
      continuation_choice_version: CONSENT_VERSION,
      continuation_choice_updated_at: now,
      preference_revision: revision + 1,
    };
    if (choice === 'denied') {
      next.prompt_reporting_enabled = false;
      next.purge_pending = true;
    }
    if (choice === 'allowed') {
      next.prompt_reporting_enabled = true;
      next.experience_consent_id = current.experience_consent_id || randomBytes(16).toString('hex');
    }
    // 'allowed' never touches all_reporting_disabled (global-off preserved)
    const persisted = writeObjectAtomic(filePath, next);
    return { action: persisted ? 'updated' : 'skip', reason: persisted ? null : 'state-unavailable' };
  } finally {
    _releasePreferenceLock(lock.lockPath, lock.token);
  }
}

/** Consume only a reply bound to a current, project-local V2 notice. */
export async function consumeContinuationChoice(projectRoot, text, opts = {}) {
  const explicit = opts.controlChoice ?? opts.control_choice;
  const choice = explicit === 'allow' ? 'allowed'
    : explicit === 'deny' ? 'denied'
      : explicit === 'ambiguous' ? 'ambiguous' : isCanonicalOption(text);
  if (!choice) return null;
  const key = projectKey(projectRoot);
  const receipt = readConsentState(projectRoot, key);
  const skip = (reason) => ({ status: 'skipped', control: true, reason });
  // Explicit classifications never fall through to ordinary staging, even
  // with missing/corrupt/foreign/expired receipts.
  const invalid = (reason) => explicit ? skip(reason) : null;
  if (receipt.status !== 'valid' || receipt.value.notice_count === 0) return invalid('control_context_missing');
  const now = typeof opts.now === 'function' ? opts.now() : (opts.now ?? Date.now());
  if (now < receipt.value.created_at || now - receipt.value.created_at > CONSENT_TTL_MS) {
    updateConsentState(projectRoot, key, (value) => ({ value }), { now });
    return invalid('notice_attempt_expired');
  }
  if (receipt.value.notice_sessionid && opts.sessionid
    && receipt.value.notice_sessionid !== opts.sessionid) return invalid('notice_session_mismatch');
  if (receipt.value.notice_ide && opts.ide && receipt.value.notice_ide !== opts.ide) {
    return invalid('notice_ide_mismatch');
  }
  const pref = readPreferenceState(projectRoot);
  const previous = pref.status === 'valid' ? pref.value.continuation_choice : null;
  if (['allowed', 'denied'].includes(previous)) {
    return { status: 'control_in_progress', control: true, marker: previous === 'allowed' ? ALLOWED : DISABLED };
  }
  if (opts.source === 'hook') {
    return { status: 'skipped', control: true, reason: 'foreground_choice_required' };
  }
  if (choice === 'ambiguous') {
    // Remain pending. One reminder is allowed, and this reply itself is never
    // retained as a Prompt. No "defaulted" state can grant authorization.
    const claim = claimConsentNotice(projectRoot, key, {
      turn: opts.turn, sessionid: opts.sessionid || null, ide: opts.ide,
      locale: receipt.value.notice_locale, now: opts.now || Date.now,
    });
    return { ...skip('ambiguous_choice'), ...(claim.status === 'required'
      ? { marker: NOTICE_REQUIRED, notice: claim } : { notice: { status: claim.status } }) };
  }
  // Persist the accepted enum (never the reply text) before preference work.
  // A failed preference write is resumable without another user decision.
  const accepted = updateConsentState(projectRoot, key, (value) => {
    if (!value) return { status: 'not_found' };
    // A pending refusal wins over a racing allow replay.
    const accepted = value.pending_choice === 'denied' ? 'denied' : choice;
    if (!value.pending_choice || value.pending_choice !== accepted) {
      value.choice_preference_revision = pref.status === 'valid' ? (pref.value.preference_revision || 0) : 0;
    }
    value.pending_choice = accepted;
    return { value };
  }, { now });
  if (accepted.status !== 'updated') return { status: 'control_retry', control: true,
    marker: choice === 'allowed' ? ALLOW_RETRY : DISABLE_RETRY };
  return retryPendingConsentChoice(projectRoot, opts);
}

export function retryPendingConsentChoice(projectRoot, opts = {}) {
  const key = projectKey(projectRoot);
  const receipt = readConsentState(projectRoot, key);
  const now = typeof opts.now === 'function' ? opts.now() : (opts.now ?? Date.now());
  if (receipt.status !== 'valid' || !receipt.value.pending_choice) return null;
  const choice = receipt.value.pending_choice;
  const retry = () => ({ status: 'control_retry', control: true,
    marker: choice === 'allowed' ? ALLOW_RETRY : DISABLE_RETRY });
  // pending_choice was accepted while its notice was valid. Resume that
  // transaction after a long offline period; new expired replies still fail
  // validation in consumeContinuationChoice. The held payload expires normally.
  if (receipt.value.choice_retry_at > now) return { ...retry(), retry_suppressed: true };
  const current = readPreferenceState(projectRoot);
  const revision = current.status === 'valid' ? (current.value.preference_revision || 0) : 0;
  // A later settings/opt-out transaction wins over an earlier failed choice.
  // Also covers a successful preference write whose auxiliary cleanup failed.
  if (revision !== receipt.value.choice_preference_revision) {
    updateConsentState(projectRoot, key, (value) => {
      if (!value) return { status: 'not_found' };
      delete value.pending_choice; delete value.choice_preference_revision;
      delete value.choice_retry_at; delete value.choice_retry_count;
      return { value };
    }, { now });
    return { status: 'skipped', control: true, reason: 'preference_changed' };
  }
  const persisted = setContinuationChoiceLocked(projectRoot, choice, {
    ...opts, expectedRevision: receipt.value.choice_preference_revision,
  });
  if (persisted.action !== 'updated') {
    updateConsentState(projectRoot, key, (value) => {
      if (!value) return { status: 'not_found' };
      value.choice_retry_count = Math.min((value.choice_retry_count || 0) + 1, 7);
      value.choice_retry_at = now + Math.min(60_000, 1000 * 2 ** (value.choice_retry_count - 1));
      return { value };
    }, { now });
    return retry();
  }
  updateConsentState(projectRoot, key, (value) => {
    if (!value) return { status: 'not_found' };
    delete value.pending_choice; delete value.choice_preference_revision;
    delete value.choice_retry_at; delete value.choice_retry_count;
    if (choice === 'denied') { delete value.first_event; value.first_status = 'discarded'; }
    return { value };
  }, { now });
  if (choice === 'denied' && typeof opts.purge === 'function') try { opts.purge(); } catch { /* retry later */ }
  return { status: 'control_in_progress', control: true, marker: choice === 'allowed' ? ALLOWED : DISABLED };
}

/** Compatibility export: V1 defaulting can never authorize or mutate V2. */
export function retryAmbiguousNoticeDefault() {
  return { status: 'skipped', reason: 'explicit_consent_required' };
}

/** Recognize only narrow, explicit opt-in/out control messages. */
export function preferenceFromText(text) {
  if (typeof text !== 'string') return null;
  let normalized = text.trim().replace(/\s+/g, ' ').replace(/[。.!！?？ ]+$/u, '').toLowerCase();
  normalized = normalized.replace(/^(?:请帮我|麻烦帮我|麻烦|帮我|请|please\s+)?/iu, '').trim();
  if (OFF_TEXTS.has(normalized)) return false;
  if (ON_TEXTS.has(normalized)) return true;
  return null;
}

/** Legacy cache location used by reporting.py before project state existed.
 *
 * Migration boundary (C20.1b): resolveEffectivePreference no longer reads
 * this path. Users who stored their preference ONLY in this XDG cache (and
 * never ran the Node runtime after the project-scoped preference.json was
 * introduced) will not inherit their old setting. This is intentional: the
 * new installer (writePromptReportingPreference in bin/cli.js) writes to
 * the project state directory's state.json on every install, so any user who upgrades via
 * the installer will have their preference migrated automatically.
 *
 * If silent migration of the XDG cache is ever needed, add a one-shot read
 * of this path inside the 'both missing' branch of resolveEffectivePreference,
 * guarded by a once-written migration-sentinel flag in preference.json.
 */
export function legacyCachePath(projectRoot, env = process.env) {
  const key = createHash('sha256').update(canonicalRoot(projectRoot)).digest('hex').slice(0, 16);
  const base = env.XDG_CACHE_HOME || join(homedir(), '.cache');
  return join(base, 'trtc-traces', `reporting-state-${key}.json`);
}
