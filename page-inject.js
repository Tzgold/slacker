// page-inject.js — MAIN world
(function () {
  if (window.__slackerInjected) return;
  window.__slackerInjected = true;

  const SOURCE = 'slacker-page';

  function post(payload) {
    window.postMessage({ source: SOURCE, ...payload }, '*');
  }

  function extractUserId() {
    try {
      if (window.TS?.boot_data?.user_id) return window.TS.boot_data.user_id;
      if (window.boot_data?.user_id) return window.boot_data.user_id;
      if (window.TS?.model?.user?.id) return window.TS.model.user.id;

      const cfg = localStorage.getItem('localConfig_v2');
      if (cfg) {
        const parsed = JSON.parse(cfg);
        for (const team of Object.values(parsed.teams || {})) {
          const id = team?.user?.id || team?.user_id;
          if (id && /^U[A-Z0-9]+$/i.test(id)) return id;
        }
      }
    } catch (_) {}
    return null;
  }

  function isSendApi(url) {
    if (!url || typeof url !== 'string') return false;
    const u = url.toLowerCase();
    return (
      u.includes('chat.postmessage') ||
      u.includes('chat.memessage') ||
      u.includes('chat.postmemessage') ||
      u.includes('conversations.memessage')
    );
  }

  function isBootApi(url) {
    if (!url || typeof url !== 'string') return false;
    const u = url.toLowerCase();
    return (
      u.includes('client.userboot') ||
      u.includes('client.boot') ||
      u.includes('rtm.start') ||
      u.includes('auth.test')
    );
  }

  function handleJson(url, data) {
    if (!data || typeof data !== 'object') return;

    if (data.self?.id) post({ type: 'SLACKER_BOOT', userId: data.self.id });
    if (data.user_id && /^U[A-Z0-9]+$/i.test(data.user_id)) {
      post({ type: 'SLACKER_BOOT', userId: data.user_id });
    }

    if (!isSendApi(url) || data.ok === false) return;

    const ts = data.ts || data.message?.ts;
    const channel = data.channel || data.message?.channel;
    if (ts && channel) {
      post({
        type: 'SLACKER_SENT',
        ts: String(ts),
        channelId: String(channel),
        text: data.message?.text || '',
      });
    }
  }

  function urlOf(input) {
    if (typeof input === 'string') return input;
    if (input && typeof input.url === 'string') return input.url;
    try {
      if (input instanceof Request) return input.url;
    } catch (_) {}
    return '';
  }

  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const res = await origFetch.apply(this, args);
    try {
      const url = urlOf(args[0]);
      if (isSendApi(url) || isBootApi(url)) {
        res
          .clone()
          .json()
          .then((data) => handleJson(url, data))
          .catch(() => {});
      }
    } catch (_) {}
    return res;
  };

  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__slackerUrl = typeof url === 'string' ? url : '';
    return origOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener('load', function () {
      try {
        const url = this.__slackerUrl || '';
        if (!isSendApi(url) && !isBootApi(url)) return;
        handleJson(url, JSON.parse(this.responseText));
      } catch (_) {}
    });
    return origSend.apply(this, args);
  };

  function publishBoot() {
    const userId = extractUserId();
    if (userId) post({ type: 'SLACKER_BOOT', userId });
  }

  publishBoot();
  setInterval(publishBoot, 2500);
  post({ type: 'SLACKER_INJECT_READY' });
})();
