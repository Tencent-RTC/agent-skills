// hook-activation.js — deterministic, privacy-preserving Hook activation state.
// The device seed and ack markers are local-only and are never serialized to CLS.

import { createHash, randomBytes } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

const ACTIVATION_DIR = 'hook-activation';
const DEVICE_SEED_FILE = 'device-seed';
const ACK_DIR = 'acked';
const SAFE_EVENT_ID_RE = /^ha_[a-f0-9]{40}$/;

function activationRoot(stateRoot) {
  return join(stateRoot, 'telemetry', ACTIVATION_DIR);
}

function readSeed(path) {
  try {
    const seed = readFileSync(path, 'utf8').trim();
    return /^[a-f0-9]{64}$/.test(seed) ? seed : null;
  } catch { return null; }
}

/** Create/read the local-only device seed. Returns null when the Hook budget is exhausted. */
export function ensureActivationDeviceSeed(stateRoot, opts = {}) {
  const dir = activationRoot(stateRoot);
  const path = join(dir, DEVICE_SEED_FILE);
  const existing = readSeed(path);
  if (existing) return existing;
  if (Number.isFinite(opts.deadlineMono) && performance.now() >= opts.deadlineMono) return null;
  try { mkdirSync(dir, { recursive: true, mode: process.platform === 'win32' ? undefined : 0o700 }); }
  catch { return null; }
  const seed = randomBytes(32).toString('hex');
  const tmp = join(dir, `.device-seed-${process.pid}-${randomBytes(6).toString('hex')}.tmp`);
  let fd;
  try {
    fd = openSync(tmp, 'wx', process.platform === 'win32' ? undefined : 0o600);
    writeSync(fd, `${seed}\n`, null, 'utf8');
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    try { linkSync(tmp, path); }
    catch (err) { if (err?.code !== 'EEXIST') throw err; }
    try { unlinkSync(tmp); } catch { /* ignore */ }
    return readSeed(path);
  } catch (err) {
    if (fd !== undefined) try { closeSync(fd); } catch { /* ignore */ }
    try { unlinkSync(tmp); } catch { /* ignore */ }
    return null;
  }
}

export function deriveActivationEventId(deviceSeed, projectKey, ide, version) {
  if (!/^[a-f0-9]{64}$/.test(String(deviceSeed))) throw new TypeError('invalid activation device seed');
  const digest = createHash('sha256')
    .update(`${deviceSeed}\0${projectKey}\0${ide}\0${version}`)
    .digest('hex')
    .slice(0, 40);
  return `ha_${digest}`;
}

export function activationAckPath(stateRoot, eventId) {
  if (!SAFE_EVENT_ID_RE.test(String(eventId))) throw new TypeError('invalid activation event id');
  return join(activationRoot(stateRoot), ACK_DIR, `${eventId}.ack`);
}

export function isHookActivationAcked(stateRoot, eventId) {
  try { return readFileSync(activationAckPath(stateRoot, eventId), 'utf8').trim() === eventId; }
  catch { return false; }
}

/** Atomically publish an ack marker. Only validated internal activation events are accepted. */
export function acknowledgeHookActivation(stateRoot, event) {
  if (event?.text !== 'hook_activated'
      || !SAFE_EVENT_ID_RE.test(String(event.event_id))
      || event.__activation_key !== event.event_id) {
    return { applicable: false, acked: false };
  }
  const path = activationAckPath(stateRoot, event.event_id);
  const dir = join(activationRoot(stateRoot), ACK_DIR);
  mkdirSync(dir, {
    recursive: true,
    mode: process.platform === 'win32' ? undefined : 0o700,
  });
  const tmp = join(dir, `.ack-${process.pid}-${randomBytes(6).toString('hex')}.tmp`);
  let fd;
  try {
    fd = openSync(tmp, 'wx', process.platform === 'win32' ? undefined : 0o600);
    writeSync(fd, `${event.event_id}\n`, null, 'utf8');
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    let deduped = false;
    try { linkSync(tmp, path); }
    catch (err) { if (err?.code === 'EEXIST') deduped = true; else throw err; }
    try { unlinkSync(tmp); } catch { /* ignore */ }
    if (!isHookActivationAcked(stateRoot, event.event_id)) throw new Error('activation ack publish failed');
    return { applicable: true, acked: true, path, ...(deduped ? { deduped: true } : {}) };
  } catch (err) {
    if (fd !== undefined) try { closeSync(fd); } catch { /* ignore */ }
    try { unlinkSync(tmp); } catch { /* ignore */ }
    throw err;
  }
}

export function removeHookActivationAck(stateRoot, eventId) {
  try { unlinkSync(activationAckPath(stateRoot, eventId)); }
  catch (err) { if (err?.code !== 'ENOENT') throw err; }
}
