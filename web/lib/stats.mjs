// Cerebro OS — statistical distributions and hypothesis tests.
// Pure functions, no DOM access, safe to run in a Web Worker or Node.

const EPS = 1e-14;

// ---------- special functions ----------
export function logGamma(x) {
  // Lanczos approximation (g=7, n=9)
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - logGamma(1 - x);
  x -= 1;
  let a = c[0];
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

function betacf(a, b, x) {
  const FPMIN = 1e-300;
  let qab = a + b, qap = a + 1, qam = a - 1, c = 1, d = 1 - qab * x / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; h *= d * c;
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/** Regularized incomplete beta I_x(a,b). */
export function incBeta(x, a, b) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? bt * betacf(a, b, x) / a : 1 - bt * betacf(b, a, 1 - x) / b;
}

/** Regularized incomplete gamma: returns [P(a,x), Q(a,x)] computed without cancellation. */
function gammaPQ(a, x) {
  if (x <= 0) return [0, 1];
  const lead = Math.exp(-x + a * Math.log(x) - logGamma(a));
  if (x < a + 1) {
    let sum = 1 / a, del = sum, ap = a;
    for (let n = 0; n < 1000; n++) { ap++; del *= x / ap; sum += del; if (Math.abs(del) < Math.abs(sum) * EPS) break; }
    const P = sum * lead;
    return [P, 1 - P];
  }
  let b = x + 1 - a, c = 1 / 1e-300, d = 1 / b, h = d;
  for (let i = 1; i < 1000; i++) {
    const an = -i * (i - a);
    b += 2; d = an * d + b; if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d; const del = d * c; h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  const Q = lead * h;
  return [1 - Q, Q];
}
/** Regularized lower incomplete gamma P(a,x). */
export const incGamma = (a, x) => gammaPQ(a, x)[0];
/** Regularized upper incomplete gamma Q(a,x). */
export const incGammaUpper = (a, x) => gammaPQ(a, x)[1];

// ---------- distributions ----------
export function normalCdf(z) { return 0.5 * erfc(-z / Math.SQRT2); }
/** Complementary error function via the incomplete gamma identity erfc(x) = Q(1/2, x²). */
export function erfc(x) {
  if (x === 0) return 1;
  const v = incGammaUpper(0.5, x * x);
  return x > 0 ? v : 2 - v;
}
/** Inverse standard normal CDF (Acklam, refined with one Halley step). */
export function normalInv(p) {
  if (!(p > 0 && p < 1)) throw Error('Probability must be in (0,1).');
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  let x;
  if (p < pl) { const q = Math.sqrt(-2 * Math.log(p)); x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  else if (p <= 1 - pl) { const q = p - 0.5, r = q * q; x = (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1); }
  else { const q = Math.sqrt(-2 * Math.log(1 - p)); x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  const e = normalCdf(x) - p, u = e * Math.sqrt(2 * Math.PI) * Math.exp(x * x / 2);
  return x - u / (1 + x * u / 2);
}
export function tCdf(t, df) {
  if (!Number.isFinite(t)) return t > 0 ? 1 : 0;
  const x = df / (df + t * t), tail = 0.5 * incBeta(x, df / 2, 0.5);
  return t >= 0 ? 1 - tail : tail;
}
export function tInv(p, df) {
  // bisection on a well-behaved monotone CDF
  let lo = -1e3, hi = 1e3;
  for (let i = 0; i < 200; i++) { const mid = (lo + hi) / 2; if (tCdf(mid, df) < p) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}
export function chiSqCdf(x, df) { return x <= 0 ? 0 : incGamma(df / 2, x / 2); }
/** Upper tail of chi-square, accurate for tiny p-values. */
export function chiSqSf(x, df) { return x <= 0 ? 1 : incGammaUpper(df / 2, x / 2); }
export function fCdf(f, d1, d2) { return f <= 0 ? 0 : incBeta(d1 * f / (d1 * f + d2), d1 / 2, d2 / 2); }

/** CDF of the noncentral t distribution (Lenth 1989, AS 243). */
export function nctCdf(t, df, delta) {
  if (delta === 0) return tCdf(t, df);
  const neg = t < 0;
  if (neg) { t = -t; delta = -delta; }
  const x = t * t / (t * t + df);
  let tnc = 0;
  if (x > 0) {
    const lambda = delta * delta, p0 = 0.5 * Math.exp(-0.5 * lambda);
    let p = p0, q = Math.sqrt(2 / Math.PI) * p0 * delta, s = 0.5 - p, a = 0.5, b = 0.5 * df;
    const rxb = Math.pow(1 - x, b), albeta = 0.5 * Math.log(Math.PI) + logGamma(b) - logGamma(0.5 + b);
    let xodd = incBeta(x, a, b), godd = 2 * rxb * Math.exp(a * Math.log(x) - albeta), xeven = 1 - rxb, geven = b * x * rxb;
    tnc = p * xodd + q * xeven;
    for (let en = 1; en <= 1000; en++) {
      a += 1; xodd -= godd; xeven -= geven; godd *= x * (a + b - 1) / a; geven *= x * (a + b - 0.5) / (a + 0.5);
      p *= lambda / (2 * en); q *= lambda / (2 * en + 1); s -= p; tnc += p * xodd + q * xeven;
      if (2 * s * (xodd - godd) < 1e-12 && en > 2) break;
    }
  }
  tnc += normalCdf(-delta);
  const v = Math.min(1, Math.max(0, tnc));
  return neg ? 1 - v : v;
}

// ---------- descriptive helpers ----------
export const finite = values => values.filter(v => v !== '' && v != null && Number.isFinite(Number(v))).map(Number);
export const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
export function variance(a) { const m = mean(a); return a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1); }
export function quantile(sorted, q) {
  // type 7 (R default)
  const h = (sorted.length - 1) * q, lo = Math.floor(h);
  return sorted[lo] + (h - lo) * ((sorted[lo + 1] ?? sorted[lo]) - sorted[lo]);
}
export function rank(values) {
  const idx = values.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]), ranks = new Array(values.length);
  let ties = 0;
  for (let i = 0; i < idx.length;) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const r = (i + j) / 2 + 1, t = j - i + 1;
    if (t > 1) ties += t ** 3 - t;
    for (let k = i; k <= j; k++) ranks[idx[k][1]] = r;
    i = j + 1;
  }
  return { ranks, ties };
}

// ---------- tests ----------
function need(a, n, label) { if (a.length < n) throw Error(`${label} needs at least ${n} numeric values.`); }

/** Welch (default) or Student two-sample t-test with Hedges' g. */
export function tTest2(x, y, { equalVar = false } = {}) {
  need(x, 2, 'Group 1'); need(y, 2, 'Group 2');
  const n1 = x.length, n2 = y.length, m1 = mean(x), m2 = mean(y), v1 = variance(x), v2 = variance(y);
  let se, df;
  if (equalVar) { const sp = ((n1 - 1) * v1 + (n2 - 1) * v2) / (n1 + n2 - 2); se = Math.sqrt(sp * (1 / n1 + 1 / n2)); df = n1 + n2 - 2; }
  else { se = Math.sqrt(v1 / n1 + v2 / n2); df = (v1 / n1 + v2 / n2) ** 2 / ((v1 / n1) ** 2 / (n1 - 1) + (v2 / n2) ** 2 / (n2 - 1)); }
  const t = (m1 - m2) / se, p = 2 * tCdf(-Math.abs(t), df), tc = tInv(0.975, df);
  const es = smd(m1, Math.sqrt(v1), n1, m2, Math.sqrt(v2), n2);
  return { test: equalVar ? 'Student t-test' : 'Welch t-test', n1, n2, mean1: m1, mean2: m2, diff: m1 - m2, se, t, df, p,
    ci: [m1 - m2 - tc * se, m1 - m2 + tc * se], hedgesG: es.g, gCI: [es.g - 1.959964 * es.se, es.g + 1.959964 * es.se] };
}
export function pairedTTest(x, y) {
  if (x.length !== y.length) throw Error('Paired samples must have equal length.');
  const d = x.map((v, i) => v - y[i]);
  need(d, 2, 'Paired differences');
  const n = d.length, m = mean(d), sd = Math.sqrt(variance(d)), se = sd / Math.sqrt(n), t = m / se, df = n - 1, tc = tInv(0.975, df);
  return { test: 'Paired t-test', n, meanDiff: m, sd, se, t, df, p: 2 * tCdf(-Math.abs(t), df), ci: [m - tc * se, m + tc * se], dz: m / sd };
}
/** Mann–Whitney U with tie-corrected normal approximation and continuity correction. */
export function mannWhitney(x, y) {
  need(x, 1, 'Group 1'); need(y, 1, 'Group 2');
  const n1 = x.length, n2 = y.length, N = n1 + n2, { ranks, ties } = rank([...x, ...y]);
  const r1 = ranks.slice(0, n1).reduce((a, b) => a + b, 0), u1 = r1 - n1 * (n1 + 1) / 2, u2 = n1 * n2 - u1, mu = n1 * n2 / 2;
  const sigma = Math.sqrt(n1 * n2 / 12 * ((N + 1) - ties / (N * (N - 1))));
  const z = sigma ? (u1 - mu - Math.sign(u1 - mu) * 0.5) / sigma : 0;
  return { test: 'Mann–Whitney U', n1, n2, U: Math.min(u1, u2), u1, z, p: Math.min(1, 2 * normalCdf(-Math.abs(z))), rankBiserial: (u1 - u2) / (n1 * n2) };
}
/** One-way ANOVA across k groups. */
export function anova(groups) {
  const gs = groups.filter(g => g.length);
  if (gs.length < 2) throw Error('ANOVA needs at least two non-empty groups.');
  const all = gs.flat(), N = all.length, k = gs.length, gm = mean(all);
  const ssb = gs.reduce((s, g) => s + g.length * (mean(g) - gm) ** 2, 0), ssw = gs.reduce((s, g) => s + g.reduce((a, v) => a + (v - mean(g)) ** 2, 0), 0);
  const df1 = k - 1, df2 = N - k;
  if (df2 < 1) throw Error('ANOVA needs more observations than groups.');
  const F = (ssb / df1) / (ssw / df2);
  return { test: 'One-way ANOVA', k, N, F, df1, df2, p: 1 - fCdf(F, df1, df2), etaSq: ssb / (ssb + ssw) };
}
/** Kruskal–Wallis H with tie correction. */
export function kruskalWallis(groups) {
  const gs = groups.filter(g => g.length);
  if (gs.length < 2) throw Error('Kruskal–Wallis needs at least two non-empty groups.');
  const all = gs.flat(), N = all.length, { ranks, ties } = rank(all);
  let off = 0, h = 0;
  for (const g of gs) { const r = ranks.slice(off, off + g.length).reduce((a, b) => a + b, 0); h += r * r / g.length; off += g.length; }
  h = 12 / (N * (N + 1)) * h - 3 * (N + 1);
  h /= 1 - ties / (N ** 3 - N) || 1;
  return { test: 'Kruskal–Wallis H', H: h, df: gs.length - 1, p: chiSqSf(h, gs.length - 1) };
}
/** Pearson chi-square test of independence from a contingency table. */
export function chiSquare(table) {
  const r = table.length, c = table[0].length, rows = table.map(x => x.reduce((a, b) => a + b, 0)), cols = table[0].map((_, j) => table.reduce((a, x) => a + x[j], 0)), N = rows.reduce((a, b) => a + b, 0);
  if (r < 2 || c < 2 || !N) throw Error('Chi-square needs at least a 2×2 table with counts.');
  let x2 = 0, minExp = Infinity;
  for (let i = 0; i < r; i++) for (let j = 0; j < c; j++) { const e = rows[i] * cols[j] / N; minExp = Math.min(minExp, e); x2 += (table[i][j] - e) ** 2 / e; }
  const df = (r - 1) * (c - 1);
  return { test: 'Pearson χ²', chi2: x2, df, p: chiSqSf(x2, df), cramersV: Math.sqrt(x2 / (N * Math.min(r - 1, c - 1))), minExpected: minExp, N };
}
export function pearson(x, y) {
  const pairs = x.map((v, i) => [v, y[i]]).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
  if (pairs.length < 3) throw Error('Correlation needs at least three complete pairs.');
  const n = pairs.length, mx = mean(pairs.map(p => p[0])), my = mean(pairs.map(p => p[1]));
  let sxy = 0, sxx = 0, syy = 0;
  for (const [a, b] of pairs) { sxy += (a - mx) * (b - my); sxx += (a - mx) ** 2; syy += (b - my) ** 2; }
  const r = sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0, df = n - 2, t = r * Math.sqrt(df / Math.max(1e-300, 1 - r * r));
  const z = Math.atanh(Math.min(0.999999999, Math.max(-0.999999999, r))), se = 1 / Math.sqrt(n - 3);
  return { method: 'Pearson', r, n, t, df, p: Math.abs(r) >= 1 ? 0 : 2 * tCdf(-Math.abs(t), df), ci: n > 3 ? [Math.tanh(z - 1.959964 * se), Math.tanh(z + 1.959964 * se)] : null };
}
export function spearman(x, y) {
  const pairs = x.map((v, i) => [v, y[i]]).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
  const rx = rank(pairs.map(p => p[0])).ranks, ry = rank(pairs.map(p => p[1])).ranks;
  return { ...pearson(rx, ry), method: 'Spearman' };
}

// ---------- linear algebra & regression ----------
function solve(A, b) {
  const n = A.length, M = A.map((r, i) => [...r, b[i]]);
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let k = i + 1; k < n; k++) if (Math.abs(M[k][i]) > Math.abs(M[p][i])) p = k;
    if (Math.abs(M[p][i]) < 1e-12) throw Error('Predictors are collinear; remove redundant columns.');
    [M[i], M[p]] = [M[p], M[i]];
    for (let k = i + 1; k < n; k++) { const f = M[k][i] / M[i][i]; for (let j = i; j <= n; j++) M[k][j] -= f * M[i][j]; }
  }
  const x = new Array(n);
  for (let i = n - 1; i >= 0; i--) { let s = M[i][n]; for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j]; x[i] = s / M[i][i]; }
  return x;
}
export function invert(A) { const n = A.length; return A.map((_, j) => solve(A, A.map((_, i) => (i === j ? 1 : 0)))).reduce((inv, col, j) => { col.forEach((v, i) => { inv[i][j] = v; }); return inv; }, A.map(() => new Array(n))); }

