import { store } from '../store.mjs';
import { $, $$, esc, icon, pageHead, notice, empty, toast, download, confirmDialog, modal } from '../ui.mjs';
import { recordHTML, wireRecords, exportDialog } from './evidence.mjs';

export function exportWorkspace() {
  download(`cerebro-workspace-${new Date().toISOString().slice(0, 10)}.json`, store.exportJSON());
  toast('Workspace exported. Keep the file somewhere safe.', 'good');
}

async function restore(e) {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  try {
    if (f.size > 100e6) throw Error('Backup must be smaller than 100 MB.');
    const data = JSON.parse(await f.text());
    const { normalize } = await import('../store.mjs');
    const preview = normalize(data);
    if (!await confirmDialog(`Replace this browser’s workspace with the backup (${preview.projects.length} project(s), ${preview.projects.reduce((a, p) => a + p.papers.length, 0)} records)? Export the current workspace first if you need it.`, { confirmLabel: 'Restore backup', danger: true })) return;
    store.replace(data);
    toast('Workspace restored.', 'good');
    location.hash = 'overview';
  } catch (x) { toast(x.message || 'Unable to read this backup.', 'error'); }
}

function runsSection() {
  const runs = store.project.runs;
  return `<div class="section-head" id="runs"><h2>Analysis provenance</h2><span class="muted small">${runs.length} runs · method version, timestamp and SHA-256 of inputs</span></div>
    <div class="card">${runs.length ? `<div class="table-wrap"><table><thead><tr><th>Tool</th><th>When</th><th>Method</th><th>Input fingerprint</th><th></th></tr></thead><tbody>${runs.slice(0, 200).map((r, i) => `<tr><td><strong>${esc(r.tool)}</strong></td><td>${new Date(r.at).toLocaleString()}</td><td class="mono">${esc(r.methodVersion)}</td><td class="mono" title="${esc(r.inputSha256 || '')}">${esc((r.inputSha256 || 'n/a').slice(0, 16))}…</td><td><button class="btn small" data-view="${i}">View</button> <button class="btn small" data-dl="${i}">${icon('download', 13)}</button></td></tr>`).join('')}</tbody></table></div>
      <div class="actions"><button class="btn small" id="dl-runs">${icon('download', 14)} Export all runs</button><button class="btn small danger" id="clear-runs">Clear history</button></div>` : '<p class="muted">No runs yet. Every analysis in the lab is recorded here automatically.</p>'}</div>`;
}

export function render(main, { params }) {
  const p = store.project;
  main.innerHTML = pageHead('Library', 'Keep the evidence in view.', 'Saved records, analysis provenance and portable backups for this project.', `<button class="btn" id="exp">${icon('download', 15)} Export workspace</button><label class="btn" for="restore">${icon('upload', 15)} Restore backup</label><input type="file" id="restore" accept="application/json,.json" hidden>`)
    + notice(`Saved in this browser (${esc(store.backend)}). Export a backup to move between devices — the file also restores AXON v0.1 exports.`)
    + `<div class="section-head"><h2>Saved records <span class="muted">(${p.papers.length})</span></h2><div class="inline"><input id="lib-q" placeholder="Filter saved records…" aria-label="Filter saved records" style="width:220px"><button class="btn small" id="exp-refs">${icon('download', 14)} Export references</button></div></div>
      <section class="card" id="lib-list"></section>` + runsSection();
  const draw = () => {
    const q = ($('#lib-q').value || '').toLowerCase(), list = p.papers.filter(r => !q || JSON.stringify([r.title, r.authors, r.journal, r.doi]).toLowerCase().includes(q));
    $('#lib-list').innerHTML = list.length ? list.map((r, i) => recordHTML(r, i, { saved: true, showSave: false })).join('') : empty(p.papers.length ? 'No records match.' : 'Your reading collection is ready to grow.', p.papers.length ? '' : '<a href="#evidence">Find publications and trials in Evidence search →</a>');
    wireRecords($('#lib-list'), list);
    $$('[data-remove]').forEach(b => b.onclick = () => { store.update(pr => { pr.papers = pr.papers.filter(x => x.key !== b.dataset.remove); delete pr.screening[b.dataset.remove]; }); draw(); toast('Record removed.'); });
  };
  $('#lib-q').oninput = draw;
  draw();
  $('#exp').onclick = exportWorkspace;
  $('#restore').onchange = restore;
  $('#exp-refs').onclick = () => p.papers.length ? exportDialog(p.papers, 'cerebro-references') : toast('Save some records first.');
  $$('[data-view]').forEach(b => b.onclick = () => modal(`<h2>${esc(p.runs[Number(b.dataset.view)].tool)}</h2><pre class="policy" style="max-height:60vh">${esc(JSON.stringify(p.runs[Number(b.dataset.view)], null, 2))}</pre>`, { wide: true }));
  $$('[data-dl]').forEach(b => b.onclick = () => { const r = p.runs[Number(b.dataset.dl)]; download(`cerebro-${r.tool}-${r.id.slice(0, 8)}.json`, JSON.stringify(r, null, 2)); });
  $('#dl-runs')?.addEventListener('click', () => download('cerebro-provenance.json', JSON.stringify({ project: p.name, exportedAt: new Date().toISOString(), runs: p.runs }, null, 2)));
  $('#clear-runs')?.addEventListener('click', async () => { if (await confirmDialog('Clear all analysis history for this project?', { confirmLabel: 'Clear', danger: true })) { store.update(pr => { pr.runs = []; }); render(main, { params }); } });
  if (params[0] === 'runs') setTimeout(() => $('#runs')?.scrollIntoView({ behavior: 'smooth' }), 50);
}
