// Cerebro OS — machine-learning engine (Stage 1, docs/ML.md).
// Elastic-net logistic and Cox regression (coordinate descent, as R glmnet), CART,
// random forests, random survival forests, gradient boosting (logistic and Cox loss),
// cross-validation with leak-free preprocessing, discrimination and calibration metrics,
// PCA and k-means. Pure functions on plain data: safe for the browser, Web Workers and Node.
// Every model is a plain JSON object, so it can be exported, re-applied and audited.
import { kaplanMeier } from './stats.mjs';
import { concordance } from './oncology.mjs';

export const ML_VERSION = 'cerebro-ml-1.0';
const Z975 = 1.959963984540054;

// ---------- random numbers (seeded, reproducible) ----------
/** Mulberry32 PRNG: returns a function giving uniforms in [0, 1). */
export function rng(seed = 1) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const randInt = (r, n) => Math.floor(r() * n);
function shuffle(a, r) { for (let i = a.length - 1; i > 0; i--) { const j = randInt(r, i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const sigmoid = x => (x >= 0 ? 1 / (1 + Math.exp(-x)) : Math.exp(x) / (1 + Math.exp(x)));
const logit = p => Math.log(p / (1 - p));
const meanOf = a => a.reduce((s, v) => s + v, 0) / a.length;
const sdOf = a => { const m = meanOf(a); return a.length > 1 ? Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1)) : 0; };

// ---------- preprocessing (learned on training rows only) ----------
const isMissing = v => v === '' || v == null || (typeof v === 'number' && !Number.isFinite(v)) || /^(na|n\/a|nan|null|none|\.)$/i.test(String(v).trim());

/**
 * features: [{ name, kind: 'numeric' | 'categorical' }]. Numeric: median imputation.
 * Categorical: mode imputation, dummy-coded against the most frequent level (ties: alphabetical).
 */
export function fitPreprocessor(headers, rows, features) {
  const spec = features.map(f => {
    const idx = headers.indexOf(f.name);
    if (idx < 0) throw Error(`Column “${f.name}” not found.`);
    const vals = rows.map(r => r[idx]).filter(v => !isMissing(v));
    if (f.kind === 'numeric') {
      const nums = vals.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
      if (!nums.length) throw Error(`Column “${f.name}” has no numeric values.`);
      const m = nums.length, median = m % 2 ? nums[(m - 1) / 2] : (nums[m / 2 - 1] + nums[m / 2]) / 2;
      return { name: f.name, kind: 'numeric', median };
    }
    const counts = new Map();
    vals.forEach(v => counts.set(String(v), (counts.get(String(v)) || 0) + 1));
    const levels = [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a) || (a < b ? -1 : a > b ? 1 : 0));
    if (!levels.length) throw Error(`Column “${f.name}” has no values.`);
    return { name: f.name, kind: 'categorical', reference: levels[0], levels: levels.slice(1).sort(), mode: levels[0] };
  });
  const columns = spec.flatMap(s => (s.kind === 'numeric' ? [s.name] : s.levels.map(l => `${s.name} = ${l}`)));
  return { spec, columns };
}

/** Encode rows with a fitted preprocessor. Returns { X: number[][], imputed, unseen }. */
export function transform(pre, headers, rows) {
  const idx = pre.spec.map(s => { const i = headers.indexOf(s.name); if (i < 0) throw Error(`Column “${s.name}” is missing from this dataset.`); return i; });
  let imputed = 0, unseen = 0;
  const X = rows.map(r => {
    const out = [];
    pre.spec.forEach((s, k) => {
      const v = r[idx[k]];
      if (s.kind === 'numeric') {
        const x = isMissing(v) ? NaN : Number(v);
        if (!Number.isFinite(x)) { imputed++; out.push(s.median); } else out.push(x);
      } else {
        let lv = isMissing(v) ? (imputed++, s.mode) : String(v);
        if (lv !== s.reference && !s.levels.includes(lv)) { unseen++; lv = s.reference; }
        s.levels.forEach(l => out.push(lv === l ? 1 : 0));
      }
    });
    return out;
  });
  return { X, imputed, unseen };
}

/** Extract the outcome. Binary: { type:'binary', column, positive }. Survival: { type:'survival', time, event }. */
export function extractOutcome(headers, rows, outcome) {
  const keep = [], y = [], time = [], status = [];
  if (outcome.type === 'binary') {
    const i = headers.indexOf(outcome.column);
    if (i < 0) throw Error(`Outcome column “${outcome.column}” not found.`);
    rows.forEach((r, k) => { if (!isMissing(r[i])) { keep.push(k); y.push(String(r[i]) === String(outcome.positive) ? 1 : 0); } });
    const pos = y.reduce((a, b) => a + b, 0);
    if (pos < 5 || y.length - pos < 5) throw Error('The binary outcome needs at least 5 cases in each class.');
    return { keep, y };
  }
  const ti = headers.indexOf(outcome.time), ei = headers.indexOf(outcome.event);
  if (ti < 0 || ei < 0) throw Error('Time or event column not found.');
  rows.forEach((r, k) => {
    const t = Number(r[ti]), d = Number(r[ei]);
    if (!isMissing(r[ti]) && !isMissing(r[ei]) && Number.isFinite(t) && t >= 0 && (d === 0 || d === 1)) { keep.push(k); time.push(t); status.push(d); }
  });
  if (status.reduce((a, b) => a + b, 0) < 5) throw Error('The survival outcome needs at least 5 events (event coded 1).');
  return { keep, time, status };
}

// ---------- elastic net (glmnet-style coordinate descent) ----------
function standardize(X) {
  const n = X.length, p = X[0]?.length || 0, mean = new Array(p).fill(0), sd = new Array(p).fill(0), cols = [];
  for (let j = 0; j < p; j++) {
    let m = 0; for (let i = 0; i < n; i++) m += X[i][j]; m /= n;
    let v = 0; for (let i = 0; i < n; i++) v += (X[i][j] - m) ** 2; v = Math.sqrt(v / n); // glmnet: 1/n
    mean[j] = m; sd[j] = v;
    const c = new Float64Array(n); if (v > 0) for (let i = 0; i < n; i++) c[i] = (X[i][j] - m) / v;
    cols.push(c);
  }
  return { mean, sd, cols };
}

/** Breslow gradient and diagonal Hessian of the Cox log partial likelihood with respect to eta. */
function coxGradHess(order, time, status, eta) {
  // order: indices sorted by time descending (ties: deaths after censored is irrelevant for Breslow sums)
  const n = eta.length, w = eta.map(Math.exp), g = new Float64Array(n), h = new Float64Array(n);
  // risk-set sums S0(t) for each distinct time (risk set: t_j >= t)
  const S0 = new Float64Array(n);
  let acc = 0;
  for (let a = 0; a < n;) {
    let b = a; while (b + 1 < n && time[order[b + 1]] === time[order[a]]) b++;
    for (let k = a; k <= b; k++) acc += w[order[k]];
    for (let k = a; k <= b; k++) S0[order[k]] = acc;
    a = b + 1;
  }
  // A_k = sum over deaths i with t_i <= t_k of 1/S0_i ; B_k = sum of 1/S0_i^2. Ascending pass.
  let A = 0, B = 0, loglik = 0;
  for (let a = n - 1; a >= 0;) {
    let b = a; while (b - 1 >= 0 && time[order[b - 1]] === time[order[a]]) b--;
    for (let k = b; k <= a; k++) { const i = order[k]; if (status[i]) { A += 1 / S0[i]; B += 1 / (S0[i] * S0[i]); loglik += eta[i] - Math.log(S0[i]); } }
    for (let k = b; k <= a; k++) { const i = order[k]; g[i] = status[i] - w[i] * A; h[i] = w[i] * A - w[i] * w[i] * B; }
    a = b - 1;
  }
  return { g, h, loglik };
}
const coxLoglik = (order, time, status, eta) => coxGradHess(order, time, status, eta).loglik;
const descOrder = time => time.map((_, i) => i).sort((a, b) => time[b] - time[a]);

function softThreshold(z, g) { return z > g ? z - g : z < -g ? z + g : 0; }

