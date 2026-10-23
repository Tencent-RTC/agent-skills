// ============================================================
// Session teardown — pure ordering logic, no TRTC import
//
// Kept out of the hooks so it can be unit-tested under Node: the
// guarantees below are exactly the ones that are hard to see by
// clicking around, because they only matter when something fails.
// ============================================================

/** The subset of a TRTC instance that teardown touches. */
export interface Releasable {
  stopLocalAudio(): unknown
  exitRoom(): unknown
  destroy(): unknown
}

/**
 * Release a TRTC instance: stop the mic, leave the room, destroy.
 *
 * Every step runs even if an earlier one throws. Sequential `await`s
 * would skip `destroy()` whenever `stopLocalAudio()` or `exitRoom()`
 * fails — e.g. on an instance whose `enterRoom` never succeeded — and
 * leave a live instance holding the microphone.
 *
 * Returns the errors instead of throwing: by the time this returns the
 * instance is gone either way, so there is nothing for a caller to retry.
 */
export async function releaseTrtc(trtc: Releasable): Promise<unknown[]> {
  const errors: unknown[] = []
  const steps = [
    () => trtc.stopLocalAudio(),
    () => trtc.exitRoom(),
    () => trtc.destroy(),
  ]
  for (const step of steps) {
    try {
      await step()
    } catch (err) {
      errors.push(err)
    }
  }
  return errors
}

/**
 * Stop the agent, then leave the room — and leave the room even if
 * stopping the agent fails.
 *
 * `stopAgent` is a network call (`POST /agent/stop` → Tencent Cloud) and
 * can fail for reasons the user cannot act on: a dropped request, the
 * dev server restarting, a task that already ended. If that skipped
 * `leaveRoom`, the UI would return to idle while the browser stayed in
 * the room with the microphone open.
 *
 * Returns the first error (or null) for the caller to display.
 */
export async function stopThenLeave(
  stopAgent: () => Promise<unknown>,
  leaveRoom: () => Promise<unknown>,
): Promise<Error | null> {
  let first: unknown = null
  try {
    await stopAgent()
  } catch (err) {
    first = err
  }
  try {
    await leaveRoom()
  } catch (err) {
    first ??= err
  }
  if (first === null) return null
  return first instanceof Error ? first : new Error(String(first))
}
