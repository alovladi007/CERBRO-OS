import { store } from '../store.mjs';
import { $, $$, esc, icon, pageHead, notice, empty, toast, download } from '../ui.mjs';
import { prismaDiagram } from '../charts.mjs';
import { fetchAbstract } from '../sources.mjs';
import { toCSV } from '../../../lib/csv.mjs';

export const REASONS = ['Wrong population', 'Wrong intervention / exposure', 'Wrong comparator', 'Wrong outcome', 'Wrong study design', 'Not primary research', 'Duplicate', 'Other'];
const ui = { mode: 'queue', index: 0, filter: 'unscreened', history: [] };

export function prismaCounts(p) {
  const decisions = p.papers.map(r => p.screening[r.key]).filter(Boolean);
  const bySource = {};
  let identified = 0, duplicates = 0;
  for (const s of Object.values(p.identified || {})) { for (const [k, v] of Object.entries(s.totals || {})) { bySource[k] = (bySource[k] || 0) + v; identified += v; } duplicates += s.duplicates || 0; }
  const saved = p.papers.length;
  if (!identified) { identified = saved; }
  const excludeReasons = {};
  decisions.filter(d => d.decision === 'exclude').forEach(d => { excludeReasons[d.reason || 'No reason recorded'] = (excludeReasons[d.reason || 'No reason recorded'] || 0) + 1; });
  return { identified, bySource, duplicates, notSaved: Math.max(0, identified - duplicates - saved), saved, screened: decisions.filter(d => d.decision !== 'maybe').length, excluded: decisions.filter(d => d.decision === 'exclude').length, excludeReasons, included: decisions.filter(d => d.decision === 'include').length, maybe: decisions.filter(d => d.decision === 'maybe').length, unscreened: saved - decisions.length };
}

function queue(p) {
  return p.papers.filter(r => ui.filter === 'all' ? true : ui.filter === 'unscreened' ? !p.screening[r.key] : p.screening[r.key]?.decision === ui.filter);
}

function decide(rec, decision, reason = null) {
  const prev = store.project.screening[rec.key];
  ui.history.push({ key: rec.key, prev });
  store.update(p => { p.screening[rec.key] = { decision, reason: decision === 'exclude' ? (reason || 'Other') : null, at: new Date().toISOString() }; });
  if (ui.filter === 'all') ui.index++;
}
function undo() {
  const h = ui.history.pop();
  if (!h) { toast('Nothing to undo.'); return; }
  store.update(p => { if (h.prev) p.screening[h.key] = h.prev; else delete p.screening[h.key]; });
  toast('Last decision undone.');
}

