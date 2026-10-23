// popup.js — Worker URL is built-in; users never configure it

const STORAGE_KEY_URL = 'slacker_worker_url';
const STORAGE_KEY_MSGS = 'slacker_messages';
const STORAGE_KEY_ENABLED = 'slacker_enabled';
const DEFAULT_WORKER = 'https://slacker.tzgold.workers.dev';

const TICKS = {
  sent: `<svg class="ticks ticks--sent" viewBox="0 0 18 12" aria-hidden="true"><path d="M1.2 6.4l3 3L10.2 2"/><path class="tick-2" d="M7.2 6.4l3 3L16.2 2"/></svg>`,
  seen: `<svg class="ticks ticks--seen" viewBox="0 0 18 12" aria-hidden="true"><path d="M1.2 6.4l3 3L10.2 2"/><path class="tick-2" d="M7.2 6.4l3 3L16.2 2"/></svg>`,
};

const clearBtn = document.getElementById('clear-btn');
const pollBtn = document.getElementById('poll-btn');
const receiptsList = document.getElementById('receipts-list');
const live = document.getElementById('live');
const liveLabel = document.getElementById('live-label');
const stats = document.getElementById('stats');
const countDelivered = document.getElementById('count-delivered');
const countSeen = document.getElementById('count-seen');
const powerToggle = document.getElementById('power-toggle');
const powerLabel = document.getElementById('power-label');
const powerHint = document.getElementById('power-hint');

function setPowerUi(on) {
  powerToggle.checked = on;
  powerLabel.textContent = on ? 'Slacker is on' : 'Slacker is paused';
  powerHint.textContent = on
    ? 'Tracking sends and Seen pings'
    : 'No tracking, no Seen pings until you turn it back on';
  document.body.classList.toggle('is-paused', !on);
  pollBtn.disabled = !on;
  setLive(false, on ? 'Checking…' : 'Paused');
}

powerToggle.addEventListener('change', () => {
  const on = powerToggle.checked;
  chrome.storage.local.set({ [STORAGE_KEY_ENABLED]: on });
  setPowerUi(on);
  if (on) testConnection(DEFAULT_WORKER);
});

chrome.storage.local.set({ [STORAGE_KEY_URL]: DEFAULT_WORKER });
chrome.storage.local.get([STORAGE_KEY_MSGS, STORAGE_KEY_ENABLED], (data) => {
  const on = data[STORAGE_KEY_ENABLED] !== false;
  setPowerUi(on);
  if (on) testConnection(DEFAULT_WORKER);
  renderReceipts(data[STORAGE_KEY_MSGS] || {});
});

clearBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'CLEAR_RECEIPTS' }, () => {
    renderReceipts({});
  });
});

pollBtn.addEventListener('click', () => {
  pollBtn.textContent = 'Checking…';
  chrome.runtime.sendMessage({ type: 'FORCE_POLL' }, () => {
    chrome.storage.local.get(STORAGE_KEY_MSGS, (data) => {
      renderReceipts(data[STORAGE_KEY_MSGS] || {});
      pollBtn.textContent = 'Check now';
    });
  });
});

async function testConnection(url) {
  try {
    const res = await fetch(`${url}/ping`, { signal: AbortSignal.timeout(4000) });
    setLive(powerToggle.checked && res.ok, powerToggle.checked ? undefined : 'Paused');
  } catch {
    setLive(false, powerToggle.checked ? 'Offline' : 'Paused');
  }
}

function setLive(on, label = on ? 'Connected' : 'Offline') {
  live.classList.toggle('is-live', on);
  liveLabel.textContent = label;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatWhen(ts) {
  const d = new Date(ts);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return time;
  const date = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return `${date}, ${time}`;
}

function channelLabel(msgId, data) {
  const channelId = data.channelId || String(msgId).split('_')[0] || '';
  if (channelId.startsWith('D')) return 'Direct message';
  if (channelId.startsWith('G')) return 'Group message';
  return 'Channel message';
}

function previewText(data) {
  const t = (data.text || '').replace(/\s+/g, ' ').trim();
  if (!t) return 'Message sent';
  return t.length > 52 ? `${t.slice(0, 52)}…` : t;
}

function renderReceipts(tracked) {
  const entries = Object.entries(tracked || {}).sort(
    (a, b) => (b[1].createdAt || 0) - (a[1].createdAt || 0)
  );

  const seenCount = entries.filter(([, v]) => v.seen).length;
  const sentCount = entries.length;

  countDelivered.textContent = String(sentCount);
  countSeen.textContent = String(seenCount);

  if (entries.length === 0) {
    receiptsList.innerHTML = `
      <div class="empty">
        <div class="empty-icon">${TICKS.sent}</div>
        <h3>No messages yet</h3>
        <p>Send a message in Slack. Receipts appear here automatically.</p>
      </div>`;
    stats.textContent = 'No activity yet';
    return;
  }

  stats.innerHTML = `<strong>${seenCount}</strong> of ${sentCount} seen`;

  receiptsList.innerHTML = entries
    .slice(0, 50)
    .map(([msgId, data]) => {
      const seen = !!(data.seen && data.seenAt);
      const when = seen
        ? formatWhen(data.seenAt)
        : data.createdAt
          ? formatWhen(data.createdAt)
          : '';

      return `
        <article class="item">
          <div class="item-icon">${seen ? TICKS.seen : TICKS.sent}</div>
          <div class="item-body">
            <div class="item-text">${escapeHtml(previewText(data))}</div>
            <div class="item-meta">${escapeHtml(channelLabel(msgId, data))}${when ? ` · ${escapeHtml(when)}` : ''}</div>
          </div>
          <span class="badge ${seen ? 'badge--seen' : 'badge--sent'}">${seen ? 'Seen' : 'Sent'}</span>
        </article>`;
    })
    .join('');
}
