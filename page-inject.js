// Runs in the page MAIN world — can access window.TS, fetch responses, etc.
(function () {
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
          if (team?.user?.id) return team.user.id;
          if (team?.user_id) return team.user_id;
        }
      }
    } catch (_) {}
    return null;
  }

  function extractFromResponse(url, data) {
    if (!data || typeof data !== 'object') return;

    if (data.self?.id) {
      post({ type: 'SLACKER_BOOT', userId: data.self.id });
    }

    const ts = data.ts || data.message?.ts;
    const channel = data.channel || data.message?.channel;
    if (ts && channel) {
      post({ type: 'SLACKER_SENT', ts: String(ts), channelId: channel, via: 'api', url });
    }
  }

  function shouldInspect(url) {
    if (!url || typeof url !== 'string') return false;
    return (
      url.includes('slack.com/api/') ||
      url.includes('/api/chat.') ||
      url.includes('chat.postMessage') ||
      url.includes('conversations.')
    );
  }

  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const res = await origFetch.apply(this, args);
    try {
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
      if (shouldInspect(url)) {
        res.clone().json().then((data) => extractFromResponse(url, data)).catch(() => {});
      }
    } catch (_) {}
    return res;
  };

  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__slackerUrl = url;
    return origOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener('load', function () {
      try {
        if (!shouldInspect(this.__slackerUrl)) return;
        const data = JSON.parse(this.responseText);
        extractFromResponse(this.__slackerUrl, data);
      } catch (_) {}
    });
    return origSend.apply(this, args);
  };

  function publishBoot() {
    const userId = extractUserId();
    if (userId) post({ type: 'SLACKER_BOOT', userId });
  }

  publishBoot();
  setInterval(publishBoot, 5000);

  post({ type: 'SLACKER_INJECT_READY' });
})();
