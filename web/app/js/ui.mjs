// Cerebro OS — UI helpers shared by all views.
import { store, MAX_RUNS } from './store.mjs';
import { sha256, METHOD_VERSION } from '../../lib/science.mjs';

export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const fmt = (v, d = 3) => v == null || Number.isNaN(v) ? '—' : typeof v !== 'number' ? esc(v) : Number.isInteger(v) && Math.abs(v) < 1e9 ? v.toLocaleString() : Math.abs(v) >= 1e4 || (Math.abs(v) < 1e-3 && v !== 0) ? v.toExponential(2) : v.toFixed(d);
export const fmtP = p => p == null || Number.isNaN(p) ? '—' : p < 0.001 ? '< 0.001' : p.toFixed(3);

const ICONS = {
  home: '<path d="M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  filter: '<path d="M4 5h16l-6 7.5V19l-4 1.5v-8z"/>',
  database: '<ellipse cx="12" cy="5.5" rx="7.5" ry="2.8"/><path d="M4.5 5.5v13c0 1.6 3.4 2.8 7.5 2.8s7.5-1.2 7.5-2.8v-13M4.5 12c0 1.6 3.4 2.8 7.5 2.8s7.5-1.2 7.5-2.8"/>',
  flask: '<path d="M9 3h6M10 3v6L4.5 18.5A1.7 1.7 0 0 0 6 21h12a1.7 1.7 0 0 0 1.5-2.5L14 9V3"/><path d="M7 15h10"/>',
  doc: '<path d="M6 3h8l5 5v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v5h5M8.5 13h7M8.5 17h5"/>',
  library: '<path d="M4 4h4v16H4zM10 4h4v16h-4zM16.5 4.5l3.8 1 -3.8 14.8-3.6-1z"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  upload: '<path d="M12 20V9M7 14l5-5 5 5M5 4h14"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  command: '<path d="M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3z"/>',
  wave: '<path d="M2 12h3l2-6 3 12 3-9 2 5 2-2h5"/>',
  chart: '<path d="M4 20V4M4 20h16M8 16v-4M12 16V8M16 16v-6"/>',
  shield: '<path d="M12 3 4.5 6v6c0 4.5 3.2 7.8 7.5 9 4.3-1.2 7.5-4.5 7.5-9V6z"/><path d="m9 12 2 2 4-4"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  bell: '<path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15zM10 20a2 2 0 0 0 4 0"/>',
  folder: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2h8.5A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/>',
  sparkle: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
};
export const icon = (name, size = 18) => `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;

export function toast(text, kind = 'info') {
  const host = $('#toasts'), el = document.createElement('div');
  el.className = `toast ${kind}`; el.setAttribute('role', kind === 'error' ? 'alert' : 'status'); el.textContent = text;
  host.append(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 3800);
}

export function download(name, text, type = 'application/json') {
  const u = URL.createObjectURL(new Blob([text], { type })), a = document.createElement('a');
  a.href = u; a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 1500);
}

export function modal(html, { wide = false } = {}) {
  const d = $('#dialog');
  d.classList.toggle('wide', wide);
  $('#dialog-body').innerHTML = html;
  if (!d.open) d.showModal();
  return d;
}
export const closeModal = () => $('#dialog').open && $('#dialog').close();

export function confirmDialog(message, { confirmLabel = 'Confirm', danger = false } = {}) {
  return new Promise(resolve => {
    const d = modal(`<h2>Please confirm</h2><p>${esc(message)}</p><div class="actions"><button class="btn ${danger ? 'danger' : 'primary'}" data-ok>${esc(confirmLabel)}</button><button class="btn" data-cancel>Cancel</button></div>`);
    const done = v => { d.close(); resolve(v); };
    $('[data-ok]', d).onclick = () => done(true);
    $('[data-cancel]', d).onclick = () => done(false);
    d.addEventListener('close', () => resolve(false), { once: true });
  });
}

export function pageHead(eyebrow, title, sub, actions = '') {
  return `<header class="page-head"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1>${sub ? `<p class="subtitle">${sub}</p>` : ''}</div>${actions ? `<div class="page-actions">${actions}</div>` : ''}</header>`;
}

export const notice = (html, kind = '') => `<div class="notice ${kind}">${icon(kind === 'warn' ? 'info' : kind === 'good' ? 'shield' : 'info', 16)}<div>${html}</div></div>`;
export const empty = (title, body = '', action = '') => `<div class="empty"><strong>${title}</strong>${body ? `<p>${body}</p>` : ''}${action}</div>`;

/** Record an analysis run with provenance (method version + SHA-256 of inputs). */
export async function logRun(tool, input, result, meta = {}) {
  const inputJSON = JSON.stringify(input);
  const run = { id: crypto.randomUUID(), at: new Date().toISOString(), tool, methodVersion: METHOD_VERSION, inputSha256: await sha256(inputJSON), input: inputJSON.length < 200000 ? input : { omitted: 'Input larger than 200 kB; fingerprint retained.' }, result, ...meta };
  store.update(p => { p.runs.unshift(run); p.runs = p.runs.slice(0, MAX_RUNS); });
  return run;
}

/** Turn a table spec into HTML. */
export function table(headers, rows, { numeric = [] } = {}) {
  return `<div class="table-wrap"><table><thead><tr>${headers.map((h, i) => `<th${numeric.includes(i) ? ' class="num"' : ''}>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map((c, i) => `<td${numeric.includes(i) ? ' class="num"' : ''}>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

export function metric(label, value, sub = '') { return `<div class="metric"><span>${label}</span><strong>${value}</strong>${sub ? `<small>${sub}</small>` : ''}</div>`; }

export function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme; else delete root.dataset.theme;
  try { localStorage.setItem('cerebro-theme', theme); } catch { /* ignore */ }
}
export function currentTheme() {
  const t = document.documentElement.dataset.theme;
  return t || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}

/** Run a function in the shared worker (falls back to main thread). */
let worker, seq = 0;
const pending = new Map();
export function compute(fn, ...args) {
  try {
    if (!worker) {
      worker = new Worker(new URL('../../lib/worker.mjs', import.meta.url), { type: 'module' });
      worker.onmessage = e => { const p = pending.get(e.data.id); if (!p) return; pending.delete(e.data.id); e.data.error ? p.reject(Error(e.data.error)) : p.resolve(e.data.result); };
      worker.onerror = () => { worker = null; };
    }
    const id = ++seq;
    return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); worker.postMessage({ id, fn, args }); });
  } catch {
    return import('../../lib/science.mjs').then(S => S[fn](...args));
  }
}
