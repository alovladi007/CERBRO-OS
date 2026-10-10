// Cerebro OS — single source of truth for network egress and AI-crawler policy.
// Imported by the browser (fetch guard), the Node server (CSP + bot blocking) and the tests.

/** Research APIs the workspace may call. Everything else is refused by CSP and the fetch guard. */
export const CONNECT_ALLOWLIST = Object.freeze([
  'https://www.ebi.ac.uk',              // Europe PMC REST API
  'https://eutils.ncbi.nlm.nih.gov',    // NCBI E-utilities (PubMed)
  'https://clinicaltrials.gov',         // ClinicalTrials.gov API v2
  'https://api.dandiarchive.org',       // DANDI Archive API
  'https://openneuro.org',              // OpenNeuro GraphQL
]);

/** OpenAI / ChatGPT hosts the platform must never contact, embed, or be embedded by. */
export const OPENAI_DENY_HOSTS = Object.freeze([
  'openai.com', 'api.openai.com', 'chatgpt.com', 'chat.openai.com', 'cdn.openai.com', 'oaistatic.com', 'oaiusercontent.com', 'openai.azure.com', 'sora.com',
]);

/** User-agent tokens published by OpenAI for its crawlers and agents (https://platform.openai.com/docs/bots). */
export const OPENAI_USER_AGENTS = Object.freeze(['GPTBot', 'ChatGPT-User', 'OAI-SearchBot', 'ChatGPT-Agent', 'ChatGPT', 'OpenAI']);

export const OPENAI_UA_PATTERN = /\b(GPTBot|ChatGPT-User|OAI-SearchBot|ChatGPT-Agent|ChatGPT|OpenAI)\b/i;

export function isOpenAIHost(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/\.$/, '');
  return OPENAI_DENY_HOSTS.some(d => h === d || h.endsWith('.' + d)) || /(^|\.)openai\./.test(h);
}

/** Decide whether the browser may fetch a URL. Same-origin requests are always allowed. */
export function egressDecision(url, origin) {
  let u;
  try { u = new URL(url, origin); } catch { return { allowed: false, reason: 'Malformed URL' }; }
  if (isOpenAIHost(u.hostname)) return { allowed: false, reason: 'OpenAI/ChatGPT endpoints are blocked by Cerebro OS policy' };
  if (origin && u.origin === new URL(origin).origin) return { allowed: true };
  if (u.protocol !== 'https:') return { allowed: false, reason: 'Only HTTPS research endpoints are permitted' };
  if (CONNECT_ALLOWLIST.includes(u.origin)) return { allowed: true };
  return { allowed: false, reason: `${u.origin} is not on the research egress allowlist` };
}

/** Content-Security-Policy applied by every deployment target. */
export function contentSecurityPolicy() {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self' ${CONNECT_ALLOWLIST.join(' ')}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    'upgrade-insecure-requests',
  ].join('; ');
}

/** HTTP security headers shared by the Node server and static-host configs. */
export function securityHeaders() {
  return {
    'Content-Security-Policy': contentSecurityPolicy(),
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=(), browsing-topics=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
    // Per-agent robots directives (Google-style UA scoping) plus a generic no-AI-training signal.
    'X-Robots-Tag': 'GPTBot: noindex, nofollow, noarchive, nosnippet, noimageindex; ChatGPT-User: noindex, nofollow, noarchive, nosnippet; OAI-SearchBot: noindex, nofollow, noarchive, nosnippet; noai, noimageai',
  };
}
