// content.js — isolated world; talks to page-inject.js via postMessage

const STORAGE_KEY_URL   = 'slacker_worker_url';
const STORAGE_KEY_MSGS  = 'slacker_messages';
const STORAGE_KEY_DEBUG = 'slacker_debug';
const DEFAULT_WORKER    = 'https://your-worker.workers.dev';
const PAGE_SOURCE       = 'slacker-page';

let workerUrl   = DEFAULT_WORKER;
let trackedMsgs = {};
let myUserId    = null;
let debug       = false;
let injectReady = false;
const pendingSends = [];

chrome.storage.local.get([STORAGE_KEY_URL, STORAGE_KEY_MSGS, STORAGE_KEY_DEBUG], (data) => {
  if (data[STORAGE_KEY_URL]) workerUrl = data[STORAGE_KEY_URL];
  if (data[STORAGE_KEY_MSGS]) trackedMsgs = data[STORAGE_KEY_MSGS];
  debug = !!data[STORAGE_KEY_DEBUG];
  init();
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'RECEIPTS_UPDATE') {
    Object.assign(trackedMsgs, msg.data);
    syncPillsToDOM();
  }
});

function log(...args) {
  if (debug) console.log('[Slacker]', ...args);
}

function warn(...args) {
  console.warn('[Slacker]', ...args);
}

function status() {
  const containers = document.querySelectorAll('[data-qa="message_container"]').length;
  return { myUserId, channelId: getChannelId(), containers, tracked: Object.keys(trackedMsgs).length, injectReady };
}

// ─── Page bridge (MAIN world inject) ─────────────────────────────────────────
window.addEventListener('message', (event) => {
  if (event.source !== window || !event.data || event.data.source !== PAGE_SOURCE) return;

  if (event.data.type === 'SLACKER_INJECT_READY') {
    injectReady = true;
    log('page inject ready');
  }

  if (event.data.type === 'SLACKER_BOOT' && event.data.userId) {
    if (!myUserId) {
      myUserId = event.data.userId;
      log('user id from page:', myUserId);
      scanAllMessages();
    }
  }

  if (event.data.type === 'SLACKER_SENT' && event.data.ts && event.data.channelId) {
    log('sent via API', event.data);
    trackByTs(event.data.channelId, event.data.ts);
  }
});

// ─── Init ────────────────────────────────────────────────────────────────────
function init() {
  waitForSlackBoot(() => {
    myUserId = myUserId || resolveMyUserId();
    startObserver();
    listenForSends();
    scanAllMessages();
    setInterval(scanAllMessages, 2000);
    setInterval(matchPendingSends, 1500);
    syncPillsToDOM();

    console.info('[Slacker] loaded', status());
    if (!injectReady) warn('Page inject not ready yet — reload Slack tab if tracking fails.');
    if (!myUserId) warn('User id unknown — send a message; API hook should still track it.');
    if (!getChannelId()) warn('Channel id unknown — open a channel/DM first.');
  });
}

function waitForSlackBoot(cb) {
  const check = () => {
    const ready =
      document.querySelector('[data-qa="message_input"]') ||
      document.querySelector('[data-qa="message_list"]') ||
      document.querySelector('[data-qa="message_container"]');
    if (ready) return cb();
    setTimeout(check, 400);
  };
  check();
}

function resolveMyUserId() {
  try {
    const cfg = localStorage.getItem('localConfig_v2');
    if (cfg) {
      const parsed = JSON.parse(cfg);
      for (const team of Object.values(parsed.teams || {})) {
        const id = team?.user?.id || team?.user_id;
        if (id && /^U[A-Z0-9]+$/i.test(id)) return id;
      }
    }
    const htmlMatch = document.documentElement.innerHTML.match(/"user_id"\s*:\s*"(U[A-Z0-9]+)"/);
    if (htmlMatch) return htmlMatch[1];
  } catch (_) {}
  return null;
}

// ─── Observer ────────────────────────────────────────────────────────────────
function startObserver() {
  const target =
    document.querySelector('[data-qa="message_list"]') ||
    document.querySelector('.p-workspace__primary_view') ||
    document.body;

  new MutationObserver(() => scanAllMessages()).observe(target, {
    childList: true,
    subtree: true,
  });
}

