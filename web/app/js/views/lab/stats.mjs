import { $, $$, esc, icon, notice, empty, table, fmt, fmtP, metric, logRun, download } from '../../ui.mjs';
import { lab, dataBar, wireDataBar, numericCols, groupCols, colNumbers, colValues, opts } from '../lab.mjs';
import { tTest2, mannWhitney, anova, kruskalWallis, pairedTTest, chiSquare, pearson, spearman, adjustP, describe, ols } from '../../../../lib/science.mjs';
import { boxPlot, scatterChart } from '../../charts.mjs';

const ui = { test: 'two', a: null, b: null, g: null };

const TESTS = [['two', 'Compare 2 groups'], ['k', 'Compare 3+ groups'], ['paired', 'Paired measures'], ['assoc', 'Categorical association'], ['corr', 'Correlation'], ['adjust', 'Multiplicity correction']];

function result(title, metrics, extra = '', note = '') { return `<div class="eyebrow">${title}</div><div class="metrics">${metrics.join('')}</div>${extra}${note ? `<p class="method-note">${note}</p>` : ''}`; }

function controls() {
  const n = numericCols(), g = groupCols();
  const pick = (id, label, cols, val) => `<label class="field">${label}<select id="${id}">${opts(cols, val)}</select></label>`;
  if (ui.test === 'adjust') return `<label class="field">p-values (one per line or comma-separated)<textarea id="pvals" class="code">0.001\n0.012\n0.034\n0.041\n0.20\n0.65</textarea></label>`;
  if (!lab.data) return '';
  if (ui.test === 'two' || ui.test === 'k') return pick('a', 'Outcome (numeric)', n, ui.a) + pick('g', 'Grouping column', g, ui.g) + (ui.test === 'two' ? '<div id="levels"></div>' : '');
  if (ui.test === 'paired') return pick('a', 'Measure 1 (e.g. baseline)', n, ui.a) + pick('b', 'Measure 2 (e.g. follow-up)', n, ui.b);
  if (ui.test === 'assoc') return pick('a', 'Row variable', g, ui.a) + pick('b', 'Column variable', g, ui.b);
  if (ui.test === 'corr') return pick('a', 'X variable', n, ui.a) + pick('b', 'Y variable', n, ui.b);
  return '';
}

