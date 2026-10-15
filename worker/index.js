// Cloudflare Worker — Slacker shared backend
// GET /ping
// GET /pixel?id=<msgId>
// GET /status?ids=a,b,c
// GET /privacy  — privacy policy HTML for Chrome Web Store

const MSG_ID_RE = /^[CDG][A-Z0-9]{8,}_[0-9]{10,20}$/i;
const MAX_IDS = 50;
const MAX_ID_LEN = 80;

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'X-Content-Type-Options': 'nosniff',
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function text(body, status = 200, type = 'text/plain; charset=utf-8') {
  return new Response(body, {
    status,
    headers: { ...corsHeaders(), 'Content-Type': type },
  });
}

function isValidMsgId(id) {
  if (!id || typeof id !== 'string') return false;
  if (id.length > MAX_ID_LEN) return false;
  return MSG_ID_RE.test(id);
}

function privacyHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Slacker Privacy Policy</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 680px; margin: 40px auto; padding: 0 20px; line-height: 1.55; color: #111; }
    h1 { font-size: 1.5rem; } h2 { font-size: 1.1rem; margin-top: 1.6rem; }
    code { background: #f3f4f6; padding: 0.1em 0.35em; border-radius: 4px; }
  </style>
</head>
<body>
  <h1>Slacker Privacy Policy</h1>
  <p><strong>Last updated:</strong> October 15, 2026</p>
  <p>Slacker is a Chrome extension that shows send/seen-style receipts on Slack messages when both people use Slacker.</p>

  <h2>Data we process</h2>
  <ul>
    <li><strong>Message identifiers</strong> — Slack channel/DM id + message timestamp (not full message text on our server for Seen pings).</li>
    <li><strong>Seen timestamp</strong> — when another Slacker client reports that message was on screen.</li>
    <li><strong>Local storage</strong> — your Slack user id (if detected), receipt history, and settings stay in your browser via Chrome storage.</li>
  </ul>

  <h2>What we do not collect</h2>
  <ul>
    <li>Slack passwords or API tokens</li>
    <li>Your email address as an account login to Slacker</li>
    <li>Full message content on the server (preview text stays in your browser only)</li>
  </ul>

  <h2>How data is used</h2>
  <p>Message ids and seen times are stored temporarily (about 30 days) so the sender’s extension can show a Seen state. Data is not sold.</p>

  <h2>Third parties</h2>
  <p>Backend runs on Cloudflare Workers / KV. Slack’s own services process your chat as usual; Slacker only runs in your browser and talks to our Worker.</p>

  <h2>Your choices</h2>
  <p>Uninstall the extension to stop processing. Use Clear all in the popup to wipe local receipt history.</p>

  <h2>Contact</h2>
  <p>For privacy questions, contact the developer via the Chrome Web Store listing support email.</p>
</body>
</html>`;
}

const TRANSPARENT_GIF = Uint8Array.from(
  atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'),
  (c) => c.charCodeAt(0)
);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (request.method !== 'GET') {
      return text('Method not allowed', 405);
    }

    if (pathname === '/ping') {
      return text('ok');
    }

    if (pathname === '/privacy' || pathname === '/privacy.html') {
      return text(privacyHtml(), 200, 'text/html; charset=utf-8');
    }

    if (pathname === '/pixel') {
      const msgId = url.searchParams.get('id');
      if (!isValidMsgId(msgId)) {
        return text('Invalid id', 400);
      }

      const existing = await env.SLACKER_KV.get(msgId);
      if (!existing) {
        // Do not store IP — minimize PII for store / privacy review
        const record = JSON.stringify({ seenAt: Date.now() });
        await env.SLACKER_KV.put(msgId, record, { expirationTtl: 60 * 60 * 24 * 30 });
      }

      return new Response(TRANSPARENT_GIF, {
        status: 200,
        headers: {
          ...corsHeaders(),
          'Content-Type': 'image/gif',
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          Pragma: 'no-cache',
        },
      });
    }

    if (pathname === '/status') {
      const idsParam = url.searchParams.get('ids');
      if (!idsParam) return text('Missing ids', 400);

      const ids = idsParam
        .split(',')
        .map((s) => s.trim())
        .filter(isValidMsgId)
        .slice(0, MAX_IDS);

      const result = {};
      await Promise.all(
        ids.map(async (id) => {
          const raw = await env.SLACKER_KV.get(id);
          if (!raw) {
            result[id] = null;
            return;
          }
          try {
            const parsed = JSON.parse(raw);
            result[id] = { seenAt: parsed.seenAt || null };
          } catch {
            result[id] = null;
          }
        })
      );

      return json(result);
    }

    return text('Not found', 404);
  },
};