function drawQueue() {
  const p = store.project, list = queue(p), box = $('#screen-body');
  const c = prismaCounts(p), total = p.papers.length || 1;
  $('#progress').innerHTML = `<i class="inc" style="width:${c.included / total * 100}%"></i><i class="exc" style="width:${c.excluded / total * 100}%"></i><i class="may" style="width:${c.maybe / total * 100}%"></i>`;
  $('#progress-label').textContent = `${c.included + c.excluded + c.maybe} of ${p.papers.length} screened · ${c.included} included · ${c.excluded} excluded · ${c.maybe} maybe`;
  if (ui.index >= list.length) ui.index = Math.max(0, list.length - 1);
  const rec = list[ui.index];
  if (!rec) { box.innerHTML = empty(ui.filter === 'unscreened' ? 'Screening complete for this queue.' : 'No records in this view.', ui.filter === 'unscreened' ? 'Review “Maybe” records or open the PRISMA diagram.' : 'Change the filter above.'); return; }
  const cur = p.screening[rec.key];
  box.innerHTML = `<article class="card screen-card">
    <div class="inline"><span class="tag">${ui.index + 1} / ${list.length}</span>${rec.sources.map(s => `<span class="tag accent">${esc(s)}</span>`).join('')}${rec.type === 'trial' ? '<span class="tag cyan">Clinical trial</span>' : ''}<span class="tag">${esc(rec.year || '')}</span>${cur ? `<span class="tag ${cur.decision === 'include' ? 'good' : cur.decision === 'exclude' ? 'bad' : 'warn'}">Current: ${cur.decision}${cur.reason ? ' · ' + esc(cur.reason) : ''}</span>` : ''}</div>
    <h2>${esc(rec.title)}</h2>
    <div class="muted small">${esc(rec.authors || '')}${rec.journal ? ` · <em>${esc(rec.journal)}</em>` : ''} · <a href="${esc(rec.url)}" target="_blank" rel="noopener noreferrer">Open source record ${icon('external', 12)}</a></div>
    <div class="abstract" id="abs">${rec.abstract ? esc(rec.abstract) : '<span class="muted">Loading abstract…</span>'}</div>
    <div class="decisions">
      <button class="btn include" data-d="include">${icon('check', 15)} Include <kbd>I</kbd></button>
      <button class="btn maybe" data-d="maybe">Maybe <kbd>M</kbd></button>
      <select id="reason" aria-label="Exclusion reason" style="width:auto">${REASONS.map(r => `<option ${cur?.reason === r ? 'selected' : ''}>${r}</option>`).join('')}</select>
      <button class="btn exclude" data-d="exclude">${icon('x', 15)} Exclude <kbd>E</kbd></button>
    </div>
    <div class="inline small muted"><button class="btn small ghost" id="prev">← Previous <kbd>K</kbd></button><button class="btn small ghost" id="next">Next <kbd>J</kbd> →</button><button class="btn small ghost" id="undo">Undo <kbd>U</kbd></button><span>Number keys 1–8 choose an exclusion reason.</span></div>
  </article>`;
  if (!rec.abstract) fetchAbstract(rec).then(a => { rec.abstract = a; const el = $('#abs'); if (el) el.textContent = a || 'No abstract available from the source — screen on title or open the record.'; }).catch(() => { const el = $('#abs'); if (el) el.textContent = 'Abstract unavailable offline. Open the source record.'; });
  $$('[data-d]', box).forEach(b => b.onclick = () => { decide(rec, b.dataset.d, $('#reason').value); drawQueue(); });
  $('#prev').onclick = () => { ui.index = Math.max(0, ui.index - 1); drawQueue(); };
  $('#next').onclick = () => { ui.index = Math.min(list.length - 1, ui.index + 1); drawQueue(); };
  $('#undo').onclick = () => { undo(); drawQueue(); };
}

function drawTable() {
  const p = store.project, list = queue(p), box = $('#screen-body');
  box.innerHTML = list.length ? `<div class="table-wrap"><table><thead><tr><th>Record</th><th>Year</th><th>Source</th><th>Decision</th><th>Reason</th></tr></thead><tbody>${list.map(r => { const d = p.screening[r.key]; return `<tr><td class="wrap"><a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${esc(r.title)}</a></td><td>${esc(r.year || '')}</td><td>${esc(r.sources.join(', '))}</td><td>${d ? `<span class="tag ${d.decision === 'include' ? 'good' : d.decision === 'exclude' ? 'bad' : 'warn'}">${d.decision}</span>` : '<span class="tag">unscreened</span>'}</td><td>${esc(d?.reason || '')}</td></tr>`; }).join('')}</tbody></table></div>` : empty('No records in this view.');
}

