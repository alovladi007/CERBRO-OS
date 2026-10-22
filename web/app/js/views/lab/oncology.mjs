import { $, $$, esc, icon, notice, empty, table, fmt, fmtP, metric, logRun, download } from '../../ui.mjs';
import { lab, dataBar, wireDataBar, numericCols, groupCols, colNumbers, colValues, opts, setDataObject } from '../lab.mjs';
import { coxph, coxZph, cumulativeIncidence, grayTest, rmst2, rmst, binomialCI, simonTwoStage, boinBoundaries, recist } from '../../../../lib/oncology.mjs';
import { kaplanMeier } from '../../../../lib/stats.mjs';
import { lineChart, waterfallChart, swimmerChart, spiderChart } from '../../charts.mjs';

const SECTIONS = [['cox', 'Cox regression'], ['cr', 'Competing risks'], ['rmst', 'RMST'], ['response', 'Tumour response'], ['design', 'Trial design'], ['recist', 'RECIST 1.1']];
const ui = { section: 'cox', sel: {} };
const pickByName = (cols, re, fallback = 0) => (cols.find(c => re.test(c.name)) || cols[fallback])?.index;
/** Optional column: only an explicit name match, otherwise none. */
const pickOptional = (cols, re) => cols.find(c => re.test(c.name))?.index ?? '';
const runFooter = run => `<div class="actions"><button class="btn small" id="dl-onc">${icon('download', 14)} Export run</button><span class="muted small mono">sha256 ${run.inputSha256.slice(0, 16)}…</span></div>`;
const wireFooter = (run, file) => { const b = $('#dl-onc'); if (b) b.onclick = () => download(file, JSON.stringify(run, null, 2)); };
const dataNeeded = () => empty('Load data to begin.', 'Use “Synthetic oncology trial” to try every tool on fictional data, or load your own de-identified CSV.');

