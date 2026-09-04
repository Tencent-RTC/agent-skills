// project-state.js — project-local state directory selection.
//
// New Node V2 installs use `.trtc-skill-state`.  `.trtc-reporting` is kept as
// a read/write compatibility location for projects installed before the
// rename.  Selection is deliberately based on durable install markers/stage
// first, then existing state, so an upgrade never creates a second live state
// tree or loses a user's preference/queue.

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const PROJECT_STATE_DIR = '.trtc-skill-state';
export const LEGACY_PROJECT_STATE_DIR = '.trtc-reporting';
export const INSTALL_MARKER_FILE = 'install-mode.json';
export const INSTALL_STAGE_FILE = 'install-stage.json';

export function projectStateDirs(projectRoot) {
  const root = resolve(projectRoot);
  return [
    join(root, PROJECT_STATE_DIR),
    join(root, LEGACY_PROJECT_STATE_DIR),
  ];
}
function hasInstallArtifact(dir) {
  return existsSync(join(dir, INSTALL_MARKER_FILE)) ||
    existsSync(join(dir, INSTALL_STAGE_FILE));
}

/**
 * Resolve the single directory that owns project-local Node state.
 * Existing marker/stage wins over a directory-only fallback.  A fresh root
 * therefore always receives the new neutral name.
 */
export function resolveProjectStateDir(projectRoot) {
  const [current, legacy] = projectStateDirs(projectRoot);
  if (hasInstallArtifact(current)) return current;
  if (hasInstallArtifact(legacy)) return legacy;
  if (existsSync(current)) return current;
  if (existsSync(legacy)) return legacy;
  return current;
}
