import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { readInputLines } from './timeline.js';
import { buildTimeline, renderTimelineMarkdown } from './lib/timeline.js';

test('preserves physical file line numbers after blank-line filtering', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trtc-timeline-lines-'));
  const logPath = path.join(tempDir, 'LiteAV-test.log');
  const logLine = '[I][08-25/11:41:32.797+8.0][1,2][trtc-api]EnterRoom [sdkAppId:1400073238|user_id:19110474|room_id:10001|str_room_id:|role:Anchor|stream_id:|business_info:]';

  try {
    fs.writeFileSync(logPath, `\n\n${logLine}\n`, 'utf8');
    const { lines, fileNames } = readInputLines([logPath]);
    assert.deepEqual(lines, [{
      text: logLine,
      line: 3,
      endLine: 3,
      source: 'LiteAV-test.log',
    }]);

    const apiData = {
      logRules: [{
        id: 'enter-room',
        sdk: '实时音视频TRTC',
        ruleDesc: 'enter room',
        level: 'info',
        rules: [{ reg: '.*EnterRoom.*', desc: 'entered', test: '' }],
      }],
      timelines: [],
      errorCodes: [],
      sdkNames: ['实时音视频TRTC'],
    };
    const timeline = buildTimeline(lines, { apiData, fileNames });
    assert.equal(timeline.events.length, 1);
    assert.equal(timeline.events[0].line, 3);
    assert.equal(timeline.events[0].source, 'LiteAV-test.log');

    const markdown = renderTimelineMarkdown(timeline);
    assert.match(markdown, /LiteAV-test\.log \| L3/);
    assert.match(markdown, /LiteAV-test\.log:L3:/);
    assert.equal(markdown.includes('1400073238'), false);
    assert.equal(markdown.includes('19110474'), false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
