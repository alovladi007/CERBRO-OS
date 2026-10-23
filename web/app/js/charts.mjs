// Cerebro OS — dependency-free SVG charts. Colors come from CSS classes (s1…s5 / f1…f5)
// bound to theme tokens, so every chart follows light/dark mode automatically.
import { esc } from './ui.mjs';

const W = 900, H = 320, M = { l: 62, r: 20, t: 18, b: 46 };

function niceTicks(lo, hi, count = 5) {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 1];
  if (lo === hi) { lo -= 1; hi += 1; }
  const span = hi - lo, step0 = span / count, mag = 10 ** Math.floor(Math.log10(step0)), err = step0 / mag;
  const step = (err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1) * mag, out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(+v.toPrecision(12));
  return out;
}
const tickLabel = v => (v = Math.abs(v) < 1e-10 ? 0 : v, Math.abs(v) >= 1e4 || (Math.abs(v) < 1e-3 && v !== 0) ? v.toExponential(1) : +v.toPrecision(4) + '');

function frame({ xLo, xHi, yLo, yHi, xLabel, yLabel, logX = false, logY = false, w = W, h = H, xTicks, yTicks }) {
  const tx = logX ? Math.log10 : v => v, ty = logY ? Math.log10 : v => v;
  const X = v => M.l + (tx(v) - tx(xLo)) / ((tx(xHi) - tx(xLo)) || 1) * (w - M.l - M.r);
  const Y = v => h - M.b - (ty(v) - ty(yLo)) / ((ty(yHi) - ty(yLo)) || 1) * (h - M.t - M.b);
  const xt = xTicks || (logX ? logTicks(xLo, xHi) : niceTicks(xLo, xHi, 6)).filter(v => v >= xLo && v <= xHi);
  const yt = yTicks || (logY ? logTicks(yLo, yHi) : niceTicks(yLo, yHi, 5)).filter(v => v >= yLo && v <= yHi);
  const grid = yt.map(v => `<line class="grid" x1="${M.l}" x2="${w - M.r}" y1="${Y(v)}" y2="${Y(v)}"/><text class="tick" x="${M.l - 8}" y="${Y(v) + 4}" text-anchor="end">${tickLabel(v)}</text>`).join('')
    + xt.map(v => `<text class="tick" x="${X(v)}" y="${h - M.b + 17}" text-anchor="middle">${tickLabel(v)}</text>`).join('');
  const axes = `<path class="axis" d="M${M.l} ${M.t}V${h - M.b}H${w - M.r}"/>${xLabel ? `<text class="label" x="${(M.l + w - M.r) / 2}" y="${h - 8}" text-anchor="middle">${esc(xLabel)}</text>` : ''}${yLabel ? `<text class="label" transform="translate(14 ${(M.t + h - M.b) / 2}) rotate(-90)" text-anchor="middle">${esc(yLabel)}</text>` : ''}`;
  return { X, Y, grid, axes, w, h };
}
function logTicks(lo, hi) { const out = []; for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++) out.push(10 ** e); return out; }
const svg = (w, h, label, body) => `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}">${body}</svg>`;
const legend = items => items.length > 1 ? `<div class="legend">${items.map((s, i) => `<span><i class="sw f${(s.c ?? i) % 5 + 1}"></i>${esc(s.label)}</span>`).join('')}</div>` : '';