// ---------- Cox ----------
function coxView(box) {
  const n = numericCols(), g = groupCols(), bin = lab.data.profile.filter(c => c.type === 'binary');
  const s = ui.sel;
  s.t ??= pickByName(n, /os|time|month|day|survival/i); s.e ??= pickByName(bin.length ? bin : n, /death|event|status/i);
  s.xs ??= n.filter(c => /age|ecog|pdl1|score/i.test(c.name)).map(c => c.index).slice(0, 3); s.cats ??= g.filter(c => /arm|treat|group/i.test(c.name)).map(c => c.index).slice(0, 1);
  box.innerHTML = `<div class="split"><section class="card"><h2>Cox proportional hazards</h2><p class="muted small">Hazard ratios with 95% CIs. Categorical predictors are dummy-coded against their first level (alphabetical).</p>
    <div class="form-grid"><label class="field">Time<select id="t">${opts(n, s.t)}</select></label><label class="field">Event (1 = event)<select id="e">${opts(bin.length ? bin : n, s.e)}</select></label></div>
    <div class="field">Numeric covariates<div class="chips">${n.map(c => `<label class="chip"><input type="checkbox" data-x="${c.index}" ${s.xs.includes(c.index) ? 'checked' : ''}> ${esc(c.name)}</label>`).join('')}</div></div>
    <div class="field">Categorical covariates<div class="chips">${g.map(c => `<label class="chip"><input type="checkbox" data-cat="${c.index}" ${s.cats.includes(c.index) ? 'checked' : ''}> ${esc(c.name)}</label>`).join('') || '<span class="muted">None detected</span>'}</div></div>
    <div class="form-grid"><label class="field">Stratify by<select id="strata"><option value="">None</option>${opts(g, s.strata ?? '')}</select></label><label class="field">Ties<select id="ties"><option value="efron">Efron (default, as R)</option><option value="breslow" ${s.ties === 'breslow' ? 'selected' : ''}>Breslow</option></select></label></div>
    <button class="btn primary" id="go" style="width:100%">Fit Cox model</button><div class="error" id="err" role="alert"></div></section>
    <section class="card" id="out"><p class="muted">Hazard ratios, likelihood-ratio / Wald / score tests, concordance and the proportional-hazards check appear here.</p></section></div>`;
  $('#go').onclick = async () => {
    const err = $('#err'), out = $('#out'); err.textContent = '';
    try {
      s.t = Number($('#t').value); s.e = Number($('#e').value); s.ties = $('#ties').value; s.strata = $('#strata').value;
      s.xs = $$('[data-x]', box).filter(c => c.checked).map(c => Number(c.dataset.x)).filter(i => i !== s.t && i !== s.e);
      s.cats = $$('[data-cat]', box).filter(c => c.checked).map(c => Number(c.dataset.cat)).filter(i => String(i) !== s.strata);
      if (!s.xs.length && !s.cats.length) throw Error('Select at least one covariate.');
      const d = lab.data, names = s.xs.map(i => d.headers[i]), cols = s.xs.map(colNumbers);
      for (const c of s.cats) { const vals = colValues(c), levels = [...new Set(vals.filter(Boolean))].sort(); levels.slice(1).forEach(l => { names.push(`${d.headers[c]} = ${l} (vs ${levels[0]})`); cols.push(vals.map(v => (v ? (v === l ? 1 : 0) : NaN))); }); }
      const X = d.rows.map((_, r) => cols.map(col => col[r])), strata = s.strata === '' ? null : colValues(Number(s.strata));
      const fit = coxph(colNumbers(s.t), colNumbers(s.e), X, names, { ties: s.ties, strata }), zph = coxZph(fit);
      const { _fit, cov, ...result } = fit;
      const run = await logRun('cox-ph', { time: d.headers[s.t], event: d.headers[s.e], covariates: names, ties: s.ties, strata: s.strata === '' ? null : d.headers[Number(s.strata)], n: fit.n }, { ...result, ph: zph });
      const violated = zph.table.filter(r => r.p < 0.05);
      out.innerHTML = `<div class="eyebrow">Cox model · ${fit.method} ties${strata ? ' · stratified' : ''}</div>
        <div class="metrics">${metric('Patients / events', `${fit.n} / ${fit.events}`)}${metric('Concordance (C)', fmt(fit.concordance))}${metric('Likelihood-ratio test', `${fmt(fit.tests.lr.chi2, 2)} (df ${fit.tests.lr.df})`, `p = ${fmtP(fit.tests.lr.p)}`)}${metric('Wald / score', `${fmt(fit.tests.wald.chi2, 2)} / ${fmt(fit.tests.score.chi2, 2)}`)}</div>`
        + table(['Covariate', 'HR', '95% CI', 'coef', 'SE', 'z', 'p'], fit.coef.map(c => [esc(c.name), fmt(c.hr), `${fmt(c.lower)} to ${fmt(c.upper)}`, fmt(c.coef), fmt(c.se), fmt(c.z, 2), fmtP(c.p)]), { numeric: [1, 3, 4, 5, 6] })
        + `<h3 style="margin-top:18px">Proportional-hazards check</h3>` + table(['Covariate', 'χ²', 'df', 'p'], [...zph.table.map(r => [esc(r.name), fmt(r.chi2), r.df, fmtP(r.p)]), ['<strong>Global</strong>', fmt(zph.global.chi2), zph.global.df, fmtP(zph.global.p)]], { numeric: [1, 2, 3] })
        + (violated.length ? notice(`Possible non-proportional hazards for ${violated.map(r => `<strong>${esc(r.name)}</strong>`).join(', ')} (p < 0.05). Consider stratification, time-varying effects, or reporting RMST.`, 'warn') : '')
        + `<p class="method-note">Partial likelihood by Newton–Raphson with ${fit.method} handling of tied event times; Wald CIs on the log-hazard scale. Proportional-hazards check: Grambsch–Therneau score test with Kaplan–Meier time transform, as in R <span class="mono">survival::cox.zph</span>. Engine validated against R survival 3.5.8 to ~1e-12. Hazard ratios are associations unless the design is randomised.</p>` + runFooter(run);
      wireFooter(run, 'cerebro-cox.json');
    } catch (x) { err.textContent = x.message; }
  };
}

