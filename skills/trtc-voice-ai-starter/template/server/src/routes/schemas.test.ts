import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isRoomIdInRange, MAX_NUMERIC_ROOM_ID, numericRoomId, trtcUserId } from './schemas.js'

// The bound the TRTC SDK documents for enterRoom's `roomId`.
test('MAX_NUMERIC_ROOM_ID is 2^32 - 2, as documented by the SDK', () => {
  assert.equal(MAX_NUMERIC_ROOM_ID, 4294967294)
  assert.equal(MAX_NUMERIC_ROOM_ID, 2 ** 32 - 2)
})

test('the documented boundaries are accepted', () => {
  assert.ok(isRoomIdInRange('1'))
  assert.ok(isRoomIdInRange(String(MAX_NUMERIC_ROOM_ID)))
})

test('values just outside the range are rejected', () => {
  assert.ok(!isRoomIdInRange('0'))
  assert.ok(!isRoomIdInRange(String(MAX_NUMERIC_ROOM_ID + 1)))
})

// A 10-digit room ID passes the regex but can still exceed the bound — this
// is exactly the gap the range check exists to close.
test('a 10-digit value above the bound passes the pattern but fails the range', () => {
  const tooBig = '9999999999'
  assert.match(tooBig, new RegExp(numericRoomId.pattern))
  assert.ok(!isRoomIdInRange(tooBig))
})

test('the room ID the web app generates is in range', () => {
  for (const roomId of ['1000000', '9999999']) {
    assert.ok(isRoomIdInRange(roomId), roomId)
    assert.match(roomId, new RegExp(numericRoomId.pattern))
  }
})

test('non-numeric and malformed values fail the pattern', () => {
  const pattern = new RegExp(numericRoomId.pattern)
  for (const bad of ['r1', '', '0123', '12.5', '1e3', ' 123', '123 ', '-1', '١٢٣']) {
    assert.doesNotMatch(bad, pattern, bad)
  }
})

test('the range check does not accept non-integers or whitespace padding', () => {
  for (const bad of ['12.5', '', ' ', 'NaN', 'Infinity', ' 12', '12 ']) {
    assert.ok(!isRoomIdInRange(bad), bad)
  }
})

// `Number()` reads '1e3' as 1000 and '0x10' as 16. A range check written on
// top of a bare Number() would accept both, which is why isRoomIdInRange
// re-validates the digits rather than trusting the caller to run the pattern.
test('the range check rejects values Number() would coerce', () => {
  for (const bad of ['1e3', '0x10', '0b11', '0o17', '+1', '1n']) {
    assert.ok(!isRoomIdInRange(bad), bad)
  }
})

// SDK guidance: 32 bytes, [A-Za-z0-9_-]. Pattern is ASCII, so chars == bytes.
test('userId pattern follows the SDK character class and 32-byte limit', () => {
  const pattern = new RegExp(trtcUserId.pattern)
  assert.match('a'.repeat(32), pattern)
  assert.doesNotMatch('a'.repeat(33), pattern)
  assert.match('user_ab-12', pattern)
  for (const bad of ['', 'has space', 'has.dot', '../../etc/passwd', 'emoji😀', 'semi;colon']) {
    assert.doesNotMatch(bad, pattern, bad)
  }
})

test('the IDs this starter generates fit the userId pattern', () => {
  const pattern = new RegExp(trtcUserId.pattern)
  for (const id of ['user_a1b2c3', 'robot_a1b2c3', 'trans_a1b2c3']) {
    assert.match(id, pattern, id)
  }
})
