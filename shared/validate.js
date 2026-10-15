// Shared validation helpers (used by tests; mirrored in worker/background)

export const MSG_ID_RE = /^[CDG][A-Z0-9]{8,}_[0-9]{10,20}$/i;

export function isValidMsgId(id) {
  if (!id || typeof id !== 'string') return false;
  if (id.length > 80) return false;
  return MSG_ID_RE.test(id);
}

export function buildMsgId(channelId, ts) {
  return `${channelId}_${String(ts).replace('.', '')}`;
}

export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
