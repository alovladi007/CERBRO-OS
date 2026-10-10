import { $, esc, icon, notice, empty, table, fmt, download, toast } from '../../ui.mjs';
import { lab, dataBar, wireDataBar, numericCols, groupCols, colValues, opts } from '../lab.mjs';
import { describe, histogram, pearson } from '../../../../lib/science.mjs';
import { histogramChart, boxPlot } from '../../charts.mjs';

const sel = { measure: null, group: '' };

export function render(body) {
  body.innerHTML = notice('Participant-level rows are analyzed in memory on this device and are <strong>never saved</strong> to the workspace or sent anywhere. Use de-identified data you are authorized to analyze.')
    + dataBar() + '<div id="cohort-out"></div>';
  wireDataBar(body);
  const out = $('#cohort-out');
  if (!lab.data) { out.innerHTML = empty('Understand your data before modeling it.', 'Load a CSV or the synthetic cohort to profile columns, missingness and distributions.'); return; }
  const d = lab.data, nums = numericCols();
  if (sel.measure == null || !nums.some(c => c.index === Number(sel.measure))) sel.measure = nums[0]?.index ?? null;
  const profileRows = d.profile.map(c => [esc(c.name), `<span class="tag ${c.type === 'numeric' ? 'accent' : c.type === 'binary' ? 'cyan' : ''}">${c.type}</span>`, c.unique.toLocaleString(), `${c.missing} (${(c.missing / d.rows.length * 100).toFixed(1)}%)`, c.nonNumeric && c.type === 'numeric' ? `<span class="tag warn">${c.nonNumeric} non-numeric</span>` : '']);
  out.innerHTML = `<div class="grid2"><section class="card"><h2>Column profile</h2><p class="muted small">Types inferred automatically. “NA”, “null” and empty cells count as missing.</p>${table(['Column', 'Type', 'Unique', 'Missing', ''], profileRows)}</section>
    <section class="card"><h2>Distribution</h2>${sel.measure == null ? '<p class="muted">No numeric columns.</p>' : `<div class="filters"><label>Measure <select id="measure">${opts(nums, sel.measure)}</select></label><label>Group by <select id="group"><option value="">None</option>${opts(groupCols(), sel.group)}</select></label><button class="btn small" id="export-summary">${icon('download', 14)} Export summary</button></div><div id="dist"></div>`}</section></div>
    <section class="card" style="margin-top:18px"><div class="section-head" style="margin-top:0"><h2>Descriptive statistics</h2><span class="muted small">Sample SD (n−1) · quartiles type 7</span></div><div id="desc"></div></section>
    <section class="card" style="margin-top:18px"><div class="section-head" style="margin-top:0"><h2>Correlation matrix</h2><span class="muted small">Pearson r on pairwise-complete observations</span></div><div id="corr"></div></section>
    <section class="card" style="margin-top:18px"><div class="section-head" style="margin-top:0"><h2>Data preview</h2><span class="muted small">First 12 rows</span></div>${table(d.headers.map(esc), d.rows.slice(0, 12).map(r => r.map(x => esc(x || '—'))))}</section>`;
  if (sel.measure == null) return;
  const draw = () => {
    const i = Number(sel.measure), g = sel.group === '' ? null : Number(sel.group), groups = {};
    d.rows.forEach(r => { const k = g == null ? 'All rows' : (r[g] || '(missing)'); (groups[k] ??= []).push(r[i]); });
    const entries = Object.entries(groups).slice(0, 50), summary = entries.map(([label, v]) => ({ label, ...describe(v) }));
    $('#dist').innerHTML = (g == null ? histogramChart(histogram(colValues(i)), { xLabel: d.headers[i] }) : boxPlot(summary, { yLabel: d.headers[i] })) + (Object.keys(groups).length > 50 ? '<p class="muted small">Showing the first 50 groups.</p>' : '');
    $('#desc').innerHTML = table(['Group', 'n', 'Missing', 'Mean', 'SD', 'SE', 'Median', 'Q1', 'Q3', 'Min', 'Max', 'Skew'], summary.map(s => [esc(s.label), fmt(s.n), fmt(s.missing), fmt(s.mean), fmt(s.sd), fmt(s.se), fmt(s.median), fmt(s.q1), fmt(s.q3), fmt(s.min), fmt(s.max), fmt(s.skew, 2)]), { numeric: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] });
    $('#export-summary').onclick = () => { download('cerebro-cohort-summary.json', JSON.stringify({ tool: 'cohort-descriptives', createdAt: new Date().toISOString(), source: d.name, rows: d.rows.length, measure: d.headers[i], groupBy: g == null ? null : d.headers[g], method: 'Finite numeric values; sample SD (n−1); quartiles type 7.', summary }, null, 2)); toast('Summary exported — participant rows were not included.'); };
  };
  $('#measure').onchange = e => { sel.measure = e.target.value; draw(); };
  $('#group').onchange = e => { sel.group = e.target.value; draw(); };
  draw();
  const nc = nums.slice(0, 10), cols = nc.map(c => d.rows.map(r => (r[c.index] === '' ? NaN : Number(r[c.index]))));
  $('#corr').innerHTML = nc.length < 2 ? '<p class="muted">Need at least two numeric columns.</p>' : table(['', ...nc.map(c => esc(c.name))], nc.map((c, a) => [`<strong>${esc(c.name)}</strong>`, ...nc.map((_, b) => { if (a === b) return '1'; try { const r = pearson(cols[a], cols[b]).r; return `<span style="color:${r > 0 ? 'var(--accent)' : 'var(--chart-3)'};opacity:${(0.35 + Math.abs(r) * 0.65).toFixed(2)};font-weight:650">${r.toFixed(2)}</span>`; } catch { return '—'; } })]), { numeric: nc.map((_, k) => k + 1) });
}
