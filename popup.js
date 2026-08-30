// popup.js

const STORAGE_KEY_URL = 'slacker_worker_url';
const STORAGE_KEY_MSGS = 'slacker_messages';
const DEFAULT_WORKER = 'https://slacker.tzgold.workers.dev';

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
    savedMsg.textContent = 'Endpoint saved.';
    setTimeout(() => {
      savedMsg.textContent = '';
    }, 1800);
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
  live.classList.toggle('is-on', on);
  liveLabel.textContent = on ? 'Live' : 'Offline';
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
  return `${date} · ${time}`;
}

function channelLabel(msgId, data) {
  const channelId = data.channelId || String(msgId).split('_')[0] || '';
  const prefix = channelId.startsWith('D')
    ? 'DM'
    : channelId.startsWith('G')
      ? 'Group'
      : 'Channel';
  return `${prefix} · ${channelId.slice(0, 10)}`;
}

function previewText(data) {
  const t = (data.text || '').replace(/\s+/g, ' ').trim();
  if (!t) return 'Message sent';
  return t.length > 48 ? `${t.slice(0, 48)}…` : t;
}

function renderReceipts(tracked) {
  const entries = Object.entries(tracked).sort(
    (a, b) => (b[1].createdAt || 0) - (a[1].createdAt || 0)
  );

  const seenCount = entries.filter(([, v]) => v.seen).length;
  const deliveredCount = entries.length;

  countDelivered.textContent = String(deliveredCount);
  countSeen.textContent = String(seenCount);

  if (entries.length === 0) {
    receiptsList.innerHTML = `
      <div class="empty">
        <strong>No receipts yet</strong>
        <p>Send from Slack in Chrome. One check = sent. Two checks = they opened it with Slacker.</p>
      </div>`;
    stats.innerHTML = '<strong>Slacker</strong> · waiting for traffic';
    return;
  }

  stats.innerHTML = `<strong>${seenCount}</strong> seen of <strong>${deliveredCount}</strong>`;

  receiptsList.innerHTML = entries
    .slice(0, 40)
    .map(([msgId, data], i) => {
      const seen = !!(data.seen && data.seenAt);
      const when = seen
        ? formatWhen(data.seenAt)
        : data.createdAt
          ? formatWhen(data.createdAt)
          : '';
      const delay = Math.min(i * 28, 280);
      return `
        <article class="row" style="animation-delay:${delay}ms">
          <span class="mark ${seen ? 'is-seen' : ''}" aria-hidden="true"></span>
          <div class="row-main">
            <div class="row-title">${escapeHtml(previewText(data))}</div>
            <div class="row-meta">${escapeHtml(channelLabel(msgId, data))}${when ? ` · ${escapeHtml(when)}` : ''}</div>
          </div>
          <span class="stamp ${seen ? 'is-seen' : ''}">${seen ? 'Seen' : 'Sent'}</span>
        </article>`;
    })
    .join('');
}
