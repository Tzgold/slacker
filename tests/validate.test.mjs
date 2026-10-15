import { isValidMsgId, buildMsgId, escapeHtml } from '../shared/validate.js';
import assert from 'node:assert/strict';

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log('PASS', name);
  } catch (e) {
    console.error('FAIL', name, e.message);
    process.exitCode = 1;
  }
}

test('buildMsgId strips dot from slack ts', () => {
  assert.equal(buildMsgId('D0123456789', '1712345678.901234'), 'D0123456789_1712345678901234');
});

test('valid DM message id', () => {
  assert.equal(isValidMsgId('D0123456789_1712345678901234'), true);
});

test('valid channel message id', () => {
  assert.equal(isValidMsgId('C0A1B2C3D4_1712345678901234'), true);
});

test('rejects empty / short / injection-like ids', () => {
  assert.equal(isValidMsgId(''), false);
  assert.equal(isValidMsgId('abc'), false);
  assert.equal(isValidMsgId('../etc/passwd'), false);
  assert.equal(isValidMsgId('D12_<script>'), false);
  assert.equal(isValidMsgId('D0123456789_'), false);
});

test('escapeHtml escapes markup', () => {
  assert.equal(escapeHtml('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(escapeHtml('a&b'), 'a&amp;b');
});

console.log(`\n${passed} tests passed`);
