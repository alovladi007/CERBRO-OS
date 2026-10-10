import { $, $$, esc, icon, empty, table, fmt, fmtP, metric, logRun, download } from '../../ui.mjs';
import { lab, dataBar, wireDataBar, numericCols, groupCols, colNumbers, colValues, opts } from '../lab.mjs';
import { ols } from '../../../../lib/science.mjs';
import { scatterChart } from '../../charts.mjs';

const ui = { y: null, xs: [], cats: [] };

export function render(body) {
  body.innerHTML = dataBar() + '<div id="reg"></div>';
  wireDataBar(body);
  const box = $('#reg');
  if (!lab.data) { box.innerHTML = empty('Model an outcome with several predictors.', 'Load a dataset or the synthetic cohort.'); return; }
  const n = numericCols(), g = groupCols();
  if (ui.y == null || !n.some(c => c.index === Number(ui.y))) { ui.y = n.find(c => /follow|outcome|score/i.test(c.name))?.index ?? n[0]?.index; ui.xs = n.filter(c => c.index !== ui.y).slice(0, 2).map(c => c.index); }
  box.innerHTML = `<div class="split"><section class="card"><h2>Multiple linear regression</h2><p class="muted small">Ordinary least squares with intercept. Categorical predictors are dummy-coded against their first level.</p>
      <label class="field">Outcome<select id="y">${opts(n, ui.y)}</select></label>
      <div class="field">Numeric predictors<div class="chips">${n.map(c => `<label class="chip"><input type="checkbox" data-x="${c.index}" ${ui.xs.includes(c.index) ? 'checked' : ''}> ${esc(c.name)}</label>`).join('')}</div></div>
      <div class="field">Categorical predictors<div class="chips">${g.map(c => `<label class="chip"><input type="checkbox" data-cat="${c.index}" ${ui.cats.includes(c.index) ? 'checked' : ''}> ${esc(c.name)}</label>`).join('') || '<span class="muted">None detected</span>'}</div></div>
      <button class="btn primary" id="fit" style="width:100%">${icon('chart', 16)} Fit model</button><div class="error" id="reg-err" role="alert"></div></section>
    <section class="card" id="reg-out"><p class="muted">Coefficients, 95% confidence intervals, R² and diagnostics appear here.</p></section></div>`;
  $('#fit').onclick = async () => {
    const err = $('#reg-err'), out = $('#reg-out'); err.textContent = '';
    try {
      ui.y = Number($('#y').value);
      ui.xs = $$('[data-x]', box).filter(c => c.checked).map(c => Number(c.dataset.x)).filter(i => i !== ui.y);
      ui.cats = $$('[data-cat]', box).filter(c => c.checked).map(c => Number(c.dataset.cat));
      if (!ui.xs.length && !ui.cats.length) throw Error('Select at least one predictor.');
      const d = lab.data, names = ui.xs.map(i => d.headers[i]), numCols = ui.xs.map(colNumbers), dummies = [];
      for (const c of ui.cats) {
        const vals = colValues(c), levels = [...new Set(vals.filter(Boolean))].sort();
        levels.slice(1).forEach(l => { names.push(`${d.headers[c]} = ${l}`); dummies.push(vals.map(v => (v ? (v === l ? 1 : 0) : NaN))); });
      }
      const X = d.rows.map((_, r) => [...numCols.map(col => col[r]), ...dummies.map(col => col[r])]), y = colNumbers(ui.y);
      const m = ols(X, y, names);
      const run = await logRun('ols-regression', { outcome: d.headers[ui.y], predictors: names, n: m.n }, { coef: m.coef, r2: m.r2, adjR2: m.adjR2, sigma: m.sigma, F: m.F, fP: m.fP });
      out.innerHTML = `<div class="eyebrow">${esc(d.headers[ui.y])} ~ ${names.map(esc).join(' + ')}</div><div class="metrics">${metric('R²', fmt(m.r2), `adjusted ${fmt(m.adjR2)}`)}${metric('F', fmt(m.F), `p = ${fmtP(m.fP)}`)}${metric('Residual SD', fmt(m.sigma))}${metric('Complete rows', m.n, `df ${m.df}`)}</div>`
        + table(['Term', 'Estimate', 'SE', 't', 'p', '95% CI'], m.coef.map(c => [esc(c.name), fmt(c.estimate), fmt(c.se), fmt(c.t), fmtP(c.p), `${fmt(c.ci[0])} to ${fmt(c.ci[1])}`]), { numeric: [1, 2, 3, 4] })
        + `<h3 style="margin-top:16px">Residuals vs fitted</h3>` + scatterChart(m.fitted.map((f, i) => [f, m.resid[i]]), { xLabel: 'Fitted values', yLabel: 'Residuals', title: 'Residuals versus fitted values' })
        + `<p class="method-note">Complete-case analysis: rows with any missing outcome or predictor are dropped. Check the residual plot for non-linearity and heteroscedasticity; coefficients are associations, not causal effects, unless the design supports that interpretation.</p><div class="actions"><button class="btn small" id="dl">${icon('download', 14)} Export run</button><span class="muted small mono">sha256 ${run.inputSha256.slice(0, 16)}…</span></div>`;
      $('#dl').onclick = () => download('cerebro-regression.json', JSON.stringify(run, null, 2));
    } catch (e) { err.textContent = e.message; }
  };
}
