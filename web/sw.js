// Cerebro OS service worker: offline app shell. Analysis tools work offline;
// live research APIs are never cached (always network) so results stay current.
const VERSION = 'cerebro-1.1.1';
const SHELL = [
  '/app/', '/app/index.html', '/app/app.css', '/assets/css/tokens.css', '/assets/favicon.svg', '/manifest.webmanifest', '/assets/js/theme-init.js',
  '/assets/fonts/inter-var.woff2', '/assets/fonts/source-serif-4-var.woff2', '/assets/fonts/source-serif-4-var-italic.woff2', '/assets/fonts/ibm-plex-mono-400.woff2', '/assets/fonts/ibm-plex-mono-500.woff2',
  '/app/js/boot.mjs', '/app/js/main.mjs', '/app/js/guard.mjs', '/app/js/policy.mjs', '/app/js/store.mjs', '/app/js/ui.mjs', '/app/js/charts.mjs', '/app/js/sources.mjs',
  '/app/js/views/overview.mjs', '/app/js/views/evidence.mjs', '/app/js/views/screening.mjs', '/app/js/views/datasets.mjs', '/app/js/views/lab.mjs', '/app/js/views/protocols.mjs', '/app/js/views/library.mjs', '/app/js/views/settings.mjs',
  '/app/js/views/lab/cohort.mjs', '/app/js/views/lab/stats.mjs', '/app/js/views/lab/regression.mjs', '/app/js/views/lab/survival.mjs', '/app/js/views/lab/signal.mjs', '/app/js/views/lab/meta.mjs', '/app/js/views/lab/power.mjs',
  '/lib/science.mjs', '/lib/stats.mjs', '/lib/meta.mjs', '/lib/power.mjs', '/lib/signal.mjs', '/lib/csv.mjs', '/lib/worker.mjs',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  // Network first (fresh code after deploys), cache fallback (offline).
  e.respondWith(fetch(e.request).then(res => {
    if (res.ok && SHELL.includes(url.pathname)) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request).then(hit => hit || (e.request.mode === 'navigate' ? caches.match('/app/index.html') : Response.error()))));
});
