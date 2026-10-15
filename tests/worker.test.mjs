/**
 * Offline tests for Worker security behavior (mock KV).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const workerPath = join(__dirname, '..', 'worker', 'index.js');

// Dynamic import of Worker module
const workerUrl = pathToFileURL(workerPath).href;
const { default: worker } = await import(workerUrl);

function mockEnv(store = new Map()) {
  return {
    SLACKER_KV: {
      async get(key) {
        return store.has(key) ? store.get(key) : null;
      },
      async put(key, value) {
        store.set(key, value);
      },
    },
    _store: store,
  };
}

async function req(path, env) {
  return worker.fetch(new Request(`https://slacker.test${path}`), env);
}

let passed = 0;
function pass(name) {
  console.log('PASS', name);
  passed += 1;
}

{
  const env = mockEnv();
  const res = await req('/ping', env);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'ok');
  pass('GET /ping');
}

{
  const env = mockEnv();
  const res = await req('/privacy', env);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /Privacy Policy/i);
  assert.match(res.headers.get('content-type') || '', /text\/html/);
  pass('GET /privacy returns HTML');
}

{
  const env = mockEnv();
  const res = await req('/pixel?id=bad', env);
  assert.equal(res.status, 400);
  pass('GET /pixel rejects invalid id');
}

{
  const env = mockEnv();
  const res = await req('/pixel?id=<script>alert(1)</script>', env);
  assert.equal(res.status, 400);
  pass('GET /pixel rejects XSS-like id');
}

{
  const env = mockEnv();
  const id = 'D01234567_1234567890123';
  const res = await req(`/pixel?id=${id}`, env);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /image\/gif/);
  const raw = env._store.get(id);
  assert.ok(raw);
  const parsed = JSON.parse(raw);
  assert.ok(parsed.seenAt);
  assert.equal(parsed.ip, undefined);
  pass('GET /pixel stores seenAt without IP');
}

{
  const env = mockEnv();
  const id = 'D01234567_1234567890123';
  await req(`/pixel?id=${id}`, env);
  const first = env._store.get(id);
  await req(`/pixel?id=${id}`, env);
  assert.equal(env._store.get(id), first);
  pass('GET /pixel is idempotent (no overwrite)');
}

{
  const env = mockEnv();
  const id = 'D01234567_1234567890123';
  await env.SLACKER_KV.put(id, JSON.stringify({ seenAt: 42, ip: '1.2.3.4' }));
  const res = await req(`/status?ids=${id},bad,,,CABCDEFGH_9999999999`, env);
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.deepEqual(json[id], { seenAt: 42 });
  assert.equal(json.bad, undefined);
  assert.equal(Object.keys(json).includes('bad'), false);
  // Must not echo IP even if legacy record has it
  assert.equal(json[id].ip, undefined);
  pass('GET /status filters ids and strips IP');
}

{
  const env = mockEnv();
  const res = await req('/status', env);
  assert.equal(res.status, 400);
  pass('GET /status requires ids');
}

{
  const env = mockEnv();
  const res = await worker.fetch(
    new Request('https://slacker.test/pixel?id=D01234567_1234567890123', { method: 'POST' }),
    env
  );
  assert.equal(res.status, 405);
  pass('POST rejected');
}

{
  const env = mockEnv();
  const res = await req('/nope', env);
  assert.equal(res.status, 404);
  pass('unknown path 404');
}

// Manifest store hygiene
{
  const manifest = JSON.parse(readFileSync(join(__dirname, '..', 'manifest.json'), 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  assert.ok(manifest.host_permissions.every((h) => !h.includes('<')));
  assert.ok(manifest.host_permissions.includes('https://slacker.tzgold.workers.dev/*'));
  assert.ok(!JSON.stringify(manifest).includes('<all_urls>'));
  assert.ok(!manifest.permissions.includes('webRequest'));
  assert.ok(!manifest.permissions.includes('debugger'));
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  pass('manifest MV3 + narrow hosts + no dangerous perms');
}

console.log(`\n${passed} worker/security tests passed`);
