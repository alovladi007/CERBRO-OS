// Cerebro OS — meta-analysis engine.
// Inverse-variance pooling with DerSimonian–Laird, Paule–Mandel or REML heterogeneity,
// optional Hartung–Knapp–Sidik–Jonkman adjustment, prediction intervals, Egger's test,
// leave-one-out influence and cumulative meta-analysis.
import { tInv, tCdf, normalCdf, chiSqSf } from './stats.mjs';

const Z = 1.959963984540054;

function validate(studies) {
  if (studies.length < 2 || studies.some(s => !Number.isFinite(s.effect) || !Number.isFinite(s.se) || s.se <= 0))
    throw Error('Enter at least two studies, finite effects, and positive standard errors.');
}

function fixedParts(studies) {
  const w = studies.map(s => 1 / s.se ** 2), sum = w.reduce((a, b) => a + b, 0), fixed = studies.reduce((a, s, i) => a + w[i] * s.effect, 0) / sum;
  const q = studies.reduce((a, s, i) => a + w[i] * (s.effect - fixed) ** 2, 0);
  return { w, sum, fixed, q, df: studies.length - 1 };
}

export function tau2DL(studies) {
  const { w, sum, q, df } = fixedParts(studies), c = sum - w.reduce((a, b) => a + b * b, 0) / sum;
  return Math.max(0, (q - df) / c);
}
export function tau2PM(studies) {
  const k = studies.length, gen = t => { const w = studies.map(s => 1 / (s.se ** 2 + t)), sw = w.reduce((a, b) => a + b, 0), mu = studies.reduce((a, s, i) => a + w[i] * s.effect, 0) / sw; return studies.reduce((a, s, i) => a + w[i] * (s.effect - mu) ** 2, 0) - (k - 1); };
  if (gen(0) <= 0) return 0;
  let lo = 0, hi = 1;
  while (gen(hi) > 0 && hi < 1e8) hi *= 2;
  for (let i = 0; i < 200; i++) { const mid = (lo + hi) / 2; if (gen(mid) > 0) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}
export function tau2REML(studies) {
  let t = tau2DL(studies);
  for (let it = 0; it < 500; it++) {
    const w = studies.map(s => 1 / (s.se ** 2 + t)), sw = w.reduce((a, b) => a + b, 0), mu = studies.reduce((a, s, i) => a + w[i] * s.effect, 0) / sw;
    const num = studies.reduce((a, s, i) => a + w[i] ** 2 * ((s.effect - mu) ** 2 - s.se ** 2), 0) / w.reduce((a, b) => a + b * b, 0) + 1 / sw;
    const next = Math.max(0, num);
    if (Math.abs(next - t) < 1e-12) { t = next; break; }
    t = next;
  }
  return t;
}

/**
 * Backwards compatible with AXON v0.1: metaAnalyze(studies, random:boolean).
 * Options form: metaAnalyze(studies, { model:'fixed'|'random', tau2Method:'DL'|'PM'|'REML', hksj:boolean })
 */
export function metaAnalyze(studies, opts = false) {
  validate(studies);
  const o = typeof opts === 'boolean' ? { model: opts ? 'random' : 'fixed', tau2Method: 'DL', hksj: false } : { model: 'fixed', tau2Method: 'DL', hksj: false, ...opts };
  const random = o.model === 'random', k = studies.length;
  const { sum, q, df } = fixedParts(studies);
  const dl = tau2DL(studies), tau2 = !random ? dl : o.tau2Method === 'REML' ? tau2REML(studies) : o.tau2Method === 'PM' ? tau2PM(studies) : dl;
  const i2 = q > 0 ? Math.max(0, (q - df) / q) * 100 : 0, h2 = df > 0 ? q / df : 1;
  const raw = studies.map(s => 1 / (s.se ** 2 + (random ? tau2 : 0))), ws = raw.reduce((a, b) => a + b, 0);
  const estimate = studies.reduce((a, s, i) => a + s.effect * raw[i], 0) / ws;
  let se = Math.sqrt(1 / ws), crit = Z, ciMethod = 'normal (z)';
  if (random && o.hksj && k > 1) {
    const qstar = studies.reduce((a, s, i) => a + raw[i] * (s.effect - estimate) ** 2, 0) / (k - 1);
    se = Math.sqrt(Math.max(1, qstar) / ws); crit = tInv(0.975, k - 1); ciMethod = `Hartung–Knapp (t, df=${k - 1}, ad hoc q*≥1)`;
  }
  const zval = estimate / se, p = random && o.hksj ? 2 * tCdf(-Math.abs(zval), k - 1) : 2 * normalCdf(-Math.abs(zval));
  const out = { model: random ? `Random effects (${o.tau2Method})` : 'Fixed effect (inverse variance)', k, estimate, se, lower: estimate - crit * se, upper: estimate + crit * se, z: zval, p, ciMethod,
    q, qDf: df, qP: chiSqSf(q, df), i2, h2, tau2, tau: Math.sqrt(tau2), weights: raw.map(x => x / ws), fixedEstimate: sum ? studies.reduce((a, s) => a + s.effect / s.se ** 2, 0) / sum : null };
  if (random && k >= 3) { const t = tInv(0.975, k - 2), pis = Math.sqrt(tau2 + se * se); out.prediction = [estimate - t * pis, estimate + t * pis]; }
  return out;
}

/** Egger's regression test for funnel-plot asymmetry (standard normal deviate on precision). */
export function eggerTest(studies) {
  validate(studies);
  if (studies.length < 3) throw Error("Egger's test needs at least three studies (ten or more recommended).");
  const x = studies.map(s => 1 / s.se), y = studies.map(s => s.effect / s.se), n = x.length;
  const mx = x.reduce((a, b) => a + b, 0) / n, my = y.reduce((a, b) => a + b, 0) / n;
  const sxx = x.reduce((a, v) => a + (v - mx) ** 2, 0), slope = x.reduce((a, v, i) => a + (v - mx) * (y[i] - my), 0) / sxx, intercept = my - slope * mx;
  const sse = y.reduce((a, v, i) => a + (v - intercept - slope * x[i]) ** 2, 0), df = n - 2, s2 = sse / df;
  const seInt = Math.sqrt(s2 * (1 / n + mx * mx / sxx)), t = intercept / seInt;
  return { intercept, se: seInt, t, df, p: df > 0 ? 2 * tCdf(-Math.abs(t), df) : NaN, slope };
}

export function leaveOneOut(studies, opts) {
  if (studies.length < 3) return [];
  return studies.map((s, i) => { const r = metaAnalyze(studies.filter((_, j) => j !== i), opts); return { omitted: s.name ?? `Study ${i + 1}`, estimate: r.estimate, lower: r.lower, upper: r.upper, i2: r.i2, tau2: r.tau2 }; });
}

export function cumulative(studies, opts) {
  const out = [];
  for (let i = 2; i <= studies.length; i++) { const r = metaAnalyze(studies.slice(0, i), opts); out.push({ added: studies[i - 1].name ?? `Study ${i}`, k: i, estimate: r.estimate, lower: r.lower, upper: r.upper }); }
  return out;
}

/** Back-transform a log-scale result for ratio measures. */
export const expResult = r => ({ estimate: Math.exp(r.estimate), lower: Math.exp(r.lower), upper: Math.exp(r.upper), prediction: r.prediction?.map(Math.exp) });
