// background.js — Manifest V3 service worker

const STORAGE_KEY_URL  = 'slacker_worker_url';
const STORAGE_KEY_MSGS = 'slacker_messages';
const POLL_ALARM       = 'slacker_poll';
const POLL_INTERVAL    = 0.5;   // minutes (≈30 seconds; alarms minimum is 1 min in prod, 0.5 in dev)
const BATCH_SIZE       = 50;    // max IDs per /status request

// ─── Startup ──────────────────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(POLL_ALARM, { periodInMinutes: POLL_INTERVAL });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(POLL_ALARM, { periodInMinutes: POLL_INTERVAL });
});

// ─── Alarm — poll worker for new read events ──────────────────────────────────
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== POLL_ALARM) return;
  await pollForReceipts();
});

async function pollForReceipts() {
  const { [STORAGE_KEY_URL]: workerUrl, [STORAGE_KEY_MSGS]: tracked } =
    await chrome.storage.local.get([STORAGE_KEY_URL, STORAGE_KEY_MSGS]);

  if (!workerUrl || !tracked) return;

  // Only poll for messages that haven't been seen yet
  const unseenIds = Object.entries(tracked)
    .filter(([, v]) => !v.seen)
    .map(([id]) => id);

  if (unseenIds.length === 0) {
    updateBadge(0);
    return;
  }

  let anyUpdated = false;

  // Send IDs in batches to stay within URL length limits
  for (let i = 0; i < unseenIds.length; i += BATCH_SIZE) {
    const batch = unseenIds.slice(i, i + BATCH_SIZE);
    try {
      const res  = await fetch(`${workerUrl}/status?ids=${batch.join(',')}`);
      if (!res.ok) continue;
      const data = await res.json();   // { [msgId]: { seenAt: <epoch ms> } | null }

      for (const [msgId, receipt] of Object.entries(data)) {
        if (receipt && receipt.seenAt && tracked[msgId]) {
          tracked[msgId].seen   = true;
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
    updateBadge(Object.values(tracked).filter(v => v.seen).length);
    notifyAllSlackTabs(tracked);
  }
}

// ─── Push updates to content scripts in open Slack tabs ───────────────────────
async function notifyAllSlackTabs(tracked) {
  const tabs = await chrome.tabs.query({ url: '*://*.slack.com/*' });
  for (const tab of tabs) {
    chrome.tabs.sendMessage(tab.id, { type: 'RECEIPTS_UPDATE', data: tracked })
      .catch(() => {});  // tab may not have content script ready
  }
}

// ─── Messages from content script ────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'TRACK_MSG') {
    // A new sent message was detected — trigger an early poll in 5 seconds
    // so we don't wait the full 30s for the first check
    setTimeout(pollForReceipts, 5000);
    sendResponse({ ok: true });
  }
  if (msg.type === 'GET_RECEIPTS') {
    chrome.storage.local.get(STORAGE_KEY_MSGS, (d) => {
      sendResponse(d[STORAGE_KEY_MSGS] || {});
    });
    return true;  // keep channel open for async response
  }
  if (msg.type === 'CLEAR_RECEIPTS') {
    chrome.storage.local.remove(STORAGE_KEY_MSGS);
    updateBadge(0);
    sendResponse({ ok: true });
  }
});

// ─── Badge ────────────────────────────────────────────────────────────────────
function updateBadge(unseenCount) {
  if (unseenCount > 0) {
    chrome.action.setBadgeText({ text: String(unseenCount) });
    chrome.action.setBadgeBackgroundColor({ color: '#4CAF50' });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}
