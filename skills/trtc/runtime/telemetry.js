#!/usr/bin/env node
// telemetry.js — dependency-free V2 telemetry CLI entry point.
// IDE Hooks are a disk-only hot path. The installed foreground prompt path
// may perform one bounded flush before the model answer; owner invoke/Host Stop
// can then enrich or retry the same event. Network is also reachable from
// install and explicit event/legacy-send compatibility paths.

import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { performance } from 'node:perf_hooks';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import noticeSpec from './continuation-notice.js';
import { detectNoticeLocale, foregroundNoticeLocale, isNoticeReplayText, noticeTextForLocale } from './notice-locale.js';

import {
  getOrCreate,
  isValidIdentityRecord,
  maintainIdentityState,
  peekIdentity,
  resolveStateRoot,
} from './identity.js';
import { HOOK_TOTAL_BUDGET_MS, parseAdapter, readStdinJson } from './normalize-hook.js';
import {
  listOutbox,
  listPending,
  purgeProjectEvents,
  purgeProjectPromptEvents,
  readEvent,
  resolveTelemetryRoot,
  updatePendingAttribution,
  updateOutboxAttribution,
  writeOutbox,
  writeOutboxFromHook,
  writePending,
  writePendingFromHook,
} from './outbox.js';
import {
  deriveActivationEventId,
  ensureActivationDeviceSeed,
  isHookActivationAcked,
} from './hook-activation.js';
import {
  isReportingEnabled,
  isReportingEnabledForScope,
  consumeContinuationChoice,
  preferenceFromText,
  projectKey,
  readPreferenceState,
  setReportingPreference,
} from './preference.js';
import { sanitizeReportText } from './redact.js';
import {
  acquireCoordinationReservation,
  deriveProjectFallbackSession,
  deriveSessionId as deriveAnonymousSessionId,
  listFreshBindings,
  hasContext,
  markContextConsumed,
  promptFingerprint,
  putContext,
  readContext,
  readStageReceipt,
  readTurnReceipt,
  refreshBinding,
  releaseCoordinationReservation,
  resolveAnonymousSession,
  writeStageReceipt,
  writeTurnReceipt,
} from './session-context.js';
import {
  CLIENT_GENERATION_LEGACY,
  EVENT_TYPES,
  METHOD,
  PLATFORM,
  makeEnvelope,
  validateEvent,
} from './schema.js';
import { resolveSdkAppId } from './sdkappid-resolver.js';
import * as sdkappidCache from './sdkappid-cache.js';
import { projectStateDirs } from './project-state.js';
import {
  CONTROL_RETRY,
  NOTICE_REQUIRED,
  acknowledgeNoticeObligation,
  ensureNoticeObligation,
  isCanonicalOption,
  noticeStatus,
  readNoticeObligation,
  readNoticeReceipt,
  recordNoticeRetry,
  beginProducerLease,
  endProducerLease,
  readEventAcknowledgement,
  readProjectDenyGate,
  writeNoticeReceipt,
} from './control.js';

const INVOKE_FRESHNESS_MS = 30 * 60 * 1000;
// Outbox entries are retained by the storage GC for seven days. A foreground
// entry may retry an already-attributed Prompt for that same bounded window,
// but it must never use the old event as the current turn's attribution.
const OUTBOX_RECOVERY_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const HISTORICAL_OUTBOX_MAX_COUNT = 10;
// If a host permanently drops the first Stop output and the original
// session never returns, a project-scoped pending_output receipt must still
// be recoverable.  Same-session recovery is immediate; a different session
// may take over only after this short grace period.
const PENDING_OUTPUT_CROSS_SESSION_TTL_MS = 60 * 1000;
// The host Hook and the foreground Python compatibility shim can both see
// the same user turn.  The shim usually has no host session id, so use a
// short project-scoped fingerprint window to collapse that duplicate only.
// A later identical prompt remains a new event once this window expires.
const PYTHON_HOOK_DEDUPE_MS = 60_000;
// Keep the Hook identity attempt deliberately bounded. If it contends with
// another process, stage the same event_id with identity_pending and let the
// foreground/Sender path enrich it later.
const HOOK_IDENTITY_MAX_MS = 8;
const HOOK_WRITE_HEADROOM_MS = 2;
// Keep foreground work below the Python compatibility shim's 2500ms timeout.
// Invoke and Host Stop share this one deadline across recovery, metadata,
// promotion and Sender instead of starting independent retry budgets.
const FOREGROUND_TOTAL_BUDGET_MS = 2200;
// Leave process/metadata headroom below the Python shim's 2500ms deadline.
// A slow CLS response is represented by the durable Outbox retry state; it
// must not consume the entire host command budget and get killed mid-result.
const FOREGROUND_FLUSH_BUDGET_MS = 1800;
const RUNTIME_VERSION = process.env.TRTC_TELEMETRY_RUNTIME_VERSION || '0.0.0-dev';
const SAFE_NAME_RE = /^[A-Za-z0-9._+-]{1,128}$/;

const PRODUCT_BY_SKILL = Object.freeze({
  // Docs is an answer-layer owner rather than a product.  Keep it in the
  // validated route-hint set so a dispatcher can explicitly pair
  // `skillname=trtc-docs` with a product such as `chat` without Host Stop
  // falling back to text-based attribution.
  'trtc-docs': 'unknown',
  'trtc-conference': 'conference',
  'trtc-chat': 'chat',
  'trtc-chat-android': 'chat',
  'trtc-chat-docs': 'chat',
  'trtc-call': 'call',
  'trtc-live': 'live',
  'trtc-rtc-engine': 'rtc-engine',
  'trtc-push': 'tim-push',
  // These keys must match the installed Skill frontmatter names, not their
  // directory names or the product labels used by the Root router.
  'trtc-ai-customer-service-skill': 'ai-service',
  'ai-oral-coach-skill': 'oral-coach',
  'trtc-ai-realtime-interpreter': 'realtime-interpreter',
  'trtc-sdk-log-analysis': 'unknown',
});

// Older Root instructions used directory-shaped names for the two
// Conversational AI owners. Accept them only as input compatibility aliases,
// but canonicalize them before persistence and before mapping to CLS `level`.
// New dispatcher handoffs must always send the exact frontmatter name.
const ROUTE_HINT_ALIASES = Object.freeze({
  'trtc-ai-service': 'trtc-ai-customer-service-skill',
  'trtc-ai-oral-coach': 'ai-oral-coach-skill',
});

// Codex creates a background "Overview" task for its own suggestions. That
// task is not a user Prompt and must not enter the reporting state machine.
// Only host-controlled metadata is trusted here.  Body matching is unsafe:
// a user can legitimately paste the same template and it must remain a
// reportable Prompt even when the host omitted `user_initiated`.
function isCodexInternalPrompt(prompt, input, flags) {
  const ide = safeName(flags?.ide || input?.ide, 'unknown');
  if (ide !== 'codex' || input?.user_initiated === true) return false;
  if (input?.internal === true || input?.is_internal === true) return true;
  const hostSource = typeof input?.host_source === 'string' ? input.host_source.toLowerCase() : '';
  const hostKind = typeof input?.host_kind === 'string' ? input.host_kind.toLowerCase() : '';
  if (['internal', 'background', 'suggestion', 'suggestions', 'codex_suggestions', 'host_internal'].includes(hostSource)
    || ['internal', 'background', 'suggestion', 'suggestions', 'codex_suggestions'].includes(hostKind)) return true;
  return false;
}

// Host lifecycle fallback. Prompt Hooks remain disk-only; when a host does not
// execute the foreground Dispatcher instruction, its post-answer Stop hook can
// call host-stop to promote/flush the already-staged Prompt. In the normal
// foreground path the Prompt has already had its bounded first send, and the
// owner step only enriches or retries the same event. Host Stop never infers
// an owner from free-form Prompt text; only a validated dispatcher route hint
// can provide answer-layer attribution.
// CodeBuddy maps a rejected Stop hook's `message` to a hidden
// <system_reminder>. It does not render that value directly, so make the
// continuation instruction explicit and require the model to show the frozen
// notice verbatim in its next user-visible response.
function codebuddyNoticeFeedback(locale) {
  const instruction = locale === 'en-US'
    ? 'In your next reply, show the following fixed notice to the user verbatim. Do not rewrite, summarize, or continue the integration steps:'
    : '请在下一条回复中，向用户原样展示下面的固定提示，不要改写、总结或继续执行集成步骤：';
  return `${instruction}\n\n${noticeTextForLocale(locale)}`;
}

function inferHostFramework(text) {
  const value = typeof text === 'string' ? text.toLowerCase() : '';
  if (/\bflutter\b/.test(value)) return 'flutter';
  if (/\bandroid\b/.test(value)) return 'android';
  if (/\bios\b|swift|objective-c/.test(value)) return 'ios';
  if (/\bvue(?:\s*3)?\b/.test(value)) return 'vue';
  if (/\breact\b/.test(value)) return 'react';
  if (/\bweb\b|网页|浏览器/.test(value)) return 'web';
  return 'unknown';
}

// ── Web Adapter lazy loader ───────────────────────────────────────────────────
// Resolver never loads modules; telemetry provides the factory via _loadWebAdapter.
const _runtimeDir =
  typeof __dirname === 'string'
    ? __dirname
    : dirname(fileURLToPath(import.meta.url));
const _runtimeRequire = createRequire(join(_runtimeDir, 'telemetry.cjs'));

let _webAdapterResult; // undefined = not yet attempted
function getWebAdapter() {
  if (_webAdapterResult !== undefined) return _webAdapterResult;
  const bundlePath = join(_runtimeDir, 'sdkappid-resolver-web.cjs');
  try {
    if (!existsSync(bundlePath)) {
      _webAdapterResult = { adapter: null, failure: 'missing' };
    } else {
      _webAdapterResult = { adapter: _runtimeRequire('./sdkappid-resolver-web.cjs'), failure: null };
    }
  } catch {
    _webAdapterResult = { adapter: null, failure: 'load_error' };
  }
  return _webAdapterResult;
}

// Writes a minimal adapter diagnostic file on failure.
// Atomic: writes .tmp with unique name then renames. Never throws.
function writeAdapterDiagnostic(stateRoot, reason) {
  if (!stateRoot) return;
  try {
    const telDir = join(stateRoot, 'telemetry');
    mkdirSync(telDir, { recursive: true, mode: 0o700 });
    const finalPath = join(telDir, 'sdkappid-adapter-diag.json');
    const rand = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
    const tmpPath = join(telDir, `.sdkappid-adapter-diag.${process.pid}.${rand}.tmp`);
    const content = JSON.stringify({
      status: reason,
      updated_at: Math.floor(Date.now() / 1000),
      resolver_version: '18.4',
    });
    writeFileSync(tmpPath, content, { mode: 0o600 });
    renameSync(tmpPath, finalPath);
  } catch { /* fail-open — diagnostics must never throw */ }
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const flags = {};
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i];
    if (!token.startsWith('--')) continue;
    const eq = token.indexOf('=');
    if (eq > 2) {
      flags[token.slice(2, eq)] = token.slice(eq + 1);
    } else if (i + 1 < rest.length && !rest[i + 1].startsWith('--')) {
      flags[token.slice(2)] = rest[++i];
    } else {
      flags[token.slice(2)] = true;
    }
  }
  return { command, flags };
}

const HOST_STATE_ROOT_MARKERS = Object.freeze([
  ['.trtc-skill-state', 'host-state-root.json'],
  ['.trtc-reporting', 'host-state-root.json'],
]);

// A Codex state root is a durable binding, not an arbitrary directory hint.
// Validate explicit values again at the Node boundary because Hook config and
// the Python shim can be stale or user-editable.  In particular, never follow
// a symlink (or recreate a deleted root) into another project's state.
function validateCodexStateRoot(value, { create = false } = {}) {
  if (typeof value !== 'string' || !value || !isAbsolute(value)) {
    return { status: 'invalid', error: 'relative_path' };
  }
  const candidate = resolve(value);
  try {
    let stat;
    try {
      stat = lstatSync(candidate);
    } catch (err) {
      if (!create || err?.code !== 'ENOENT') throw err;
      const parent = dirname(candidate);
      const parentStat = lstatSync(parent);
      if (parentStat.isSymbolicLink() || !parentStat.isDirectory()) {
        return { status: 'unavailable', error: 'state_root_unavailable' };
      }
      mkdirSync(candidate, { recursive: true, mode: 0o700 });
      stat = lstatSync(candidate);
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      return { status: 'unavailable', error: 'state_root_unavailable' };
    }
    return { status: 'valid', stateRoot: realpathSync(candidate) };
  } catch {
    // A committed Codex binding must point at an existing directory.  Its
    // removal is a repair condition, not permission to silently create a new
    // root and mint a different identity.
    return { status: 'unavailable', error: 'state_root_unavailable' };
  }
}

function validStateRootGeneration(value) {
  return typeof value === 'string' && /^[0-9a-f]{32}$/.test(value);
}

function readCodexStateRootBinding(projectRoot) {
  for (const [dir, file] of HOST_STATE_ROOT_MARKERS) {
    const markerPath = join(projectRoot, dir, file);
    if (!existsSync(markerPath)) continue;
    try {
      if (lstatSync(markerPath).isSymbolicLink() || lstatSync(join(projectRoot, dir)).isSymbolicLink()) {
        return { status: 'invalid', error: 'symlink_path' };
      }
      const value = JSON.parse(readFileSync(markerPath, 'utf8'));
      let entry;
      if (value?.schema_version === 1) entry = value;
      else if (value?.schema_version === 2) entry = value.bindings?.codex;
      else return { status: 'invalid', error: 'unsupported_schema' };
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)
        || (entry.status || 'ready') !== 'ready'
        || typeof entry.state_root !== 'string' || !entry.state_root
        || (entry.generation !== undefined && !validStateRootGeneration(entry.generation))) {
        return { status: 'invalid', error: 'malformed_binding' };
      }
      const candidate = resolve(entry.state_root);
      if (!candidate.startsWith('/') && process.platform !== 'win32') return { status: 'invalid', error: 'relative_path' };
      const checked = validateCodexStateRoot(entry.state_root);
      if (checked.status !== 'valid') return checked;
      const generation = entry.generation || null;
      for (const [stateDir, filename, key] of [
        ['.trtc-skill-state', 'install-mode.json', 'install_generation'],
        ['.trtc-skill-state', 'runtime-binding.json', 'codex'],
        ['.trtc-reporting', 'install-mode.json', 'install_generation'],
        ['.trtc-reporting', 'runtime-binding.json', 'codex'],
      ]) {
        const sibling = join(projectRoot, stateDir, filename);
        if (!existsSync(sibling)) continue;
        try {
          const parsed = JSON.parse(readFileSync(sibling, 'utf8'));
          const expected = key === 'codex'
            ? parsed?.bindings?.codex?.generation
            : parsed?.[key];
          if (generation && typeof expected === 'string' && expected !== generation) {
            return { status: 'invalid', error: 'generation_mismatch' };
          }
        } catch { return { status: 'invalid', error: 'generation_mismatch' }; }
      }
      return { status: 'valid', stateRoot: checked.stateRoot, generation, markerPath };
    } catch (err) {
      return { status: 'invalid', error: err?.code === 'ENOENT' ? 'state_root_unavailable' : 'malformed_binding' };
    }
  }
  return { status: 'missing' };
}

function stateRootContainsProjectData(stateRoot, projectRoot) {
  const key = projectKey(projectRoot);
  for (const bucket of ['pending', 'outbox', 'ack', 'acknowledgements']) {
    const directory = join(stateRoot, 'telemetry', bucket);
    let entries;
    try { entries = readdirSync(directory, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries.slice(0, 256)) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      try {
        const value = JSON.parse(readFileSync(join(directory, entry.name), 'utf8'));
        if (value && value.__project_key === key) return true;
      } catch { /* unrelated or corrupt files do not prove ownership */ }
    }
  }
  return false;
}

function resolveLegacyCodexStateRoot(env, projectRoot) {
  const configured = resolveStateRoot(env);
  const defaultEnv = { ...env };
  delete defaultEnv.TRTC_TELEMETRY_STATE_ROOT;
  const platformDefault = resolveStateRoot(defaultEnv);
  const configuredCheck = validateCodexStateRoot(configured);
  if (configured !== platformDefault
    && configuredCheck.status === 'valid'
    && stateRootContainsProjectData(configuredCheck.stateRoot, projectRoot)) {
    return { stateRoot: configuredCheck.stateRoot, source: 'legacy_default' };
  }
  return { stateRoot: platformDefault, source: 'default' };
}

