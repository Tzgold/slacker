// content.js
// Sent  = you sent it (this browser)
// Seen  = another Slacker user viewed that message (same channelId + ts)

const STORAGE_KEY_URL = 'slacker_worker_url';
const STORAGE_KEY_MSGS = 'slacker_messages';
const STORAGE_KEY_UID = 'slacker_user_id';
const PAGE_SOURCE = 'slacker-page';
const DEFAULT_WORKER = 'https://slacker.tzgold.workers.dev';
const SESSION_START = Date.now();

let workerUrl = DEFAULT_WORKER;
let trackedMsgs = {};
let myUserId = null;
let injectReady = false;
const pendingSends = [];
const beaconed = new Set();
let io = null;

const TICK = `<svg class="slacker-ticks" viewBox="0 0 18 12" aria-hidden="true"><path d="M1.2 6.4l3 3L10.2 2"/><path class="slacker-tick-2" d="M7.2 6.4l3 3L16.2 2"/></svg>`;

chrome.storage.local.get([STORAGE_KEY_URL, STORAGE_KEY_MSGS, STORAGE_KEY_UID], (data) => {
  if (data[STORAGE_KEY_URL]) workerUrl = data[STORAGE_KEY_URL].replace(/\/$/, '');
  else chrome.storage.local.set({ [STORAGE_KEY_URL]: DEFAULT_WORKER });
  if (data[STORAGE_KEY_MSGS]) trackedMsgs = data[STORAGE_KEY_MSGS];
  if (data[STORAGE_KEY_UID]) myUserId = data[STORAGE_KEY_UID];
  init();
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes[STORAGE_KEY_URL]?.newValue) {
    workerUrl = String(changes[STORAGE_KEY_URL].newValue).replace(/\/$/, '');
  }
  if (changes[STORAGE_KEY_MSGS]?.newValue) {
    trackedMsgs = changes[STORAGE_KEY_MSGS].newValue;
    syncPillsToDOM();
  }
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'RECEIPTS_UPDATE') {
    Object.assign(trackedMsgs, msg.data);
    syncPillsToDOM();
  }
});

function info(...args) {
  console.info('[Slacker]', ...args);
}

function persistUserId(id) {
  if (!id || myUserId === id) return;
  myUserId = id;
  chrome.storage.local.set({ [STORAGE_KEY_UID]: id });
  info('user id =', id);
}

