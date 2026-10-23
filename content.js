// content.js
// Sent  = you sent it (this browser)
// Seen  = another Slacker user viewed that message (same channelId + ts)

const STORAGE_KEY_URL = 'slacker_worker_url';
const STORAGE_KEY_MSGS = 'slacker_messages';
const STORAGE_KEY_UID = 'slacker_user_id';
const STORAGE_KEY_DEBUG = 'slacker_debug_log';
const STORAGE_KEY_ENABLED = 'slacker_enabled';
const PAGE_SOURCE = 'slacker-page';
const DEFAULT_WORKER = 'https://slacker.tzgold.workers.dev';
const SESSION_START = Date.now();
const MSG_ID_RE = /^[CDG][A-Z0-9]{8,}_[0-9]{10,20}$/i;
const MSG_SELECTOR = [
  '[data-qa="message_container"]',
  '[data-qa="virtual-list-item"]',
  '.c-message_kit__message',
  '.c-virtual_list__item',
].join(',');

let workerUrl = DEFAULT_WORKER;
let trackedMsgs = {};
let myUserId = null;
let injectReady = false;
let enabled = true;
let dead = false;
const pendingSends = [];
const beaconed = new Set();
/** msgIds we sent from THIS browser — never beacon these locally */
const mySentIds = new Set();
let io = null;
let observer = null;
let pollTimer = null;

const TICK = `<svg class="slacker-ticks" viewBox="0 0 18 12" aria-hidden="true"><path d="M1.2 6.4l3 3L10.2 2"/><path class="slacker-tick-2" d="M7.2 6.4l3 3L16.2 2"/></svg>`;

function isContextError(err) {
  const msg = String(err?.message || err || '');
  return msg.includes('Extension context invalidated');
}

/** False after reload/disable — old content scripts must stop calling chrome.* */
function extAlive() {
  if (dead) return false;
  try {
    return !!(typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id);
  } catch (err) {
    if (isContextError(err)) killExtension();
    return false;
  }
}

function killExtension() {
  if (dead) return;
  dead = true;
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  try {
    io?.disconnect();
  } catch (_) {}
  try {
    observer?.disconnect();
  } catch (_) {}
}