function isCodexInvocation(flags = {}) {
  if (flags?.ide === 'codex') return true;
  return String(flags?.['installed-ides'] || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .includes('codex');
}

function resolveRuntimeStateRoot({ flags, opts, cwd, env }) {
  const codexInvocation = isCodexInvocation(flags);
  const explicit = opts.stateRoot || flags['state-root'];
  if (explicit) {
    if (typeof explicit !== 'string' || !isAbsolute(explicit)) {
      return { status: 'invalid', error: 'relative_path' };
    }
    if (codexInvocation) {
      // Explicit roots are used by isolated tests/repair commands and may be
      // a new child of a trusted parent. Marker-backed roots use the stricter
      // non-creating path above.
      const checked = validateCodexStateRoot(explicit, { create: true });
      return { ...checked, source: 'explicit', bound: true };
    }
    return { status: 'valid', stateRoot: explicit, source: 'explicit', bound: false };
  }
  if (!codexInvocation) {
    return { status: 'valid', stateRoot: resolveStateRoot(env), source: 'default', bound: false };
  }
  const projectRoot = findProjectRoot(flags.cwd || cwd);
  const binding = readCodexStateRootBinding(projectRoot);
  if (binding.status === 'valid') return { ...binding, bound: true, source: 'marker' };
  if (binding.status === 'invalid' || binding.status === 'unavailable') return binding;
  return { status: 'valid', ...resolveLegacyCodexStateRoot(env, projectRoot), bound: false };
}

function canonicalize(path) {
  const absolute = resolve(path || process.cwd());
  try { return realpathSync(absolute); } catch { return absolute; }
}

function findProjectRoot(start) {
  const startRoot = canonicalize(start);
  let current = startRoot;
  while (true) {
    if (existsSync(join(current, 'pnpm-workspace.yaml'))
      || existsSync(join(current, 'lerna.json'))
      || existsSync(join(current, 'turbo.json'))
      || existsSync(join(current, '.trtc-session.yaml'))) {
      return current;
    }
    const packagePath = join(current, 'package.json');
    if (existsSync(packagePath)) {
      try {
        const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
        if (packageJson && packageJson.workspaces) return current;
      } catch { /* malformed package continues the walk */ }
    }
    if (existsSync(join(current, '.git'))) return current;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  if (existsSync(join(startRoot, 'package.json'))) return startRoot;
  return startRoot;
}

const C19_MODE_SCHEMA_VERSION = 2;
const C19_MODE_SCHEMA_VERSIONS = new Set([1, C19_MODE_SCHEMA_VERSION]);
const C19_IDE_ROOTS = Object.freeze({
  claude: '.claude',
  cursor: '.cursor',
  codebuddy: '.codebuddy',
  codex: '.codex',
});
const C19_LEGACY_INSTRUCTION_FILES = Object.freeze([
  'CLAUDE.md', 'AGENTS.md', 'CODEBUDDY.md', '.cursor/rules/ui-mode.mdc',
]);
const C19_LEGACY_INSTRUCTIONS_BY_IDE = Object.freeze({
  claude: ['CLAUDE.md'],
  cursor: ['.cursor/rules/ui-mode.mdc'],
  codebuddy: ['CODEBUDDY.md'],
  codex: ['AGENTS.md'],
});
const C19_LEGACY_HOOKS_BY_IDE = Object.freeze({
  claude: ['.claude/settings.json'],
  cursor: ['.cursor/hooks.json'],
  codebuddy: ['.codebuddy/settings.json'],
  codex: ['.codex/hooks.json'],
});
const C19_LEGACY_IDES = Object.freeze(['claude', 'cursor', 'codebuddy', 'codex']);
const C19_LEGACY_MCP_NAME = 'tencent-rtc-skill-tool';

function c19SafeReadJson(file) {
  try {
    return { exists: true, value: JSON.parse(readFileSync(file, 'utf8')) };
  } catch (err) {
    return err?.code === 'ENOENT' ? { exists: false, value: null } : { exists: true, value: null };
  }
}

function c19ValidMarker(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && C19_MODE_SCHEMA_VERSIONS.has(value.schema_version)
    && ['node_v2', 'legacy_mcp'].includes(value.mode)
    && typeof value.installer_version === 'string' && value.installer_version.length <= 128
    && typeof value.updated_at === 'string' && value.updated_at.length > 0
    && (!Object.prototype.hasOwnProperty.call(value, 'install_generation')
      || (typeof value.install_generation === 'string' && /^[0-9a-f]{32}$/.test(value.install_generation)))
    && (!Object.prototype.hasOwnProperty.call(value, 'install_ides')
      || (Array.isArray(value.install_ides) && value.install_ides.length > 0
        && value.install_ides.every((ide) => C19_LEGACY_IDES.includes(ide))
        && new Set(value.install_ides).size === value.install_ides.length))
    && (!Object.prototype.hasOwnProperty.call(value, 'ide_modes')
      || (value.ide_modes && typeof value.ide_modes === 'object' && !Array.isArray(value.ide_modes)
        && Object.entries(value.ide_modes).every(([ide, mode]) => C19_LEGACY_IDES.includes(ide)
          && ['node_v2', 'legacy_mcp'].includes(mode))));
}

function c19LegacySkillFootprint(projectRoot, ide) {
  const roots = ide && C19_IDE_ROOTS[ide]
    ? [C19_IDE_ROOTS[ide]]
    : Object.values(C19_IDE_ROOTS);
  for (const ideRoot of roots) {
    const skill = join(projectRoot, ideRoot, 'skills', 'trtc');
    if (existsSync(join(skill, 'SKILL.md'))
      && existsSync(join(skill, 'tools', 'reporting.py'))
      && !existsSync(join(skill, 'runtime', 'telemetry.cjs'))) return true;
  }
  return false;
}

function c19LegacyInstructionFootprint(projectRoot, ide) {
  const files = ide && C19_LEGACY_INSTRUCTIONS_BY_IDE[ide]
    ? C19_LEGACY_INSTRUCTIONS_BY_IDE[ide]
    : C19_LEGACY_INSTRUCTION_FILES;
  for (const relative of files) {
    try {
      const text = readFileSync(join(projectRoot, relative), 'utf8');
      if (/reporting\.py\s+(?:bind-session)|tencent-rtc-skill-tool|skill_analysis/.test(text)) return true;
    } catch { /* absent/unreadable user files do not become evidence */ }
  }
  return false;
}

function c19LegacyHookFootprint(projectRoot, ide) {
  const files = ide && C19_LEGACY_HOOKS_BY_IDE[ide]
    ? C19_LEGACY_HOOKS_BY_IDE[ide]
    : Object.values(C19_LEGACY_HOOKS_BY_IDE).flat();
  for (const relative of files) {
    try {
      if (/reporting\.py|tencent-rtc-skill-tool|skill_analysis/.test(readFileSync(join(projectRoot, relative), 'utf8'))) return true;
    } catch { /* absent/unreadable user files do not become evidence */ }
  }
  return false;
}

function c19LegacyProjectMcpFootprint(projectRoot, ide) {
  if (ide && ide !== 'claude') return false;
  try {
    const value = JSON.parse(readFileSync(join(projectRoot, '.mcp.json'), 'utf8'));
    const entry = value?.mcpServers?.[C19_LEGACY_MCP_NAME];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
    if (Object.keys(entry).some((key) => !['command', 'args', 'type', 'env'].includes(key))) return false;
    if (entry.command !== 'npx' || !Array.isArray(entry.args) || entry.args.length !== 2
      || entry.args[0] !== '-y' || entry.args[1] !== '@tencent-rtc/skill-tool@latest') return false;
    if (entry.type !== undefined && entry.type !== 'stdio') return false;
    if (entry.env !== undefined) {
      if (!entry.env || typeof entry.env !== 'object' || Array.isArray(entry.env)) return false;
      const keys = Object.keys(entry.env);
      if (keys.length > 1 || (keys.length === 1 && (keys[0] !== 'PATH' || typeof entry.env.PATH !== 'string'))) return false;
    }
    return true;
  } catch { return false; }
}

function c19InstallStageState(projectRoot) {
  for (const dir of projectStateDirs(projectRoot)) {
    const result = c19SafeReadJson(join(dir, 'install-stage.json'));
    // Any stage file without a valid completed marker is an in-flight or
    // interrupted install. Runtime must wait for the installer to resume or
    // reject it; it must never enable a second chain while the stage exists.
    if (result.exists) return 'unknown';
  }
  return null;
}

// install-stage.json is intentionally treated as unknown for all normal
// Prompt/Invoke paths.  Permit only the installer-owned install event when
// the caller proves it is the live process that owns the stage transaction.
function c19InstallerOwnsActiveStage(projectRoot, ownerToken) {
  if (typeof ownerToken !== 'string' || !/^[0-9a-f]{32}$/.test(ownerToken)) return false;
  for (const dir of projectStateDirs(projectRoot)) {
    const stage = join(dir, 'install-stage.json');
    try {
      if (!existsSync(stage)) continue;
      if (lstatSync(dir).isSymbolicLink() || lstatSync(stage).isSymbolicLink()) return false;
      const parsed = JSON.parse(readFileSync(stage, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
      if (!C19_MODE_SCHEMA_VERSIONS.has(parsed.schema_version)
        || parsed.target_mode !== 'node_v2'
        || !['started', 'hooks', 'instructions', 'mcp', 'complete'].includes(parsed.stage)
        || parsed.owner_token !== ownerToken
        || !Number.isInteger(parsed.pid) || parsed.pid <= 0) return false;
      try {
        process.kill(parsed.pid, 0);
        return true;
      } catch (err) {
        return err?.code === 'EPERM';
      }
    } catch {
      return false;
    }
  }
  return false;
}

// A crash can occur after the installer commits the Node marker but before it
// reaches the runtime's `install` command.  Such a stage is safe to recover
// from a normal foreground entry: the marker and generation bind the record
// to this exact installation, while the event_id makes retries idempotent.
// Incomplete stages remain fail-safe/unknown and are never sent by Runtime.
function c19RecoverableInstallStage(projectRoot, ide) {
  const root = resolve(projectRoot);
  for (const dir of projectStateDirs(root)) {
    const stagePath = join(dir, 'install-stage.json');
    const markerPath = join(dir, 'install-mode.json');
    try {
      if (lstatSync(dir).isSymbolicLink() || lstatSync(stagePath).isSymbolicLink()
        || lstatSync(markerPath).isSymbolicLink()) continue;
    } catch (err) {
      if (err?.code !== 'ENOENT') continue;
    }
    const stageResult = c19SafeReadJson(stagePath);
    const markerResult = c19SafeReadJson(markerPath);
    const stage = stageResult.value;
    const marker = markerResult.value;
    if (!stageResult.exists || !stageResult.value || !markerResult.exists || !c19ValidMarker(marker)) continue;
    if (stage.target_mode !== 'node_v2' || stage.stage !== 'complete'
      || typeof stage.owner_token !== 'string' || !/^[0-9a-f]{32}$/.test(stage.owner_token)
      || typeof stage.install_event_id !== 'string' || stage.install_event_id.length === 0
      || stage.install_acknowledged === true
      || marker.mode !== 'node_v2'
      || marker.install_generation !== stage.owner_token) continue;
    const stageIdes = Array.isArray(stage.install_ides) ? [...new Set(stage.install_ides)].sort() : [];
    const markerIdes = Array.isArray(marker.install_ides) ? [...new Set(marker.install_ides)].sort() : [];
    if (stageIdes.length === 0 || markerIdes.length === 0
      || stageIdes.join(',') !== markerIdes.join(',')
      || (ide && !stageIdes.includes(ide))) continue;
    return {
      stagePath,
      stateDir: dir,
      ownerToken: stage.owner_token,
      eventId: stage.install_event_id,
      installedIdes: stageIdes,
      version: typeof stage.installer_version === 'string' ? stage.installer_version : 'unknown',
      // `target_mode` describes the reporting chain; `install_mode` is the
      // user's invocation shape (auto/specific/all) and must remain distinct
      // when an install event is rebuilt after a crash.
      installMode: ['auto', 'specific', 'all'].includes(stage.install_mode)
        ? stage.install_mode : 'unknown',
      installStatus: ['completed', 'partial', 'failed'].includes(stage.install_status)
        ? stage.install_status : 'completed',
      hookResults: stage.install_hook_results && typeof stage.install_hook_results === 'object'
        && !Array.isArray(stage.install_hook_results) ? stage.install_hook_results : {},
      os: typeof stage.install_os === 'string' ? stage.install_os : process.platform,
      migration: stage.migration,
    };
  }
  return null;
}

function c19WriteInstallRecoveryAck(record, acknowledged) {
  if (!record?.stagePath || typeof record.ownerToken !== 'string') return false;
  let current;
  try {
    if (lstatSync(record.stagePath).isSymbolicLink()) return false;
    current = JSON.parse(readFileSync(record.stagePath, 'utf8'));
  } catch { return false; }
  if (!current || current.owner_token !== record.ownerToken || current.stage !== 'complete') return false;
  if (!acknowledged) return true;
  current.install_acknowledged = true;
  if (current.migration && typeof current.migration === 'object' && !Array.isArray(current.migration)) {
    current.migration = { ...current.migration, install_ack_pending: false };
  }
  // A non-migration stage has no backup transaction left to clean up. Remove
  // it after ACK so the next Runtime entry does not attempt the same logical
  // install again. Migration stages stay durable until the installer cleans
  // their validated backup root.
  if (!current.migration) {
    try { unlinkSync(record.stagePath); return true; } catch (err) { return err?.code === 'ENOENT'; }
  }
  const tmp = `${record.stagePath}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  try {
    writeFileSync(tmp, `${JSON.stringify({ ...current, updated_at: new Date().toISOString() }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    renameSync(tmp, record.stagePath);
    return true;
  } catch {
    try { unlinkSync(tmp); } catch { /* best effort */ }
    return false;
  }
}

function readNodeReportingMode(projectRoot, env = process.env, ide) {
  const root = resolve(projectRoot);
  const targetIdes = ide && C19_LEGACY_IDES.includes(ide) ? [ide] : C19_LEGACY_IDES;
  for (const dir of projectStateDirs(root)) {
    const marker = join(dir, 'install-mode.json');
    try {
      if (lstatSync(dir).isSymbolicLink() || lstatSync(marker).isSymbolicLink()) return 'unknown';
    } catch (err) {
      if (err?.code !== 'ENOENT') return 'unknown';
    }

    const markerResult = c19SafeReadJson(marker);
    if (!markerResult.exists) continue;
    if (!c19ValidMarker(markerResult.value)) return 'unknown';
    const ideModes = markerResult.value.ide_modes;
    if (ideModes && markerResult.value.schema_version >= 2) {
      const resolvedModes = targetIdes.map((targetIde) => {
        const mapped = ideModes[targetIde];
        if (mapped === 'node_v2') {
          // A committed per-IDE Node marker is not enough if the old chain
          // has reappeared for that same IDE (manual restore, stale config,
          // or a partial upgrade). Refuse Node V2 rather than dual-send.
          if (c19LegacyProjectMcpFootprint(root, targetIde)
            || c19LegacySkillFootprint(root, targetIde)
            || c19LegacyInstructionFootprint(root, targetIde)
            || c19LegacyHookFootprint(root, targetIde)) return 'unknown';
          return 'node_v2';
        }
        if (mapped === 'legacy_mcp') return 'legacy_mcp';
        if (c19LegacyProjectMcpFootprint(root, targetIde)
          || c19LegacySkillFootprint(root, targetIde)
          || c19LegacyInstructionFootprint(root, targetIde)
          || c19LegacyHookFootprint(root, targetIde)) return 'legacy_mcp';
        return 'node_v2';
      });
      if (resolvedModes.includes('legacy_mcp') && resolvedModes.includes('node_v2')) return 'unknown';
      if (resolvedModes.every((value) => value === 'legacy_mcp')) return 'legacy_mcp';
      if (resolvedModes.every((value) => value === 'node_v2')) return 'node_v2';
      return 'unknown';
    }
    if (markerResult.value.mode === 'legacy_mcp') return 'legacy_mcp';
    // A node marker combined with an old project footprint is contradictory;
    // preserve the project rather than allowing Node and MCP to run together.
    if (targetIdes.some((targetIde) => c19LegacyProjectMcpFootprint(root, targetIde)
      || c19LegacySkillFootprint(root, targetIde)
      || c19LegacyInstructionFootprint(root, targetIde)
      || c19LegacyHookFootprint(root, targetIde))) return 'unknown';
    return 'node_v2';
  }

  if (c19InstallStageState(root) !== null) return 'unknown';
  // With no marker, an old Skill/instructions/Hook is enough to prevent an
  // accidental second chain. The installer may classify a subset as
  // legacy_mcp, but Runtime choosing unknown here is the safe superset.
  if (targetIdes.some((targetIde) => c19LegacyProjectMcpFootprint(root, targetIde)
    || c19LegacySkillFootprint(root, targetIde)
    || c19LegacyInstructionFootprint(root, targetIde)
    || c19LegacyHookFootprint(root, targetIde))) return 'unknown';
  // A user-level old MCP alone is intentionally ignored; it cannot identify
  // this project and must not contaminate a fresh Node V2 install.
  void env;
  return 'node_v2';
}

function nodeReportingAllowed(projectRoot, env = process.env, ide) {
  return readNodeReportingMode(projectRoot, env, ide) === 'node_v2';
}

export function resolveProjectRoot({ explicitCwd, normalized, processCwd = process.cwd() } = {}) {
  const candidate = explicitCwd
    || normalized?.cwd
    || normalized?.workspace_roots?.[0]
    || processCwd;
  return findProjectRoot(candidate);
}

export function deriveSessionId(normalized, projectRoot) {
  return deriveAnonymousSessionId(projectRoot, normalized?.ide, normalized?.session_id)
    || deriveProjectFallbackSession(projectRoot);
}

function safeName(value, fallback = 'unknown') {
  return typeof value === 'string' && SAFE_NAME_RE.test(value) ? value : fallback;
}

function validRouteHint(value) {
  const hint = safeName(value, '');
  const canonical = ROUTE_HINT_ALIASES[hint] || hint;
  return Object.prototype.hasOwnProperty.call(PRODUCT_BY_SKILL, canonical) ? canonical : '';
}

function remaining(deadlineMono) {
  return Math.max(0, deadlineMono - performance.now());
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
    timeoutMs: opts.hook ? Math.min(25, Math.max(0, remaining(opts.deadlineMono || (performance.now() + 25)))) : (opts.timeoutMs ?? 120),
    _hookMode: opts.hook === true,
  });
}

function stopProducerLease(result) {
  if (result?.lease) endProducerLease(result.lease);
}

function writeOutboxWithProducerLease(ctx, key, event, opts = {}) {
  // Producer and per-event reservation are two different locks. Both must
  // consume the same foreground budget; otherwise a contended Outbox lock can
  // wait for its default 1000ms after the producer lease already used the
  // caller's remaining time.
  const deadlineMono = opts.deadlineMono ?? ctx.deadlineMono;
  const remainingBudget = Number.isFinite(deadlineMono) ? remaining(deadlineMono) : Infinity;
  const requestedTimeout = Number.isFinite(opts.timeoutMs) ? Math.max(0, opts.timeoutMs) : 120;
  const leaseTimeout = Math.min(requestedTimeout, remainingBudget);
  const producer = startProducerLease(ctx, key, {
    ...opts,
    timeoutMs: leaseTimeout,
    deadlineMono,
  });
  if (producer.blocked) return { status: producer.retryable ? 'retryable' : 'disabled', reason: producer.reason };
  try {
    const reservationBudget = Number.isFinite(deadlineMono)
      ? Math.min(
        Number.isFinite(opts.reservationTimeoutMs)
          ? Math.max(0, opts.reservationTimeoutMs)
          : requestedTimeout,
        remaining(deadlineMono),
      )
      : (Number.isFinite(opts.reservationTimeoutMs)
        ? Math.max(0, opts.reservationTimeoutMs) : requestedTimeout);
    const written = writeOutbox(ctx.stateRoot, event, {
      projectKey: key,
      enforceProjectGate: true,
      reservationTimeoutMs: reservationBudget,
      ...(opts._hookMode === true ? { _hookMode: true } : {}),
    });
    return written?.status === 'blocked'
      ? { status: 'disabled', reason: written.reason }
      : written;
  } finally { stopProducerLease(producer); }
}

function pendingEventForProject(stateRoot, eventId, key) {
  const paths = [...listPending(stateRoot), ...listOutbox(stateRoot)];
  for (const path of paths) {
    if (basename(path) !== `${eventId}.json`) continue;
    const event = readEvent(path);
    if (!event || event.__project_key !== key || event.method !== METHOD.PROMPT) return null;
    return event;
  }
  return null;
}

// Project receipts remain writable when a Codex tool cannot write the
// user-level queue. They carry attribution for the SAME existing event, not
// another queue. All writers acquire this stage lock before an event lock.
function codexStageLocator(event) {
  const sessionid = eventCorrelationKey(event);
  if (event?.ide !== 'codex' || !sessionid || !event.__prompt_fingerprint) return null;
  const stageKey = event.turn_id ? `turn:${event.turn_id}` : `fingerprint:${event.__prompt_fingerprint}`;
  return { sessionid, stageKey, lockKey: `${sessionid}:${stageKey}` };
}

function codexSnapshotFrozen(ctx, key, event) {
  return event.__sender_acknowledged === true
    || readEventAcknowledgement(ctx.stateRoot, key, event.event_id).status === 'valid'
    || listOutbox(ctx.stateRoot).some((path) => basename(path) === `${event.event_id}.json`);
}

// Caller holds the stage lock until promotion, or until this local-only
// write completes. A receipt from a different event never supplies an owner.
function codexReceiptAttribution(projectRoot, event, input = {}) {
  const locator = codexStageLocator(event);
  if (!locator) return { event };
  // A crash may leave Pending durable before the receipt rename. Rebuild
  // only a missing receipt from this exact matched event; never overwrite a
  // corrupt receipt or another event's identity.
  const stored = readStageReceipt(projectRoot, locator.sessionid, locator.stageKey, { reportInvalid: true });
  if (stored && stored.event_id !== event.event_id) return { event, error: 'stage_receipt_mismatch' };
  const receipt = stored || { event_id: event.event_id, sessionid: locator.sessionid,
    source: event.__stage_source, claimed_sources: [event.__stage_source], time: event.time };
  const previous = validRouteHint(receipt.route_hint || event.__route_hint);
  const requested = validRouteHint(input.route_hint);
  if (previous && requested && previous !== requested) return { event, error: 'owner_mismatch' };
  const owner = requested || previous;
  if (!owner) return { event };
  const known = (value) => {
    const name = safeName(value, '');
    return name && name !== 'unknown' ? name : null;
  };
  const product = known(input.product) || known(receipt.product) || known(event.__route_product) || PRODUCT_BY_SKILL[owner];
  const framework = known(input.framework) || known(receipt.framework) || known(event.__route_framework);
  if (!stored || receipt.route_hint !== owner || receipt.product !== product || receipt.framework !== framework) {
    writeStageReceipt(projectRoot, locator.sessionid, locator.stageKey, {
      ...receipt, route_hint: owner, ...(product ? { product } : {}), ...(framework ? { framework } : {}),
    });
  }
  return { event: { ...event, __route_hint: owner,
    ...(product ? { __route_product: product } : {}),
    ...(framework ? { __route_framework: framework } : {}),
  } };
}

function preserveCodexForegroundRoute(input, flags, ctx, deadlineMono) {
  if (safeName(flags.ide || input?.ide, 'unknown') !== 'codex') return null;
  const text = input?.text ?? input?.prompt;
  if (typeof text !== 'string' || !text || isCodexInternalPrompt(text, input, flags)
    || input.control_choice || isNoticeReplayText(text)
    || preferenceFromText(text) !== null || isCanonicalOption(text) !== null) return null;
  const projectRoot = resolveProjectRoot({ explicitCwd: flags.cwd || input.cwd, normalized: input, processCwd: ctx.cwd });
  const key = projectKey(projectRoot);
  if (!nodeReportingAllowed(projectRoot, ctx.env, 'codex')
    || !isReportingEnabled(projectRoot, ctx.env) || promptDenyReason(ctx.stateRoot, key)) return null;
  const fingerprint = promptFingerprint(sanitizeReportText(text).trim());
  const turn = typeof input.turn_id === 'string' && input.turn_id ? input.turn_id : null;
  const raw = ['raw_session_id', 'session_id', 'conversation_id', 'thread_id']
    .map((field) => input[field]).find((value) => typeof value === 'string' && value.length > 0);
  const hint = raw || (typeof input.host_thread_hint === 'string' ? input.host_thread_hint : null);
  const session = hint ? deriveAnonymousSessionId(projectRoot, 'codex', hint) : null;
  const mapped = turn ? readTurnReceipt(projectRoot, 'codex', turn) : null;
  if (mapped?.status === 'corrupt') return { status: 'retryable', error: 'turn_receipt_corrupt', durable: false };
  const candidates = [...listPending(ctx.stateRoot), ...listOutbox(ctx.stateRoot)].map(readEvent)
    .filter((event) => event?.method === METHOD.PROMPT && event.ide === 'codex'
      && event.__project_key === key && event.__prompt_fingerprint === fingerprint
      && (!mapped || event.event_id === mapped.event_id)
      && (!turn || event.turn_id === turn)
      && (!session || eventCorrelationKey(event) === session)
      && (turn || event.__stage_source === 'hook')
      && ctx.now() - event.time <= ((turn || session) ? INVOKE_FRESHNESS_MS : PYTHON_HOOK_DEDUPE_MS));
  const unique = [...new Map(candidates.map((event) => [event.event_id, event])).values()];
  if (unique.length > 1) return { status: 'ambiguous', error: 'hook_session_ambiguous', durable: true };
  if (unique.length === 0) return null;
  const event = unique[0];
  const locator = codexStageLocator(event);
  if (!locator) return null;
  const result = { status: 'deduped', event_id: event.event_id, sessionid: locator.sessionid };
  const lock = acquireCoordinationReservation(projectRoot, 'stage', locator.lockKey, { deadlineMono });
  if (!lock) return { ...result, status: 'retryable', error: 'stage_busy', durable: true };
  try {
    if (codexSnapshotFrozen(ctx, key, event)) return result;
    const saved = codexReceiptAttribution(projectRoot, event, input);
    if (!saved.error && event.__first_prompt_candidate === true
      && readNoticeObligation(ctx.stateRoot, key).status === 'missing') {
      // Preserve the old writable-stage recovery, but a read-only global
      // directory must not undo the owner just saved in the project. Invoke
      // independently repairs this same obligation before promotion.
      try {
        ensureNoticeObligation(ctx.stateRoot, key, event.event_id, {
          timeoutMs: Math.min(30, Math.max(0, remaining(deadlineMono))), createdAt: event.time,
        });
      } catch { /* permitted invoke/Stop retries this existing first event */ }
    }
    return saved.error ? { ...result, status: saved.error === 'owner_mismatch' ? 'owner_mismatch' : 'retryable', error: saved.error, durable: true } : result;
  } catch (err) {
    return { ...result, status: 'retryable', error: `route_receipt_${err?.code || 'write_failed'}`, durable: true };
  } finally { releaseCoordinationReservation(lock); }
}

// A Hook intentionally stages a Prompt before the dispatcher has read the
// routed owner.  The foreground copy of that same Prompt can therefore carry
// a validated route_hint while the event is still in Pending (or may already
// have been promoted to Outbox).  Fill only unknown attribution fields on the
// exact event_id before any sender path is allowed to publish it.  This keeps
// the route immutable once concrete and prevents a late Host Stop from
// relabeling an already-sent event.
function updateStagedRouteAttribution(ctx, projectKeyValue, eventId, routeHint, routeProduct, routeFramework, deadlineMono) {
  const owner = validRouteHint(routeHint);
  if (!owner || typeof eventId !== 'string') return { ok: true, updated: false };
  const mappedProduct = PRODUCT_BY_SKILL[owner] || 'unknown';
  const product = routeProduct && routeProduct !== 'unknown' ? routeProduct : mappedProduct;
  const framework = routeFramework && routeFramework !== 'unknown' ? routeFramework : null;
  const attribution = {
    skillname: owner,
    __route_hint: owner,
    ...(product && product !== 'unknown' ? { product, __route_product: product } : {}),
    ...(framework ? { framework, __route_framework: framework } : {}),
  };
  const opts = {
    projectKey: projectKeyValue,
    reservationTimeoutMs: Math.min(120, Math.max(1, remaining(deadlineMono))),
  };
  const outbox = updateOutboxAttribution(ctx.stateRoot, eventId, attribution, opts);
  if (outbox.ok || outbox.error !== 'event_not_found') return outbox;
  return updatePendingAttribution(ctx.stateRoot, eventId, attribution, opts);
}

function routeAttributionFailure(result, eventId, sessionid) {
  if (result?.ok !== false) return null;
  if (result.error === 'owner_mismatch') {
    return {
      status: 'owner_mismatch',
      event_id: eventId,
      expected_skillname: result.existing_skillname,
      requested_skillname: result.requested_skillname,
    };
  }
  if (result.error === 'event_not_found') return null;
  return {
    status: 'retryable',
    error: `route_attribution_${result.error || 'failed'}`,
    durable: true,
    event_id: eventId,
    ...(sessionid ? { sessionid } : {}),
  };
}

// Historical recovery must make progress without making the current Prompt
// wait behind an offline queue. The cursor is project+IDE scoped and stores
// only event filenames/turn hashes (never raw Prompt or host identifiers).
// A partial scan is explicitly reported as pending; callers must not treat
// the sample as proof that no historical candidate exists.  In particular,
// an old Hook event can be outside the first slice and a new logical event
// must not be minted until the complete index proves that it is absent.
function turnRecoveryIndexPath(stateRoot, key, ide) {
  const safeIde = safeName(ide, 'unknown');
  return join(resolveTelemetryRoot(stateRoot), 'turn-index', `${key}-${safeIde}.json`);
}

function turnRecoveryHash(turnId) {
  return createHash('sha256').update(String(turnId)).digest('hex');
}

function turnRecoveryQueueSignature(paths) {
  return createHash('sha256').update(paths.join('\n')).digest('hex');
}

function readTurnRecoveryIndex(stateRoot, key, ide) {
  const path = turnRecoveryIndexPath(stateRoot, key, ide);
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'));
    if (!value || value.version !== 1 || value.project_key !== key || value.ide !== ide
      || (value.cursor !== null && typeof value.cursor !== 'string')
      || !Array.isArray(value.matches)
      || (value.first_candidates !== undefined && !Array.isArray(value.first_candidates))
      || (value.queue_signature !== undefined && value.queue_signature !== null && typeof value.queue_signature !== 'string')
      || (value.queue_paths !== undefined && (!Array.isArray(value.queue_paths)
        || value.queue_paths.some((entry) => typeof entry !== 'string')))) return { status: 'invalid' };
    return { status: 'valid', value };
  } catch (err) {
    return err?.code === 'ENOENT' ? { status: 'missing' } : { status: 'invalid' };
  }
}

function writeTurnRecoveryIndex(stateRoot, key, ide, value) {
  const path = turnRecoveryIndexPath(stateRoot, key, ide);
  const dir = dirname(path);
  const tmp = join(dir, `.${key}-${safeName(ide, 'unknown')}.${process.pid}-${randomUUID()}.tmp`);
  try {
    mkdirSync(dir, { recursive: true, mode: process.platform === 'win32' ? undefined : 0o700 });
    writeFileSync(tmp, `${JSON.stringify({
      version: 1,
      project_key: key,
      ide,
      cursor: value.cursor ?? null,
      complete: value.complete === true,
      queue_signature: typeof value.queue_signature === 'string' ? value.queue_signature : null,
      // Paths already inspected by this project-scoped cursor. Keeping this
      // set lets a partial scan continue when new events are appended: the
      // next invocation scans only unseen paths instead of restarting at the
      // head and starving the current Prompt behind old backlog.
      queue_paths: Array.isArray(value.queue_paths) ? value.queue_paths : [],
      // Do not truncate these mappings.  A complete index is the evidence
      // that permits a new receipt/first obligation; dropping old entries
      // would turn a valid historical match into a false negative later.
      matches: Array.isArray(value.matches) ? value.matches : [],
      first_candidates: Array.isArray(value.first_candidates) ? value.first_candidates : [],
      updated_at: Date.now(),
    })}\n`, { mode: process.platform === 'win32' ? undefined : 0o600 });
    renameSync(tmp, path);
    return true;
  } catch {
    try { unlinkSync(tmp); } catch { /* best effort */ }
    return false;
  }
}

function advanceTurnRecoveryIndex(stateRoot, key, ide, opts = {}) {
  const turnIndex = readTurnRecoveryIndex(stateRoot, key, ide);
  const current = turnIndex.status === 'valid'
    ? turnIndex.value
    : { cursor: null, complete: false, matches: [] };
  const paths = [...listPending(stateRoot), ...listOutbox(stateRoot)]
    .sort((a, b) => a.localeCompare(b));
  const queueSignature = turnRecoveryQueueSignature(paths);
  // A complete index for the exact queue snapshot is already authoritative.
  // Re-scanning from the beginning on every new turn would reintroduce the
  // very queue-size latency this index is meant to remove.
  if (current.complete === true && current.queue_signature === queueSignature) {
    return {
      status: 'complete',
      scanned: 0,
      matches: Array.isArray(current.matches) ? current.matches : [],
      first_candidates: Array.isArray(current.first_candidates) ? current.first_candidates : [],
    };
  }
  // A completed index is reusable only for the exact queue snapshot it
  // covered. New files can sort before a prior cursor, so silently reusing a
  // completed snapshot would allow a late old Hook event to be missed. The
  // persistent path set makes partial scans monotonic across queue churn.
  const hasPathIndex = Array.isArray(current.queue_paths);
  const queueChanged = current.queue_signature !== null
    && current.queue_signature !== queueSignature;
  const knownPaths = new Set(hasPathIndex ? current.queue_paths : []);
  // Migrate indexes written before queue_paths was introduced. A cursor is
  // safe only for the same queue snapshot; after churn, rescan conservatively.
  if (!hasPathIndex && !queueChanged && typeof current.cursor === 'string') {
    for (const path of paths) {
      if (path <= current.cursor) knownPaths.add(path);
    }
  }
  const scanPaths = paths.filter((path) => !knownPaths.has(path));
  const maxFiles = Number.isInteger(opts.maxFiles) && opts.maxFiles > 0 ? opts.maxFiles : 64;
  const deadlineMono = Number.isFinite(opts.deadlineMono) ? opts.deadlineMono : Infinity;
  const matches = Array.isArray(current.matches) ? [...current.matches] : [];
  const firstCandidates = Array.isArray(current.first_candidates) ? [...current.first_candidates] : [];
  let scanned = 0;
  const scannedPaths = new Set(knownPaths);
  let last = typeof current.cursor === 'string' ? current.cursor : null;
  for (; scanned < scanPaths.length && scanned < maxFiles; scanned += 1) {
    if (performance.now() >= deadlineMono) break;
    const path = scanPaths[scanned];
    last = path;
    scannedPaths.add(path);
    const event = readEvent(path);
    if (!event || event.method !== METHOD.PROMPT || event.__project_key !== key
      || (ide && ide !== 'unknown' && ide !== 'all' && event.ide !== ide)
      || typeof event.event_id !== 'string') continue;
    if (typeof event.turn_id === 'string' && event.turn_id.length > 0) {
      const item = { turn_hash: turnRecoveryHash(event.turn_id), event_id: event.event_id };
      if (!matches.some((entry) => entry.turn_hash === item.turn_hash && entry.event_id === item.event_id)) {
        matches.push(item);
      }
    }
    if (event.__first_prompt_candidate === true && !firstCandidates.includes(event.event_id)) {
      firstCandidates.push(event.event_id);
    }
  }
  let complete = scanned >= scanPaths.length;
  let savedQueueSignature = queueSignature;
  // If the queue changed while we were scanning, the path set does not prove
  // that the new snapshot has been covered. Keep the inspected paths and
  // continue with newly observed paths on the next cold entry.
  const afterPaths = [...listPending(stateRoot), ...listOutbox(stateRoot)]
    .sort((a, b) => a.localeCompare(b));
  const afterSignature = turnRecoveryQueueSignature(afterPaths);
  if (complete && afterSignature !== queueSignature) {
    complete = false;
    savedQueueSignature = afterSignature;
  }
  const saved = writeTurnRecoveryIndex(stateRoot, key, ide, {
    cursor: complete ? null : last,
    complete,
    queue_signature: savedQueueSignature,
    queue_paths: [...scannedPaths].sort(),
    matches,
    first_candidates: firstCandidates,
  });
  if (!saved) return { status: 'pending', reason: 'turn_index_write_failed', scanned };
  return { status: complete ? 'complete' : 'pending', scanned, matches, first_candidates: firstCandidates };
}

function indexedPromptForTurn(stateRoot, key, ide, turnId) {
  const index = readTurnRecoveryIndex(stateRoot, key, ide);
  if (index.status !== 'valid') return { status: 'pending' };
  const turnHash = turnRecoveryHash(turnId);
  const matches = index.value.matches.filter((entry) => entry.turn_hash === turnHash);
  if (matches.length > 1) return { status: 'ambiguous' };
  if (matches.length === 1) {
    const event = pendingEventForProject(stateRoot, matches[0].event_id, key);
    return event ? { status: 'found', event } : { status: 'stale' };
  }
  return index.value.complete ? { status: 'none' } : { status: 'pending' };
}

function indexedFirstPromptCandidate(stateRoot, key, ide) {
  const index = readTurnRecoveryIndex(stateRoot, key, ide);
  if (index.status !== 'valid') return { status: 'pending' };
  const candidates = index.value.first_candidates || [];
  const events = candidates.map((eventId) => pendingEventForProject(stateRoot, eventId, key)).filter(Boolean);
  if (events.length > 1) return { status: 'ambiguous' };
  if (events.length === 1) return { status: 'found', event: events[0] };
  return index.value.complete ? { status: 'none' } : { status: 'pending' };
}

// A foreground host may only retry its compatibility command once.  Keep a
// bounded, non-sendable record for a turn whose historical identity scan is
// incomplete; this preserves the redacted Prompt without placing it in
// Pending/Outbox or inventing a second logical event.  A later cold entry
// resumes the same project+IDE index and promotes this exact event_id once
// the scan proves a safe binding (or proves absence).
function deferredTurnPath(stateRoot, key, ide, turnId) {
  return join(resolveTelemetryRoot(stateRoot), 'deferred-turns', `${key}-${safeName(ide, 'unknown')}-${turnRecoveryHash(turnId)}.json`);
}

function readDeferredTurn(stateRoot, key, ide, turnId) {
  const path = deferredTurnPath(stateRoot, key, ide, turnId);
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'));
    if (!value || value.version !== 1 || value.project_key !== key || value.ide !== ide
      || value.turn_hash !== turnRecoveryHash(turnId)
      || typeof value.event_id !== 'string' || !/^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/.test(value.event_id)
      || typeof value.prompt !== 'string' || value.prompt.length === 0) return null;
    return { ...value, path };
  } catch { return null; }
}

function writeDeferredTurn(stateRoot, key, ide, turnId, value) {
  if (!turnId || typeof value?.prompt !== 'string' || value.prompt.length === 0) return null;
  const path = deferredTurnPath(stateRoot, key, ide, turnId);
  const dir = dirname(path);
  const tmp = join(dir, `.${key}-${safeName(ide, 'unknown')}-${turnRecoveryHash(turnId)}.${process.pid}-${randomUUID()}.tmp`);
  let existing = null;
  try {
    const candidate = JSON.parse(readFileSync(path, 'utf8'));
    if (candidate && candidate.version === 1 && candidate.project_key === key
      && candidate.ide === ide && candidate.turn_hash === turnRecoveryHash(turnId)
      && typeof candidate.event_id === 'string'
      && /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/.test(candidate.event_id)) {
      existing = candidate;
    }
  } catch { /* first writer or a recoverable partial record */ }
  const next = {
    version: 1, project_key: key, ide, turn_hash: turnRecoveryHash(turnId),
    turn_id: turnId,
    // Once an intent exists its event identity is immutable.  A retry may
    // update diagnostics, but it must never replace the ID after a process
    // restart or a lost response.
    event_id: existing?.event_id || value.event_id || randomUUID(),
    prompt: existing?.prompt || value.prompt,
    source: safeName(value.source || existing?.source, 'python'),
    sessionid: safeName(value.sessionid || existing?.sessionid, ''),
    created_at: Number.isFinite(existing?.created_at) ? existing.created_at : Date.now(),
    updated_at: Date.now(),
    phase: safeName(value.phase || existing?.phase, 'intent'),
    last_error: safeName(value.last_error || existing?.last_error, ''),
    retry_count: Number.isInteger(existing?.retry_count) ? existing.retry_count + 1 : 0,
  };
  const routeHint = validRouteHint(value.route_hint || existing?.route_hint);
  const routeProduct = safeName(value.product || existing?.product, '');
  const routeFramework = safeName(value.framework || existing?.framework, '');
  if (routeHint) next.route_hint = routeHint;
  if (routeProduct && routeProduct !== 'unknown') next.product = routeProduct;
  if (routeFramework && routeFramework !== 'unknown') next.framework = routeFramework;
  const hasDisambiguationFlag = Object.prototype.hasOwnProperty.call(value, 'awaiting_disambiguation');
  const awaitingDisambiguation = hasDisambiguationFlag
    ? value.awaiting_disambiguation === true
    : existing?.awaiting_disambiguation === true;
  if (awaitingDisambiguation) next.awaiting_disambiguation = true;
  if (!next.sessionid) delete next.sessionid;
  if (!next.last_error) delete next.last_error;
  try {
    mkdirSync(dir, { recursive: true, mode: process.platform === 'win32' ? undefined : 0o700 });
    // Existing intents are diagnostic updates and may be replaced atomically.
    // The first publication is no-clobber: a Hook/foreground race must adopt
    // the winner's event_id rather than overwrite it with a second identity.
    if (existing) {
      writeFileSync(tmp, `${JSON.stringify(next)}\n`, { mode: process.platform === 'win32' ? undefined : 0o600 });
      try {
        const syncFd = openSync(tmp, 'r+');
        try { fsyncSync(syncFd); } finally { closeSync(syncFd); }
      } catch { /* best effort on filesystems without fsync */ }
      renameSync(tmp, path);
    } else {
      let fd;
      try {
        fd = openSync(tmp, 'wx', process.platform === 'win32' ? undefined : 0o600);
        const body = Buffer.from(`${JSON.stringify(next)}\n`);
        let offset = 0;
        while (offset < body.length) offset += writeSync(fd, body, offset, body.length - offset);
        try { fsyncSync(fd); } catch { /* best effort on filesystems without fsync */ }
        closeSync(fd); fd = undefined;
        try {
          linkSync(tmp, path);
        } catch (err) {
          if (err?.code === 'EEXIST') {
            // A concurrent first writer won.  Read it below and never replace
            // it with this process's event identity.
            try { unlinkSync(tmp); } catch { /* best effort */ }
            const winner = JSON.parse(readFileSync(path, 'utf8'));
            if (winner?.event_id) return { ...winner, path };
            return null;
          }
          // Hard-link publication is the strongest no-clobber primitive, but
          // it is unavailable on some Windows/network/restricted filesystems.
          // Fall back to an exclusive target create.  The target is still
          // created with O_EXCL, so a concurrent writer cannot be overwritten;
          // readers already tolerate a short partial-write window by retrying
          // invalid JSON rather than adopting a second event_id.
          if (!['EPERM', 'EACCES', 'EXDEV', 'ENOTSUP', 'EOPNOTSUPP'].includes(err?.code)) throw err;
          let directFd;
          try {
            directFd = openSync(path, 'wx', process.platform === 'win32' ? undefined : 0o600);
            let directOffset = 0;
            while (directOffset < body.length) directOffset += writeSync(directFd, body, directOffset, body.length - directOffset);
            try { fsyncSync(directFd); } catch { /* best effort */ }
            closeSync(directFd); directFd = undefined;
          } catch (directErr) {
            if (directFd !== undefined) try { closeSync(directFd); } catch { /* noop */ }
            if (directErr?.code === 'EEXIST') {
              const winner = JSON.parse(readFileSync(path, 'utf8'));
              if (winner?.event_id) return { ...winner, path };
              return null;
            }
            throw directErr;
          }
        }
        try { unlinkSync(tmp); } catch (cleanupErr) { if (cleanupErr?.code !== 'ENOENT') { /* target is durable */ } }
      } finally {
        if (fd !== undefined) try { closeSync(fd); } catch { /* noop */ }
      }
    }
    return { ...next, path };
  } catch {
    try { unlinkSync(tmp); } catch { /* best effort */ }
    return null;
  }
}

function clearDeferredTurn(record) {
  if (!record?.path) return;
  try { unlinkSync(record.path); } catch (err) { if (err?.code !== 'ENOENT') return; }
}

function promptDenyReason(stateRoot, key) {
  try {
    const gate = readProjectDenyGate(stateRoot, key);
    return gate?.allowed === false ? `deny_${gate.status || 'blocked'}` : null;
  } catch {
    // A failed gate read must not turn a normal Prompt into a permanent local
    // denial. The producer/Pending path remains fail-closed if it cannot read
    // the gate when it is about to publish or send.
    return null;
  }
}

function dropPromptIntentIfDenied(ctx, key, intent) {
  const reason = promptDenyReason(ctx.stateRoot, key);
  if (reason) clearDeferredTurn(intent);
  return reason;
}

// A Prompt intent is the single local recovery fact for a foreground turn.
// It is deliberately stored outside Pending/Outbox because those files may
// not exist yet when a stage/receipt/producer lock fails.  The record contains
// only the already-redacted text and derived identifiers; it never bypasses
// the project deny gate and it is removed after Pending is durable.
function persistPromptIntent(ctx, projectRoot, key, ide, turnId, value, _deadlineMono) {
  if (!turnId || !isReportingEnabled(projectRoot, ctx.env)) {
    // Do not write a recoverable intent after an explicit opt-out. The gate is
    // checked again before Pending/Outbox publication, but this preference
    // check keeps a concurrent deny from creating a new local retry record.
    return { status: 'disabled', reason: 'reporting_disabled' };
  }
  const deniedBefore = promptDenyReason(ctx.stateRoot, key);
  if (deniedBefore) return { status: 'disabled', reason: deniedBefore };
  // Intent publication is intentionally independent from the producer
  // admission lease.  The lease protects Pending/Outbox and network
  // promotion, but it must not be a prerequisite for retaining the current
  // Prompt.  If another Hook/foreground/Stop owner holds that lease, the
  // no-clobber intent is still the durable recovery fact for this turn and
  // the next foreground entry can send the same event_id.
  const saved = writeDeferredTurn(ctx.stateRoot, key, ide, turnId, value);
  if (!saved) return { status: 'retryable', reason: 'prompt_intent_write_failed', durable: false };
  // Deny may have won the kill-switch race between the pre-write check and
  // the atomic intent publication. Remove the just-written record rather than
  // leaving a local retry behind after the user opted out.
  const deniedAfter = promptDenyReason(ctx.stateRoot, key);
  if (deniedAfter) {
    clearDeferredTurn(saved);
    return { status: 'disabled', reason: deniedAfter };
  }
  return { status: 'saved', value: saved, durable: true };
}

function updatePromptIntent(ctx, intent, value) {
  if (!intent?.turn_id || !intent?.event_id) return null;
  if (promptDenyReason(ctx.stateRoot, intent.project_key)) {
    clearDeferredTurn(intent);
    return null;
  }
  const updated = writeDeferredTurn(ctx.stateRoot, intent.project_key, intent.ide, intent.turn_id, {
    ...value,
    event_id: intent.event_id,
    prompt: intent.prompt,
  });
  if (!updated) return null;
  if (promptDenyReason(ctx.stateRoot, intent.project_key)) {
    clearDeferredTurn(updated);
    return null;
  }
  return updated;
}

function listDeferredTurns(stateRoot, key, ide) {
  const dir = join(resolveTelemetryRoot(stateRoot), 'deferred-turns');
  try {
    return readdirSync(dir).filter((name) => name.endsWith('.json') && name.startsWith(`${key}-${safeName(ide, 'unknown')}-`))
      .sort().map((name) => {
        try {
          const value = JSON.parse(readFileSync(join(dir, name), 'utf8'));
          if (!value || value.version !== 1 || value.project_key !== key || value.ide !== ide
            || typeof value.turn_id !== 'string' || typeof value.event_id !== 'string'
            || typeof value.prompt !== 'string') return null;
          return { ...value, path: join(dir, name) };
        } catch { return null; }
      }).filter(Boolean).sort((a, b) => (a.updated_at || 0) - (b.updated_at || 0));
  } catch { return []; }
}

// Deferred turns are a non-sendable recovery queue.  An explicit deny must
// purge them together with Pending/Outbox; otherwise a later foreground
// entry could keep retrying a Prompt that the user has already opted out of.
function purgeDeferredTurns(stateRoot, key) {
  const dir = join(resolveTelemetryRoot(stateRoot), 'deferred-turns');
  const prefix = `${key}-`;
  const result = { removed: 0, busy: 0, errors: [] };
  let names;
  try { names = readdirSync(dir); } catch (err) {
    if (err?.code !== 'ENOENT') result.errors.push({ code: err?.code || 'deferred_scan_failed' });
    return result;
  }
  for (const name of names) {
    if (!name.startsWith(prefix) || !name.endsWith('.json')) continue;
    try {
      unlinkSync(join(dir, name));
      result.removed += 1;
    } catch (err) {
      if (err?.code !== 'ENOENT') {
        result.busy += 1;
        result.errors.push({ code: err?.code || 'deferred_remove_failed' });
      }
    }
  }
  return result;
}

function purgeWithDeferred(stateRoot, key, purgeFn) {
  const purge = purgeFn(stateRoot, key);
  const deferred = purgeDeferredTurns(stateRoot, key);
  if (purge && typeof purge === 'object') {
    purge.removed = (purge.removed || 0) + deferred.removed;
    purge.busy = (purge.busy || 0) + deferred.busy;
    purge.errors = [...(Array.isArray(purge.errors) ? purge.errors : []), ...deferred.errors];
    purge.deferred = deferred;
    return purge;
  }
  return { ...deferred, errors: deferred.errors, deferred };
}

function pendingOnlyEventForProject(stateRoot, eventId, key) {
  for (const path of listPending(stateRoot)) {
    if (basename(path) !== `${eventId}.json`) continue;
    const event = readEvent(path);
    if (event?.__project_key === key && event.method === METHOD.PROMPT) return event;
  }
  return null;
}

// `sessionid` is the local correlation bucket used by Pending/Outbox and
// stage receipts.  Anonymous events intentionally omit that field before the
// CLS mapping boundary, so keep their local bucket in this private marker.
// Falling back to `sessionid` preserves compatibility with events written by
// older runtimes and with normal host/turn-attributed events.
function eventCorrelationKey(event) {
  if (typeof event?.__correlation_key === 'string' && event.__correlation_key.length > 0) {
    return event.__correlation_key;
  }
  return typeof event?.sessionid === 'string' && event.sessionid.length > 0
    ? event.sessionid : null;
}

function selectPending(stateRoot, key, now = Date.now(), ide = null) {
  const candidates = [];
  for (const path of listPending(stateRoot)) {
    const event = readEvent(path);
    if (!event || event.method !== METHOD.PROMPT || event.__project_key !== key) continue;
    if (ide && ide !== 'unknown' && event.ide !== ide) continue;
    if (typeof event.time !== 'number' || now - event.time > INVOKE_FRESHNESS_MS) continue;
    candidates.push(event);
  }
  candidates.sort((a, b) => (b.time - a.time) || a.event_id.localeCompare(b.event_id));
  if (candidates.length === 0) return { status: 'not_found' };
  if (candidates.length > 1) return { status: 'ambiguous' };
  return { status: 'selected', event: candidates[0] };
}

// A foreground invoke can finish the Pending -> Outbox transition and then
// lose the process before the sender ACKs.  A later invoke/Host Stop must be
// able to pick up that exact queued Prompt, but it must never guess among old
// or cross-IDE events.  Pending remains the preferred source; Outbox is only
// considered when Pending has no candidate and the project/IDE/session scope
// yields exactly one fresh Prompt.
function selectOutboxPrompt(stateRoot, key, now = Date.now(), ide = null, sessionid = null) {
  const candidates = [];
  for (const path of listOutbox(stateRoot)) {
    const event = readEvent(path);
    if (!event || event.method !== METHOD.PROMPT || event.__project_key !== key) continue;
    if (ide && ide !== 'unknown' && event.ide !== ide) continue;
    if (sessionid && eventCorrelationKey(event) !== sessionid) continue;
    if (typeof event.time !== 'number' || event.time > now || now - event.time > INVOKE_FRESHNESS_MS) continue;
    candidates.push(event);
  }
  candidates.sort((a, b) => (b.time - a.time) || a.event_id.localeCompare(b.event_id));
  if (candidates.length === 0) return { status: 'not_found' };
  if (candidates.length > 1) return { status: 'ambiguous' };
  return { status: 'selected', event: candidates[0], source: 'outbox' };
}

function selectForegroundPrompt(stateRoot, key, now = Date.now(), ide = null, sessionid = null) {
  const pending = sessionid
    ? selectPendingForSession(stateRoot, key, sessionid, now)
    : selectPending(stateRoot, key, now, ide);
  if (pending.status !== 'not_found') return pending;
  return selectOutboxPrompt(stateRoot, key, now, ide, sessionid);
}

function selectCodexStopPrompt(ctx, projectRoot, key, input) {
  const raw = input.raw_session_id || input.session_id || input.conversation_id || input.thread_id || input.host_thread_hint;
  const session = typeof raw === 'string' && raw ? deriveAnonymousSessionId(projectRoot, 'codex', raw) : null;
  if (typeof input.turn_id === 'string' && input.turn_id) {
    const receipt = readTurnReceipt(projectRoot, 'codex', input.turn_id);
    const candidates = [...listPending(ctx.stateRoot), ...listOutbox(ctx.stateRoot)].map(readEvent)
      .filter((event) => event?.method === METHOD.PROMPT && event.ide === 'codex'
        && event.__project_key === key && event.turn_id === input.turn_id
        && (!session || eventCorrelationKey(event) === session)
        && (!receipt || event.event_id === receipt.event_id));
    if (candidates.length === 1) return { status: 'selected', event: candidates[0] };
    return { status: candidates.length > 1 ? 'ambiguous' : 'not_found' };
  }
  return selectForegroundPrompt(ctx.stateRoot, key, ctx.now(), 'codex', session);
}

// A Prompt already in Outbox has completed its attribution transaction. It is
// safe to retry that exact event independently of the current turn, even when
// it is older than INVOKE_FRESHNESS_MS or when several old events coexist.
// This helper deliberately returns IDs only: the Sender will re-read each
// event under its reservation lock and apply the normal retry/backoff and
// privacy gates. No current skillname/framework/SDKAppID is merged and no
// notice is created from this drain.
function historicalOutboxPromptIds(stateRoot, key, now = Date.now(), ide = null) {
  if (!ide || ide === 'unknown') return [];
  const cutoff = now - OUTBOX_RECOVERY_TTL_MS;
  const candidates = [];
  for (const path of listOutbox(stateRoot)) {
    const event = readEvent(path);
    if (!event || event.method !== METHOD.PROMPT || event.__project_key !== key) continue;
    if (event.ide !== ide) continue;
    if (typeof event.time !== 'number' || event.time > now || event.time < cutoff) continue;
    candidates.push(event);
  }
  candidates.sort((a, b) => (a.time - b.time) || a.event_id.localeCompare(b.event_id));
  return candidates.slice(0, HISTORICAL_OUTBOX_MAX_COUNT).map((event) => event.event_id);
}

async function flushHistoricalOutbox(ctx, projectRoot, key, ide, deadlineMono, now, opts = {}) {
  const eventIds = historicalOutboxPromptIds(ctx.stateRoot, key, now, ide);
  if (eventIds.length === 0) return null;
  const maxDurationMs = Math.min(
    Number.isFinite(opts.maxDurationMs) ? Math.max(0, opts.maxDurationMs) : 1800,
    Math.max(0, remaining(deadlineMono) - 100),
  );
  if (maxDurationMs <= 0) return { sent: 0, sent_event_ids: [], retried: 0, rejected: 0, skipped: 0, errors: [{ code: 'deadline_exhausted' }] };
  try {
    return await ctx.flushOutbox(ctx.stateRoot, {
      ...ctx.flushOptions,
      maxCount: eventIds.length,
      maxDurationMs,
      eventIds,
      // Do not bypass Sender backoff here. This is a bounded drain of already
      // attributed events, not a new foreground delivery attempt.
      isEventEnabled: senderGate(projectRoot, key, ctx.env),
    });
  } catch (err) {
    // A historical retry is maintenance, not the current notice transaction.
    // A Sender/transport exception must leave the Outbox intact and must not
    // suppress the already-authorized notice on Host Stop; the next runtime
    // entry can retry the same event_id.
    return {
      sent: 0,
      sent_event_ids: [],
      retried: 0,
      rejected: 0,
      skipped: 0,
      errors: [{ code: typeof err?.code === 'string' ? err.code : 'sender_error' }],
    };
  }
}

function identityEnrichmentForEvent(event, stateRoot, maxWaitMs, allowEphemeral = undefined) {
  // Preserve a complete identity already attached to the event.  A transient
  // identity-file lock must not turn a sendable event back into pending state
  // or cause Sender to mint a second device id.
  if (isValidIdentityRecord(event)) {
    return {
      useragent: event.useragent,
      identity_scope: event.identity_scope,
      identity_pending: false,
    };
  }
  return identityFields({ stateRoot, maxWaitMs, ...(allowEphemeral === undefined ? {} : { allowEphemeral }) });
}

// A Stop hook normally has no prompt text.  Use the same project-scoped,
// freshness-bounded Pending candidate that invoke would consider only for
// product/framework attribution.  This never selects or promotes an event;
// invoke still applies its normal session/ambiguity checks.
function latestPendingPrompt(stateRoot, key, now = Date.now(), ide = null) {
  let latest = null;
  for (const path of listPending(stateRoot)) {
    const event = readEvent(path);
    if (!event || event.method !== METHOD.PROMPT || event.__project_key !== key) continue;
    if (ide && event.ide !== ide) continue;
    if (typeof event.time !== 'number' || now - event.time > INVOKE_FRESHNESS_MS) continue;
    if (!latest || event.time > latest.time
      || (event.time === latest.time && event.event_id.localeCompare(latest.event_id) > 0)) {
      latest = event;
    }
  }
  return latest;
}

function pendingForStage(stateRoot, key, sessionid, turnId, fingerprint, now = Date.now(), source = null) {
  const candidates = [];
  for (const path of listPending(stateRoot)) {
    const event = readEvent(path);
    if (!event || event.method !== METHOD.PROMPT || event.__project_key !== key) continue;
    if (eventCorrelationKey(event) !== sessionid || typeof event.time !== 'number') continue;
    if (now - event.time > 10_000) continue;
    if (turnId && event.turn_id === turnId) candidates.push(event);
    else if (!turnId && event.__prompt_fingerprint === fingerprint
      && event.__dedupe_claimed !== true
      && (!source || event.__stage_source !== source)) candidates.push(event);
  }
  candidates.sort((a, b) => (b.time - a.time) || a.event_id.localeCompare(b.event_id));
  return candidates[0] || null;
}

function recentHookPromptByFingerprint(stateRoot, key, fingerprint, now = Date.now(), ide = null, turnId = null) {
  const candidates = [];
  for (const path of listPending(stateRoot)) {
    const event = readEvent(path);
    if (!event || event.method !== METHOD.PROMPT || event.__project_key !== key) continue;
    if (event.__stage_source !== 'hook' || event.__prompt_fingerprint !== fingerprint) continue;
    if (ide && ide !== 'unknown' && event.ide !== ide) continue;
    if (turnId && event.turn_id !== turnId) continue;
    if (typeof event.time !== 'number' || event.time > now || now - event.time > PYTHON_HOOK_DEDUPE_MS) continue;
    candidates.push(event);
  }
  return candidates.length > 1 ? { ambiguous: true } : candidates[0] || null;
}

function rawSessionFromInput(input) {
  for (const key of ['raw_session_id', 'session_id', 'conversation_id', 'thread_id']) {
    if (typeof input?.[key] === 'string' && input[key].length > 0) return input[key];
  }
  // Codex Desktop's foreground compatibility command does not always expose
  // the raw conversation id, but the shim carries CODEX_THREAD_ID as an
  // opaque host-thread hint.  Treat it as a project/IDE session scope only:
  // it never borrows another binding's Context and does not claim to be a
  // per-turn exactly-once key.  A real host session/turn id still wins above.
  if (!input?.turn_id
    && safeName(input?.ide, 'unknown') === 'codex'
    && typeof input?.host_thread_hint === 'string'
    && input.host_thread_hint.length > 0) {
    return `codex-thread:${input.host_thread_hint}`;
  }
  return null;
}

function deriveAndRefreshSession(projectRoot, input, opts = {}) {
  const ide = safeName(input?.ide, 'unknown');
  const rawSession = rawSessionFromInput(input);
  if (rawSession) {
    const sessionid = deriveAnonymousSessionId(projectRoot, ide, rawSession);
    // The Hook already carries the host session id in the Prompt event.  Do
    // not spend the sub-50ms Hook budget persisting a binding lock here; the
    // foreground invoke/legacy path will refresh the binding when it has a
    // normal (multi-second) deadline.  This also prevents a busy desktop
    // session from dropping the first Prompt solely because a binding write
    // lost a short-lived filesystem reservation race.
    if (opts.hookMode === true) return { status: 'resolved', sessionid, source: 'host' };
    const bound = refreshBinding(projectRoot, sessionid, ide, opts);
    return bound.status === 'bound' ? { status: 'resolved', sessionid, source: 'host' } : bound;
  }
  // ``resolveAnonymousSession`` consumes a wall-clock number, while
  // ``refreshBinding`` accepts a callable clock for its lock-aware path.
  // Normalize here so anonymous binding discovery does not silently treat a
  // function as NaN and miss real multi-session ambiguity.
  const resolveOpts = {
    ...opts,
    now: typeof opts.now === 'function' ? opts.now() : opts.now,
  };
  return resolveAnonymousSession(projectRoot, resolveOpts);
}

function applyControlPrompt(projectRoot, text) {
  const requested = preferenceFromText(text);
  if (requested === null) return null;
  setReportingPreference(projectRoot, requested, { purgePending: !requested });
  return { status: requested ? 'enabled' : 'disabled', control: true };
}

/** Single prompt-staging transaction shared by Hook and legacy commands. */
async function stagePromptCore(input, flags, ctx, opts = {}) {
  const prompt = typeof input?.prompt === 'string' ? input.prompt : input?.text;
  if (typeof prompt !== 'string' || prompt.length === 0) return { status: 'invalid', error: 'prompt_required' };
  // Do this before project resolution, preference/control handling, binding,
  // or the first-Prompt obligation. Internal Codex maintenance text must not
  // leave a recoverable local event or arm a privacy notice.
  if (isCodexInternalPrompt(prompt, input, flags)) {
    return { status: 'skipped', reason: 'codex_internal_overview' };
  }
  const projectRoot = resolveProjectRoot({
    explicitCwd: typeof flags.cwd === 'string' ? flags.cwd : input?.cwd,
    normalized: input,
    processCwd: ctx.cwd,
  });
  // The Hook command carries the authoritative target IDE in --ide. Some
  // hosts do not repeat it in their stdin envelope, so falling back to the
  // payload alone would re-scan all four IDEs and incorrectly return
  // `unknown` for a mixed project.
  if (!nodeReportingAllowed(projectRoot, ctx.env, safeName(flags.ide || input?.ide, 'unknown'))) return { status: 'disabled', error: 'reporting_mode_not_node_v2' };
  const deadlineMono = opts.deadlineMono ?? (performance.now() + (opts.timeoutMs ?? 2000));
  // Canonical continuation labels must be decided before ordinary staging.
  // A missing receipt is ordinary Prompt text; lock/runtime uncertainty is a
  // retry result and must never fail-open into Pending.
  const continuationConsumed = await consumeContinuationChoice(projectRoot, prompt, {
    stateRoot: ctx.stateRoot,
    source: opts.source,
    controlChoice: input?.control_choice,
    _writeControlTurn: ctx.writeControlTurn,
    _updateNoticeStatus: ctx.updateNoticeStatus,
    purge: () => purgeWithDeferred(ctx.stateRoot, projectKey(projectRoot), purgeProjectEvents),
    timeoutMs: opts.hook ? Math.max(0, remaining(deadlineMono)) : 120,
    deadlineMono,
  });
  if (continuationConsumed !== null && continuationConsumed.status !== 'control_continue') {
    return continuationConsumed;
  }
  // Cursor's stop hook returns followup_message, which Cursor submits back
  // through beforeSubmitPrompt as a synthetic user turn.  Keep that exact
  // host-generated notice local; do not broaden this match, because an
  // ordinary user prompt may discuss the same privacy topic.
  if (isNoticeReplayText(prompt)) return { status: 'skipped', reason: 'host_notice_replay' };
  if (input?.control_choice === 'allow' || input?.control_choice === 'deny') {
    // Enum-only callers must never fall through to ordinary Prompt staging if
    // the project receipt is missing or unreadable.
    return { status: 'control_retry', control: true, marker: CONTROL_RETRY };
  }
  const control = applyControlPrompt(projectRoot, prompt);
  if (control) return control;
  if (!isReportingEnabled(projectRoot, ctx.env)) return { status: 'disabled' };

  if (opts.hook !== true) {
    const paired = preserveCodexForegroundRoute(input, flags, ctx, deadlineMono);
    if (paired) return paired;
  }

  const sanitizedPrompt = sanitizeReportText(prompt);
  // Ignore only boundary whitespace for matching host/foreground copies.
  // Preserve the original redacted text and all internal whitespace.
  const fingerprint = promptFingerprint(sanitizedPrompt.trim());
  const key = projectKey(projectRoot);
  const ide = safeName(flags.ide || input?.ide, 'unknown');
  // Route metadata is supplied by the Root dispatcher after its bounded local
  // route decision. It is intentionally optional: an unknown route must not
  // block this Prompt, but a validated owner must survive every recovery path.
  const routeHint = validRouteHint(input?.route_hint);
  const routeProduct = safeName(input?.product, '');
  const routeFramework = safeName(input?.framework, '');
  const applyRouteToExisting = (eventId, sessionid = null) => routeAttributionFailure(
    updateStagedRouteAttribution(
      ctx,
      key,
      eventId,
      routeHint,
      routeProduct,
      routeFramework,
      deadlineMono,
    ),
    eventId,
    sessionid,
  );
  const hasTurnIdentity = typeof input?.turn_id === 'string' && input.turn_id.length > 0;
  const rawSession = rawSessionFromInput(input);
  const hasRawSession = Boolean(rawSession);
  // A host_thread_hint is a local pairing aid emitted by the Codex shim when
  // no real conversation/session id is available.  It must never be exposed
  // as CLS `userid`; use it only as the local correlation bucket below.
  const hasExplicitRawSession = ['raw_session_id', 'session_id', 'conversation_id', 'thread_id']
    .some((field) => typeof input?.[field] === 'string' && input[field].length > 0);
  const hostHintOnly = !hasExplicitRawSession
    && ide === 'codex'
    && !hasTurnIdentity
    && typeof input?.host_thread_hint === 'string'
    && input.host_thread_hint.length > 0;
  const rawSessionId = rawSession
    ? deriveAnonymousSessionId(projectRoot, ide, rawSession)
    : null;
  // When the host omits a turn id, use the redacted Prompt fingerprint as a
  // bounded local intent key. A retry of the same logical turn can therefore
  // adopt its existing event_id instead of creating another anonymous file;
  // once Pending is durable the intent is removed, so a later identical user
  // Prompt is still a new event.
  const deferredTurnId = hasTurnIdentity ? input.turn_id : `anonymous-${fingerprint}`;
  let deferredTurn = readDeferredTurn(ctx.stateRoot, key, ide, deferredTurnId);
  const deferredEventId = deferredTurn?.event_id || null;
  // Any foreground branch that cannot yet safely publish Pending must retain
  // the redacted Prompt locally.  A host may never replay the original turn,
  // so this record is the only recovery source.  Turn-aware callers reuse
  // their exact identity; hosts without one get a one-shot synthetic key that
  // is drained by the next foreground entry without being exposed as a host
  // identifier in the payload.
  // Once a foreground Prompt has an intent, every later failure updates this
  // same record. It is the recovery source for the event and prevents the old
  // "receipt exists but producer is busy, then nothing is durable" window.
  let promptIntent = deferredTurn;
  const deferCurrentPrompt = (error, eventId = null, phase = 'defer') => {
    if (opts.hook === true) return { status: 'retryable', error, durable: false };
    if (!isReportingEnabled(projectRoot, ctx.env)) return { status: 'disabled' };
    const denied = dropPromptIntentIfDenied(ctx, key, promptIntent || deferredTurn);
    if (denied) {
      promptIntent = null;
      deferredTurn = null;
      return { status: 'disabled', error: denied };
    }
    const desiredEventId = eventId || promptIntent?.event_id || deferredEventId
      || (typeof input?.event_id === 'string' ? input.event_id : randomUUID());
    // The intent is already durable once this branch is reached after the
    // admission phase. Do not reacquire the producer lease just to update a
    // diagnostic: that was the original starvation bug. A best-effort atomic
    // update is enough; even if it fails, the existing intent remains the
    // recovery fact for the next foreground entry.
    if (promptIntent) {
      const updated = updatePromptIntent(ctx, promptIntent, {
        phase,
        last_error: error,
        sessionid: promptIntent.sessionid,
        awaiting_disambiguation: phase === 'awaiting_disambiguation',
      });
      const deniedAfter = dropPromptIntentIfDenied(ctx, key, promptIntent);
      if (deniedAfter) {
        promptIntent = null;
        deferredTurn = null;
        return { status: 'disabled', error: deniedAfter };
      }
      if (updated) promptIntent = updated;
      deferredTurn = promptIntent;
      return { status: 'retryable', error, durable: true, event_id: promptIntent.event_id, phase };
    }
    const saved = persistPromptIntent(ctx, projectRoot, key, ide, deferredTurnId, {
      event_id: desiredEventId,
      prompt: sanitizedPrompt,
      source: opts.source,
      phase,
      last_error: error,
      sessionid: promptIntent?.sessionid,
      awaiting_disambiguation: phase === 'awaiting_disambiguation',
      ...(routeHint ? { route_hint: routeHint } : {}),
      ...(routeProduct && routeProduct !== 'unknown' ? { product: routeProduct } : {}),
      ...(routeFramework && routeFramework !== 'unknown' ? { framework: routeFramework } : {}),
    }, deadlineMono);
    if (saved.status !== 'saved') {
      return {
        status: saved.status === 'disabled' ? 'disabled' : 'retryable',
        error: saved.reason || error,
        durable: false,
        phase: 'intent',
      };
    }
    promptIntent = saved.value;
    deferredTurn = promptIntent;
    return { status: 'retryable', error, durable: true, event_id: promptIntent.event_id, phase };
  };

  // Consult the durable project+IDE+turn mapping before any fingerprint or
  // anonymous binding fallback. The mapping is authoritative for both raw
  // Hook payloads and foreground payloads that omit the raw session. If the
  // event disappeared without ACK evidence, retain its identity and rebuild
  // the same event instead of minting a second logical event.
  let turnReceipt = null;
  let turnReceiptEventId = null;
  let turnReceiptSessionid = null;
  if (hasTurnIdentity) {
    turnReceipt = readTurnReceipt(projectRoot, ide, input.turn_id);
    if (turnReceipt?.status === 'corrupt') {
      return { status: 'retryable', error: 'turn_receipt_corrupt', durable: false };
    }
    if (turnReceipt) {
      const mapped = pendingEventForProject(ctx.stateRoot, turnReceipt.event_id, key);
      if (mapped) {
        const attributionFailure = applyRouteToExisting(turnReceipt.event_id, turnReceipt.sessionid);
        if (attributionFailure) return attributionFailure;
        clearDeferredTurn(deferredTurn);
        return { status: 'deduped', event_id: turnReceipt.event_id, sessionid: turnReceipt.sessionid };
      }
      const acknowledged = readEventAcknowledgement(ctx.stateRoot, key, turnReceipt.event_id);
      if (acknowledged.status === 'valid') {
        clearDeferredTurn(deferredTurn);
        return {
          status: 'deduped',
          event_id: turnReceipt.event_id,
          sessionid: turnReceipt.sessionid,
          already_acked: true,
        };
      }
      turnReceiptEventId = turnReceipt.event_id;
      turnReceiptSessionid = turnReceipt.sessionid;
    }
  }
  // Claude Code and similar hosts may run the UserPromptSubmit Hook and then
  // the Root Dispatcher prompt command for the same turn.  The latter often
  // has no session id because it is launched from a Bash tool.  Collapse only
  // a recent Hook-created match in this project; never broaden the Hook hot
  // path or dedupe unrelated projects/older turns.
  if (opts.source === 'python' && !rawSessionFromInput(input) && !hasTurnIdentity) {
    const hookMatch = recentHookPromptByFingerprint(ctx.stateRoot, key, fingerprint, ctx.now(), ide, input?.turn_id);
    // Multiple Hook copies are not safe to attribute to an arbitrary
    // conversation.  Do not create a third project-bucket event: leave the
    // existing Hook events durable and require the host to retry with a
    // stable turn/session identity.
    if (hookMatch?.ambiguous) {
      const deferred = deferCurrentPrompt(
        'hook_session_ambiguous',
        promptIntent?.event_id,
        'awaiting_disambiguation',
      );
      // Keep the fail-closed attribution result, but retain a durable local
      // intent. The host may not retry this compatibility command; retaining
      // the redacted Prompt prevents silent loss without inventing a third
      // event for one of the two Hook candidates.
      return {
        ...deferred,
        status: 'ambiguous',
        error: 'hook_session_ambiguous',
        durable: deferred.durable === true,
      };
    }
    if (hookMatch && !hookMatch.ambiguous) {
      if (hasTurnIdentity && !hasRawSession) {
        const mapping = writeTurnReceipt(projectRoot, ide, input.turn_id, {
          sessionid: hookMatch.sessionid,
          event_id: hookMatch.event_id,
          time: hookMatch.time,
        }, { deadlineMono, durable: opts.hook !== true, hookMode: opts.hook === true });
        if (mapping.status === 'conflict') {
          return { status: 'retryable', error: 'turn_receipt_conflict', durable: false };
        }
        if (!['created', 'already_present'].includes(mapping.status)) {
          return { status: 'retryable', error: mapping.reason || 'turn_receipt_write_failed', durable: false };
        }
      }
      const stageKey = hookMatch.turn_id ? `turn:${hookMatch.turn_id}` : `fingerprint:${fingerprint}`;
      const claim = acquireCoordinationReservation(projectRoot, 'stage', `${hookMatch.sessionid}:${stageKey}`, { deadlineMono });
      if (!claim) return { status: 'retryable', error: 'stage_busy', durable: false };
      try {
        const receipt = readStageReceipt(projectRoot, hookMatch.sessionid, stageKey);
        const eventStillDurable = pendingEventForProject(ctx.stateRoot, hookMatch.event_id, key);
        if (receipt?.claimed_sources?.includes(opts.source)) {
          // A foreground shim can be retried after the first dedupe result.
          // Keep returning the Hook event while it is still durable in
          // Pending/Outbox; otherwise a receipt left behind after a fully
          // completed send must not suppress a legitimate later turn with
          // identical text.
          if (eventStillDurable) {
            const earlyObligation = readNoticeObligation(ctx.stateRoot, key);
            if (earlyObligation.status !== 'valid') {
              const earlyEvent = pendingEventForProject(ctx.stateRoot, hookMatch.event_id, key);
              const repaired = ensureNoticeObligation(ctx.stateRoot, key, hookMatch.event_id, {
                timeoutMs: opts.hook ? 30 : 120,
                createdAt: hookMatch.time,
                allowCorruptReplacement: earlyEvent?.__first_prompt_candidate === true,
              });
              if (opts.hook !== true && ['error', 'retry'].includes(repaired.status)) {
                return { status: 'retryable', error: repaired.reason || 'first_obligation_unavailable', event_id: hookMatch.event_id };
              }
            }
            const attributionFailure = applyRouteToExisting(hookMatch.event_id, hookMatch.sessionid);
            if (attributionFailure) return attributionFailure;
            return { status: 'deduped', event_id: hookMatch.event_id, sessionid: hookMatch.sessionid };
          }
        } else {
          const earlyObligation = readNoticeObligation(ctx.stateRoot, key);
          if (earlyObligation.status !== 'valid') {
            const earlyEvent = pendingEventForProject(ctx.stateRoot, hookMatch.event_id, key);
            const repaired = ensureNoticeObligation(ctx.stateRoot, key, hookMatch.event_id, {
              timeoutMs: opts.hook ? 30 : 120,
              createdAt: hookMatch.time,
              allowCorruptReplacement: earlyEvent?.__first_prompt_candidate === true,
            });
            if (opts.hook !== true && ['error', 'retry'].includes(repaired.status)) {
              return { status: 'retryable', error: repaired.reason || 'first_obligation_unavailable', event_id: hookMatch.event_id };
            }
          }
          writeStageReceipt(projectRoot, hookMatch.sessionid, stageKey, {
            event_id: hookMatch.event_id, source: 'hook',
            claimed_sources: [...(receipt?.claimed_sources || []), opts.source], time: hookMatch.time,
          }, { durable: true });
          const attributionFailure = applyRouteToExisting(hookMatch.event_id, hookMatch.sessionid);
          if (attributionFailure) return attributionFailure;
          return { status: 'deduped', event_id: hookMatch.event_id, sessionid: hookMatch.sessionid };
        }
      } finally { releaseCoordinationReservation(claim); }
    }
  }
  // A host-provided turn id or an explicit session id is a reliable
  // attribution key.  When neither is present, do not consult the existing
  // binding list at all: even a single fresh binding may belong to another
  // conversation and borrowing it would leak that Context/userid into this
  // Prompt.  Use the project bucket instead.  A unique Hook match above is
  // the only exception because it identifies the exact staged event rather
  // than guessing from an unrelated binding.
  let turnScopedResolution = false;
  const hasReliableConversationIdentity = hasTurnIdentity || hasExplicitRawSession;
  let resolved = hasTurnIdentity && !hasRawSession
    ? {
      status: 'resolved',
      sessionid: deriveAnonymousSessionId(
        projectRoot,
        ide,
        `turn:${input.turn_id}`,
      ),
      source: 'turn_scope',
    }
    : !hasReliableConversationIdentity
      ? {
        status: 'resolved',
        // A Codex host-thread hint is only a local correlation aid. Keep its
        // stable bucket for same-host retries, but never treat it as a real
        // session or use it to read Context. Without even that hint, use the
        // project bucket so a lone unrelated binding cannot be borrowed.
        sessionid: hostHintOnly
          ? deriveAnonymousSessionId(projectRoot, ide, input.host_thread_hint)
          : deriveProjectFallbackSession(projectRoot),
        source: hostHintOnly ? 'fallback' : 'anonymous_fallback',
      }
      : deriveAndRefreshSession(projectRoot, input, {
        deadlineMono, now: ctx.now, allowFallback: opts.allowFallback !== false, hookMode: opts.hook === true,
      });
  if (resolved.source === 'turn_scope') turnScopedResolution = true;
  if (resolved.status === 'ambiguous') {
    const matches = [];
    for (const binding of listFreshBindings(projectRoot, { now: ctx.now() })) {
      const match = pendingForStage(ctx.stateRoot, key, binding.sessionid, input?.turn_id, fingerprint, ctx.now(), opts.source);
      if (match) matches.push(match);
    }
    if (matches.length === 1) {
      const attributionFailure = applyRouteToExisting(matches[0].event_id, matches[0].sessionid);
      if (attributionFailure) return attributionFailure;
      return { status: 'deduped', event_id: matches[0].event_id, sessionid: matches[0].sessionid };
    }
    // When no host supplied a reliable session/turn identity, refusing every
    // Prompt merely because unrelated bindings from other conversations exist
    // would make normal usage disappear from telemetry. Use a stable local
    // project+IDE fallback bucket, but keep it context-free: never borrow a
    // clarification or claim a session identity in the CLS payload.
    if (!hasRawSession && !hasTurnIdentity) {
      resolved = {
        status: 'resolved',
        sessionid: deriveProjectFallbackSession(projectRoot),
        source: 'anonymous_fallback',
      };
      turnScopedResolution = true;
    } else {
      // A reliable host session/turn was supplied but its mapping conflicts;
      // keep the existing fail-closed behavior instead of misattributing a
      // Prompt to another conversation.
      return { status: 'ambiguous', error: 'session_binding_ambiguous', durable: false };
    }
  }
  if (resolved.status !== 'resolved') return deferCurrentPrompt(resolved.status);

  // Claim the exact turn identity before any new Pending file can be
  // published. Both Hook and foreground callers use the same atomic
  // no-clobber receipt writer, so a race resolves to one event_id and the
  // loser adopts that identity. A durable event from an older runtime is used
  // as the candidate when its mapping was lost during a crash.
  let sessionid = turnReceiptSessionid || resolved.sessionid;
  // `sessionid` above remains the private local bucket used for locks,
  // receipts, and dedupe.  Only a host session/turn may be sent as CLS
  // `userid`; a fallback or host-thread hint is deliberately context-free.
  const anonymousCorrelation = hostHintOnly
    || resolved.source === 'fallback'
    || resolved.source === 'anonymous_fallback'
    || resolved.source === 'codex_anonymous_fallback';
  if (anonymousCorrelation) turnScopedResolution = true;
  if (turnReceiptSessionid) {
    // A raw host session proves which Context belongs to this turn. A
    // foreground copy without raw identity must stay context-free, while a
    // raw copy that disagrees with the receipt must fail closed against
    // borrowing either conversation's Context.
    turnScopedResolution = !hasRawSession || rawSessionId !== turnReceiptSessionid;
  }
  // Commit the redacted Prompt intent before the turn receipt.  If the
  // process dies after this point, the next foreground entry can reconstruct
  // the same event_id instead of seeing a receipt with no recoverable event.
  // Hooks keep their disk-only latency contract and rely on Pending/receipt
  // publication; only foreground producers need this extra recovery fact.
  if (opts.hook !== true && !promptIntent) {
    const intentEventId = turnReceiptEventId || deferredEventId
      || (typeof input?.event_id === 'string' ? input.event_id : randomUUID());
    const intent = persistPromptIntent(ctx, projectRoot, key, ide, deferredTurnId, {
      event_id: intentEventId,
      prompt: sanitizedPrompt,
      source: opts.source,
      phase: 'intent',
      sessionid,
      ...(routeHint ? { route_hint: routeHint } : {}),
      ...(routeProduct && routeProduct !== 'unknown' ? { product: routeProduct } : {}),
      ...(routeFramework && routeFramework !== 'unknown' ? { framework: routeFramework } : {}),
    }, deadlineMono);
    if (intent.status !== 'saved') {
      return {
        status: intent.status === 'disabled' ? 'disabled' : 'retryable',
        error: intent.reason || 'prompt_intent_write_failed',
        durable: false,
        phase: 'intent',
      };
    }
    promptIntent = intent.value;
    deferredTurn = promptIntent;
  }
  let turnEventId = turnReceiptEventId;
  let existingTurnEvent = { status: 'none' };
  if (hasTurnIdentity && !turnEventId
    // The Hook has a strict sub-50ms budget and already has the authoritative
    // turn receipt/stage path. Historical Pending/Outbox recovery belongs to
    // the foreground/cold path; never scan a growing queue on the Hook path.
    && opts.hook !== true && opts.source !== 'hook' && opts.source !== 'legacy_bind_hook') {
    // First consult the persisted cursor, then advance it by one bounded
    // slice. A partial index is not interpreted as `none`; the current turn
    // may still claim its own receipt so a large historical queue cannot
    // permanently block a no-Hook/no-Stop host.
    existingTurnEvent = indexedPromptForTurn(ctx.stateRoot, key, ide, input.turn_id);
    if (!['found', 'ambiguous'].includes(existingTurnEvent.status)) {
      advanceTurnRecoveryIndex(ctx.stateRoot, key, ide, { deadlineMono, maxFiles: 64 });
      existingTurnEvent = indexedPromptForTurn(ctx.stateRoot, key, ide, input.turn_id);
    }
    if (existingTurnEvent.status === 'ambiguous') {
      return { status: 'retryable', error: 'turn_event_ambiguous', durable: false };
    }
    // `pending` means historical recovery remains incomplete. Do not use it
    // as evidence of absence: the old Hook event may be in a later slice.
    // Waiting for the next foreground/cold entry is safer than creating a
    // second event that could later be sent alongside the old one.  A stale
    // mapping is equally fail-closed because the old event may have reached
    // CLS before its local record disappeared.
    if (existingTurnEvent.status === 'pending') {
      return deferCurrentPrompt('turn_recovery_pending');
    }
    if (existingTurnEvent.status === 'stale') {
      return deferCurrentPrompt('turn_recovery_stale');
    }
  }
  if (hasTurnIdentity && !turnEventId) {
    const stageKey = `turn:${input.turn_id}`;
    const stageHint = readStageReceipt(projectRoot, sessionid, stageKey);
    const hintedEvent = existingTurnEvent.status === 'found'
      ? existingTurnEvent.event
      : (stageHint && typeof stageHint.event_id === 'string'
        && /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/.test(stageHint.event_id)
        ? { event_id: stageHint.event_id, sessionid, time: stageHint.time } : null);
    const proposedEventId = hintedEvent?.event_id
      || promptIntent?.event_id
      || deferredEventId
      || (typeof input?.event_id === 'string' ? input.event_id : randomUUID());
    const proposedSessionid = hintedEvent?.sessionid || sessionid;
    const claim = writeTurnReceipt(projectRoot, ide, input.turn_id, {
      sessionid: proposedSessionid,
      event_id: proposedEventId,
      time: Number.isFinite(hintedEvent?.time) ? hintedEvent.time : ctx.now(),
    }, {
      deadlineMono,
      durable: opts.hook !== true,
      hookMode: opts.hook === true,
    });
    if (claim.status === 'conflict' && claim.value?.event_id) {
      if (promptIntent && promptIntent.event_id !== claim.value.event_id) {
        // The turn receipt is authoritative.  Drop our uncommitted intent so
        // a later recovery pass cannot publish a competing event for the same
        // host turn.
        clearDeferredTurn(promptIntent);
        promptIntent = null;
        deferredTurn = null;
      }
      turnEventId = claim.value.event_id;
      turnReceiptEventId = turnEventId;
      sessionid = claim.value.sessionid;
      turnScopedResolution = !hasRawSession || rawSessionId !== sessionid;
      turnReceipt = claim.value;
    } else if (['created', 'already_present'].includes(claim.status)) {
      turnEventId = claim.value?.event_id || proposedEventId;
      turnReceiptEventId = turnEventId;
      sessionid = claim.value?.sessionid || proposedSessionid;
      turnScopedResolution = !hasRawSession || rawSessionId !== sessionid;
      turnReceipt = claim.value || { event_id: turnEventId, sessionid };
    } else {
      return deferCurrentPrompt(claim.reason || 'turn_receipt_write_failed', promptIntent?.event_id, 'turn_receipt');
    }
  } else if (turnEventId && turnReceiptSessionid) {
    sessionid = turnReceiptSessionid;
    // Preserve Context only when the caller supplied the same raw host
    // session that created this receipt. Anonymous foreground retries remain
    // context-free, and a mismatching raw session fails closed.
    turnScopedResolution = !hasRawSession || rawSessionId !== turnReceiptSessionid;
  }

  // The fallback bucket is intentionally context-free: never attach a
  // clarification from one of the ambiguous host sessions to this Prompt.
  const needsContextLock = !turnScopedResolution && hasContext(projectRoot, sessionid);
  const contextLock = needsContextLock
    ? acquireCoordinationReservation(projectRoot, 'context', sessionid, { deadlineMono })
    : null;
  if (needsContextLock && !contextLock) return deferCurrentPrompt('context_busy');
  try {
    const context = needsContextLock ? readContext(projectRoot, sessionid, { now: ctx.now() }) : null;
    const stageKey = input?.turn_id ? `turn:${input.turn_id}` : `fingerprint:${fingerprint}`;
    const stageLock = acquireCoordinationReservation(projectRoot, 'stage', `${sessionid}:${stageKey}`, { deadlineMono });
    if (!stageLock) return deferCurrentPrompt('stage_busy');
    // The project-level first-prompt lock is only needed while the obligation
    // is absent.  Once the first event identity is durable, every later Hook
    // stage can take the normal per-session lock without paying a second
    // filesystem reservation on the latency-critical path.  A missing or
    // corrupt obligation still takes the lock so concurrent first Prompts
    // cannot bind different notice targets.
    let existingObligation = readNoticeObligation(ctx.stateRoot, key);
    const needsFirstPromptLock = existingObligation.status !== 'valid';
    const firstPromptLock = needsFirstPromptLock
      ? acquireCoordinationReservation(projectRoot, 'first-prompt', key, { deadlineMono })
      : null;
    if (needsFirstPromptLock && !firstPromptLock) {
      releaseCoordinationReservation(stageLock);
      return deferCurrentPrompt('first_prompt_busy');
    }
    try {
      // The first event may have been durably written by another session just
      // before its process crashed. Repair that candidate while the project
      // first-prompt lock is held, before allowing this new Prompt to become
      // the notice target. Never choose among multiple candidates silently.
      if (existingObligation.status !== 'valid' && opts.hook !== true) {
        // The notice obligation belongs to the project, not an IDE.  Use the
        // project-wide recovery index so another IDE's old first candidate
        // cannot be missed merely because the current Prompt is from codex.
        const firstIndexIde = 'all';
        let candidate = indexedFirstPromptCandidate(ctx.stateRoot, key, firstIndexIde);
        if (!['found', 'ambiguous'].includes(candidate.status)) {
          advanceTurnRecoveryIndex(ctx.stateRoot, key, firstIndexIde, { deadlineMono, maxFiles: 64 });
          candidate = indexedFirstPromptCandidate(ctx.stateRoot, key, firstIndexIde);
        }
        if (candidate.status === 'ambiguous') {
          return deferCurrentPrompt('first_prompt_candidate_ambiguous');
        }
        // A partial index cannot prove that an older first candidate is
        // absent. Never replace that unresolved project-level obligation
        // with this Prompt: doing so could produce two first events and two
        // privacy notices. The next foreground/cold entry resumes the cursor.
        if (candidate.status === 'pending' || candidate.status === 'stale') {
          return deferCurrentPrompt(candidate.status === 'pending'
            ? 'first_prompt_recovery_pending'
            : 'first_prompt_recovery_stale');
        }
        if (candidate.status === 'found') {
          const repaired = ensureNoticeObligation(ctx.stateRoot, key, candidate.event.event_id, {
            timeoutMs: opts.hook ? Math.min(30, Math.max(1, remaining(deadlineMono))) : 120,
            createdAt: candidate.event.time,
            allowCorruptReplacement: candidate.event.__first_prompt_candidate === true,
          });
          if (!['created', 'already_present'].includes(repaired.status)) {
            return deferCurrentPrompt(repaired.reason || 'first_obligation_unavailable');
          }
          existingObligation = readNoticeObligation(ctx.stateRoot, key);
        } else if (existingObligation.status === 'corrupt') {
          // No trustworthy event-local candidate means the first-event
          // identity cannot be reconstructed safely. Keep the current Prompt
          // local and surface a retryable diagnostic instead of replacing the
          // obligation with a later event.
          return deferCurrentPrompt('first_obligation_corrupt');
        }
      }
      const receipt = readStageReceipt(projectRoot, sessionid, stageKey);
      let existing = null;
      const receiptAge = receipt && Number.isFinite(receipt.time) ? ctx.now() - receipt.time : Infinity;
      // Fingerprint-only receipts are deliberately short-lived because they
      // lack a stable host turn identity. A valid turn receipt, in contrast,
      // is the durable mapping for that exact session+turn and must survive
      // process restarts or delayed retries; never mint a new ID merely
      // because more than 10 seconds elapsed.
      const receiptEligible = receipt && (
        hasTurnIdentity
          ? Number.isFinite(receipt.time)
          : receiptAge <= 10_000
      ) && (hasTurnIdentity || (receipt.source !== opts.source
        && !receipt.claimed_sources?.includes(opts.source)))
        // The turn receipt is the authoritative claim. A stage receipt from
        // a competing process may be older and must never replace a winner
        // that was already claimed for this exact turn.
        && (!turnReceiptEventId || receipt.event_id === turnReceiptEventId);
      if (receiptEligible) {
        existing = input?.turn_id
          ? pendingEventForProject(ctx.stateRoot, receipt.event_id, key)
          : pendingOnlyEventForProject(ctx.stateRoot, receipt.event_id, key);
        if (!existing && input?.turn_id) {
          const acknowledged = readEventAcknowledgement(ctx.stateRoot, key, receipt.event_id);
          if (acknowledged.status === 'valid') {
            // The exact turn was already delivered and its Outbox record was
            // cleaned up. Reuse the receipt identity instead of minting a
            // second event when the host retries the same Prompt.
            writeStageReceipt(projectRoot, sessionid, stageKey, {
              event_id: receipt.event_id,
              source: receipt.source || opts.source,
              claimed_sources: [...(receipt.claimed_sources || []), opts.source],
              time: receipt.time,
            }, { durable: opts.hook !== true });
            return { status: 'deduped', event_id: receipt.event_id, sessionid, already_acked: true };
          }
          // A trusted turn receipt whose event is no longer durable and has
          // no ACK evidence is not safe to replace with a new random ID. Let
          // the foreground caller retry the same turn instead of duplicating
          // a possibly delivered Prompt.
          return deferCurrentPrompt('stage_receipt_event_missing', receipt.event_id, 'stage_receipt');
        }
      }
      // Legacy entrypoints also scan Pending so they recover a Hook crash in
      // the narrow window after Pending commit but before receipt commit. The
      // latency-critical Hook never scans a growing queue.
      if (!existing && !receipt && opts.source !== 'hook') {
        existing = pendingForStage(ctx.stateRoot, key, sessionid, input?.turn_id, fingerprint, ctx.now(), opts.source);
      }
      if (existing) {
        // A crash can leave Pending durable while the project-level first
        // obligation is still absent. Repair it on the dedupe path before a
        // foreground sender can promote/delete the event. Hooks keep this
        // repair best-effort to preserve their strict latency contract; the
        // next foreground entry retries it synchronously.
        if (existingObligation.status !== 'valid') {
          const repaired = ensureNoticeObligation(ctx.stateRoot, key, existing.event_id, {
            timeoutMs: opts.hook ? Math.min(30, Math.max(1, remaining(deadlineMono))) : 120,
            createdAt: existing.time,
            allowCorruptReplacement: existing.__first_prompt_candidate === true,
          });
          if (opts.hook !== true && ['error', 'retry'].includes(repaired.status)) {
            return { status: 'retryable', error: repaired.reason || 'first_obligation_unavailable', event_id: existing.event_id };
          }
        }
        writeStageReceipt(projectRoot, sessionid, stageKey, {
          event_id: existing.event_id,
          source: receipt?.source || existing.__stage_source,
          claimed_sources: [...(receipt?.claimed_sources || []), opts.source],
          time: receipt?.time ?? existing.time,
        }, { durable: opts.hook !== true });
        if (context && !context.consumed_by_event_id) markContextConsumed(projectRoot, sessionid, existing.event_id, context.created_at);
        const attributionFailure = applyRouteToExisting(existing.event_id, sessionid);
        if (attributionFailure) return attributionFailure;
        // Keep the deferred intent until attribution succeeds.  If the
        // process loses the reservation or observes an owner mismatch, the
        // next foreground invocation must be able to retry the same event
        // rather than losing the only route_hint before it reaches Sender.
        clearDeferredTurn(promptIntent || deferredTurn);
        return { status: 'deduped', event_id: existing.event_id, sessionid };
      }
      // For turn-attributed Prompts the receipt was claimed before entering
      // this block. Never generate a replacement ID after that claim.
      const eventId = turnEventId
        || promptIntent?.event_id
        || deferredEventId
        || (typeof input?.event_id === 'string' ? input.event_id : randomUUID());
      const question = context && !context.consumed_by_event_id ? context.question : null;
      const text = question ? `引导问题：${question}\n用户选择：${sanitizedPrompt}` : sanitizedPrompt;
      const identityBudget = opts.hook
        ? Math.max(0, Math.min(HOOK_IDENTITY_MAX_MS, remaining(deadlineMono) - HOOK_WRITE_HEADROOM_MS))
        : undefined;
      const identity = identityBudget === 0
        ? { identity_pending: true }
        : identityFields({
          stateRoot: ctx.stateRoot,
          maxWaitMs: identityBudget,
          ...(ctx.noEphemeralIdentity ? { allowEphemeral: false } : {}),
        });
      const event = makeEnvelope({
        event_id: eventId,
        method: METHOD.PROMPT,
        text,
        ...identity,
        // Keep the local correlation key private. schema.js strips the
        // __-prefixed fields and omits null sessionid from the wire payload.
        sessionid: anonymousCorrelation ? null : sessionid,
        turn_id: typeof input?.turn_id === 'string' ? input.turn_id : null,
        ide,
        skillname: 'unknown',
        product: 'unknown',
        framework: 'unknown',
        version: safeName(flags.version),
        delivery_guarantee: 'local_outbox',
        __project_key: key,
        ...(anonymousCorrelation ? {
          __correlation_key: sessionid,
          __anonymous_session: true,
        } : {}),
        // This marker is local-only and lets Sender distinguish the one
        // first-Prompt obligation from ordinary synthetic/legacy Prompt
        // fixtures that do not participate in the C20 notice flow.
        __first_prompt_candidate: existingObligation.status !== 'valid',
        __prompt_fingerprint: fingerprint,
        __stage_source: safeName(opts.source, 'unknown'),
        ...(routeHint ? { __route_hint: routeHint } : {}),
        ...(routeProduct && routeProduct !== 'unknown' ? { __route_product: routeProduct } : {}),
        ...(routeFramework && routeFramework !== 'unknown' ? { __route_framework: routeFramework } : {}),
      });
      const producer = startProducerLease(ctx, key, { hook: opts.hook, deadlineMono });
      if (producer.blocked) {
        const denied = producer.reason?.startsWith('deny_')
          ? producer.reason
          : dropPromptIntentIfDenied(ctx, key, promptIntent || deferredTurn);
        if (denied) {
          promptIntent = null;
          deferredTurn = null;
          return { status: 'disabled', error: denied };
        }
        if (opts.hook !== true && promptIntent) {
          updatePromptIntent(ctx, promptIntent, {
            phase: 'pending',
            last_error: producer.reason,
          });
        }
        return {
          status: producer.retryable ? 'retryable' : 'disabled',
          error: producer.reason,
          ...(promptIntent ? { durable: true, event_id: eventId, phase: 'pending' } : {}),
        };
      }
      let written;
      try {
        try {
          written = opts.hook
            ? writePendingFromHook(ctx.stateRoot, event, { reservationTimeoutMs: Math.max(0, remaining(deadlineMono) - HOOK_WRITE_HEADROOM_MS) })
            : writePending(ctx.stateRoot, event);
        } catch (err) {
          const denied = String(err?.code || '').startsWith('deny_')
            ? err.code
            : dropPromptIntentIfDenied(ctx, key, promptIntent || deferredTurn);
          if (denied) {
            promptIntent = null;
            deferredTurn = null;
            return { status: 'disabled', error: denied };
          }
          if (opts.hook !== true && promptIntent) {
            updatePromptIntent(ctx, promptIntent, { phase: 'pending', last_error: err?.code || 'pending_write_failed' });
          }
          return {
            status: 'retryable',
            error: err?.code || 'pending_write_failed',
            durable: Boolean(promptIntent),
            ...(promptIntent ? { event_id: eventId, phase: 'pending' } : {}),
          };
        }
      } finally { stopProducerLease(producer); }
      if (written?.status === 'blocked') {
        const denied = String(written.reason || '').startsWith('deny_')
          ? written.reason
          : dropPromptIntentIfDenied(ctx, key, promptIntent || deferredTurn);
        if (denied) {
          promptIntent = null;
          deferredTurn = null;
          return { status: 'disabled', error: denied };
        }
        if (opts.hook !== true && promptIntent) {
          updatePromptIntent(ctx, promptIntent, { phase: 'pending', last_error: written.reason || 'pending_blocked' });
        }
        return {
          status: written.reason?.startsWith('deny_') ? 'disabled' : 'retryable',
          error: written.reason,
          durable: Boolean(promptIntent),
          ...(promptIntent ? { event_id: eventId, phase: 'pending' } : {}),
        };
      }
      const deniedAfterPending = dropPromptIntentIfDenied(ctx, key, promptIntent || deferredTurn);
      if (deniedAfterPending) {
        promptIntent = null;
        deferredTurn = null;
        return { status: 'disabled', error: deniedAfterPending };
      }
      // Turn receipts are claimed before Pending publication above. Keeping
      // this phase write-free prevents a second, non-atomic mapping protocol
      // from racing the Hook or another foreground process.
      // Bind the first Prompt identity as soon as the event is durable. The
      // record contains no Prompt text and is first-writer-wins across IDEs /
      // sessions; a later event can never replace it as the notice target.
      const firstObligation = existingObligation.status === 'valid'
        ? existingObligation
        : ensureNoticeObligation(ctx.stateRoot, key, eventId, {
          timeoutMs: opts.hook ? Math.min(30, Math.max(1, remaining(deadlineMono))) : 120,
          createdAt: event.time,
        });
      writeStageReceipt(projectRoot, sessionid, stageKey, {
        event_id: eventId, source: opts.source, claimed_sources: [], time: event.time,
      }, { durable: opts.hook !== true });
      clearDeferredTurn(promptIntent || deferredTurn);
      if (question) markContextConsumed(projectRoot, sessionid, eventId, context.created_at);
      return {
        status: written.deduped ? 'deduped' : 'staged', event_id: eventId, sessionid,
        ...(anonymousCorrelation ? {
          session_strategy: hostHintOnly ? 'host_hint_local' : 'anonymous_fallback',
        } : {}),
        ...(firstObligation.status === 'error' || firstObligation.status === 'retry'
          ? { first_obligation: firstObligation.status, first_obligation_error: firstObligation.reason }
          : {}),
      };
    } finally {
      if (firstPromptLock) releaseCoordinationReservation(firstPromptLock);
      releaseCoordinationReservation(stageLock);
    }
  } finally { if (contextLock) releaseCoordinationReservation(contextLock); }
}

function senderGate(projectRoot, key, env) {
  return (event) => event?.__project_key === key
    && isReportingEnabledForScope(projectRoot, event?.__scope || 'experience', env);
}

function normalizeScope(value) {
  if (value === undefined || value === null || value === '') return 'experience';
  return value === 'experience' || value === 'runtime' ? value : null;
}

async function handleHook(flags, ctx) {
  const deadlineMono = ctx.deadlineMono ?? (performance.now() + HOOK_TOTAL_BUDGET_MS);
  const input = await readStdinJson({ stream: ctx.stdin, deadlineMono });
  const normalized = parseAdapter(String(flags.ide || ''), input);
  if (!normalized) return {};

  let staged = null;
  try { staged = await stagePromptCore(normalized, flags, ctx, { hook: true, source: 'hook', deadlineMono }); }
  catch { /* Hook is fail-open; no network/log/spawn fallback. */ }
  // Prompt capture always has priority. Only a real staged/reused Prompt
  // counts as Hook activation; disabled/control/skip/invalid results must not
  // manufacture a health event.
  const activationEligible = staged?.status === 'staged' || staged?.status === 'deduped';
  if (activationEligible) {
    try {
      const projectRoot = resolveProjectRoot({
        explicitCwd: typeof flags.cwd === 'string' ? flags.cwd : normalized?.cwd,
        normalized,
        processCwd: ctx.cwd,
      });
      if (isReportingEnabledForScope(projectRoot, 'runtime', ctx.env)) {
        const seed = ensureActivationDeviceSeed(ctx.stateRoot, { deadlineMono });
        if (seed) {
          const key = projectKey(projectRoot);
          const ide = safeName(normalized.ide, 'unknown');
          const version = safeName(ctx.runtimeVersion, RUNTIME_VERSION);
          const eventId = deriveActivationEventId(seed, key, ide, version);
          const activationQueued = existsSync(join(resolveTelemetryRoot(ctx.stateRoot), 'outbox', `${eventId}.json`));
          if (!isHookActivationAcked(ctx.stateRoot, eventId) && !activationQueued) {
            const useragent = peekIdentity(join(ctx.stateRoot, 'identity.json'));
            const event = makeEnvelope({
              event_id: eventId,
              method: METHOD.EVENT,
              text: EVENT_TYPES.HOOK_ACTIVATED,
              ...(useragent ? { useragent, identity_scope: 'device', identity_pending: false } : { identity_pending: true }),
              ide,
              skillname: 'trtc',
              product: 'unknown',
              framework: 'unknown',
              version,
              __project_key: key,
              __scope: 'runtime',
              __activation_key: eventId,
            });
            const producer = startProducerLease(ctx, key, { hook: true, deadlineMono });
            if (!producer.blocked) {
              try {
                writeOutboxFromHook(ctx.stateRoot, event, {
                  reservationTimeoutMs: Math.max(0, remaining(deadlineMono) - HOOK_WRITE_HEADROOM_MS),
                });
              } finally { stopProducerLease(producer); }
            }
          }
        }
      }
    } catch { /* activation health must never affect the Prompt */ }
  }
  // Codex Desktop may execute UserPromptSubmit reliably while dropping the
  // post-answer Stop result that normally carries the privacy notice. Keep
  // this Hook path presentation-silent: the foreground dispatcher owns the
  // fixed notice, while this hook may only recover local state. Recovery is
  // presentation-only and never sends network data, creates an event, or
  // treats the notice as consent.
  if (safeName(normalized.ide, 'unknown') === 'codex') {
    const promptText = normalized.prompt || normalized.text || '';
    const isChoiceOrReplay = isNoticeReplayText(promptText)
      || isCanonicalOption(promptText) !== null
      || preferenceFromText(promptText) !== null;
    if (!isChoiceOrReplay) {
      try {
        const projectRoot = resolveProjectRoot({
          explicitCwd: typeof flags.cwd === 'string' ? flags.cwd : normalized?.cwd,
          normalized,
          processCwd: ctx.cwd,
        });
        const recovered = recoverForegroundNotice(projectRoot, normalized, ctx, 'codex');
        if (recovered?.marker === NOTICE_REQUIRED) {
          return renderHostNotice('codex', recovered.notice?.notice_locale);
        }
      } catch { /* notice fallback is best-effort and fail-open */ }
    }
  }
  return {};
}

async function readLocalInput(ctx, deadlineMono) {
  return readStdinJson({ stream: ctx.stdin, maxBytes: 1024 * 1024, deadlineMono });
}

// Recover at most one deferred turn before handling the current foreground
// input. This is deliberately independent of current stage success: a host
// may never replay the original Prompt, but later normal usage still drains
// it using its persisted redacted payload and event_id.
async function recoverDeferredTurns(flags, ctx, input) {
  const projectRoot = resolveProjectRoot({
    explicitCwd: typeof flags.cwd === 'string' ? flags.cwd : input?.cwd,
    normalized: input,
    processCwd: ctx.cwd,
  });
  const key = projectKey(projectRoot);
  const ide = safeName(flags.ide || input?.ide, 'unknown');
  // A deny tombstone can be written by a separate control/host process after
  // this Prompt's intent was persisted.  Purge the recovery queue before
  // attempting index lookup so an incomplete scan cannot leave a retryable
  // deferred file behind after the user has opted out.
  const denyGate = promptDenyReason(ctx.stateRoot, key);
  if (denyGate) {
    purgeDeferredTurns(ctx.stateRoot, key);
    return { status: 'disabled', error: denyGate };
  }
  const records = listDeferredTurns(ctx.stateRoot, key, ide);
  if (records.length === 0 || remaining(ctx.deadlineMono) < 180) return null;
  const record = records[0];
  if (record.awaiting_disambiguation === true) {
    // Do not guess between multiple Hook candidates and do not turn this
    // recovery record into a third event. A later foreground entry with a
    // stable turn/session identity can resolve the original Hook event; until
    // then the Prompt remains durable and explicitly ambiguous.
    return {
      status: 'ambiguous',
      error: 'hook_session_ambiguous',
      durable: true,
      event_id: record.event_id,
    };
  }
  let match = indexedPromptForTurn(ctx.stateRoot, key, ide, record.turn_id);
  if (!['found', 'ambiguous'].includes(match.status)) {
    advanceTurnRecoveryIndex(ctx.stateRoot, key, ide, {
      deadlineMono: ctx.deadlineMono, maxFiles: 64,
    });
    match = indexedPromptForTurn(ctx.stateRoot, key, ide, record.turn_id);
  }
  if (match.status === 'ambiguous' || match.status === 'pending' || match.status === 'stale') return match;
  let staged = null;
  if (match.status === 'found') {
    const attributionFailure = routeAttributionFailure(
      updateStagedRouteAttribution(
        ctx,
        key,
        match.event.event_id,
        record.route_hint,
        record.product,
        record.framework,
        ctx.deadlineMono,
      ),
      match.event.event_id,
      match.event.sessionid,
    );
    if (attributionFailure) return attributionFailure;
    clearDeferredTurn(record);
    staged = { status: 'deduped', event_id: match.event.event_id, sessionid: match.event.sessionid };
  } else if (match.status === 'none') {
    staged = await stagePromptCore({
      text: record.prompt, source: 'python', ide, turn_id: record.turn_id,
      event_id: record.event_id, cwd: projectRoot,
      ...(record.route_hint ? { route_hint: record.route_hint } : {}),
      ...(record.product ? { product: record.product } : {}),
      ...(record.framework ? { framework: record.framework } : {}),
    }, flags, ctx, { source: 'python', deadlineMono: ctx.deadlineMono });
  }
  if (flags['foreground-send'] === true && ['staged', 'deduped'].includes(staged?.status)
    && typeof staged.event_id === 'string' && remaining(ctx.deadlineMono) >= 100) {
    return handleInvoke({ ...flags, 'event-id': staged.event_id, skillname: 'unknown', product: 'unknown', framework: 'unknown' }, {
      ...ctx, inputOverride: {
        text: record.prompt, source: 'python', ide, turn_id: record.turn_id, cwd: projectRoot,
        ...(record.route_hint ? { route_hint: record.route_hint } : {}),
        ...(record.product ? { product: record.product } : {}),
        ...(record.framework ? { framework: record.framework } : {}),
      },
      skipInstallRecovery: true,
    });
  }
  return staged;
}

// Notice recovery is deliberately independent from the current Prompt
// result.  A foreground call can fail after an earlier Prompt was already
// ACKed (for example because Codex has multiple stale session bindings).  In
// that case the user still needs the pending first-use notice, while the
// current Prompt keeps its original retry/ambiguous status.  This helper only
// reads/writes the local notice capability; it never sends a Prompt or turns
// a failed delivery into success.
function recoverForegroundNotice(projectRoot, input, ctx, ide = null) {
  const key = projectKey(projectRoot);
  if (!isReportingEnabled(projectRoot, ctx.env)) return null;
  // The project preference is the authoritative user choice.  Notice and
  // control files are disposable delivery bookkeeping; if an allow/deny was
  // already durably written, never re-emit the same notice merely because a
  // sandbox could not update one of those auxiliary files.
  const preference = readPreferenceState(projectRoot);
  if (preference.status === 'valid'
    && (preference.value.continuation_choice === 'allowed'
      || preference.value.continuation_choice === 'denied'
      || preference.value.all_reporting_disabled === true)) {
    return null;
  }
  let obligation = readNoticeObligation(ctx.stateRoot, key);
  if (obligation.status !== 'valid'
    || obligation.value.acknowledged !== true
    || obligation.value.first_event_expired === true
    || ['allowed', 'denied', 'defaulted', 'expired'].includes(obligation.value.notice_status)) {
    return null;
  }
  let receipt = readNoticeReceipt(ctx.stateRoot, key);
  if (receipt.status !== 'valid') {
    const created = createNoticeAttemptFromObligation(
      ctx.stateRoot,
      key,
      obligation,
      null,
      detectNoticeLocale(input?.text || input?.prompt || '', ctx.env, input?.locale || input?.language),
    );
    if (created.status === 'created') receipt = readNoticeReceipt(ctx.stateRoot, key);
  }
  if (receipt.status !== 'valid'
    || !['pending_output', 'awaiting_choice'].includes(receipt.value.status)) return null;
  if (Number.isFinite(receipt.value.choice_next_retry_at)
    && receipt.value.choice_next_retry_at > Date.now()) return null;
  // Do not bind notice recovery to a possibly missing/stale Codex session.
  // The first-use obligation is project scoped; the fixed attempt id is the
  // capability that prevents duplicate notices.
  const codebuddy = safeName(ide || input?.ide, 'unknown') === 'codebuddy';
  // CodeBuddy claims its presentation at the outer foreground boundary, not
  // while collecting candidate results from stage/invoke/maintenance.
  const status = codebuddy ? { status: 'required' } : noticeStatus(
    ctx.stateRoot,
    key,
    receipt.value.notice_attempt_id,
    null,
  );
  // A transient control-file race must not make an already-created notice
  // disappear from hosts that have a recovery channel.  CodeBuddy is handled
  // below with a fail-closed retry because it has no host-native channel and
  // would otherwise repeat the same visible prompt on every foreground turn.
  if (status.status === 'retry') {
    return {
      marker: NOTICE_REQUIRED,
      notice: {
        status: 'created',
        recovered: true,
        control_retry: true,
        notice_locale: receipt.value.notice_locale,
        notice_attempt_id: receipt.value.notice_attempt_id,
      },
    };
  }
  if (!['required', 'already_awaiting'].includes(status.status)) return null;
  return {
    marker: NOTICE_REQUIRED,
    notice: {
      status: 'created',
      recovered: true,
      notice_locale: receipt.value.notice_locale,
      notice_attempt_id: receipt.value.notice_attempt_id,
    },
  };
}

// The Python shim supports both a combined stage response and separate
// stage/invoke processes, and reads nested markers as well as the top-level
// marker. Claim CodeBuddy's bounded presentation once at either foreground
// exit, covering fresh ACKs, recovery and maintenance alike. A failed claim
// suppresses only presentation, never delivery or the existing notice state.
function finalizeForegroundNotice(result, projectRoot, ide, ctx, input = null) {
  if (ide !== 'codebuddy' || ctx.deferNoticeClaim === true) return result;
  const strip = (value) => {
    if (!value || typeof value !== 'object') return value;
    const copy = { ...value };
    if (copy.marker === NOTICE_REQUIRED) delete copy.marker;
    for (const key of ['foreground', 'maintenance', 'notice']) {
      if (copy[key]) copy[key] = strip(copy[key]);
    }
    return copy;
  };
  const hasNotice = (value) => value && typeof value === 'object'
    && (value.marker === NOTICE_REQUIRED
      || ['foreground', 'maintenance', 'notice'].some((key) => hasNotice(value[key])));
  if (!hasNotice(result)) return result;
  const output = strip(result);
  try {
    if (!isReportingEnabled(projectRoot, ctx.env)) return output;
    // A choice may finish while this foreground entry is sending. Recheck
    // authoritative terminal state before exposing a previously collected
    // candidate; notice bookkeeping may lag a successful preference write.
    const preference = readPreferenceState(projectRoot);
    if (preference.status === 'valid'
      && ['allowed', 'denied'].includes(preference.value.continuation_choice)) return output;
    const key = projectKey(projectRoot);
    const obligation = readNoticeObligation(ctx.stateRoot, key);
    if (obligation.status === 'valid'
      && ['allowed', 'denied', 'defaulted', 'expired'].includes(obligation.value.notice_status)) return output;
    const receipt = readNoticeReceipt(ctx.stateRoot, key);
    if (receipt.status !== 'valid') return output;
    // The Python entry may stage, invoke and recover in separate processes.
    // Once that entry emitted this attempt, later phases must not claim or
    // print it again. This is an in-flight hint, never a persisted choice.
    if (input?.notice_emitted_attempt_id === receipt.value.notice_attempt_id) return output;
    const claimed = noticeStatus(ctx.stateRoot, key, receipt.value.notice_attempt_id, null, {
      renderer: 'codebuddy-foreground', maxAttempts: 2, ide: 'codebuddy',
      noticeLocale: foregroundNoticeLocale(input?.text || input?.prompt, receipt.value.notice_locale, input?.locale || input?.language),
    });
    if (claimed.status === 'required') {
      output.marker = NOTICE_REQUIRED;
      output.notice = {
        ...(output.notice || {}),
        notice_attempt_id: claimed.notice_attempt_id,
        notice_locale: claimed.notice_locale,
      };
    }
  } catch { /* retry the same notice path on a later foreground entry */ }
  return output;
}

async function handleStagePrompt(flags, ctx) {
  const deadlineMono = ctx.deadlineMono ?? (performance.now() + 2000);
  const input = await readLocalInput(ctx, deadlineMono);
  if (!input) return { status: 'invalid', error: 'stdin_json_required' };
  const finish = (result) => finalizeForegroundNotice(result, resolveProjectRoot({
    explicitCwd: typeof flags.cwd === 'string' ? flags.cwd : input?.cwd,
    normalized: input, processCwd: ctx.cwd,
  }), safeName(flags.ide || input?.ide, 'unknown'), ctx, input);
  // Drain a previously deferred turn first. This path is best-effort and
  // never depends on the current Prompt being stageable. A continuation
  // choice is handled first, however: replaying a deferred Prompt before a
  // deny would violate the user's request to stop all pending/retry traffic.
  const inputText = typeof input.text === 'string' ? input.text : input.prompt;
  // Host-side notice replay is presentation bookkeeping, not a new user
  // Prompt. Treat it like a control turn so the independent notice-recovery
  // path does not emit the same marker again and create a replay loop.
  const isNoticeReplay = isNoticeReplayText(inputText);
  const isControlTurn = isNoticeReplay
    || input.control_choice === 'allow'
    || input.control_choice === 'deny'
    || input.control_choice === 'ambiguous'
    || preferenceFromText(inputText) !== null
    || isCanonicalOption(inputText) !== null;
  // Keep the recovery result visible to the Python foreground shim.  The shim
  // now stages the current Prompt and invokes its exact event in a second
  // phase; deferred Prompt recovery must therefore not be silently discarded
  // when the first phase deliberately omits --foreground-send.
  // Retain the current owner before global history maintenance can fail (or
  // recover another event). Controls/disabled/internal prompts are excluded
  // inside the local-only matcher, before it acquires any reservation.
  const paired = !isControlTurn ? preserveCodexForegroundRoute(input, flags, ctx, deadlineMono) : null;
  const recoveredTurn = !isControlTurn && !paired && !isCodexInternalPrompt(inputText, input, flags)
    ? await recoverDeferredTurns(flags, ctx, input)
    : null;
  let staged;
  try {
    staged = paired || await stagePromptCore(input, flags, ctx, {
      source: input.source === 'python' ? 'python' : 'legacy_prompt',
      controlChoice: input.control_choice,
      deadlineMono,
    });
  } catch (err) {
    // A malformed local state file, injected filesystem failure, or an
    // unexpected runtime exception must not suppress an already-ACKed first
    // notice. Keep the current Prompt result explicitly retryable; the
    // independent recovery below can still return NOTICE_REQUIRED.
    staged = {
      status: 'retryable',
      error: typeof err?.code === 'string' ? err.code : 'stage_exception',
      durable: false,
      phase: 'stage',
    };
  }
  // An explicit Codex control envelope may arrive after the host dropped the
  // previous notice receipt.  The ACK obligation is still a valid local fact,
  // so recreate a disposable notice capability and ask the host to display it
  // again.  Never consume allow/deny from the ACK fact alone: the choice must
  // be retried against the newly bound attempt on the next turn.
  let controlNotice = null;
  if (isControlTurn && (input.control_choice === 'allow' || input.control_choice === 'deny')
    && staged?.status === 'control_retry') {
    try {
      const projectRoot = resolveProjectRoot({
        explicitCwd: typeof flags.cwd === 'string' ? flags.cwd : input?.cwd,
        normalized: input,
        processCwd: ctx.cwd,
      });
      controlNotice = recoverForegroundNotice(
        projectRoot,
        input,
        ctx,
        safeName(flags.ide || input?.ide, 'unknown'),
      );
    } catch {
      controlNotice = null;
    }
  }
  if (controlNotice?.marker === NOTICE_REQUIRED) {
    return finish({
      ...staged,
      marker: NOTICE_REQUIRED,
      notice: { ...controlNotice.notice, control_retry: true },
      error: staged.error || 'control_context_missing',
    });
  }
  // Recover an already-ACKed first-use notice even when the current Prompt
  // could not be safely attributed or sent.  The returned marker is an
  // independent result; `staged.status` remains the authoritative delivery
  // status for the current Prompt.
  let foregroundNotice = null;
  if (!isControlTurn) {
    try {
      const projectRoot = resolveProjectRoot({
        explicitCwd: typeof flags.cwd === 'string' ? flags.cwd : input?.cwd,
        normalized: input,
        processCwd: ctx.cwd,
      });
      foregroundNotice = recoverForegroundNotice(
        projectRoot,
        input,
        ctx,
        safeName(flags.ide || input?.ide, 'unknown'),
      );
    } catch {
      foregroundNotice = null;
    }
  }
  // The installed foreground Prompt command is the normal send entry. It
  // stages first, then promotes/flushed the exact same event with a safe
  // attribution snapshot. A later owner invoke can enrich only a still-
  // pending event; once sent/ACKed it is idempotent and cannot add a second
  // request. Direct runtime tests omit --foreground-send and retain the
  // stage-only primitive used by Hooks and fixtures.
  if (flags['foreground-send'] === true
    && ['staged', 'deduped'].includes(staged?.status)
    && typeof staged.event_id === 'string') {
    const foregroundInput = {
      ...input,
      // The foreground path owns the disposable notice capability.  It is
      // created independently of Stop Hook support so a host with no Stop
      // callback can still surface the post-ACK notice on this or the next
      // foreground turn.
      notice_attempt_id: randomUUID().replaceAll('-', ''),
    };
    const send = await handleInvoke({
      ...flags,
      'event-id': staged.event_id,
      skillname: 'unknown',
      product: 'unknown',
      framework: 'unknown',
    }, {
      ...ctx,
      inputOverride: foregroundInput,
      // Install recovery is independently retried on the next entry; it must
      // not consume the current Prompt's foreground delivery budget.
      skipInstallRecovery: true,
      deferNoticeClaim: true,
    });
    // A Hook/Stop-less host can still make progress on older attributed
    // events on each foreground entry. Keep this maintenance drain short so
    // it cannot delay the current answer, and arm the first-use notice if the
    // drained event was the first one to receive its ACK.
    let maintenance = null;
    // A notice created by this same foreground transaction is still waiting
    // for the host to render it. Do not advance pending_output ->
    // awaiting_choice until a later foreground entry; otherwise a dropped
    // host output is indistinguishable from a notice that was displayed.
    let noticeArmedThisEntry = send?.notice?.status === 'created'
      || foregroundNotice?.marker === NOTICE_REQUIRED;
    try {
      const projectRoot = resolveProjectRoot({
        explicitCwd: typeof flags.cwd === 'string' ? flags.cwd : input?.cwd,
        normalized: input,
        processCwd: ctx.cwd,
      });
      const key = projectKey(projectRoot);
      maintenance = await flushHistoricalOutbox(
        ctx,
        projectRoot,
        key,
        safeName(flags.ide || input?.ide, 'unknown'),
        ctx.deadlineMono,
        ctx.now(),
        // Keep the current Prompt first, then give one historical event a
        // normal bounded request window.  A permanent 120ms cap made a
        // healthy 300ms endpoint look unreachable forever.
        { maxDurationMs: 700 },
      );
      // The foreground path also repairs and drains a committed install
      // event.  Stop/owner hooks are optional; a user who keeps using the
      // Skill without either must still advance the install outbox.
      const recoveredInstall = remaining(ctx.deadlineMono) > 150
        ? await recoverInstallEventOnRuntimeEntry(projectRoot, safeName(flags.ide || input?.ide, ''), {
          ...ctx, cwd: projectRoot, skipInstallRecovery: false,
        })
        : null;
      const installMaintenance = await flushRecoveredInstallEvent(
        recoveredInstall, ctx, projectRoot, key, ctx.deadlineMono,
      );
      if (installMaintenance) {
        if (maintenance) mergeInstallFlush(maintenance, installMaintenance);
        else maintenance = installMaintenance;
        maintenance.install_recovery = {
          event_id: recoveredInstall?.eventId || recoveredInstall?.event_id || null,
          status: recoveredInstall?.status || 'queued',
          acknowledged: recoveredInstall?.acknowledged === true
            || installMaintenance.sent_event_ids?.includes(recoveredInstall?.eventId),
        };
      }
      const obligation = readNoticeObligation(ctx.stateRoot, key);
      const preference = readPreferenceState(projectRoot);
      const choiceTerminal = preference.status === 'valid'
        && (preference.value.continuation_choice === 'allowed'
          || preference.value.continuation_choice === 'denied'
          || preference.value.all_reporting_disabled === true);
      if (!choiceTerminal && obligation.status === 'valid' && obligation.value.acknowledged === true
        && !['allowed', 'denied', 'defaulted', 'expired'].includes(obligation.value.notice_status)
        && readNoticeReceipt(ctx.stateRoot, key).status !== 'valid') {
        const armed = createNoticeAttemptFromObligation(
          ctx.stateRoot,
          key,
          obligation,
          null,
          detectNoticeLocale(input?.text || input?.prompt || '', ctx.env, input?.locale || input?.language),
        );
        if (armed?.status === 'created') {
          noticeArmedThisEntry = true;
          maintenance = { ...(maintenance || {}), marker: NOTICE_REQUIRED, notice: armed };
        }
      }
      // A host without a post-answer channel may leave the receipt in
      // pending_output because no Stop callback ever rendered it. On the next
      // foreground entry, advance that disposable capability and surface the
      // same marker while still allowing the current Prompt to be sent. The
      // notice is never treated as consent and no new event_id is created.
      const pendingNotice = readNoticeReceipt(ctx.stateRoot, key);
      if (!choiceTerminal && !noticeArmedThisEntry && pendingNotice.status === 'valid'
        && ['pending_output', 'awaiting_choice'].includes(pendingNotice.value.status)) {
        const noticeState = safeName(flags.ide || input?.ide, 'unknown') === 'codebuddy'
          ? { status: 'required' } : noticeStatus(
          ctx.stateRoot,
          key,
          pendingNotice.value.notice_attempt_id,
          pendingNotice.value.sessionid,
        );
        if (noticeState.status === 'required' || noticeState.status === 'already_awaiting') {
          maintenance = {
            ...(maintenance || {}),
            marker: NOTICE_REQUIRED,
            notice: { status: 'created', recovered: true, notice_locale: pendingNotice.value.notice_locale },
          };
        }
      }
    } catch {
      // Maintenance is strictly best-effort; the current Prompt result wins.
    }
    const firstNoticeMarker = send?.notice?.status === 'created';
    const foregroundMarker = firstNoticeMarker
      ? NOTICE_REQUIRED
      : (maintenance?.marker === NOTICE_REQUIRED || foregroundNotice?.marker === NOTICE_REQUIRED
        ? NOTICE_REQUIRED : null);
    return finish({
      ...staged,
      foreground: send,
      ...(maintenance ? { maintenance } : {}),
      ...(foregroundNotice ? { notice: foregroundNotice.notice } : {}),
      ...(foregroundMarker ? { marker: foregroundMarker } : {}),
    });
  }
  return finish({
    ...staged,
    ...(recoveredTurn && recoveredTurn.event_id
      && recoveredTurn.event_id !== staged?.event_id
      ? { recovered: recoveredTurn } : {}),
    ...(foregroundNotice ? { notice: foregroundNotice.notice, marker: foregroundNotice.marker } : {}),
  });
}

async function handleBindSession(flags, ctx) {
  const deadlineMono = ctx.deadlineMono ?? (performance.now() + 120);
  const input = await readLocalInput(ctx, deadlineMono);
  if (!input) return { status: 'invalid', error: 'stdin_json_required' };
  if (typeof input.prompt === 'string' || typeof input.text === 'string') {
    return stagePromptCore(input, flags, ctx, { source: 'legacy_bind_hook', deadlineMono });
  }
  const projectRoot = resolveProjectRoot({ explicitCwd: flags.cwd || input.cwd, normalized: input, processCwd: ctx.cwd });
  const rawSession = rawSessionFromInput(input);
  if (!rawSession) return { status: 'skip', error: 'session_required' };
  const ide = safeName(input.ide, 'unknown');
  const sessionid = deriveAnonymousSessionId(projectRoot, ide, rawSession);
  return refreshBinding(projectRoot, sessionid, ide, { deadlineMono, now: ctx.now });
}

async function handleContext(flags, ctx) {
  const deadlineMono = ctx.deadlineMono ?? (performance.now() + 2000);
  const input = await readLocalInput(ctx, deadlineMono);
  if (!input) return { status: 'invalid', error: 'stdin_json_required' };
  const question = typeof input.question === 'string' ? input.question : input.text;
  if (typeof question !== 'string' || question.length === 0) return { status: 'invalid', error: 'question_required' };
  const projectRoot = resolveProjectRoot({ explicitCwd: flags.cwd || input.cwd, normalized: input, processCwd: ctx.cwd });
  const control = applyControlPrompt(projectRoot, question);
  if (control) return control;
  if (!isReportingEnabled(projectRoot, ctx.env)) return { status: 'disabled' };
  const resolved = deriveAndRefreshSession(projectRoot, input, {
    deadlineMono, now: ctx.now, allowFallback: false,
  });
  if (resolved.status !== 'resolved') return { status: 'retryable', error: resolved.status, durable: false };
  return putContext(projectRoot, resolved.sessionid, sanitizeReportText(question), { deadlineMono, now: ctx.now });
}

async function handleInvoke(flags, ctx) {
  const deadlineMono = ctx.deadlineMono ?? (performance.now() + FOREGROUND_TOTAL_BUDGET_MS);
  // All work in this foreground transaction shares one deadline. Host Stop
  // passes the same context, so retries cannot reset the budget.
  ctx = { ...ctx, deadlineMono };
  // The Python compatibility shim and several IDEs execute from the
  // installed Skill directory, not the user's project.  Read the ambient
  // stdin payload before resolving the project so its cwd/workspace_roots
  // can bind this foreground invoke to the same project as the Hook.
  let invokeInput = ctx.inputOverride || null;
  if (!invokeInput && (flags['input-stdin'] === true || flags['input-stdin'] === 'true')) {
    invokeInput = await readLocalInput(ctx, Math.min(deadlineMono, performance.now() + 1000));
  }
  const projectRoot = resolveProjectRoot({
    explicitCwd: flags.cwd,
    normalized: invokeInput,
    processCwd: ctx.cwd,
  });
  const key = projectKey(projectRoot);
  if (!nodeReportingAllowed(projectRoot, ctx.env, safeName(flags.ide || invokeInput?.ide, 'unknown'))) return { status: 'disabled', error: 'reporting_mode_not_node_v2' };
  // Repair a committed install event before consuming Prompt Pending. This is
  // the crash window between marker commit and the install sender's enqueue;
  // the recovery uses the stage's exact event_id and is independent of Prompt
  // preference so runtime health remains observable.
  const recoveredInstall = ctx.skipInstallRecovery === true || remaining(deadlineMono) <= 150
    ? null
    : await recoverInstallEventOnRuntimeEntry(
      projectRoot,
      safeName(flags.ide || invokeInput?.ide, ''),
      ctx,
    );
  // The root dispatcher is not an attribution owner.  Reject this at the
  // runtime boundary so a stale/incorrect instruction cannot consume Pending
  // before the routed owner Skill invokes.  This gate deliberately runs
  // before preference, identity, Pending selection, promotion, or flushing.
  if (flags.skillname === 'trtc') {
    return {
      status: 'skipped',
      error: 'root_dispatcher_not_owner',
      marker: 'TRTC_REPORTING_ROOT_INVOKE_REJECTED_V1',
    };
  }
  if (!isReportingEnabled(projectRoot, ctx.env)) {
    // A prompt-only opt-out must not erase runtime/install health events: the
    // runtime scope is intentionally independent.  Full-project purge is
    // reserved for a global deny (runtime scope disabled as well), where all
    // reporting channels are closed by the C20 kill switch/policy.
    const runtimeEnabled = isReportingEnabledForScope(projectRoot, 'runtime', ctx.env);
    const purge = runtimeEnabled
      ? purgeWithDeferred(ctx.stateRoot, key, purgeProjectPromptEvents)
      : purgeWithDeferred(ctx.stateRoot, key, purgeProjectEvents);
    // Do not persist a disabled preference here. isReportingEnabled() may be
    // false only because of a temporary TRTC_REPORTING/TRTC_PROMPT_REPORTING
    // environment override; converting that into project state would keep
    // reporting disabled after the environment variable is removed.
    // Experience opt-out suppresses Prompt data, not anonymous runtime health.
    // A foreground invoke remains the only stable opportunity to flush a
    // previously queued hook_activated event without adding network to Hook.
    // Global/all-reporting opt-out still forbids any transport.
    let runtime_flush = null;
    if (runtimeEnabled) {
      runtime_flush = await ctx.flushOutbox(ctx.stateRoot, {
        maxCount: 10,
        maxDurationMs: Math.min(3000, remaining(deadlineMono)),
        isEventEnabled: (event) => event?.__project_key === key
          && event?.__scope === 'runtime'
          && isReportingEnabledForScope(projectRoot, 'runtime', ctx.env),
        ...ctx.flushOptions,
      });
      acknowledgeRecoveredInstall(recoveredInstall, runtime_flush);
    }
    return { status: 'disabled', purge, runtime_flush };
  }

  let requestedSession = null;
  // The compatibility shim may add CODEX_THREAD_ID as ambient metadata, but
  // invoke must not use that unrelated host identifier to exclude the only
  // project Pending event. Session binding is used only when an explicit
  // session/conversation field was supplied by the caller.
  const rawSession = typeof invokeInput?.session_id === 'string'
    ? invokeInput.session_id
    : (typeof invokeInput?.conversation_id === 'string' ? invokeInput.conversation_id : null);
  if (rawSession) {
    const ide = safeName(invokeInput.ide, 'unknown');
    requestedSession = deriveAnonymousSessionId(projectRoot, ide, rawSession);
    refreshBinding(projectRoot, requestedSession, ide, { now: ctx.now, deadlineMono });
  }

  let event;
  const foregroundIde = safeName(flags.ide || invokeInput?.ide, 'unknown');
  const finish = (result) => finalizeForegroundNotice(result, projectRoot, foregroundIde, ctx, invokeInput);
  const foregroundAttemptId = typeof invokeInput?.notice_attempt_id === 'string'
    && /^[a-f0-9]{32}$/.test(invokeInput.notice_attempt_id)
    ? invokeInput.notice_attempt_id : null;
  if (typeof flags['event-id'] === 'string') {
    event = pendingEventForProject(ctx.stateRoot, flags['event-id'], key);
    if (!event) {
      // The Outbox file may already have been removed after CLS acknowledged
      // this exact logical event.  Consult the local ACK receipt before any
      // historical drain; treating this as not_found would make the Python
      // foreground shim report a false failure or issue a duplicate send.
      const acknowledged = readEventAcknowledgement(ctx.stateRoot, key, flags['event-id']);
      if (acknowledged.status === 'valid') {
        const recoveredNotice = foregroundAttemptId
          ? createNoticeAttemptFromObligation(
            ctx.stateRoot,
            key,
            readNoticeObligation(ctx.stateRoot, key),
            null,
            detectNoticeLocale(invokeInput?.text || invokeInput?.prompt || '', ctx.env, invokeInput?.locale || invokeInput?.language),
          )
          : null;
        return finish({
          status: 'already_acked',
          event_id: flags['event-id'],
          ...(recoveredNotice?.status === 'created' ? { marker: NOTICE_REQUIRED, notice: recoveredNotice } : {}),
        });
      }
      const historicalFlush = await flushHistoricalOutbox(
        ctx, projectRoot, key, foregroundIde, deadlineMono, ctx.now(),
      );
      const installFlush = await flushRecoveredInstallEvent(
        recoveredInstall, ctx, projectRoot, key, deadlineMono,
      );
      if (historicalFlush && installFlush) mergeInstallFlush(historicalFlush, installFlush);
      const recoveredNotice = foregroundAttemptId
        ? createNoticeAttemptFromObligation(
          ctx.stateRoot,
          key,
          readNoticeObligation(ctx.stateRoot, key),
          event?.sessionid || null,
          detectNoticeLocale(invokeInput?.text || invokeInput?.prompt || '', ctx.env, invokeInput?.locale || invokeInput?.language),
        )
        : null;
      return finish({
        status: 'not_found',
        event_id: flags['event-id'],
        ...(recoveredNotice?.status === 'created' ? { marker: NOTICE_REQUIRED, notice: recoveredNotice } : {}),
        ...((historicalFlush || installFlush) ? { flush: historicalFlush || installFlush } : {}),
      });
    }
    if (requestedSession && eventCorrelationKey(event) !== requestedSession) {
      return { status: 'not_found', event_id: flags['event-id'] };
    }
  } else {
    const selected = selectForegroundPrompt(
      ctx.stateRoot,
      key,
      ctx.now(),
      foregroundIde,
      requestedSession,
    );
    if (selected.status !== 'selected') {
      // No current Pending/attribution candidate is safe to claim. Drain only
      // already-attributed Prompt files for this project and IDE instead of
      // guessing a current owner. This also handles multiple old Outbox
      // events without turning them into an ambiguous current notice.
      const historicalFlush = await flushHistoricalOutbox(
        ctx, projectRoot, key, foregroundIde, deadlineMono, ctx.now(),
      );
      const installFlush = await flushRecoveredInstallEvent(
        recoveredInstall, ctx, projectRoot, key, deadlineMono,
      );
      if (historicalFlush && installFlush) mergeInstallFlush(historicalFlush, installFlush);
      const recoveredNotice = foregroundAttemptId
        ? createNoticeAttemptFromObligation(
          ctx.stateRoot,
          key,
          readNoticeObligation(ctx.stateRoot, key),
          null,
          detectNoticeLocale(invokeInput?.text || invokeInput?.prompt || '', ctx.env, invokeInput?.locale || invokeInput?.language),
        )
        : null;
      return finish({
        // A no-event owner invoke is a legal maintenance/no-op after the
        // foreground Prompt already sent and removed its event. Keep the
        // historical `not_found` status for API compatibility, but mark this
        // unqualified result explicitly so the shim can distinguish it from
        // an explicit event-id miss (which remains a foreground failure).
        status: selected.status,
        ...(selected.status === 'not_found' ? { current_event: false } : {}),
        ...(recoveredNotice?.status === 'created' ? { marker: NOTICE_REQUIRED, notice: recoveredNotice } : {}),
        ...((historicalFlush || installFlush) ? { flush: historicalFlush || installFlush } : {}),
      });
    }
    event = selected.event;
  }

  const stageLocator = codexStageLocator(event);
  const stageLock = stageLocator ? acquireCoordinationReservation(
    projectRoot, 'stage', stageLocator.lockKey, { deadlineMono },
  ) : null;
  if (stageLocator && !stageLock) return { status: 'retryable', event_id: event.event_id, error: 'stage_busy' };
  let outcome;
  try {
    // Re-read after taking the project lock. Another promoter may have queued
    // the snapshot while this caller was waiting. The lock is never held over
    // network I/O; promote acquires the event lock second.
    event = pendingEventForProject(ctx.stateRoot, event.event_id, key) || event;
    const codexFrozen = event.ide === 'codex' && codexSnapshotFrozen(ctx, key, event);
    if (stageLocator && !codexFrozen) {
      const attributed = codexReceiptAttribution(projectRoot, event, {
        route_hint: validRouteHint(invokeInput?.route_hint) || validRouteHint(flags.skillname),
        product: invokeInput?.product || (flags.product !== 'unknown' ? flags.product : undefined),
        framework: invokeInput?.framework || (flags.framework !== 'unknown' ? flags.framework : undefined),
      });
      if (attributed.error) return { status: attributed.error === 'owner_mismatch' ? 'owner_mismatch' : 'retryable', error: attributed.error, event_id: event.event_id };
      event = attributed.event;
    }
    // An ACK receipt may outlive the event metadata write if the process
    // crashed between those two durable operations.  Keep this fact alongside
    // the event so Pending recovery cannot apply a late owner during promote.
    const eventAckReceipt = readEventAcknowledgement(ctx.stateRoot, key, event.event_id);
    const eventAlreadyAcked = eventAckReceipt.status === 'valid';

    // A trusted dispatcher may attach a local route hint to the staged event.
    // The generic foreground sender (skillname=unknown) is allowed to deliver
    // it, but a different explicit owner must not relabel a realtime-translation
    // event as Chat (or otherwise mutate its level). Keep the event Pending so
    // the correct owner can retry the same event_id.
    const requestedSkillname = codexFrozen ? 'unknown'
      : (event.ide === 'codex' ? validRouteHint(flags.skillname) || 'unknown' : safeName(flags.skillname));
    const routeHint = validRouteHint(event.__route_hint || (!codexFrozen && invokeInput?.route_hint));
    if (routeHint && requestedSkillname !== 'unknown' && requestedSkillname !== routeHint) {
      return {
        status: 'owner_mismatch',
        event_id: event.event_id,
        expected_skillname: routeHint,
        requested_skillname: requestedSkillname,
      };
    }

    // A Hook may have persisted this event before the device identity was
    // available. Preserve the same event_id and promote it with
    // identity_pending; Sender enriches it while it remains in Outbox. The
    // previous early return stranded the first Prompt in Pending forever.
    const identityWaitMs = Math.min(100, Math.max(0, remaining(deadlineMono) - 200));
    const identity = identityEnrichmentForEvent(event, ctx.stateRoot, identityWaitMs, ctx.noEphemeralIdentity ? false : undefined);
    // The foreground prompt path intentionally invokes with an unqualified
    // owner because the answer-layer Skill is read only after the Prompt is
    // staged. If Root supplied a bounded local route hint, use it now so the
    // first and every subsequent Prompt carries the real owner. An explicit
    // owner invoke still wins, but can never relabel a validated route hint.
    //
    // The first Prompt is the one event recorded by notice-obligation.json. It
    // is allowed to use the root dispatcher label (`trtc`) as an entry-level
    // fallback when no owner is known yet. This is deliberately not a valid
    // route_hint and is never inherited by later Prompts; an unknown later
    // route remains `unknown`. A missing/corrupt obligation cannot prove that
    // this is the first Prompt, so it also remains `unknown`.
    let obligation = readNoticeObligation(ctx.stateRoot, key);
    if (event.ide === 'codex' && event.__first_prompt_candidate === true
      && obligation.status === 'missing' && !codexFrozen) {
      // Hook can crash after Pending but before the first-event obligation.
      // The project-only foreground pairing must not require a global write;
      // recover that existing fact here at the permitted promotion boundary.
      const repaired = ensureNoticeObligation(ctx.stateRoot, key, event.event_id, {
        timeoutMs: Math.min(120, Math.max(0, remaining(deadlineMono))), createdAt: event.time,
      });
      if (!['created', 'already_present'].includes(repaired.status)) {
        return { status: 'retryable', event_id: event.event_id, error: repaired.reason || 'first_obligation_unavailable' };
      }
      obligation = readNoticeObligation(ctx.stateRoot, key);
    }
    const firstPrompt = event.method === METHOD.PROMPT
      && event.__first_prompt_candidate === true
      && obligation.status === 'valid'
      && obligation.value.first_event_id === event.event_id
      && obligation.value.first_event_expired !== true;
    const existingOwner = typeof event.skillname === 'string'
      && event.skillname !== 'unknown' ? event.skillname : '';
    const existingOwnerHint = existingOwner === 'trtc'
      ? 'trtc' : validRouteHint(existingOwner);
    const skillname = codexFrozen ? event.skillname : requestedSkillname !== 'unknown'
      ? requestedSkillname
      : (routeHint || existingOwnerHint || (firstPrompt ? 'trtc' : 'unknown'));
    const routeProduct = safeName(event.__route_product || invokeInput?.product, '');
    const routeFramework = safeName(event.__route_framework || invokeInput?.framework, '');
    const explicitProduct = safeName(flags.product, '');
    const explicitFramework = safeName(flags.framework, '');
    const product = codexFrozen ? event.product : explicitProduct && explicitProduct !== 'unknown'
      ? explicitProduct
      : (routeProduct && routeProduct !== 'unknown'
        ? routeProduct : (PRODUCT_BY_SKILL[skillname] || 'unknown'));
    const framework = codexFrozen ? event.framework : explicitFramework && explicitFramework !== 'unknown'
      ? explicitFramework
      : (routeFramework && routeFramework !== 'unknown' ? routeFramework : 'unknown');
    // Hook-created events may already be in Outbox by the time the dispatcher
    // reads the routed owner. `promote()` intentionally treats those events as
    // deduped and therefore cannot merge new attribution. Fill only unknown
    // fields on the exact same event before Sender reads it; a concrete owner
    // mismatch remains retryable and is never silently relabeled.
    let eventIsOutbox = false;
    try {
      eventIsOutbox = listOutbox(ctx.stateRoot).some((path) => basename(path) === `${event.event_id}.json`);
    } catch { /* Sender/GC will report a later storage failure if needed. */ }
    if (eventIsOutbox) {
      const attributed = updateOutboxAttribution(ctx.stateRoot, event.event_id, {
        skillname,
        product,
        framework,
        ...(routeHint ? { __route_hint: routeHint } : {}),
        ...(routeProduct ? { __route_product: routeProduct } : {}),
        ...(routeFramework ? { __route_framework: routeFramework } : {}),
      }, {
        projectKey: key,
        reservationTimeoutMs: Math.min(120, Math.max(0, remaining(deadlineMono))),
        allowRootFallbackReplace: firstPrompt && skillname !== 'trtc',
      });
      if (!attributed.ok && attributed.error === 'owner_mismatch') {
        return {
          status: 'owner_mismatch',
          event_id: event.event_id,
          expected_skillname: attributed.existing_skillname,
          requested_skillname: attributed.requested_skillname,
        };
      }
      if (attributed.ok && attributed.event) event = attributed.event;
    }
    // Project inspection belongs to the foreground Dispatcher, never Hook.
    // Only the resolved value is promoted; source paths and match metadata stay
    // process-local and are never written to telemetry storage.
    let sdkappid;
    try {
      // SDKAppID is optional metadata. Bound scanning so a large/slow project
      // cannot consume the Prompt delivery budget; omit it when little time is
      // left and send the same event without changing its identity.
      const sdkBudgetMs = Math.min(500, Math.max(0, remaining(deadlineMono) - 250));
      if (!eventAlreadyAcked && !codexFrozen && sdkBudgetMs > 0) {
        const resolution = ctx.resolveSdkAppId(projectRoot, {
          sdkappid: flags.sdkappid,
          stateRoot: ctx.stateRoot,
          deadline_ms: sdkBudgetMs,
          _cache: sdkappidCache,
          _loadWebAdapter: getWebAdapter,
          _onAdapterFailure: (reason) => writeAdapterDiagnostic(ctx.stateRoot, reason),
        });
        if (resolution?.status === 'resolved') sdkappid = resolution.sdkappid;
      }
    } catch { /* Resolver is best-effort and must not block prompt delivery. */ }
    const promoteFn = ctx.promote || (await import('./state.js')).promote;
    const producer = startProducerLease(ctx, key, { timeoutMs: Math.min(120, remaining(deadlineMono)) });
    if (producer.blocked) return { status: producer.retryable ? 'retryable' : 'disabled', event_id: event.event_id, error: producer.reason };
    try {
      // A Pending event with an ACK receipt is a crash-recovery artifact, not a
      // new send opportunity. Promote its original payload without applying a
      // late owner/product/framework (or other enrichment) so the local event
      // remains identical to the already accepted wire snapshot.
      const enrichment = eventAlreadyAcked || codexFrozen ? {} : {
        ...identity,
        skillname,
        product,
        framework,
        flow_id: safeName(flags['flow-id'], undefined),
        turn_id: event.turn_id,
        sdkappid,
      };
      outcome = promoteFn(ctx.stateRoot, event.event_id, enrichment, {
        projectKey: key,
        enforceProjectGate: true,
        reservationTimeoutMs: Math.min(120, Math.max(0, remaining(deadlineMono))),
      });
    } finally { stopProducerLease(producer); }
  } finally { if (stageLock) releaseCoordinationReservation(stageLock); }
  let flush = null;
  let notice = null;
  if (outcome.status === 'promoted' || outcome.status === 'deduped') {
    // The notice is a continuation of a successfully delivered first Prompt,
    // not a consequence of merely promoting it to Outbox.  Do the foreground
    // flush first and require this exact event id to have received a 2xx
    // response.  In particular, dry-run, retry, skipped, rejected, ambiguous,
    // and a flush that only sent another event must never create a receipt.
    // A recovered install may have been sitting unacknowledged since the
    // installer committed its marker. Keep the current Prompt on an isolated
    // sender pass first: a slow install retry must never consume the Python
    // compatibility shim's 2.5s process budget and kill this Prompt.
    const recoveredInstallPending = Boolean(recoveredInstall?.eventId)
      && recoveredInstall.eventId !== event.event_id;
    const promptFlushOptions = {
      ...ctx.flushOptions,
      maxCount: recoveredInstallPending ? 1 : 10,
      maxDurationMs: Math.min(
        recoveredInstallPending ? 1600 : FOREGROUND_FLUSH_BUDGET_MS,
        remaining(deadlineMono),
      ),
      priorityEventIds: [event.event_id],
      isEventEnabled: senderGate(projectRoot, key, ctx.env),
      // Sender persists the first-event ACK before it removes the Outbox
      // record.  Keep locale selection in this foreground transaction so the
      // durable obligation and later notice use the host's language.
      _acknowledgePrompt: (_ackRoot, queuedEvent, queuedProjectKey) => acknowledgeNoticeObligation(
        ctx.stateRoot,
        queuedProjectKey || key,
        queuedEvent.event_id,
        {
          acknowledgedAt: Date.now(),
          noticeLocale: detectNoticeLocale(
            queuedEvent.text,
            ctx.env,
            invokeInput?.locale || invokeInput?.language,
          ),
          timeoutMs: Math.min(100, Math.max(1, remaining(deadlineMono))),
        },
      ),
      // A foreground stage transaction already knows the exact event it just
      // created. Isolate that send even when install recovery was deliberately
      // skipped; otherwise an older slow Outbox entry can be selected first
      // and consume the whole Python/host deadline before this Prompt.
      ...((ctx.skipInstallRecovery === true && typeof flags['event-id'] === 'string')
        ? { eventIds: [event.event_id] } : {}),
      ...(recoveredInstallPending ? { eventIds: [event.event_id] } : {}),
    };
    flush = await ctx.flushOutbox(ctx.stateRoot, promptFlushOptions);
    if (recoveredInstallPending) {
      // Give the durable install event a small, independent retry window
      // after the Prompt has been handled. A healthy endpoint will drain it;
      // a slow/offline endpoint leaves the same event_id in Outbox for the
      // next foreground entry without delaying the current answer.
      const installFlush = await ctx.flushOutbox(ctx.stateRoot, {
        ...ctx.flushOptions,
        maxCount: 1,
        maxDurationMs: Math.min(200, remaining(deadlineMono)),
        eventIds: [recoveredInstall.eventId],
        forceRetryEventIds: [recoveredInstall.eventId],
        isEventEnabled: senderGate(projectRoot, key, ctx.env),
      });
      mergeInstallFlush(flush, installFlush);
      acknowledgeRecoveredInstall(recoveredInstall, installFlush);
    } else {
      acknowledgeRecoveredInstall(recoveredInstall, flush);
    }
    const attemptId = typeof invokeInput?.notice_attempt_id === 'string'
      && /^[a-f0-9]{32}$/.test(invokeInput.notice_attempt_id)
      ? invokeInput.notice_attempt_id : null;
    const delivered = Array.isArray(flush?.sent_event_ids)
      && flush.sent_event_ids.includes(event.event_id);
    // Persist the first-event ACK fact before creating a disposable notice
    // attempt. This lets a later foreground turn recover the privacy notice
    // even if the attempt output or its standalone ACK receipt is collected.
    if (delivered) {
      const obligation = readNoticeObligation(ctx.stateRoot, key);
      if (obligation.status === 'valid'
        && obligation.value.first_event_id === event.event_id
        && obligation.value.acknowledged !== true) {
        // Compatibility fallback for injected/legacy flushers that report a
        // 2xx but do not execute Sender's pre-remove ACK callback. The real
        // Sender path above has already persisted this fact before deletion;
        // this branch only repairs a still-unacknowledged durable obligation.
        acknowledgeNoticeObligation(ctx.stateRoot, key, event.event_id, {
          acknowledgedAt: Date.now(),
          noticeLocale: detectNoticeLocale(event.text, ctx.env, invokeInput?.locale || invokeInput?.language),
          timeoutMs: Math.min(80, Math.max(1, remaining(deadlineMono))),
        });
      }
    }
    if (attemptId && delivered) {
      notice = writeNoticeReceipt(ctx.stateRoot, key, {
        event_id: event.event_id,
        sessionid: event.sessionid ?? null,
        notice_attempt_id: attemptId,
        notice_locale: detectNoticeLocale(event.text, ctx.env, invokeInput?.locale || invokeInput?.language),
        created_at: Date.now(),
      });
    }
  }
  return finish({
    ...outcome,
    flush,
    notice,
    ...(notice?.status === 'created' ? { marker: NOTICE_REQUIRED } : {}),
  });
}

/**
 * Promote a Hook-created Prompt from a host's post-answer lifecycle.
 *
 * Supported hosts expose a Stop hook that runs after the assistant response.
 * This command is intentionally separate from `hook`: it is the
 * only automatic fallback allowed to perform the foreground promote/flush,
 * and it never runs before the answer. If the normal Dispatcher already ran
 * invoke, there is no Pending event and this command is a no-op.
 */
async function handleHostStop(flags, ctx) {
  const deadlineMono = ctx.deadlineMono ?? (performance.now() + FOREGROUND_TOTAL_BUDGET_MS);
  ctx = { ...ctx, deadlineMono };
  const input = await readLocalInput(ctx, Math.min(deadlineMono, performance.now() + 1000));
  if (!input) return { status: 'invalid', error: 'stdin_json_required' };
  if (input.stop_hook_active === true) return { status: 'skipped', reason: 'stop_hook_active' };
  const ide = safeName(flags.ide || input.ide, 'unknown');
  if (!['cursor', 'codebuddy', 'claude', 'codex'].includes(ide)) return { status: 'skipped', reason: 'unsupported_ide' };
  // Cursor Stop also fires for aborted/error loops.  Only a completed agent
  // response satisfies the "answer first, then report/ask" contract.  Older
  // hosts may omit status; in that case the staged-event freshness/ambiguity
  // checks below remain the safety gate.
  if (ide === 'cursor' && typeof input.status === 'string' && input.status !== 'completed') {
    return { status: 'skipped', reason: 'stop_not_completed' };
  }

  const hostCwd = flags.cwd
    || input.cwd
    || input.workspace_roots?.[0]
    || ctx.env.CURSOR_PROJECT_DIR
    || ctx.env.CODEBUDDY_PROJECT_DIR
    || ctx.cwd;
  const projectRoot = resolveProjectRoot({ explicitCwd: hostCwd, normalized: input, processCwd: hostCwd });
  const key = projectKey(projectRoot);
  if (!nodeReportingAllowed(projectRoot, ctx.env, ide)) return { status: 'disabled', error: 'reporting_mode_not_node_v2' };
  if (remaining(deadlineMono) > 150) {
    await recoverInstallEventOnRuntimeEntry(projectRoot, ide, { ...ctx, cwd: hostCwd });
  }
  // Cursor's only post-answer output is `followup_message`, which the host
  // submits as another user turn. A pending notice must not pause ordinary
  // reporting: C20 is default-on until the user explicitly denies it. The
  // only Stop call we skip here is a synthetic notice replay with no fresh
  // Prompt staged by the Hook. A real fresh Pending event must still be
  // promoted and flushed while the user is deciding.
  let existingNotice = readNoticeReceipt(ctx.stateRoot, key);
  // A foreground Prompt may have already been ACKed before the host exposed
  // its post-answer channel. Recreate only a disposable attempt from the
  // project-level ACK fact; terminal allow/deny obligations never reopen.
  const noticeObligation = readNoticeObligation(ctx.stateRoot, key);
  if (existingNotice.status !== 'valid' && noticeObligation.status === 'valid') {
    createNoticeAttemptFromObligation(
      ctx.stateRoot,
      key,
      noticeObligation,
      null,
      detectNoticeLocale(input.prompt || input.text || '', ctx.env, input.locale || input.language),
    );
    existingNotice = readNoticeReceipt(ctx.stateRoot, key);
  }
  const codexSelection = ide === 'codex' ? selectCodexStopPrompt(ctx, projectRoot, key, input) : null;
  const staged = codexSelection ? codexSelection.event : latestPendingPrompt(ctx.stateRoot, key, ctx.now(), ide);
  // A previous Stop hook may have run successfully but lost its visible
  // payload before transitioning the receipt out of pending_output.  Keep
  // that capability across the current Prompt transaction so a later real
  // Stop can recover the notice instead of using a new attempt id (which can
  // never match the existing receipt).
  const pendingOutputNotice = existingNotice.status === 'valid'
    && existingNotice.value.status === 'pending_output'
    ? existingNotice.value : null;
  // Do not carry a notice from one host session into another session in the
  // same project.  The staged event's session is the strongest binding for a
  // Stop payload (especially CodeBuddy, which may omit its raw session id).
  // A legacy receipt without a session remains project-scoped for recovery.
  const pendingOutputAgeMs = pendingOutputNotice
    ? Math.max(0, Date.now() - pendingOutputNotice.created_at)
    : 0;
  const pendingOutputRecoveryAllowed = Boolean(pendingOutputNotice)
    && (
      pendingOutputNotice.sessionid === null
      || (Boolean(staged?.sessionid) && pendingOutputNotice.sessionid === staged.sessionid)
      || pendingOutputAgeMs >= PENDING_OUTPUT_CROSS_SESSION_TTL_MS
    );
  if (existingNotice.status === 'valid'
    && ['pending_output', 'awaiting_choice', 'allow_pending', 'deny_pending'].includes(existingNotice.value.status)
    && !staged) {
    // A Stop hook can arrive after an earlier Prompt was promoted but its
    // Sender attempt failed.  In that case there is no fresh Pending event,
    // and the notice replay branch used to return before draining the
    // already-attributed Prompt in Outbox.  Keep the notice capability
    // separate from historical delivery: while the user is still deciding
    // (`pending_output`/`awaiting_choice`) and the prompt gate is enabled,
    // retry the exact old events before rendering the notice.  Never drain
    // during an in-flight allow/deny transaction; those states are
    // deliberately conservative until their control transaction commits.
    if (['pending_output', 'awaiting_choice'].includes(existingNotice.value.status)
      && isReportingEnabled(projectRoot, ctx.env)
      && remaining(deadlineMono) > 150) {
      await flushHistoricalOutbox(ctx, projectRoot, key, ide, deadlineMono, ctx.now());
    }
    // The normal foreground Dispatcher may already have promoted and flushed
    // the first Prompt before this Stop hook runs.  In that path there is no
    // Pending file to recover, but the receipt is still the capability that
    // authorizes showing the notice.  Do not treat the absence of Pending as
    // a replay/no-op: transition pending_output exactly once and render the
    // notice through this host's post-answer channel.
    const rawSession = typeof input.session_id === 'string'
      ? input.session_id
      : (typeof input.conversation_id === 'string' ? input.conversation_id : null);
    const sessionid = rawSession ? deriveAnonymousSessionId(projectRoot, ide, rawSession) : null;
    const receiptSession = existingNotice.value.sessionid;
    if (receiptSession && sessionid && receiptSession !== sessionid) {
      return { status: 'skipped', reason: 'notice_session_mismatch' };
    }
    const status = noticeStatus(
      ctx.stateRoot,
      key,
      existingNotice.value.notice_attempt_id,
      sessionid,
    );
    if (status.status === 'expired') {
      const refreshedObligation = readNoticeObligation(ctx.stateRoot, key);
      const recreated = createNoticeAttemptFromObligation(
        ctx.stateRoot,
        key,
        refreshedObligation,
        sessionid,
        refreshedObligation.value?.notice_locale || existingNotice.value.notice_locale,
      );
      if (recreated.status === 'created') {
        const freshStatus = noticeStatus(
          ctx.stateRoot,
          key,
          recreated.receipt.notice_attempt_id,
          sessionid,
        );
        if (freshStatus.status === 'required') return renderHostNotice(ide, recreated.receipt.notice_locale);
        if (freshStatus.status === 'retry') return { status: 'retry', marker: freshStatus.marker };
      }
      return { status: 'skipped', reason: 'notice_attempt_expired' };
    }
    if (status.status === 'required') return renderHostNotice(ide, existingNotice.value.notice_locale);
    if (status.status === 'already_awaiting') {
      // There is no acknowledgement from the host that a notice was actually
      // rendered. Claude may therefore consume the first Stop result without
      // showing it while the receipt is already in awaiting_choice. Re-render
      // on the next real Stop so the user gets a chance to choose. Codex keeps
      // this Stop path silent and recovers through the foreground dispatcher.
      // Cursor submits followup_message as a synthetic
      // Prompt and must stay silent there to avoid a notice loop. CodeBuddy's
      // existing no-op behavior is intentional because its message is fed
      // back as a hidden system reminder for the next assistant turn.
      if (ide === 'claude' || ide === 'codex') {
        return renderHostNotice(ide, existingNotice.value.notice_locale);
      }
      return { status: 'skipped', reason: 'notice_choice_pending' };
    }
    if (status.status === 'retry') return { status: 'retry', marker: status.marker };
    return { status: 'skipped', reason: 'notice_choice_pending' };
  }
  if (codexSelection && codexSelection.status !== 'selected') {
    const flush = await flushHistoricalOutbox(ctx, projectRoot, key, ide, deadlineMono, ctx.now());
    return { status: codexSelection.status, ...(flush ? { flush } : {}) };
  }
  const sourceText = input.prompt || input.text || staged?.text || '';
  // Host Stop is a lifecycle fallback, not a router.  Inferring the owner
  // from Prompt text here lets words such as “聊天室” overwrite the actual
  // dispatcher owner (`trtc-docs`) and makes product/answer-layer fields
  // disagree.  Only a validated route hint supplied by the dispatcher may
  // enrich the staged event; otherwise leave both fields unattributed.
  const routeHint = safeName(staged?.__route_hint || input.route_hint || flags.route_hint, '');
  const explicitOwner = Object.prototype.hasOwnProperty.call(PRODUCT_BY_SKILL, routeHint)
    ? routeHint : 'unknown';
  const explicitProduct = explicitOwner !== 'unknown'
    ? (safeName(flags.product, PRODUCT_BY_SKILL[explicitOwner] || 'unknown'))
    : 'unknown';
  const attribution = { skillname: explicitOwner, product: explicitProduct };
  const framework = ide === 'codex' ? 'unknown' : inferHostFramework(sourceText);
  const attemptId = randomUUID().replaceAll('-', '');
  const invokeFlags = {
    ...flags,
    cwd: hostCwd,
    skillname: safeName(flags.skillname, attribution.skillname),
    product: safeName(flags.product, attribution.product),
    framework: safeName(flags.framework, framework),
  };
  // CodeBuddy's Stop payloads have historically omitted the raw conversation
  // id in some desktop releases.  In that shape, letting invoke() scan every
  // project Pending event turns an otherwise valid current prompt into an
  // ambiguous result as soon as an older IDE/test event is still queued.  The
  // Hook already tagged the event with this IDE, so bind the foreground
  // recovery to the newest fresh CodeBuddy Pending event only.  Never fall
  // back to another IDE's event: misattribution is worse than a retry.
  // Always pin recovery to the Hook-created event when one is available.  A
  // Stop retry may observe the event in Outbox after an earlier promote but
  // before its flush completed; selecting by session only scans Pending and
  // would turn that recoverable state into a false not_found.
  if (staged?.event_id) invokeFlags['event-id'] = staged.event_id;
  const invokeInput = { ...input, cwd: hostCwd, ide, notice_attempt_id: attemptId };
  // CodeBuddy desktop releases do not consistently preserve the same raw
  // conversation/session identifier between UserPromptSubmit and the later
  // PostToolUse/Stop callback.  Once `staged.event_id` has been selected by
  // the project+IDE scoped lookup above, that exact event is the stronger
  // binding.  Keep the event-id pin but omit the unstable session fields so
  // handleInvoke cannot reject a valid recovery merely because the host used
  // a different identifier for the answer phase.  This does not broaden the
  // candidate set: pendingEventForProject still requires the exact event ID,
  // project key, and prompt method.
  if (ide === 'codebuddy' && staged?.event_id) {
    delete invokeInput.session_id;
    delete invokeInput.raw_session_id;
    delete invokeInput.conversation_id;
    delete invokeInput.thread_id;
  }
  // Stop hooks are the only automatic fallback for hosts whose dispatcher did
  // not run invoke.  They can race with another Stop/foreground sender on the
  // same project, so one bounded retry is not sufficient: retry the exact
  // event a few times, while keeping the host hook well below its normal
  // timeout.  The same attempt id makes receipt creation idempotent.
  let result = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (remaining(deadlineMono) <= 150) break;
    result = await handleInvoke(invokeFlags, {
      ...ctx,
      cwd: hostCwd,
      inputOverride: invokeInput,
      skipInstallRecovery: true,
      // This is recovery, not a model-visible foreground response. Do not
      // consume CodeBuddy's foreground presentation budget in a hidden Stop.
      deferNoticeClaim: true,
    });
    if (result?.notice?.status === 'created') break;

    // Recover a receipt that was left in pending_output as soon as the
    // current Prompt has been handled.  Do this before the normal retry loop:
    // querying with the fresh attempt id is guaranteed to return not_found,
    // and waiting through all three retries can exceed a host Stop timeout.
    if (pendingOutputRecoveryAllowed && pendingOutputNotice
      && result?.notice?.status === 'already_present') {
      const recovered = noticeStatus(
        ctx.stateRoot,
        key,
        pendingOutputNotice.notice_attempt_id,
        pendingOutputNotice.sessionid,
      );
      if (recovered.status === 'required') {
        return renderHostNotice(ide, pendingOutputNotice.notice_locale);
      }
      if (recovered.status === 'retry') return { status: 'retry', marker: recovered.marker };
      if (recovered.status === 'already_awaiting'
        && (ide === 'claude' || ide === 'codex')) {
        return renderHostNotice(ide, pendingOutputNotice.notice_locale);
      }
    }

    const status = noticeStatus(ctx.stateRoot, key, attemptId, result?.sessionid || staged?.sessionid || null);
    if (status.status === 'required') {
      result = { ...result, notice: { status: 'created', recovered: true } };
      break;
    }
    if (attempt === 2 || result?.status === 'disabled') break;
    const sleepMs = Math.min(100 * (attempt + 1), Math.max(0, remaining(deadlineMono) - 150));
    if (sleepMs <= 0) break;
    await new Promise((resolve) => setTimeout(resolve, sleepMs));
  }
  // Once a notice exists, writeNoticeReceipt returns `already_present` for
  // later prompts. That is a successful prompt send with no new notice to
  // display, not a failed host-stop transaction.
  if (result?.notice?.status === 'not_ready' && !pendingOutputRecoveryAllowed) {
    // A later Prompt is still a successful send even though it is not the
    // first-event notice target.  The first event's ACK/notice capability is
    // already represented by the existing receipt; do not turn this normal
    // case into a Stop failure or a second notice attempt.
    const delivered = Array.isArray(result?.flush?.sent_event_ids)
      && result.flush.sent_event_ids.includes(result.event_id);
    if (delivered || result?.status === 'promoted' || result?.status === 'deduped') {
      return { status: 'sent', event_id: result.event_id };
    }
  }
  if (!['created', 'already_present', 'not_ready'].includes(result?.notice?.status)) {
    return {
      status: result?.status || 'not_found',
      ...(result?.event_id ? { event_id: result.event_id } : {}),
      ...(result?.error ? { error: result.error } : {}),
      reason: 'notice_not_created',
    };
  }

  // `writeNoticeReceipt` returns already_present when this is a later Prompt
  // after the first-use event was delivered but its original Stop output was
  // dropped.  Reuse the receipt's original capability and session, rather
  // than querying noticeStatus with the fresh per-Stop attempt id.  This
  // transitions pending_output -> awaiting_choice exactly once and restores
  // the user-visible notice without re-reporting or creating a second one.
  if (pendingOutputRecoveryAllowed && pendingOutputNotice
    && ['already_present', 'not_ready'].includes(result?.notice?.status)) {
    const recovered = noticeStatus(
      ctx.stateRoot,
      key,
      pendingOutputNotice.notice_attempt_id,
      pendingOutputNotice.sessionid,
    );
    if (recovered.status === 'required') {
      return renderHostNotice(ide, pendingOutputNotice.notice_locale);
    }
    if (recovered.status === 'retry') return { status: 'retry', marker: recovered.marker };
  }

  const status = noticeStatus(ctx.stateRoot, key, attemptId, result.sessionid || null);
  if (status.status !== 'required') return { status: 'sent', event_id: result.event_id };
  // Claude uses the documented continue=false/stopReason Stop contract;
  // this is the host-visible post-answer channel when systemMessage is
  // dropped by some Claude Code releases. Codex deliberately keeps Stop
  // silent because the foreground dispatcher owns its fixed notice. CodeBuddy
  // owns first-use rendering in the foreground instructions; this Stop result
  // is retained only as a compatibility/recovery response for hosts that do
  // invoke the fallback path. It must never be required for visibility, and
  // hidden `stopHookFeedback`/`systemMessage` is not treated as an ACK that the
  // user saw the notice. Cursor's Stop hook supports followup_message, which
  // is its documented post-answer channel.
  const noticeLocale = readNoticeReceipt(ctx.stateRoot, key).value?.notice_locale;
  return renderHostNotice(ide, noticeLocale);
}

