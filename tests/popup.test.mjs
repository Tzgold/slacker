import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../popup.js', import.meta.url), 'utf8');
const listeners = new Map();

function element(id) {
  const classes = new Set();
  return {
    id,
    checked: true,
    disabled: false,
    textContent: '',
    innerHTML: '',
    classList: {
      toggle(name, on) {
        if (on) classes.add(name);
        else classes.delete(name);
      },
      contains(name) {
        return classes.has(name);
      },
    },
    addEventListener(type, fn) {
      listeners.set(`${id}:${type}`, fn);
    },
  };
}

const elements = Object.fromEntries(
  [
    'clear-btn',
    'poll-btn',
    'receipts-list',
    'live',
    'live-label',
    'stats',
    'count-delivered',
    'count-seen',
    'power-toggle',
    'power-label',
    'power-hint',
  ].map((id) => [id, element(id)])
);
const body = element('body');
let fetchCount = 0;

const context = {
  document: {
    body,
    getElementById(id) {
      return elements[id];
    },
  },
  chrome: {
    storage: {
      local: {
        set() {},
        get(_keys, cb) {
          cb({ slacker_enabled: false, slacker_messages: {} });
        },
      },
    },
    runtime: {
      sendMessage(_msg, cb) {
        cb?.({ ok: true });
      },
    },
  },
  fetch: async () => {
    fetchCount += 1;
    return { ok: true };
  },
  AbortSignal,
  Date,
  console,
  setTimeout,
  clearTimeout,
};

vm.runInNewContext(source, context, { filename: 'popup.js' });

assert.equal(elements['power-toggle'].checked, false);
assert.equal(elements['live-label'].textContent, 'Paused');
assert.equal(elements['live'].classList.contains('is-live'), false);
assert.equal(elements['poll-btn'].disabled, true);
assert.equal(fetchCount, 0);

elements['power-toggle'].checked = true;
listeners.get('power-toggle:change')();
await new Promise((resolve) => setTimeout(resolve, 0));

assert.equal(fetchCount, 1);
assert.equal(elements['live-label'].textContent, 'Connected');
assert.equal(elements['live'].classList.contains('is-live'), true);
assert.equal(elements['poll-btn'].disabled, false);

console.log('PASS popup paused/connected state follows the power toggle');