/** Ordinary least squares with intercept. X is an array of rows (predictors), y outcome. */
export function ols(X, y, names = []) {
  const rows = X.map((r, i) => [r, y[i]]).filter(([r, v]) => r.every(Number.isFinite) && Number.isFinite(v));
  const n = rows.length, p = (X[0]?.length || 0) + 1;
  if (n <= p + 1) throw Error(`Regression needs more than ${p + 1} complete rows.`);
  const D = rows.map(([r]) => [1, ...r]), Y = rows.map(([, v]) => v);
  const XtX = Array.from({ length: p }, (_, i) => Array.from({ length: p }, (_, j) => D.reduce((s, r) => s + r[i] * r[j], 0)));
  const XtY = Array.from({ length: p }, (_, i) => D.reduce((s, r, k) => s + r[i] * Y[k], 0));
  const beta = solve(XtX, XtY), fitted = D.map(r => r.reduce((s, v, i) => s + v * beta[i], 0)), resid = Y.map((v, i) => v - fitted[i]);
  const sse = resid.reduce((s, v) => s + v * v, 0), my = mean(Y), sst = Y.reduce((s, v) => s + (v - my) ** 2, 0), df = n - p, s2 = sse / df;
  const inv = invert(XtX), tc = tInv(0.975, df);
  const coef = beta.map((b, i) => { const se = Math.sqrt(s2 * inv[i][i]), t = b / se; return { name: i ? names[i - 1] || `x${i}` : '(Intercept)', estimate: b, se, t, p: 2 * tCdf(-Math.abs(t), df), ci: [b - tc * se, b + tc * se] }; });
  const r2 = 1 - sse / sst, F = ((sst - sse) / (p - 1)) / s2;
  return { n, df, coef, r2, adjR2: 1 - (1 - r2) * (n - 1) / df, sigma: Math.sqrt(s2), F, fP: p > 1 ? 1 - fCdf(F, p - 1, df) : null, fitted, resid };
}