/**
 * Weighted coordinate descent on standardized columns (in place on beta, b0 and residual r).
 * Minimises (1/2) sum w_i (r_i)^2 / sum(wScale) + lambda * penalty.
 */
function cdWLS(cols, w, r, beta, state, lambda, alpha, intercept, wsum, tol = 1e-13, maxPass = 10000) {
  const p = cols.length, n = w.length, xv = new Float64Array(p);
  for (let j = 0; j < p; j++) { let s = 0; const c = cols[j]; for (let i = 0; i < n; i++) s += w[i] * c[i] * c[i]; xv[j] = s / wsum; }
  const l1 = lambda * alpha, l2 = lambda * (1 - alpha);
  let swAll = 0; for (let i = 0; i < n; i++) swAll += w[i];
  let active = null;
  for (let pass = 0; pass < maxPass; pass++) {
    let maxD = 0;
    const set = active || [...Array(p).keys()];
    for (const j of set) {
      if (!xv[j]) continue;
      const c = cols[j]; let gj = 0;
      for (let i = 0; i < n; i++) gj += w[i] * c[i] * r[i];
      gj /= wsum;
      const old = beta[j], nb = softThreshold(gj + xv[j] * old, l1) / (xv[j] + l2);
      if (nb !== old) { const d = nb - old; for (let i = 0; i < n; i++) r[i] -= d * c[i]; beta[j] = nb; maxD = Math.max(maxD, xv[j] * d * d); }
    }
    if (intercept) { let s = 0; for (let i = 0; i < n; i++) s += w[i] * r[i]; const d = s / swAll; if (d) { state.b0 += d; for (let i = 0; i < n; i++) r[i] -= d; maxD = Math.max(maxD, d * d); } }
    if (maxD < tol) { if (!active) break; active = null; continue; }
    if (!active) active = [...Array(p).keys()].filter(j => beta[j] !== 0);
  }
}

function lambdaPath(lmax, n, p, nlambda, ratio) {
  const r = ratio ?? (n < p ? 0.01 : 1e-4);
  return Array.from({ length: nlambda }, (_, k) => lmax * Math.exp(Math.log(r) * k / (nlambda - 1)));
}

/** Penalty P(beta) on the standardized scale. */
const penalty = (beta, alpha) => beta.reduce((s, b) => s + (1 - alpha) / 2 * b * b + alpha * Math.abs(b), 0);

/**
 * Elastic-net path.
 * family 'binomial': y in {0,1}; objective -(1/n) loglik + lambda * P(beta).
 * family 'cox': {time, status}; objective -(1/n) Breslow partial loglik + lambda * P(beta) (as glmnet).
 * Returns per-lambda coefficients on the original scale.
 */
export function elasticNet(X, outcome, { family = 'binomial', alpha = 1, lambda = null, nlambda = 50, lambdaMinRatio = null, maxIter = 200 } = {}) {
  const n = X.length;
  if (!n) throw Error('No rows to fit.');
  const { mean, sd, cols } = standardize(X), p = cols.length;
  const aEff = Math.max(alpha, 1e-3);
  let lams = lambda ? [].concat(lambda).slice().sort((a, b) => b - a) : null;
  const path = [];
  if (family === 'binomial') {
    const y = outcome;
    const ybar = meanOf(y);
    if (!lams) {
      let lmax = 0; for (let j = 0; j < p; j++) { let s = 0; for (let i = 0; i < n; i++) s += cols[j][i] * (y[i] - ybar); lmax = Math.max(lmax, Math.abs(s) / n); }
      lams = lambdaPath(lmax / aEff, n, p, nlambda, lambdaMinRatio);
    }
    const beta = new Float64Array(p), state = { b0: logit(Math.min(1 - 1e-9, Math.max(1e-9, ybar))) };
    for (const lam of lams) {
      for (let it = 0; it < maxIter; it++) {
        const eta = new Float64Array(n), w = new Float64Array(n), r = new Float64Array(n);
        for (let i = 0; i < n; i++) { let e = state.b0; for (let j = 0; j < p; j++) if (beta[j]) e += cols[j][i] * beta[j]; eta[i] = e; }
        for (let i = 0; i < n; i++) { const pr = sigmoid(eta[i]); w[i] = Math.max(pr * (1 - pr), 1e-5); r[i] = (y[i] - pr) / w[i]; }
        const old = Float64Array.from(beta), oldB0 = state.b0;
        cdWLS(cols, w, r, beta, state, lam, alpha, true, n);
        let maxD = (state.b0 - oldB0) ** 2; for (let j = 0; j < p; j++) maxD = Math.max(maxD, (beta[j] - old[j]) ** 2);
        if (maxD < 1e-22) break;
      }
      path.push(unstd(lam, beta, state.b0, mean, sd));
    }
    return { family, alpha, mean, sd, path };
  }
  // Cox
  const { time, status } = outcome, order = descOrder(time);
  if (!lams) {
    const { g } = coxGradHess(order, time, status, new Array(n).fill(0));
    let lmax = 0; for (let j = 0; j < p; j++) { let s = 0; for (let i = 0; i < n; i++) s += cols[j][i] * g[i]; lmax = Math.max(lmax, Math.abs(s) / n); }
    lams = lambdaPath(lmax / aEff, n, p, nlambda, lambdaMinRatio);
  }
  const beta = new Float64Array(p);
  const etaOf = b => { const e = new Array(n).fill(0); for (let j = 0; j < p; j++) if (b[j]) for (let i = 0; i < n; i++) e[i] += cols[j][i] * b[j]; return e; };
  const objective = (b, lam) => -coxLoglik(order, time, status, etaOf(b)) / n + lam * penalty(b, alpha);
  for (const lam of lams) {
    let obj = objective(beta, lam);
    for (let it = 0; it < maxIter; it++) {
      const eta = etaOf(beta), { g, h } = coxGradHess(order, time, status, eta);
      const w = new Float64Array(n), r = new Float64Array(n);
      for (let i = 0; i < n; i++) { w[i] = h[i] > 1e-12 ? h[i] : 0; r[i] = w[i] ? g[i] / w[i] : 0; }
      const old = Float64Array.from(beta);
      cdWLS(cols, w, r, beta, { b0: 0 }, lam, alpha, false, n);
      // step halving guarantees a monotone decrease of the penalised objective
      let nObj = objective(beta, lam), step = 1;
      while (nObj > obj + 1e-15 && step > 1e-6) { step /= 2; for (let j = 0; j < p; j++) beta[j] = old[j] + step * (beta[j] - old[j]); nObj = objective(beta, lam); }
      let maxD = 0; for (let j = 0; j < p; j++) maxD = Math.max(maxD, (beta[j] - old[j]) ** 2);
      obj = nObj;
      if (maxD < 1e-22) break;
    }
    path.push(unstd(lam, beta, 0, mean, sd));
  }
  return { family, alpha, mean, sd, path };
}
function unstd(lambda, betaStd, b0Std, mean, sd) {
  const beta = Array.from(betaStd, (b, j) => (sd[j] > 0 ? b / sd[j] : 0));
  const b0 = b0Std - beta.reduce((s, b, j) => s + b * mean[j], 0);
  return { lambda, b0, beta, betaStd: Array.from(betaStd), nonzero: beta.filter(b => b !== 0).length };
}

/** Breslow baseline cumulative hazard at the distinct event times. */
function breslowBaseline(time, status, lp) {
  const order = descOrder(time), n = time.length, steps = [];
  let acc = 0; const S0 = new Map();
  for (let a = 0; a < n;) { let b = a; while (b + 1 < n && time[order[b + 1]] === time[order[a]]) b++; for (let k = a; k <= b; k++) acc += Math.exp(lp[order[k]]); S0.set(time[order[a]], acc); a = b + 1; }
  const deaths = new Map(); time.forEach((t, i) => { if (status[i]) deaths.set(t, (deaths.get(t) || 0) + 1); });
  let H = 0;
  for (const t of [...deaths.keys()].sort((a, b) => a - b)) { H += deaths.get(t) / S0.get(t); steps.push([t, H]); }
  return steps;
}
const stepAt = (steps, t) => { let lo = 0, hi = steps.length - 1, v = 0; while (lo <= hi) { const m = (lo + hi) >> 1; if (steps[m][0] <= t) { v = steps[m][1]; lo = m + 1; } else hi = m - 1; } return v; };

