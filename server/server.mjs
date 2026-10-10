// Cerebro OS — zero-dependency production server (Node 20+).
//
//   node server/server.mjs
//
// Env: PORT (8080) HOST (0.0.0.0) WEB_ROOT (../web) TRUST_PROXY (0|1) REFRESH_OPENAI_RANGES (0|1)
//      RATE_LIMIT (requests/minute/IP, 300; 0 disables) LOG (1|0) WORKERS (1|n|auto) CACHE_MB (64)
//
// Stateless by design: every replica serves the same static tree and keeps only bounded
// in-memory caches, so horizontal scaling is "run more copies behind a load balancer".
import http from 'node:http';
import cluster from 'node:cluster';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { promises as fsp, realpathSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import zlib from 'node:zlib';
import { promisify } from 'node:util';

import {
  securityHeaders, CONNECT_ALLOWLIST, OPENAI_DENY_HOSTS, OPENAI_USER_AGENTS, OPENAI_UA_PATTERN,
} from '../web/app/js/policy.mjs';
import { classifyRequest, loadRanges, refreshRanges, uaClass, BLOCK_MESSAGE } from './bot-policy.mjs';

const gzip = promisify(zlib.gzip);
const brotli = promisify(zlib.brotliCompress);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DAY_MS = 24 * 60 * 60 * 1000;

export const MIME = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.wasm': 'application/wasm',
  '.pdf': 'application/pdf',
});

const COMPRESSIBLE = /^(text\/|application\/(json|javascript|manifest\+json|xml|wasm)|image\/svg\+xml)/;
const NO_CACHE_FILES = new Set(['sw.js', 'robots.txt', 'ai.txt', 'security.txt', 'manifest.webmanifest']);
const POLICY_EXEMPT_PATHS = new Set(['/robots.txt', '/ai.txt']);
const MAX_CACHEABLE_FILE = 4 * 1024 * 1024;

