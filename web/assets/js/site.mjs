// Cerebro OS — marketing site interactivity (no dependencies, no third-party requests).

const root = document.documentElement;
root.classList.add('js');
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const THEME_KEY = 'cerebro-theme';

/* ---------------- Theme ---------------- */
function readTheme() {
  try { return localStorage.getItem(THEME_KEY); } catch { return null; }
}
function writeTheme(value) {
  try { localStorage.setItem(THEME_KEY, value); } catch { /* storage unavailable */ }
}
function currentTheme() {
  const set = root.getAttribute('data-theme');
  if (set === 'light' || set === 'dark') return set;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
function applyTheme(theme) {
  if (theme === 'light' || theme === 'dark') root.setAttribute('data-theme', theme);
  const isDark = currentTheme() === 'dark';
  for (const btn of document.querySelectorAll('.theme-toggle')) {
    btn.setAttribute('aria-pressed', String(isDark));
    btn.setAttribute('aria-label', isDark ? 'Switch to light theme' : 'Switch to dark theme');
    btn.title = btn.getAttribute('aria-label');
  }
  document.dispatchEvent(new CustomEvent('cerebro:theme'));
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
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
    if (!root.hasAttribute('data-theme')) applyTheme(null);
  });
}

/* ---------------- Mobile menu ---------------- */
function initMenu() {
  const btn = document.querySelector('.menu-btn');
  const nav = document.getElementById('site-nav');
  if (!btn || !nav) return;
  const setOpen = (open) => {
    btn.setAttribute('aria-expanded', String(open));
    btn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    nav.classList.toggle('open', open);
  };
  btn.addEventListener('click', () => setOpen(btn.getAttribute('aria-expanded') !== 'true'));
  nav.addEventListener('click', (e) => { if (e.target.closest('a')) setOpen(false); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && btn.getAttribute('aria-expanded') === 'true') { setOpen(false); btn.focus(); }
  });
  document.addEventListener('click', (e) => {
    if (btn.getAttribute('aria-expanded') === 'true' && !nav.contains(e.target) && !btn.contains(e.target)) setOpen(false);
  });
  window.matchMedia('(min-width: 881px)').addEventListener?.('change', (m) => { if (m.matches) setOpen(false); });
}

/* ---------------- Tabs ---------------- */
function initTabs() {
  for (const list of document.querySelectorAll('[role="tablist"]')) {
    const tabs = [...list.querySelectorAll('[role="tab"]')];
    const panels = tabs.map((t) => document.getElementById(t.getAttribute('aria-controls')));
    const select = (i, focus) => {
      tabs.forEach((t, j) => {
        const on = i === j;
        t.setAttribute('aria-selected', String(on));
        t.tabIndex = on ? 0 : -1;
        if (panels[j]) {
          panels[j].hidden = !on;
          if (on) panels[j].classList.add('in');
        }
      });
      if (focus) tabs[i].focus();
    };
    tabs.forEach((t, i) => {
      t.addEventListener('click', () => select(i, false));
      t.addEventListener('keydown', (e) => {
        let n = null;
        if (e.key === 'ArrowRight') n = (i + 1) % tabs.length;
        else if (e.key === 'ArrowLeft') n = (i - 1 + tabs.length) % tabs.length;
        else if (e.key === 'Home') n = 0;
        else if (e.key === 'End') n = tabs.length - 1;
        if (n !== null) { e.preventDefault(); select(n, true); }
      });
    });
    const start = Math.max(0, tabs.findIndex((t) => t.getAttribute('aria-selected') === 'true'));
    select(start, false);
  }
}

/* ---------------- Pricing toggle ---------------- */
function initBilling() {
  const buttons = [...document.querySelectorAll('[data-billing]')];
  if (!buttons.length) return;
  const set = (mode) => {
    buttons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.billing === mode)));
    for (const el of document.querySelectorAll('[data-price], [data-period], [data-billed]')) {
      const v = el.dataset[mode];
      if (v != null) el.textContent = v;
    }
  };
  buttons.forEach((b) => b.addEventListener('click', () => set(b.dataset.billing)));
  set('monthly');
}