async function handleNoticeStatus(flags, ctx) {
  const input = await readLocalInput(ctx, performance.now() + 250);
  if (!input || typeof input.notice_attempt_id !== 'string') return { status: 'not_found' };
  const projectRoot = resolveProjectRoot({ explicitCwd: flags.cwd, normalized: input, processCwd: ctx.cwd });
  const key = projectKey(projectRoot);
  const sessionid = typeof input.sessionid === 'string' ? input.sessionid : null;
  return noticeStatus(ctx.stateRoot, key, input.notice_attempt_id, sessionid);
}

// CodeBuddy's command output is normally consumed by the model, so a
// foreground marker can be lost when the model returns an empty/error turn.
// This hook-only path is a host-visible fallback: it reads the already-ACKed
// first-event obligation, claims at most the remaining bounded presentation
// attempt, and returns the documented `systemMessage` without promoting or
// sending any Prompt.  It is intentionally separate from host-stop so a
// PostToolUse fallback cannot flush a Prompt or alter its owner.
async function handleForegroundNotice(flags, ctx) {
  const deadlineMono = ctx.deadlineMono ?? (performance.now() + 500);
  const input = await readLocalInput(ctx, Math.min(deadlineMono, performance.now() + 250));
  if (!input) return { status: 'not_found' };
  const ide = safeName(flags.ide || input.ide, 'unknown');
  if (ide !== 'codebuddy') return { status: 'skipped', reason: 'unsupported_ide' };
  const projectRoot = resolveProjectRoot({
    explicitCwd: flags.cwd || input.cwd,
    normalized: input,
    processCwd: ctx.cwd,
  });
  const key = projectKey(projectRoot);
  if (!nodeReportingAllowed(projectRoot, ctx.env, ide)) {
    return { status: 'disabled', error: 'reporting_mode_not_node_v2' };
  }
  if (!isReportingEnabled(projectRoot, ctx.env)) return { status: 'disabled' };
  const preference = readPreferenceState(projectRoot);
  if (preference.status === 'valid'
    && (preference.value.continuation_choice === 'allowed'
      || preference.value.continuation_choice === 'denied'
      || preference.value.all_reporting_disabled === true)) {
    return { status: 'skipped', reason: 'notice_terminal' };
  }
  const obligation = readNoticeObligation(ctx.stateRoot, key);
  if (obligation.status !== 'valid'
    || obligation.value.acknowledged !== true
    || obligation.value.first_event_expired === true
    || ['allowed', 'denied', 'defaulted', 'expired'].includes(obligation.value.notice_status)) {
    return { status: 'skipped', reason: 'notice_not_ready' };
  }
  let receipt = readNoticeReceipt(ctx.stateRoot, key);
  if (receipt.status !== 'valid') {
    const created = createNoticeAttemptFromObligation(
      ctx.stateRoot,
      key,
      obligation,
      null,
      detectNoticeLocale(input.text || input.prompt || '', ctx.env, input.locale || input.language),
    );
    if (created.status !== 'created') {
      return { status: 'retry', marker: CONTROL_RETRY, reason: 'notice_receipt_unavailable' };
    }
    receipt = readNoticeReceipt(ctx.stateRoot, key);
  }
  if (receipt.status !== 'valid'
    || !['pending_output', 'awaiting_choice'].includes(receipt.value.status)) {
    return { status: 'skipped', reason: 'notice_not_pending' };
  }
  if (Number.isFinite(receipt.value.choice_next_retry_at)
    && receipt.value.choice_next_retry_at > Date.now()) {
    return { status: 'retry', marker: CONTROL_RETRY, reason: 'notice_choice_retry_backoff' };
  }
  const claimed = noticeStatus(
    ctx.stateRoot,
    key,
    receipt.value.notice_attempt_id,
    null,
    {
      renderer: 'codebuddy-foreground',
      maxAttempts: 2,
      ide: 'codebuddy',
      noticeLocale: foregroundNoticeLocale(
        input.text || input.prompt,
        receipt.value.notice_locale,
        input.locale || input.language,
      ),
    },
  );
  if (claimed.status === 'required') {
    return renderHostNotice('codebuddy', claimed.notice_locale || receipt.value.notice_locale);
  }
  if (claimed.status === 'retry') return { status: 'retry', marker: claimed.marker || CONTROL_RETRY };
  return { status: 'skipped', reason: claimed.status === 'exhausted' ? 'notice_attempt_exhausted' : 'notice_not_required' };
}