/** Kaplan–Meier estimator. times, events (1=event, 0=censored). */
export function kaplanMeier(times, events) {
  const d = times.map((t, i) => [Number(t), Number(events[i])]).filter(([t, e]) => Number.isFinite(t) && t >= 0 && (e === 0 || e === 1)).sort((a, b) => a[0] - b[0]);
  if (d.length < 2) throw Error('Kaplan–Meier needs at least two valid (time, event) rows.');
  let atRisk = d.length, s = 1, varSum = 0;
  const steps = [{ t: 0, s: 1, atRisk, lo: 1, hi: 1 }];
  for (let i = 0; i < d.length;) {
    const t = d[i][0]; let ev = 0, cens = 0;
    while (i < d.length && d[i][0] === t) { d[i][1] ? ev++ : cens++; i++; }
    if (ev) {
      s *= 1 - ev / atRisk;
      if (atRisk > ev) varSum += ev / (atRisk * (atRisk - ev));
      const se = s * Math.sqrt(varSum);
      // log-log CI
      const ll = s > 0 && s < 1 ? 1.959964 * Math.sqrt(varSum) / Math.abs(Math.log(s)) : 0;
      steps.push({ t, s, atRisk, events: ev, censored: cens, se, lo: s > 0 && s < 1 ? s ** Math.exp(ll) : s, hi: s > 0 && s < 1 ? s ** Math.exp(-ll) : s });
    }
    atRisk -= ev + cens;
  }
  const medianStep = steps.find(x => x.s <= 0.5);
  return { n: d.length, events: d.filter(x => x[1]).length, steps, median: medianStep ? medianStep.t : null };
}
/** Log-rank test comparing survival between groups. */
export function logRank(times, events, groups) {
  const labels = [...new Set(groups)];
  if (labels.length < 2) throw Error('Log-rank needs at least two groups.');
  const rows = times.map((t, i) => ({ t: Number(t), e: Number(events[i]), g: labels.indexOf(groups[i]) })).filter(r => Number.isFinite(r.t) && (r.e === 0 || r.e === 1));
  const uniq = [...new Set(rows.filter(r => r.e).map(r => r.t))].sort((a, b) => a - b), k = labels.length;
  const O = new Array(k).fill(0), E = new Array(k).fill(0), V = Array.from({ length: k }, () => new Array(k).fill(0));
  for (const t of uniq) {
    const nj = labels.map((_, g) => rows.filter(r => r.g === g && r.t >= t).length), dj = labels.map((_, g) => rows.filter(r => r.g === g && r.t === t && r.e).length);
    const N = nj.reduce((a, b) => a + b, 0), D = dj.reduce((a, b) => a + b, 0);
    if (N < 1) continue;
    for (let g = 0; g < k; g++) {
      O[g] += dj[g]; E[g] += D * nj[g] / N;
      if (N > 1) for (let h = 0; h < k; h++) V[g][h] += D * (N - D) / (N - 1) * (nj[g] / N) * ((g === h ? 1 : 0) - nj[h] / N);
    }
  }
  const m = k - 1, diff = O.slice(0, m).map((o, i) => o - E[i]), Vm = V.slice(0, m).map(r => r.slice(0, m));
  const chi2 = diff.reduce((s, d, i) => s + d * solve(Vm, diff)[i], 0);
  return { test: 'Log-rank', labels, observed: O, expected: E, chi2, df: m, p: chiSqSf(chi2, m) };
}