// ---------- deviance for lambda selection ----------
function binomDev(y, p) { let s = 0; for (let i = 0; i < y.length; i++) { const q = Math.min(1 - 1e-15, Math.max(1e-15, p[i])); s -= 2 * (y[i] * Math.log(q) + (1 - y[i]) * Math.log(1 - q)); } return s / y.length; }
const linPred = (X, b0, beta) => X.map(x => x.reduce((s, v, j) => s + v * beta[j], b0));

/** cv.glmnet-style lambda selection. Cox uses the grouped partial-likelihood deviance (Verweij & van Houwelingen). */
function cvLambda(X, out, family, alpha, folds, seed, nlambda) {
  const n = X.length, full = elasticNet(X, out, { family, alpha, nlambda }), lams = full.path.map(s => s.lambda);
  const fid = stratifiedFolds(family === 'binomial' ? out : out.status, folds, seed);
  const cvm = lams.map(() => []);
  for (let f = 0; f < folds; f++) {
    const tr = [], te = [];
    for (let i = 0; i < n; i++) (fid[i] === f ? te : tr).push(i);
    if (family === 'binomial') {
      const fit = elasticNet(tr.map(i => X[i]), tr.map(i => out[i]), { family, alpha, lambda: lams });
      fit.path.forEach((s, k) => { const pr = linPred(te.map(i => X[i]), s.b0, s.beta).map(sigmoid); cvm[k].push({ v: binomDev(te.map(i => out[i]), pr), w: te.length }); });
    } else {
      const fit = elasticNet(tr.map(i => X[i]), { time: tr.map(i => out.time[i]), status: tr.map(i => out.status[i]) }, { family, alpha, lambda: lams });
      const ordAll = descOrder(out.time), trT = tr.map(i => out.time[i]), trS = tr.map(i => out.status[i]), ordTr = descOrder(trT);
      const ev = te.reduce((s, i) => s + out.status[i], 0);
      fit.path.forEach((s, k) => {
        const lpAll = linPred(X, 0, s.beta), lpTr = tr.map(i => lpAll[i]);
        const dev = -2 * (coxLoglik(ordAll, out.time, out.status, lpAll) - coxLoglik(ordTr, trT, trS, lpTr));
        cvm[k].push({ v: ev ? dev / ev : 0, w: ev });
      });
    }
  }
  const stats = cvm.map(arr => { const W = arr.reduce((s, a) => s + a.w, 0), m = arr.reduce((s, a) => s + a.v * a.w, 0) / W; const v = arr.reduce((s, a) => s + a.w * (a.v - m) ** 2, 0) / W / (arr.length - 1); return { mean: m, se: Math.sqrt(v) }; });
  let kMin = 0; stats.forEach((s, k) => { if (s.mean < stats[kMin].mean) kMin = k; });
  const thresh = stats[kMin].mean + stats[kMin].se;
  let k1se = kMin; for (let k = 0; k <= kMin; k++) if (stats[k].mean <= thresh) { k1se = k; break; }
  return { lambdas: lams, cvm: stats.map(s => s.mean), cvsd: stats.map(s => s.se), kMin, k1se, full };
}

// ---------- trees ----------
/**
 * CART on index subsets. kind: 'gini' (classification, y in {0,1}) | 'mse' (regression) | 'logrank' (survival).
 * Exhaustive best split over midpoints (gini, mse), or nsplit random cut-points (logrank, as randomForestSRC).
 */
function growTree(X, target, idx, opt, r, depth = 0) {
  const { kind, maxDepth = Infinity, minLeaf = 1, minSplit = 2, mtry = null, nsplit = 0 } = opt;
  const node = leafValue(target, idx, opt);
  const m = idx.length;
  if (depth >= maxDepth || m < minSplit || m < 2 * minLeaf || node.pure) return node.leaf;
  const p = X[0].length;
  let feats = [...Array(p).keys()];
  if (mtry && mtry < p) feats = shuffle(feats, r).slice(0, mtry); else if (opt.shuffleFeatures) feats = shuffle(feats, r);
  let best = null;
  for (const j of feats) {
    const s = kind === 'logrank' ? bestLogrankSplit(X, target, idx, j, opt, r) : bestImpuritySplit(X, target, idx, j, opt);
    if (s && (!best || s.score > best.score + 1e-12 * Math.abs(best.score))) best = { ...s, j };
  }
  if (!best || !(best.score > 0)) return node.leaf;
  const L = [], R = [];
  for (const i of idx) (X[i][best.j] <= best.thr ? L : R).push(i);
  if (L.length < minLeaf || R.length < minLeaf) return node.leaf;
  return { f: best.j, t: best.thr, g: best.score, n: m, l: growTree(X, target, L, opt, r, depth + 1), r: growTree(X, target, R, opt, r, depth + 1) };
}
function leafValue(target, idx, opt) {
  if (opt.kind === 'gini') { let s = 0; for (const i of idx) s += target[i]; const p = s / idx.length; return { leaf: { v: p, n: idx.length }, pure: p === 0 || p === 1 }; }
  if (opt.kind === 'mse') {
    let s = 0, ss = 0; for (const i of idx) { s += target.g[i]; ss += target.g[i] ** 2; }
    const v = opt.leaf ? opt.leaf(idx) : s / idx.length, varr = ss / idx.length - (s / idx.length) ** 2;
    return { leaf: { v, n: idx.length }, pure: varr <= 1e-14 };
  }
  // survival: Nelson–Aalen cumulative hazard on the shared grid
  const { time, status, grid } = target, ev = idx.reduce((s, i) => s + status[i], 0);
  return { leaf: { chf: nelsonAalenOnGrid(idx.map(i => time[i]), idx.map(i => status[i]), grid), n: idx.length }, pure: ev === 0 || idx.length < 2 * (opt.minLeaf || 1) };
}
function bestImpuritySplit(X, target, idx, j, opt) {
  const sorted = idx.slice().sort((a, b) => X[a][j] - X[b][j]), m = sorted.length, minLeaf = opt.minLeaf || 1;
  if (X[sorted[0]][j] === X[sorted[m - 1]][j]) return null;
  const val = opt.kind === 'gini' ? i => target[i] : i => target.g[i];
  let totS = 0, totSS = 0; for (const i of sorted) { const v = val(i); totS += v; totSS += v * v; }
  let lS = 0, best = null;
  const parentImp = opt.kind === 'gini' ? (q => 2 * q * (1 - q))(totS / m) : totSS / m - (totS / m) ** 2;
  for (let k = 0; k < m - 1; k++) {
    lS += val(sorted[k]);
    const nl = k + 1, nr = m - nl;
    if (X[sorted[k + 1]][j] <= X[sorted[k]][j] + 1e-7 * Math.max(1, Math.abs(X[sorted[k]][j])) || nl < minLeaf || nr < minLeaf) continue;
    let score;
    if (opt.kind === 'gini') { const pl = lS / nl, pr = (totS - lS) / nr; score = parentImp - (nl / m) * 2 * pl * (1 - pl) - (nr / m) * 2 * pr * (1 - pr); }
    else { const ml = lS / nl, mr = (totS - lS) / nr; score = nl * nr / m * (ml - mr) ** 2 / m; } // = MSE decrease (Friedman's criterion has the same ranking)
    if (!best || score > best.score) best = { score, thr: X[sorted[k]][j] / 2 + X[sorted[k + 1]][j] / 2 };
  }
  if (best) best.score *= m; // weighted impurity decrease, comparable across nodes
  return best;
}
function bestLogrankSplit(X, target, idx, j, opt, r) {
  const { time, status } = target, minLeaf = opt.minLeaf || 1;
  const vals = [...new Set(idx.map(i => X[i][j]))].sort((a, b) => a - b);
  if (vals.length < 2) return null;
  let cuts = vals.slice(0, -1).map((v, k) => (v + vals[k + 1]) / 2);
  if (opt.nsplit && cuts.length > opt.nsplit) { const pick = new Set(); while (pick.size < opt.nsplit) pick.add(randInt(r, cuts.length)); cuts = [...pick].map(k => cuts[k]); }
  // event times within the node
  const node = idx.map(i => ({ t: time[i], d: status[i], x: X[i][j] })).sort((a, b) => a.t - b.t);
  let best = null;
  for (const c of cuts) {
    let nl = 0; for (const o of node) if (o.x <= c) nl++;
    const nr = node.length - nl;
    if (nl < minLeaf || nr < minLeaf) continue;
    let Y = node.length, Y1 = nl, num = 0, vr = 0;
    for (let a = 0; a < node.length;) {
      let b = a, d = 0, d1 = 0, c1 = 0, cAll = 0;
      while (b < node.length && node[b].t === node[a].t) { cAll++; if (node[b].x <= c) c1++; if (node[b].d) { d++; if (node[b].x <= c) d1++; } b++; }
      if (d && Y > 1) { num += d1 - d * Y1 / Y; vr += d * (Y1 / Y) * (1 - Y1 / Y) * (Y - d) / (Y - 1); }
      Y -= cAll; Y1 -= c1; a = b;
    }
    if (vr <= 0) continue;
    const score = Math.abs(num) / Math.sqrt(vr);
    if (!best || score > best.score) best = { score, thr: c };
  }
  return best;
}
function nelsonAalenOnGrid(t, d, grid) {
  const o = t.map((v, i) => [v, d[i]]).sort((a, b) => a[0] - b[0]), out = new Array(grid.length);
  let H = 0, k = 0, atRisk = o.length;
  for (let g = 0; g < grid.length; g++) {
    while (k < o.length && o[k][0] <= grid[g]) {
      const tt = o[k][0]; let dd = 0, cc = 0;
      while (k < o.length && o[k][0] === tt) { dd += o[k][1]; cc++; k++; }
      if (dd && atRisk > 0) H += dd / atRisk;
      atRisk -= cc;
    }
    out[g] = H;
  }
  return out;
}
function leafOf(tree, x) { let nd = tree; while (nd.f !== undefined) nd = x[nd.f] <= nd.t ? nd.l : nd.r; return nd; }
function treeImportance(tree, acc) { if (tree.f === undefined) return; acc[tree.f] += tree.g; treeImportance(tree.l, acc); treeImportance(tree.r, acc); }

