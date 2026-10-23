// Egress / CSP policy (web/app/js/policy.mjs) and generated host-config drift.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  CONNECT_ALLOWLIST, egressDecision, isOpenAIHost, contentSecurityPolicy, securityHeaders, OPENAI_UA_PATTERN,
} from '../web/app/js/policy.mjs';
import { ROOT, renderAll, staleFiles } from '../scripts/gen-host-configs.mjs';
import { loadRanges } from '../server/bot-policy.mjs';

const ORIGIN = 'https://cerebro-os.example';

test('egressDecision allows the five research origins and same-origin', () => {
  assert.equal(CONNECT_ALLOWLIST.length, 5);
  for (const o of CONNECT_ALLOWLIST) {
    assert.equal(egressDecision(`${o}/some/path?q=1`, ORIGIN).allowed, true, o);
  }
  assert.equal(egressDecision('https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=x', ORIGIN).allowed, true);
  assert.equal(egressDecision('/api/policy', ORIGIN).allowed, true);
  assert.equal(egressDecision(`${ORIGIN}/app/`, ORIGIN).allowed, true);
  assert.equal(egressDecision('http://localhost:4701/x', 'http://localhost:4701').allowed, true);
});

test('egressDecision blocks OpenAI, plain http, unknown hosts and malformed URLs', () => {
  const blocked = [
    'https://api.openai.com/v1/chat/completions',
    'https://chatgpt.com/',
    'https://foo.chatgpt.com/bar',
    'https://chat.openai.com/backend-api',
    'https://cdn.oaistatic.com/x.js',
    'https://myres.openai.azure.com/openai/deployments',
    'http://www.ebi.ac.uk/europepmc',           // http, not https
    'https://evil.example/',
    'https://www.ebi.ac.uk.evil.example/',      // suffix trick
    'https://eutils.ncbi.nlm.nih.gov:8443/x',   // different origin (port)
    'ftp://openneuro.org/',
  ];
  for (const url of blocked) assert.equal(egressDecision(url, ORIGIN).allowed, false, url);
  assert.match(egressDecision('https://api.openai.com/v1', ORIGIN).reason, /OpenAI/);
  assert.equal(egressDecision('http://[bad', undefined).allowed, false);
});

test('isOpenAIHost', () => {
  for (const h of ['openai.com', 'api.openai.com', 'chatgpt.com', 'foo.chatgpt.com', 'CHATGPT.COM.', 'files.oaiusercontent.com', 'sora.com', 'x.openai.azure.com', 'openai.org']) {
    assert.equal(isOpenAIHost(h), true, h);
  }
  for (const h of ['', null, undefined, 'example.com', 'notchatgpt.com', 'chatgpt.com.evil.example', 'www.ebi.ac.uk', 'openneuro.org', 'myopenai.com']) {
    assert.equal(isOpenAIHost(h), false, String(h));
  }
});

test('Content-Security-Policy pins connect-src, forbids framing and never mentions OpenAI', () => {
  const csp = contentSecurityPolicy();
  assert.ok(csp.includes(`connect-src 'self' ${CONNECT_ALLOWLIST.join(' ')}`));
  assert.ok(csp.includes("frame-ancestors 'none'"));
  assert.ok(csp.includes("object-src 'none'"));
  assert.doesNotMatch(csp, /openai|chatgpt/i);
  assert.doesNotMatch(csp, /\*/);
  // WebAssembly compilation only: no 'unsafe-eval', no remote script origins
  assert.ok(csp.includes("script-src 'self' 'wasm-unsafe-eval';"));
  assert.doesNotMatch(csp, /'unsafe-eval'/);
  const h = securityHeaders();
  assert.equal(h['Content-Security-Policy'], csp);
  assert.equal(h['X-Frame-Options'], 'DENY');
});

test('OPENAI_UA_PATTERN matches published agent tokens but not ordinary browsers', () => {
  for (const ua of [
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)',
    'Mozilla/5.0 (compatible; ChatGPT-User/1.0; +https://openai.com/bot)',
    'OAI-SearchBot/1.0; +https://openai.com/searchbot',
    'ChatGPT-Agent',
  ]) assert.match(ua, OPENAI_UA_PATTERN);
  assert.doesNotMatch('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36', OPENAI_UA_PATTERN);
});

test('generated host configs are in sync with policy.mjs and the range snapshot', () => {
  assert.deepEqual(staleFiles(), [], 'run `npm run gen:hosts`');
});

test('every generated header-bearing config carries the current CSP string', () => {
  const csp = contentSecurityPolicy();
  for (const rel of ['web/_headers', 'netlify.toml', 'vercel.json', 'deploy/nginx.conf']) {
    const text = readFileSync(path.join(ROOT, rel), 'utf8');
    assert.ok(text.includes(csp), `${rel} does not contain the current CSP`);
  }
  for (const rel of ['netlify/edge-functions/block-openai.js', 'deploy/cloudflare-worker.mjs', 'deploy/vercel-middleware.js']) {
    const text = readFileSync(path.join(ROOT, rel), 'utf8');
    assert.ok(text.includes(JSON.stringify(csp)), `${rel} does not embed the current CSP`);
    assert.ok(text.includes(OPENAI_UA_PATTERN.toString()), `${rel} does not embed the current UA pattern`);
  }
  const vercel = JSON.parse(readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  assert.equal(vercel.outputDirectory, 'web');
});

test('nginx IP deny list covers every prefix in the snapshot', () => {
  const ranges = loadRanges();
  const conf = renderAll(ranges)['deploy/openai-ip-deny.conf'];
  for (const v of Object.values(ranges.bots)) for (const p of v.prefixes) assert.ok(conf.includes(`\n${p} 1;`), p);
});

test('edge runtimes block OpenAI UAs, ranges and referers but pass normal traffic', async () => {
  const ranges = loadRanges();
  const src = renderAll(ranges)['deploy/cloudflare-worker.mjs'];
  const mod = await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('origin', { status: 200 });
  try {
    const req = (p, headers = {}) => new Request(`https://cerebro-os.example${p}`, { headers });
    assert.equal((await mod.default.fetch(req('/', { 'user-agent': 'GPTBot/1.2' }))).status, 403);
    assert.equal((await mod.default.fetch(req('/robots.txt', { 'user-agent': 'GPTBot/1.2' }))).status, 200);
    const ip = ranges.bots.gptbot.prefixes[0].split('/')[0];
    assert.equal((await mod.default.fetch(req('/', { 'cf-connecting-ip': ip }))).status, 403);
    assert.equal((await mod.default.fetch(req('/', { referer: 'https://chatgpt.com/c/123' }))).status, 403);
    assert.equal((await mod.default.fetch(req('/', { 'user-agent': 'Mozilla/5.0 Chrome/141', 'cf-connecting-ip': '8.8.8.8' }))).status, 200);
  } finally {
    globalThis.fetch = realFetch;
  }
});