/** series: [{ label, points: [[x,y],…], c?: colorIndex, step?: bool, dashed?: bool, band?: [[x,lo,hi],…] }] */
export function lineChart(series, { xLabel = '', yLabel = '', logX = false, logY = false, title = 'Line chart', yZero = false, markers = [] } = {}) {
  const pts = series.flatMap(s => [...s.points, ...(s.band || []).flatMap(b => [[b[0], b[1]], [b[0], b[2]]])]).filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]) && (!logY || p[1] > 0) && (!logX || p[0] > 0));
  if (!pts.length) return '<p class="muted">No data to plot.</p>';
  let yLo = Math.min(...pts.map(p => p[1])), yHi = Math.max(...pts.map(p => p[1]));
  if (yZero && !logY) yLo = Math.min(0, yLo);
  if (!logY) { const pad = (yHi - yLo) * 0.06 || 1; yHi += pad; if (!yZero) yLo -= pad; }
  const f = frame({ xLo: Math.min(...pts.map(p => p[0])), xHi: Math.max(...pts.map(p => p[0])), yLo, yHi, xLabel, yLabel, logX, logY });
  const valid = p => Number.isFinite(p[1]) && (!logY || p[1] > 0) && (!logX || p[0] > 0);
  const body = series.map((s, i) => {
    const c = (s.c ?? i) % 5 + 1;
    let band = '';
    if (s.band?.length) { const b = s.band.filter(x => (!logY || x[1] > 0)); band = `<path class="f${c} band" d="M${b.map(x => `${f.X(x[0])} ${f.Y(x[2])}`).join('L')}L${b.slice().reverse().map(x => `${f.X(x[0])} ${f.Y(x[1])}`).join('L')}Z"/>`; }
    const P = s.points.filter(valid);
    let d = '';
    if (s.step) P.forEach((p, k) => { d += k ? `H${f.X(p[0])}V${f.Y(p[1])}` : `M${f.X(p[0])} ${f.Y(p[1])}`; });
    else d = 'M' + P.map(p => `${f.X(p[0]).toFixed(1)} ${f.Y(p[1]).toFixed(1)}`).join('L');
    return band + `<path class="s${c} line${s.dashed ? ' dashed' : ''}" d="${d}"/>` + (s.dots ? P.map(p => `<circle class="f${c}" cx="${f.X(p[0])}" cy="${f.Y(p[1])}" r="3"/>`).join('') : '');
  }).join('');
  const mk = markers.map(m => `<line class="marker" x1="${f.X(m.x)}" x2="${f.X(m.x)}" y1="${M.t}" y2="${H - M.b}"/><text class="tick" x="${f.X(m.x) + 4}" y="${M.t + 10}">${esc(m.label)}</text>`).join('');
  return svg(f.w, f.h, title, f.grid + body + mk + f.axes) + legend(series.filter(s => s.label));
}

export function histogramChart(bins, { xLabel = '', title = 'Histogram' } = {}) {
  if (!bins.length) return '<p class="muted">No numeric values.</p>';
  const f = frame({ xLo: bins[0].x0, xHi: bins.at(-1).x1, yLo: 0, yHi: Math.max(...bins.map(b => b.count)) * 1.08, xLabel, yLabel: 'Count' });
  return svg(f.w, f.h, title, f.grid + bins.map(b => `<rect class="f1 bar" x="${f.X(b.x0) + 1}" y="${f.Y(b.count)}" width="${Math.max(1, f.X(b.x1) - f.X(b.x0) - 2)}" height="${f.Y(0) - f.Y(b.count)}"><title>${tickLabel(b.x0)}–${tickLabel(b.x1)}: ${b.count}</title></rect>`).join('') + f.axes);
}