/** Single CART classification tree (as scikit-learn DecisionTreeClassifier, gini). */
export function decisionTree(X, y, { maxDepth = 3, minLeaf = 1, seed = 1 } = {}) {
  const tree = growTree(X, y, X.map((_, i) => i), { kind: 'gini', maxDepth, minLeaf, shuffleFeatures: true }, rng(seed));
  return { type: 'tree', tree };
}

/** Random forest classifier: bootstrap, mtry = floor(sqrt(p)) features per split, out-of-bag predictions. */
export function randomForest(X, y, { nTrees = 300, mtry = null, minLeaf = 1, maxDepth = Infinity, seed = 1 } = {}) {
  const n = X.length, p = X[0].length, r = rng(seed), m = mtry || Math.max(1, Math.floor(Math.sqrt(p)));
  const trees = [], oobSum = new Float64Array(n), oobN = new Int32Array(n);
  for (let b = 0; b < nTrees; b++) {
    const inBag = new Uint8Array(n), idx = [];
    for (let i = 0; i < n; i++) { const k = randInt(r, n); idx.push(k); inBag[k] = 1; }
    const tree = growTree(X, y, idx, { kind: 'gini', maxDepth, minLeaf, mtry: m }, r);
    trees.push(tree);
    for (let i = 0; i < n; i++) if (!inBag[i]) { oobSum[i] += leafOf(tree, X[i]).v; oobN[i]++; }
  }
  return { type: 'rf', mtry: m, trees, oob: Array.from(oobSum, (s, i) => (oobN[i] ? s / oobN[i] : NaN)) };
}

/** Random survival forest (Ishwaran et al. 2008): log-rank splitting, Nelson–Aalen leaves, ensemble cumulative hazard. */
export function randomSurvivalForest(X, time, status, { nTrees = 200, mtry = null, minLeaf = 15, nsplit = 10, maxDepth = Infinity, seed = 1, gridSize = 60 } = {}) {
  const n = X.length, p = X[0].length, r = rng(seed), m = mtry || Math.max(1, Math.ceil(Math.sqrt(p)));
  const ev = [...new Set(time.filter((_, i) => status[i]))].sort((a, b) => a - b);
  const grid = ev.length <= gridSize ? ev : Array.from({ length: gridSize }, (_, k) => ev[Math.round(k * (ev.length - 1) / (gridSize - 1))]);
  const target = { time, status, grid }, trees = [], oob = Array.from({ length: n }, () => null), oobN = new Int32Array(n);
  for (let b = 0; b < nTrees; b++) {
    const inBag = new Uint8Array(n), idx = [];
    for (let i = 0; i < n; i++) { const k = randInt(r, n); idx.push(k); inBag[k] = 1; }
    const tree = growTree(X, target, idx, { kind: 'logrank', maxDepth, minLeaf, minSplit: 2 * minLeaf, mtry: m, nsplit }, r);
    trees.push(roundTree(tree));
    for (let i = 0; i < n; i++) if (!inBag[i]) { const h = leafOf(tree, X[i]).chf; if (!oob[i]) oob[i] = h.slice(); else for (let g = 0; g < h.length; g++) oob[i][g] += h[g]; oobN[i]++; }
  }
  return { type: 'rsf', mtry: m, grid, trees, oob: oob.map((h, i) => (h ? h.map(v => v / oobN[i]) : null)) };
}
const roundTree = t => (t.f === undefined ? (t.chf ? { ...t, chf: t.chf.map(v => +v.toPrecision(6)) } : t) : { ...t, l: roundTree(t.l), r: roundTree(t.r) });

/**
 * Gradient boosting with regression trees (Friedman 2001).
 * loss 'logistic': as scikit-learn GradientBoostingClassifier (log-odds prior, Newton leaf values).
 * loss 'cox': Breslow partial-likelihood gradient, Newton leaf values (as R gbm distribution = "coxph").
 */
export function gradientBoosting(X, outcome, { loss = 'logistic', nTrees = 100, learningRate = 0.1, maxDepth = 3, minLeaf = 1, subsample = 1, seed = 1 } = {}) {
  const n = X.length, r = rng(seed), trees = [];
  let f0 = 0, F;
  if (loss === 'logistic') { const pm = meanOf(outcome); f0 = Math.log(pm / (1 - pm)); }
  F = new Float64Array(n).fill(f0);
  const order = loss === 'cox' ? descOrder(outcome.time) : null;
  for (let b = 0; b < nTrees; b++) {
    let g, h;
    if (loss === 'logistic') { g = new Float64Array(n); h = new Float64Array(n); for (let i = 0; i < n; i++) { const pr = sigmoid(F[i]); g[i] = outcome[i] - pr; h[i] = pr * (1 - pr); } }
    else ({ g, h } = coxGradHess(order, outcome.time, outcome.status, Array.from(F)));
    let idx = [...Array(n).keys()];
    if (subsample < 1) idx = shuffle(idx, r).slice(0, Math.max(2, Math.round(subsample * n))).sort((a, b) => a - b);
    const leaf = ids => { let sg = 0, sh = 0; for (const i of ids) { sg += g[i]; sh += h[i]; } return Math.abs(sh) < 1e-150 ? 0 : sg / sh; };
    const tree = growTree(X, { g }, idx, { kind: 'mse', maxDepth, minLeaf, shuffleFeatures: true, leaf }, r);
    trees.push(tree);
    for (let i = 0; i < n; i++) F[i] += learningRate * leafOf(tree, X[i]).v;
  }
  return { type: 'gbm', loss, f0, learningRate, trees };
}
const gbmRaw = (m, x) => m.trees.reduce((s, t) => s + m.learningRate * leafOf(t, x).v, m.f0);

