import { store } from '../store.mjs';
import { $, $$, esc, icon, pageHead, notice, empty, toast, download, modal } from '../ui.mjs';
import { federatedSearch, fetchAbstract, dedupe, searchEuropePMC, searchPubMed, searchTrials, SOURCES, toBibTeX, toRIS } from '../sources.mjs';
import { toCSV } from '../../../lib/csv.mjs';

// Results survive navigation within the session.
const session = { result: null, query: '', opts: { since: '', openOnly: false, sort: 'relevance' }, selected: ['europepmc', 'pubmed', 'ctgov'], typeFilter: 'all', busy: false };

export function recordHTML(r, i, { saved = false, showSave = true } = {}) {
  const has = store.project.papers.some(x => x.key === r.key);
  const typeTag = r.type === 'trial' ? '<span class="tag cyan">Clinical trial</span>' : r.type === 'preprint' ? '<span class="tag warn">Preprint</span>' : '';
  return `<article class="record" data-i="${i}">
    <div class="row">${r.sources.map(s => `<span class="tag accent">${esc(s)}</span>`).join('')}${typeTag}${r.open ? '<span class="tag good">Open access</span>' : ''}${r.citedBy ? `<span class="tag">Cited by ${r.citedBy}</span>` : ''}<span class="tag">${esc(r.year || 'Year n/a')}</span></div>
    <h3><a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${esc(r.title || 'Untitled record')}</a></h3>
    <div class="meta">${esc(r.authors || 'Authors unavailable')}${r.journal ? ` · <em>${esc(r.journal)}</em>` : ''}${r.doi ? ` · DOI ${esc(r.doi)}` : ''}${r.pmid ? ` · PMID ${esc(r.pmid)}` : ''}</div>
    <div class="abstract-slot"></div>
    <div class="row">
      <button class="btn small ghost" data-abstract="${i}">${icon('doc', 14)} Abstract</button>
      ${showSave ? `<button class="btn small${has ? '' : ' primary'}" data-save="${i}" ${has ? 'disabled' : ''}>${has ? `${icon('check', 14)} Saved` : `${icon('plus', 14)} Save to project`}</button>` : ''}
      ${saved ? `<button class="btn small danger" data-remove="${esc(r.key)}">${icon('trash', 14)} Remove</button>` : ''}
    </div>
  </article>`;
}

export function wireRecords(root, list) {
  $$('[data-abstract]', root).forEach(b => b.onclick = async () => {
    const rec = list[Number(b.dataset.abstract)], slot = b.closest('.record').querySelector('.abstract-slot');
    if (slot.innerHTML) { slot.innerHTML = ''; return; }
    slot.innerHTML = '<div class="loading">Fetching abstract…</div>';
    try { const a = await fetchAbstract(rec); rec.abstract = a; slot.innerHTML = `<div class="abstract">${esc(a || 'No abstract available from the source.')}</div>`; }
    catch { slot.innerHTML = '<div class="abstract">The abstract could not be retrieved. Open the record at its source.</div>'; }
  });
  $$('[data-save]', root).forEach(b => b.onclick = () => {
    const r = list[Number(b.dataset.save)];
    store.update(p => { if (!p.papers.some(x => x.key === r.key)) p.papers.push({ ...r, savedAt: new Date().toISOString(), savedFrom: session.query || null }); });
    b.innerHTML = `${icon('check', 14)} Saved`; b.disabled = true; b.classList.remove('primary');
    toast('Saved to project — ready for screening.', 'good');
  });
}

function sourceStatus(res) {
  return `<div class="source-status">${Object.entries(res.perSource).map(([k, v]) => v.ok
    ? `<a class="tag good" href="${esc(v.link)}" target="_blank" rel="noopener noreferrer" title="Open full result set at source">${SOURCES[k].label}: ${v.total.toLocaleString()} ${icon('external', 12)}</a>`
    : `<span class="tag bad" title="${esc(v.error)}">${SOURCES[k].label}: unavailable</span>`).join('')}${res.duplicates ? `<span class="tag">${res.duplicates} duplicates merged</span>` : ''}</div>`;
}