function listenForSends() {
  const capture = () => {
    const text = getComposerText();
    const channelId = getChannelId();
    if (!text) return;
    pendingSends.push({ text, channelId, at: Date.now() });
    if (pendingSends.length > 20) pendingSends.shift();
    log('pending send captured', text.slice(0, 40));
    setTimeout(matchPendingSends, 500);
    setTimeout(matchPendingSends, 1500);
    setTimeout(matchPendingSends, 3000);
  };

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    if (!e.target.closest?.('[data-qa="message_input"]')) return;
    capture();
  }, true);

  document.addEventListener('click', (e) => {
    const btn = e.target.closest?.('[data-qa="texty_send_button"], button[aria-label*="Send"]');
    if (btn) capture();
  }, true);
}

// ─── Scans ───────────────────────────────────────────────────────────────────
function scanAllMessages() {
  document.querySelectorAll('[data-qa="message_container"]').forEach((el) => {
    if (isOwnMessage(el)) registerMessage(el);
  });
  matchPendingSends();
}

function matchPendingSends() {
  const now = Date.now();
  const containers = [...document.querySelectorAll('[data-qa="message_container"]')];
  if (!containers.length) return;

  for (const pending of pendingSends) {
    if (now - pending.at > 60000) continue;

    for (let i = containers.length - 1; i >= Math.max(0, containers.length - 15); i--) {
      const el = containers[i];
      const text = getMessageText(el);
      if (!text || !pending.text) continue;
      if (text.trim() !== pending.text.trim() && !text.includes(pending.text)) continue;

      const channelId = pending.channelId || getChannelId();
      const ts = getMessageTs(el);
      if (channelId && ts) {
        trackByTs(channelId, ts, el);
        log('matched pending send by text', pending.text.slice(0, 30));
        break;
      }
      registerMessage(el, true);
      break;
    }
  }
}

function trackByTs(channelId, ts, messageEl) {
  const el = messageEl || findMessageByTs(ts);
  if (!el) {
    log('API sent but DOM node not found yet', ts);
    const msgId = buildMsgId(channelId, ts);
    if (!trackedMsgs[msgId]) {
      trackedMsgs[msgId] = { channelId, ts: String(ts), seen: false, seenAt: null, createdAt: Date.now() };
      persistTracked();
      chrome.runtime.sendMessage({ type: 'TRACK_MSG', msgId }).catch(() => {});
    }
    setTimeout(() => trackByTs(channelId, ts), 1000);
    return;
  }
  registerMessage(el, true);
}

function findMessageByTs(ts) {
  const norm = String(ts).replace('.', '');
  for (const el of document.querySelectorAll('[data-qa="message_container"]')) {
    const mts = getMessageTs(el);
    if (!mts) continue;
    if (mts === String(ts) || mts.replace('.', '') === norm) return el;
  }
  return null;
}

// ─── Message helpers ─────────────────────────────────────────────────────────
function isOwnMessage(messageEl) {
  const senderBtn = messageEl.querySelector('[data-qa="message_sender_name"], [data-message-sender]');
  if (senderBtn) {
    const label = (senderBtn.textContent || '').trim().toLowerCase();
    if (label === 'you' || label.includes('(you)')) return true;
    const sid = senderBtn.getAttribute('data-message-sender');
    if (sid) {
      if (!myUserId) myUserId = sid;
      if (myUserId && sid === myUserId) return true;
    }
  }

  const senderId = getSenderId(messageEl);
  if (senderId && myUserId && senderId === myUserId) return true;

  return false;
}

function getSenderId(messageEl) {
  const el =
    messageEl.querySelector('[data-message-sender]') ||
    messageEl.querySelector('button[data-message-sender]');
  if (el) return el.getAttribute('data-message-sender');

  const avatar = messageEl.querySelector('img[src*="slack-edge.com"]');
  if (avatar?.src) {
    const m = avatar.src.match(/-(U[A-Z0-9]+)-/i);
    if (m) return m[1];
  }
  return null;
}

function getMessageText(messageEl) {
  const textEl =
    messageEl.querySelector('[data-qa="message-text"]') ||
    messageEl.querySelector('.c-message__message_blocks') ||
    messageEl.querySelector('[data-qa="message_content"]');
  return (textEl?.innerText || textEl?.textContent || '').trim();
}

function getMessageTs(messageEl) {
  const tsEl = messageEl.querySelector('[data-ts]');
  if (tsEl) {
    const ts = tsEl.getAttribute('data-ts');
    if (ts) return String(ts);
  }
  const link = messageEl.querySelector('a[href*="/p"]');
  if (link?.href) {
    const m = link.href.match(/\/p(\d{10})(\d{6})/);
    if (m) return `${m[1]}.${m[2]}`;
  }
  return null;
}