// ---------- model zoo: fit / predict ----------
export const MODELS = {
  logit_enet: { task: 'binary', label: 'Penalised logistic regression (elastic net)' },
  tree: { task: 'binary', label: 'Decision tree (CART)' },
  rf: { task: 'binary', label: 'Random forest' },
  gbm: { task: 'binary', label: 'Gradient boosting' },
  cox_enet: { task: 'survival', label: 'Penalised Cox regression (elastic net)' },
  rsf: { task: 'survival', label: 'Random survival forest' },
  gbm_cox: { task: 'survival', label: 'Gradient boosting (Cox loss)' },
};
export const DEFAULTS = {
  logit_enet: { alpha: 1, lambdaRule: 'min', innerFolds: 5, nlambda: 50 },
  cox_enet: { alpha: 1, lambdaRule: 'min', innerFolds: 5, nlambda: 50 },
  tree: { maxDepth: 4, minLeaf: 5 },
  rf: { nTrees: 300, minLeaf: 1, mtry: null },
  gbm: { nTrees: 100, learningRate: 0.05, maxDepth: 2, minLeaf: 10, subsample: 0.8 },
  rsf: { nTrees: 200, minLeaf: 15, nsplit: 10, mtry: null },
  gbm_cox: { nTrees: 100, learningRate: 0.05, maxDepth: 2, minLeaf: 10, subsample: 0.8 },
};

/** Fit one model on encoded X. Returns a plain-JSON model. */
export function fitModel(type, X, out, params = {}, seed = 1) {
  const P = { ...DEFAULTS[type], ...params };
  switch (type) {
    case 'logit_enet': case 'cox_enet': {
      const family = type === 'logit_enet' ? 'binomial' : 'cox';
      const cv = cvLambda(X, out, family, P.alpha, Math.min(P.innerFolds, Math.max(2, Math.floor(X.length / 10))), seed + 101, P.nlambda);
      const k = P.lambdaRule === 'min' ? cv.kMin : cv.k1se, s = cv.full.path[k];
      const model = { type, alpha: P.alpha, lambda: s.lambda, lambdaRule: P.lambdaRule, b0: s.b0, beta: s.beta, nonzero: s.nonzero,
        cvPath: cv.lambdas.map((l, i) => ({ lambda: l, cvm: cv.cvm[i], cvsd: cv.cvsd[i], nonzero: cv.full.path[i].nonzero })), lambdaMin: cv.lambdas[cv.kMin], lambda1se: cv.lambdas[cv.k1se] };
      if (family === 'cox') model.baseline = breslowBaseline(out.time, out.status, linPred(X, 0, s.beta));
      return model;
    }
    case 'tree': { const m = decisionTree(X, out, { ...P, seed }); return { type, tree: m.tree }; }
    case 'rf': { const m = randomForest(X, out, { ...P, seed }); return { type, mtry: m.mtry, trees: m.trees }; }
    case 'gbm': return { ...gradientBoosting(X, out, { ...P, loss: 'logistic', seed }), type };
    case 'rsf': { const { oob, ...m } = randomSurvivalForest(X, out.time, out.status, { ...P, seed }); return { ...m, type }; }
    case 'gbm_cox': {
      const m = gradientBoosting(X, out, { ...P, loss: 'cox', seed });
      return { ...m, type, baseline: breslowBaseline(out.time, out.status, X.map(x => gbmRaw(m, x))) };
    }
    default: throw Error(`Unknown model type: ${type}`);
  }
}

/**
 * Predict with a fitted model.
 * Binary → { prob }. Survival → { risk (higher = worse), surv(t) at the requested times }.
 */
export function predictModel(model, X, { times = [] } = {}) {
  switch (model.type) {
    case 'logit_enet': return { prob: linPred(X, model.b0, model.beta).map(sigmoid) };
    case 'tree': return { prob: X.map(x => leafOf(model.tree, x).v) };
    case 'rf': return { prob: X.map(x => model.trees.reduce((s, t) => s + leafOf(t, x).v, 0) / model.trees.length) };
    case 'gbm': return { prob: X.map(x => sigmoid(gbmRaw(model, x))) };
    case 'cox_enet': case 'gbm_cox': {
      const lp = model.type === 'cox_enet' ? linPred(X, 0, model.beta) : X.map(x => gbmRaw(model, x));
      return { risk: lp, surv: times.map(t => { const H = stepAt(model.baseline, t); return lp.map(l => Math.exp(-H * Math.exp(l))); }) };
    }
    case 'rsf': {
      const chf = X.map(x => { const acc = new Array(model.grid.length).fill(0); for (const t of model.trees) { const h = leafOf(t, x).chf; for (let g = 0; g < h.length; g++) acc[g] += h[g]; } return acc.map(v => v / model.trees.length); });
      return rsfOutputs(model.grid, chf, times);
    }
    default: throw Error(`Unknown model type: ${model.type}`);
  }
}
function rsfOutputs(grid, chf, times) {
  const at = (h, t) => { let v = 0; for (let g = 0; g < grid.length && grid[g] <= t; g++) v = h[g]; return v; };
  return { risk: chf.map(h => h.reduce((s, v) => s + v, 0)), surv: times.map(t => chf.map(h => Math.exp(-at(h, t)))) };
}

// ---------- metrics ----------
/** AUC (Mann–Whitney) with DeLong variance and a normal-approximation CI on the AUC scale (as R pROC). */
export function aucDeLong(y, score) {
  const pos = [], neg = [];
  y.forEach((v, i) => (v ? pos : neg).push(score[i]));
  const m = pos.length, n = neg.length;
  if (!m || !n) return { auc: NaN, se: NaN, lower: NaN, upper: NaN };
  // placement values via sorting (O((m+n) log(m+n)))
  const negS = neg.slice().sort((a, b) => a - b), posS = pos.slice().sort((a, b) => a - b);
  const below = (arr, v) => { let lo = 0, hi = arr.length; while (lo < hi) { const md = (lo + hi) >> 1; if (arr[md] < v) lo = md + 1; else hi = md; } return lo; };
  const upto = (arr, v) => { let lo = 0, hi = arr.length; while (lo < hi) { const md = (lo + hi) >> 1; if (arr[md] <= v) lo = md + 1; else hi = md; } return lo; };
  const V10 = pos.map(v => (below(negS, v) + 0.5 * (upto(negS, v) - below(negS, v))) / n);
  const V01 = neg.map(v => ((m - upto(posS, v)) + 0.5 * (upto(posS, v) - below(posS, v))) / m);
  const auc = meanOf(V10), s10 = m > 1 ? V10.reduce((s, v) => s + (v - auc) ** 2, 0) / (m - 1) : 0, s01 = n > 1 ? V01.reduce((s, v) => s + (v - auc) ** 2, 0) / (n - 1) : 0;
  const se = Math.sqrt(s10 / m + s01 / n);
  return { auc, se, lower: Math.max(0, auc - Z975 * se), upper: Math.min(1, auc + Z975 * se), method: 'DeLong' };
}

/** Logistic recalibration: intercept with logit(p) as offset (calibration-in-the-large) and slope from y ~ logit(p). */
export function calibrationLogistic(y, prob) {
  const lp = prob.map(p => logit(Math.min(1 - 1e-12, Math.max(1e-12, p))));
  // intercept-only with offset
  let a = 0;
  for (let it = 0; it < 100; it++) { let g = 0, h = 0; for (let i = 0; i < y.length; i++) { const q = sigmoid(a + lp[i]); g += y[i] - q; h += q * (1 - q); } const d = g / h; a += d; if (Math.abs(d) < 1e-14) break; }
  // two-parameter fit y ~ b0 + b1 * lp (Newton)
  let b0 = 0, b1 = 1;
  for (let it = 0; it < 200; it++) {
    let g0 = 0, g1 = 0, h00 = 0, h01 = 0, h11 = 0;
    for (let i = 0; i < y.length; i++) { const q = sigmoid(b0 + b1 * lp[i]), w = q * (1 - q), e = y[i] - q; g0 += e; g1 += e * lp[i]; h00 += w; h01 += w * lp[i]; h11 += w * lp[i] * lp[i]; }
    const det = h00 * h11 - h01 * h01; if (!det) break;
    const d0 = (h11 * g0 - h01 * g1) / det, d1 = (-h01 * g0 + h00 * g1) / det;
    b0 += d0; b1 += d1; if (Math.abs(d0) + Math.abs(d1) < 1e-13) break;
  }
  return { intercept: a, slope: b1, slopeIntercept: b0 };
}

