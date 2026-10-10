// Integration tests for server/server.mjs and unit tests for server/bot-policy.mjs.
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';

import { createServer, negotiateEncoding, resolveRequestPath, RateLimiter } from '../server/server.mjs';
import { parseIP, parseCIDR, ipInCIDR, classifyRequest, loadRanges, refreshRanges, matchRange } from '../server/bot-policy.mjs';
import { contentSecurityPolicy } from '../web/app/js/policy.mjs';

const GPTBOT_UA = 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)';
const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const BIG_JS = `export const data = ${JSON.stringify(Array.from({ length: 400 }, (_, i) => ({ i, label: 'neuron-' + i })))};\n`;

/** Raw HTTP request (no URL normalisation, unlike fetch). */
function request(port, rawPath, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: rawPath, method, headers: { 'user-agent': CHROME_UA, ...headers }, agent: false }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

function makeFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'cerebro-web-'));
  writeFileSync(path.join(root, 'index.html'), '<!doctype html><title>Cerebro OS</title><h1>home</h1>');
  writeFileSync(path.join(root, '404.html'), '<!doctype html><title>Not found</title><h1>custom 404</h1>');
  writeFileSync(path.join(root, 'robots.txt'), 'User-agent: GPTBot\nDisallow: /\n');
  writeFileSync(path.join(root, 'ai.txt'), 'User-Agent: *\nDisallow: /\n');
  writeFileSync(path.join(root, '.env'), 'SECRET=1');
  mkdirSync(path.join(root, 'app', 'js'), { recursive: true });
  writeFileSync(path.join(root, 'app', 'index.html'), '<!doctype html><title>Workspace</title>');
  writeFileSync(path.join(root, 'app', 'js', 'big.mjs'), BIG_JS);
  writeFileSync(path.join(root, 'app', 'style.css'), 'body{margin:0}');
  writeFileSync(path.join(root, 'manifest.webmanifest'), '{"name":"Cerebro OS"}');
  mkdirSync(path.join(root, '.well-known'));
  writeFileSync(path.join(root, '.well-known', 'security.txt'), 'Contact: mailto:security@cerebro-os.example\n');
  return root;
}

async function start(options) {
  const server = createServer({ log: false, refreshOpenAIRanges: false, rateLimit: 0, ...options });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { server, port: server.address().port };
}