// ---------- effect sizes & multiplicity ----------
/** Standardized mean difference (Hedges' g) with its large-sample SE. */
export function smd(m1, sd1, n1, m2, sd2, n2) {
  const sp = Math.sqrt(((n1 - 1) * sd1 ** 2 + (n2 - 1) * sd2 ** 2) / (n1 + n2 - 2)), d = (m1 - m2) / sp, J = 1 - 3 / (4 * (n1 + n2) - 9), g = J * d;
  return { d, g, se: Math.sqrt((n1 + n2) / (n1 * n2) + g * g / (2 * (n1 + n2))) };
}
/** Log odds ratio / log risk ratio from a 2×2 table (a,b = events/non-events treated; c,d control). */
export function twoByTwo(a, b, c, d, measure = 'OR') {
  if ([a, b, c, d].some(v => !(v >= 0))) throw Error('2×2 counts must be non-negative.');
  if ([a, b, c, d].some(v => v === 0)) { a += 0.5; b += 0.5; c += 0.5; d += 0.5; }
  if (measure === 'RR') return { effect: Math.log((a / (a + b)) / (c / (c + d))), se: Math.sqrt(1 / a - 1 / (a + b) + 1 / c - 1 / (c + d)), scale: 'log RR' };
  if (measure === 'RD') { const p1 = a / (a + b), p2 = c / (c + d); return { effect: p1 - p2, se: Math.sqrt(p1 * (1 - p1) / (a + b) + p2 * (1 - p2) / (c + d)), scale: 'RD' }; }
  return { effect: Math.log(a * d / (b * c)), se: Math.sqrt(1 / a + 1 / b + 1 / c + 1 / d), scale: 'log OR' };
}
export function adjustP(ps, method = 'BH') {
  const n = ps.length, order = ps.map((p, i) => [p, i]).sort((a, b) => a[0] - b[0]), out = new Array(n);
  if (method === 'holm') { let run = 0; order.forEach(([p, i], k) => { run = Math.max(run, Math.min(1, (n - k) * p)); out[i] = run; }); return out; }
  if (method === 'bonferroni') return ps.map(p => Math.min(1, p * n));
  let run = 1;
  for (let k = n - 1; k >= 0; k--) { const [p, i] = order[k]; run = Math.min(run, p * n / (k + 1)); out[i] = Math.min(1, run); }
  return out;
}