function drawResults() {
  const box = $('#results'), res = session.result;
  if (!res) { box.innerHTML = empty('A good study starts with a better question.', 'Search a condition, mechanism, intervention or method. Results are merged across sources and link to the original records.'); return; }
  const list = res.records.filter(r => session.typeFilter === 'all' || (session.typeFilter === 'trials' ? r.type === 'trial' : r.type !== 'trial'));
  const failed = Object.values(res.perSource).filter(v => !v.ok).length;
  box.innerHTML = `<div class="section-head" style="margin-top:6px"><h2>${list.length} records shown</h2><div class="inline">
      <div class="seg" role="group" aria-label="Record type">${[['all', 'All'], ['lit', 'Literature'], ['trials', 'Trials']].map(([k, l]) => `<button data-type="${k}" aria-pressed="${session.typeFilter === k}">${l}</button>`).join('')}</div>
      <button class="btn small" id="save-all">${icon('plus', 14)} Save all shown</button>
      <button class="btn small" id="export-results">${icon('download', 14)} Export</button></div></div>`
    + sourceStatus(res)
    + (failed ? notice('One or more sources could not be reached. Results from the remaining sources are shown; nothing has been substituted.', 'warn') : '')
    + (list.length ? `<div class="card">${list.map((r, i) => recordHTML(r, i)).join('')}</div>` : empty('No matching records.', 'Try a broader phrase, a different source, or remove a filter.'))
    + (Object.values(res.perSource).some(v => v.ok && v.next) ? `<div class="actions" style="justify-content:center"><button class="btn" id="more">Load more results</button></div>` : '');
  wireRecords(box, list);
  $$('[data-type]', box).forEach(b => b.onclick = () => { session.typeFilter = b.dataset.type; drawResults(); });
  $('#save-all', box).onclick = () => {
    let n = 0;
    store.update(p => list.forEach(r => { if (!p.papers.some(x => x.key === r.key)) { p.papers.push({ ...r, savedAt: new Date().toISOString(), savedFrom: session.query }); n++; } }));
    toast(`${n} new records saved to the project.`, 'good'); drawResults();
  };
  $('#export-results', box).onclick = () => exportDialog(list, 'cerebro-search');
  const more = $('#more', box);
  if (more) more.onclick = () => loadMore(more);
}

async function loadMore(btn) {
  btn.disabled = true; btn.textContent = 'Loading…';
  const res = session.result, q = res.query, o = res.opts, jobs = [];
  for (const [k, v] of Object.entries(res.perSource)) {
    if (!v.ok || !v.next) continue;
    const run = k === 'europepmc' ? searchEuropePMC(q, { ...o, cursor: v.next }) : k === 'pubmed' ? searchPubMed(q, { ...o, start: v.next }) : searchTrials(q, { ...o, token: v.next });
    jobs.push(run.then(r => { v.next = r.next; return r.records; }).catch(() => { v.next = null; return []; }));
  }
  const more = (await Promise.all(jobs)).flat(), merged = dedupe([...res.records, ...more]);
  res.duplicates += merged.duplicates; res.records = merged.records;
  drawResults();
}

export function exportDialog(list, base) {
  const d = modal(`<h2>Export ${list.length} records</h2><p class="muted">Formats for reference managers (Zotero, EndNote, Mendeley) and spreadsheets.</p><div class="actions"><button class="btn" data-f="bib">BibTeX (.bib)</button><button class="btn" data-f="ris">RIS (.ris)</button><button class="btn" data-f="csv">CSV</button><button class="btn" data-f="json">JSON</button></div>`);
  $$('[data-f]', d).forEach(b => b.onclick = () => {
    const f = b.dataset.f;
    if (f === 'bib') download(`${base}.bib`, toBibTeX(list), 'application/x-bibtex');
    if (f === 'ris') download(`${base}.ris`, toRIS(list), 'application/x-research-info-systems');
    if (f === 'csv') download(`${base}.csv`, toCSV(['title', 'authors', 'year', 'journal', 'doi', 'pmid', 'type', 'sources', 'url'], list.map(r => [r.title, r.authors, r.year, r.journal, r.doi, r.pmid, r.type, r.sources.join('; '), r.url])), 'text/csv');
    if (f === 'json') download(`${base}.json`, JSON.stringify(list, null, 2));
    d.close();
  });
}

async function runSearch() {
  const q = $('#q').value.trim();
  if (!q || session.busy) return;
  session.query = q;
  session.opts = { since: $('#since').value, openOnly: $('#open').checked, sort: $('#sort').value };
  session.selected = $$('[data-src]').filter(c => c.checked).map(c => c.dataset.src);
  if (!session.selected.length) { toast('Select at least one source.', 'error'); return; }
  session.busy = true;
  $('#results').innerHTML = `<div class="loading">Searching ${session.selected.map(s => SOURCES[s].label).join(', ')}…</div>`;
  history.replaceState(null, '', `#evidence/${encodeURIComponent(q)}`);
  try {
    const res = await federatedSearch(q, session.opts, session.selected);
    session.result = res;
    const identified = Object.fromEntries(Object.entries(res.perSource).filter(([, v]) => v.ok).map(([k, v]) => [SOURCES[k].label, v.total]));
    store.update(p => {
      const existing = p.searches.find(s => s.query === q && JSON.stringify(s.opts) === JSON.stringify(session.opts));
      const known = new Set(existing?.knownKeys || []), fresh = res.records.filter(r => !known.has(r.key)).length;
      const entry = { id: existing?.id || crypto.randomUUID(), query: q, opts: session.opts, sources: session.selected, lastRun: res.at, firstRun: existing?.firstRun || res.at, lastCount: res.records.length, totals: identified, newSinceLast: existing ? fresh : null, knownKeys: [...new Set([...known, ...res.records.map(r => r.key)])].slice(-2000) };
      p.searches = [entry, ...p.searches.filter(s => s.id !== entry.id)].slice(0, 100);
      p.identified[q] = { totals: identified, retrieved: res.records.length, duplicates: res.duplicates, at: res.at };
    });
  } catch (e) {
    $('#results').innerHTML = notice(`Search failed: ${esc(e.message)}`, 'warn');
  } finally { session.busy = false; }
  drawResults(); drawSaved();
}

