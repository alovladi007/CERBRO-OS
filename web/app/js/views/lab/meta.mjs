import { $, $$, esc, icon, notice, table, fmt, fmtP, metric, logRun, download, toast } from '../../ui.mjs';
import { parseCSV } from '../../../../lib/csv.mjs';
import { metaAnalyze, eggerTest, leaveOneOut, cumulative, smd, twoByTwo } from '../../../../lib/science.mjs';
import { forestPlot, funnelPlot, lineChart } from '../../charts.mjs';

const DEMO = `study,effect,se
Synthetic A 2019,-0.35,0.12
Synthetic B 2020,-0.18,0.15
Synthetic C 2020,-0.42,0.18
Synthetic D 2021,-0.25,0.10
Synthetic E 2022,-0.05,0.14
Synthetic F 2023,-0.61,0.22
Synthetic G 2024,-0.29,0.09`;
const ui = { data: DEMO, model: 'random', tau: 'REML', hksj: true, scale: 'generic' };

function converter() {
  return `<details class="card flat" style="margin-top:14px"><summary><strong>Effect-size converters</strong> <span class="muted small">— compute an effect and SE, then append a row</span></summary>
    <div class="grid2" style="margin-top:12px"><form id="conv-smd"><h3>Means & SDs → Hedges' g</h3><div class="form-grid">
      <label class="field">Mean 1<input name="m1" type="number" step="any" required></label><label class="field">Mean 2<input name="m2" type="number" step="any" required></label>
      <label class="field">SD 1<input name="s1" type="number" step="any" min="0" required></label><label class="field">SD 2<input name="s2" type="number" step="any" min="0" required></label>
      <label class="field">n 1<input name="n1" type="number" min="2" required></label><label class="field">n 2<input name="n2" type="number" min="2" required></label>
      <label class="field full">Study label<input name="label" required></label></div><button class="btn small">Append row</button></form>
    <form id="conv-2x2"><h3>2×2 counts → log OR / log RR / RD</h3><div class="form-grid">
      <label class="field">Events (treated)<input name="a" type="number" min="0" required></label><label class="field">Non-events (treated)<input name="b" type="number" min="0" required></label>
      <label class="field">Events (control)<input name="c" type="number" min="0" required></label><label class="field">Non-events (control)<input name="d" type="number" min="0" required></label>
      <label class="field">Measure<select name="measure"><option value="OR">log odds ratio</option><option value="RR">log risk ratio</option><option value="RD">risk difference</option></select></label><label class="field">Study label<input name="label" required></label></div><button class="btn small">Append row</button><p class="hint">Zero cells receive a 0.5 continuity correction.</p></form></div></details>`;
}