function drawPrisma() {
  const c = prismaCounts(store.project);
  $('#screen-body').innerHTML = `<div class="card">${prismaDiagram(c)}<p class="method-note">Counts follow the PRISMA 2020 flow for new systematic reviews. “Records identified” sums hit counts reported by each source for every search in this project; overlapping searches can double count. “Not saved to project” covers records you did not retrieve for screening. Full-text assessment and reports-sought stages should be added when you export for publication.</p><div class="actions"><button class="btn" id="prisma-svg">${icon('download', 14)} Download SVG</button><button class="btn" id="prisma-json">${icon('download', 14)} Counts (JSON)</button></div></div>`;
  $('#prisma-svg').onclick = () => { const svg = $('#screen-body svg').cloneNode(true); svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); svg.insertAdjacentHTML('afterbegin', `<style>${[...document.styleSheets].flatMap(s => { try { return [...s.cssRules].map(r => r.cssText).filter(t => t.startsWith('.chart')); } catch { return []; } }).join('\n').replace(/var\(--[\w-]+\)/g, m => getComputedStyle(document.documentElement).getPropertyValue(m.slice(4, -1)).trim())}</style>`); download('prisma-2020-flow.svg', svg.outerHTML, 'image/svg+xml'); };
  $('#prisma-json').onclick = () => download('prisma-counts.json', JSON.stringify({ generatedAt: new Date().toISOString(), project: store.project.name, ...c }, null, 2));
}

function draw() {
  $$('[data-mode]').forEach(b => b.setAttribute('aria-selected', b.dataset.mode === ui.mode));
  $('#filter-row').hidden = ui.mode === 'prisma';
  ({ queue: drawQueue, table: drawTable, prisma: drawPrisma })[ui.mode]();
}

let keyHandler;
export function render(main) {
  const p = store.project;
  main.innerHTML = pageHead('Systematic review', 'Screen with confidence.', 'Title/abstract screening with recorded reasons, keyboard shortcuts and a live PRISMA 2020 flow diagram.', `<button class="btn" id="export-decisions">${icon('download', 15)} Export decisions</button>`)
    + (p.papers.length ? '' : notice('No records saved in this project yet. Run a search in <a href="#evidence">Evidence search</a> and save records to screen them here.'))
    + `<div class="tabs" role="tablist">${[['queue', 'Screening queue'], ['table', 'All decisions'], ['prisma', 'PRISMA 2020 diagram']].map(([k, l]) => `<button class="tab" role="tab" data-mode="${k}">${l}</button>`).join('')}</div>
      <div id="filter-row" class="filters"><label>Show <select id="filter">${[['unscreened', 'Unscreened'], ['maybe', 'Maybe'], ['include', 'Included'], ['exclude', 'Excluded'], ['all', 'All records']].map(([k, l]) => `<option value="${k}" ${ui.filter === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label><span class="muted small" id="progress-label"></span></div>
      <div class="progress" id="progress" style="margin-bottom:16px"></div>
      <div id="screen-body"></div>`;
  $$('[data-mode]').forEach(b => b.onclick = () => { ui.mode = b.dataset.mode; draw(); });
  $('#filter').onchange = e => { ui.filter = e.target.value; ui.index = 0; draw(); };
  $('#export-decisions').onclick = () => download('screening-decisions.csv', toCSV(['key', 'title', 'year', 'doi', 'pmid', 'decision', 'reason', 'decidedAt', 'url'], p.papers.map(r => { const d = p.screening[r.key] || {}; return [r.key, r.title, r.year, r.doi, r.pmid, d.decision || 'unscreened', d.reason || '', d.at || '', r.url]; })), 'text/csv');
  if (keyHandler) document.removeEventListener('keydown', keyHandler);
  keyHandler = e => {
    if (!location.hash.startsWith('#screening')) { document.removeEventListener('keydown', keyHandler); return; }
    if (ui.mode !== 'queue' || e.target.matches('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey || document.querySelector('dialog[open]')) return;
    const k = e.key.toLowerCase();
    if (/^[1-8]$/.test(k)) { const sel = $('#reason'); if (sel) sel.selectedIndex = Number(k) - 1; return; }
    const map = { i: 'include', e: 'exclude', m: 'maybe' };
    if (map[k]) { $(`[data-d="${map[k]}"]`)?.click(); e.preventDefault(); }
    else if (k === 'j' || k === 'arrowright') $('#next')?.click();
    else if (k === 'k' || k === 'arrowleft') $('#prev')?.click();
    else if (k === 'u') $('#undo')?.click();
  };
  document.addEventListener('keydown', keyHandler);
  draw();
}