// ---------- competing risks ----------
function crView(box) {
  const n = numericCols(), g = groupCols(), s = ui.sel;
  s.crt ??= pickByName(n, /os|time|month/i); s.crs ??= pickByName(n, /event_type|cause|status/i); s.crg ??= pickByName(g, /arm|group/i) ?? '';
  box.innerHTML = `<div class="split"><section class="card"><h2>Competing risks</h2><p class="muted small">Status coded 0 = censored, 1, 2, … = event types. Cumulative incidence (Aalen–Johansen) with Gray's test between groups.</p>
    <div class="form-grid"><label class="field">Time<select id="t">${opts(n, s.crt)}</select></label><label class="field">Status (0/1/2…)<select id="st">${opts(n, s.crs)}</select></label>
    <label class="field">Cause of interest<input id="cause" type="number" min="1" step="1" value="${s.cause ?? 1}"></label><label class="field">Compare groups<select id="g"><option value="">No grouping</option>${opts(g, s.crg)}</select></label>
    <label class="field full">Report at times (comma-separated)<input id="times" value="${esc(s.crTimes ?? '6, 12, 24')}"></label></div>
    <button class="btn primary" id="go" style="width:100%">Estimate cumulative incidence</button><div class="error" id="err" role="alert"></div></section>
    <section class="card" id="out"><p class="muted">Use this instead of 1 − Kaplan–Meier whenever another event (e.g. non-cancer death) prevents the event of interest.</p></section></div>`;
  $('#go').onclick = async () => {
    const err = $('#err'), out = $('#out'); err.textContent = '';
    try {
      s.crt = Number($('#t').value); s.crs = Number($('#st').value); s.cause = Number($('#cause').value); s.crg = $('#g').value; s.crTimes = $('#times').value;
      const d = lab.data, t = colNumbers(s.crt), st = colNumbers(s.crs), times = s.crTimes.split(/[,\s]+/).filter(Boolean).map(Number).filter(Number.isFinite);
      if (!st.some(v => v === s.cause)) throw Error(`No events of type ${s.cause} in “${d.headers[s.crs]}”.`);
      if (st.some(v => Number.isFinite(v) && (v < 0 || !Number.isInteger(v)))) throw Error('Status must be coded 0 (censored), 1, 2, … (integers).');
      const gv = s.crg === '' ? d.rows.map(() => 'All') : colValues(Number(s.crg)), labels = [...new Set(gv.filter(Boolean))].slice(0, 6);
      const curves = labels.map(l => { const idx = gv.map((v, i) => (v === l ? i : -1)).filter(i => i >= 0 && Number.isFinite(t[i]) && Number.isFinite(st[i])); return { label: l, n: idx.length, cif: cumulativeIncidence(idx.map(i => t[i]), idx.map(i => st[i]), s.cause) }; });
      const gray = labels.length > 1 ? grayTest(t, st, gv, { cause: s.cause }) : null;
      const rowsOut = curves.flatMap(c => times.map(tt => { const p = c.cif.at(tt), ci = c.cif.ci(tt); return [esc(c.label), tt, fmt(p.est), `${fmt(ci[0])} to ${fmt(ci[1])}`]; }));
      const run = await logRun('cumulative-incidence', { time: d.headers[s.crt], status: d.headers[s.crs], cause: s.cause, group: s.crg === '' ? null : d.headers[Number(s.crg)], times }, { at: curves.map(c => ({ group: c.label, n: c.n, values: times.map(tt => ({ t: tt, ...c.cif.at(tt) })) })), gray });
      out.innerHTML = `<div class="eyebrow">Cumulative incidence of event type ${s.cause}</div><div class="metrics">${curves.map(c => metric(esc(c.label), `n = ${c.n}`, `max follow-up ${fmt(c.cif.maxTime, 1)}`)).join('')}${gray ? metric("Gray's test", `${fmt(gray.chi2, 2)} (df ${gray.df})`, `p = ${fmtP(gray.p)}`) : ''}</div>`
        + lineChart(curves.map((c, i) => ({ label: c.label, step: true, c: i, points: [...c.cif.points.map(p => [p.t, p.est]), [c.cif.maxTime, c.cif.points.at(-1).est]] })), { xLabel: d.headers[s.crt], yLabel: 'Cumulative incidence', title: 'Cumulative incidence curves', yZero: true })
        + table(['Group', 'Time', 'Cumulative incidence', '95% CI'], rowsOut, { numeric: [1, 2] })
        + `<p class="method-note">Aalen–Johansen estimator; variance and Gray's k-sample test (ρ = 0) ported from R <span class="mono">cmprsk</span> (cuminc) and validated against it to ~1e-12. Intervals are estimate ± 1.96·SE, clipped to [0, 1]. Fine–Gray subdistribution regression is on the roadmap.</p>` + runFooter(run);
      wireFooter(run, 'cerebro-competing-risks.json');
    } catch (x) { err.textContent = x.message; }
  };
}