/** groups: [{ label, q1, median, q3, min, max, mean }] */
export function boxPlot(groups, { yLabel = '', title = 'Box plot' } = {}) {
  const g = groups.filter(x => x.n > 0);
  if (!g.length) return '';
  const lo = Math.min(...g.map(x => x.min)), hi = Math.max(...g.map(x => x.max)), pad = (hi - lo) * 0.08 || 1;
  const h = 280, f = frame({ xLo: 0, xHi: g.length, yLo: lo - pad, yHi: hi + pad, yLabel, h, xTicks: [] }), bw = Math.min(70, (W - M.l - M.r) / g.length * 0.5);
  const body = g.map((x, i) => {
    const cx = f.X(i + 0.5), c = i % 5 + 1;
    return `<line class="s${c} line" x1="${cx}" x2="${cx}" y1="${f.Y(x.min)}" y2="${f.Y(x.q1)}"/><line class="s${c} line" x1="${cx}" x2="${cx}" y1="${f.Y(x.q3)}" y2="${f.Y(x.max)}"/>`
      + `<rect class="f${c} box s${c}" x="${cx - bw / 2}" y="${f.Y(x.q3)}" width="${bw}" height="${Math.max(1, f.Y(x.q1) - f.Y(x.q3))}"/><line class="median" x1="${cx - bw / 2}" x2="${cx + bw / 2}" y1="${f.Y(x.median)}" y2="${f.Y(x.median)}"/>`
      + `<circle class="mean" cx="${cx}" cy="${f.Y(x.mean)}" r="3.5"><title>mean ${tickLabel(x.mean)}</title></circle><text class="tick" x="${cx}" y="${h - M.b + 17}" text-anchor="middle">${esc(String(x.label).slice(0, 16))}</text>`;
  }).join('');
  return svg(W, h, title, f.grid + body + f.axes);
}

export function scatterChart(points, { xLabel = '', yLabel = '', fit = null, title = 'Scatter plot' } = {}) {
  const P = points.filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (!P.length) return '';
  const xs = P.map(p => p[0]), ys = P.map(p => p[1]), px = (Math.max(...xs) - Math.min(...xs)) * 0.05 || 1, py = (Math.max(...ys) - Math.min(...ys)) * 0.08 || 1;
  const f = frame({ xLo: Math.min(...xs) - px, xHi: Math.max(...xs) + px, yLo: Math.min(...ys) - py, yHi: Math.max(...ys) + py, xLabel, yLabel });
  const line = fit ? `<path class="s3 line" d="M${f.X(Math.min(...xs))} ${f.Y(fit.a + fit.b * Math.min(...xs))}L${f.X(Math.max(...xs))} ${f.Y(fit.a + fit.b * Math.max(...xs))}"/>` : '';
  return svg(f.w, f.h, title, f.grid + P.slice(0, 5000).map(p => `<circle class="f1 dot" cx="${f.X(p[0]).toFixed(1)}" cy="${f.Y(p[1]).toFixed(1)}" r="3"/>`).join('') + line + f.axes);
}