function drawSaved() {
  const box = $('#saved-searches'), list = store.project.searches;
  if (!box) return;
  box.innerHTML = list.length ? list.slice(0, 8).map(s => `<div class="list-row"><div><h3>${esc(s.query)}</h3><p>${new Date(s.lastRun).toLocaleDateString()} · ${s.lastCount} retrieved${s.newSinceLast ? ` · <span class="tag good">${s.newSinceLast} new since previous run</span>` : ''}${s.opts?.since ? ` · since ${s.opts.since}` : ''}</p></div><div class="inline"><button class="btn small" data-rerun="${esc(s.id)}">Re-run</button><button class="icon-btn" data-forget="${esc(s.id)}" aria-label="Forget saved search">${icon('x', 14)}</button></div></div>`).join('')
    : '<p class="muted small">Searches you run are saved here. Re-run one to see how many records are new since last time.</p>';
  $$('[data-rerun]', box).forEach(b => b.onclick = () => {
    const s = store.project.searches.find(x => x.id === b.dataset.rerun);
    $('#q').value = s.query; $('#since').value = s.opts?.since || ''; $('#open').checked = !!s.opts?.openOnly; $('#sort').value = s.opts?.sort || 'relevance';
    $$('[data-src]').forEach(c => { c.checked = (s.sources || ['europepmc', 'pubmed', 'ctgov']).includes(c.dataset.src); });
    runSearch();
  });
  $$('[data-forget]', box).forEach(b => b.onclick = () => { store.update(p => { p.searches = p.searches.filter(x => x.id !== b.dataset.forget); }); drawSaved(); });
}

export function render(main, { params }) {
  const preset = params[0] || '';
  const years = Array.from({ length: 8 }, (_, i) => new Date().getFullYear() - i * (i < 4 ? 1 : 2));
  main.innerHTML = pageHead('Evidence', 'Follow the evidence.', 'One query across Europe PMC, PubMed and ClinicalTrials.gov — merged, de-duplicated and linked to the original records.')
    + `<div class="split"><div class="stack">
        <form class="card" id="search-form">
          <label class="field">Search query<input id="q" type="search" placeholder="e.g. Parkinson disease digital biomarkers" maxlength="500" value="${esc(preset || session.query)}" required></label>
          <div class="field">Sources<div class="inline">${Object.entries(SOURCES).map(([k, v]) => `<label class="check"><input type="checkbox" data-src="${k}" ${session.selected.includes(k) ? 'checked' : ''}> ${v.label}</label>`).join('')}</div></div>
          <div class="form-grid">
            <label class="field">Published / started since<select id="since"><option value="">Any year</option>${years.map(y => `<option ${String(y) === session.opts.since ? 'selected' : ''}>${y}</option>`).join('')}</select></label>
            <label class="field">Sort<select id="sort"><option value="relevance">Relevance</option><option value="date" ${session.opts.sort === 'date' ? 'selected' : ''}>Newest first</option></select></label>
          </div>
          <label class="check"><input type="checkbox" id="open" ${session.opts.openOnly ? 'checked' : ''}> Open access / free full text only</label>
          <div class="actions"><button class="btn primary" style="flex:1">${icon('search', 16)} Search all sources</button></div>
          <p class="hint" style="margin-top:10px">Supports source syntax: quotes, AND/OR/NOT. Query text is sent only to the selected sources.</p>
        </form>
        <section class="card"><h2>Saved searches</h2><div id="saved-searches" style="margin-top:8px"></div></section>
        <section class="card"><h3>Quick topics</h3><div class="chips">${['Alzheimer plasma biomarkers', 'epilepsy EEG deep learning', 'multiple sclerosis MRI', 'stroke rehabilitation', 'ALS clinical trial', 'migraine CGRP'].map(q => `<button class="chip" data-quick="${q}">${q}</button>`).join('')}</div></section>
      </div>
      <div><div id="results"></div></div></div>`;
  $('#search-form').onsubmit = e => { e.preventDefault(); runSearch(); };
  $$('[data-quick]').forEach(b => b.onclick = () => { $('#q').value = b.dataset.quick; runSearch(); });
  drawSaved();
  if (preset && preset !== session.query) runSearch(); else drawResults();
}
