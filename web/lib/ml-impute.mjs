// Cerebro OS — iterative (chained-regression) imputation, equivalent to scikit-learn
// IterativeImputer(estimator = Ridge(alpha), initial_strategy = "median", imputation_order =
// "ascending", skip_complete = True, sample_posterior = False). Each column with missing values is
// regressed on all other columns in turn, for up to maxIter rounds, until the largest row change is
// below tol × max |observed value|. Fitted regressions are kept, so new rows (a test fold or an
// external dataset) are imputed by replaying exactly the same sequence: no information leaks
// from the rows being predicted.

/** Ridge regression with an unpenalised intercept (scikit-learn Ridge, fit_intercept = True). */
export function ridge(X, y, alpha = 1) {
  const n = X.length, p = X[0]?.length || 0, xm = new Array(p).fill(0);
  let ym = 0;
  for (let i = 0; i < n; i++) { ym += y[i]; for (let j = 0; j < p; j++) xm[j] += X[i][j]; }
  ym /= n; for (let j = 0; j < p; j++) xm[j] /= n;
  const A = Array.from({ length: p }, () => new Array(p).fill(0)), b = new Array(p).fill(0);
  for (let i = 0; i < n; i++) {
    const yc = y[i] - ym;
    for (let j = 0; j < p; j++) {
      const xj = X[i][j] - xm[j];
      b[j] += xj * yc;
      for (let k = j; k < p; k++) A[j][k] += xj * (X[i][k] - xm[k]);
    }
  }
  for (let j = 0; j < p; j++) { A[j][j] += alpha; for (let k = 0; k < j; k++) A[j][k] = A[k][j]; }
  const coef = cholSolve(A, b), intercept = ym - coef.reduce((s, c, j) => s + c * xm[j], 0);
  return { coef, intercept };
}
function cholSolve(A, b) {
  const n = A.length, L = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) {
    let s = A[i][j]; for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
    L[i][j] = i === j ? Math.sqrt(Math.max(s, 1e-300)) : s / L[j][j];
  }
  const z = new Array(n);
  for (let i = 0; i < n; i++) { let s = b[i]; for (let k = 0; k < i; k++) s -= L[i][k] * z[k]; z[i] = s / L[i][i]; }
  const x = new Array(n);
  for (let i = n - 1; i >= 0; i--) { let s = z[i]; for (let k = i + 1; k < n; k++) s -= L[k][i] * x[k]; x[i] = s / L[i][i]; }
  return x;
}
const median = a => { const s = a.slice().sort((x, y) => x - y), m = s.length; return m % 2 ? s[(m - 1) / 2] : (s[m / 2 - 1] + s[m / 2]) / 2; };

/**
 * Fit on X (rows of numbers; NaN marks a missing value). Returns { imputer, X: completed matrix }.
 * imputer = { initial: medians, sequence: [{ col, coef, intercept }], iterations, alpha }.
 */
export function fitIterativeImputer(X, { alpha = 1, maxIter = 10, tol = 1e-3 } = {}) {
  const n = X.length, p = X[0]?.length || 0, miss = X.map(r => r.map(v => !Number.isFinite(v)));
  const initial = Array.from({ length: p }, (_, j) => { const obs = X.filter((_, i) => !miss[i][j]).map(r => r[j]); return obs.length ? median(obs) : 0; });
  const Xt = X.map((r, i) => r.map((v, j) => (miss[i][j] ? initial[j] : v)));
  const frac = Array.from({ length: p }, (_, j) => miss.reduce((s, r) => s + (r[j] ? 1 : 0), 0) / n);
  const order = frac.map((f, j) => [f, j]).filter(([f]) => f > 0).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(([, j]) => j);
  let maxObs = 0; for (let i = 0; i < n; i++) for (let j = 0; j < p; j++) if (!miss[i][j]) maxObs = Math.max(maxObs, Math.abs(X[i][j]));
  const normTol = tol * maxObs, sequence = [];
  let it = 0, prev = Xt.map(r => r.slice());
  for (it = 1; it <= maxIter && order.length; it++) {
    for (const col of order) {
      const others = [...Array(p).keys()].filter(k => k !== col), tr = [], ytr = [];
      for (let i = 0; i < n; i++) if (!miss[i][col]) { tr.push(others.map(k => Xt[i][k])); ytr.push(Xt[i][col]); }
      const fit = ridge(tr, ytr, alpha);
      sequence.push({ col, coef: fit.coef, intercept: fit.intercept });
      for (let i = 0; i < n; i++) if (miss[i][col]) Xt[i][col] = others.reduce((s, k, q) => s + fit.coef[q] * Xt[i][k], fit.intercept);
    }
    // numpy.linalg.norm(Xt − Xt_previous, ord = inf) on a matrix: the largest absolute row sum
    let inf = 0; for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < p; j++) s += Math.abs(Xt[i][j] - prev[i][j]); inf = Math.max(inf, s); }
    if (inf < normTol) break;
    prev = Xt.map(r => r.slice());
  }
  return { imputer: { method: 'iterative-ridge', alpha, maxIter, tol, initial, sequence, iterations: Math.min(it, maxIter) }, X: Xt };
}

/** Impute new rows by replaying the fitted sequence (as IterativeImputer.transform). */
export function applyIterativeImputer(imp, X) {
  const p = imp.initial.length, miss = X.map(r => r.map(v => !Number.isFinite(v)));
  const Xt = X.map((r, i) => r.map((v, j) => (miss[i][j] ? imp.initial[j] : v)));
  for (const step of imp.sequence) {
    const others = [...Array(p).keys()].filter(k => k !== step.col);
    for (let i = 0; i < Xt.length; i++) if (miss[i][step.col]) Xt[i][step.col] = others.reduce((s, k, q) => s + step.coef[q] * Xt[i][k], step.intercept);
  }
  return Xt;
}
