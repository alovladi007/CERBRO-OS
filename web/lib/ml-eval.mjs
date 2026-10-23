// Cerebro OS — clinical-utility and validation tools for prediction models (Stage 1, docs/ML.md):
// decision-curve analysis (binary and time-to-event, as R dcurves), time-dependent AUC with
// inverse-probability-of-censoring weights (as R timeROC, cumulative/dynamic), and Harrell's
// bootstrap optimism correction. Pure functions on plain data.
import { kaplanMeier } from './stats.mjs';
import { concordance } from './oncology.mjs';
import { rng, fitPreprocessor, transform, extractOutcome, fitModel, predictModel, aucDeLong, calibrationLogistic, brierIPCW, MODELS, DEFAULTS } from './ml.mjs';

const range = (lo, hi, step) => { const out = []; for (let v = lo; v <= hi + 1e-12; v += step) out.push(+v.toFixed(10)); return out; };
const meanOf = a => a.reduce((s, v) => s + v, 0) / a.length;
const kmStep = (km, t) => { let s = 1; for (const st of km.steps) { if (st.t <= t) s = st.s; else break; } return s; };
/** Kaplan–Meier survival at t; also defined for a single row. */
function kmAt(time, status, t) {
  if (time.length >= 2) return kmStep(kaplanMeier(time, status), t);
  return time.length && time[0] <= t && status[0] === 1 ? 0 : 1;
}

/**
 * Decision-curve analysis (Vickers & Elkin 2006). Net benefit = TP/n − FP/n · pt / (1 − pt),
 * where "positive" means predicted risk ≥ pt. Binary outcome: y in {0,1}.
 * Time to event (Vickers et al. 2008): pass { time, status, horizon }; event rates come from Kaplan–Meier.
 */
export function decisionCurve(outcome, risk, { thresholds = range(0.01, 0.99, 0.01) } = {}) {
  const n = risk.length, surv = !Array.isArray(outcome);
  const prevalence = surv ? 1 - kmAt(outcome.time, outcome.status, outcome.horizon) : meanOf(outcome);
  return thresholds.map(pt => {
    const odds = pt / (1 - pt), pos = [];
    for (let i = 0; i < n; i++) if (risk[i] >= pt) pos.push(i);
    let tp, fp;
    if (!pos.length) { tp = 0; fp = 0; }
    else if (surv) {
      const s = kmAt(pos.map(i => outcome.time[i]), pos.map(i => outcome.status[i]), outcome.horizon), frac = pos.length / n;
      tp = (1 - s) * frac; fp = s * frac;
    } else { tp = pos.reduce((a, i) => a + outcome[i], 0) / n; fp = pos.length / n - tp; }
    return { threshold: pt, model: tp - fp * odds, all: prevalence - (1 - prevalence) * odds, none: 0, positiveRate: pos.length / n };
  });
}

/**
 * Cumulative/dynamic time-dependent AUC at time t with IPCW (Uno et al. 2007; R timeROC, weighting = "marginal").
 * Cases: event by t (weight 1/G(T_i−)); controls: still event-free after t (weight 1/G(t)).
 */
export function timeDependentAUC(time, status, marker, t) {
  const cens = kaplanMeier(time, status.map(d => 1 - d));
  const Gminus = s => { let g = 1; for (const st of cens.steps) { if (st.t < s) g = st.s; else break; } return g; };
  const cases = [], controls = [];
  for (let i = 0; i < time.length; i++) {
    if (time[i] <= t && status[i] === 1) cases.push([marker[i], 1 / Gminus(time[i])]);
    else if (time[i] > t) controls.push(marker[i]);
  }
  if (!cases.length || !controls.length) return { t, auc: NaN, cases: cases.length, controls: controls.length };
  const ctrl = controls.slice().sort((a, b) => a - b);
  const below = v => { let lo = 0, hi = ctrl.length; while (lo < hi) { const m = (lo + hi) >> 1; if (ctrl[m] < v) lo = m + 1; else hi = m; } return lo; };
  let num = 0, den = 0;
  for (const [m, w] of cases) { num += w * below(m); den += w; }
  return { t, auc: num / (den * ctrl.length), cases: cases.length, controls: controls.length };
}

/**
 * Harrell's bootstrap optimism correction: refit on B bootstrap samples, compare apparent
 * performance in each sample with performance on the original data, subtract the mean gap.
 * spec matches trainEvaluate (headers, rows, outcome, features, model, params, seed, horizon).
 */
export function optimismBootstrap(spec, { B = 50 } = {}) {
  const t0 = Date.now();
  const { headers, rows, outcome, features, model: type, params = {}, seed = 2026 } = spec;
  if (!MODELS[type]) throw Error(`Unknown model type: ${type}`);
  const oc = extractOutcome(headers, rows, outcome), R = oc.keep.map(k => rows[k]), n = R.length, surv = outcome.type === 'survival';
  const horizon = surv ? (Number.isFinite(spec.horizon) ? spec.horizon : medianEventTime(oc.time, oc.status)) : null;
  const sub = idx => (surv ? { time: idx.map(i => oc.time[i]), status: idx.map(i => oc.status[i]) } : idx.map(i => oc.y[i]));
  const fit = (idx, s) => { const pre = fitPreprocessor(headers, idx.map(i => R[i]), features); return { pre, model: fitModel(type, transform(pre, headers, idx.map(i => R[i])).X, sub(idx), params, s) }; };
  const score = (f, idx) => {
    const pr = predictModel(f.model, transform(f.pre, headers, idx.map(i => R[i])).X, { times: surv ? [horizon] : [] }), y = sub(idx);
    if (surv) { const b = brierIPCW(y.time, y.status, pr.surv[0], horizon); return { c: concordance(y.time, y.status, pr.risk), brier: b.brier }; }
    const yy = y, p = pr.prob, cal = calibrationLogistic(yy, p);
    return { auc: aucDeLong(yy, p).auc, brier: meanOf(p.map((q, i) => (q - yy[i]) ** 2)), slope: cal.slope };
  };
  const all = [...Array(n).keys()], apparent = score(fit(all, seed), all), keys = Object.keys(apparent), r = rng(seed + 77), gaps = keys.map(() => []);
  for (let b = 0; b < B; b++) {
    const idx = Array.from({ length: n }, () => Math.floor(r() * n));
    const y = sub(idx), positives = surv ? y.status.reduce((a, v) => a + v, 0) : y.reduce((a, v) => a + v, 0);
    if (positives < 2 || (!surv && positives > idx.length - 2)) continue;
    try {
      const f = fit(idx, seed + 1000 + b), inBoot = score(f, idx), onOrig = score(f, all);
      keys.forEach((k, j) => { if (Number.isFinite(inBoot[k]) && Number.isFinite(onOrig[k])) gaps[j].push(inBoot[k] - onOrig[k]); });
    } catch { /* a degenerate resample (e.g. a constant column) is skipped */ }
  }
  const out = keys.map((k, j) => { const g = gaps[j], o = meanOf(g); return { metric: k, apparent: apparent[k], optimism: o, corrected: apparent[k] - o, replicates: g.length }; });
  return { model: type, label: MODELS[type].label, params: { ...DEFAULTS[type], ...params }, B, n, horizon, seed, metrics: out, ms: Date.now() - t0 };
}
function medianEventTime(time, status) { const t = time.filter((_, i) => status[i]).sort((a, b) => a - b); return t.length ? +t[Math.floor(0.5 * (t.length - 1))].toPrecision(3) : 1; }