// ---------- RMST ----------
function rmstView(box) {
  const n = numericCols(), bin = lab.data.profile.filter(c => c.type === 'binary'), g = groupCols(), s = ui.sel;
  s.rt ??= pickByName(n, /os|time|month/i); s.re ??= pickByName(bin.length ? bin : n, /death|event|status/i); s.ra ??= pickByName(g, /arm|treat|group/i);
  box.innerHTML = `<div class="split"><section class="card"><h2>Restricted mean survival time</h2><p class="muted small">Mean event-free time up to τ: the area under the Kaplan–Meier curve. Valid without proportional hazards.</p>
    <div class="form-grid"><label class="field">Time<select id="t">${opts(n, s.rt)}</select></label><label class="field">Event (1 = event)<select id="e">${opts(bin.length ? bin : n, s.re)}</select></label>
    <label class="field">Arm (two groups)<select id="a">${opts(g, s.ra)}</select></label><label class="field">τ (blank = largest common follow-up)<input id="tau" type="number" step="any" value="${s.tau ?? ''}"></label></div>
    <button class="btn primary" id="go" style="width:100%">Compare RMST</button><div class="error" id="err" role="alert"></div></section>
    <section class="card" id="out"><p class="muted">Reports each arm's RMST, the difference and the ratio with 95% CIs.</p></section></div>`;
  $('#go').onclick = async () => {
    const err = $('#err'), out = $('#out'); err.textContent = '';
    try {
      s.rt = Number($('#t').value); s.re = Number($('#e').value); s.ra = Number($('#a').value);
      const d = lab.data, t = colNumbers(s.rt), e = colNumbers(s.re), arm = colValues(s.ra);
      const keep = t.map((v, i) => Number.isFinite(v) && (e[i] === 0 || e[i] === 1) && arm[i]);
      const T = t.filter((_, i) => keep[i]), E = e.filter((_, i) => keep[i]), A = arm.filter((_, i) => keep[i]), labels = [...new Set(A)];
      if (labels.length !== 2) throw Error(`The arm column must have exactly two groups (found ${labels.length}).`);
      const commonMax = Math.min(...labels.map(l => Math.max(...T.filter((_, i) => A[i] === l))));
      const tau = $('#tau').value === '' ? commonMax : Number($('#tau').value); s.tau = $('#tau').value;
      const r = rmst2(T, E, A, tau);
      const curves = labels.map((l, i) => { const k = kaplanMeier(T.filter((_, j) => A[j] === l), E.filter((_, j) => A[j] === l)); return { label: `${l}`, step: true, c: i, points: [...k.steps.map(p => [p.t, p.s]), [Math.max(...T.filter((_, j) => A[j] === l)), k.steps.at(-1).s]] }; });
      const run = await logRun('rmst', { time: d.headers[s.rt], event: d.headers[s.re], arm: d.headers[s.ra], tau }, r);
      out.innerHTML = `<div class="eyebrow">RMST up to τ = ${fmt(tau, 2)}</div><div class="metrics">${r.arms.map(a => metric(esc(a.label), fmt(a.rmst, 2), `95% CI ${fmt(a.lower, 2)} to ${fmt(a.upper, 2)}`)).join('')}${metric(`Difference (${esc(r.difference.label)})`, fmt(r.difference.est, 2), `95% CI ${fmt(r.difference.lower, 2)} to ${fmt(r.difference.upper, 2)} · p = ${fmtP(r.difference.p)}`)}${metric(`Ratio (${esc(r.ratio.label)})`, fmt(r.ratio.est, 3), `95% CI ${fmt(r.ratio.lower, 3)} to ${fmt(r.ratio.upper, 3)}`)}</div>`
        + lineChart(curves, { xLabel: d.headers[s.rt], yLabel: 'Survival probability', title: 'Kaplan–Meier curves with RMST horizon', markers: [{ x: tau, label: `τ = ${fmt(tau, 1)}` }] })
        + `<p class="method-note">RMST and its variance as in R <span class="mono">survRM2::rmst2</span> (validated to ~1e-12). Choose τ before seeing the data (e.g. from the protocol); the default here is the largest time observed in both arms.</p>` + runFooter(run);
      wireFooter(run, 'cerebro-rmst.json');
    } catch (x) { err.textContent = x.message; }
  };
}