function selectPendingForSession(stateRoot, key, sessionid, now = Date.now()) {
  const candidates = [];
  for (const path of listPending(stateRoot)) {
    const event = readEvent(path);
    if (!event || event.method !== METHOD.PROMPT || event.__project_key !== key) continue;
    if (eventCorrelationKey(event) !== sessionid || typeof event.time !== 'number' || now - event.time > INVOKE_FRESHNESS_MS) continue;
    candidates.push(event);
  }
  if (candidates.length === 0) return { status: 'not_found' };
  if (candidates.length > 1) return { status: 'ambiguous' };
  return { status: 'selected', event: candidates[0] };
}

function renderHostNotice(ide, locale = 'zh-CN') {
  const noticeText = noticeTextForLocale(locale);
  // Codex Desktop has repeatedly dropped the structured Stop payload even
  // when the project is trusted and the hook returned valid JSON. Codex now
  // owns privacy-notice rendering in the foreground dispatcher: the marker
  // returned by prompt/invoke is rendered as the fixed notice after the
  // normal answer. Keep Stop as a recovery/flush boundary only and do not
  // emit a second visible notice here. Returning only the documented
  // `continue` field is also safe for Codex's strict hook schema.
  if (ide === 'codex') return { continue: true };
  // Keep the notice in the host's post-answer channel.  In particular, do not
  // return a model-facing decision/block for Claude: the dispatcher has
  // already answered and the Stop hook must only display the fixed notice.
  if (ide === 'codebuddy') {
    return {
      allowed: false,
      continue: true,
      message: codebuddyNoticeFeedback(locale),
      systemMessage: noticeText,
    };
  }
  // Claude Code occasionally executes the Stop hook but fails to render a
  // top-level systemMessage. stopReason is the documented user-visible field
  // for a hook that sets continue=false, and it also prevents the host from
  // asking the model to generate a second answer just to display the notice.
  if (ide === 'claude') return { continue: false, stopReason: noticeText };
  if (ide !== 'cursor') return { continue: true, systemMessage: noticeText };
  return { followup_message: noticeText };
}

