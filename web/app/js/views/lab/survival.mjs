import { $, esc, icon, empty, table, fmt, fmtP, metric, logRun, download } from '../../ui.mjs';
import { lab, dataBar, wireDataBar, numericCols, groupCols, colNumbers, colValues, opts } from '../lab.mjs';
import { kaplanMeier, logRank } from '../../../../lib/science.mjs';
import { lineChart } from '../../charts.mjs';

const ui = { t: null, e: null, g: '' };

export function render(body) {
  body.innerHTML = dataBar() + '<div id="surv"></div>';
  wireDataBar(body);
  const box = $('#surv');
  if (!lab.data) { box.innerHTML = empty('Time-to-event analysis.', 'Load data with a time column and a 0/1 event column — the synthetic cohort includes months to progression.'); return; }
  const n = numericCols(), bin = lab.data.profile.filter(c => c.type === 'binary'), g = groupCols();
  if (ui.t == null || !n.some(c => c.index === Number(ui.t))) { ui.t = n.find(c => /time|month|day|week|year/i.test(c.name))?.index ?? n[0]?.index; ui.e = bin.find(c => /event|status|death|progress/i.test(c.name))?.index ?? bin[0]?.index; ui.g = g.find(c => /group|arm|treat/i.test(c.name))?.index ?? ''; }
  box.innerHTML = `<div class="split"><section class="card"><h2>Kaplan–Meier & log-rank</h2><p class="muted small">Event column must be coded 1 = event, 0 = censored.</p>
      <label class="field">Time to event<select id="t">${opts(n, ui.t)}</select></label>
      <label class="field">Event indicator<select id="e">${opts(bin.length ? bin : n, ui.e)}</select></label>
      <label class="field">Compare groups<select id="g"><option value="">No grouping</option>${opts(g, ui.g)}</select></label>
      <button class="btn primary" id="km" style="width:100%">${icon('chart', 16)} Estimate survival</button><div class="error" id="km-err" role="alert"></div></section>
    <section class="card" id="km-out"><p class="muted">Survival curves with 95% log-log confidence bands, median survival and the log-rank test.</p></section></div>`;
  $('#km').onclick = async () => {
    const err = $('#km-err'), out = $('#km-out'); err.textContent = '';
    try {
      ui.t = Number($('#t').value); ui.e = Number($('#e').value); ui.g = $('#g').value;
      const d = lab.data, t = colNumbers(ui.t), e = colNumbers(ui.e), gv = ui.g === '' ? d.rows.map(() => 'All') : colValues(Number(ui.g));
      const labels = [...new Set(gv.filter(Boolean))].slice(0, 6), fits = labels.map(l => ({ label: l, ...kaplanMeier(t.filter((_, i) => gv[i] === l), e.filter((_, i) => gv[i] === l)) }));
      const lr = labels.length > 1 ? logRank(t.filter((_, i) => labels.includes(gv[i])), e.filter((_, i) => labels.includes(gv[i])), gv.filter(v => labels.includes(v))) : null;
      const series = fits.map((f, i) => ({ label: `${f.label} (n=${f.n})`, step: true, c: i, points: f.steps.map(s => [s.t, s.s]).concat([[Math.max(...t.filter(Number.isFinite)), f.steps.at(-1).s]]), band: f.steps.map(s => [s.t, s.lo, s.hi]) }));
      const run = await logRun('kaplan-meier', { time: d.headers[ui.t], event: d.headers[ui.e], group: ui.g === '' ? null : d.headers[Number(ui.g)] }, { groups: fits.map(f => ({ label: f.label, n: f.n, events: f.events, median: f.median })), logRank: lr });
      out.innerHTML = `<div class="metrics">${fits.map(f => metric(esc(f.label), f.median == null ? 'Not reached' : fmt(f.median, 1), `median · ${f.events}/${f.n} events`)).join('')}${lr ? metric('Log-rank χ²', `${fmt(lr.chi2)} (df ${lr.df})`, `p = ${fmtP(lr.p)}`) : ''}</div>`
        + lineChart(series, { xLabel: d.headers[ui.t], yLabel: 'Survival probability', title: 'Kaplan–Meier survival curves' })
        + (lr ? table(['Group', 'Observed', 'Expected', 'O/E'], lr.labels.map((l, i) => [esc(l), lr.observed[i], fmt(lr.expected[i], 2), fmt(lr.observed[i] / lr.expected[i], 2)]), { numeric: [1, 2, 3] }) : '')
        + `<p class="method-note">Greenwood variance with log(−log) confidence bands. The log-rank test assumes proportional hazards and non-informative censoring; crossing curves indicate this assumption may not hold.</p><div class="actions"><button class="btn small" id="dl">${icon('download', 14)} Export run</button><span class="muted small mono">sha256 ${run.inputSha256.slice(0, 16)}…</span></div>`;
      $('#dl').onclick = () => download('cerebro-survival.json', JSON.stringify(run, null, 2));
    } catch (x) { err.textContent = x.message; }
  };
}
