// Cerebro OS — workspace shell: routing, navigation, projects, theme, command palette.
import { store } from './store.mjs';
import { $, $$, esc, icon, toast, modal, closeModal, applyTheme, currentTheme } from './ui.mjs';

export const ROUTES = [
  { id: 'overview', label: 'Overview', icon: 'home', group: 'Workspace', load: () => import('./views/overview.mjs') },
  { id: 'evidence', label: 'Evidence search', icon: 'search', group: 'Evidence', load: () => import('./views/evidence.mjs') },
  { id: 'screening', label: 'Screening & PRISMA', icon: 'filter', group: 'Evidence', count: p => Object.keys(p.screening).length ? `${Object.keys(p.screening).length}/${p.papers.length}` : '' , load: () => import('./views/screening.mjs') },
  { id: 'datasets', label: 'Dataset discovery', icon: 'database', group: 'Evidence', load: () => import('./views/datasets.mjs') },
  { id: 'lab', label: 'Analysis lab', icon: 'flask', group: 'Analyze', load: () => import('./views/lab.mjs') },
  { id: 'protocols', label: 'Study protocols', icon: 'doc', group: 'Write', count: p => p.protocols.length || '', load: () => import('./views/protocols.mjs') },
  { id: 'library', label: 'Library & provenance', icon: 'library', group: 'Write', count: p => p.papers.length || '', load: () => import('./views/library.mjs') },
  { id: 'settings', label: 'Settings & policy', icon: 'settings', group: 'System', load: () => import('./views/settings.mjs') },
];

const main = $('#main');
let renderToken = 0;

function renderNav() {
  const p = store.project, current = (location.hash.slice(1) || 'overview').split('/')[0];
  let group = '';
  $('#nav').innerHTML = ROUTES.map(r => {
    const g = r.group !== group ? `<div class="group">${r.group}</div>` : '';
    group = r.group;
    const c = r.count ? r.count(p) : '';
    return `${g}<a href="#${r.id}" data-nav="${r.id}"${r.id === current ? ' class="active" aria-current="page"' : ''}>${icon(r.icon)}<span>${r.label}</span>${c ? `<span class="count">${c}</span>` : ''}</a>`;
  }).join('');
  $('#project-select').innerHTML = store.state.projects.map(x => `<option value="${x.id}"${x.id === p.id ? ' selected' : ''}>${esc(x.name)}</option>`).join('');
  $('#crumb-project').textContent = p.name;
  const pill = $('#storage-pill');
  pill.classList.toggle('memory', store.backend === 'memory');
  pill.querySelector('span').textContent = store.backend === 'memory' ? 'Not persisted — export a backup' : `Saved locally · ${store.backend}`;
}

function themeIcon() { $('#theme-toggle').innerHTML = icon(currentTheme() === 'dark' ? 'sun' : 'moon'); }

export async function render() {
  const [id, ...rest] = (location.hash.slice(1) || 'overview').split('/');
  const route = ROUTES.find(r => r.id === id) || ROUTES[0];
  const token = ++renderToken;
  $('#crumb').textContent = route.label;
  document.title = `${route.label} · Cerebro OS`;
  renderNav();
  closeNav();
  try {
    const mod = await route.load();
    if (token !== renderToken) return;
    await mod.render(main, { params: rest.map(decodeURIComponent), rerender: render });
  } catch (e) {
    console.error(e);
    main.innerHTML = `<div class="notice warn">${icon('info', 16)}<div>This view failed to load: ${esc(e.message)}. Try reloading the page.</div></div>`;
  }
  if (!location.hash.includes('/')) window.scrollTo(0, 0);
}

// ---------- mobile navigation ----------
function openNav() { $('#sidebar').classList.add('open'); $('#scrim').hidden = false; $('#open-nav').setAttribute('aria-expanded', 'true'); }
function closeNav() { $('#sidebar').classList.remove('open'); $('#scrim').hidden = true; $('#open-nav')?.setAttribute('aria-expanded', 'false'); }
$('#open-nav').onclick = openNav;
$('#close-nav').onclick = closeNav;
$('#scrim').onclick = closeNav;

// ---------- projects ----------
$('#project-select').onchange = e => { store.switchProject(e.target.value); toast(`Switched to “${store.project.name}”`); render(); };
export function promptNewProject() {
  const d = modal(`<h2>New project</h2><p class="muted">Projects keep searches, screening decisions, protocols and analysis history separate.</p><form id="np-form"><label class="field">Project name<input name="name" required maxlength="80" placeholder="e.g. Tau PET and cognitive decline"></label><div class="actions"><button class="btn primary">Create project</button></div></form>`);
  $('#np-form', d).onsubmit = e => { e.preventDefault(); const name = new FormData(e.target).get('name').trim(); if (!name) return; store.createProject(name); closeModal(); toast(`Project “${name}” created`, 'good'); location.hash = 'overview'; render(); };
  setTimeout(() => $('input', d).focus(), 30);
}
$('#new-project').onclick = promptNewProject;

