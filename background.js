// background.js

const STORAGE_KEY_MSGS = 'slacker_messages';
const STORAGE_KEY_ENABLED = 'slacker_enabled';
const POLL_ALARM = 'slacker_poll';
const slackPorts = new Set();

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'slack-page') return;
  slackPorts.add(port);
  port.onDisconnect.addListener(() => slackPorts.delete(port));
});

async function isEnabled() {
  const data = await chrome.storage.local.get(STORAGE_KEY_ENABLED);
  return data[STORAGE_KEY_ENABLED] !== false;
}

chrome.runtime.onInstalled.addListener(() => {
  // Shared backend for every installer — not user-configurable
  chrome.alarms.create(POLL_ALARM, { periodInMinutes: 0.5 });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(POLL_ALARM, { periodInMinutes: 0.5 });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === POLL_ALARM) await pollForReceipts();
});

async function pollForReceipts() {
  if (!(await isEnabled())) return;
  for (const port of slackPorts) {
    try {
      port.postMessage({ type: 'POLL_RECEIPTS' });
      return;
    } catch (_) {
      slackPorts.delete(port);
    }
  }
}

function notifyAllSlackPages(tracked) {
  for (const port of slackPorts) {
    try {
      port.postMessage({ type: 'RECEIPTS_UPDATE', data: tracked });
    } catch (_) {
      slackPorts.delete(port);
    }
  }
}

function schedulePolls() {
  [1000, 3000, 6000, 12000, 25000].forEach((ms) => setTimeout(pollForReceipts, ms));
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'TRACK_MSG') {
    schedulePolls();
    sendResponse({ ok: true });
  }

  if (msg.type === 'GET_RECEIPTS') {
    chrome.storage.local.get(STORAGE_KEY_MSGS, (d) => sendResponse(d[STORAGE_KEY_MSGS] || {}));
    return true;
  }

  if (msg.type === 'CLEAR_RECEIPTS') {
    chrome.storage.local.remove(STORAGE_KEY_MSGS);
    updateBadge(0);
    sendResponse({ ok: true });
  }

  if (msg.type === 'FORCE_POLL') {
    pollForReceipts().then(() => sendResponse({ ok: true }));
    return true;
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[STORAGE_KEY_MSGS]) return;
  const tracked = changes[STORAGE_KEY_MSGS].newValue || {};
  updateBadge(Object.values(tracked).filter((value) => value.seen).length);
  notifyAllSlackPages(tracked);
});

function updateBadge(count) {
  chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#0f766e' });
}
