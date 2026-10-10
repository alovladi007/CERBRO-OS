// Cerebro OS — marketing site. Progressive enhancement only: theme toggle,
// mobile menu and pricing period toggle. No dependencies, no network requests.

const root = document.documentElement;
root.classList.add('js');
const THEME_KEY = 'cerebro-theme';
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

/* ---------------- Theme ---------------- */
function readTheme() {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch { return null; }
}
function writeTheme(value) {
  try { localStorage.setItem(THEME_KEY, value); } catch { /* storage unavailable */ }
}
function currentTheme() {
  const set = root.getAttribute('data-theme');
  if (set === 'light' || set === 'dark') return set;
  return darkQuery.matches ? 'dark' : 'light';
}
function syncThemeUI() {
  const isDark = currentTheme() === 'dark';
  const label = isDark ? 'Switch to light theme' : 'Switch to dark theme';
  for (const btn of document.querySelectorAll('.theme-toggle')) {
    btn.setAttribute('aria-pressed', String(isDark));
    btn.setAttribute('aria-label', label);
    btn.title = label;
  }
  const meta = document.querySelector('meta[name="theme-color"]:not([media])');
  if (meta) meta.content = isDark ? '#121211' : '#fafaf7';
}
function applyTheme(theme) {
  if (theme === 'light' || theme === 'dark') root.setAttribute('data-theme', theme);
  syncThemeUI();
}
applyTheme(readTheme());

function initThemeToggle() {
  for (const btn of document.querySelectorAll('.theme-toggle')) {
    btn.addEventListener('click', () => {
      const next = currentTheme() === 'dark' ? 'light' : 'dark';
      writeTheme(next);
      applyTheme(next);
    });
  }
  darkQuery.addEventListener?.('change', syncThemeUI);
}

/* ---------------- Mobile menu (disclosure) ---------------- */
function initMenu() {
  const btn = document.querySelector('.menu-btn');
  const nav = document.getElementById('site-nav');
  if (!btn || !nav) return;
  const isOpen = () => btn.getAttribute('aria-expanded') === 'true';
  const setOpen = (open) => {
    btn.setAttribute('aria-expanded', String(open));
    btn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    nav.classList.toggle('open', open);
  };
  btn.addEventListener('click', () => setOpen(!isOpen()));
  nav.addEventListener('click', (e) => { if (e.target.closest('a')) setOpen(false); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) { setOpen(false); btn.focus(); }
  });
  document.addEventListener('click', (e) => {
    if (isOpen() && !nav.contains(e.target) && !btn.contains(e.target)) setOpen(false);
  });
  window.matchMedia('(min-width: 881px)').addEventListener?.('change', (m) => { if (m.matches) setOpen(false); });
}

/* ---------------- Pricing period ---------------- */
function initBilling() {
  const group = document.querySelector('.billing');
  if (!group) return;
  const buttons = [...group.querySelectorAll('[data-billing]')];
  const set = (mode) => {
    buttons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.billing === mode)));
    for (const el of document.querySelectorAll('[data-monthly][data-annual]')) {
      const v = el.dataset[mode];
      if (v != null) el.textContent = v;
    }
  };
  buttons.forEach((b) => b.addEventListener('click', () => set(b.dataset.billing)));
  group.hidden = false;
  set('monthly');
}

function boot() {
  initThemeToggle();
  syncThemeUI();
  initMenu();
  initBilling();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