async function run() {
  const out = $('#stats-out'), err = $('#stats-err');
  err.textContent = '';
  try {
    let html, input, res, tool;
    if (ui.test === 'adjust') {
      const ps = $('#pvals').value.split(/[\s,;]+/).filter(Boolean).map(Number);
      if (!ps.length || ps.some(p => !(p >= 0 && p <= 1))) throw Error('Enter p-values between 0 and 1.');
      const bh = adjustP(ps, 'BH'), holm = adjustP(ps, 'holm'), bon = adjustP(ps, 'bonferroni');
      tool = 'multiplicity-adjustment'; input = { p: ps }; res = { bh, holm, bonferroni: bon };
      html = result('Adjusted p-values', [metric('Tests', ps.length), metric('Significant (BH q<0.05)', bh.filter(p => p < .05).length), metric('Significant (Holm)', holm.filter(p => p < .05).length)], table(['#', 'Raw p', 'Benjamini–Hochberg q', 'Holm', 'Bonferroni'], ps.map((p, i) => [i + 1, fmtP(p), fmtP(bh[i]), fmtP(holm[i]), fmtP(bon[i])]), { numeric: [1, 2, 3, 4] }), 'BH controls the false discovery rate; Holm and Bonferroni control the family-wise error rate (Holm is uniformly more powerful).');
    } else {
      if (!lab.data) throw Error('Load a dataset first.');
      const d = lab.data, a = Number($('#a').value), b = $('#b') ? Number($('#b').value) : null, g = $('#g') ? Number($('#g').value) : null;
      Object.assign(ui, { a, b, g });
      if (ui.test === 'two' || ui.test === 'k') {
        const levels = [...new Set(colValues(g).filter(Boolean))], y = colNumbers(a);
        let chosen = levels;
        if (ui.test === 'two') { chosen = [$('#l1').value, $('#l2').value]; if (chosen[0] === chosen[1]) throw Error('Choose two different groups.'); }
        const groups = chosen.map(l => y.filter((v, i) => d.rows[i][g] === l && Number.isFinite(v)));
        const summaries = chosen.map((l, i) => ({ label: l, ...describe(groups[i]) }));
        const desc = table(['Group', 'n', 'Mean', 'SD', 'Median', 'IQR'], summaries.map(s => [esc(s.label), s.n, fmt(s.mean), fmt(s.sd), fmt(s.median), `${fmt(s.q1, 2)}–${fmt(s.q3, 2)}`]), { numeric: [1, 2, 3, 4] });
        if (ui.test === 'two') {
          const w = tTest2(groups[0], groups[1]), s = tTest2(groups[0], groups[1], { equalVar: true }), m = mannWhitney(groups[0], groups[1]);
          tool = 'two-group-comparison'; input = { outcome: d.headers[a], group: d.headers[g], levels: chosen, n: groups.map(x => x.length) }; res = { welch: w, student: s, mannWhitney: m };
          html = result(`${esc(d.headers[a])} by ${esc(d.headers[g])}`, [metric('Mean difference', fmt(w.diff), `95% CI ${fmt(w.ci[0])} to ${fmt(w.ci[1])}`), metric("Hedges' g", fmt(w.hedgesG), `95% CI ${fmt(w.gCI[0], 2)} to ${fmt(w.gCI[1], 2)}`), metric('Welch t', `${fmt(w.t)} (df ${fmt(w.df, 1)})`, `p = ${fmtP(w.p)}`), metric('Mann–Whitney U', fmt(m.U, 1), `p = ${fmtP(m.p)} · r = ${fmt(m.rankBiserial, 2)}`)],
            desc + boxPlot(summaries, { yLabel: d.headers[a] }) + table(['Test', 'Statistic', 'df', 'p'], [['Welch t-test (default)', fmt(w.t), fmt(w.df, 1), fmtP(w.p)], ['Student t-test (equal variances)', fmt(s.t), fmt(s.df, 0), fmtP(s.p)], ['Mann–Whitney U (normal approx., tie-corrected)', `U = ${fmt(m.U, 1)}, z = ${fmt(m.z)}`, '—', fmtP(m.p)]]),
            'Welch’s test is reported by default because it does not assume equal variances. Effect size is bias-corrected Hedges’ g with a large-sample CI. Pre-specify the primary test; do not choose after seeing p-values.');
        } else {
          const an = anova(groups), kw = kruskalWallis(groups);
          tool = 'k-group-comparison'; input = { outcome: d.headers[a], group: d.headers[g], levels: chosen }; res = { anova: an, kruskalWallis: kw };
          html = result(`${esc(d.headers[a])} across ${chosen.length} groups`, [metric('ANOVA F', `${fmt(an.F)} (${an.df1}, ${an.df2})`, `p = ${fmtP(an.p)}`), metric('η²', fmt(an.etaSq)), metric('Kruskal–Wallis H', fmt(kw.H), `df ${kw.df} · p = ${fmtP(kw.p)}`)], desc + boxPlot(summaries, { yLabel: d.headers[a] }), 'One-way ANOVA assumes approximately normal residuals and equal variances; Kruskal–Wallis is the rank-based alternative. Follow significant omnibus tests with pre-specified, multiplicity-adjusted contrasts.');
        }
      } else if (ui.test === 'paired') {
        const x = colNumbers(a), y = colNumbers(b), keep = x.map((v, i) => Number.isFinite(v) && Number.isFinite(y[i]));
        const pt = pairedTTest(x.filter((_, i) => keep[i]), y.filter((_, i) => keep[i]));
        tool = 'paired-t-test'; input = { measure1: d.headers[a], measure2: d.headers[b], completePairs: pt.n }; res = pt;
        html = result(`${esc(d.headers[a])} vs ${esc(d.headers[b])}`, [metric('Mean difference', fmt(pt.meanDiff), `95% CI ${fmt(pt.ci[0])} to ${fmt(pt.ci[1])}`), metric('t', `${fmt(pt.t)} (df ${pt.df})`, `p = ${fmtP(pt.p)}`), metric('Cohen’s dz', fmt(pt.dz)), metric('Complete pairs', pt.n, `${keep.length - pt.n} incomplete excluded`)], '', 'Difference is measure 1 − measure 2. Rows missing either measure are excluded (complete-case analysis); consider whether missingness is informative.');
      } else if (ui.test === 'assoc') {
        const rv = colValues(a), cv = colValues(b), rl = [...new Set(rv.filter(Boolean))], cl = [...new Set(cv.filter(Boolean))];
        const tab = rl.map(r => cl.map(c => rv.filter((v, i) => v === r && cv[i] === c).length)), cs = chiSquare(tab);
        tool = 'chi-square'; input = { rows: d.headers[a], cols: d.headers[b], table: tab }; res = cs;
        html = result(`${esc(d.headers[a])} × ${esc(d.headers[b])}`, [metric('χ²', `${fmt(cs.chi2)} (df ${cs.df})`, `p = ${fmtP(cs.p)}`), metric('Cramér’s V', fmt(cs.cramersV)), metric('Min expected', fmt(cs.minExpected, 2), cs.minExpected < 5 ? 'Below 5 — consider exact test' : 'OK')], table(['', ...cl.map(esc)], tab.map((r, i) => [`<strong>${esc(rl[i])}</strong>`, ...r]), { numeric: cl.map((_, i) => i + 1) }), 'Pearson χ² without continuity correction. With expected counts below 5, prefer Fisher’s exact test.');
      } else if (ui.test === 'corr') {
        const x = colNumbers(a), y = colNumbers(b), pr = pearson(x, y), sp = spearman(x, y), fit = ols(x.map(v => [v]), y, [d.headers[a]]);
        tool = 'correlation'; input = { x: d.headers[a], y: d.headers[b] }; res = { pearson: pr, spearman: sp };
        html = result(`${esc(d.headers[a])} vs ${esc(d.headers[b])}`, [metric('Pearson r', fmt(pr.r), pr.ci ? `95% CI ${fmt(pr.ci[0], 2)} to ${fmt(pr.ci[1], 2)}` : ''), metric('p (Pearson)', fmtP(pr.p), `n = ${pr.n}`), metric('Spearman ρ', fmt(sp.r), `p = ${fmtP(sp.p)}`)], scatterChart(x.map((v, i) => [v, y[i]]), { xLabel: d.headers[a], yLabel: d.headers[b], fit: { a: fit.coef[0].estimate, b: fit.coef[1].estimate } }), 'Pearson CI uses the Fisher z transformation. Spearman is robust to monotone non-linearity and outliers. Correlation does not imply causation.');
      }
    }
    const runRec = await logRun(tool, input, res);
    out.innerHTML = html + `<div class="actions"><button class="btn small" id="dl-run">${icon('download', 14)} Export run (JSON)</button><span class="muted small mono">sha256 ${runRec.inputSha256.slice(0, 16)}…</span></div>`;
    $('#dl-run').onclick = () => download(`cerebro-${tool}.json`, JSON.stringify(runRec, null, 2));
  } catch (e) { err.textContent = e.message; out.innerHTML = ''; }
}

