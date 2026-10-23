// Tests for session teardown ordering.
//
// Run: pnpm --filter web test
//
// These lock in the failure paths: what must still happen when a step throws.
// The happy path is easy to see in the browser; these are not.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { releaseTrtc, stopThenLeave } from './session.js'
import type { Releasable } from './session.js'

function fakeTrtc(failing: Partial<Record<keyof Releasable, Error>> = {}) {
  const calls: string[] = []
  const step = (name: keyof Releasable) => async () => {
    calls.push(name)
    const err = failing[name]
    if (err) throw err
  }
  const trtc: Releasable = {
    stopLocalAudio: step('stopLocalAudio'),
    exitRoom: step('exitRoom'),
    destroy: step('destroy'),
  }
  return { trtc, calls }
}

describe('releaseTrtc', () => {
  it('runs all three steps in order on the happy path', async () => {
    const { trtc, calls } = fakeTrtc()
    const errors = await releaseTrtc(trtc)
    assert.deepEqual(calls, ['stopLocalAudio', 'exitRoom', 'destroy'])
    assert.deepEqual(errors, [])
  })

  it('still destroys when stopLocalAudio throws (mic never started)', async () => {
    const boom = new Error('not started')
    const { trtc, calls } = fakeTrtc({ stopLocalAudio: boom })
    const errors = await releaseTrtc(trtc)
    assert.deepEqual(calls, ['stopLocalAudio', 'exitRoom', 'destroy'])
    assert.deepEqual(errors, [boom])
  })

  it('still destroys when exitRoom throws (room never entered)', async () => {
    const boom = new Error('not in room')
    const { trtc, calls } = fakeTrtc({ exitRoom: boom })
    const errors = await releaseTrtc(trtc)
    assert.deepEqual(calls, ['stopLocalAudio', 'exitRoom', 'destroy'])
    assert.deepEqual(errors, [boom])
  })

  it('collects every failure and never throws', async () => {
    const a = new Error('a')
    const b = new Error('b')
    const c = new Error('c')
    const { trtc } = fakeTrtc({ stopLocalAudio: a, exitRoom: b, destroy: c })
    assert.deepEqual(await releaseTrtc(trtc), [a, b, c])
  })

  it('handles a synchronous throw (destroy() is not async in the SDK)', async () => {
    const calls: string[] = []
    const trtc: Releasable = {
      stopLocalAudio: () => { calls.push('stopLocalAudio') },
      exitRoom: () => { calls.push('exitRoom'); throw new Error('sync') },
      destroy: () => { calls.push('destroy') },
    }
    const errors = await releaseTrtc(trtc)
    assert.deepEqual(calls, ['stopLocalAudio', 'exitRoom', 'destroy'])
    assert.equal(errors.length, 1)
  })
})

describe('stopThenLeave', () => {
  it('stops the agent before leaving the room', async () => {
    const calls: string[] = []
    const err = await stopThenLeave(
      async () => { calls.push('stop') },
      async () => { calls.push('leave') },
    )
    assert.deepEqual(calls, ['stop', 'leave'])
    assert.equal(err, null)
  })

  it('leaves the room even when stopping the agent fails', async () => {
    const calls: string[] = []
    const err = await stopThenLeave(
      async () => { calls.push('stop'); throw new Error('500 from /agent/stop') },
      async () => { calls.push('leave') },
    )
    assert.deepEqual(calls, ['stop', 'leave'])
    assert.equal(err?.message, '500 from /agent/stop')
  })

  it('reports the stop error, not the leave error, when both fail', async () => {
    const err = await stopThenLeave(
      async () => { throw new Error('stop failed') },
      async () => { throw new Error('leave failed') },
    )
    assert.equal(err?.message, 'stop failed')
  })

  it('reports a leave error when only leaving fails', async () => {
    const err = await stopThenLeave(
      async () => {},
      async () => { throw new Error('leave failed') },
    )
    assert.equal(err?.message, 'leave failed')
  })

  it('wraps a non-Error rejection so the caller can read .message', async () => {
    const err = await stopThenLeave(
      async () => { throw 'plain string' },
      async () => {},
    )
    assert.ok(err instanceof Error)
    assert.equal(err.message, 'plain string')
  })
})