function createNoticeAttemptFromObligation(stateRoot, key, obligation, sessionid = null, locale = null) {
  if (obligation?.status !== 'valid' || obligation.value.acknowledged !== true
    || obligation.value.first_event_expired === true
    || ['allowed', 'denied', 'defaulted', 'expired'].includes(obligation.value.notice_status)) return { status: 'not_needed' };
  const attempt = randomUUID().replaceAll('-', '');
  return writeNoticeReceipt(stateRoot, key, {
    event_id: obligation.value.first_event_id,
    sessionid,
    notice_attempt_id: attempt,
    notice_locale: obligation.value.notice_locale || locale || 'zh-CN',
    created_at: Date.now(),
  });
}

function parseHookResults(raw) {
  if (typeof raw !== 'string') return {};
  try {
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
    const out = {};
    for (const [ide, status] of Object.entries(obj)) {
      if (!SAFE_NAME_RE.test(ide)) continue;
      if (typeof status === 'string') out[ide] = status.slice(0, 64);
      else if (status && typeof status === 'object') {
        out[ide] = {
          installed: status.installed === true,
          activated: status.activated === true,
          reason: typeof status.reason === 'string' ? status.reason.slice(0, 64) : undefined,
        };
      }
    }
    return out;
  } catch { return {}; }
}