// ---------- theme ----------
$('#theme-toggle').onclick = () => { applyTheme(currentTheme() === 'dark' ? 'light' : 'dark'); themeIcon(); };
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', themeIcon);

// ---------- dialog ----------
$('#dialog-close').onclick = closeModal;
$('#dialog').addEventListener('click', e => { if (e.target === e.currentTarget) closeModal(); });

// ---------- command palette ----------
function commands() {
  const nav = ROUTES.map(r => ({ label: `Go to ${r.label}`, hint: r.group, icon: r.icon, run: () => { location.hash = r.id; } }));
  const lab = [['cohort', 'Cohort explorer'], ['stats', 'Hypothesis tests'], ['regression', 'Regression'], ['survival', 'Survival analysis'], ['signal', 'Signal studio'], ['meta', 'Meta-analysis'], ['power', 'Power & sample size']]
    .map(([id, l]) => ({ label: `Open ${l}`, hint: 'Analysis lab', icon: 'flask', run: () => { location.hash = `lab/${id}`; } }));
  const projects = store.state.projects.filter(p => p.id !== store.project.id).map(p => ({ label: `Switch to project: ${p.name}`, hint: 'Project', icon: 'folder', run: () => { store.switchProject(p.id); render(); } }));
  const actions = [
    { label: 'New project…', hint: 'Action', icon: 'plus', run: promptNewProject },
    { label: 'New study protocol', hint: 'Action', icon: 'doc', run: () => { location.hash = 'protocols/new'; } },
    { label: 'Export workspace backup', hint: 'Action', icon: 'download', run: () => import('./views/library.mjs').then(m => m.exportWorkspace()) },
    { label: 'Toggle light / dark theme', hint: 'Action', icon: 'moon', run: () => $('#theme-toggle').click() },
  ];
  return [...nav, ...lab, ...actions, ...projects];
}
let paletteItems = [], paletteIndex = 0;
function drawPalette() {
  const q = $('#palette-input').value.toLowerCase().trim();
  paletteItems = commands().filter(c => !q || q.split(/\s+/).every(w => c.label.toLowerCase().includes(w) || c.hint.toLowerCase().includes(w))).slice(0, 14);
  paletteIndex = Math.min(paletteIndex, Math.max(0, paletteItems.length - 1));
  $('#palette-list').innerHTML = paletteItems.length ? paletteItems.map((c, i) => `<li role="option" data-i="${i}" aria-selected="${i === paletteIndex}">${icon(c.icon, 16)}<span>${esc(c.label)}</span><small>${esc(c.hint)}</small></li>`).join('') : '<li class="muted">No matching commands</li>';
  $$('#palette-list li[data-i]').forEach(li => { li.onclick = () => runPalette(Number(li.dataset.i)); });
}
function runPalette(i) { const c = paletteItems[i]; if (!c) return; $('#palette').close(); c.run(); }
export function openPalette() { const p = $('#palette'); $('#palette-input').value = ''; paletteIndex = 0; drawPalette(); p.showModal(); $('#palette-input').focus(); }
$('#open-palette').onclick = openPalette;
$('#palette-input').oninput = () => { paletteIndex = 0; drawPalette(); };
$('#palette-input').onkeydown = e => {
  if (e.key === 'ArrowDown') { paletteIndex = (paletteIndex + 1) % Math.max(1, paletteItems.length); drawPalette(); e.preventDefault(); }
  else if (e.key === 'ArrowUp') { paletteIndex = (paletteIndex - 1 + paletteItems.length) % Math.max(1, paletteItems.length); drawPalette(); e.preventDefault(); }
  else if (e.key === 'Enter') { runPalette(paletteIndex); e.preventDefault(); }
};
$('#palette').addEventListener('click', e => { if (e.target === e.currentTarget) e.currentTarget.close(); });
document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('#palette').open ? $('#palette').close() : openPalette(); }
  if (e.key === 'Escape') closeNav();
});

// ---------- boot ----------
window.addEventListener('hashchange', render);
store.subscribe(() => renderNav());
themeIcon();
const { migrated } = await store.load();
if (migrated) toast('Your AXON v0.1 workspace was imported into Cerebro OS.', 'good');
const { setNcbiKey } = await import('./sources.mjs');
setNcbiKey(store.state.settings.ncbiKey);
render();

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('/sw.js').catch(() => { /* offline support optional */ });
}
