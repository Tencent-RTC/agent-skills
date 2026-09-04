#!/usr/bin/env node
/*
 * Claude/CodeBuddy/Codex Stop-hook dispatcher.
 *
 * A host only parses structured hook JSON when the command exits 0.  The
 * installer therefore cannot run the evidence guard, return its exit code,
 * and then expect host-stop's JSON to be processed.  This small wrapper runs
 * both commands, merges their decisions, and emits exactly one JSON object.
 */

const { spawnSync } = require('node:child_process');

function argValue(argv, name, fallback = null) {
  const index = argv.indexOf(name);
  return index >= 0 && index + 1 < argv.length ? argv[index + 1] : fallback;
}

function readStdin() {
  try {
    return require('node:fs').readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function runGuard(guardPath, input, env) {
  if (!guardPath) return { status: 0, stderr: '' };
  // Older installations may retain a guard path from a pre-bundle layout.
  // A missing optional guard is a dependency/configuration failure, not an
  // explicit guard decision; fail open so it cannot suppress a valid
  // post-answer telemetry notice.  The installer will repair the path on its
  // next run.
  try {
    if (!require('node:fs').statSync(guardPath).isFile()) return { status: 0, stderr: '' };
  } catch { return { status: 0, stderr: '' }; }
  const python = env.TRTC_PYTHON || env.PYTHON || 'python3';
  const result = spawnSync(python, [guardPath], {
    input,
    encoding: 'utf8',
    env,
    maxBuffer: 64 * 1024,
    timeout: 3_000,
  });
  // A guard dependency failure must remain fail-open, matching the guard's
  // own last-resort behavior.  Only an explicit non-zero exit blocks Stop.
  if (result.error || result.status === null) return { status: 0, stderr: '' };
  return {
    status: Number.isInteger(result.status) ? result.status : 0,
    stderr: typeof result.stderr === 'string' ? result.stderr : '',
  };
}

function runTelemetry(runtimePath, ide, input, env, cwd = null) {
  if (!runtimePath || !ide) return { status: 0, value: null };
  const args = [runtimePath, 'host-stop', '--ide', ide];
  if (typeof cwd === 'string' && cwd.length > 0) args.push('--cwd', cwd);
  const result = spawnSync(process.execPath, args, {
    input,
    encoding: 'utf8',
    env,
    maxBuffer: 128 * 1024,
    timeout: 5_000,
  });
  if (result.error || result.status === null || result.status !== 0) {
    return { status: result.status ?? 0, value: null };
  }
  const stdout = typeof result.stdout === 'string' ? result.stdout.trim() : '';
  if (!stdout) return { status: 0, value: null };
  try {
    const value = JSON.parse(stdout);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { status: 0, value: null };
    }
    // Status-only host-stop results are intentionally silent.  Only forward
    // a payload that the host can render or a structured block decision.
    const visible = typeof value.systemMessage === 'string'
      || typeof value.stopReason === 'string'
      || typeof value.message === 'string'
      || typeof value.followup_message === 'string'
      || value.decision === 'block';
    return visible ? { status: 0, value } : { status: 0, value: null };
  } catch {
    return { status: 0, value: null };
  }
}

function guardReason(stderr) {
  const text = String(stderr || '').trim();
  return text ? text.slice(0, 4_000) : 'Stop guard blocked completion; continue the current integration step.';
}

function dispatch({ ide, runtimePath, guardPath, cwd = null, input, env = process.env }) {
  const guard = runGuard(guardPath, input, env);
  const telemetry = runTelemetry(runtimePath, ide, input, env, cwd);

  if (telemetry.value) {
    const output = { ...telemetry.value };
    if (guard.status !== 0) {
      // Preserve the guard decision while retaining the user-visible notice.
      // The wrapper exits 0 so Claude still parses this JSON.
      output.continue = true;
      output.decision = 'block';
      output.reason = guardReason(guard.stderr);
    }
    return { output, exitCode: 0 };
  }

  if (guard.status !== 0) {
    return {
      output: { continue: true, decision: 'block', reason: guardReason(guard.stderr) },
      exitCode: 0,
    };
  }

  // Reporting is best-effort.  A sender/runtime failure must not turn a
  // completed assistant response into a host-visible hook error.
  return { output: null, exitCode: 0 };
}

function main(argv = process.argv.slice(2), env = process.env) {
  const ide = argValue(argv, '--ide');
  const runtimePath = argValue(argv, '--runtime-path');
  const guardPath = argValue(argv, '--guard-path');
  const cwd = argValue(argv, '--cwd');
  const input = readStdin();
  const result = dispatch({ ide, runtimePath, guardPath, cwd, input, env });
  if (result.output) process.stdout.write(`${JSON.stringify(result.output)}\n`);
  return result.exitCode;
}

if (require.main === module) process.exitCode = main();

module.exports = { argValue, dispatch, guardReason, main, runGuard, runTelemetry };
