// content.js — runs inside every slack.com tab

const STORAGE_KEY_URL   = 'slacker_worker_url';
const STORAGE_KEY_MSGS  = 'slacker_messages';
const DEFAULT_WORKER    = 'https://your-worker.workers.dev';

// ─── State ────────────────────────────────────────────────────────────────────
let workerUrl   = DEFAULT_WORKER;
let trackedMsgs = {};   // msgId -> { channelId, ts, seen: bool, seenAt: null|number }
let myUserId    = null;
let observerActive = false;

// ─── Bootstrap ───────────────────────────────────────────────────────────────
chrome.storage.local.get([STORAGE_KEY_URL, STORAGE_KEY_MSGS], (data) => {
  if (data[STORAGE_KEY_URL]) workerUrl = data[STORAGE_KEY_URL];
  if (data[STORAGE_KEY_MSGS]) trackedMsgs = data[STORAGE_KEY_MSGS];
  init();
});

// Re-render pills whenever background pushes updated receipt data
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'RECEIPTS_UPDATE') {
    Object.assign(trackedMsgs, msg.data);
    syncPillsToDOM();
  }
});

// ─── Init ────────────────────────────────────────────────────────────────────
function init() {
  waitForSlackBoot(() => {
    myUserId = resolveMyUserId();
    startObserver();
    syncPillsToDOM();
  });
}

// Slack hydrates its React tree a few seconds after DOMContentLoaded
function waitForSlackBoot(cb) {
  const check = () => {
    const ready =
      document.querySelector('[data-qa="message_input"]') ||
      document.querySelector('.p-workspace__primary_view');
    if (ready) return cb();
    setTimeout(check, 500);
  };
  check();
}

// Pull our user ID from Slack's boot payload embedded in the page
function resolveMyUserId() {
  try {
    // Slack sets window.TS with team/user metadata after boot
    if (window.TS?.boot_data?.user_id) return window.TS.boot_data.user_id;
    // Fallback: read the data attribute on the main app wrapper
    const el = document.querySelector('#client_body[data-user-id]') ||
               document.querySelector('[data-current-user-id]');
    if (el) return el.dataset.userId || el.dataset.currentUserId;
  } catch (_) {}
  return null;
}

// ─── MutationObserver ────────────────────────────────────────────────────────
function startObserver() {
  if (observerActive) return;
  observerActive = true;

  // Watch the virtual scroll container where messages are rendered
  const target = document.querySelector('.p-workspace__primary_view') || document.body;

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        processNewNode(node);
      }
    }
  });

  observer.observe(target, { childList: true, subtree: true });
}

function processNewNode(root) {
  // Slack message containers — try multiple selectors for resilience
  const candidates = [
    ...root.querySelectorAll('[data-qa="message_container"]'),
    ...root.querySelectorAll('.c-message_kit__row'),
    ...(root.matches('[data-qa="message_container"]') ? [root] : []),
    ...(root.matches('.c-message_kit__row') ? [root] : []),
  ];

  for (const el of candidates) {
    maybeTrackMessage(el);
  }
}

function maybeTrackMessage(messageEl) {
  // Only track messages sent by the current user
  const senderId = getSenderId(messageEl);
  if (!senderId || senderId !== myUserId) return;

  const ts        = getMessageTs(messageEl);
  const channelId = getChannelId();
  if (!ts || !channelId) return;

  const msgId = buildMsgId(channelId, ts);
  if (trackedMsgs[msgId]) {
    // Already tracked — just make sure pill is rendered
    renderPill(messageEl, msgId);
    return;
  }

  // Register and persist
  trackedMsgs[msgId] = { channelId, ts, seen: false, seenAt: null, createdAt: Date.now() };
  persistTracked();

  injectPixel(messageEl, msgId);
  renderPill(messageEl, msgId);

  // Tell background about the new message so it can start polling
  chrome.runtime.sendMessage({ type: 'TRACK_MSG', msgId });
}

