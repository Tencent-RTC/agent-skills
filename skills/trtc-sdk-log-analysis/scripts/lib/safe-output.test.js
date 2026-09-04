import assert from 'node:assert/strict';
import test from 'node:test';

import { redactSensitiveText, safeEvidenceLine } from './safe-output.js';

test('redacts TRTC identifiers, network addresses, and credentials', () => {
  const input = [
    'sdkAppId:1400073238',
    'user_id:19110474',
    'roomId:F2026082510023301243',
    '字符串房间号：F2026082510023301243',
    'LocationId:1400073238',
    'device_id:camera-serial-1',
    'ip:127.0.0.1',
    'LongPollingKey:very-secret-value',
    'token:abc123',
  ].join('|');

  const output = redactSensitiveText(input);

  for (const raw of [
    '1400073238',
    '19110474',
    'F2026082510023301243',
    'camera-serial-1',
    '127.0.0.1',
    'very-secret-value',
    'abc123',
  ]) {
    assert.equal(output.includes(raw), false, `leaked ${raw}: ${output}`);
  }
  assert.match(output, /sdkAppId=<sdkapp_[a-f0-9]{10}>/);
  assert.match(output, /user_id=<user_[a-f0-9]{10}>/);
  assert.match(output, /roomId=<room_[a-f0-9]{10}>/);
  assert.match(output, /字符串房间号=<room_[a-f0-9]{10}>/);
  assert.match(output, /LocationId=<location_[a-f0-9]{10}>/);
  assert.match(output, /<redacted-ip>/);
  assert.match(output, /LongPollingKey=<redacted>/i);
});

test('uses stable aliases and includes source-aware evidence locations', () => {
  const first = redactSensitiveText('userId:alice');
  const second = redactSensitiveText('user_id:alice');
  const firstAlias = first.match(/<user_[a-f0-9]{10}>/)?.[0];
  const secondAlias = second.match(/<user_[a-f0-9]{10}>/)?.[0];

  assert.equal(firstAlias, secondAlias);
  assert.match(
    safeEvidenceLine(42, 'userId:alice', { source: 'LiteAV.log' }),
    /^LiteAV\.log:L42: userId=<user_[a-f0-9]{10}>$/
  );
});