// Swallow the common post-reload throw so chrome://extensions stays clean
window.addEventListener(
  'error',
  (event) => {
    if (isContextError(event.error) || isContextError(event.message)) {
      killExtension();
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  },
  true
);
window.addEventListener('unhandledrejection', (event) => {
  if (isContextError(event.reason)) {
    killExtension();
    event.preventDefault();
  }
});

function safeStorageGet(keys, cb) {
  if (dead) return;
  try {
    chrome.storage.local.get(keys, (data) => {
      if (dead) return;
      try {
        const err = chrome.runtime.lastError;
        if (err) {
          if (isContextError(err.message)) killExtension();
          return;
        }
        cb(data || {});
      } catch (_) {
        killExtension();
      }
    });
  } catch (_) {
    killExtension();
  }
}

function safeStorageSet(obj) {
  if (dead) return;
  try {
    chrome.storage.local.set(obj, () => {
      if (dead) return;
      try {
        const err = chrome.runtime.lastError;
        if (err && isContextError(err.message)) killExtension();
      } catch (_) {
        killExtension();
      }
    });
  } catch (_) {
    killExtension();
  }
}

/** Fire-and-forget messaging — callback only, never Promise.then */
function safeSendMessage(msg) {
  if (dead) return;
  try {
    chrome.runtime.sendMessage(msg, () => {
      // Must not throw: Chrome reports callback throws as extension errors
      try {
        if (dead) return;
        const err = chrome.runtime.lastError;
        if (!err) return;
        const m = String(err.message || '');
        if (
          m.includes('Extension context invalidated') ||
          m.includes('message port closed') ||
          m.includes('Receiving end does not exist')
        ) {
          killExtension();
        }
      } catch (_) {
        killExtension();
      }
    });
  } catch (_) {
    killExtension();
  }
}

function runAlive(fn) {
  if (dead) return;
  try {
    fn();
  } catch (err) {
    if (isContextError(err)) killExtension();
  }
}

safeStorageGet([STORAGE_KEY_MSGS, STORAGE_KEY_UID, STORAGE_KEY_ENABLED], (data) => {
  workerUrl = DEFAULT_WORKER;
  safeStorageSet({ [STORAGE_KEY_URL]: DEFAULT_WORKER });
  enabled = data[STORAGE_KEY_ENABLED] !== false;
  if (data[STORAGE_KEY_MSGS]) {
    trackedMsgs = data[STORAGE_KEY_MSGS];
    Object.keys(trackedMsgs).forEach((id) => mySentIds.add(id));
  }
  if (data[STORAGE_KEY_UID]) myUserId = data[STORAGE_KEY_UID];
  init();
});

try {
  chrome.storage.onChanged.addListener((changes) => {
    if (!extAlive()) return;
    if (changes[STORAGE_KEY_URL]?.newValue) {
      workerUrl = String(changes[STORAGE_KEY_URL].newValue).replace(/\/$/, '');
    }
    if (changes[STORAGE_KEY_MSGS]?.newValue) {
      trackedMsgs = changes[STORAGE_KEY_MSGS].newValue;
      syncPillsToDOM();
    }
    if (changes[STORAGE_KEY_ENABLED]) {
      enabled = changes[STORAGE_KEY_ENABLED].newValue !== false;
      info(enabled ? 'resumed' : 'paused');
    }
  });
} catch (_) {
  killExtension();
}

try {
  const receiptPort = chrome.runtime.connect({ name: 'slack-page' });
  receiptPort.onMessage.addListener((msg) => {
    if (!extAlive()) return;
    if (msg.type === 'RECEIPTS_UPDATE') {
      Object.assign(trackedMsgs, msg.data);
      syncPillsToDOM();
    }
    if (msg.type === 'POLL_RECEIPTS') {
      pollReceiptsFromWorker();
    }
  });
} catch (_) {
  killExtension();
}

function info(...args) {
  console.info('[Slacker]', ...args);
}

function debugEvent(event, extra = {}) {
  if (!extAlive()) return;
  const entry = { event, at: Date.now(), ...extra };
  safeStorageGet(STORAGE_KEY_DEBUG, (data) => {
    const list = Array.isArray(data[STORAGE_KEY_DEBUG]) ? data[STORAGE_KEY_DEBUG] : [];
    list.unshift(entry);
    safeStorageSet({ [STORAGE_KEY_DEBUG]: list.slice(0, 30) });
  });
  info(event, extra);
}

function persistUserId(id) {
  if (!id || myUserId === id) return;
  myUserId = id;
  safeStorageSet({ [STORAGE_KEY_UID]: id });
  info('user id =', id);
}

window.addEventListener('message', (event) => {
  if (event.source !== window || !event.data || event.data.source !== PAGE_SOURCE) return;
  runAlive(() => {
    const { type } = event.data;

    if (type === 'SLACKER_INJECT_READY') {
      injectReady = true;
      info('inject ready');
    }

    if (type === 'SLACKER_BOOT' && event.data.userId) {
      persistUserId(event.data.userId);
      scanOwnMessages();
    }

    if (type === 'SLACKER_SENT' && event.data.ts && event.data.channelId) {
      info('API send', event.data.channelId, event.data.ts);
      trackSent(event.data.channelId, event.data.ts, event.data.text || '');
    }
  });
});

function init() {
  waitForSlackBoot(() => {
    if (!extAlive()) return;
    startObserver();
    listenForSends();
    setupViewportBeacons();
    scanOwnMessages();
    beaconVisibleOthers();
    pollTimer = setInterval(() => {
      runAlive(() => {
        scanOwnMessages();
        beaconVisibleOthers();
      });
    }, 2000);
    syncPillsToDOM();
    let containerCount = 0;
    eachMessageEl(() => {
      containerCount += 1;
    });
    debugEvent('loaded', {
      myUserId,
      channelId: getChannelIdFromUrl(),
      containers: containerCount,
      tracked: Object.keys(trackedMsgs).length,
      injectReady,
      workerUrl,
      path: location.pathname,
    });
  });
}

function waitForSlackBoot(cb) {
  const check = () => {
    if (!extAlive()) return;
    if (
      document.querySelector('[data-qa="message_input"]') ||
      document.querySelector('[data-qa="message_container"]')
    ) {
      return cb();
    }
    setTimeout(check, 400);
  };
  check();
}

function startObserver() {
  const target =
    document.querySelector('[data-qa="message_list"]') ||
    document.querySelector('.p-workspace__primary_view') ||
    document.body;
  observer = new MutationObserver(() => {
    runAlive(() => {
      scanOwnMessages();
      observeNewMessagesForBeacons();
      beaconVisibleOthers();
    });
  });
  observer.observe(target, { childList: true, subtree: true });
}

function listenForSends() {
  const capture = () => {
    const text = getComposerText();
    const channelId = getChannelIdFromUrl();
    if (!text) return;
    pendingSends.push({ text, channelId, at: Date.now() });
    if (pendingSends.length > 25) pendingSends.shift();
    setTimeout(matchPendingSends, 350);
    setTimeout(matchPendingSends, 1000);
    setTimeout(matchPendingSends, 2400);
  };

  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Enter' || e.shiftKey) return;
      if (!e.target.closest?.('[data-qa="message_input"]')) return;
      capture();
    },
    true
  );

  document.addEventListener(
    'click',
    (e) => {
      if (e.target.closest?.('[data-qa="texty_send_button"], button[aria-label*="Send"]')) {
        capture();
      }
    },
    true
  );
}