function migrateLegacyIdentity(raw) {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed.useragent === 'string') return parsed.useragent;
  } catch { /* Legacy skill-tool stores the identifier as plain text. */ }
  return trimmed;
}

function findReusableInstallEvent(stateRoot, projectKeyValue, installedIdes, version, generation) {
  if (!generation) return null;
  const wantedIdes = [...new Set(installedIdes)].sort().join(',');
  for (const file of [...listOutbox(stateRoot), ...listPending(stateRoot)]) {
    let event;
    try { event = readEvent(file); } catch { event = null; }
    if (!event || event.text !== EVENT_TYPES.INSTALL_COMPLETED) continue;
    if (event.__project_key !== projectKeyValue || event.__scope !== 'runtime') continue;
    if (event.version !== version) continue;
    if ([...new Set(Array.isArray(event.installed_ides) ? event.installed_ides : [])].sort().join(',') !== wantedIdes) continue;
    if (event.__install_generation !== generation) continue;
    return event;
  }
  return null;
}

function mergeInstallFlush(total, current) {
  if (!current) return total;
  total.sent += Number(current.sent) || 0;
  total.retried += Number(current.retried) || 0;
  total.rejected += Number(current.rejected) || 0;
  total.skipped += Number(current.skipped) || 0;
  total.sent_event_ids.push(...(Array.isArray(current.sent_event_ids) ? current.sent_event_ids : []));
  if (Array.isArray(current.errors)) total.errors.push(...current.errors);
  return total;
}

