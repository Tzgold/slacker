// background.js

const STORAGE_KEY_URL = 'slacker_worker_url';
const STORAGE_KEY_MSGS = 'slacker_messages';
const POLL_ALARM = 'slacker_poll';
const DEFAULT_WORKER = 'https://slacker.tzgold.workers.dev';

chrome.runtime.onInstalled.addListener(async () => {
  const { [STORAGE_KEY_URL]: url } = await chrome.storage.local.get(STORAGE_KEY_URL);
  if (!url) await chrome.storage.local.set({ [STORAGE_KEY_URL]: DEFAULT_WORKER });
  chrome.alarms.create(POLL_ALARM, { periodInMinutes: 0.5 });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(POLL_ALARM, { periodInMinutes: 0.5 });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === POLL_ALARM) await pollForReceipts();
});

async function pollForReceipts() {
  const data = await chrome.storage.local.get([STORAGE_KEY_URL, STORAGE_KEY_MSGS]);
  const workerUrl = (data[STORAGE_KEY_URL] || DEFAULT_WORKER).replace(/\/$/, '');
  const tracked = data[STORAGE_KEY_MSGS];
  if (!tracked) return;

  const unseenIds = Object.entries(tracked)
    .filter(([, v]) => !v.seen)
    .map(([id]) => id);

  if (unseenIds.length === 0) {
    updateBadge(Object.values(tracked).filter((v) => v.seen).length);
    return;
  }

  let anyUpdated = false;

  for (let i = 0; i < unseenIds.length; i += 40) {
    const batch = unseenIds.slice(i, i + 40);
    try {
      const res = await fetch(`${workerUrl}/status?ids=${encodeURIComponent(batch.join(','))}`, {
        cache: 'no-store',
      });
      if (!res.ok) continue;
      const json = await res.json();
      for (const [msgId, receipt] of Object.entries(json)) {
        if (receipt?.seenAt && tracked[msgId]) {
          tracked[msgId].seen = true;
          tracked[msgId].seenAt = receipt.seenAt;
          anyUpdated = true;
        }
      }
    } catch (err) {
      console.warn('[Slacker] poll error:', err);
    }
  }

  if (anyUpdated) {
    await chrome.storage.local.set({ [STORAGE_KEY_MSGS]: tracked });
    updateBadge(Object.values(tracked).filter((v) => v.seen).length);
    notifyAllSlackTabs(tracked);
  }
}

async function notifyAllSlackTabs(tracked) {
  const tabs = await chrome.tabs.query({ url: '*://*.slack.com/*' });
  for (const tab of tabs) {
    chrome.tabs.sendMessage(tab.id, { type: 'RECEIPTS_UPDATE', data: tracked }).catch(() => {});
  }
}

function schedulePolls() {
  [1500, 4000, 8000, 15000, 30000].forEach((ms) => setTimeout(pollForReceipts, ms));
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

function updateBadge(count) {
  chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#0f766e' });
}