function trackSent(channelId, ts, text) {
  if (!enabled || dead) return;
  if (!channelId || !ts) return;
  const msgId = buildMsgId(channelId, ts);
  if (!isValidMsgId(msgId)) return;
  mySentIds.add(msgId);
  if (!trackedMsgs[msgId]) {
    trackedMsgs[msgId] = {
      channelId,
      ts: String(ts),
      text: (text || '').slice(0, 120),
      seen: false,
      seenAt: null,
      createdAt: Date.now(),
    };
    persistTracked();
    debugEvent('tracked', { msgId, channelId, ts });
    safeSendMessage({ type: 'TRACK_MSG', msgId });
  }

  const tryAttach = () => {
    const el = findMessageByTs(ts) || findMessageByText(text);
    if (el && isOwnMessage(el)) attachPill(el, msgId);
  };
  tryAttach();
  setTimeout(tryAttach, 600);
  setTimeout(tryAttach, 1600);
}

function slackTsMillis(ts) {
  const n = parseFloat(String(ts));
  if (!n) return 0;
  return Math.floor(n * 1000);
}

function isRecentEnoughToTrack(ts) {
  const ms = slackTsMillis(ts);
  if (!ms) return false;
  // Own messages from this session or last 6 hours (so pills persist after reload)
  return Date.now() - ms < 6 * 60 * 60 * 1000 || ms >= SESSION_START - 60000;
}

function eachMessageEl(fn) {
  const seen = new Set();
  document.querySelectorAll(MSG_SELECTOR).forEach((el) => {
    const container = el.matches('[data-qa="message_container"]')
      ? el
      : el.querySelector?.('[data-qa="message_container"]') || el;
    if (!container || seen.has(container)) return;
    seen.add(container);
    fn(container);
  });
}