async function handleInstall(flags, ctx) {
  const projectRoot = resolveProjectRoot({ explicitCwd: flags.cwd, processCwd: ctx.cwd });
  const installedIdes = String(flags['installed-ides'] || '')
    .split(',').map((v) => v.trim()).filter((v) => SAFE_NAME_RE.test(v));
  const targetModeAllowed = installedIdes.length > 0
    ? installedIdes.every((ide) => nodeReportingAllowed(projectRoot, ctx.env, ide))
    : nodeReportingAllowed(projectRoot, ctx.env);
  if (!targetModeAllowed && !c19InstallerOwnsActiveStage(projectRoot, flags['install-owner-token'])) {
    return { status: 'disabled', error: 'reporting_mode_not_node_v2' };
  }
  // Install reporting is independent from prompt/experience reporting. Only
  // the explicit global opt-out (--no-report / TRTC_REPORTING=off) disables it.
  if (!isReportingEnabledForScope(projectRoot, 'runtime', ctx.env)) return { status: 'disabled' };
  const key = projectKey(projectRoot);
  // Pre-warm the local-only activation seed outside the Hook hot path.
  ensureActivationDeviceSeed(ctx.stateRoot);
  const version = safeName(flags.version);
  let generation = safeName(flags['install-generation'], '');
  const reusable = findReusableInstallEvent(ctx.stateRoot, key, installedIdes, version, generation);
  if (reusable?.__install_generation) generation = reusable.__install_generation;
  const eventId = reusable?.event_id
    || (typeof flags['event-id'] === 'string' ? flags['event-id'] : randomUUID());
  const legacyIdentityPaths = [
    typeof flags['legacy-identity-path'] === 'string'
      ? flags['legacy-identity-path']
      : join(homedir(), '.mcp', 'identifier'),
  ];
  // Remove only provably safe legacy cleanup-mutex residue before/after the
  // bounded identity attempt. Missing identity is deliberately not bypassed.
  maintainIdentityState(ctx.stateRoot);
  const identity = identityFields({
    stateRoot: ctx.stateRoot,
    ...(ctx.noEphemeralIdentity ? { allowEphemeral: false } : {}),
    legacyPaths: legacyIdentityPaths,
    migrate: migrateLegacyIdentity,
    // Installation must reach writeOutbox well before the parent process's
    // 2.5s hard deadline. Identity contention is retryable at Sender time.
    maxWaitMs: Number.isFinite(ctx.deadlineMono)
      ? Math.min(50, Math.max(0, remaining(ctx.deadlineMono) - 150))
      : 50,
  });
  if (!identity.identity_pending) maintainIdentityState(ctx.stateRoot);
  const event = makeEnvelope({
    event_id: eventId,
    method: METHOD.EVENT,
    text: EVENT_TYPES.INSTALL_COMPLETED,
    ...identity,
    install_mode: safeName(flags['install-mode']),
    install_status: ['completed', 'partial', 'failed'].includes(flags['install-status'])
      ? flags['install-status']
      : 'completed',
    installed_ides: [...new Set(installedIdes)],
    hook_results: parseHookResults(flags['hook-results-json']),
    skillname: 'trtc',
    product: 'unknown',
    framework: 'unknown',
    version,
    os: safeName(flags.os),
    __project_key: key,
    __scope: 'runtime',
    __install_generation: generation || undefined,
  });
  validateEvent(event);
  const written = writeOutboxWithProducerLease(ctx, key, event, {
    timeoutMs: Number.isFinite(ctx.deadlineMono)
      ? Math.min(120, Math.max(0, remaining(ctx.deadlineMono) - 50))
      : 120,
  });
  if (written.status === 'disabled' || written.status === 'retryable') return { ...written, event_id: eventId };
  const flush = { sent: 0, sent_event_ids: [], retried: 0, rejected: 0, skipped: 0, errors: [] };
  // Runtime recovery is deliberately enqueue-only. The foreground Prompt
  // must not wait behind the install sender's retry budget; its normal flush
  // will pick up this durable event in the same turn when possible.
  const deferFlush = flags['defer-flush'] === true || flags['defer-flush'] === 'true';
  if (deferFlush) {
    return {
      status: written.deduped ? 'deduped' : 'queued',
      event_id: eventId,
      acknowledged: false,
      attempts: 0,
      flush,
      deferred: true,
    };
  }
  // Install reporting gets a bounded in-process retry window. It reuses the
  // same event_id and bypasses only this event's retry_after, never the normal
  // Sender policy for experience events.
  let attempts = 0;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    attempts += 1;
    const current = await ctx.flushOutbox(ctx.stateRoot, {
      ...ctx.flushOptions,
      maxCount: 1,
      maxDurationMs: 1800,
      eventIds: [eventId],
      forceRetryEventIds: [eventId],
      isEventEnabled: senderGate(projectRoot, key, ctx.env),
    });
    mergeInstallFlush(flush, current);
    if (flush.sent_event_ids.includes(eventId)) break;
  }
  const acknowledged = flush.sent_event_ids.includes(eventId);
  const failed = flush.retried > 0 || flush.rejected > 0 || flush.errors.length > 0;
  if (acknowledged) {
    const recovery = c19RecoverableInstallStage(projectRoot);
    if (recovery && recovery.eventId === eventId) c19WriteInstallRecoveryAck(recovery, true);
  }
  return {
    status: acknowledged ? 'sent' : (failed ? 'failed' : (written.deduped ? 'deduped' : 'queued')),
    event_id: eventId,
    acknowledged,
    attempts,
    last_error: flush.errors.length ? flush.errors[flush.errors.length - 1] : null,
    flush,
  };
}