/** Forest plot for meta-analysis. */
export function forestPlot(studies, result, { exp = false, label = 'Effect' } = {}) {
  const tr = v => { const x = exp ? Math.exp(v) : v; return Math.abs(x) < 5e-3 ? 0 : x; }, rows = studies.length, rowH = 26, top = 30, h = top + rows * rowH + 92, w = 780, L = 200, R = 530;
  const vals = [...studies.flatMap(s => [s.effect - 1.96 * s.se, s.effect + 1.96 * s.se]), result.lower, result.upper, 0, ...(result.prediction || [])];
  const lo = Math.min(...vals), hi = Math.max(...vals), X = v => L + (v - lo) / ((hi - lo) || 1) * (R - L);
  const maxW = Math.max(...result.weights);
  const head = `<text class="label" x="0" y="16">Study</text><text class="label" x="${(L + R) / 2}" y="16" text-anchor="middle">${esc(label)} (95% CI)</text><text class="label" x="${w}" y="16" text-anchor="end">Weight · estimate</text>`;
  const body = studies.map((s, i) => {
    const y = top + i * rowH + 12, size = 5 + 9 * Math.sqrt(result.weights[i] / maxW);
    return `<text class="tick strong" x="0" y="${y + 4}">${esc(String(s.name).slice(0, 30))}</text><line class="s2 line" x1="${X(s.effect - 1.96 * s.se)}" x2="${X(s.effect + 1.96 * s.se)}" y1="${y}" y2="${y}"/><rect class="f1" x="${X(s.effect) - size / 2}" y="${y - size / 2}" width="${size}" height="${size}"/><text class="tick" x="${w}" y="${y + 4}" text-anchor="end">${(result.weights[i] * 100).toFixed(1)}% · ${tr(s.effect).toFixed(2)} [${tr(s.effect - 1.96 * s.se).toFixed(2)}, ${tr(s.effect + 1.96 * s.se).toFixed(2)}]</text>`;
  }).join('');
  const py = top + rows * rowH + 22;
  const pooled = `<line class="grid" x1="0" x2="${w}" y1="${py - 12}" y2="${py - 12}"/><text class="tick strong" x="0" y="${py + 5}">Pooled · ${esc(result.model)}</text><polygon class="f3" points="${X(result.lower)},${py} ${X(result.estimate)},${py - 8} ${X(result.upper)},${py} ${X(result.estimate)},${py + 8}"/><text class="tick strong" x="${w}" y="${py + 5}" text-anchor="end">${tr(result.estimate).toFixed(2)} [${tr(result.lower).toFixed(2)}, ${tr(result.upper).toFixed(2)}]</text>`
    + (result.prediction ? `<line class="s3 line dashed" x1="${X(result.prediction[0])}" x2="${X(result.prediction[1])}" y1="${py + 20}" y2="${py + 20}"/><text class="tick" x="0" y="${py + 24}">Prediction interval</text><text class="tick" x="${w}" y="${py + 24}" text-anchor="end">[${tr(result.prediction[0]).toFixed(2)}, ${tr(result.prediction[1]).toFixed(2)}]</text>` : '');
  const ticks = niceTicks(lo, hi, 5).filter(v => v >= lo && v <= hi).map(v => `<text class="tick" x="${X(v)}" y="${h - 8}" text-anchor="middle">${tr(v).toFixed(2)}</text>`).join('');
  const nullLine = lo <= 0 && hi >= 0 ? `<line class="marker" x1="${X(0)}" x2="${X(0)}" y1="${top - 6}" y2="${h - 26}"/>` : '';
  return `<div class="chart-scroll">${svg(w, h, 'Forest plot', head + nullLine + body + pooled + `<line class="axis" x1="${L}" x2="${R}" y1="${h - 24}" y2="${h - 24}"/>` + ticks)}</div>`;
}

export function funnelPlot(studies, result) {
  const maxSe = Math.max(...studies.map(s => s.se)) * 1.1, es = studies.map(s => s.effect);
  const lo = Math.min(...es, result.estimate - 1.96 * maxSe), hi = Math.max(...es, result.estimate + 1.96 * maxSe);
  const h = 280, f = frame({ xLo: lo, xHi: hi, yLo: 0, yHi: maxSe, xLabel: 'Effect', yLabel: 'Standard error (inverted)', h });
  const Yi = v => M.t + v / maxSe * (h - M.t - M.b);
  const cone = `<path class="f2 band" d="M${f.X(result.estimate)} ${Yi(0)}L${f.X(result.estimate - 1.96 * maxSe)} ${Yi(maxSe)}L${f.X(result.estimate + 1.96 * maxSe)} ${Yi(maxSe)}Z"/><line class="marker" x1="${f.X(result.estimate)}" x2="${f.X(result.estimate)}" y1="${Yi(0)}" y2="${Yi(maxSe)}"/>`;
  return svg(W, h, 'Funnel plot', cone + studies.map(s => `<circle class="f1 dot" cx="${f.X(s.effect)}" cy="${Yi(s.se)}" r="4"><title>${esc(s.name)}</title></circle>`).join('') + `<path class="axis" d="M${M.l} ${M.t}V${h - M.b}H${W - M.r}"/>` + niceTicks(lo, hi, 6).filter(v => v >= lo && v <= hi).map(v => `<text class="tick" x="${f.X(v)}" y="${h - M.b + 17}" text-anchor="middle">${tickLabel(v)}</text>`).join('') + `<text class="label" x="${(M.l + W - M.r) / 2}" y="${h - 8}" text-anchor="middle">Effect</text>`);
}