/** Equal-count bins of predicted risk with observed proportions. */
export function calibrationBins(y, prob, bins = 10) {
  const o = prob.map((p, i) => [p, y[i]]).sort((a, b) => a[0] - b[0]), n = o.length, out = [];
  const k = Math.max(2, Math.min(bins, Math.floor(n / 5)));
  for (let b = 0; b < k; b++) {
    const s = o.slice(Math.floor(b * n / k), Math.floor((b + 1) * n / k));
    if (!s.length) continue;
    const obs = s.reduce((a, v) => a + v[1], 0) / s.length, se = Math.sqrt(Math.max(obs * (1 - obs), 1e-12) / s.length);
    out.push({ n: s.length, predicted: meanOf(s.map(v => v[0])), observed: obs, lower: Math.max(0, obs - Z975 * se), upper: Math.min(1, obs + Z975 * se) });
  }
  return out;
}

export function binaryMetrics(y, prob) {
  const brier = meanOf(prob.map((p, i) => (p - y[i]) ** 2)), prev = meanOf(y), brierNull = prev * (1 - prev);
  return { n: y.length, positives: y.reduce((a, b) => a + b, 0), ...aucDeLong(y, prob), brier, scaledBrier: brierNull ? 1 - brier / brierNull : NaN,
    logLoss: binomDev(y, prob) / 2, calibration: calibrationLogistic(y, prob), meanPredicted: meanOf(prob), observed: prev };
}

/** Kaplan–Meier survival at t (step function). */
function kmAt(time, status, t) { const km = kaplanMeier(time, status); let s = 1; for (const st of km.steps) { if (st.t <= t) s = st.s; else break; } return s; }

/** Graf et al. IPCW Brier score at horizon tau, with the Kaplan–Meier (null) reference. */
export function brierIPCW(time, status, survAtTau, tau) {
  const cens = kaplanMeier(time, status.map(d => 1 - d)), G = t => { let s = 1; for (const st of cens.steps) { if (st.t < t) s = st.s; else break; } return s; };
  const Gtau = (() => { let s = 1; for (const st of cens.steps) { if (st.t <= tau) s = st.s; else break; } return s; })();
  const km = kmAt(time, status, tau);
  let bs = 0, b0 = 0;
  for (let i = 0; i < time.length; i++) {
    if (time[i] <= tau && status[i]) { const w = 1 / G(time[i]); bs += survAtTau[i] ** 2 * w; b0 += km ** 2 * w; }
    else if (time[i] > tau) { const w = 1 / Gtau; bs += (1 - survAtTau[i]) ** 2 * w; b0 += (1 - km) ** 2 * w; }
  }
  bs /= time.length; b0 /= time.length;
  return { tau, brier: bs, brierKM: b0, ipa: b0 ? 1 - bs / b0 : NaN };
}

/** Survival calibration at tau: risk groups by predicted S(tau), mean predicted vs Kaplan–Meier observed. */
export function survivalCalibration(time, status, survAtTau, tau, groups = 5) {
  const o = survAtTau.map((s, i) => [s, i]).sort((a, b) => b[0] - a[0]), n = o.length, out = [], k = Math.max(2, Math.min(groups, Math.floor(n / 20)));
  for (let g = 0; g < k; g++) {
    const ids = o.slice(Math.floor(g * n / k), Math.floor((g + 1) * n / k)).map(v => v[1]);
    if (ids.length < 2) continue;
    const km = kaplanMeier(ids.map(i => time[i]), ids.map(i => status[i]));
    let st = km.steps[0]; for (const s of km.steps) { if (s.t <= tau) st = s; else break; }
    out.push({ n: ids.length, predicted: 1 - meanOf(ids.map(i => survAtTau[i])), observed: 1 - st.s, lower: 1 - st.hi, upper: 1 - st.lo });
  }
  return out;
}

export function survivalMetrics(time, status, risk, survAtTau, tau) {
  const c = concordance(time, status, risk);
  const out = { n: time.length, events: status.reduce((a, b) => a + b, 0), cIndex: c };
  if (survAtTau && Number.isFinite(tau)) {
    Object.assign(out, brierIPCW(time, status, survAtTau, tau));
    out.predictedRisk = 1 - meanOf(survAtTau); out.observedRisk = 1 - kmAt(time, status, tau);
  }
  return out;
}

// ---------- cross-validation ----------
/** Stratified fold labels (0..k-1), deterministic for a seed. */
export function stratifiedFolds(strata, k, seed = 1) {
  const r = rng(seed), out = new Array(strata.length), groups = new Map();
  strata.forEach((s, i) => { if (!groups.has(s)) groups.set(s, []); groups.get(s).push(i); });
  let offset = 0;
  for (const key of [...groups.keys()].sort()) { const ids = shuffle(groups.get(key).slice(), r); ids.forEach((i, j) => { out[i] = (j + offset) % k; }); offset += ids.length; }
  return out;
}

function bootstrapC(time, status, risk, B, seed) {
  const r = rng(seed), n = time.length, vals = [];
  for (let b = 0; b < B; b++) { const idx = Array.from({ length: n }, () => randInt(r, n)); const c = concordance(idx.map(i => time[i]), idx.map(i => status[i]), idx.map(i => risk[i])); if (c != null) vals.push(c); }
  vals.sort((a, b) => a - b);
  return { lower: vals[Math.floor(0.025 * (vals.length - 1))], upper: vals[Math.ceil(0.975 * (vals.length - 1))], B: vals.length };
}

/**
 * Train and evaluate a model with stratified k-fold cross-validation.
 * spec = { headers, rows, outcome, features, model, params, folds, repeats, seed, horizon, subgroup, site, importance }
 * Preprocessing and tuning happen inside each training fold. The final model is refit on all rows.
 */