window.addEventListener('message', (event) => {
  if (event.source !== window || !event.data || event.data.source !== PAGE_SOURCE) return;
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

function init() {
  waitForSlackBoot(() => {
    startObserver();
    listenForSends();
    setupViewportBeacons();
    scanOwnMessages();
    beaconVisibleOthers();
    setInterval(() => {
      scanOwnMessages();
      beaconVisibleOthers();
    }, 2000);
    syncPillsToDOM();
    info('loaded', {
      myUserId,
      channelId: getChannelId(),
      containers: document.querySelectorAll('[data-qa="message_container"]').length,
      tracked: Object.keys(trackedMsgs).length,
      injectReady,
      workerUrl,
    });
  });
}

function waitForSlackBoot(cb) {
  const check = () => {
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
  new MutationObserver(() => {
    scanOwnMessages();
    observeNewMessagesForBeacons();
    beaconVisibleOthers();
  }).observe(target, { childList: true, subtree: true });
}

function listenForSends() {
  const capture = () => {
    const text = getComposerText();
    const channelId = getChannelId();
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
  const msgId = buildMsgId(channelId, ts);
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
    info('tracked', msgId);
    chrome.runtime.sendMessage({ type: 'TRACK_MSG', msgId }).catch(() => {});
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

function scanOwnMessages() {
  document.querySelectorAll('[data-qa="message_container"]').forEach((el) => {
    if (!isOwnMessage(el)) return;
    const ts = getMessageTs(el);
    const channelId = getChannelId();
    if (!ts || !channelId) return;
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
  const containers = [...document.querySelectorAll('[data-qa="message_container"]')];
  if (!containers.length) return;

  for (const pending of pendingSends) {
    if (now - pending.at > 45000) continue;
    for (let i = containers.length - 1; i >= Math.max(0, containers.length - 20); i--) {
      const el = containers[i];
      const text = getMessageText(el);
      if (!text || !pending.text) continue;
      if (text.trim() !== pending.text.trim() && !text.includes(pending.text)) continue;

      const ts = getMessageTs(el);
      const channelId = pending.channelId || getChannelId();
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
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        maybeBeacon(entry.target);
      }
    },
    { threshold: 0.15, rootMargin: '40px' }
  );
  observeNewMessagesForBeacons();
}

function observeNewMessagesForBeacons() {
  if (!io) return;
  document.querySelectorAll('[data-qa="message_container"]').forEach((el) => {
    if (el.dataset.slackerIo) return;
    el.dataset.slackerIo = '1';
    io.observe(el);
  });
}

function beaconVisibleOthers() {
  document.querySelectorAll('[data-qa="message_container"]').forEach((el) => {
    const rect = el.getBoundingClientRect();
    if (rect.height < 4) return;
    if (rect.bottom < 0 || rect.top > window.innerHeight) return;
    maybeBeacon(el);
  });
}

function maybeBeacon(messageEl) {
  const ts = getMessageTs(messageEl);
  const channelId = getChannelId();
  if (!ts || !channelId) return;

  const msgId = buildMsgId(channelId, ts);

  // Never mark your own sends as seen from this browser
  if (trackedMsgs[msgId] || isOwnMessage(messageEl)) return;

  fireBeacon(msgId);
}

function fireBeacon(msgId) {
  if (beaconed.has(msgId)) return;
  beaconed.add(msgId);
  if (!workerUrl) return;

  const url = `${workerUrl}/pixel?id=${encodeURIComponent(msgId)}`;
  fetch(url, { method: 'GET', mode: 'cors', keepalive: true, cache: 'no-store' })
    .then((res) => {
      if (res.ok) info('seen ping', msgId);
    })
    .catch(() => {
      const img = new Image();
      img.src = url;
    });
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

  const link = messageEl.querySelector('a[href*="/p"]');
  if (link?.href) {
    const m = link.href.match(/\/p(\d{10})(\d{6})/);
    if (m) return `${m[1]}.${m[2]}`;
  }
  return null;
}

function getChannelId() {
  const path = location.pathname + location.hash;
  const patterns = [
    /\/client\/[A-Z0-9]+\/([CDG][A-Z0-9]+)/i,
    /\/archives\/([CDG][A-Z0-9]+)/i,
    /\/messages\/([CDG][A-Z0-9]+)/i,
    /\/([CDG][A-Z0-9]{8,})\b/i,
  ];
  for (const re of patterns) {
    const m = path.match(re);
    if (m) return m[1];
  }

  const el = document.querySelector('[data-qa-channel-id], [data-channel-id]');
  if (el) {
    return el.getAttribute('data-qa-channel-id') || el.getAttribute('data-channel-id');
  }
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

function findMessageByTs(ts) {
  const norm = String(ts).replace('.', '');
  for (const el of document.querySelectorAll('[data-qa="message_container"]')) {
    const mts = getMessageTs(el);
    if (!mts) continue;
    if (mts === String(ts) || mts.replace('.', '') === norm) return el;
  }
  return null;
}

function findMessageByText(text) {
  if (!text) return null;
  const containers = [...document.querySelectorAll('[data-qa="message_container"]')];
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
    const el =
      document.querySelector(`[data-slacker-tracked="${msgId}"]`) || findMessageByTs(data.ts);
    if (el) attachPill(el, msgId);
  }
}

function persistTracked() {
  const entries = Object.entries(trackedMsgs)
    .sort((a, b) => (b[1].createdAt || 0) - (a[1].createdAt || 0))
    .slice(0, 500);
  trackedMsgs = Object.fromEntries(entries);
  chrome.storage.local.set({ [STORAGE_KEY_MSGS]: trackedMsgs });
}