// ---------- tumour response ----------
const classify = v => (v <= -100 ? 'CR' : v <= -30 ? 'PR' : v >= 20 ? 'PD' : 'SD');
function responseView(box) {
  const n = numericCols(), g = groupCols(), all = lab.data.profile, s = ui.sel;
  s.pid ??= pickByName(all, /patient|id|subject/i); s.chg ??= (n.find(c => /change/i.test(c.name)) || n.find(c => /best|shrink|pct/i.test(c.name) && !/pdl|ki67|percent_pos/i.test(c.name)) || n[0])?.index; s.cat ??= pickOptional(g, /response|recist|best_resp/i);
  s.arm ??= pickOptional(g, /arm|treat|group/i); s.dur ??= pickOptional(n, /on_treatment|duration|months_on|time_on/i); s.ong ??= pickOptional(lab.data.profile.filter(c => c.type === 'binary'), /ongoing|active/i);
  box.innerHTML = `<div class="split"><section class="card"><h2>Tumour response</h2><p class="muted small">Waterfall and swimmer plots, objective response (CR+PR) and disease control (CR+PR+SD) rates with exact CIs.</p>
    <div class="form-grid"><label class="field">Patient ID<select id="pid">${opts(all, s.pid)}</select></label><label class="field">Best % change<select id="chg">${opts(n, s.chg)}</select></label>
    <label class="field">Best response (CR/PR/SD/PD)<select id="cat"><option value="">Derive from % change</option>${opts(g, s.cat)}</select></label><label class="field">Arm<select id="arm"><option value="">All patients</option>${opts(g, s.arm)}</select></label>
    <label class="field">Time on treatment<select id="dur"><option value="">None</option>${opts(n, s.dur)}</select></label><label class="field">Ongoing (1 = yes)<select id="ong"><option value="">None</option>${opts(lab.data.profile.filter(c => c.type === 'binary'), s.ong)}</select></label></div>
    <button class="btn primary" id="go" style="width:100%">Summarise response</button><div class="error" id="err" role="alert"></div>
    <hr class="divider"><h3>Spider plot</h3><p class="muted small">Needs long-format measurements: one row per patient per assessment.</p><button class="btn small" id="demo-spider">Load synthetic tumour-measurement series</button></section>
    <section class="card" id="out"><p class="muted">Response summaries appear here. Best-response derivation from % change alone ignores non-target and new lesions; supply an investigator-assessed column when available.</p></section></div>`;
  $('#demo-spider').onclick = () => setDataObject(syntheticSpider());
  $('#go').onclick = async () => {
    const err = $('#err'), out = $('#out'); err.textContent = '';
    try {
      Object.assign(s, { pid: Number($('#pid').value), chg: Number($('#chg').value), cat: $('#cat').value, arm: $('#arm').value, dur: $('#dur').value, ong: $('#ong').value });
      const d = lab.data, ids = colValues(s.pid), chg = colNumbers(s.chg), cat = s.cat === '' ? null : colValues(Number(s.cat)), arm = s.arm === '' ? d.rows.map(() => 'All') : colValues(Number(s.arm));
      const dur = s.dur === '' ? null : colNumbers(Number(s.dur)), ong = s.ong === '' ? null : colNumbers(Number(s.ong));
      const longFormat = new Set(ids).size < ids.length;
      let items = ids.map((id, i) => ({ label: id, value: chg[i], group: cat ? String(cat[i]).toUpperCase() : Number.isFinite(chg[i]) ? classify(chg[i]) : null, arm: arm[i], duration: dur?.[i], ongoing: ong?.[i] === 1 })).filter(x => x.group);
      if (longFormat) { // one row per patient per assessment → best (lowest) change per patient; PD if the last value is ≥ +20%
        const by = new Map(); items.forEach(x => (by.get(x.label) || by.set(x.label, []).get(x.label)).push(x));
        items = [...by.values()].map(xs => { const best = xs.reduce((a, b) => (b.value < a.value ? b : a)), last = xs.at(-1); return { ...best, group: cat ? best.group : last.value >= 20 && best.value > -30 ? 'PD' : classify(best.value) }; });
      }
      if (!items.length) throw Error('No patients with a usable response.');
      const arms = [...new Set(items.map(x => x.arm))].slice(0, 4);
      const summary = arms.map(a => { const A = items.filter(x => x.arm === a), orr = A.filter(x => x.group === 'CR' || x.group === 'PR').length, dcr = A.filter(x => ['CR', 'PR', 'SD'].includes(x.group)).length; return { arm: a, n: A.length, orr: binomialCI(orr, A.length), dcr: binomialCI(dcr, A.length), counts: ['CR', 'PR', 'SD', 'PD'].map(k => A.filter(x => x.group === k).length) }; });
      const run = await logRun('tumour-response', { patient: d.headers[s.pid], change: d.headers[s.chg], response: cat ? d.headers[Number(s.cat)] : 'derived from % change', arm: s.arm === '' ? null : d.headers[Number(s.arm)] }, { summary });
      out.innerHTML = table(['Arm', 'n', 'CR', 'PR', 'SD', 'PD', 'ORR (95% CI)', 'DCR (95% CI)'], summary.map(r => [esc(r.arm), r.n, ...r.counts, `${fmt(r.orr.p * 100, 1)}% (${fmt(r.orr.lower * 100, 1)}–${fmt(r.orr.upper * 100, 1)})`, `${fmt(r.dcr.p * 100, 1)}% (${fmt(r.dcr.lower * 100, 1)}–${fmt(r.dcr.upper * 100, 1)})`]), { numeric: [1, 2, 3, 4, 5] })
        + (longFormat ? spiderFromLong(d, ids, chg) : arms.map(a => `<h3 style="margin-top:18px">Waterfall · ${esc(a)}</h3>` + waterfallChart(items.filter(x => x.arm === a))).join('')
          + (dur ? `<h3 style="margin-top:18px">Swimmer plot</h3>` + swimmerChart(items, { xLabel: d.headers[Number(s.dur)] }) : ''))
        + `<p class="method-note">ORR = CR + PR; DCR = CR + PR + SD; Clopper–Pearson exact 95% CIs (validated against R binom.test). ${cat ? '' : 'Categories derived from best % change only (≤ −30% PR, −100% CR, ≥ +20% PD); confirmed responses, non-target and new lesions are not considered.'}</p>` + runFooter(run);
      wireFooter(run, 'cerebro-tumour-response.json');
    } catch (x) { err.textContent = x.message; }
  };
}
function spiderFromLong(d, ids, chg) {
  const ui2 = numericCols().find(c => /week|time|visit|day|month/i.test(c.name) && c.index !== ui.sel.chg);
  if (!ui2) return notice('Repeated patient IDs detected, but no time column (week/visit/day) was found for a spider plot.', 'warn');
  const t = colNumbers(ui2.index), by = new Map();
  ids.forEach((id, i) => { if (Number.isFinite(t[i]) && Number.isFinite(chg[i])) (by.get(id) || by.set(id, []).get(id)).push([t[i], chg[i]]); });
  const series = [...by.entries()].map(([id, pts]) => { pts.sort((a, b) => a[0] - b[0]); const best = Math.min(...pts.map(p => p[1])), last = pts.at(-1)[1]; return { id, points: pts, group: last >= 20 ? 'PD' : classify(best) }; });
  return `<h3 style="margin-top:18px">Spider plot · ${series.length} patients</h3>` + spiderChart(series, { xLabel: d.headers[ui2.index] });
}
function syntheticSpider(n = 40, seed = 5) {
  let s = seed; const rnd = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const rows = [];
  for (let p = 0; p < n; p++) {
    const slope = -11 + rnd() * 13, rebound = rnd() < 0.3 ? 1 + rnd() * 3 : 0; let v = 0;
    for (let w = 0; w <= 48; w += 6) { if (w) v = Math.max(-100, v + slope * (w <= 24 ? 1 : 0.4) + (w > 24 ? rebound * 6 : 0) + (rnd() - 0.5) * 6); rows.push([`PT${String(p + 1).padStart(3, '0')}`, String(w), v.toFixed(1)]); if (v >= 20 && w > 0) break; }
  }
  return { name: 'Synthetic tumour measurements · 40 fictional patients', headers: ['patient', 'week', 'pct_change'], rows };
}