export function trainEvaluate(spec) {
  const t0 = Date.now();
  const { headers, rows, outcome, features, model: type, params = {}, folds = 5, repeats = 1, seed = 2026, subgroup = null, site = null, importance = true } = spec;
  if (!MODELS[type]) throw Error(`Unknown model type: ${type}`);
  if (MODELS[type].task !== outcome.type) throw Error(`${MODELS[type].label} needs a ${MODELS[type].task} outcome.`);
  if (!features.length) throw Error('Select at least one predictor.');
  const oc = extractOutcome(headers, rows, outcome), R = oc.keep.map(k => rows[k]), n = R.length;
  const survival = outcome.type === 'survival';
  const horizon = survival ? (Number.isFinite(spec.horizon) ? spec.horizon : defaultHorizon(oc.time, oc.status)) : null;
  const strata = survival ? oc.status : oc.y;
  const sub = idx => (survival ? { time: idx.map(i => oc.time[i]), status: idx.map(i => oc.status[i]) } : idx.map(i => oc.y[i]));
  const fitOn = (trIdx, s) => { const pre = fitPreprocessor(headers, trIdx.map(i => R[i]), features), X = transform(pre, headers, trIdx.map(i => R[i])).X; return { pre, model: fitModel(type, X, sub(trIdx), params, s) }; };
  const predictOn = (fit, teIdx, rowsOverride = null) => predictModel(fit.model, transform(fit.pre, headers, rowsOverride || teIdx.map(i => R[i])).X, { times: survival ? [horizon] : [] });

  const k = Math.max(2, Math.min(folds, Math.floor(n / 4))), perFold = [], oof = new Array(n).fill(NaN), oofSurv = new Array(n).fill(NaN), oofRisk = new Array(n).fill(NaN);
  const imp = new Map(features.map(f => [f.name, []]));
  for (let rep = 0; rep < repeats; rep++) {
    const fid = stratifiedFolds(strata, k, seed + rep * 7919);
    for (let f = 0; f < k; f++) {
      const tr = [], te = [];
      for (let i = 0; i < n; i++) (fid[i] === f ? te : tr).push(i);
      const fit = fitOn(tr, seed + rep * 31 + f), pr = predictOn(fit, te), y = sub(te);
      let m;
      if (survival) { m = survivalMetrics(y.time, y.status, pr.risk, pr.surv[0], horizon); if (rep === 0) te.forEach((i, j) => { oofRisk[i] = pr.risk[j]; oofSurv[i] = pr.surv[0][j]; }); }
      else { m = binaryMetrics(y, pr.prob); if (rep === 0) te.forEach((i, j) => { oof[i] = pr.prob[j]; }); }
      perFold.push({ repeat: rep, fold: f, n: te.length, ...(survival ? { cIndex: m.cIndex, brier: m.brier, ipa: m.ipa } : { auc: m.auc, brier: m.brier, slope: m.calibration.slope, intercept: m.calibration.intercept }) });
      if (importance && rep === 0) permutationImportance(fit, te.map(i => R[i]), y, features, headers, survival, horizon, seed + f).forEach(d => imp.get(d.feature).push(d.drop));
    }
  }
  const key = survival ? 'cIndex' : 'auc', foldVals = perFold.map(p => p[key]).filter(Number.isFinite);
  const result = { version: ML_VERSION, model: type, label: MODELS[type].label, task: outcome.type, outcome, params: { ...DEFAULTS[type], ...params }, seed, folds: k, repeats,
    n, dropped: rows.length - n, features: features.map(f => f.name), horizon, perFold,
    summary: { metric: key, mean: meanOf(foldVals), sd: sdOf(foldVals), min: Math.min(...foldVals), max: Math.max(...foldVals) } };
  if (survival) {
    result.events = oc.status.reduce((a, b) => a + b, 0);
    result.pooled = survivalMetrics(oc.time, oc.status, oofRisk, oofSurv, horizon);
    result.pooled.cCI = n <= 3000 ? bootstrapC(oc.time, oc.status, oofRisk, Math.max(50, Math.min(200, Math.floor(4e8 / (n * n)))), seed + 3) : null;
    result.calibration = survivalCalibration(oc.time, oc.status, oofSurv, horizon);
  } else {
    result.positives = oc.y.reduce((a, b) => a + b, 0);
    result.pooled = binaryMetrics(oc.y, oof);
    result.calibration = calibrationBins(oc.y, oof);
    result.roc = rocCurve(oc.y, oof);
  }
  if (importance) result.importance = [...imp.entries()].map(([feature, d]) => ({ feature, drop: meanOf(d), sd: sdOf(d) })).sort((a, b) => b.drop - a.drop);
  if (subgroup) result.subgroups = subgroupMetrics(headers, R, subgroup, survival ? { time: oc.time, status: oc.status, risk: oofRisk, surv: oofSurv, horizon } : { y: oc.y, prob: oof });
  if (site) result.sites = leaveOneSiteOut(headers, R, site, fitOn, predictOn, sub, survival, horizon, seed);
  // final model on all rows
  const final = fitOn([...Array(n).keys()], seed);
  result.finalModel = { version: ML_VERSION, type, task: outcome.type, outcome, features, preprocessor: final.pre, model: final.model, horizon, trainedOn: { n, ...(survival ? { events: result.events } : { positives: result.positives }) } };
  result.coefficients = coefTable(final);
  result.ms = Date.now() - t0;
  return result;
}
function defaultHorizon(time, status) { const t = time.filter((_, i) => status[i]).sort((a, b) => a - b); return t.length ? +t[Math.floor(0.5 * (t.length - 1))].toPrecision(3) : 1; }
function coefTable(fit) {
  const m = fit.model;
  if (m.type === 'logit_enet' || m.type === 'cox_enet') return fit.pre.columns.map((c, j) => ({ name: c, coef: m.beta[j], ratio: Math.exp(m.beta[j]) })).filter(r => r.coef !== 0).sort((a, b) => Math.abs(b.coef) - Math.abs(a.coef));
  return null;
}
export function rocCurve(y, score) {
  const o = score.map((s, i) => [s, y[i]]).sort((a, b) => b[0] - a[0]), P = y.reduce((a, b) => a + b, 0), N = y.length - P, pts = [[0, 0]];
  let tp = 0, fp = 0;
  for (let i = 0; i < o.length;) { const s = o[i][0]; while (i < o.length && o[i][0] === s) { o[i][1] ? tp++ : fp++; i++; } pts.push([fp / N, tp / P]); }
  const step = Math.max(1, Math.floor(pts.length / 200));
  return pts.filter((_, i) => i % step === 0 || i === pts.length - 1);
}
function permutationImportance(fit, rows, y, features, headers, survival, horizon, seed) {
  const r = rng(seed), base = scoreRows(fit, rows, y, headers, survival, horizon);
  return features.map(f => {
    const j = headers.indexOf(f.name), vals = shuffle(rows.map(row => row[j]), r);
    const perm = rows.map((row, i) => { const c = row.slice(); c[j] = vals[i]; return c; });
    return { feature: f.name, drop: base - scoreRows(fit, perm, y, headers, survival, horizon) };
  });
}
function scoreRows(fit, rows, y, headers, survival, horizon) {
  const pr = predictModel(fit.model, transform(fit.pre, headers, rows).X, { times: survival ? [horizon] : [] });
  return survival ? concordance(y.time, y.status, pr.risk) : aucDeLong(y, pr.prob).auc;
}
function subgroupMetrics(headers, rows, column, o) {
  const j = headers.indexOf(column);
  if (j < 0) throw Error(`Subgroup column “${column}” not found.`);
  const levels = [...new Set(rows.map(r => String(r[j] ?? '')))].filter(v => !isMissing(v)).sort().slice(0, 12);
  return levels.map(level => {
    const ids = rows.map((r, i) => (String(r[j]) === level ? i : -1)).filter(i => i >= 0);
    if (o.y) {
      const y = ids.map(i => o.y[i]), p = ids.map(i => o.prob[i]), pos = y.reduce((a, b) => a + b, 0), a = pos && pos < y.length ? aucDeLong(y, p) : { auc: NaN };
      return { level, n: ids.length, positives: pos, auc: a.auc, lower: a.lower, upper: a.upper, observed: pos / ids.length, predicted: meanOf(p), small: Math.min(pos, ids.length - pos) < 30 };
    }
    const t = ids.map(i => o.time[i]), d = ids.map(i => o.status[i]), ev = d.reduce((a, b) => a + b, 0);
    return { level, n: ids.length, events: ev, cIndex: ev ? concordance(t, d, ids.map(i => o.risk[i])) : NaN, observed: ids.length > 1 ? 1 - kmAt(t, d, o.horizon) : NaN, predicted: 1 - meanOf(ids.map(i => o.surv[i])), small: ev < 30 };
  });
}
function leaveOneSiteOut(headers, rows, column, fitOn, predictOn, sub, survival, horizon, seed) {
  const j = headers.indexOf(column);
  if (j < 0) throw Error(`Site column “${column}” not found.`);
  const sites = [...new Set(rows.map(r => String(r[j] ?? '')))].filter(v => !isMissing(v)).sort();
  if (sites.length < 2 || sites.length > 30) return [];
  return sites.map((s, k) => {
    const te = [], tr = [];
    rows.forEach((r, i) => (String(r[j]) === s ? te : tr).push(i));
    const y = sub(te);
    try {
      const fit = fitOn(tr, seed + 500 + k), pr = predictOn(fit, te);
      if (survival) { const m = survivalMetrics(y.time, y.status, pr.risk, pr.surv[0], horizon); return { site: s, n: te.length, events: m.events, cIndex: m.cIndex, brier: m.brier, ipa: m.ipa, predicted: m.predictedRisk, observed: m.observedRisk }; }
      const m = binaryMetrics(y, pr.prob);
      return { site: s, n: te.length, positives: m.positives, auc: m.auc, lower: m.lower, upper: m.upper, slope: m.calibration.slope, intercept: m.calibration.intercept, predicted: m.meanPredicted, observed: m.observed };
    } catch (e) { return { site: s, n: te.length, error: e.message }; }
  });
}

