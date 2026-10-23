import { $, $$, esc, icon, pageHead, notice, table, fmt, logRun, download, toast } from '../ui.mjs';
import { modelCall, getRegistry, handoff } from '../models.mjs';
import { sha256 } from '../../../lib/science.mjs';
import { toCSV } from '../../../lib/csv.mjs';

const ui = { status: {}, loaded: {}, text: null, strategy: 'first', minScore: 0.5, hidden: new Set(), last: null };
const mb = b => `${(b / 1e6).toFixed(1)} MB`;
// Entity types → five chart colours, grouped by meaning so the highlight is readable.
const FAMILY = [
  [/Disease|Sign_symptom|Outcome|Severity/, 1], [/Medication|Dosage|Administration|Therapeutic/, 2], [/Diagnostic|Lab_value|Clinical_event/, 3],
  [/Biological_structure|Area|Shape|Texture|Color|Mass|Volume|Height|Weight|Distance/, 4],
];
const fam = t => (FAMILY.find(([re]) => re.test(t))?.[1] ?? 5);

function modelCard(m, st) {
  const files = m.files.map(f => `<li><strong>${esc(f.name)}</strong> · ${mb(f.bytes)} · ${f.bundled ? 'bundled' : ({ cached: 'verified, cached in this browser', hosted: 'hosted on this site', missing: '<strong>not hosted on this site</strong>' }[st?.files?.[f.name]] || 'checking…')}<br><span class="mono">sha256 ${f.sha256}</span></li>`).join('');
  return `<section class="card" id="card-${m.id}"><div class="eyebrow">${esc(m.task)} · ${esc(m.version)}</div><h2>${esc(m.title)}</h2><p>${esc(m.summary)}</p>
    <div class="chips"><span class="chip">${esc(m.license)}</span><span class="chip">${m.commercialUse ? 'Commercial use permitted by licence' : 'Non-commercial licence'}</span><span class="chip">${esc(m.runtime)}</span></div>
    <dl class="kv prose"><dt>Architecture</dt><dd>${esc(m.architecture)}</dd><dt>Source</dt><dd><a href="${esc(m.source.url)}" target="_blank" rel="noopener noreferrer">${esc(m.source.repo)}</a> at <span class="mono">${esc(m.source.revision.slice(0, 7))}</span> (base model ${esc(m.source.baseModel)})</dd>
      <dt>Training data</dt><dd>${esc(m.trainingData)}</dd><dt>Evaluation</dt><dd>${esc(m.evaluatedOn)}</dd><dt>Intended use</dt><dd>${esc(m.intendedUse)}</dd><dt>Citation</dt><dd>${esc(m.citation)}</dd></dl>
    <details><summary class="small">Limitations (${m.limitations.length})</summary><ul class="small">${m.limitations.map(l => `<li>${esc(l)}</li>`).join('')}</ul></details>
    <h3>Files</h3><ul class="file-list small">${files}</ul>
    <div class="actions" id="load-${m.id}">${ui.loaded[m.id] ? `${icon('check', 14)} Loaded and verified (${Object.entries(ui.loaded[m.id].sources).map(([k, v]) => `${esc(k)} from ${esc(v)}`).join('; ')})` : `<button class="btn primary" data-load="${m.id}">${icon('cube', 16)} Load model</button>`}</div>
    <div class="error" id="err-${m.id}" role="alert"></div></section>`;
}