/** Heatmap for spectrograms: frames [{t, power[]}] × freqs. */
export function heatmap(spec, { title = 'Spectrogram' } = {}) {
  const { freqs, frames } = spec;
  if (!frames.length) return '';
  const h = 260, f = frame({ xLo: frames[0].t, xHi: frames.at(-1).t, yLo: freqs[0], yHi: freqs.at(-1), xLabel: 'Time (s)', yLabel: 'Frequency (Hz)', h });
  const all = frames.flatMap(x => x.power).filter(v => v > 0).map(Math.log10), lo = Math.min(...all), hi = Math.max(...all);
  const cw = (W - M.l - M.r) / frames.length + 0.5, ch = (h - M.t - M.b) / freqs.length + 0.5;
  const cells = frames.map((fr, i) => fr.power.map((p, j) => { const v = p > 0 ? (Math.log10(p) - lo) / ((hi - lo) || 1) : 0; return `<rect x="${(M.l + i * (W - M.l - M.r) / frames.length).toFixed(1)}" y="${(h - M.b - (j + 1) * (h - M.t - M.b) / freqs.length).toFixed(1)}" width="${cw.toFixed(1)}" height="${ch.toFixed(1)}" style="fill:var(--chart-1);fill-opacity:${(0.04 + 0.96 * v).toFixed(2)}"/>`; }).join('')).join('');
  return svg(W, h, title, cells + f.grid + f.axes);
}

export function barChart(items, { yLabel = '', title = 'Bar chart', max = null } = {}) {
  const top = max ?? Math.max(...items.map(i => i.value)) * 1.1, h = 240, f = frame({ xLo: 0, xHi: items.length, yLo: 0, yHi: top || 1, yLabel, h, xTicks: [] }), bw = (W - M.l - M.r) / items.length * 0.62;
  return svg(W, h, title, f.grid + items.map((it, i) => `<rect class="f${i % 5 + 1} bar" x="${f.X(i + 0.5) - bw / 2}" y="${f.Y(it.value)}" width="${bw}" height="${f.Y(0) - f.Y(it.value)}"/><text class="tick" x="${f.X(i + 0.5)}" y="${h - M.b + 17}" text-anchor="middle">${esc(it.label)}</text><text class="tick strong" x="${f.X(i + 0.5)}" y="${f.Y(it.value) - 6}" text-anchor="middle">${esc(it.text ?? tickLabel(it.value))}</text>`).join('') + f.axes);
}