// ---------- trial design ----------
function designView(box) {
  const s = ui.sel;
  box.innerHTML = `<div class="stack"><section class="card"><h2>Simon two-stage (phase II)</h2><p class="muted small">Single-arm design with an early futility stop. Exhaustive search for the optimal (minimum expected size under H0) and minimax (minimum maximum size) designs.</p>
      <div class="form-grid"><label class="field">p0 (uninteresting response rate)<input id="p0" type="number" step="0.01" min="0.01" max="0.95" value="${s.p0 ?? 0.1}"></label><label class="field">p1 (target response rate)<input id="p1" type="number" step="0.01" min="0.02" max="0.99" value="${s.p1 ?? 0.3}"></label>
      <label class="field">One-sided α<input id="al" type="number" step="0.01" min="0.01" max="0.2" value="${s.al ?? 0.05}"></label><label class="field">β (1 − power)<input id="be" type="number" step="0.01" min="0.05" max="0.4" value="${s.be ?? 0.2}"></label></div>
      <button class="btn primary" id="simon">Find designs</button><div class="error" id="serr" role="alert"></div><div id="sout"></div></section>
    <div class="grid2"><section class="card"><h2>BOIN dose finding (phase I)</h2><p class="muted small">Bayesian optimal interval design: escalation and de-escalation boundaries for the observed toxicity rate.</p>
      <div class="form-grid"><label class="field">Target toxicity rate<input id="tg" type="number" step="0.01" min="0.1" max="0.5" value="${s.tg ?? 0.3}"></label><label class="field">Patients treated at dose (up to)<input id="nb" type="number" min="3" max="30" value="${s.nb ?? 12}"></label></div>
      <button class="btn primary" id="boin" style="width:100%">Compute boundaries</button><div class="error" id="berr" role="alert"></div><div id="bout"></div>
</section><section class="card"><h2>Exact response-rate interval</h2><div class="form-grid"><label class="field">Responders<input id="bx" type="number" min="0" value="${s.bx ?? 7}"></label><label class="field">Patients<input id="bn" type="number" min="1" value="${s.bn ?? 25}"></label></div>
      <button class="btn" id="bci">Compute</button><div class="error" id="cerr" role="alert"></div><div id="cout"></div></section></div></div>
    <p class="method-note">Simon designs are validated against R <span class="mono">clinfun::ph2simon</span>; BOIN boundaries follow Liu &amp; Yuan (2015) with φ1 = 0.6·target and φ2 = 1.4·target; exact intervals are Clopper–Pearson (validated against R binom.test). Final designs need simulation of operating characteristics and statistician review.</p>`;
  $('#simon').onclick = async () => {
    const e = $('#serr'); e.textContent = '';
    try {
      Object.assign(s, { p0: Number($('#p0').value), p1: Number($('#p1').value), al: Number($('#al').value), be: Number($('#be').value) });
      const r = simonTwoStage(s.p0, s.p1, s.al, s.be), row = (k, d) => [k, `${d.r1}/${d.n1}`, `${d.r}/${d.n}`, fmt(d.en0, 2), fmt(d.pet0, 3), fmt(d.alpha, 4), fmt(d.power, 4)];
      const run = await logRun('simon-two-stage', { p0: s.p0, p1: s.p1, alpha: s.al, beta: s.be }, r);
      $('#sout').innerHTML = table(['Design', 'Stage 1: stop if ≤ r1 / n1', 'Overall: reject H0 if > r / n', 'E(N | p0)', 'P(early stop | p0)', 'Actual α', 'Power'], [row('Optimal', r.optimal), row('Minimax', r.minimax)], { numeric: [3, 4, 5, 6] })
        + `<p class="small muted">Optimal: enrol ${r.optimal.n1}; stop if ≤ ${r.optimal.r1} respond. Otherwise enrol ${r.optimal.n - r.optimal.n1} more; the treatment is promising if more than ${r.optimal.r} of ${r.optimal.n} respond.</p>` + runFooter(run);
      wireFooter(run, 'cerebro-simon.json');
    } catch (x) { e.textContent = x.message; }
  };
  $('#boin').onclick = () => {
    const e = $('#berr'); e.textContent = '';
    try {
      s.tg = Number($('#tg').value); s.nb = Math.min(30, Math.max(3, Number($('#nb').value)));
      const b = boinBoundaries(s.tg), ns = Array.from({ length: s.nb }, (_, i) => i + 1);
      $('#bout').innerHTML = `<div class="metrics">${metric('λe (escalate if rate ≤)', fmt(b.lambdaE, 4))}${metric('λd (de-escalate if rate ≥)', fmt(b.lambdaD, 4))}</div>` + table(['Patients at dose', ...ns], [['Escalate if DLTs ≤', ...ns.map(k => { const v = b.table(k).escalateIfAtMost; return v < 0 ? '—' : v; })], ['De-escalate if DLTs ≥', ...ns.map(k => b.table(k).deescalateIfAtLeast)]], { numeric: ns.map((_, i) => i + 1) });
    } catch (x) { e.textContent = x.message; }
  };
  $('#bci').onclick = () => {
    const e = $('#cerr'); e.textContent = '';
    try { s.bx = Number($('#bx').value); s.bn = Number($('#bn').value); const c = binomialCI(s.bx, s.bn); $('#cout').innerHTML = `<div class="metrics">${metric('Response rate', `${fmt(c.p * 100, 1)}%`, `95% CI ${fmt(c.lower * 100, 1)}% to ${fmt(c.upper * 100, 1)}%`)}</div>`; } catch (x) { e.textContent = x.message; }
  };
}