function getChannelId() {
  const path = location.pathname;
  let m = path.match(/\/client\/[A-Z0-9]+\/([CDG][A-Z0-9]+)/i);
  if (m) return m[1];

  m = path.match(/\/archives\/([A-Z0-9]+)/i);
  if (m) return m[1];

  try {
    const cfg = localStorage.getItem('localConfig_v2');
    if (cfg) {
      const parsed = JSON.parse(cfg);
      for (const team of Object.values(parsed.teams || {})) {
        if (team?.activeChannel) return team.activeChannel;
      }
    }
  } catch (_) {}

  const active = document.querySelector('[data-qa="channel_sidebar_name"][data-channel-id]');
  if (active) return active.getAttribute('data-channel-id');

  return null;
}

function getComposerText() {
  const box =
    document.querySelector('[data-qa="message_input"] [contenteditable="true"]') ||
    document.querySelector('[data-qa="message_input"] [role="textbox"]');
  return (box?.innerText || box?.textContent || '').trim();
}

function buildMsgId(channelId, ts) {
  return `${channelId}_${String(ts).replace('.', '')}`;
}

// ─── Register / track ────────────────────────────────────────────────────────
function registerMessage(messageEl, force) {
  if (!force && !isOwnMessage(messageEl)) return;

  const ts = getMessageTs(messageEl);
  const channelId = getChannelId();
  if (!ts || !channelId) {
    log('register skip', { ts, channelId });
    return;
  }

  const msgId = buildMsgId(channelId, ts);
  if (!trackedMsgs[msgId]) {
    trackedMsgs[msgId] = { channelId, ts, seen: false, seenAt: null, createdAt: Date.now() };
    persistTracked();
    log('tracked', msgId);
    chrome.runtime.sendMessage({ type: 'TRACK_MSG', msgId }).catch(() => {});
  }

  injectPixel(messageEl, msgId);
  renderPill(messageEl, msgId);
  messageEl.setAttribute('data-slacker-tracked', msgId);
}

function injectPixel(messageEl, msgId) {
  if (!workerUrl || workerUrl.includes('your-worker')) return;
  if (messageEl.querySelector(`[data-slacker-id="${msgId}"]`)) return;

  const img = document.createElement('img');
  img.src = `${workerUrl.replace(/\/$/, '')}/pixel?id=${encodeURIComponent(msgId)}`;
  img.width = 1;
  img.height = 1;
  img.setAttribute('data-slacker-id', msgId);
  img.alt = '';
  img.style.cssText = 'width:1px;height:1px;opacity:0;position:absolute;pointer-events:none;';

  const host =
    messageEl.querySelector('[data-qa="message-text"]') ||
    messageEl.querySelector('.c-message_kit__blocks') ||
    messageEl;
  host.appendChild(img);
}

function renderPill(messageEl, msgId) {
  const data = trackedMsgs[msgId];
  if (!data) return;

  let pill = messageEl.querySelector('.slacker-pill');
  if (!pill) {
    pill = document.createElement('div');
    pill.className = 'slacker-pill slacker-pill--delivered';
    pill.style.cssText = 'display:inline-block;font-size:11px;margin-top:2px;padding:1px 6px;border-radius:8px;';
    const anchor =
      messageEl.querySelector('[data-qa="message-text"]') ||
      messageEl.querySelector('.c-message_kit__blocks') ||
      messageEl.querySelector('[data-qa="message_content"]') ||
      messageEl;
    (anchor.parentNode || messageEl).appendChild(pill);
  }

  if (data.seen && data.seenAt) {
    const time = new Date(data.seenAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    pill.textContent = `✓✓ Seen ${time}`;
    pill.style.background = '#e6f4ea';
    pill.style.color = '#2e7d32';
  } else {
    pill.textContent = '✓ Delivered';
    pill.style.background = '#f0f0f0';
    pill.style.color = '#888';
  }
}

function syncPillsToDOM() {
  for (const msgId of Object.keys(trackedMsgs)) {
    const el =
      document.querySelector(`[data-slacker-tracked="${msgId}"]`) ||
      document.querySelector(`[data-slacker-id="${msgId}"]`)?.closest('[data-qa="message_container"]') ||
      findMessageByTs(trackedMsgs[msgId].ts);
    if (el) {
      injectPixel(el, msgId);
      renderPill(el, msgId);
    }
  }
}

function persistTracked() {
  const entries = Object.entries(trackedMsgs)
    .sort((a, b) => (b[1].createdAt || 0) - (a[1].createdAt || 0))
    .slice(0, 500);
  trackedMsgs = Object.fromEntries(entries);
  chrome.storage.local.set({ [STORAGE_KEY_MSGS]: trackedMsgs });
}