function scanOwnMessages() {
  if (dead || !enabled) return;
  eachMessageEl((el) => {
    if (!isOwnMessage(el)) return;
    const ts = getMessageTs(el);
    const channelId = getChannelIdForMessage(el);
    if (!ts || !channelId) {
      info('skip own message — missing ts/channel', { ts, channelId, path: location.pathname });
      return;
    }
    const msgId = buildMsgId(channelId, ts);
    if (trackedMsgs[msgId]) {
      attachPill(el, msgId);
      return;
    }
    if (isRecentEnoughToTrack(ts)) {
      trackSent(channelId, ts, getMessageText(el));
    }
  });
  matchPendingSends();
  observeNewMessagesForBeacons();
}

function matchPendingSends() {
  const now = Date.now();
  const containers = [];
  eachMessageEl((el) => containers.push(el));
  if (!containers.length) return;

  for (const pending of pendingSends) {
    if (now - pending.at > 45000) continue;
    for (let i = containers.length - 1; i >= Math.max(0, containers.length - 20); i--) {
      const el = containers[i];
      const text = getMessageText(el);
      if (!text || !pending.text) continue;
      if (text.trim() !== pending.text.trim() && !text.includes(pending.text)) continue;

      const ts = getMessageTs(el);
      const channelId = getChannelIdForMessage(el) || pending.channelId || getChannelIdFromUrl();
      if (!ts || !channelId) continue;

      if (isOwnMessage(el) || !myUserId) {
        if (!myUserId) {
          const sid = getSenderId(el);
          if (sid) persistUserId(sid);
        }
        if (isOwnMessage(el) || !myUserId) {
          trackSent(channelId, ts, text);
        }
      }
      break;
    }
  }
}

function setupViewportBeacons() {
  io = new IntersectionObserver(
    (entries) => {
      runAlive(() => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          maybeBeacon(entry.target);
        }
      });
    },
    { threshold: 0.15, rootMargin: '40px' }
  );
  observeNewMessagesForBeacons();
}

function observeNewMessagesForBeacons() {
  if (!io) return;
  eachMessageEl((el) => {
    if (el.dataset.slackerIo) return;
    el.dataset.slackerIo = '1';
    io.observe(el);
  });
}

function beaconVisibleOthers() {
  eachMessageEl((el) => {
    const rect = el.getBoundingClientRect();
    if (rect.height < 4) return;
    if (rect.bottom < 0 || rect.top > window.innerHeight) return;
    maybeBeacon(el);
  });
}

function matchesRecentPendingSend(messageEl) {
  const text = getMessageText(messageEl);
  if (!text) return false;
  const now = Date.now();
  return pendingSends.some((p) => {
    if (now - p.at > 20000) return false;
    return text.trim() === p.text.trim() || text.includes(p.text) || p.text.includes(text);
  });
}

function maybeBeacon(messageEl) {
  if (dead || !enabled) return;
  // Never report Seen for our own messages
  if (isOwnMessage(messageEl)) return;
  if (matchesRecentPendingSend(messageEl)) return;

  const senderId = getSenderId(messageEl);
  if (myUserId && senderId && senderId === myUserId) return;

  // Need either our user id OR a clear other-person sender id
  if (!myUserId && !senderId) return;

  const ts = getMessageTs(messageEl);
  // Prefer channel from the message permalink so both accounts share the same id
  const channelId = getChannelIdForMessage(messageEl);
  if (!ts || !channelId) {
    info('beacon skip — missing ts/channel', { ts, channelId, path: location.pathname });
    return;
  }

  const msgId = buildMsgId(channelId, ts);
  if (mySentIds.has(msgId) || trackedMsgs[msgId]) return;

  fireBeacon(msgId);
}

function fireBeacon(msgId) {
  // Hot path: only check `dead` — never chrome.runtime.id (throws after reload)
  if (!enabled || dead) return;
  if (!isValidMsgId(msgId)) return;
  if (beaconed.has(msgId)) return;
  beaconed.add(msgId);

  // Route through background — avoids Slack page CSP blocking fetch.
  fetch(`${workerUrl}/pixel?id=${encodeURIComponent(msgId)}`, {
    method: 'GET',
    cache: 'no-store',
    credentials: 'omit',
  }).catch(() => {
    // Retry after a temporary network failure when this message is scanned again.
    beaconed.delete(msgId);
  });
}

