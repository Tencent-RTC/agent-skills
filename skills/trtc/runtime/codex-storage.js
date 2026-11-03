// Installer-only relocation. Runtime commands never migrate queues or alter
// sandbox permissions. Codex's durable spool must be writable by project tools.
import {
  existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync,
  openSync, fsyncSync, closeSync, renameSync, unlinkSync, realpathSync,
} from 'node:fs';
import { join, dirname, relative, isAbsolute, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { getOrCreate, isValidIdentityRecord } from './identity.js';
import { resolveProjectStateDir } from './project-state.js';
import { projectKey, isEventReportingEnabled, readPreferenceState } from './preference.js';
import {
  listPending, listOutbox, readEvent, writePending, writeOutbox,
  acquireReservation, releaseReservation,
} from './outbox.js';
import {
  acquireProjectAdmissionReservation, releaseProjectAdmissionReservation,
  acquireProjectSendReservation, releaseProjectSendReservation,
  listActiveProducerLeases,
  readEventAcknowledgement,
} from './control.js';

function fail(reason) { throw Object.assign(new Error(`codex_storage:${reason}`), { code: 'CODEX_STORAGE_UNAVAILABLE' }); }

function noSymlinkAncestors(file) {
  let current = resolve(file);
  while (true) {
    try { if (lstatSync(current).isSymbolicLink()) fail('symlink_storage_path'); }
    catch (err) { if (err?.code !== 'ENOENT') throw err; }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

function safeFile(file) {
  noSymlinkAncestors(file);
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2 * 1024 * 1024) fail('unsafe_source');
  return readFileSync(file);
}

function publish(file, data) {
  noSymlinkAncestors(file);
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${randomBytes(8).toString('hex')}.tmp`;
  let fd;
  try {
    fd = openSync(tmp, 'wx', 0o600); writeFileSync(fd, data); fsyncSync(fd);
    closeSync(fd); fd = undefined; renameSync(tmp, file);
    let directory;
    try { directory = openSync(dirname(file), 'r'); fsyncSync(directory); } catch (err) {
      if (!['EINVAL', 'ENOSYS', 'EPERM', 'EACCES', 'EISDIR', 'ENOTSUP'].includes(err?.code)) throw err;
    } finally { if (directory !== undefined) closeSync(directory); }
  } finally {
    if (fd !== undefined) closeSync(fd);
    try { unlinkSync(tmp); } catch (err) { if (err?.code !== 'ENOENT') throw err; }
  }
}

// Receipt/control metadata is copied, never removed from a shared old root.
// Other IDEs may still depend on its project gate/ACKs. Never copy live locks.
function copyControl(source, target) {
  if (!existsSync(source)) return;
  if (lstatSync(source).isSymbolicLink()) fail('symlink_control');
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) fail('symlink_control');
    if (entry.isDirectory()) {
      if (['event-acks', 'control-turns'].includes(entry.name)) copyControl(join(source, entry.name), join(target, entry.name));
    } else if (entry.isFile() && (entry.name.endsWith('.json') || entry.name === 'deny-v1.tombstone')
        && !entry.name.includes('owner') && !entry.name.includes('lock')) {
      const dest = join(target, entry.name);
      if (!existsSync(dest)) publish(dest, safeFile(join(source, entry.name)));
    }
  }
}

export function codexProjectStateRoot(projectRoot) {
  const root = realpathSync(projectRoot);
  const state = resolveProjectStateDir(root);
  if (existsSync(state) && lstatSync(state).isSymbolicLink()) fail('symlink_project_state');
  const target = join(state, 'codex-runtime');
  if (existsSync(target) && lstatSync(target).isSymbolicLink()) fail('symlink_spool');
  mkdirSync(target, { recursive: true, mode: 0o700 });
  const canonical = realpathSync(target), rel = relative(root, canonical);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) fail('spool_outside_project');
  // Protect the private spool even if the user initializes Git only later.
  // Do not rely solely on an existing repository's local info/exclude file.
  const ignore = join(canonical, '.gitignore');
  const previous = existsSync(ignore) ? safeFile(ignore).toString('utf8') : '';
  if (!previous.endsWith('*\n')) publish(ignore, `${previous}${previous && !previous.endsWith('\n') ? '\n' : ''}*\n`);
  return canonical;
}

export function initializeCodexStorage({ projectRoot, sourceRoot, initializeIdentity = true, env = process.env }) {
  projectRoot = realpathSync(projectRoot);
  const target = codexProjectStateRoot(projectRoot);
  sourceRoot = realpathSync(sourceRoot);
  if (target === sourceRoot) return { stateRoot: target, migrated: 0 };
  // Reuse the anonymous device identity: project-local queues must not turn
  // every project into a new device. getOrCreate uses the shared identity lock.
  if (initializeIdentity) getOrCreate({ stateRoot: sourceRoot, env, allowEphemeral: false });
  const identityFile = join(sourceRoot, 'identity.json');
  if (existsSync(identityFile)) {
    const bytes = safeFile(identityFile), identity = JSON.parse(bytes);
    if (!isValidIdentityRecord({ ...identity, identity_scope: 'device' })) fail('invalid_identity');
    const dest = join(target, 'identity.json');
    if (existsSync(dest) && JSON.parse(safeFile(dest)).useragent !== identity.useragent) fail('identity_conflict');
    if (!existsSync(dest)) publish(dest, bytes);
  }
  const seed = join(sourceRoot, 'telemetry/hook-activation/device-seed');
  const localSeed = join(target, 'telemetry/hook-activation/device-seed');
  if (existsSync(seed) && !existsSync(localSeed)) publish(localSeed, safeFile(seed));
  return { stateRoot: target };
}

export async function prepareCodexStorage({ projectRoot, sourceRoot, initializeIdentity = true,
  env = process.env, commit = () => {} }) {
  const { stateRoot: target } = initializeCodexStorage({ projectRoot, sourceRoot, initializeIdentity, env });
  projectRoot = realpathSync(projectRoot); sourceRoot = realpathSync(sourceRoot);
  if (target === sourceRoot) { commit(target); return { stateRoot: target, migrated: 0 }; }
  const key = projectKey(projectRoot);
  const admission = acquireProjectAdmissionReservation(sourceRoot, key, { timeoutMs: 1000 });
  if (!admission) fail('migration_admission_busy');
  let send;
  const moved = [];
  try {
    send = acquireProjectSendReservation(sourceRoot, key, { timeoutMs: 1000 });
    if (!send) fail('migration_sender_busy');
    const leases = listActiveProducerLeases(sourceRoot, key);
    if (leases.active || leases.busy || leases.error) fail('migration_producer_busy');
    copyControl(join(sourceRoot, 'telemetry/control', key), join(target, 'telemetry/control', key));
    for (const [bucket, paths] of [['outbox', listOutbox(sourceRoot)], ['pending', listPending(sourceRoot)]]) {
      for (const file of paths) {
        const event = readEvent(file);
        if (event?.__project_key !== key || event.ide !== 'codex') continue;
        // Never revive a default-on backlog or experience denied by the user.
        if (!isEventReportingEnabled(projectRoot, event, env)) continue;
        const lock = acquireReservation(sourceRoot, event.event_id, { timeoutMs: 500 });
        if (!lock) fail('migration_event_busy');
        try {
          const bytes = safeFile(file), current = JSON.parse(bytes);
          if (current.event_id !== event.event_id || current.__project_key !== key || current.ide !== 'codex') fail('migration_event_changed');
          if (readEventAcknowledgement(target, key, current.event_id).status !== 'valid') {
            const written = bucket === 'outbox' ? writeOutbox(target, current) : writePending(target, current);
            if (!written.path) fail(`migration_${written.status || 'write_failed'}`);
            const stored = readEvent(written.path);
            if (stored?.event_id !== current.event_id || stored.__project_key !== key || stored.text !== current.text) fail('migration_conflict');
          }
          moved.push({ file, bytes, id: event.event_id });
        } finally { releaseReservation(lock); }
      }
    }
    const deferred = join(sourceRoot, 'telemetry/deferred-turns');
    const preference = readPreferenceState(projectRoot);
    if (existsSync(deferred)) {
      const consentAt = preference.status === 'valid' ? preference.value.continuation_choice_updated_at * 1000 : NaN;
      for (const name of readdirSync(deferred)) {
        if (!name.startsWith(`${key}-codex-`) || !name.endsWith('.json')) continue;
        const file = join(deferred, name), bytes = safeFile(file), value = JSON.parse(bytes);
        // Old intents have no consent generation. The preference timestamp
        // has second precision: exclude its entire boundary second rather
        // than accidentally backfill a pre-consent turn from that second.
        if (value.project_key !== key || value.ide !== 'codex' || !Number.isFinite(consentAt)
          || value.created_at < consentAt + 1000 || !isEventReportingEnabled(projectRoot, { method: 'prompt',
            __consent_id: preference.value.experience_consent_id }, env)) continue;
        const dest = join(target, 'telemetry/deferred-turns', name);
        if (!existsSync(dest)) publish(dest, bytes);
        if (!safeFile(dest).equals(bytes)) fail('intent_conflict');
        moved.push({ file, bytes, id: value.event_id });
      }
    }
    // Publication is durable before removal. A crash leaves the same ID on
    // both sides, never a missing event; rerunning add dedupes that transfer.
    publish(join(target, 'storage-migration.json'), JSON.stringify({ version: 1,
      project_key: key, source_root: sourceRoot, migrated_event_ids: moved.map(v => v.id), completed_at: Date.now() }));
    // Hook commands already point at target; publish the ready binding while
    // the old root's producer/sender reservations are held. New runtime code
    // also redirects a stale Hook command through this V2 binding.
    commit(target);
    for (const { file, bytes } of moved) {
      if (existsSync(file) && safeFile(file).equals(bytes)) unlinkSync(file);
    }
    return { stateRoot: target, migrated: moved.length };
  } finally {
    releaseProjectSendReservation(send); releaseProjectAdmissionReservation(admission);
  }
}