async function run() {
  const err = $('#meta-err'), out = $('#meta-out'); err.textContent = '';
  try {
    ui.data = $('#meta-data').value; ui.model = $('#model').value; ui.tau = $('#tau').value; ui.hksj = $('#hksj').checked; ui.scale = $('#scale').value;
    const d = parseCSV(ui.data);
    if (d.headers.map(h => h.toLowerCase()).join(',') !== 'study,effect,se') throw Error('Use exactly these headers: study,effect,se');
    if (d.rows.length > 500) throw Error('Use at most 500 studies.');
    const studies = d.rows.map(r => ({ name: r[0], effect: Number(r[1]), se: Number(r[2]) }));
    const opt = { model: ui.model, tau2Method: ui.tau, hksj: ui.model === 'random' && ui.hksj }, r = metaAnalyze(studies, opt), exp = ui.scale === 'log';
    const egger = studies.length >= 3 ? eggerTest(studies) : null, loo = leaveOneOut(studies, opt), cum = cumulative(studies, opt), tr = v => exp ? Math.exp(v) : v;
    const runRec = await logRun('meta-analysis', { studies, ...opt, scale: ui.scale }, { ...r, egger });
    out.innerHTML = `<div class="eyebrow">Pooled effect · ${esc(r.model)}${exp ? ' · back-transformed ratio' : ''}</div>
      <div class="result-big">${fmt(tr(r.estimate))} <small>95% CI ${fmt(tr(r.lower))} to ${fmt(tr(r.upper))}</small></div>
      <div class="metrics">${metric('p (pooled)', fmtP(r.p), r.ciMethod)}${metric('I²', `${fmt(r.i2, 1)}%`, `H² ${fmt(r.h2, 2)}`)}${metric('τ²', fmt(r.tau2, 4), `τ ${fmt(r.tau, 3)}`)}${metric('Cochran Q', `${fmt(r.q, 2)} (df ${r.qDf})`, `p = ${fmtP(r.qP)}`)}${r.prediction ? metric('95% prediction interval', `${fmt(tr(r.prediction[0]), 2)} to ${fmt(tr(r.prediction[1]), 2)}`) : ''}${egger ? metric("Egger's test", `intercept ${fmt(egger.intercept, 2)}`, `p = ${fmtP(egger.p)}${studies.length < 10 ? ' · <10 studies: low power' : ''}`) : ''}</div>
      ${forestPlot(studies, r, { exp, label: exp ? 'Ratio' : 'Effect' })}
      <div class="stack" style="margin-top:16px"><div><h3>Funnel plot</h3>${funnelPlot(studies, r)}</div><div><h3>Cumulative meta-analysis</h3>${lineChart([{ label: 'Pooled estimate', points: cum.map(c => [c.k, tr(c.estimate)]), band: cum.map(c => [c.k, tr(c.lower), tr(c.upper)]), dots: true }], { xLabel: 'Studies included (input order)', yLabel: exp ? 'Ratio' : 'Effect', title: 'Cumulative meta-analysis' })}</div></div>
      ${loo.length ? `<h3 style="margin-top:16px">Leave-one-out sensitivity</h3>${table(['Omitted', 'Estimate', '95% CI', 'I²', 'τ²'], loo.map(l => [esc(l.omitted), fmt(tr(l.estimate)), `${fmt(tr(l.lower))} to ${fmt(tr(l.upper))}`, `${fmt(l.i2, 1)}%`, fmt(l.tau2, 4)]), { numeric: [1, 3, 4] })}` : ''}
      <p class="method-note">Inverse-variance pooling. τ² by ${ui.model === 'random' ? ({ DL: 'DerSimonian–Laird', PM: 'Paule–Mandel', REML: 'restricted maximum likelihood (Fisher scoring)' })[ui.tau] : 'n/a (fixed effect)'}. ${opt.hksj ? 'Hartung–Knapp–Sidik–Jonkman t-based CI with the ad hoc q*≥1 safeguard. ' : ''}Prediction interval uses t with k−2 df. Egger’s regression has low power with fewer than 10 studies. Risk of bias, dependence between estimates and certainty of evidence (e.g. GRADE) need separate assessment. <a href="https://training.cochrane.org/handbook/current/chapter-10" target="_blank" rel="noopener noreferrer">Cochrane Handbook ch. 10</a></p>
      <div class="actions"><button class="btn small" id="dl-meta">${icon('download', 14)} Export run</button><span class="muted small mono">sha256 ${runRec.inputSha256.slice(0, 16)}…</span></div>`;
    $('#dl-meta').onclick = () => download('cerebro-meta-analysis.json', JSON.stringify({ ...runRec, leaveOneOut: loo, cumulative: cum }, null, 2));
  } catch (e) { err.textContent = e.message; out.innerHTML = ''; }
}

export function render(body) {
  body.innerHTML = notice('Pool compatible, independent estimates on a common scale with a consistent outcome direction. Enter ratios (OR, RR, HR) on the log scale and choose “log ratio” to back-transform the output.')
    + `<div class="split"><section class="card"><h2>Evidence synthesis</h2>
      <label class="field">Study estimates (CSV)<textarea id="meta-data" class="code" rows="10">${esc(ui.data)}</textarea><small>Headers: study,effect,se · defaults are fictional demonstration values.</small></label>
      <div class="form-grid"><label class="field">Model<select id="model"><option value="random">Random effects</option><option value="fixed" ${ui.model === 'fixed' ? 'selected' : ''}>Fixed effect</option></select></label>
      <label class="field">τ² estimator<select id="tau">${[['REML', 'REML (recommended)'], ['PM', 'Paule–Mandel'], ['DL', 'DerSimonian–Laird']].map(([k, l]) => `<option value="${k}" ${ui.tau === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="field">Effect scale<select id="scale"><option value="generic">Generic (SMD, MD, RD…)</option><option value="log" ${ui.scale === 'log' ? 'selected' : ''}>Log ratio (OR/RR/HR)</option></select></label>
      <label class="field" style="align-self:end"><span class="check"><input type="checkbox" id="hksj" ${ui.hksj ? 'checked' : ''}> Hartung–Knapp CI</span></label></div>
      <button class="btn primary" id="run-meta" style="width:100%">${icon('sparkle', 16)} Pool studies</button><div class="error" id="meta-err" role="alert"></div>
      ${converter()}</section>
      <section class="card"><div id="meta-out"></div></section></div>`;
  $('#run-meta').onclick = run;
  const append = row => { const ta = $('#meta-data'); ta.value = ta.value.trimEnd() + '\n' + row; toast('Row appended.'); };
  $('#conv-smd').onsubmit = e => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); const g = smd(+f.m1, +f.s1, +f.n1, +f.m2, +f.s2, +f.n2); append(`${f.label.replace(/,/g, ' ')},${g.g.toFixed(4)},${g.se.toFixed(4)}`); };
  $('#conv-2x2').onsubmit = e => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); try { const r = twoByTwo(+f.a, +f.b, +f.c, +f.d, f.measure); append(`${f.label.replace(/,/g, ' ')},${r.effect.toFixed(4)},${r.se.toFixed(4)}`); } catch (x) { toast(x.message, 'error'); } };
  $$('details summary', body).forEach(s => s.style.cursor = 'pointer');
  run();
}