/** PRISMA 2020 flow diagram from counts. */
export function prismaDiagram(c) {
  const box = (x, y, w, h, lines, cls = '') => `<g><rect class="prisma-box ${cls}" x="${x}" y="${y}" width="${w}" height="${h}" rx="8"/>${lines.map((l, i) => `<text class="prisma-text${i === 0 ? ' strong' : ''}" x="${x + 12}" y="${y + 22 + i * 17}">${esc(l)}</text>`).join('')}</g>`;
  const arrow = (x1, y1, x2, y2) => `<path class="prisma-arrow" d="M${x1} ${y1}L${x2} ${y2}" marker-end="url(#arr)"/>`;
  const sources = Object.entries(c.bySource || {}).map(([k, v]) => `${k}: ${v}`);
  const w = 760, h = 520;
  return `<div class="chart-scroll">${svg(w, h, 'PRISMA 2020 flow diagram', `<defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" class="prisma-head"/></marker></defs>`
    + `<text class="prisma-stage" x="0" y="14">IDENTIFICATION</text><text class="prisma-stage" x="0" y="190">SCREENING</text><text class="prisma-stage" x="0" y="440">INCLUDED</text>`
    + box(0, 26, 360, 40 + Math.max(1, sources.length) * 17, [`Records identified (n = ${c.identified})`, ...(sources.length ? sources : ['No searches recorded yet'])])
    + box(420, 26, 340, 74, ['Records removed before screening', `Duplicates (n = ${c.duplicates})`, `Not saved to project (n = ${c.notSaved})`], 'muted-box')
    + arrow(360, 60, 420, 60) + arrow(180, 26 + 40 + Math.max(1, sources.length) * 17, 180, 200)
    + box(0, 200, 360, 56, ['Records screened', `(n = ${c.screened} of ${c.saved} saved)`])
    + box(420, 200, 340, 56 + Math.max(0, Object.keys(c.excludeReasons || {}).length - 1) * 17, [`Records excluded (n = ${c.excluded})`, ...Object.entries(c.excludeReasons || {}).map(([r, n]) => `${r}: ${n}`)], 'muted-box')
    + arrow(360, 228, 420, 228) + arrow(180, 256, 180, 300)
    + box(0, 300, 360, 56, ['Awaiting decision', `Unscreened (n = ${c.unscreened}) · Maybe (n = ${c.maybe})`])
    + arrow(180, 356, 180, 450)
    + box(0, 450, 360, 56, ['Studies included in review', `(n = ${c.included})`], 'good-box'))}</div>`;
}

// ---------- oncology charts ----------
const RESPONSE_CLASS = { CR: 'f1', PR: 'f2', SD: 'f5', PD: 'f3', NE: 'f4' };

/** Waterfall plot: best % change from baseline per patient, sorted, with RECIST thresholds. */
export function waterfallChart(items, { title = 'Waterfall plot of best percentage change from baseline' } = {}) {
  const P = items.filter(d => Number.isFinite(d.value)).sort((a, b) => b.value - a.value);
  if (!P.length) return '<p class="muted">No tumour-change values.</p>';
  const hi = Math.max(20, ...P.map(d => d.value)) * 1.08, lo = Math.min(-30, ...P.map(d => d.value)) * 1.08, h = 300;
  const f = frame({ xLo: 0, xHi: P.length, yLo: lo, yHi: hi, yLabel: 'Best change from baseline (%)', h, xTicks: [] });
  const bw = Math.max(1, (W - M.l - M.r) / P.length - 1);
  const bars = P.map((d, i) => { const y0 = f.Y(0), y1 = f.Y(d.value); return `<rect class="${RESPONSE_CLASS[d.group] || 'f1'} bar" x="${(f.X(i) + 0.5).toFixed(1)}" y="${Math.min(y0, y1).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0.5, Math.abs(y1 - y0)).toFixed(1)}"><title>${esc(d.label)}: ${d.value.toFixed(1)}%${d.group ? ' · ' + esc(d.group) : ''}</title></rect>`; }).join('');
  const ref = [[20, '+20%'], [-30, '−30%']].map(([v, l]) => `<line class="marker" x1="${M.l}" x2="${W - M.r}" y1="${f.Y(v)}" y2="${f.Y(v)}"/><text class="tick" x="${W - M.r - 4}" y="${f.Y(v) - 4}" text-anchor="end">${l}</text>`).join('');
  const groups = [...new Set(P.map(d => d.group).filter(Boolean))];
  return svg(W, h, title, f.grid + `<line class="axis" x1="${M.l}" x2="${W - M.r}" y1="${f.Y(0)}" y2="${f.Y(0)}"/>` + bars + ref + f.axes) + (groups.length ? `<div class="legend">${groups.map(g => `<span><i class="sw ${RESPONSE_CLASS[g] || 'f1'}"></i>${esc(g)}</span>`).join('')}</div>` : '');
}

/** Swimmer plot: time on treatment per patient, ongoing arrows and response markers. */
export function swimmerChart(items, { xLabel = 'Months on treatment', title = 'Swimmer plot' } = {}) {
  const all = items.filter(d => Number.isFinite(d.duration)), P = all.sort((a, b) => b.duration - a.duration).slice(0, 60);
  if (!P.length) return '<p class="muted">No durations.</p>';
  const rowH = 14, top = 14, h = top + P.length * rowH + 50, left = 92, max = Math.max(...P.map(d => d.duration)) * 1.06;
  const X = v => left + v / max * (W - left - M.r);
  const rows = P.map((d, i) => {
    const y = top + i * rowH, cls = RESPONSE_CLASS[d.group] || 'f1';
    return `<text class="tick" x="${left - 8}" y="${y + rowH * 0.72}" text-anchor="end">${esc(String(d.label).slice(0, 12))}</text><rect class="${cls} bar" x="${left}" y="${y + 2}" width="${Math.max(1, X(d.duration) - left).toFixed(1)}" height="${rowH - 4}"><title>${esc(d.label)}: ${d.duration.toFixed(1)}${d.group ? ' · ' + esc(d.group) : ''}${d.ongoing ? ' · ongoing' : ''}</title></rect>`
      + (d.ongoing ? `<path class="axis" d="M${X(d.duration) + 3} ${y + rowH / 2}h8m-3 -3l3 3l-3 3"/>` : '')
      + (Number.isFinite(d.responseTime) ? `<circle class="mean" cx="${X(d.responseTime)}" cy="${y + rowH / 2}" r="3"><title>Response at ${d.responseTime}</title></circle>` : '');
  }).join('');
  const ticks = niceTicks(0, max, 6).filter(v => v <= max).map(v => `<line class="grid" x1="${X(v)}" x2="${X(v)}" y1="${top}" y2="${h - 38}"/><text class="tick" x="${X(v)}" y="${h - 24}" text-anchor="middle">${tickLabel(v)}</text>`).join('');
  const groups = [...new Set(P.map(d => d.group).filter(Boolean))];
  return `<div class="chart-scroll">${svg(W, h, title, ticks + rows + `<text class="label" x="${(left + W - M.r) / 2}" y="${h - 6}" text-anchor="middle">${esc(xLabel)}</text>`)}</div>`
    + `<div class="legend">${groups.map(g => `<span><i class="sw ${RESPONSE_CLASS[g] || 'f1'}"></i>${esc(g)}</span>`).join('')}<span>→ ongoing</span><span>○ first response</span>${all.length > P.length ? `<span>Showing the ${P.length} longest of ${all.length} patients</span>` : ''}</div>`;
}

/** Spider plot: % change from baseline over time, one line per patient. */
export function spiderChart(series, { xLabel = 'Weeks since baseline', title = 'Spider plot' } = {}) {
  const S = series.filter(s => s.points.length);
  if (!S.length) return '<p class="muted">No longitudinal measurements.</p>';
  return lineChart(S.map(s => ({ points: s.points, c: { CR: 0, PR: 1, SD: 4, PD: 2 }[s.group] ?? 0, label: '' })), { xLabel, yLabel: 'Change from baseline (%)', title, markers: [] })
    + `<div class="legend">${['CR', 'PR', 'SD', 'PD'].filter(g => S.some(s => s.group === g)).map(g => `<span><i class="sw ${RESPONSE_CLASS[g]}"></i>${g}</span>`).join('')}</div>`;
}

/** Scatter coloured by group (e.g. clusters on principal components). points: [[x, y, group], …] */
export function groupScatter(points, { xLabel = '', yLabel = '', title = 'Scatter plot by group', labels = [] } = {}) {
  const P = points.filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (!P.length) return '';
  const xs = P.map(p => p[0]), ys = P.map(p => p[1]), px = (Math.max(...xs) - Math.min(...xs)) * 0.05 || 1, py = (Math.max(...ys) - Math.min(...ys)) * 0.08 || 1;
  const f = frame({ xLo: Math.min(...xs) - px, xHi: Math.max(...xs) + px, yLo: Math.min(...ys) - py, yHi: Math.max(...ys) + py, xLabel, yLabel });
  const groups = [...new Set(P.map(p => p[2]))].sort((a, b) => a - b);
  return svg(f.w, f.h, title, f.grid + P.slice(0, 5000).map(p => `<circle class="f${groups.indexOf(p[2]) % 5 + 1} dot" cx="${f.X(p[0]).toFixed(1)}" cy="${f.Y(p[1]).toFixed(1)}" r="3"/>`).join('') + f.axes)
    + legend(groups.map((g, i) => ({ label: labels[i] ?? `Group ${g}`, c: i })));
}
