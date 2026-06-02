// worker/index.js — Cloudflare Worker
//
// Routes:
//   GET /pixel?id=<msgId>   — log a "seen" event, return 1x1 transparent GIF
//   GET /status?ids=a,b,c   — return { [msgId]: { seenAt } | null } for each ID
//   GET /ping               — health check

export default {
  async fetch(request, env) {
    const url     = new URL(request.url);
    const { pathname } = url;

    // ── CORS headers so the extension can reach the worker ─────────────────
    const cors = {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    // ── /ping ────────────────────────────────────────────────────────────────
    if (pathname === '/ping') {
      return new Response('ok', { headers: { ...cors, 'Content-Type': 'text/plain' } });
    }

    // ── /pixel ───────────────────────────────────────────────────────────────
    if (pathname === '/pixel') {
      const msgId = url.searchParams.get('id');
      if (!msgId) return new Response('Missing id', { status: 400, headers: cors });

      const existing = await env.SLACKER_KV.get(msgId);
      if (!existing) {
        // Only record the first hit (first open = "seen")
        const record = JSON.stringify({
          seenAt: Date.now(),
          ip: request.headers.get('CF-Connecting-IP') || 'unknown',
        });
        // Store for 30 days
        await env.SLACKER_KV.put(msgId, record, { expirationTtl: 60 * 60 * 24 * 30 });
      }

      // 1x1 transparent GIF
      const gif = Uint8Array.from(atob(
        'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
      ), c => c.charCodeAt(0));

      return new Response(gif, {
        status: 200,
        headers: {
          ...cors,
          'Content-Type':  'image/gif',
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          'Pragma':        'no-cache',
        },
      });
    }

    // ── /status ──────────────────────────────────────────────────────────────
    if (pathname === '/status') {
      const idsParam = url.searchParams.get('ids');
      if (!idsParam) return new Response('Missing ids', { status: 400, headers: cors });

      const ids = idsParam.split(',').map(s => s.trim()).filter(Boolean).slice(0, 100);
      const result = {};

      await Promise.all(ids.map(async (id) => {
        const raw = await env.SLACKER_KV.get(id);
        result[id] = raw ? JSON.parse(raw) : null;
      }));

      return new Response(JSON.stringify(result), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    return new Response('Not found', { status: 404, headers: cors });
  },
};