// ─── Helpers — DOM querying ───────────────────────────────────────────────────
function getSenderId(messageEl) {
  // Slack embeds sender ID in data attributes on the message row or its ancestor
  return messageEl.dataset.memberId ||
         messageEl.dataset.userId   ||
         messageEl.closest('[data-member-id]')?.dataset.memberId ||
         null;
}

function getMessageTs(messageEl) {
  // Timestamps live on <a class="c-timestamp"> or an ancestor with data-ts
  const tsEl = messageEl.querySelector('[data-ts]') ||
               messageEl.querySelector('.c-timestamp');
  if (tsEl) return tsEl.dataset.ts || tsEl.getAttribute('aria-label');

  // Fallback: extract from permalink href  /archives/C.../p<ts_no_dot>
  const link = messageEl.querySelector('a[href*="/archives/"]');
  if (link) {
    const m = link.href.match(/\/p(\d{10})(\d{6})/);
    if (m) return `${m[1]}.${m[2]}`;
  }
  return null;
}

function getChannelId() {
  // URL: slack.com/client/<teamId>/<channelId> or /archives/<channelId>
  const m = location.pathname.match(/\/(?:client\/[^/]+|archives)\/([A-Z0-9]+)/i);
  return m ? m[1] : null;
}

function buildMsgId(channelId, ts) {
  return `${channelId}_${String(ts).replace('.', '')}`;
}

// ─── Pixel injection ──────────────────────────────────────────────────────────
function injectPixel(messageEl, msgId) {
  if (messageEl.querySelector(`[data-slacker-id="${msgId}"]`)) return;
  const img = document.createElement('img');
  img.src    = `${workerUrl}/pixel?id=${encodeURIComponent(msgId)}`;
  img.width  = 1;
  img.height = 1;
  img.setAttribute('data-slacker-id', msgId);
  img.style.cssText = 'position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;top:0;left:0;';
  messageEl.style.position = 'relative';
  messageEl.appendChild(img);
}

// ─── Read-receipt pills ───────────────────────────────────────────────────────
function renderPill(messageEl, msgId) {
  const data = trackedMsgs[msgId];
  if (!data) return;

  let pill = messageEl.querySelector('.slacker-pill');
  if (!pill) {
    pill = document.createElement('span');
    pill.className = 'slacker-pill';
    // Insert after the message body, before any reactions row
    const body = messageEl.querySelector('.c-message_kit__blocks') ||
                 messageEl.querySelector('[data-qa="message-text"]') ||
                 messageEl;
    body.parentNode?.insertBefore(pill, body.nextSibling) ?? messageEl.appendChild(pill);
  }

  if (data.seen && data.seenAt) {
    const time = new Date(data.seenAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    pill.textContent = `✓✓ Seen ${time}`;
    pill.className   = 'slacker-pill slacker-pill--seen';
  } else {
    pill.textContent = '✓ Delivered';
    pill.className   = 'slacker-pill slacker-pill--delivered';
  }
}

// Walk all tracked messages and re-render their pills (called after receipt updates)
function syncPillsToDOM() {
  for (const [msgId, data] of Object.entries(trackedMsgs)) {
    if (!data.seen) continue;
    const pixelEl = document.querySelector(`[data-slacker-id="${msgId}"]`);
    if (!pixelEl) continue;
    const messageEl = pixelEl.closest('[data-qa="message_container"], .c-message_kit__row');
    if (messageEl) renderPill(messageEl, msgId);
  }
}

// ─── Persistence ─────────────────────────────────────────────────────────────
function persistTracked() {
  // Keep only the last 500 messages to avoid bloating storage
  const entries = Object.entries(trackedMsgs)
    .sort((a, b) => (b[1].createdAt || 0) - (a[1].createdAt || 0))
    .slice(0, 500);
  trackedMsgs = Object.fromEntries(entries);
  chrome.storage.local.set({ [STORAGE_KEY_MSGS]: trackedMsgs });
}
