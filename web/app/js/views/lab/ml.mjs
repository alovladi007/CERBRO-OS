import { $, $$, esc, icon, notice, empty, table, fmt, metric, logRun, download, compute, toast } from '../../ui.mjs';
import { lab, dataBar, wireDataBar, opts, setDataObject } from '../lab.mjs';
import { MODELS, DEFAULTS } from '../../../../lib/ml.mjs';
import { modelCard, tripodDraft } from '../../../../lib/ml-report.mjs';
import { parseCSV, toCSV } from '../../../../lib/csv.mjs';
import { sha256 } from '../../../../lib/science.mjs';
import { lineChart, barChart, groupScatter } from '../../charts.mjs';

const SECTIONS = [['train', 'Train & validate'], ['clusters', 'Subtype discovery'], ['external', 'External validation']];
const ui = { section: 'train', sel: {}, last: null, lastRef: null, imported: null, extData: null };
// Columns that are usually measured after baseline or encode the outcome: never pre-selected as predictors.
const LEAKY = /time|month|day|week|status|event|death|died|response|change|ongoing|progress|censor|outcome|subtype|cluster/i;
const pct = v => (Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : '—');
const ci = (lo, hi) => (Number.isFinite(lo) ? `${fmt(lo)}–${fmt(hi)}` : '—');

function candidates() {
  return lab.data.profile.filter(c => c.type !== 'text' && c.unique > 1);
}
const kindOf = c => (c.type === 'numeric' || c.type === 'binary' ? 'numeric' : 'categorical');

