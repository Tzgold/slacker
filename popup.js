// popup.js

const STORAGE_KEY_URL  = 'slacker_worker_url';
const STORAGE_KEY_MSGS = 'slacker_messages';

const workerInput  = document.getElementById('worker-url');
const saveBtn      = document.getElementById('save-btn');
const savedMsg     = document.getElementById('saved-msg');
const clearBtn     = document.getElementById('clear-btn');
const receiptsList = document.getElementById('receipts-list');
const dot          = document.getElementById('connection-dot');
const stats        = document.getElementById('stats');

// ─── Load saved URL ───────────────────────────────────────────────────────────
chrome.storage.local.get([STORAGE_KEY_URL, STORAGE_KEY_MSGS], (data) => {
  if (data[STORAGE_KEY_URL]) {
    workerInput.value = data[STORAGE_KEY_URL];
    testConnection(data[STORAGE_KEY_URL]);
  }
  renderReceipts(data[STORAGE_KEY_MSGS] || {});
});

// ─── Save URL ─────────────────────────────────────────────────────────────────
saveBtn.addEventListener('click', () => {
  const url = workerInput.value.trim().replace(/\/$/, '');
  if (!url) return;
  chrome.storage.local.set({ [STORAGE_KEY_URL]: url }, () => {
    savedMsg.textContent = 'Saved!';
    setTimeout(() => (savedMsg.textContent = ''), 2000);
    testConnection(url);
  });
});

// ─── Clear receipts ───────────────────────────────────────────────────────────
clearBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'CLEAR_RECEIPTS' }, () => {
    renderReceipts({});
  });
});

// ─── Connection test ──────────────────────────────────────────────────────────
async function testConnection(url) {
  try {
    const res = await fetch(`${url}/ping`, { signal: AbortSignal.timeout(4000) });
    dot.classList.toggle('connected', res.ok);
  } catch {
    dot.classList.remove('connected');
  }
}

// ─── Render receipts ──────────────────────────────────────────────────────────
function renderReceipts(tracked) {
  const entries = Object.entries(tracked)
    .sort((a, b) => (b[1].createdAt || 0) - (a[1].createdAt || 0));

  if (entries.length === 0) {
    receiptsList.innerHTML =
      '<div class="empty">No messages tracked yet.<br>Send a Slack message to start.</div>';
    stats.textContent = '';
    return;
  }

  const seenCount = entries.filter(([, v]) => v.seen).length;
  stats.textContent = `${seenCount} seen / ${entries.length} tracked`;

  receiptsList.innerHTML = entries.map(([msgId, data]) => {
    const [channelId] = msgId.split('_');
    const shortId = `#${channelId.slice(0, 8)}…`;

    let statusHtml, timeHtml;
    if (data.seen && data.seenAt) {
      const d    = new Date(data.seenAt);
      const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const date = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
      statusHtml = '<span class="receipt-status">✓✓ Seen</span>';
      timeHtml   = `<span class="receipt-time">${date} ${time}</span>`;
    } else {
      statusHtml = '<span class="receipt-status" style="color:#888">✓ Delivered</span>';
      timeHtml   = '';
    }

    const dotClass = data.seen ? 'seen' : 'delivered';

    return `
      <div class="receipt-item">
        <div class="status-dot ${dotClass}"></div>
        <div class="receipt-info">
          <div class="receipt-id">${shortId}</div>
          ${statusHtml}
        </div>
        ${timeHtml}
      </div>`;
  }).join('');
}