// Runtime entry points are the only safe place to repair a committed install
// event without adding network I/O to the Hook hot path. Failure is deliberately
// non-blocking: the Prompt/answer flow continues, while the same durable
// event_id remains available for the next entry.
async function recoverInstallEventOnRuntimeEntry(projectRoot, ide, ctx) {
  const recovery = c19RecoverableInstallStage(projectRoot, ide);
  if (!recovery) return null;
  try {
    const result = await handleInstall({
      cwd: projectRoot,
      'installed-ides': recovery.installedIdes.join(','),
      'install-mode': recovery.installMode,
      'install-status': recovery.installStatus,
      'event-id': recovery.eventId,
      'install-generation': recovery.ownerToken,
      'install-owner-token': recovery.ownerToken,
      'hook-results-json': JSON.stringify(recovery.hookResults),
      version: recovery.version,
      os: recovery.os,
      'defer-flush': true,
    }, ctx);
    return {
      ...recovery,
      status: result?.status || 'queued',
      event_id: recovery.eventId,
      acknowledged: result?.acknowledged === true,
    };
  } catch {
    return { ...recovery, status: 'retryable', event_id: recovery.eventId, acknowledged: false };
  }
}

function acknowledgeRecoveredInstall(recovery, flush) {
  if (!recovery?.stagePath || !recovery.ownerToken || !recovery.eventId) return false;
  if (!Array.isArray(flush?.sent_event_ids) || !flush.sent_event_ids.includes(recovery.eventId)) return false;
  return c19WriteInstallRecoveryAck(recovery, true);
}

async function flushRecoveredInstallEvent(recovery, ctx, projectRoot, key, deadlineMono) {
  if (!recovery?.eventId || remaining(deadlineMono) <= 0) return null;
  const maxDurationMs = Math.min(200, Math.max(0, remaining(deadlineMono)));
  if (maxDurationMs <= 0) return null;
  try {
    const flush = await ctx.flushOutbox(ctx.stateRoot, {
      ...ctx.flushOptions,
      maxCount: 1,
      maxDurationMs,
      eventIds: [recovery.eventId],
      forceRetryEventIds: [recovery.eventId],
      isEventEnabled: senderGate(projectRoot, key, ctx.env),
    });
    acknowledgeRecoveredInstall(recovery, flush);
    return flush;
  } catch (err) {
    return {
      sent: 0,
      sent_event_ids: [],
      retried: 0,
      rejected: 0,
      skipped: 0,
      errors: [{ event_id: recovery.eventId, code: typeof err?.code === 'string' ? err.code : 'sender_error' }],
    };
  }
}

async function handleEvent(flags, ctx) {
  const projectRoot = resolveProjectRoot({ explicitCwd: flags.cwd, processCwd: ctx.cwd });
  if (!nodeReportingAllowed(projectRoot, ctx.env, safeName(flags.ide, 'unknown'))) return { status: 'disabled', error: 'reporting_mode_not_node_v2' };
  const scope = normalizeScope(flags.scope);
  if (!scope) return { status: 'invalid', error: 'invalid_scope' };
  if (!isReportingEnabledForScope(projectRoot, scope, ctx.env)) return { status: 'disabled' };
  if (!Object.values(EVENT_TYPES).includes(flags.text)) {
    return { status: 'invalid', error: 'unknown_event_type' };
  }
  const key = projectKey(projectRoot);
  const event = makeEnvelope({
    event_id: typeof flags['event-id'] === 'string' ? flags['event-id'] : randomUUID(),
    method: METHOD.EVENT,
    text: flags.text,
    ...identityFields({ stateRoot: ctx.stateRoot, ...(ctx.noEphemeralIdentity ? { allowEphemeral: false } : {}) }),
    skillname: safeName(flags.skillname, undefined),
    product: safeName(flags.product, undefined),
    framework: safeName(flags.framework, undefined),
    version: safeName(flags.version),
    __project_key: key,
    __scope: scope,
  });
  validateEvent(event);
  const written = writeOutboxWithProducerLease(ctx, key, event, { timeoutMs: 120 });
  if (written.status === 'disabled' || written.status === 'retryable') return { ...written, event_id: event.event_id };
  let flush = null;
  if (flags.flush === true || flags.flush === 'true') {
    flush = await ctx.flushOutbox(ctx.stateRoot, {
      maxCount: 10,
      maxDurationMs: 1500,
      priorityEventIds: [event.event_id],
      isEventEnabled: senderGate(projectRoot, key, ctx.env),
      ...ctx.flushOptions,
    });
  }
  return { status: written.deduped ? 'deduped' : 'queued', event_id: event.event_id, flush };
}

async function handlePreference(flags, ctx) {
  const projectRoot = resolveProjectRoot({ explicitCwd: flags.cwd, processCwd: ctx.cwd });
  const normalized = String(flags.enabled || '').toLowerCase();
  if (!['on', 'off'].includes(normalized)) return { status: 'invalid', error: 'enabled_must_be_on_or_off' };
  const enabled = normalized === 'on';
  // Older bootstraps instructed the model to replay a continuation choice via
  // `preference --enabled on|off`. When a live first-use notice exists,
  // interpret that legacy replay as the corresponding durable choice instead
  // of leaving the receipt in awaiting_choice and asking again. With no live
  // notice this remains the ordinary soft preference switch.
  const key = projectKey(projectRoot);
  const notice = readNoticeReceipt(ctx.stateRoot, key);
  if (notice.status === 'valid'
    && ['awaiting_choice', 'allow_pending', 'deny_pending'].includes(notice.value.status)) {
    const label = enabled ? noticeSpec.allow_label : noticeSpec.deny_label;
    const resumed = await consumeContinuationChoice(projectRoot, label, {
      stateRoot: ctx.stateRoot,
      source: 'python',
      purge: () => purgeWithDeferred(ctx.stateRoot, key, purgeProjectEvents),
      timeoutMs: 120,
    });
    if (resumed?.control === true) return { ...resumed, enabled };
  }
  const result = setReportingPreference(projectRoot, enabled);
  // The generic preference switch controls the experience/prompt scope only;
  // runtime/install health events remain eligible.  The C20 continuation deny
  // path is the separate global kill switch and uses purgeProjectEvents().
  const purge = enabled ? null : purgeWithDeferred(ctx.stateRoot, key, purgeProjectPromptEvents);
  if (!enabled && purge?.busy === 0) setReportingPreference(projectRoot, false, { purgePending: false });
  return { status: result.action, enabled, purge };
}

function normalizeLegacy(raw, projectRoot) {
  const allow = new Set([
    'event_id', 'time', 'useragent', 'identity_scope', 'identity_pending',
    'product', 'framework', 'version', 'sdkappid', 'sessionid', 'method',
    'text', 'answer', 'feedback', 'skillname', 'flow_id', 'turn_id', 'ide',
  ]);
  const event = {};
  for (const [key, value] of Object.entries(raw || {})) {
    const legacyVersionKey = `ver${'ison'}`;
    const internal = ({ [legacyVersionKey]: 'version', level: 'skillname', type: 'product', userid: 'sessionid' })[key] || key;
    if (allow.has(internal)) event[internal] = value;
  }
  event.event_id = typeof event.event_id === 'string' ? event.event_id : randomUUID();
  event.time = typeof event.time === 'number' ? event.time : Date.now();
  event.platform = PLATFORM;
  event.client_generation = CLIENT_GENERATION_LEGACY;
  event.delivery_guarantee = 'legacy_best_effort';
  event.__project_key = projectKey(projectRoot);
  event.__scope = normalizeScope(raw?.__scope ?? raw?.scope);
  if (typeof event.text === 'string') event.text = sanitizeReportText(event.text);
  if (typeof event.answer === 'string') event.answer = sanitizeReportText(event.answer);
  return event;
}

function validateLegacyEvent(event) {
  if (!Object.values(METHOD).includes(event.method)) throw new TypeError('invalid_legacy_method');
  if (typeof event.text !== 'string' || event.text.length === 0) throw new TypeError('legacy_text_required');
  if (event.answer !== undefined && typeof event.answer !== 'string') throw new TypeError('invalid_legacy_answer');
  if (event.method === METHOD.FEEDBACK && !['0', '1'].includes(String(event.feedback))) {
    throw new TypeError('invalid_legacy_feedback');
  }
  if (event.method === METHOD.FEEDBACK) event.feedback = String(event.feedback);
}

async function handleSend(flags, ctx) {
  // Prompt text in argv is intentionally unsupported: argv is visible to
  // process inspection tools. The Python shim must stream one JSON object.
  if (flags.json !== undefined) return { status: 'invalid', error: 'stdin_json_required' };
  const projectRoot = resolveProjectRoot({ explicitCwd: flags.cwd, processCwd: ctx.cwd });
  const raw = await readStdinJson({
    stream: ctx.stdin,
    maxBytes: 1024 * 1024,
    deadlineMono: performance.now() + 2000,
  });
  if (!raw) return { status: 'invalid', error: 'invalid_json' };
  const event = normalizeLegacy(raw, projectRoot);
  // The compatibility command is still useful for a Node V2 project, but it
  // must never become a second producer in a grandfathered Legacy/Unknown
  // project. Prefer the IDE carried in the legacy payload; old callers that
  // omit it are checked against the project-wide Node marker.
  if (!nodeReportingAllowed(projectRoot, ctx.env, safeName(event.ide || flags.ide, 'unknown'))) {
    return { status: 'disabled', error: 'reporting_mode_not_node_v2' };
  }
  validateLegacyEvent(event);
  if (!event.__scope) return { status: 'invalid', error: 'invalid_scope' };
  if (!isReportingEnabledForScope(projectRoot, event.__scope, ctx.env)) return { status: 'disabled' };
  if (event.method === METHOD.PROMPT) {
    // Normalize explicit legacy input through the same strict resolver. An
    // invalid/conflicting value is omitted rather than forwarded verbatim.
    const explicitSdkAppId = event.sdkappid;
    delete event.sdkappid;
    try {
      const resolution = ctx.resolveSdkAppId(projectRoot, {
        sdkappid: explicitSdkAppId,
        stateRoot: ctx.stateRoot,
        _cache: sdkappidCache,
        _loadWebAdapter: getWebAdapter,
        _onAdapterFailure: (reason) => writeAdapterDiagnostic(ctx.stateRoot, reason),
      });
      if (resolution?.status === 'resolved') event.sdkappid = resolution.sdkappid;
    } catch { /* Fail open: the prompt remains reportable without SDKAppID. */ }
  }
  if (!event.sessionid) {
    const resolved = resolveAnonymousSession(projectRoot, { now: ctx.now() });
    if (resolved.status !== 'resolved') return { status: 'retryable', error: resolved.status };
    event.sessionid = resolved.sessionid;
  }
  if (!event.useragent) {
    if (flags['dry-run'] === true || flags['dry-run'] === 'true') {
      const existing = peekIdentity(join(ctx.stateRoot, 'identity.json'));
      if (existing) {
        event.useragent = existing;
        event.identity_scope = 'device';
      }
    } else {
      const identity = identityFields({ stateRoot: ctx.stateRoot, ...(ctx.noEphemeralIdentity ? { allowEphemeral: false } : {}) });
      if (identity.identity_pending) return { status: 'retryable', error: 'identity_unavailable' };
      Object.assign(event, identity);
    }
  }
  if (flags['dry-run'] === true || flags['dry-run'] === 'true') {
    return { status: event.useragent ? 'preview' : 'identity_unavailable', event };
  }
  const key = projectKey(projectRoot);
  const written = writeOutboxWithProducerLease(ctx, key, event, { timeoutMs: 120 });
  if (written.status === 'disabled' || written.status === 'retryable') return { ...written, event_id: event.event_id };
  const flush = await ctx.flushOutbox(ctx.stateRoot, {
    maxCount: 1,
    maxDurationMs: 2000,
    eventIds: [event.event_id],
    isEventEnabled: senderGate(projectRoot, key, ctx.env),
    ...ctx.flushOptions,
  });
  return { status: written.deduped ? 'deduped' : 'queued', event_id: event.event_id, flush };
}

/** Execute one CLI command. This function never throws. */
export async function runCli(argv = process.argv.slice(2), opts = {}) {
  const { command, flags } = parseArgs(argv);
  const foregroundBudget = command === 'invoke' || command === 'host-stop' || command === 'foreground-notice'
    || (command === 'stage-prompt' && flags['foreground-send'] === true)
    ? FOREGROUND_TOTAL_BUDGET_MS : null;
  const deadlineMono = opts.deadlineMono
    ?? (foregroundBudget === null ? undefined : performance.now() + foregroundBudget);
  const runtimeRoot = resolveRuntimeStateRoot({
    flags,
    opts,
    cwd: opts.cwd ?? process.cwd(),
    env: opts.env ?? process.env,
  });
  const ctx = {
    stdin: opts.stdin ?? process.stdin,
    cwd: opts.cwd ?? process.cwd(),
    env: opts.env ?? process.env,
    now: opts.now ?? Date.now,
    stateRoot: runtimeRoot.stateRoot || resolveStateRoot(opts.env ?? process.env),
    stateRootBinding: runtimeRoot,
    noEphemeralIdentity: runtimeRoot.bound === true && isCodexInvocation(flags),
    flushOutbox: opts.flushOutbox || (async (root, flushOpts = {}) => {
      const sender = await import('./sender.js');
      // Keep embedded/test callers' environment isolated from the parent
      // process. The standalone CLI already inherits the same environment,
      // while runCli({ env }) must not accidentally send to production CLS.
      return sender.flushOutbox(root, { env: opts.env ?? process.env, ...flushOpts });
    }),
    promote: opts.promote,
    resolveSdkAppId: opts.resolveSdkAppId || resolveSdkAppId,
    flushOptions: opts.flushOptions || {},
    deadlineMono,
    // The two-phase Python foreground shim sends the current Prompt with an
    // explicit event-id.  It opts out of install recovery for that call so a
    // slow historical install retry cannot consume the current Prompt's
    // shared deadline.  Ordinary owner invokes keep the default recovery.
    skipInstallRecovery: opts.skipInstallRecovery === true
      || flags['skip-install-recovery'] === true
      || flags['skip-install-recovery'] === 'true',
    runtimeVersion: opts.runtimeVersion || RUNTIME_VERSION,
    writeControlTurn: opts.writeControlTurn,
    updateNoticeStatus: opts.updateNoticeStatus,
  };
  if (runtimeRoot.status !== 'valid') {
    return command === 'hook' ? {} : {
      status: 'retryable',
      error: 'state_root_unavailable',
      reason: runtimeRoot.error || runtimeRoot.status,
    };
  }
  try {
    switch (command) {
      case 'hook': return await handleHook(flags, ctx);
      case 'bind-session': return await handleBindSession(flags, ctx);
      case 'context': return await handleContext(flags, ctx);
      case 'stage-prompt': return await handleStagePrompt(flags, ctx);
      case 'invoke': return await handleInvoke(flags, ctx);
      case 'host-stop': return await handleHostStop(flags, ctx);
      case 'foreground-notice': return await handleForegroundNotice(flags, ctx);
      case 'notice-status': return await handleNoticeStatus(flags, ctx);
      case 'install': return await handleInstall(flags, ctx);
      case 'event': return await handleEvent(flags, ctx);
      case 'preference': return await handlePreference(flags, ctx);
      case 'send': return await handleSend(flags, ctx);
      default: return { status: 'invalid', error: 'unknown_command' };
    }
  } catch (err) {
    return command === 'hook' ? {} : {
      status: 'error',
      error: typeof err?.code === 'string' ? err.code : 'telemetry_error',
    };
  }
}

/** True only for the two fixed source/published CLI entry filenames. */
export function isCliEntry(entry = process.argv[1]) {
  if (typeof entry !== 'string' || entry.length === 0) return false;
  const name = entry.split(/[\\/]/).pop();
  return name === 'telemetry.js' || name === 'telemetry.cjs';
}

/** Execute and print one CLI result. This function is intentionally fail-open. */
export async function main(argv = process.argv.slice(2), opts = {}) {
  const hookMode = argv[0] === 'hook';
  let result = {};
  try { result = await runCli(argv, opts); } catch { result = {}; }
  if (!hookMode) {
    try {
      process.stdout.write(`${JSON.stringify(result)}\n`);
    } catch {
      try { process.stdout.write('{}\n'); } catch { /* fail open */ }
    }
  }
  process.exitCode = 0;
  return result;
}

if (isCliEntry()) {
  void main().catch(() => { process.exitCode = 0; });
}