export function render(body) {
  body.innerHTML = (ui.test === 'adjust' ? '' : dataBar()) + `<div class="split"><section class="card"><h2>Hypothesis tests</h2><p class="muted small">Choose an analysis, then the variables.</p>
      <div class="chips">${TESTS.map(([k, l]) => `<button class="chip ${ui.test === k ? 'on' : ''}" data-test="${k}">${l}</button>`).join('')}</div>
      <div id="controls" style="margin-top:12px">${controls()}</div>
      ${lab.data || ui.test === 'adjust' ? `<button class="btn primary" id="run-stats" style="width:100%">${icon('chart', 16)} Run analysis</button>` : ''}<div class="error" id="stats-err" role="alert"></div></section>
    <section class="card"><div id="stats-out">${lab.data || ui.test === 'adjust' ? '<p class="muted">Results appear here with effect sizes, confidence intervals and method notes.</p>' : empty('Load a dataset to begin.', 'Use the synthetic cohort to try every test.')}</div></section></div>`;
  if (ui.test !== 'adjust') wireDataBar(body);
  $$('[data-test]', body).forEach(b => b.onclick = () => { ui.test = b.dataset.test; render(body); });
  const lv = $('#levels', body);
  const drawLevels = () => {
    if (!lv) return;
    const levels = [...new Set(colValues(Number($('#g').value)).filter(Boolean))];
    lv.innerHTML = levels.length < 2 ? '<p class="error">This column has fewer than two groups.</p>' : `<div class="form-grid"><label class="field">Group 1<select id="l1">${levels.map((l, i) => `<option ${i === 0 ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label><label class="field">Group 2<select id="l2">${levels.map((l, i) => `<option ${i === 1 ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label></div>`;
  };
  if (lv) { $('#g').onchange = drawLevels; drawLevels(); }
  $('#run-stats', body)?.addEventListener('click', run);
}
