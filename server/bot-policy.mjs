// Cerebro OS — OpenAI agent blocking for the Node server.
// Classifies a request by user agent, client IP (OpenAI's published crawler ranges) and
// Referer/Origin (ChatGPT browsing / canvas embedding). Zero dependencies.
import { readFileSync } from 'node:fs';
import { OPENAI_UA_PATTERN, isOpenAIHost } from '../web/app/js/policy.mjs';

export const OPENAI_RANGE_URLS = Object.freeze({
  gptbot: 'https://openai.com/gptbot.json',
  'chatgpt-user': 'https://openai.com/chatgpt-user.json',
  searchbot: 'https://openai.com/searchbot.json',
});

export const SNAPSHOT_URL = new URL('./openai-ranges.json', import.meta.url);

export const BLOCK_MESSAGE = 'Access by OpenAI agents is not permitted by the Cerebro OS operator.\n';

// ---------------------------------------------------------------------------
// IP parsing and CIDR matching (IPv4, IPv6, IPv4-mapped IPv6)
// ---------------------------------------------------------------------------

/** Parse dotted-quad IPv4 into a BigInt, or null. Rejects leading zeros / out-of-range octets. */
export function parseIPv4(s) {
  const parts = s.split('.');
  if (parts.length !== 4) return null;
  let n = 0n;
  for (const p of parts) {
    if (!/^(0|[1-9]\d{0,2})$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = (n << 8n) | BigInt(v);
  }
  return n;
}

/** Parse an IPv6 address (with optional embedded IPv4 tail and zone id) into a BigInt, or null. */
export function parseIPv6(input) {
  let s = input.replace(/%.*$/, '');
  if (!s.includes(':')) return null;
  let tail = [];
  const lastColon = s.lastIndexOf(':');
  const maybeV4 = s.slice(lastColon + 1);
  if (maybeV4.includes('.')) {
    const v4 = parseIPv4(maybeV4);
    if (v4 === null) return null;
    tail = [Number(v4 >> 16n), Number(v4 & 0xffffn)];
    s = s.slice(0, lastColon + 1);           // keep the separator…
    if (!s.endsWith('::')) s = s.slice(0, -1); // …unless it is a lone ':' before the IPv4 tail
  }
  const dbl = s.indexOf('::');
  if (dbl !== s.lastIndexOf('::')) return null;
  const toGroups = str => (str === '' ? [] : str.split(':'));
  let head, rest;
  if (dbl >= 0) {
    head = toGroups(s.slice(0, dbl));
    rest = toGroups(s.slice(dbl + 2));
  } else {
    head = toGroups(s);
    rest = [];
  }
  const all = [...head, ...rest];
  for (const g of all) if (!/^[0-9a-f]{1,4}$/i.test(g)) return null;
  const nums = g => g.map(x => parseInt(x, 16));
  const explicit = all.length + tail.length;
  let groups;
  if (dbl >= 0) {
    if (explicit > 7) return null;
    groups = [...nums(head), ...new Array(8 - explicit).fill(0), ...nums(rest), ...tail];
  } else {
    if (explicit !== 8) return null;
    groups = [...nums(head), ...tail];
  }
  let n = 0n;
  for (const g of groups) n = (n << 16n) | BigInt(g);
  return n;
}

export const MAPPED_PREFIX = 0xffffn << 32n; // ::ffff:0:0/96

/**
 * Parse an IP string into { family: 4|6, value: BigInt }. IPv4-mapped IPv6 (::ffff:a.b.c.d)
 * is normalised to IPv4. Accepts bracketed IPv6 ("[::1]") and strips IPv4 ":port" suffixes.
 */
export function parseIP(input) {
  if (typeof input !== 'string') return null;
  let s = input.trim();
  if (!s) return null;
  const bracket = /^\[([^\]]+)\](?::\d+)?$/.exec(s);
  if (bracket) s = bracket[1];
  else if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(s)) s = s.replace(/:\d+$/, '');
  const v4 = parseIPv4(s);
  if (v4 !== null) return { family: 4, value: v4 };
  const v6 = parseIPv6(s);
  if (v6 === null) return null;
  if (v6 >> 32n === MAPPED_PREFIX >> 32n) return { family: 4, value: v6 & 0xffffffffn };
  return { family: 6, value: v6 };
}

/** Parse "addr/bits" into { family, bits, network } (network masked). Throws on invalid input. */
export function parseCIDR(cidr) {
  const m = /^([^/]+)\/(\d{1,3})$/.exec(String(cidr).trim());
  if (!m) throw new Error(`Invalid CIDR: ${cidr}`);
  const ip = parseIP(m[1]);
  if (!ip) throw new Error(`Invalid CIDR address: ${cidr}`);
  let bits = Number(m[2]);
  // An IPv4-mapped IPv6 CIDR (::ffff:a.b.c.d/120) is converted to its IPv4 equivalent.
  if (ip.family === 4 && m[1].includes(':')) bits -= 96;
  const width = ip.family === 4 ? 32 : 128;
  if (bits < 0 || bits > width) throw new Error(`Invalid CIDR prefix length: ${cidr}`);
  const shift = BigInt(width - bits);
  return { family: ip.family, bits, network: (ip.value >> shift) << shift, shift };
}