// ---------- train & validate ----------
function trainView(box) {
  const prof = lab.data.profile, s = ui.sel, cols = candidates();
  const bin = prof.filter(c => c.type === 'binary' || (c.type === 'categorical' && c.unique <= 10));
  const num = prof.filter(c => c.type === 'numeric' || c.type === 'binary');
  const byName = (list, re) => list.find(c => re.test(c.name))?.index;
  s.task ??= byName(prof.filter(c => c.type === 'binary'), /death|event|status/i) != null && byName(num, /os|time|month|survival/i) != null ? 'survival' : 'binary';
  s.y ??= byName(bin, /response|outcome|label|class/i) ?? bin[0]?.index;
  s.t ??= byName(num, /os|time|month|day|survival/i) ?? num[0]?.index;
  s.e ??= byName(prof.filter(c => c.type === 'binary'), /death|event|status/i) ?? prof.find(c => c.type === 'binary')?.index;
  s.model ??= s.task === 'survival' ? 'cox_enet' : 'logit_enet';
  const outcomeIdx = s.task === 'survival' ? [Number(s.t), Number(s.e)] : [Number(s.y)];
  s.xs ??= cols.filter(c => !LEAKY.test(c.name) && !outcomeIdx.includes(c.index)).map(c => c.index);
  const yCol = prof[Number(s.y)], levels = yCol ? [...new Set(lab.data.rows.map(r => r[yCol.index]).filter(v => v !== ''))].sort() : [];
  if (!levels.includes(s.pos)) s.pos = levels.includes('1') ? '1' : levels.at(-1);
  const models = Object.entries(MODELS).filter(([, m]) => m.task === s.task);
  if (!models.some(([k]) => k === s.model)) s.model = models[0][0];
  const P = { ...DEFAULTS[s.model], ...(s.params?.[s.model] || {}) }, enet = /enet/.test(s.model), tree = s.model === 'tree', forest = ['rf', 'rsf'].includes(s.model), boost = /gbm/.test(s.model);
  const groups = prof.filter(c => (c.type === 'categorical' || c.type === 'binary') && c.unique <= 12 && !outcomeIdx.includes(c.index));
  box.innerHTML = `<div class="split"><section class="card"><h2>Train and validate a model</h2><p class="muted small">Cross-validated performance, calibration, subgroup checks and a TRIPOD+AI draft. Preprocessing and tuning are redone inside every training fold, so the estimates are not inflated by leakage.</p>
    <div class="chips">${[['binary', 'Binary outcome'], ['survival', 'Time to event']].map(([k, l]) => `<button class="chip ${s.task === k ? 'on' : ''}" data-task="${k}">${l}</button>`).join('')}</div>
    ${s.task === 'binary'
      ? `<div class="form-grid"><label class="field">Outcome<select id="y">${opts(bin, s.y)}</select></label><label class="field">Positive class<select id="pos">${levels.map(l => `<option ${l === s.pos ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label></div>`
      : `<div class="form-grid"><label class="field">Time<select id="t">${opts(num, s.t)}</select></label><label class="field">Event (1 = event)<select id="e">${opts(prof.filter(c => c.type === 'binary'), s.e)}</select></label>
         <label class="field full">Prediction horizon (same units as time; blank = median event time)<input id="hz" type="number" min="0" step="any" value="${s.horizon ?? ''}"></label></div>`}
    <label class="field">Model<select id="model">${models.map(([k, m]) => `<option value="${k}" ${k === s.model ? 'selected' : ''}>${m.label}</option>`).join('')}</select></label>
    <div class="form-grid">
      ${enet ? `<label class="field">α (1 = LASSO, 0 = ridge)<input data-p="alpha" type="number" min="0" max="1" step="0.05" value="${P.alpha}"></label><label class="field">λ choice<select data-p="lambdaRule"><option value="min" ${P.lambdaRule === 'min' ? 'selected' : ''}>Minimum CV deviance</option><option value="1se" ${P.lambdaRule === '1se' ? 'selected' : ''}>1-SE rule (sparser)</option></select></label>` : ''}
      ${forest || boost ? `<label class="field">Trees<input data-p="nTrees" type="number" min="10" max="2000" step="10" value="${P.nTrees}"></label>` : ''}
      ${tree || boost ? `<label class="field">Max depth<input data-p="maxDepth" type="number" min="1" max="12" value="${P.maxDepth}"></label>` : ''}
      ${!enet ? `<label class="field">Min. leaf size<input data-p="minLeaf" type="number" min="1" max="200" value="${P.minLeaf}"></label>` : ''}
      ${boost ? `<label class="field">Learning rate<input data-p="learningRate" type="number" min="0.001" max="1" step="0.01" value="${P.learningRate}"></label><label class="field">Subsample<input data-p="subsample" type="number" min="0.3" max="1" step="0.1" value="${P.subsample}"></label>` : ''}
    </div>
    <div class="field">Predictors <span class="muted small">(baseline variables only; outcome-like columns are not pre-selected)</span><div class="chips">${cols.filter(c => !outcomeIdx.includes(c.index)).map(c => `<label class="chip"><input type="checkbox" data-x="${c.index}" ${s.xs.includes(c.index) ? 'checked' : ''}> ${esc(c.name)}<span class="muted small">${kindOf(c) === 'categorical' ? 'cat' : ''}</span></label>`).join('')}</div>
      <div class="inline small"><button class="btn small ghost" id="x-all">All</button><button class="btn small ghost" id="x-none">None</button></div></div>
    <div class="form-grid"><label class="field">Folds<select id="folds">${[3, 5, 10].map(k => `<option ${k === (s.folds ?? 5) ? 'selected' : ''}>${k}</option>`).join('')}</select></label><label class="field">Repeats<select id="repeats">${[1, 2, 3, 5].map(k => `<option ${k === (s.repeats ?? 1) ? 'selected' : ''}>${k}</option>`).join('')}</select></label>
      <label class="field">Subgroup check by<select id="sub"><option value="">None</option>${opts(groups, s.sub ?? groups.find(c => /sex|gender/i.test(c.name))?.index ?? '')}</select></label><label class="field">Leave-one-site-out by<select id="site"><option value="">None</option>${opts(groups, s.site ?? groups.find(c => /site|centre|center|hospital|country/i.test(c.name))?.index ?? '')}</select></label>
      <label class="field">Random seed<input id="seed" type="number" step="1" value="${s.seed ?? 2026}"></label><label class="field" style="justify-content:end"><span><input type="checkbox" id="imp" ${s.imp === false ? '' : 'checked'}> Permutation importance</span></label></div>
    <button class="btn primary" id="go" style="width:100%">${icon('sparkle', 16)} Train and cross-validate</button><div class="error" id="err" role="alert"></div></section>
    <section class="card" id="out">${ui.last && ui.lastRef === lab.data ? '' : '<p class="muted">Discrimination with confidence intervals, a calibration plot, feature importance, subgroup and site performance, and exportable model card, model file and TRIPOD+AI draft appear here.</p>'}</section></div>`;
  if (ui.last && ui.lastRef === lab.data) renderTrainResult($('#out'), ui.last);
  $$('[data-task]', box).forEach(b => b.onclick = () => { s.task = b.dataset.task; s.xs = null; s.model = null; trainView(box); });
  const keepForm = () => {
    if ($('#y')) { s.y = Number($('#y').value); s.pos = $('#pos')?.value; } else { s.t = Number($('#t').value); s.e = Number($('#e').value); }
    s.xs = $$('[data-x]', box).filter(c => c.checked).map(c => Number(c.dataset.x));
  };
  $('#model').onchange = () => { keepForm(); s.model = $('#model').value; trainView(box); };
  ['#y', '#t', '#e'].forEach(id => { const el = $(id); if (el) el.onchange = () => { keepForm(); trainView(box); }; });
  $('#x-all').onclick = () => $$('[data-x]', box).forEach(c => { c.checked = true; });
  $('#x-none').onclick = () => $$('[data-x]', box).forEach(c => { c.checked = false; });
  $('#go').onclick = async () => {
    const err = $('#err'), out = $('#out'), btn = $('#go'); err.textContent = '';
    try {
      keepForm();
      const d = lab.data, params = {};
      $$('[data-p]', box).forEach(el => { params[el.dataset.p] = el.tagName === 'SELECT' ? el.value : Number(el.value); });
      (s.params ??= {})[s.model] = params;
      s.folds = Number($('#folds').value); s.repeats = Number($('#repeats').value); s.seed = Math.round(Number($('#seed').value) || 2026); s.imp = $('#imp').checked;
      s.sub = $('#sub').value; s.site = $('#site').value; s.horizon = $('#hz') ? $('#hz').value : '';
      const outcome = s.task === 'survival' ? { type: 'survival', time: d.headers[s.t], event: d.headers[s.e] } : { type: 'binary', column: d.headers[s.y], positive: s.pos };
      const exclude = new Set(s.task === 'survival' ? [s.t, s.e] : [s.y]);
      const features = s.xs.filter(i => !exclude.has(i)).map(i => ({ name: d.headers[i], kind: kindOf(d.profile[i]) }));
      if (!features.length) throw Error('Select at least one predictor.');
      const used = [...exclude, ...s.xs.filter(i => !exclude.has(i))], dataSha256 = await sha256(toCSV(used.map(i => d.headers[i]), d.rows.map(r => used.map(i => r[i]))));
      const spec = { headers: d.headers, rows: d.rows, outcome, features, model: s.model, params, folds: s.folds, repeats: s.repeats, seed: s.seed, importance: s.imp,
        subgroup: s.sub === '' ? null : d.headers[Number(s.sub)], site: s.site === '' ? null : d.headers[Number(s.site)], horizon: s.horizon === '' ? undefined : Number(s.horizon) };
      btn.disabled = true; btn.textContent = 'Training… (runs in the background)';
      out.innerHTML = `<p class="muted">Training ${esc(MODELS[s.model].label)} with ${s.folds}-fold cross-validation${s.repeats > 1 ? ` × ${s.repeats}` : ''} on ${d.rows.length.toLocaleString()} rows…</p>`;
      const r = await compute('trainEvaluate', spec);
      const { finalModel, ...summary } = r;
      const run = await logRun('ml-train', { dataset: d.name, dataSha256, outcome, features, model: s.model, params: r.params, folds: r.folds, repeats: r.repeats, seed: r.seed, subgroup: spec.subgroup, site: spec.site, horizon: r.horizon },
        { ...summary, roc: undefined, calibration: r.calibration, finalModel: { type: finalModel.type, trainedOn: finalModel.trainedOn } }, { modelCard: modelCard(r, { dataName: d.name, dataSha256 }) });
      ui.last = { r, run, dataName: d.name, dataSha256 }; ui.lastRef = d;
      renderTrainResult(out, ui.last);
    } catch (x) { err.textContent = x.message; }
    finally { btn.disabled = false; btn.innerHTML = `${icon('sparkle', 16)} Train and cross-validate`; }
  };
}

function calibrationPlot(bins, { title, xLabel = 'Predicted risk', yLabel = 'Observed risk' }) {
  const hi = Math.max(0.05, ...bins.flatMap(b => [b.predicted, b.upper ?? b.observed]));
  return lineChart([
    { label: 'Ideal', points: [[0, 0], [hi, hi]], dashed: true, c: 4 },
    { label: 'Model (risk groups)', points: bins.map(b => [b.predicted, b.observed]), dots: true, c: 0, band: bins.map(b => [b.predicted, b.lower ?? b.observed, b.upper ?? b.observed]) },
  ], { xLabel, yLabel, title, yZero: true });
}

function renderTrainResult(out, { r, run, dataName, dataSha256 }) {
  const surv = r.task === 'survival', p = r.pooled, imp = (r.importance || []).filter(i => Math.abs(i.drop) > 1e-9).slice(0, 15), impZero = (r.importance || []).length - imp.length;
  const head = surv
    ? `<div class="metrics">${metric("Harrell's C (CV)", fmt(r.summary.mean), `fold SD ${fmt(r.summary.sd)} · range ${fmt(r.summary.min)}–${fmt(r.summary.max)}`)}${metric('Pooled out-of-fold C', fmt(p.cIndex), p.cCI ? `bootstrap 95% CI ${ci(p.cCI.lower, p.cCI.upper)}` : '')}${metric(`Brier at ${fmt(r.horizon, 1)}`, fmt(p.brier), `IPA ${pct(p.ipa)} vs Kaplan–Meier`)}${metric('Predicted vs observed risk', `${pct(p.predictedRisk)} / ${pct(p.observedRisk)}`, `at ${fmt(r.horizon, 1)} · ${r.n} patients, ${r.events} events`)}</div>`
    : `<div class="metrics">${metric('AUC (out-of-fold)', fmt(p.auc), `DeLong 95% CI ${ci(p.lower, p.upper)}`)}${metric('AUC by fold', fmt(r.summary.mean), `SD ${fmt(r.summary.sd)} · range ${fmt(r.summary.min)}–${fmt(r.summary.max)}`)}${metric('Calibration', `slope ${fmt(p.calibration.slope, 2)}`, `intercept ${fmt(p.calibration.intercept, 2)} (ideal 1 and 0)`)}${metric('Brier score', fmt(p.brier), `scaled ${pct(p.scaledBrier)} · ${r.n} rows, ${r.positives} positive`)}</div>`;
  const warn = [];
  if (!surv && (p.calibration.slope < 0.8 || p.calibration.slope > 1.2)) warn.push(`Calibration slope ${fmt(p.calibration.slope, 2)}: predictions are ${p.calibration.slope < 1 ? 'too extreme (overfitting)' : 'too modest'}.`);
  if (surv ? r.events < 10 * r.features.length : Math.min(r.positives, r.n - r.positives) < 10 * r.features.length) warn.push(`Fewer than 10 ${surv ? 'events' : 'cases in the smaller class'} per candidate predictor: expect optimism and unstable selection.`);
  if (r.dropped) warn.push(`${r.dropped} rows without an outcome were excluded.`);
  const charts = (surv ? '' : lineChart([{ label: 'ROC (out-of-fold)', points: r.roc, c: 0 }, { label: 'Chance', points: [[0, 0], [1, 1]], dashed: true, c: 4 }], { xLabel: '1 − specificity', yLabel: 'Sensitivity', title: 'ROC curve', yZero: true }))
    + calibrationPlot(r.calibration, { title: surv ? `Calibration at ${r.horizon}` : 'Calibration plot', xLabel: surv ? `Predicted risk by ${fmt(r.horizon, 1)}` : 'Predicted probability', yLabel: surv ? 'Observed risk (Kaplan–Meier)' : 'Observed proportion' });
  const path = r.finalModel.model.cvPath;
  const pathChart = path ? lineChart([{ label: 'CV deviance', points: path.map(q => [q.lambda, q.cvm]), dots: true, c: 0, band: path.map(q => [q.lambda, q.cvm - q.cvsd, q.cvm + q.cvsd]) }], { logX: true, xLabel: 'λ (log scale)', yLabel: 'Cross-validated deviance', title: 'Regularisation path', markers: [{ x: r.finalModel.model.lambdaMin, label: 'min' }, { x: r.finalModel.model.lambda1se, label: '1-SE' }] }) : '';
  out.innerHTML = `<div class="eyebrow">${esc(r.label)} · ${r.folds}-fold CV${r.repeats > 1 ? ` × ${r.repeats}` : ''} · seed ${r.seed} · ${(r.ms / 1000).toFixed(1)} s</div>${head}`
    + (warn.length ? notice(warn.join(' '), 'warn') : '') + charts
    + (imp.length ? `<h3>Permutation importance <span class="muted small">(drop in ${surv ? 'C' : 'AUC'} on held-out folds)</span></h3>` + table(['Predictor', 'Drop', 'SD across folds', ''], imp.map(i => [esc(i.feature), fmt(i.drop), fmt(i.sd), `<span class="ibar" style="width:${Math.max(0, Math.min(100, i.drop / Math.max(1e-9, imp[0].drop) * 100)).toFixed(0)}%"></span>`]), { numeric: [1, 2] }) + (impZero ? `<p class="muted small">${impZero} other predictors changed the held-out ${surv ? 'C' : 'AUC'} by less than 0.001 or not at all.</p>` : '') : '')
    + (r.coefficients ? `<h3>Selected coefficients <span class="muted small">(final model, λ = ${fmt(r.finalModel.model.lambda)}, ${r.coefficients.length} of ${r.finalModel.preprocessor.columns.length} non-zero)</span></h3>` + table(['Term', 'Coefficient', surv ? 'Hazard ratio' : 'Odds ratio'], r.coefficients.map(c => [esc(c.name), fmt(c.coef), fmt(c.ratio)]), { numeric: [1, 2] }) + '<p class="muted small">Penalised coefficients are shrunk towards zero and have no valid confidence intervals; use them to describe the model, not to test hypotheses.</p>' + pathChart : '')
    + (r.subgroups ? `<h3>Subgroups (out-of-fold)</h3>` + table(['Group', 'n', surv ? 'Events' : 'Positive', surv ? 'C' : 'AUC', 'Observed', 'Predicted', ''], r.subgroups.map(g => [esc(g.level), g.n, surv ? g.events : g.positives, fmt(surv ? g.cIndex : g.auc), pct(g.observed), pct(g.predicted), g.small ? '<span class="muted small">small</span>' : '']), { numeric: [1, 2, 3, 4, 5] }) : '')
    + (r.sites?.length ? `<h3>Leave-one-site-out validation</h3><p class="muted small">Each site is predicted by a model trained on the other sites: a rehearsal of external validation.</p>` + table(['Held-out site', 'n', surv ? 'C' : 'AUC', surv ? 'Brier' : 'Calibration slope', 'Observed', 'Predicted'], r.sites.map(x => x.error ? [esc(x.site), x.n, esc(x.error), '', '', ''] : [esc(x.site), x.n, fmt(surv ? x.cIndex : x.auc), fmt(surv ? x.brier : x.slope, surv ? 3 : 2), pct(x.observed), pct(x.predicted)]), { numeric: [1, 2, 3, 4, 5] }) : '')
    + `<details><summary class="small">Per-fold results</summary>${table(['Repeat', 'Fold', 'n', surv ? 'C' : 'AUC', 'Brier', surv ? 'IPA' : 'Slope'], r.perFold.map(f => [f.repeat + 1, f.fold + 1, f.n, fmt(surv ? f.cIndex : f.auc), fmt(f.brier), surv ? pct(f.ipa) : fmt(f.slope, 2)]), { numeric: [2, 3, 4, 5] })}</details>`
    + `<p class="method-note">${surv ? "Harrell's C from survival::concordance conventions; IPCW Brier score (Graf et al. 1999) with the index of prediction accuracy against the Kaplan–Meier null model; calibration compares mean predicted risk with Kaplan–Meier risk in fifths of predicted risk." : 'AUC with DeLong CI (validated against R pROC); calibration intercept (logit offset) and slope (validated against R glm); calibration plot in tenths of predicted risk with Wald 95% intervals.'} Elastic net validated against R glmnet; CART and gradient boosting against scikit-learn. Engine ${esc(r.version)}. Research use only.</p>`
    + `<div class="actions"><button class="btn small" id="dl-model">${icon('download', 14)} Model file</button><button class="btn small" id="dl-card">${icon('download', 14)} Model card</button><button class="btn small" id="dl-tripod">${icon('download', 14)} TRIPOD+AI draft</button><button class="btn small" id="dl-run">${icon('download', 14)} Run record</button><button class="btn small" id="to-ext">Validate on another dataset →</button><span class="muted small mono">sha256 ${run.inputSha256.slice(0, 16)}…</span></div>`;
  $('#dl-model').onclick = () => download(`cerebro-model-${r.model}.json`, JSON.stringify(r.finalModel));
  $('#dl-card').onclick = () => download(`cerebro-model-card-${r.model}.json`, JSON.stringify(modelCard(r, { dataName, dataSha256, runId: run.id }), null, 2));
  $('#dl-tripod').onclick = () => download(`cerebro-tripod-ai-${r.model}.md`, tripodDraft(r, { dataName, dataSha256, runId: run.id }), 'text/markdown');
  $('#dl-run').onclick = () => download('cerebro-ml-run.json', JSON.stringify(run, null, 2));
  $('#to-ext').onclick = () => { ui.section = 'external'; render($('#lab-body')); };
}

// ---------- subtype discovery ----------
function clusterView(box) {
  const s = ui.sel, num = lab.data.profile.filter(c => c.type === 'numeric' || c.type === 'binary');
  s.cx ??= (num.some(c => /gene|expr|_ex$|rna|protein/i.test(c.name)) ? num.filter(c => /gene|expr|_ex$|rna|protein/i.test(c.name)) : num.filter(c => !LEAKY.test(c.name))).map(c => c.index);
  box.innerHTML = `<div class="split"><section class="card"><h2>Subtype discovery</h2><p class="muted small">Standardise, project with PCA, then k-means (k-means++, 10 restarts) for each k. The silhouette width picks k. Clusters are hypotheses: check them against outcomes and in independent data.</p>
    <div class="field">Features<div class="chips">${num.map(c => `<label class="chip"><input type="checkbox" data-cx="${c.index}" ${s.cx.includes(c.index) ? 'checked' : ''}> ${esc(c.name)}</label>`).join('')}</div></div>
    <div class="form-grid"><label class="field">Smallest k<input id="kmin" type="number" min="2" max="10" value="${s.kmin ?? 2}"></label><label class="field">Largest k<input id="kmax" type="number" min="2" max="12" value="${s.kmax ?? 6}"></label><label class="field">Random seed<input id="cseed" type="number" value="${s.cseed ?? 2026}"></label></div>
    <button class="btn primary" id="go" style="width:100%">Find clusters</button><div class="error" id="err" role="alert"></div></section>
    <section class="card" id="out"><p class="muted">A principal-component map coloured by cluster, the silhouette for each k and the cluster profiles appear here. You can add the cluster labels to the dataset, then compare survival by cluster in the Survival or Oncology tab.</p></section></div>`;
  $('#go').onclick = async () => {
    const err = $('#err'), out = $('#out'); err.textContent = '';
    try {
      const d = lab.data;
      s.cx = $$('[data-cx]', box).filter(c => c.checked).map(c => Number(c.dataset.cx)); s.kmin = Number($('#kmin').value); s.kmax = Number($('#kmax').value); s.cseed = Number($('#cseed').value);
      if (s.kmax < s.kmin) throw Error('Largest k must be at least the smallest k.');
      const features = s.cx.map(i => ({ name: d.headers[i], kind: 'numeric' }));
      out.innerHTML = '<p class="muted">Clustering…</p>';
      const r = await compute('clusterAnalysis', { headers: d.headers, rows: d.rows, features, kMin: s.kmin, kMax: s.kmax, seed: s.cseed });
      const run = await logRun('ml-clusters', { dataset: d.name, features: features.map(f => f.name), kMin: s.kmin, kMax: s.kmax, seed: s.cseed }, { runs: r.runs, best: { k: r.best.k, silhouette: r.best.silhouette, sizes: r.best.profile.map(p => p.n) }, explained: r.pca.explained });
      const top = r.best.profile.map(p => { const o = p.center.map((v, j) => [r.columns[j], v]).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 4); return [`Cluster ${p.cluster}`, p.n, o.map(([n, v]) => `${esc(n)} ${v > 0 ? '↑' : '↓'}${fmt(Math.abs(v), 1)}`).join(', ')]; });
      out.innerHTML = `<div class="eyebrow">k-means on ${r.columns.length} standardised features · ${r.n} rows</div><div class="metrics">${metric('Clusters (best k)', r.best.k)}${metric('Silhouette', fmt(r.best.silhouette), r.best.silhouette > 0.5 ? 'strong structure' : r.best.silhouette > 0.25 ? 'moderate structure' : 'weak structure')}${metric('PC1 + PC2 variance', pct(r.pca.explained[0] + (r.pca.explained[1] || 0)))}</div>`
        + groupScatter(r.pca.scores.map((sc, i) => [sc[0], sc[1] ?? 0, r.best.labels[i]]), { xLabel: `PC1 (${pct(r.pca.explained[0])})`, yLabel: `PC2 (${pct(r.pca.explained[1])})`, title: 'Principal components coloured by cluster', labels: r.best.profile.map(p => `Cluster ${p.cluster} (n = ${p.n})`) })
        + barChart(r.runs.map(x => ({ label: `k = ${x.k}`, value: Math.max(0, x.silhouette), text: fmt(x.silhouette, 2) })), { yLabel: 'Mean silhouette', title: 'Silhouette by number of clusters' })
        + '<h3>Cluster profiles <span class="muted small">(largest standardised mean differences)</span></h3>' + table(['Cluster', 'n', 'Distinguishing features (z)'], top, { numeric: [1] })
        + `<p class="method-note">Features are imputed (median), centred and scaled; PCA by symmetric eigendecomposition (validated against scikit-learn); k-means (Lloyd) and silhouette validated against scikit-learn. Engine ${esc(r.version)}.</p>`
        + `<div class="actions"><button class="btn small" id="add-col">Add “cluster” column to the dataset</button><span class="muted small mono">sha256 ${run.inputSha256.slice(0, 16)}…</span></div>`;
      $('#add-col').onclick = async () => {
        const name = d.headers.includes('cluster') ? `cluster_k${r.best.k}` : 'cluster';
        await setDataObject({ ...d, profile: undefined, headers: [...d.headers, name], rows: d.rows.map((row, i) => [...row, `C${r.best.labels[i] + 1}`]) });
        toast(`Added “${name}”. Compare survival by cluster in the Survival tab.`, 'good');
      };
    } catch (x) { err.textContent = x.message; }
  };
}

// ---------- external validation ----------
function externalView(box) {
  const model = ui.imported || ui.last?.r.finalModel, src = ui.imported ? 'Imported model file' : ui.last ? `Last trained: ${MODELS[model.type].label}` : null;
  const target = ui.extData || lab.data;
  box.innerHTML = `<div class="split"><section class="card"><h2>External validation</h2><p class="muted small">Apply a frozen model, without refitting, to data from another site, country or period. Expect performance to drop; calibration usually drifts first.</p>
    <div class="field">Model<div class="muted small">${src ? esc(src) : 'None yet: train one in “Train & validate” or import a model file.'}</div>
      <label class="btn small" for="imp-model" style="margin-top:6px">${icon('upload', 14)} Import model file</label><input type="file" id="imp-model" accept=".json,application/json" hidden></div>
    <div class="field">Validation data<div class="muted small">${target ? `${esc(target.name)} · ${target.rows.length.toLocaleString()} rows${ui.extData ? '' : ' (the dataset loaded in the lab)'}` : 'None'}</div>
      <label class="btn small" for="ext-csv" style="margin-top:6px">${icon('upload', 14)} Load a separate validation CSV</label><input type="file" id="ext-csv" accept=".csv,.tsv,.txt,text/csv" hidden>${ui.extData ? ' <button class="btn small ghost" id="ext-clear">Use the lab dataset</button>' : ''}</div>
    ${model ? `<p class="muted small">Needs columns: ${[...model.features.map(f => f.name), ...(model.task === 'survival' ? [model.outcome.time, model.outcome.event] : [model.outcome.column])].map(n => `<span class="mono">${esc(n)}</span>`).join(', ')}.</p>` : ''}
    <button class="btn primary" id="go" style="width:100%" ${model && target ? '' : 'disabled'}>Validate</button><div class="error" id="err" role="alert"></div></section>
    <section class="card" id="out"><p class="muted">Discrimination and calibration on the new data, plus downloadable predictions. The data never leaves this browser.</p></section></div>`;
  $('#imp-model').onchange = async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try { const m = JSON.parse(await f.text()); if (!m.model || !m.preprocessor || !MODELS[m.type]) throw Error('This file is not a Cerebro OS model.'); ui.imported = m; toast('Model imported.', 'good'); externalView(box); }
    catch (x) { $('#err').textContent = x.message; }
  };
  $('#ext-csv').onchange = async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try { if (f.size > 50e6) throw Error('Choose a file smaller than 50 MB.'); ui.extData = { name: f.name, ...parseCSV(await f.text()) }; externalView(box); }
    catch (x) { $('#err').textContent = x.message; }
  };
  const clr = $('#ext-clear'); if (clr) clr.onclick = () => { ui.extData = null; externalView(box); };
  $('#go').onclick = async () => {
    const err = $('#err'), out = $('#out'); err.textContent = '';
    try {
      const missing = model.features.map(f => f.name).filter(n => !target.headers.includes(n));
      if (missing.length) throw Error(`Missing predictor columns: ${missing.join(', ')}.`);
      const r = await compute('applyModel', model, target.headers, target.rows), surv = model.task === 'survival';
      const run = await logRun('ml-external-validation', { model: model.type, modelTrainedOn: model.trainedOn, dataset: target.name, rows: target.rows.length }, { n: r.n, imputed: r.imputed, unseenLevels: r.unseenLevels, metrics: r.metrics, calibration: r.calibration });
      const m = r.metrics, sameData = !ui.imported && !ui.extData && ui.lastRef === lab.data;
      out.innerHTML = `<div class="eyebrow">Frozen model applied to ${esc(target.name)}</div>`
        + (sameData ? notice('This is the dataset the model was trained on, so these are apparent (optimistic) results, not external validation. Load a separate validation CSV from another site or period.', 'warn') : '')
        + (m ? (surv
          ? `<div class="metrics">${metric("Harrell's C", fmt(m.cIndex), `${m.n} patients, ${m.events} events`)}${metric(`Brier at ${fmt(model.horizon, 1)}`, fmt(m.brier), `IPA ${pct(m.ipa)}`)}${metric('Predicted vs observed risk', `${pct(m.predictedRisk)} / ${pct(m.observedRisk)}`)}</div>`
          : `<div class="metrics">${metric('AUC', fmt(m.auc), `DeLong 95% CI ${ci(m.lower, m.upper)}`)}${metric('Calibration', `slope ${fmt(m.calibration.slope, 2)}`, `intercept ${fmt(m.calibration.intercept, 2)}`)}${metric('Brier', fmt(m.brier), `${m.n} rows, ${m.positives} positive`)}${metric('Mean predicted vs observed', `${pct(m.meanPredicted)} / ${pct(m.observed)}`)}</div>`)
          + (!surv ? lineChart([{ label: 'ROC', points: r.roc, c: 0 }, { label: 'Chance', points: [[0, 0], [1, 1]], dashed: true, c: 4 }], { xLabel: '1 − specificity', yLabel: 'Sensitivity', title: 'ROC curve (external)', yZero: true }) : '')
          + calibrationPlot(r.calibration, { title: 'Calibration (external)', xLabel: 'Predicted risk', yLabel: 'Observed risk' })
          : notice('The outcome columns are not in this dataset, so only predictions are available.'))
        + (r.imputed || r.unseenLevels ? notice(`${r.imputed} missing values were imputed with training medians or modes, and ${r.unseenLevels} unseen category levels were mapped to the reference level.`, 'warn') : '')
        + `<div class="actions"><button class="btn small" id="dl-pred">${icon('download', 14)} Predictions (CSV)</button><span class="muted small mono">sha256 ${run.inputSha256.slice(0, 16)}…</span></div>`;
      $('#dl-pred').onclick = () => download('cerebro-predictions.csv', toCSV(surv ? ['row', 'risk_score', `survival_at_${model.horizon}`] : ['row', 'probability'], r.predictions.map((q, i) => (surv ? [i + 1, q.risk, q.survAtHorizon] : [i + 1, q.prob]))), 'text/csv');
    } catch (x) { err.textContent = x.message; }
  };
}

export function render(body) {
  if (ui.dataRef !== lab.data) { ui.sel = {}; ui.dataRef = lab.data; }
  const needsData = ui.section !== 'external';
  body.innerHTML = notice('Research use only: models here support methods research and hypothesis generation, not individual patient decisions. Use de-identified data; rows stay in this browser.')
    + (needsData || !ui.extData ? dataBar() : '')
    + `<div class="chips" style="margin-bottom:16px">${SECTIONS.map(([k, l]) => `<button class="chip ${ui.section === k ? 'on' : ''}" data-sec="${k}">${l}</button>`).join('')}</div><div id="ml-body"></div>`;
  if (needsData || !ui.extData) wireDataBar(body);
  $$('[data-sec]', body).forEach(b => b.onclick = () => { ui.section = b.dataset.sec; render(body); });
  const box = $('#ml-body');
  if (needsData && !lab.data) { box.innerHTML = empty('Load data to begin.', 'Use “Synthetic biomarker cohort” to try every tool on fictional data with known structure, or load your own de-identified CSV.'); return; }
  ({ train: trainView, clusters: clusterView, external: externalView })[ui.section](box);
}