describe('server', () => {
  let root, srv, proxied;
  before(async () => {
    root = makeFixture();
    srv = await start({ webRoot: root });
    proxied = await start({ webRoot: root, trustProxy: true });
  });
  after(async () => {
    await srv.server.drain();
    await proxied.server.drain();
    rmSync(root, { recursive: true, force: true });
  });

  test('serves index with security headers', async () => {
    const r = await request(srv.port, '/');
    assert.equal(r.status, 200);
    assert.match(r.body.toString(), /home/);
    assert.equal(r.headers['content-type'], 'text/html; charset=utf-8');
    assert.equal(r.headers['cache-control'], 'no-cache');
    assert.equal(r.headers['x-frame-options'], 'DENY');
    assert.equal(r.headers['x-content-type-options'], 'nosniff');
    assert.equal(r.headers['referrer-policy'], 'no-referrer');
    assert.match(r.headers['content-security-policy'], /frame-ancestors 'none'/);
    assert.ok(r.headers['content-security-policy'].startsWith(contentSecurityPolicy().replace(/; upgrade-insecure-requests$/, '')));
    assert.match(r.headers['x-robots-tag'], /GPTBot: noindex/);
  });

  test('full CSP (with upgrade-insecure-requests) for non-loopback hosts', async () => {
    const r = await request(srv.port, '/', { headers: { host: 'cerebro-os.example' } });
    assert.equal(r.headers['content-security-policy'], contentSecurityPolicy());
  });

  test('normal Chrome UA gets 200', async () => {
    assert.equal((await request(srv.port, '/app/', { headers: { 'user-agent': CHROME_UA } })).status, 200);
  });

  for (const ua of [GPTBOT_UA, 'ChatGPT-User/1.0', 'OAI-SearchBot/1.0', 'Mozilla/5.0 (compatible; ChatGPT-Agent/1.0)']) {
    test(`403 for OpenAI UA: ${ua.slice(0, 40)}`, async () => {
      const r = await request(srv.port, '/', { headers: { 'user-agent': ua } });
      assert.equal(r.status, 403);
      assert.equal(r.body.toString(), 'Access by OpenAI agents is not permitted by the Cerebro OS operator.\n');
      assert.equal(r.headers['x-robots-tag'], 'noindex, nofollow, noarchive');
      assert.equal(r.headers['cache-control'], 'no-store');
      assert.equal(r.headers['x-frame-options'], 'DENY');
    });
  }

  test('OpenAI agents are blocked on every path and method, including /healthz and POST', async () => {
    assert.equal((await request(srv.port, '/app/js/big.mjs', { headers: { 'user-agent': GPTBOT_UA } })).status, 403);
    assert.equal((await request(srv.port, '/api/policy', { headers: { 'user-agent': GPTBOT_UA } })).status, 403);
    assert.equal((await request(srv.port, '/', { method: 'POST', headers: { 'user-agent': GPTBOT_UA } })).status, 403);
  });

  test('robots.txt and ai.txt stay readable for GPTBot', async () => {
    const r = await request(srv.port, '/robots.txt', { headers: { 'user-agent': GPTBOT_UA } });
    assert.equal(r.status, 200);
    assert.match(r.body.toString(), /Disallow: \//);
    assert.equal(r.headers['content-type'], 'text/plain; charset=utf-8');
    assert.equal(r.headers['cache-control'], 'no-cache');
    assert.equal((await request(srv.port, '/ai.txt', { headers: { 'user-agent': 'ChatGPT-User/1.0' } })).status, 200);
  });

  test('403 for an IP inside a gptbot CIDR via X-Forwarded-For when TRUST_PROXY', async () => {
    const cidr = loadRanges().bots.gptbot.prefixes[0];
    const ip = cidr.split('/')[0].replace(/\.0$/, '.7');
    const r = await request(proxied.port, '/', { headers: { 'x-forwarded-for': `${ip}, 10.0.0.1` } });
    assert.equal(r.status, 403);
    assert.equal((await request(proxied.port, '/', { headers: { 'cf-connecting-ip': ip } })).status, 403);
    assert.equal((await request(proxied.port, '/', { headers: { 'x-forwarded-for': '8.8.8.8' } })).status, 200);
    // Without TRUST_PROXY, X-Forwarded-For is ignored (cannot be spoofed to bypass or to frame others).
    assert.equal((await request(srv.port, '/', { headers: { 'x-forwarded-for': ip } })).status, 200);
  });

  test('403 for ChatGPT Referer / Origin', async () => {
    assert.equal((await request(srv.port, '/', { headers: { referer: 'https://chatgpt.com/' } })).status, 403);
    assert.equal((await request(srv.port, '/', { headers: { referer: 'https://foo.chatgpt.com/c/1' } })).status, 403);
    assert.equal((await request(srv.port, '/', { headers: { origin: 'https://chat.openai.com' } })).status, 403);
    assert.equal((await request(srv.port, '/', { headers: { referer: 'https://www.google.com/' } })).status, 200);
  });

  test('path traversal never leaks files', async () => {
    for (const p of ['/../package.json', '/%2e%2e/package.json', '/%2E%2E/%2E%2E/etc/passwd', '/app/../../package.json', '/..%2fpackage.json', '/%2e%2e%5cpackage.json', '/%00', '/%E0%A4%A']) {
      const r = await request(srv.port, p);
      assert.ok([400, 404].includes(r.status), `${p} → ${r.status}`);
      assert.doesNotMatch(r.body.toString(), /"name"|root:|SECRET/, p);
    }
  });

  test('dotfiles are hidden but /.well-known is served', async () => {
    const env = await request(srv.port, '/.env');
    assert.equal(env.status, 404);
    assert.doesNotMatch(env.body.toString(), /SECRET/);
    const sec = await request(srv.port, '/.well-known/security.txt');
    assert.equal(sec.status, 200);
    assert.match(sec.body.toString(), /Contact:/);
  });

  test('MIME types and cache policy', async () => {
    const js = await request(srv.port, '/app/js/big.mjs');
    assert.equal(js.headers['content-type'], 'text/javascript; charset=utf-8');
    assert.equal(js.headers['cache-control'], 'public, max-age=3600, must-revalidate');
    assert.equal((await request(srv.port, '/app/style.css')).headers['content-type'], 'text/css; charset=utf-8');
    assert.equal((await request(srv.port, '/manifest.webmanifest')).headers['content-type'], 'application/manifest+json; charset=utf-8');
  });

  test('/app redirects to /app/ (query preserved)', async () => {
    const r = await request(srv.port, '/app?tab=stats');
    assert.equal(r.status, 301);
    assert.equal(r.headers.location, '/app/?tab=stats');
  });

  test('strong ETag and 304 on If-None-Match', async () => {
    const a = await request(srv.port, '/app/js/big.mjs');
    assert.match(a.headers.etag, /^"[A-Za-z0-9_-]+"$/);
    const b = await request(srv.port, '/app/js/big.mjs', { headers: { 'if-none-match': a.headers.etag } });
    assert.equal(b.status, 304);
    assert.equal(b.body.length, 0);
    assert.equal(b.headers.etag, a.headers.etag);
    assert.equal((await request(srv.port, '/app/js/big.mjs', { headers: { 'if-none-match': '"nope"' } })).status, 200);
  });

  test('gzip and brotli when requested', async () => {
    const gz = await request(srv.port, '/app/js/big.mjs', { headers: { 'accept-encoding': 'gzip' } });
    assert.equal(gz.headers['content-encoding'], 'gzip');
    assert.equal(gz.headers.vary, 'Accept-Encoding');
    assert.equal(zlib.gunzipSync(gz.body).toString(), BIG_JS);
    assert.ok(gz.body.length < Buffer.byteLength(BIG_JS));
    const br = await request(srv.port, '/app/js/big.mjs', { headers: { 'accept-encoding': 'gzip, deflate, br' } });
    assert.equal(br.headers['content-encoding'], 'br');
    assert.equal(zlib.brotliDecompressSync(br.body).toString(), BIG_JS);
    assert.notEqual(br.headers.etag, gz.headers.etag);
    const again = await request(srv.port, '/app/js/big.mjs', { headers: { 'accept-encoding': 'gzip', 'if-none-match': gz.headers.etag } });
    assert.equal(again.status, 304);
    const identity = await request(srv.port, '/app/js/big.mjs', { headers: { 'accept-encoding': 'gzip;q=0' } });
    assert.equal(identity.headers['content-encoding'], undefined);
  });

  test('HEAD returns headers only; POST is 405 with Allow', async () => {
    const h = await request(srv.port, '/', { method: 'HEAD' });
    assert.equal(h.status, 200);
    assert.equal(h.body.length, 0);
    assert.ok(Number(h.headers['content-length']) > 0);
    const p = await request(srv.port, '/', { method: 'POST' });
    assert.equal(p.status, 405);
    assert.equal(p.headers.allow, 'GET, HEAD');
    assert.equal(p.headers['x-frame-options'], 'DENY');
  });

  test('/healthz and /readyz', async () => {
    const h = await request(srv.port, '/healthz');
    assert.equal(h.status, 200);
    assert.deepEqual(JSON.parse(h.body), { status: 'ok' });
    assert.equal(h.headers['cache-control'], 'no-store');
    assert.equal((await request(srv.port, '/readyz')).status, 200);
  });

  test('/api/policy describes the active bot policy', async () => {
    const r = await request(srv.port, '/api/policy');
    assert.equal(r.status, 200);
    const doc = JSON.parse(r.body);
    assert.ok(doc.openai.userAgentTokens.includes('GPTBot'));
    const snap = loadRanges();
    assert.equal(doc.openai.ipRanges.bots.gptbot.count, snap.bots.gptbot.prefixes.length);
    assert.equal(doc.openai.ipRanges.bots.gptbot.creationTime, snap.bots.gptbot.creationTime);
    assert.equal(doc.openai.ipRanges.snapshotTakenAt, snap.snapshotTakenAt);
    assert.equal(doc.egressAllowlist.length, 5);
  });

  test('unknown paths get the custom 404 page', async () => {
    const r = await request(srv.port, '/no/such/page');
    assert.equal(r.status, 404);
    assert.match(r.body.toString(), /custom 404/);
    assert.equal(r.headers['x-frame-options'], 'DENY');
  });

  test('rate limiting returns 429 with Retry-After', async () => {
    const limited = await start({ webRoot: root, rateLimit: 3 });
    try {
      for (let i = 0; i < 3; i++) assert.equal((await request(limited.port, '/')).status, 200);
      const r = await request(limited.port, '/');
      assert.equal(r.status, 429);
      assert.ok(Number(r.headers['retry-after']) >= 1);
      assert.equal((await request(limited.port, '/healthz')).status, 200, 'probes are exempt');
    } finally {
      await limited.server.drain();
    }
  });

  test('access logs are structured JSON and omit raw UAs', async () => {
    const lines = [];
    const logged = await start({ webRoot: root, log: true, logger: l => lines.push(l) });
    try {
      await request(logged.port, '/');
      await request(logged.port, '/', { headers: { 'user-agent': GPTBOT_UA } });
      await new Promise(r => setTimeout(r, 20));
    } finally {
      await logged.server.drain();
    }
    const access = lines.filter(l => l.msg === 'access');
    assert.equal(access.length, 2);
    for (const k of ['time', 'method', 'path', 'status', 'ms', 'ip', 'ua']) assert.ok(k in access[0], k);
    assert.equal(access[0].ua, 'browser');
    assert.equal(access[1].ua, 'openai');
    assert.ok(lines.some(l => l.msg === 'openai-blocked' && l.reason === 'user-agent' && l.bot === 'GPTBot'));
  });

  test('draining server reports not-ready', async () => {
    const s = await start({ webRoot: root });
    const p = s.server.drain();
    assert.equal(s.server.policyState.draining, true);
    await p;
  });
});

describe('bot-policy', () => {
  test('IPv4 CIDR edges', () => {
    assert.equal(ipInCIDR('10.0.0.0', '10.0.0.0/24'), true);
    assert.equal(ipInCIDR('10.0.0.255', '10.0.0.0/24'), true);
    assert.equal(ipInCIDR('10.0.1.0', '10.0.0.0/24'), false);
    assert.equal(ipInCIDR('9.255.255.255', '10.0.0.0/8'), false);
    assert.equal(ipInCIDR('20.125.66.79', '20.125.66.80/28'), false);
    assert.equal(ipInCIDR('20.125.66.80', '20.125.66.80/28'), true);
    assert.equal(ipInCIDR('20.125.66.95', '20.125.66.80/28'), true);
    assert.equal(ipInCIDR('20.125.66.96', '20.125.66.80/28'), false);
    assert.equal(ipInCIDR('1.2.3.4', '0.0.0.0/0'), true);
    assert.equal(ipInCIDR('1.2.3.4', '1.2.3.4/32'), true);
    assert.equal(ipInCIDR('1.2.3.5', '1.2.3.4/32'), false);
    assert.equal(parseCIDR('10.1.2.3/8').network, 10n << 24n, 'network is masked');
  });

  test('IPv6 CIDR matching', () => {
    assert.equal(ipInCIDR('2001:db8::1', '2001:db8::/32'), true);
    assert.equal(ipInCIDR('2001:db8:ffff:ffff:ffff:ffff:ffff:ffff', '2001:db8::/32'), true);
    assert.equal(ipInCIDR('2001:db9::', '2001:db8::/32'), false);
    assert.equal(ipInCIDR('2001:0DB8:0000:0000:0000:0000:0000:0001', '2001:db8::1/128'), true);
    assert.equal(ipInCIDR('[2001:db8::1]:443', '2001:db8::/48'), true);
    assert.equal(ipInCIDR('fe80::1%eth0', 'fe80::/10'), true);
    assert.equal(ipInCIDR('::1', '10.0.0.0/8'), false, 'families never cross-match');
  });

  test('IPv4-mapped IPv6 is treated as IPv4', () => {
    assert.deepEqual(parseIP('::ffff:1.2.3.4'), { family: 4, value: 0x01020304n });
    assert.deepEqual(parseIP('::FFFF:0102:0304'), { family: 4, value: 0x01020304n });
    assert.equal(ipInCIDR('::ffff:20.171.206.9', '20.171.206.0/24'), true);
    assert.equal(ipInCIDR('::ffff:20.171.205.9', '20.171.206.0/24'), false);
    assert.equal(ipInCIDR('20.171.206.9', '::ffff:20.171.206.0/120'), true);
  });

  test('invalid addresses are rejected', () => {
    for (const s of ['', '1.2.3', '1.2.3.256', '01.2.3.4', '1::2::3', '1:2:3:4:5:6:7:8:9', 'gggg::1', 'not-an-ip', null]) {
      assert.equal(parseIP(s), null, String(s));
    }
    assert.throws(() => parseCIDR('10.0.0.0/33'));
    assert.throws(() => parseCIDR('10.0.0.0'));
    assert.throws(() => parseCIDR('2001:db8::/129'));
  });

  test('classifyRequest', () => {
    const ranges = loadRanges();
    assert.deepEqual(classifyRequest({ userAgent: GPTBOT_UA, ip: '8.8.8.8' }, ranges), { blocked: true, reason: 'user-agent', bot: 'GPTBot' });
    const cu = ranges.bots['chatgpt-user'].prefixes[0].split('/')[0];
    const v = classifyRequest({ userAgent: CHROME_UA, ip: cu }, ranges);
    assert.equal(v.blocked, true);
    assert.equal(v.reason, 'ip-range');
    assert.equal(v.bot, 'chatgpt-user');
    assert.equal(classifyRequest({ userAgent: CHROME_UA, ip: `::ffff:${cu}` }, ranges).blocked, true);
    assert.deepEqual(classifyRequest({ userAgent: CHROME_UA, ip: '8.8.8.8' }, ranges), { blocked: false, reason: null, bot: null });
    assert.equal(classifyRequest({ userAgent: CHROME_UA, referer: 'https://chatgpt.com/' }, ranges).reason, 'referer');
    assert.equal(classifyRequest({ userAgent: CHROME_UA, origin: 'null' }, ranges).blocked, false);
    // Synthetic IPv6 range
    const v6 = { bots: { test: { prefixes: ['2603:1030::/32'] } } };
    assert.equal(matchRange('2603:1030:abcd::1', v6).bot, 'test');
  });

  test('refreshRanges parses OpenAI files and throws on failure', async () => {
    const ok = async url => new Response(JSON.stringify({
      creationTime: '2026-10-01T00:00:00',
      prefixes: [{ ipv4Prefix: '192.0.2.0/24' }, { ipv6Prefix: '2001:db8::/32' }, { other: 1 }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
    const fresh = await refreshRanges(ok);
    assert.deepEqual(Object.keys(fresh.bots), ['gptbot', 'chatgpt-user', 'searchbot']);
    assert.deepEqual(fresh.bots.gptbot.prefixes, ['192.0.2.0/24', '2001:db8::/32']);
    await assert.rejects(refreshRanges(async () => new Response('nope', { status: 503 })));
    await assert.rejects(refreshRanges(async () => { throw new Error('offline'); }));
    await assert.rejects(refreshRanges(async () => new Response('{"prefixes":[{"ipv4Prefix":"junk"}]}')));
  });

  test('server falls back to the snapshot when refresh fails', async () => {
    const root = makeFixture();
    const lines = [];
    const s = createServer({ webRoot: root, log: true, logger: l => lines.push(l), rateLimit: 0, refreshOpenAIRanges: true, fetchImpl: async () => { throw new Error('offline'); } });
    await new Promise(r => setTimeout(r, 20));
    assert.equal(s.policyState.rangesSource, 'snapshot');
    assert.ok(lines.some(l => l.msg === 'openai-ranges-refresh-failed'));
    s.close();
    rmSync(root, { recursive: true, force: true });
  });
});

describe('server helpers', () => {
  test('negotiateEncoding', () => {
    assert.equal(negotiateEncoding(undefined), null);
    assert.equal(negotiateEncoding('gzip'), 'gzip');
    assert.equal(negotiateEncoding('gzip, deflate, br'), 'br');
    assert.equal(negotiateEncoding('br;q=0, gzip'), 'gzip');
    assert.equal(negotiateEncoding('gzip;q=0'), null);
    assert.equal(negotiateEncoding('*'), 'br');
    assert.equal(negotiateEncoding('identity'), null);
  });

  test('resolveRequestPath', () => {
    assert.deepEqual(resolveRequestPath('/app/js/x.mjs'), { segments: ['app', 'js', 'x.mjs'], trailingSlash: false });
    assert.equal(resolveRequestPath('/../x').error, 400);
    assert.equal(resolveRequestPath('/%2e%2e/x').error, 400);
    assert.equal(resolveRequestPath('/a%5c..%5cb').error, 400);
    assert.equal(resolveRequestPath('/%zz').error, 400);
    assert.equal(resolveRequestPath('/.git/config').error, 404);
    assert.deepEqual(resolveRequestPath('/.well-known/security.txt').segments, ['.well-known', 'security.txt']);
    assert.equal(resolveRequestPath('/app/.well-known/x').error, 404);
  });

  test('RateLimiter refills and sweeps idle buckets', () => {
    const rl = new RateLimiter({ perMinute: 60, maxBuckets: 2 });
    const t0 = 1_000_000;
    assert.equal(rl.take('a', t0).ok, true);
    for (let i = 0; i < 59; i++) rl.take('a', t0);
    const denied = rl.take('a', t0);
    assert.equal(denied.ok, false);
    assert.equal(denied.retryAfter, 1);
    assert.equal(rl.take('a', t0 + 1000).ok, true, 'one token per second refills');
    rl.take('b', t0); rl.take('c', t0);
    assert.equal(rl.buckets.size, 2, 'hard cap evicts oldest');
    rl.sweep(t0 + 120_000);
    assert.equal(rl.buckets.size, 0, 'idle buckets are swept');
    rl.stop();
  });
});