/* ---------------- Scroll reveal ---------------- */
function initReveal() {
  const els = document.querySelectorAll('.reveal');
  if (reduceMotion.matches || !('IntersectionObserver' in window)) {
    els.forEach((el) => el.classList.add('in'));
    return;
  }
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    }
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
  els.forEach((el) => io.observe(el));
}

/* ---------------- Neural canvas ---------------- */
function parseColor(str) {
  const s = str.trim();
  if (s.startsWith('#')) {
    let h = s.slice(1);
    if (h.length === 3) h = [...h].map((c) => c + c).join('');
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const m = s.match(/\d+(\.\d+)?/g);
  return m ? m.slice(0, 3).map(Number) : [91, 77, 255];
}

function initNeural(canvas) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  let w = 0, h = 0, dpr = 1, nodes = [], colors = {}, raf = 0, visible = true, last = 0;

  const readColors = () => {
    const cs = getComputedStyle(root);
    colors = {
      a: parseColor(cs.getPropertyValue('--accent') || '#5b4dff'),
      b: parseColor(cs.getPropertyValue('--accent-2') || '#0ea5c6'),
      dark: currentTheme() === 'dark',
    };
  };

  const resize = () => {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = Math.max(1, r.width); h = Math.max(1, r.height);
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const count = Math.round(Math.min(90, Math.max(28, (w * h) / 14000)));
    nodes = Array.from({ length: count }, () => ({
      x: Math.random() * w, y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.22, vy: (Math.random() - 0.5) * 0.22,
      r: 1.2 + Math.random() * 2.2, mix: Math.random(), phase: Math.random() * Math.PI * 2,
    }));
  };

  const mixColor = (t, alpha) => {
    const c = colors.a.map((v, i) => Math.round(v + (colors.b[i] - v) * t));
    return `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
  };

  const draw = (time = 0) => {
    ctx.clearRect(0, 0, w, h);
    const link = Math.min(150, Math.max(90, w / 9));
    const lineBase = colors.dark ? 0.38 : 0.3;
    for (let i = 0; i < nodes.length; i++) {
      const p = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const q = nodes[j];
        const dx = p.x - q.x, dy = p.y - q.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < link * link) {
          const a = (1 - Math.sqrt(d2) / link) * lineBase;
          ctx.strokeStyle = mixColor((p.mix + q.mix) / 2, a);
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
        }
      }
    }
    for (const p of nodes) {
      const pulse = 0.65 + 0.35 * Math.sin(time / 900 + p.phase);
      ctx.fillStyle = mixColor(p.mix, (colors.dark ? 0.9 : 0.75) * pulse);
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
    }
  };

  const step = (time) => {
    raf = 0;
    const dt = Math.min(48, time - (last || time)); last = time;
    for (const p of nodes) {
      p.x += p.vx * dt * 0.06; p.y += p.vy * dt * 0.06;
      if (p.x < -10) p.x = w + 10; else if (p.x > w + 10) p.x = -10;
      if (p.y < -10) p.y = h + 10; else if (p.y > h + 10) p.y = -10;
    }
    draw(time);
    schedule();
  };

  const schedule = () => {
    if (!raf && visible && !reduceMotion.matches && !document.hidden) raf = requestAnimationFrame(step);
  };
  const stop = () => { if (raf) cancelAnimationFrame(raf); raf = 0; last = 0; };

  readColors(); resize(); draw();
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([e]) => { visible = e.isIntersecting; visible ? schedule() : stop(); }).observe(canvas);
  }
  let rt = 0;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { resize(); draw(); }, 150); });
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : schedule()));
  document.addEventListener('cerebro:theme', () => { readColors(); draw(); });
  reduceMotion.addEventListener?.('change', () => { if (reduceMotion.matches) { stop(); draw(); } else schedule(); });
  schedule();
}

/* ---------------- Boot ---------------- */
function boot() {
  initThemeToggle();
  applyTheme(null);
  initMenu();
  initTabs();
  initBilling();
  initReveal();
  document.querySelectorAll('canvas[data-neural]').forEach(initNeural);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