/** Apply a frozen (exported) model to new rows. If the outcome columns are present, report external-validation metrics. */
export function applyModel(frozen, headers, rows) {
  if (!frozen?.model || !frozen.preprocessor) throw Error('This file is not a Cerebro OS model.');
  const survival = frozen.task === 'survival', o = frozen.outcome;
  const hasOutcome = survival ? headers.includes(o.time) && headers.includes(o.event) : headers.includes(o.column);
  let use = rows, oc = null;
  if (hasOutcome) { oc = extractOutcome(headers, rows, o); use = oc.keep.map(k => rows[k]); }
  const tr = transform(frozen.preprocessor, headers, use), pr = predictModel(frozen.model, tr.X, { times: survival ? [frozen.horizon] : [] });
  const out = { n: use.length, imputed: tr.imputed, unseenLevels: tr.unseen, predictions: survival ? pr.risk.map((r, i) => ({ risk: r, survAtHorizon: pr.surv[0][i] })) : pr.prob.map(p => ({ prob: p })) };
  if (!oc) return out;
  if (survival) { out.metrics = survivalMetrics(oc.time, oc.status, pr.risk, pr.surv[0], frozen.horizon); out.calibration = survivalCalibration(oc.time, oc.status, pr.surv[0], frozen.horizon); }
  else { out.metrics = binaryMetrics(oc.y, pr.prob); out.calibration = calibrationBins(oc.y, pr.prob); out.roc = rocCurve(oc.y, pr.prob); }
  return out;
}

// ---------- unsupervised: PCA, k-means, silhouette ----------
/** Symmetric eigen-decomposition (cyclic Jacobi). Returns eigenvalues (descending) and eigenvectors (columns). */
function jacobiEigen(A) {
  const n = A.length, a = A.map(r => r.slice()), V = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0; for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += a[i][j] ** 2;
    if (off < 1e-30) break;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
      if (Math.abs(a[p][q]) < 1e-300) continue;
      const th = (a[q][q] - a[p][p]) / (2 * a[p][q]), t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1)), c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < n; k++) { const akp = a[k][p], akq = a[k][q]; a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq; }
      for (let k = 0; k < n; k++) { const apk = a[p][k], aqk = a[q][k]; a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk; }
      for (let k = 0; k < n; k++) { const vkp = V[k][p], vkq = V[k][q]; V[k][p] = c * vkp - s * vkq; V[k][q] = s * vkp + c * vkq; }
    }
  }
  const order = a.map((r, i) => i).sort((i, j) => a[j][j] - a[i][i]);
  return { values: order.map(i => a[i][i]), vectors: order.map(i => V.map(r => r[i])) };
}

/** PCA on a numeric matrix (centred; optionally scaled to unit variance). Components are sign-normalised (largest |loading| positive). */
export function pca(X, { scale = true, components = 10 } = {}) {
  const n = X.length, p = X[0].length;
  if (p > 400) throw Error('PCA in the browser supports up to 400 columns; reduce the feature set first.');
  const mean = new Array(p).fill(0), sd = new Array(p).fill(1);
  for (let j = 0; j < p; j++) { mean[j] = meanOf(X.map(r => r[j])); if (scale) sd[j] = Math.sqrt(X.reduce((s, r) => s + (r[j] - mean[j]) ** 2, 0) / (n - 1)) || 1; }
  const Z = X.map(r => r.map((v, j) => (v - mean[j]) / sd[j]));
  const C = Array.from({ length: p }, (_, i) => Array.from({ length: p }, (_, j) => { let s = 0; for (let k = 0; k < n; k++) s += Z[k][i] * Z[k][j]; return s / (n - 1); }));
  const { values, vectors } = jacobiEigen(C), total = values.reduce((s, v) => s + Math.max(v, 0), 0), m = Math.min(components, p, n);
  const comps = vectors.slice(0, m).map(v => { let big = 0; v.forEach((x, j) => { if (Math.abs(x) > Math.abs(v[big])) big = j; }); return v[big] < 0 ? v.map(x => -x) : v; });
  return { mean, sd, scale, variance: values.slice(0, m), explained: values.slice(0, m).map(v => v / total), components: comps, scores: Z.map(z => comps.map(c => c.reduce((s, w, j) => s + w * z[j], 0))) };
}

/** k-means (Lloyd) with k-means++ seeding and nInit restarts; or fixed initial centres. */
export function kmeans(X, k, { seed = 1, nInit = 10, maxIter = 300, init = null } = {}) {
  const r = rng(seed), n = X.length;
  const d2 = (a, b) => { let s = 0; for (let j = 0; j < a.length; j++) s += (a[j] - b[j]) ** 2; return s; };
  let best = null;
  for (let rep = 0; rep < (init ? 1 : nInit); rep++) {
    let C;
    if (init) C = init.map(c => c.slice());
    else {
      C = [X[randInt(r, n)].slice()];
      const D = X.map(x => d2(x, C[0]));
      while (C.length < k) {
        const tot = D.reduce((a, b) => a + b, 0); let u = r() * tot, i = 0;
        while (i < n - 1 && (u -= D[i]) > 0) i++;
        C.push(X[i].slice()); X.forEach((x, j) => { D[j] = Math.min(D[j], d2(x, C.at(-1))); });
      }
    }
    let labels = new Array(n).fill(-1), iter = 0;
    for (; iter < maxIter; iter++) {
      let changed = 0;
      X.forEach((x, i) => { let bj = 0, bd = Infinity; C.forEach((c, j) => { const d = d2(x, c); if (d < bd) { bd = d; bj = j; } }); if (labels[i] !== bj) { labels[i] = bj; changed++; } });
      const S = C.map(c => new Array(c.length).fill(0)), N = new Array(k).fill(0);
      X.forEach((x, i) => { N[labels[i]]++; x.forEach((v, j) => { S[labels[i]][j] += v; }); });
      C = C.map((c, j) => (N[j] ? S[j].map(v => v / N[j]) : c));
      if (!changed) break;
    }
    const inertia = X.reduce((s, x, i) => s + d2(x, C[labels[i]]), 0);
    if (!best || inertia < best.inertia) best = { labels, centers: C, inertia, iterations: iter + 1 };
  }
  return best;
}

/** Mean silhouette width (Euclidean). Uses a seeded sample of at most maxN rows. */
export function silhouette(X, labels, { maxN = 2000, seed = 1 } = {}) {
  let idx = X.map((_, i) => i);
  if (idx.length > maxN) idx = shuffle(idx, rng(seed)).slice(0, maxN);
  const ks = [...new Set(idx.map(i => labels[i]))];
  if (ks.length < 2) return NaN;
  let tot = 0;
  for (const i of idx) {
    const sums = new Map(), cnt = new Map();
    for (const j of idx) { if (i === j) continue; const d = Math.sqrt(X[i].reduce((s, v, q) => s + (v - X[j][q]) ** 2, 0)); sums.set(labels[j], (sums.get(labels[j]) || 0) + d); cnt.set(labels[j], (cnt.get(labels[j]) || 0) + 1); }
    if (!cnt.get(labels[i])) continue; // singleton cluster: silhouette 0
    const a = sums.get(labels[i]) / cnt.get(labels[i]);
    let b = Infinity; for (const [l, s] of sums) if (l !== labels[i]) b = Math.min(b, s / cnt.get(l));
    tot += (b - a) / Math.max(a, b);
  }
  return tot / idx.length;
}

/** Subtype discovery: encode, standardise, PCA, k-means for each k with silhouette. */
export function clusterAnalysis({ headers, rows, features, kMin = 2, kMax = 6, seed = 2026, components = 10 }) {
  if (features.length < 2) throw Error('Select at least two features.');
  const pre = fitPreprocessor(headers, rows, features), { X } = transform(pre, headers, rows);
  const P = pca(X, { scale: true, components }), Z = X.map(r => r.map((v, j) => (v - P.mean[j]) / P.sd[j]));
  const runs = [];
  for (let k = kMin; k <= Math.min(kMax, X.length - 1); k++) { const km = kmeans(Z, k, { seed: seed + k }); runs.push({ k, inertia: km.inertia, silhouette: silhouette(Z, km.labels, { seed }), labels: km.labels, centers: km.centers }); }
  const best = runs.reduce((a, b) => (b.silhouette > a.silhouette ? b : a));
  const profile = best.centers.map((c, j) => ({ cluster: j + 1, n: best.labels.filter(l => l === j).length, center: c }));
  return { version: ML_VERSION, n: X.length, columns: pre.columns, pca: { explained: P.explained, components: P.components, scores: P.scores.map(s => s.slice(0, 2)) },
    runs: runs.map(({ k, inertia, silhouette: s }) => ({ k, inertia, silhouette: s })), best: { k: best.k, silhouette: best.silhouette, labels: best.labels, profile } };
}