async function pollReceiptsFromWorker() {
  if (!enabled || dead) return;
  const unseenIds = Object.entries(trackedMsgs)
    .filter(([id, value]) => !value.seen && isValidMsgId(id))
    .map(([id]) => id);
  if (!unseenIds.length) return;

  let changed = false;
  for (let i = 0; i < unseenIds.length; i += 40) {
    const url = new URL(`${workerUrl}/status`);
    url.searchParams.set('ids', unseenIds.slice(i, i + 40).join(','));
    try {
      const res = await fetch(url, { cache: 'no-store', credentials: 'omit' });
      if (!res.ok) continue;
      const receipts = await res.json();
      for (const [msgId, receipt] of Object.entries(receipts)) {
        if (receipt?.seenAt && trackedMsgs[msgId]) {
          trackedMsgs[msgId].seen = true;
          trackedMsgs[msgId].seenAt = receipt.seenAt;
          changed = true;
        }
      }
    } catch (_) {}
  }

  if (changed) {
    persistTracked();
    syncPillsToDOM();
  }
}

function isOwnMessage(messageEl) {
  const senderBtn = messageEl.querySelector(
    '[data-qa="message_sender_name"], [data-message-sender]'
  );
  if (senderBtn) {
    const label = (senderBtn.textContent || '').trim().toLowerCase();
    if (label === 'you' || label.includes('(you)')) {
      const sid = senderBtn.getAttribute('data-message-sender') || getSenderId(messageEl);
      if (sid) persistUserId(sid);
      return true;
    }
  }

  let senderId = getSenderId(messageEl);
  if (!senderId) {
    let prev = messageEl.previousElementSibling;
    for (let i = 0; i < 10 && prev; i++) {
      const container = prev.matches?.('[data-qa="message_container"]')
        ? prev
        : prev.querySelector?.('[data-qa="message_container"]');
      if (container) {
        senderId = getSenderId(container);
        if (senderId) break;
      }
      prev = prev.previousElementSibling;
    }
  }

  return !!(senderId && myUserId && senderId === myUserId);
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
    messageEl.querySelector('.c-message_kit__blocks') ||
    messageEl.querySelector('[data-qa="message_content"]');
  if (!textEl) return '';
  const clone = textEl.cloneNode(true);
  clone.querySelectorAll('.slacker-pill, .slacker-checks').forEach((n) => n.remove());
  return (clone.innerText || clone.textContent || '').trim();
}

function getMessageTs(messageEl) {
  const tsEl = messageEl.querySelector('[data-ts]');
  if (tsEl?.getAttribute('data-ts')) return String(tsEl.getAttribute('data-ts'));

  const link = messageEl.querySelector('a[href*="/archives/"], a[href*="/p"]');
  if (link?.href) {
    const m = link.href.match(/\/p(\d{10})(\d{6})/);
    if (m) return `${m[1]}.${m[2]}`;
  }
  return null;
}

/** Channel id from the message permalink — same for both people in a DM */
function getChannelIdFromMessage(messageEl) {
  if (!messageEl) return null;
  const links = messageEl.querySelectorAll('a[href*="/archives/"], a[href*="/p"]');
  for (const link of links) {
    const href = link.href || '';
    const m = href.match(/\/archives\/([CDG][A-Z0-9]+)/i);
    if (m) return m[1];
  }
  return null;
}