// ---------- RECIST ----------
function recistView(box) {
  box.innerHTML = `<div class="split"><section class="card"><h2>RECIST 1.1 assessment</h2><p class="muted small">Sum of diameters of target lesions (longest diameter; short axis for lymph nodes), in millimetres.</p>
    <div class="form-grid"><label class="field">Baseline sum (mm)<input id="b" type="number" min="0" step="0.1" value="80"></label><label class="field">Nadir sum (mm)<input id="nd" type="number" min="0" step="0.1" value="60"></label>
    <label class="field">Current sum (mm)<input id="c" type="number" min="0" step="0.1" value="74"></label></div>
    <label class="check"><input type="checkbox" id="nl"> New lesion(s)</label><br><label class="check"><input type="checkbox" id="ntp"> Unequivocal non-target progression</label><br><label class="check"><input type="checkbox" id="cr"> All target lesions resolved (nodes &lt; 10 mm)</label><br><label class="check"><input type="checkbox" id="ntcr" checked> Non-target lesions resolved (if any)</label>
    <div class="actions"><button class="btn primary" id="go">Assess</button></div><div class="error" id="err" role="alert"></div></section>
    <section class="card" id="out"><p class="muted">For research case report forms. Response confirmation, imaging-modality rules and investigator judgement still apply.</p></section></div>`;
  $('#go').onclick = () => {
    const err = $('#err'); err.textContent = '';
    try {
      const r = recist({ baselineSum: Number($('#b').value), nadirSum: Number($('#nd').value), currentSum: Number($('#c').value), newLesions: $('#nl').checked, nonTargetProgression: $('#ntp').checked, allTargetsResolved: $('#cr').checked, nonTargetCR: $('#ntcr').checked });
      const name = { CR: 'Complete response', PR: 'Partial response', SD: 'Stable disease', PD: 'Progressive disease' };
      $('#out').innerHTML = `<div class="eyebrow">Overall response</div><div class="result-big">${r.overall} <small>${name[r.overall]}</small></div><div class="metrics">${metric('Target-lesion response', r.target)}${metric('Change from baseline', `${fmt(r.changeFromBaseline, 1)}%`)}${metric('Change from nadir', Number.isFinite(r.changeFromNadir) ? `${fmt(r.changeFromNadir, 1)}%` : '—')}</div><p class="method-note">${esc(r.rules)} Eisenhauer et al., Eur J Cancer 2009;45:228–47.</p>`;
    } catch (x) { err.textContent = x.message; }
  };
}

export function render(body) {
  if (ui.dataRef !== lab.data) { ui.sel = {}; ui.dataRef = lab.data; } // column choices belong to one dataset
  const needsData = ['cox', 'cr', 'rmst', 'response'].includes(ui.section);
  body.innerHTML = notice('Research use only: not for individual patient treatment decisions. Use de-identified data; rows stay in this browser.')
    + (needsData ? dataBar() : '')
    + `<div class="chips" style="margin-bottom:16px">${SECTIONS.map(([k, l]) => `<button class="chip ${ui.section === k ? 'on' : ''}" data-sec="${k}">${l}</button>`).join('')}</div><div id="onc-body"></div>`;
  if (needsData) wireDataBar(body);
  $$('[data-sec]', body).forEach(b => b.onclick = () => { ui.section = b.dataset.sec; render(body); });
  const box = $('#onc-body');
  if (needsData && !lab.data) { box.innerHTML = dataNeeded(); return; }
  ({ cox: coxView, cr: crView, rmst: rmstView, response: responseView, design: designView, recist: recistView })[ui.section](box);
}
