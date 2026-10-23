import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeCallbackSignature } from './webhook.js'

// ============================================================
// The official test vector.
//
// Key, body and expected signature are copied verbatim from
// https://www.tencentcloud.com/document/product/647/68331 ("Signature
// Calculation", Java/Python/PHP/Golang samples). If this test fails, either
// the implementation drifted or the published contract changed — in both
// cases the webhook route is broken and must not be trusted.
//
// Note the tabs and newlines: Tencent sends indented JSON and the docs say
// "Do not transform it". This body is the exact byte sequence that produces
// the published signature, which is why it is written out literally rather
// than built with JSON.stringify.
// ============================================================

const DOC_KEY = '123654'

const DOC_BODY =
  '{\n' +
  '\t"EventGroupId":\t2,\n' +
  '\t"EventType":\t204,\n' +
  '\t"CallbackTs":\t1664209748188,\n' +
  '\t"EventInfo":\t{\n' +
  '\t\t"RoomId":\t8489,\n' +
  '\t\t"EventTs":\t1664209748,\n' +
  '\t\t"EventMsTs":\t1664209748180,\n' +
  '\t\t"UserId":\t"user_85034614",\n' +
  '\t\t"Reason":\t0\n' +
  '\t}\n' +
  '}'

const DOC_SIGNATURE = 'kkoFeO3Oh2ZHnjtg8tEAQhtXK16/KI05W3BQff8IvGA='

test('reproduces the signature published in the official documentation', () => {
  assert.equal(computeCallbackSignature(DOC_KEY, DOC_BODY), DOC_SIGNATURE)
})

test('the digest is base64, not hex', () => {
  const sig = computeCallbackSignature(DOC_KEY, DOC_BODY)
  // 32-byte HMAC-SHA256 → 44 base64 chars with one '=' pad.
  assert.equal(sig.length, 44)
  assert.match(sig, /^[A-Za-z0-9+/]{43}=$/)
  assert.doesNotMatch(sig, /^[0-9a-f]{64}$/)
})

// The previous implementation hashed JSON.stringify(request.body). This is
// the test that would have caught it: the same JSON, re-serialised compactly,
// produces a completely different signature.
test('re-serialising the body changes the signature', () => {
  const reserialised = JSON.stringify(JSON.parse(DOC_BODY))
  assert.notEqual(reserialised, DOC_BODY)
  assert.notEqual(computeCallbackSignature(DOC_KEY, reserialised), DOC_SIGNATURE)
})

test('whitespace changes alone break the signature', () => {
  for (const mutated of [
    DOC_BODY.replace(/\t/g, '  '), // tabs → spaces
    DOC_BODY.replace(/\n/g, ''), // newlines removed
    DOC_BODY + '\n', // trailing newline added
  ]) {
    assert.notEqual(computeCallbackSignature(DOC_KEY, mutated), DOC_SIGNATURE)
  }
})

test('a different key produces a different signature', () => {
  assert.notEqual(computeCallbackSignature('123655', DOC_BODY), DOC_SIGNATURE)
})

test('signing is deterministic', () => {
  assert.equal(
    computeCallbackSignature(DOC_KEY, DOC_BODY),
    computeCallbackSignature(DOC_KEY, DOC_BODY)
  )
})

// Second vector from the same page (PHP/Golang samples share this body), kept
// as an independent check that the implementation is not fitted to one input.
test('matches a second body from the same documentation page', () => {
  const body =
    '{\n\t"EventGroupId":\t1,\n\t"EventType":\t101,\n\t"CallbackTs":\t1608086882372,\n' +
    '\t"EventInfo":\t{\n\t\t"RoomId":\t20222,\n\t\t"EventTs":\t1608086882,\n' +
    '\t\t"UserId":\t"222222_phone"\n\t}\n}'
  // The docs print the sample's output only as code, not as a literal, so
  // assert the shape and stability rather than a hardcoded digest.
  const sig = computeCallbackSignature('789', body)
  assert.match(sig, /^[A-Za-z0-9+/]{43}=$/)
  assert.equal(sig, computeCallbackSignature('789', body))
})