/** True if `ip` (string or parsed) falls inside `cidr` (string or parsed). */
export function ipInCIDR(ip, cidr) {
  const a = typeof ip === 'string' ? parseIP(ip) : ip;
  const c = typeof cidr === 'string' ? parseCIDR(cidr) : cidr;
  if (!a || !c || a.family !== c.family) return false;
  return (a.value >> c.shift) << c.shift === c.network;
}

// ---------------------------------------------------------------------------
// Range snapshots
// ---------------------------------------------------------------------------

/** Load the bundled snapshot of OpenAI's published ranges (server/openai-ranges.json). */
export function loadRanges(file = SNAPSHOT_URL) {
  const data = JSON.parse(readFileSync(file, 'utf8'));
  validateRanges(data);
  return data;
}

export function validateRanges(data) {
  if (!data || typeof data !== 'object' || !data.bots || typeof data.bots !== 'object') {
    throw new Error('Ranges document must have a "bots" object');
  }
  for (const [bot, entry] of Object.entries(data.bots)) {
    if (!Array.isArray(entry?.prefixes)) throw new Error(`Ranges for ${bot} must have a prefixes array`);
    for (const p of entry.prefixes) parseCIDR(p);
  }
  return data;
}

/**
 * Fetch OpenAI's three published range files and return a document with the snapshot schema.
 * Throws if any file cannot be fetched or parsed — callers decide how to fall back.
 */
export async function refreshRanges(fetchImpl = globalThis.fetch, { timeoutMs = 10_000 } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('No fetch implementation available');
  const bots = {};
  for (const [bot, url] of Object.entries(OPENAI_RANGE_URLS)) {
    const res = await fetchImpl(url, {
      headers: { accept: 'application/json', 'user-agent': 'cerebro-os-range-refresh/1.0' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`${url} returned HTTP ${res.status}`);
    const json = await res.json();
    if (!Array.isArray(json?.prefixes)) throw new Error(`${url} has no prefixes array`);
    const prefixes = [];
    for (const p of json.prefixes) {
      const cidr = typeof p === 'string' ? p : p?.ipv4Prefix ?? p?.ipv6Prefix;
      if (!cidr) continue;
      parseCIDR(cidr); // validate; throws on garbage
      prefixes.push(cidr);
    }
    if (prefixes.length === 0) throw new Error(`${url} contained no usable prefixes`);
    bots[bot] = { creationTime: json.creationTime ?? null, prefixes };
  }
  return {
    source: 'https://openai.com/{gptbot,chatgpt-user,searchbot}.json',
    snapshotTakenAt: new Date().toISOString().slice(0, 10),
    bots,
  };
}

// Compiled CIDR tables are cached per ranges document.
const compiledCache = new WeakMap();

function compile(ranges) {
  let table = compiledCache.get(ranges);
  if (table) return table;
  table = [];
  for (const [bot, entry] of Object.entries(ranges?.bots ?? {})) {
    for (const p of entry.prefixes ?? []) {
      try { table.push({ bot, cidr: p, ...parseCIDR(p) }); } catch { /* skip invalid */ }
    }
  }
  compiledCache.set(ranges, table);
  return table;
}

/** Return { bot, cidr } of the first OpenAI range containing `ip`, or null. */
export function matchRange(ip, ranges) {
  const parsed = typeof ip === 'string' ? parseIP(ip) : ip;
  if (!parsed) return null;
  for (const r of compile(ranges)) {
    if (r.family === parsed.family && (parsed.value >> r.shift) << r.shift === r.network) {
      return { bot: r.bot, cidr: r.cidr };
    }
  }
  return null;
}

function hostOf(value) {
  if (!value || value === 'null') return null;
  try { return new URL(value).hostname; } catch { return null; }
}

/**
 * Classify a request. Returns { blocked, reason, bot }.
 *  - reason 'user-agent': UA matches an OpenAI crawler/agent token
 *  - reason 'ip-range':   client IP is inside a published OpenAI range
 *  - reason 'referer' / 'origin': request was initiated from an OpenAI/ChatGPT page
 */
export function classifyRequest({ userAgent, ip, referer, origin } = {}, ranges) {
  const ua = String(userAgent ?? '');
  const m = OPENAI_UA_PATTERN.exec(ua);
  if (m) return { blocked: true, reason: 'user-agent', bot: m[1] };
  if (ip && ranges) {
    const hit = matchRange(ip, ranges);
    if (hit) return { blocked: true, reason: 'ip-range', bot: hit.bot, cidr: hit.cidr };
  }
  const refHost = hostOf(referer);
  if (refHost && isOpenAIHost(refHost)) return { blocked: true, reason: 'referer', bot: refHost };
  const originHost = hostOf(origin);
  if (originHost && isOpenAIHost(originHost)) return { blocked: true, reason: 'origin', bot: originHost };
  return { blocked: false, reason: null, bot: null };
}

/** Coarse UA class for access logs (keeps raw UAs out of the log stream). */
export function uaClass(userAgent) {
  const ua = String(userAgent ?? '');
  if (!ua) return 'none';
  if (OPENAI_UA_PATTERN.test(ua)) return 'openai';
  if (/bot|crawl|spider|slurp|fetch|curl|wget|python|go-http|java\/|node|axios|httpclient|headless/i.test(ua)) return 'bot';
  if (/mozilla\//i.test(ua)) return 'browser';
  return 'other';
}