function envDefaults(env = process.env) {
  return {
    webRoot: env.WEB_ROOT ? path.resolve(env.WEB_ROOT) : path.resolve(HERE, '../web'),
    trustProxy: env.TRUST_PROXY === '1' || env.TRUST_PROXY === 'true',
    refreshOpenAIRanges: env.REFRESH_OPENAI_RANGES === '1' || env.REFRESH_OPENAI_RANGES === 'true',
    rateLimit: env.RATE_LIMIT !== undefined && env.RATE_LIMIT !== '' ? Number(env.RATE_LIMIT) : 300,
    log: env.LOG !== '0' && env.LOG !== 'false',
    cacheBytes: (Number(env.CACHE_MB) > 0 ? Number(env.CACHE_MB) : 64) * 1024 * 1024,
  };
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Byte-bounded LRU (Map preserves insertion order; re-insert on hit). */
class LRU {
  constructor(maxBytes) { this.max = maxBytes; this.bytes = 0; this.map = new Map(); }
  get(key) {
    const v = this.map.get(key);
    if (v) { this.map.delete(key); this.map.set(key, v); }
    return v;
  }
  set(key, value, size) {
    this.delete(key);
    if (size > this.max) return;
    this.map.set(key, { value, size });
    this.bytes += size;
    for (const [k, v] of this.map) {
      if (this.bytes <= this.max) break;
      this.map.delete(k); this.bytes -= v.size;
    }
  }
  delete(key) {
    const v = this.map.get(key);
    if (v) { this.map.delete(key); this.bytes -= v.size; }
  }
}

/** Per-IP token bucket. Memory is bounded: idle (full) buckets are swept and a hard cap applies. */
export class RateLimiter {
  constructor({ perMinute = 300, maxBuckets = 100_000 } = {}) {
    this.capacity = perMinute;
    this.refillPerMs = perMinute / 60_000;
    this.maxBuckets = maxBuckets;
    this.buckets = new Map();
    this.timer = setInterval(() => this.sweep(), 60_000);
    this.timer.unref();
  }
  /** Returns { ok: true } or { ok: false, retryAfter: seconds }. */
  take(key, now = Date.now()) {
    let b = this.buckets.get(key);
    if (!b) {
      if (this.buckets.size >= this.maxBuckets) {
        const oldest = this.buckets.keys().next().value; // insertion order ≈ least recently created
        this.buckets.delete(oldest);
      }
      b = { tokens: this.capacity, at: now };
      this.buckets.set(key, b);
    } else {
      b.tokens = Math.min(this.capacity, b.tokens + (now - b.at) * this.refillPerMs);
      b.at = now;
    }
    if (b.tokens >= 1) { b.tokens -= 1; return { ok: true }; }
    return { ok: false, retryAfter: Math.max(1, Math.ceil((1 - b.tokens) / this.refillPerMs / 1000)) };
  }
  sweep(now = Date.now()) {
    for (const [k, b] of this.buckets) {
      if (b.tokens + (now - b.at) * this.refillPerMs >= this.capacity) this.buckets.delete(k);
    }
  }
  stop() { clearInterval(this.timer); }
}

function isLoopbackHost(hostHeader) {
  const h = String(hostHeader || '').toLowerCase().replace(/:\d+$/, '');
  return h === 'localhost' || h.endsWith('.localhost') || h === '127.0.0.1' || h === '[::1]';
}

/** Choose 'br', 'gzip' or null from an Accept-Encoding header (respects q=0). */
export function negotiateEncoding(header) {
  if (!header) return null;
  const q = {};
  for (const part of String(header).toLowerCase().split(',')) {
    const [name, ...params] = part.trim().split(';');
    if (!name) continue;
    let weight = 1;
    for (const p of params) {
      const m = /^\s*q=([\d.]+)\s*$/.exec(p);
      if (m) weight = Number(m[1]);
    }
    q[name.trim()] = weight;
  }
  const w = n => (n in q ? q[n] : ('*' in q ? q['*'] : 0));
  const br = w('br'), gz = w('gzip');
  if (br > 0 && br >= gz) return 'br';
  if (gz > 0) return 'gzip';
  return null;
}

function etagMatches(header, etag) {
  if (!header) return false;
  if (header.trim() === '*') return true;
  return header.split(',').some(t => t.trim().replace(/^W\//, '') === etag);
}

/**
 * Turn a raw request path into safe path segments relative to the web root.
 * Returns { segments, trailingSlash } or { error: 400|404 }.
 */
export function resolveRequestPath(rawPath) {
  let decoded;
  try { decoded = decodeURIComponent(rawPath); } catch { return { error: 400 }; }
  if (!decoded.startsWith('/') || decoded.includes('\0') || decoded.includes('\\')) return { error: 400 };
  const segments = decoded.split('/').filter(s => s !== '' && s !== '.');
  for (const [i, seg] of segments.entries()) {
    if (seg === '..') return { error: 400 };
    if (seg.startsWith('.') && !(i === 0 && seg === '.well-known')) return { error: 404 };
  }
  return { segments, trailingSlash: decoded.endsWith('/') };
}

// ---------------------------------------------------------------------------
// Server factory
// ---------------------------------------------------------------------------

/**
 * Create (but do not start) the Cerebro OS HTTP server. Options override env defaults:
 * { webRoot, trustProxy, refreshOpenAIRanges, rateLimit, log, cacheBytes, ranges, fetchImpl, logger }
 */
export function createServer(options = {}) {
  const opt = { ...envDefaults(), ...options };
  const webRoot = realpathSync(path.resolve(opt.webRoot));
  const writeLog = opt.logger ?? (line => process.stdout.write(JSON.stringify(line) + '\n'));
  const log = line => { if (opt.log) writeLog({ time: new Date().toISOString(), ...line }); };

  const state = {
    ranges: opt.ranges ?? loadRanges(),
    rangesSource: opt.ranges ? 'provided' : 'snapshot',
    rangesRefreshedAt: null,
    draining: false,
  };

  const baseHeaders = securityHeaders();
  const devHeaders = {
    ...baseHeaders,
    // `upgrade-insecure-requests` would rewrite http://localhost subresources to https and break local dev.
    'Content-Security-Policy': baseHeaders['Content-Security-Policy'].replace(/;\s*upgrade-insecure-requests/, ''),
  };
  const limiter = opt.rateLimit > 0 ? new RateLimiter({ perMinute: opt.rateLimit }) : null;
  const cache = new LRU(opt.cacheBytes);

  async function doRefresh() {
    try {
      const fresh = await refreshRanges(opt.fetchImpl ?? globalThis.fetch);
      state.ranges = fresh;
      state.rangesSource = 'live';
      state.rangesRefreshedAt = new Date().toISOString();
      log({ msg: 'openai-ranges-refreshed', counts: Object.fromEntries(Object.entries(fresh.bots).map(([k, v]) => [k, v.prefixes.length])) });
    } catch (err) {
      log({ level: 'warn', msg: 'openai-ranges-refresh-failed', error: String(err?.message ?? err), using: state.rangesSource });
    }
  }
  let refreshTimer = null;
  if (opt.refreshOpenAIRanges) {
    doRefresh();
    refreshTimer = setInterval(doRefresh, DAY_MS);
    refreshTimer.unref();
  }

  function clientIP(req) {
    if (opt.trustProxy) {
      const cf = req.headers['cf-connecting-ip'];
      if (cf) return String(cf).trim();
      const xff = req.headers['x-forwarded-for'];
      if (xff) return String(xff).split(',')[0].trim();
    }
    return req.socket.remoteAddress ?? '';
  }

  function headersFor(req) {
    const tls = req.socket.encrypted || (opt.trustProxy && req.headers['x-forwarded-proto'] === 'https');
    return !tls && isLoopbackHost(req.headers.host) ? devHeaders : baseHeaders;
  }

  function send(req, res, status, body, headers = {}) {
    const buf = body == null ? null : Buffer.isBuffer(body) ? body : Buffer.from(String(body));
    res.writeHead(status, {
      ...headersFor(req),
      ...(buf ? { 'Content-Length': buf.length } : {}),
      ...headers,
    });
    res.end(req.method === 'HEAD' ? undefined : buf ?? undefined);
  }

  function sendJSON(req, res, status, obj, extra = {}) {
    send(req, res, status, JSON.stringify(obj, null, 2) + '\n', {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extra,
    });
  }

  function policyDocument() {
    return {
      operator: 'Cerebro OS',
      openai: {
        blocked: true,
        message: BLOCK_MESSAGE.trim(),
        userAgentTokens: OPENAI_USER_AGENTS,
        userAgentPattern: OPENAI_UA_PATTERN.source,
        deniedHosts: OPENAI_DENY_HOSTS,
        refererOriginBlocking: true,
        ipRanges: {
          source: state.ranges.source ?? null,
          origin: state.rangesSource,
          snapshotTakenAt: state.ranges.snapshotTakenAt ?? null,
          refreshedAt: state.rangesRefreshedAt,
          autoRefresh: Boolean(opt.refreshOpenAIRanges),
          bots: Object.fromEntries(Object.entries(state.ranges.bots ?? {}).map(([bot, v]) => [
            bot, { count: v.prefixes?.length ?? 0, creationTime: v.creationTime ?? null },
          ])),
        },
        exemptPaths: [...POLICY_EXEMPT_PATHS],
      },
      egressAllowlist: CONNECT_ALLOWLIST,
      contentSecurityPolicy: baseHeaders['Content-Security-Policy'],
      rateLimitPerMinute: opt.rateLimit > 0 ? opt.rateLimit : null,
    };
  }

  /** Load a file (with cache) → { body, etag, type, variants: Map<enc, {body, etag}> }. */
  async function loadFile(absPath, stat) {
    const key = absPath;
    const hit = cache.get(key);
    if (hit && hit.value.mtimeMs === stat.mtimeMs && hit.value.size === stat.size) return hit.value;
    const body = await fsp.readFile(absPath);
    const hash = createHash('sha256').update(body).digest('base64url').slice(0, 27);
    const type = MIME[path.extname(absPath).toLowerCase()] ?? 'application/octet-stream';
    const entry = { body, etag: `"${hash}"`, hash, type, mtimeMs: stat.mtimeMs, size: stat.size, variants: new Map() };
    if (body.length <= MAX_CACHEABLE_FILE) cache.set(key, entry, body.length);
    return entry;
  }

  async function variant(absPath, entry, enc) {
    if (!enc || entry.body.length < 512 || !COMPRESSIBLE.test(entry.type)) return null;
    let v = entry.variants.get(enc);
    if (!v) {
      const body = enc === 'br'
        ? await brotli(entry.body, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: entry.body.length } })
        : await gzip(entry.body, { level: 9 });
      if (body.length >= entry.body.length) return null;
      v = { body, etag: `"${entry.hash}-${enc}"` };
      entry.variants.set(enc, v);
      // Account for compressed bytes in the LRU budget by re-inserting with the new total size.
      const total = entry.body.length + [...entry.variants.values()].reduce((n, x) => n + x.body.length, 0);
      if (entry.body.length <= MAX_CACHEABLE_FILE) cache.set(absPath, entry, total);
    }
    return v;
  }

  async function statFile(abs) {
    try {
      const real = await fsp.realpath(abs);
      if (real !== webRoot && !real.startsWith(webRoot + path.sep)) return null; // symlink escape
      const st = await fsp.stat(real);
      return { real, st };
    } catch { return null; }
  }

  async function serveFile(req, res, abs, st, status = 200) {
    const entry = await loadFile(abs, st);
    const enc = negotiateEncoding(req.headers['accept-encoding']);
    const v = await variant(abs, entry, enc);
    const etag = v ? v.etag : entry.etag;
    const base = path.basename(abs);
    const cacheControl = status !== 200 ? 'no-cache'
      : entry.type.startsWith('text/html') || NO_CACHE_FILES.has(base) ? 'no-cache'
      : 'public, max-age=3600, must-revalidate';
    const headers = {
      'Content-Type': entry.type,
      'Cache-Control': cacheControl,
      ETag: etag,
      'Last-Modified': new Date(st.mtimeMs).toUTCString(),
      ...(COMPRESSIBLE.test(entry.type) ? { Vary: 'Accept-Encoding' } : {}),
      ...(v ? { 'Content-Encoding': enc } : {}),
    };
    if (status === 200 && etagMatches(req.headers['if-none-match'], etag)) {
      delete headers['Content-Type'];
      res.writeHead(304, { ...headersFor(req), ...headers });
      return res.end();
    }
    send(req, res, status, v ? v.body : entry.body, headers);
  }

  async function serveNotFound(req, res) {
    const f = await statFile(path.join(webRoot, '404.html'));
    if (f && f.st.isFile()) return serveFile(req, res, f.real, f.st, 404);
    send(req, res, 404, 'Not found\n', { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' });
  }

  async function serveStatic(req, res, rawPath, query) {
    const r = resolveRequestPath(rawPath);
    if (r.error === 400) return send(req, res, 400, 'Bad request\n', { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    if (r.error) return serveNotFound(req, res);
    const abs = path.join(webRoot, ...r.segments);
    if (abs !== webRoot && !abs.startsWith(webRoot + path.sep)) return send(req, res, 400, 'Bad request\n');
    let f = await statFile(abs);
    if (!f) return serveNotFound(req, res);
    if (f.st.isDirectory()) {
      if (!r.trailingSlash && r.segments.length) {
        const location = '/' + r.segments.map(encodeURIComponent).join('/') + '/' + (query ? '?' + query : '');
        return send(req, res, 301, null, { Location: location, 'Cache-Control': 'no-cache' });
      }
      f = await statFile(path.join(f.real, 'index.html'));
      if (!f || !f.st.isFile()) return serveNotFound(req, res);
    } else if (!f.st.isFile()) {
      return serveNotFound(req, res);
    }
    return serveFile(req, res, f.real, f.st);
  }

  async function handle(req, res) {
    const started = process.hrtime.bigint();
    const rawUrl = req.url || '/';
    const qi = rawUrl.indexOf('?');
    const rawPath = qi >= 0 ? rawUrl.slice(0, qi) : rawUrl;
    const query = qi >= 0 ? rawUrl.slice(qi + 1) : '';
    const ip = clientIP(req);
    const ua = req.headers['user-agent'];

    res.on('finish', () => {
      log({
        msg: 'access', method: req.method, path: rawPath.slice(0, 512), status: res.statusCode,
        ms: Number(process.hrtime.bigint() - started) / 1e6, ip, ua: uaClass(ua),
      });
    });

    // 1. OpenAI agents (UA, published IP ranges, ChatGPT referer/origin). robots.txt / ai.txt stay readable.
    if (!POLICY_EXEMPT_PATHS.has(rawPath)) {
      const verdict = classifyRequest({ userAgent: ua, ip, referer: req.headers.referer, origin: req.headers.origin }, state.ranges);
      if (verdict.blocked) {
        log({ level: 'warn', msg: 'openai-blocked', reason: verdict.reason, bot: verdict.bot, ip, path: rawPath.slice(0, 512), ua: String(ua ?? '').slice(0, 256) });
        return send(req, res, 403, BLOCK_MESSAGE, {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Robots-Tag': 'noindex, nofollow, noarchive',
        });
      }
    }

    // 2. Methods.
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return send(req, res, 405, 'Method not allowed\n', { Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    }

    // 3. Probes (exempt from rate limiting so orchestrators never get 429).
    if (rawPath === '/healthz') return sendJSON(req, res, 200, { status: 'ok' });
    if (rawPath === '/readyz') {
      return state.draining
        ? sendJSON(req, res, 503, { status: 'draining' })
        : sendJSON(req, res, 200, { status: 'ready' });
    }

    // 4. Rate limiting.
    if (limiter) {
      const r = limiter.take(ip);
      if (!r.ok) {
        return send(req, res, 429, 'Too many requests\n', {
          'Retry-After': String(r.retryAfter), 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store',
        });
      }
    }

    if (rawPath === '/api/policy') return sendJSON(req, res, 200, policyDocument(), { 'Cache-Control': 'no-cache' });

    return serveStatic(req, res, rawPath, query);
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch(err => {
      log({ level: 'error', msg: 'request-failed', error: String(err?.stack ?? err) });
      if (!res.headersSent) send(req, res, 500, 'Internal server error\n', { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      else res.destroy();
    });
  });
  server.headersTimeout = 15_000;
  server.requestTimeout = 30_000;
  server.keepAliveTimeout = 5_000;
  server.on('clientError', (err, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
  });
  server.on('close', () => { limiter?.stop(); if (refreshTimer) clearInterval(refreshTimer); });

  /** Mark not-ready, stop accepting connections, and resolve once in-flight requests finish. */
  server.drain = () => new Promise(resolve => {
    state.draining = true;
    server.close(() => resolve());
    server.closeIdleConnections?.();
  });
  server.policyState = state;
  return server;
}

// ---------------------------------------------------------------------------
// Process entry point (only when run directly)
// ---------------------------------------------------------------------------

function workerCount(v) {
  if (!v) return 1;
  if (v === 'auto') return Math.max(1, os.availableParallelism?.() ?? os.cpus().length);
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function startWorker() {
  const port = Number(process.env.PORT || 8080);
  const host = process.env.HOST || '0.0.0.0';
  const server = createServer();
  server.listen(port, host, () => {
    if (process.env.LOG !== '0') {
      process.stdout.write(JSON.stringify({ time: new Date().toISOString(), msg: 'listening', host, port, pid: process.pid }) + '\n');
    }
  });
  let stopping = false;
  const shutdown = signal => {
    if (stopping) return;
    stopping = true;
    process.stdout.write(JSON.stringify({ time: new Date().toISOString(), msg: 'shutdown', signal, pid: process.pid }) + '\n');
    setTimeout(() => process.exit(1), 10_000).unref();
    server.drain().then(() => process.exit(0));
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

function startPrimary(n) {
  process.stdout.write(JSON.stringify({ time: new Date().toISOString(), msg: 'cluster-start', workers: n, pid: process.pid }) + '\n');
  let stopping = false;
  for (let i = 0; i < n; i++) cluster.fork();
  cluster.on('exit', (worker, code, signal) => {
    if (stopping) {
      if (Object.keys(cluster.workers ?? {}).length === 0) process.exit(0);
      return;
    }
    process.stdout.write(JSON.stringify({ time: new Date().toISOString(), level: 'warn', msg: 'worker-exit', pid: worker.process.pid, code, signal }) + '\n');
    setTimeout(() => cluster.fork(), 1000).unref();
  });
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    for (const w of Object.values(cluster.workers ?? {})) w?.process.kill('SIGTERM');
    setTimeout(() => process.exit(0), 12_000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const n = workerCount(process.env.WORKERS);
  if (n > 1 && cluster.isPrimary) startPrimary(n);
  else startWorker();
}

export { envDefaults };