function pickFile(m) {
  const f = m.files.find(x => x.name.endsWith('.onnx'));
  return `${notice(`The model weights are not hosted on this site. Download <a href="${esc(m.source.url)}/blob/${esc(m.source.revision)}/${esc(f.sourcePath)}" target="_blank" rel="noopener noreferrer">${esc(f.sourcePath)}</a> (${mb(f.bytes)}) from the model's source, then choose it below. Cerebro OS checks its SHA-256 before using it and keeps a verified copy in this browser. Site operators can host the weights with <span class="mono">npm run fetch:models</span>.`)}
    <label class="btn small" for="pick-${m.id}">${icon('upload', 14)} Choose ${esc(f.sourcePath.split('/').pop())}</label><input type="file" id="pick-${m.id}" accept=".onnx" hidden>`;
}

function nerPanel(m) {
  const text = ui.text ?? handoff.text ?? m.example;
  handoff.text = null; ui.text = text;
  return `<section class="card" id="run-${m.id}"><h2>Tag entities</h2><p class="muted small">Paste a case report, abstract or methods section. Text stays in this browser. Long texts are split into windows of up to ${m.tokenizer.maxLength} tokens at word boundaries.</p>
    <label class="field">Text<textarea id="ner-text" rows="7">${esc(text)}</textarea></label>
    <div class="form-grid"><label class="field">Output<select id="ner-strategy"><option value="first" ${ui.strategy === 'first' ? 'selected' : ''}>Whole words (label of the first word piece)</option><option value="simple" ${ui.strategy === 'simple' ? 'selected' : ''}>Word pieces (as tokenised)</option></select></label>
      <label class="field">Minimum score<input id="ner-min" type="number" min="0" max="1" step="0.05" value="${ui.minScore}"></label></div>
    <button class="btn primary" id="ner-go" style="width:100%">Tag entities</button><div class="error" id="ner-err" role="alert"></div><div id="ner-out"></div></section>`;
}

function renderEntities(out, text, res, m) {
  const ents = res.entities.filter(e => e.score >= ui.minScore), types = [...new Set(ents.map(e => e.entity))].sort();
  const shown = ents.filter(e => !ui.hidden.has(e.entity));
  let html = '', at = 0;
  for (const e of shown) { if (e.start < at) continue; html += esc(text.slice(at, e.start)) + `<mark class="ent e${fam(e.entity)}" title="${esc(e.entity)} · ${e.score.toFixed(2)}">${esc(text.slice(e.start, e.end))}<small>${esc(e.entity.replace(/_/g, ' '))}</small></mark>`; at = e.end; }
  html += esc(text.slice(at));
  out.innerHTML = `<div class="eyebrow" style="margin-top:16px">${ents.length} entities · ${res.tokens} tokens in ${res.windows} window${res.windows === 1 ? '' : 's'} · ${res.ms} ms</div>
    <div class="chips">${types.map(t => `<label class="chip"><input type="checkbox" data-type="${esc(t)}" ${ui.hidden.has(t) ? '' : 'checked'}> <i class="sw f${fam(t)}"></i>${esc(t.replace(/_/g, ' '))} (${ents.filter(e => e.entity === t).length})</label>`).join('')}</div>
    <div class="ner-text">${html.replace(/\n/g, '<br>')}</div>
    <details><summary class="small">Entity table</summary>${table(['Type', 'Text', 'Score', 'Start', 'End'], shown.map(e => [esc(e.entity), esc(e.text), fmt(e.score), e.start, e.end]), { numeric: [2, 3, 4] })}</details>
    <p class="method-note">${esc(m.title)} (${esc(m.source.repo)} at ${esc(m.source.revision.slice(0, 7))}; ${esc(m.license)}) on ONNX Runtime Web. Tokenizer, model outputs and grouping are checked against Hugging Face tokenizers, onnxruntime and the transformers pipeline. Candidate entities for a human to check: the model's accuracy has not been measured here.</p>
    <div class="actions"><button class="btn small" id="ner-csv">${icon('download', 14)} Entities (CSV)</button><button class="btn small" id="ner-json">${icon('download', 14)} Run record</button><span class="muted small mono">sha256 ${ui.last.run.inputSha256.slice(0, 16)}…</span></div>`;
  $$('[data-type]', out).forEach(c => c.onchange = () => { c.checked ? ui.hidden.delete(c.dataset.type) : ui.hidden.add(c.dataset.type); renderEntities(out, text, res, m); });
  $('#ner-csv').onclick = () => download('cerebro-entities.csv', toCSV(['type', 'text', 'score', 'start', 'end'], ents.map(e => [e.entity, e.text, e.score.toFixed(4), e.start, e.end])), 'text/csv');
  $('#ner-json').onclick = () => download('cerebro-ner-run.json', JSON.stringify(ui.last.run, null, 2));
}

function wireNer(m) {
  $('#ner-go').onclick = async () => {
    const err = $('#ner-err'), out = $('#ner-out'), btn = $('#ner-go'); err.textContent = '';
    try {
      const text = $('#ner-text').value; ui.text = text; ui.strategy = $('#ner-strategy').value; ui.minScore = Math.max(0, Math.min(1, Number($('#ner-min').value) || 0));
      if (!text.trim()) throw Error('Paste some text first.');
      if (text.length > 200000) throw Error('Text is longer than 200,000 characters; split it first.');
      btn.disabled = true; btn.textContent = 'Running…';
      const res = await modelCall('run', { model: m.id, text, strategy: ui.strategy });
      const weights = m.files.find(f => f.name.endsWith('.onnx')).sha256;
      const run = await logRun('model-inference', { model: m.id, version: m.version, weightsSha256: weights, runtime: m.runtime, strategy: ui.strategy, textSha256: await sha256(text), characters: text.length },
        { entities: res.entities.length, byType: Object.fromEntries([...new Set(res.entities.map(e => e.entity))].map(t => [t, res.entities.filter(e => e.entity === t).length])), tokens: res.tokens, windows: res.windows, ms: res.ms, list: res.entities.slice(0, 2000) });
      ui.last = { res, run };
      renderEntities(out, text, res, m);
    } catch (x) { err.textContent = x.message; }
    finally { btn.disabled = false; btn.textContent = 'Tag entities'; }
  };
}

export async function render(main) {
  main.innerHTML = pageHead('Pretrained models', 'Bring vetted models to your text.', 'Open-licence models run in this browser on ONNX Runtime Web. Every file is pinned to a source revision and checked against its SHA-256 before use; nothing you analyse is uploaded.')
    + notice('Research use only: model outputs are candidates for a human to check, not findings, and are not for individual patient decisions.')
    + '<div id="registry"><div class="loading">Reading the model registry…</div></div>';
  let reg;
  try { reg = await getRegistry(); } catch { $('#registry').innerHTML = notice('The model registry could not be read.', 'warn'); return; }
  const draw = () => {
    $('#registry').innerHTML = reg.models.map(m => `<div class="split">${modelCard(m, ui.status[m.id])}<div>${ui.loaded[m.id] && m.task === 'token-classification' ? nerPanel(m) : `<section class="card"><h2>How it works</h2><ol class="small"><li>Load the model. Files come from this site, or from your device if the site does not host the weights.</li><li>Each file's size and SHA-256 are checked against the registry; a mismatch is refused.</li><li>Verified files are kept in this browser's cache, so the next load works offline.</li><li>Inference runs in a background worker on WebAssembly. Every run is logged with the model version and weight hash.</li></ol><p class="muted small">${esc(reg.policy)}</p><button class="btn small ghost" id="clear-cache">Clear cached model files</button></section>`}</div></div>`).join('');
    reg.models.forEach(m => { wireLoad(m); if (ui.loaded[m.id] && m.task === 'token-classification') wireNer(m); });
    const cc = $('#clear-cache'); if (cc) cc.onclick = async () => { await modelCall('clear'); ui.loaded = {}; ui.status = {}; toast('Cached model files removed.'); refresh(); };
  };
  const wireLoad = m => { const b = $(`[data-load="${m.id}"]`); if (b) b.onclick = () => load(m); };
  // file status updates only the model card, so a run in progress in the other panel is not disturbed
  const refresh = async () => { draw(); for (const m of reg.models) { try { ui.status[m.id] = await modelCall('status', { model: m.id }); const c = $(`#card-${m.id}`); if (c) { c.outerHTML = modelCard(m, ui.status[m.id]); wireLoad(m); } } catch { /* status is best effort */ } } };
  const load = async (m, files = null) => {
    const box = $(`#load-${m.id}`), err = $(`#err-${m.id}`); err.textContent = '';
    box.innerHTML = `<span class="muted">Loading and verifying${files ? ' your file' : ''}… (${mb(m.files.reduce((s, f) => s + f.bytes, 0))})</span>`;
    try {
      const r = await modelCall('load', { model: m.id, files }, files ? Object.values(files) : []);
      ui.loaded[m.id] = r; toast(`${m.title} loaded; every file matched its SHA-256.`, 'good'); refresh();
    } catch (x) {
      if (x.code === 'NOT_HOSTED') {
        box.innerHTML = pickFile(m);
        $(`#pick-${m.id}`).onchange = async e => { const f = e.target.files[0]; e.target.value = ''; if (f) load(m, { 'model.onnx': await f.arrayBuffer() }); };
      } else { box.innerHTML = `<button class="btn primary" data-load="${m.id}">${icon('cube', 16)} Load model</button>`; $(`[data-load="${m.id}"]`).onclick = () => load(m); err.textContent = x.message; }
    }
  };
  if (handoff.text) ui.text = null; // text handed over from Evidence replaces the previous text
  refresh();
}
