// popup.js

const STORAGE_KEY_URL = 'slacker_worker_url';
const STORAGE_KEY_MSGS = 'slacker_messages';
const DEFAULT_WORKER = 'https://slacker.tzgold.workers.dev';

const TICKS = {
  sent: `<svg class="ticks ticks--sent" viewBox="0 0 18 12" aria-hidden="true"><path d="M1.2 6.4l3 3L10.2 2"/><path class="tick-2" d="M7.2 6.4l3 3L16.2 2"/></svg>`,
  seen: `<svg class="ticks ticks--seen" viewBox="0 0 18 12" aria-hidden="true"><path d="M1.2 6.4l3 3L10.2 2"/><path class="tick-2" d="M7.2 6.4l3 3L16.2 2"/></svg>`,
};

const workerInput = document.getElementById('worker-url');
const saveBtn = document.getElementById('save-btn');
const savedMsg = document.getElementById('saved-msg');
const clearBtn = document.getElementById('clear-btn');
const receiptsList = document.getElementById('receipts-list');
const live = document.getElementById('live');
const liveLabel = document.getElementById('live-label');
const stats = document.getElementById('stats');
const countDelivered = document.getElementById('count-delivered');
const countSeen = document.getElementById('count-seen');

chrome.storage.local.get([STORAGE_KEY_URL, STORAGE_KEY_MSGS], (data) => {
  const url = data[STORAGE_KEY_URL] || DEFAULT_WORKER;
  workerInput.value = url;
  if (!data[STORAGE_KEY_URL]) {
    chrome.storage.local.set({ [STORAGE_KEY_URL]: DEFAULT_WORKER });
  }
  testConnection(url);
  renderReceipts(data[STORAGE_KEY_MSGS] || {});
});

saveBtn.addEventListener('click', () => {
  const url = workerInput.value.trim().replace(/\/$/, '');
  if (!url) return;
  chrome.storage.local.set({ [STORAGE_KEY_URL]: url }, () => {
    savedMsg.textContent = 'Saved successfully';
    setTimeout(() => {
      savedMsg.textContent = '';
    }, 2000);
    testConnection(url);
  });
});

workerInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') saveBtn.click();
});

clearBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'CLEAR_RECEIPTS' }, () => {
    renderReceipts({});
  });
});

async function testConnection(url) {
  try {
    const res = await fetch(`${url}/ping`, { signal: AbortSignal.timeout(4000) });
    setLive(res.ok);
  } catch {
    setLive(false);
  }
}

function setLive(on) {
  live.classList.toggle('is-live', on);
  liveLabel.textContent = on ? 'Connected' : 'Offline';
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
  const entries = Object.entries(tracked).sort(
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