function getChannelIdFromUrl() {
  const path = `${location.pathname}${location.hash}${location.search}`;
  const patterns = [
    /\/client\/[A-Z0-9]+\/([CDG][A-Z0-9]+)/i,
    /\/archives\/([CDG][A-Z0-9]+)/i,
    /\/messages\/([CDG][A-Z0-9]+)/i,
  ];
  for (const re of patterns) {
    const m = path.match(re);
    if (m) return m[1];
  }

  const el =
    document.querySelector('[data-qa-channel-id]') ||
    document.querySelector('[data-channel-id]') ||
    document.querySelector('[data-qa="channel_sidebar_name"][data-channel-id]');
  if (el) {
    return (
      el.getAttribute('data-qa-channel-id') ||
      el.getAttribute('data-channel-id') ||
      null
    );
  }
  return null;
}

function getChannelIdForMessage(messageEl) {
  return getChannelIdFromMessage(messageEl) || getChannelIdFromUrl();
}

/** @deprecated use getChannelIdFromUrl / getChannelIdForMessage */
function getChannelId() {
  return getChannelIdFromUrl();
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

function isValidMsgId(id) {
  return typeof id === 'string' && id.length <= 80 && MSG_ID_RE.test(id);
}

function findMessageByTs(ts) {
  const norm = String(ts).replace('.', '');
  let found = null;
  eachMessageEl((el) => {
    if (found) return;
    const mts = getMessageTs(el);
    if (!mts) return;
    if (mts === String(ts) || mts.replace('.', '') === norm) found = el;
  });
  return found;
}

function findMessageByText(text) {
  if (!text) return null;
  const containers = [];
  eachMessageEl((el) => containers.push(el));
  for (let i = containers.length - 1; i >= Math.max(0, containers.length - 12); i--) {
    const t = getMessageText(containers[i]);
    if (t && (t.trim() === text.trim() || t.includes(text))) return containers[i];
  }
  return null;
}

function attachPill(messageEl, msgId) {
  if (!isOwnMessage(messageEl) && !messageEl.querySelector('.slacker-checks')) {
    // Only show checks on messages we sent
    if (!trackedMsgs[msgId]) return;
  }
  messageEl.setAttribute('data-slacker-tracked', msgId);
  renderPill(messageEl, msgId);
}

function renderPill(messageEl, msgId) {
  const data = trackedMsgs[msgId];
  if (!data) return;

  let wrap = messageEl.querySelector('.slacker-checks');
  if (!wrap) {
    wrap = document.createElement('span');
    wrap.className = 'slacker-checks';
    wrap.innerHTML = TICK;
    const anchor =
      messageEl.querySelector('[data-qa="timestamp_label"]') ||
      messageEl.querySelector('.c-timestamp') ||
      messageEl.querySelector('[data-qa="message-text"]') ||
      messageEl.querySelector('.c-message_kit__blocks') ||
      messageEl;
    if (anchor.parentNode && anchor !== messageEl) {
      anchor.parentNode.insertBefore(wrap, anchor.nextSibling);
    } else {
      messageEl.appendChild(wrap);
    }
  }

  const seen = !!(data.seen && data.seenAt);
  wrap.classList.toggle('is-seen', seen);
  wrap.classList.toggle('is-sent', !seen);

  if (seen) {
    const time = new Date(data.seenAt).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
    wrap.title = `Seen ${time}`;
  } else {
    wrap.title = 'Sent — waiting for them to open this in Slack with Slacker';
  }
}

function syncPillsToDOM() {
  for (const [msgId, data] of Object.entries(trackedMsgs)) {
    if (!isValidMsgId(msgId)) continue;
    const safeId = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(msgId) : msgId;
    const el =
      document.querySelector(`[data-slacker-tracked="${safeId}"]`) || findMessageByTs(data.ts);
    if (el) attachPill(el, msgId);
  }
}

function persistTracked() {
  const entries = Object.entries(trackedMsgs)
    .sort((a, b) => (b[1].createdAt || 0) - (a[1].createdAt || 0))
    .slice(0, 500);
  trackedMsgs = Object.fromEntries(entries);
  safeStorageSet({ [STORAGE_KEY_MSGS]: trackedMsgs });
}
