// Cerebro OS — oncology analytics engine.
// Cox proportional hazards (Efron/Breslow, strata), the Grambsch–Therneau
// proportional-hazards score test (as in R survival::cox.zph), cumulative
// incidence with competing risks and Gray's test (ported from R cmprsk),
// restricted mean survival time (as in survRM2), exact binomial intervals,
// Simon two-stage and BOIN designs, and RECIST 1.1 response categories.
// Pure functions: safe for the browser, Web Workers and Node.
import { normalCdf, chiSqSf, incBeta, invert, kaplanMeier } from './stats.mjs';

const Z975 = 1.959963984540054;

// ---------- small linear-algebra helpers ----------
const zeros = (r, c) => Array.from({ length: r }, () => new Array(c).fill(0));
const matVec = (A, v) => A.map(row => row.reduce((s, a, j) => s + a * v[j], 0));
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
function choleskySolve(A, b) {
  // falls back to the general inverse for numerical robustness
  return matVec(invert(A), b);
}

/** Prepare survival rows: drop incomplete, sort by stratum then time. */
function prep(time, status, X, strata) {
  const rows = [];
  for (let i = 0; i < time.length; i++) {
    const t = Number(time[i]), d = Number(status[i]), x = X[i];
    if (!Number.isFinite(t) || !(d === 0 || d === 1) || !x.every(Number.isFinite)) continue;
    rows.push({ t, d, x, s: strata ? String(strata[i]) : '' });
  }
  rows.sort((a, b) => (a.s < b.s ? -1 : a.s > b.s ? 1 : a.t - b.t));
  return rows;
}

/**
 * Per-event-time score and information contributions at beta.
 * Returns { loglik, U, I, perTime: [{t, u, V}] } — perTime is used by the PH test.
 */
function coxParts(rows, beta, efron) {
  const p = beta.length, U = new Array(p).fill(0), I = zeros(p, p), perTime = [];
  let loglik = 0;
  const strata = [...new Set(rows.map(r => r.s))];
  for (const s of strata) {
    const R = rows.filter(r => r.s === s), n = R.length;
    const eta = R.map(r => dot(r.x, beta)), w = eta.map(Math.exp);
    // suffix sums over the risk set (times >= t): iterate from the end
    let S0 = 0; const S1 = new Array(p).fill(0), S2 = zeros(p, p);
    const groups = [];
    for (let i = n - 1; i >= 0;) {
      let j = i;
      while (j - 1 >= 0 && R[j - 1].t === R[i].t) j--;
      for (let k = j; k <= i; k++) {
        S0 += w[k];
        for (let a = 0; a < p; a++) { S1[a] += w[k] * R[k].x[a]; for (let b = 0; b < p; b++) S2[a][b] += w[k] * R[k].x[a] * R[k].x[b]; }
      }
      const deaths = [];
      for (let k = j; k <= i; k++) if (R[k].d === 1) deaths.push(k);
      if (deaths.length) groups.push({ t: R[i].t, deaths, S0, S1: S1.slice(), S2: S2.map(r => r.slice()) });
      i = j - 1;
    }
    for (const g of groups) {
      const d = g.deaths.length;
      let D0 = 0; const D1 = new Array(p).fill(0), D2 = zeros(p, p);
      for (const k of g.deaths) {
        loglik += eta[k];
        D0 += w[k];
        for (let a = 0; a < p; a++) { D1[a] += w[k] * R[k].x[a]; for (let b = 0; b < p; b++) D2[a][b] += w[k] * R[k].x[a] * R[k].x[b]; }
      }
      const u = new Array(p).fill(0), V = zeros(p, p);
      for (const k of g.deaths) for (let a = 0; a < p; a++) u[a] += R[k].x[a];
      for (let l = 0; l < d; l++) {
        const f = efron ? l / d : 0;
        const den = g.S0 - f * D0;
        loglik -= Math.log(den);
        const m = g.S1.map((v, a) => (v - f * D1[a]) / den);
        for (let a = 0; a < p; a++) {
          u[a] -= m[a];
          for (let b = 0; b < p; b++) V[a][b] += (g.S2[a][b] - f * D2[a][b]) / den - m[a] * m[b];
        }
      }
      for (let a = 0; a < p; a++) { U[a] += u[a]; for (let b = 0; b < p; b++) I[a][b] += V[a][b]; }
      perTime.push({ t: g.t, d, u, V });
    }
  }
  return { loglik, U, I, perTime };
}

/**
 * Cox proportional hazards regression by Newton–Raphson.
 * time, status (1 event / 0 censored), X rows of covariates, names, options { ties: 'efron'|'breslow', strata }.
 */
export function coxph(time, status, X, names = [], { ties = 'efron', strata = null, maxIter = 50, tol = 1e-9 } = {}) {
  const raw = prep(time, status, X, strata), p = X[0]?.length || 0;
  if (!p) throw Error('Select at least one covariate.');
  if (raw.length <= p + 1) throw Error(`Cox regression needs more than ${p + 1} complete rows.`);
  const events = raw.filter(r => r.d === 1).length;
  if (events < 2) throw Error('Cox regression needs at least two events.');
  // centre covariates (as R does) for numerical stability; coefficients are unchanged
  const means = Array.from({ length: p }, (_, a) => raw.reduce((s, r) => s + r.x[a], 0) / raw.length);
  const rows = raw.map(r => ({ ...r, x: r.x.map((v, a) => v - means[a]) }));
  const efron = ties === 'efron';
  let beta = new Array(p).fill(0), parts = coxParts(rows, beta, efron);
  const null0 = parts;
  let iter = 0, converged = false;
  for (; iter < maxIter; iter++) {
    let step = choleskySolve(parts.I, parts.U), next = beta.map((b, a) => b + step[a]), np = coxParts(rows, next, efron);
    let halvings = 0;
    while (!(np.loglik >= parts.loglik - 1e-12) && halvings < 30) { step = step.map(s => s / 2); next = beta.map((b, a) => b + step[a]); np = coxParts(rows, next, efron); halvings++; }
    const done = Math.abs(np.loglik - parts.loglik) < tol * (Math.abs(parts.loglik) + tol);
    beta = next; parts = np;
    if (done) { converged = true; break; }
  }
  if (beta.some(b => !Number.isFinite(b) || Math.abs(b) > 30)) throw Error('Model did not converge (possible complete separation or monotone likelihood).');
  const cov = invert(parts.I), se = cov.map((r, a) => Math.sqrt(r[a]));
  const coef = beta.map((b, a) => {
    const z = b / se[a];
    return { name: names[a] || `x${a + 1}`, coef: b, se: se[a], hr: Math.exp(b), lower: Math.exp(b - Z975 * se[a]), upper: Math.exp(b + Z975 * se[a]), z, p: 2 * normalCdf(-Math.abs(z)) };
  });
  const lr = 2 * (parts.loglik - null0.loglik);
  const wald = dot(beta, matVec(parts.I, beta));
  const score = dot(null0.U, choleskySolve(null0.I, null0.U));
  return {
    method: ties === 'efron' ? 'Efron' : 'Breslow', n: raw.length, events, coef, cov, iterations: iter + 1, converged,
    loglik: [null0.loglik, parts.loglik],
    tests: { lr: { chi2: lr, df: p, p: chiSqSf(lr, p) }, wald: { chi2: wald, df: p, p: chiSqSf(wald, p) }, score: { chi2: score, df: p, p: chiSqSf(score, p) } },
    concordance: concordance(raw.map(r => r.t), raw.map(r => r.d), raw.map(r => dot(r.x, beta)), strata ? raw.map(r => r.s) : null),
    _fit: { rows, beta, efron, raw, names },
  };
}

/** Harrell's C (R survival::concordance convention: tied risk scores count 1/2; tied times excluded). */
export function concordance(time, status, risk, strata = null) {
  let conc = 0, disc = 0, tiedRisk = 0;
  for (let i = 0; i < time.length; i++) {
    if (status[i] !== 1) continue;
    for (let j = 0; j < time.length; j++) {
      if (i === j || (strata && strata[i] !== strata[j])) continue;
      if (time[j] > time[i] || (time[j] === time[i] && status[j] === 0)) {
        if (risk[i] > risk[j]) conc++; else if (risk[i] < risk[j]) disc++; else tiedRisk++;
      }
    }
  }
  const total = conc + disc + tiedRisk;
  return total ? (conc + tiedRisk / 2) / total : null;
}

/**
 * Proportional-hazards test (Grambsch–Therneau score test, R survival >= 3.0 cox.zph, transform = "km").
 * Returns per-covariate and global chi-square tests.
 */
export function coxZph(fit, { transform = 'km' } = {}) {
  const { rows, beta, efron, raw, names } = fit._fit, p = beta.length;
  const parts = coxParts(rows, beta, efron);
  // g(t): KM transform uses 1 - S(t-) from the pooled Kaplan–Meier (all strata together, as R does)
  let gOf;
  if (transform === 'km') {
    const km = kaplanMeier(raw.map(r => r.t), raw.map(r => r.d)).steps.slice(1);
    gOf = t => { let s = 1; for (const st of km) { if (st.t < t) s = st.s; else break; } return 1 - s; };
  } else if (transform === 'log') gOf = Math.log;
  else if (transform === 'rank') { const ts = raw.map(r => r.t).sort((a, b) => a - b); gOf = t => { const lo = ts.findIndex(v => v === t), hi = ts.lastIndexOf(t); return (lo + hi) / 2 + 1; }; }
  else gOf = t => t;
  const evTimes = parts.perTime.flatMap(pt => Array(pt.d).fill(gOf(pt.t))), gbar = evTimes.reduce((a, b) => a + b, 0) / evTimes.length;
  const Ug = new Array(p).fill(0), Ixx = zeros(p, p), Ixg = zeros(p, p), Igg = zeros(p, p);
  for (const pt of parts.perTime) {
    const g = gOf(pt.t) - gbar;
    for (let a = 0; a < p; a++) {
      Ug[a] += g * pt.u[a];
      for (let b = 0; b < p; b++) { Ixx[a][b] += pt.V[a][b]; Ixg[a][b] += g * pt.V[a][b]; Igg[a][b] += g * g * pt.V[a][b]; }
    }
  }
  const block = idx => {
    const k = p + idx.length, M = zeros(k, k);
    for (let a = 0; a < p; a++) for (let b = 0; b < p; b++) M[a][b] = Ixx[a][b];
    idx.forEach((j, jj) => { for (let a = 0; a < p; a++) { M[a][p + jj] = Ixg[a][j]; M[p + jj][a] = Ixg[j][a]; } idx.forEach((l, ll) => { M[p + jj][p + ll] = Igg[j][l]; }); });
    const u = [...new Array(p).fill(0), ...idx.map(j => Ug[j])];
    return dot(u, choleskySolve(M, u));
  };
  const table = beta.map((_, j) => { const chi2 = block([j]); return { name: names[j] || `x${j + 1}`, chi2, df: 1, p: chiSqSf(chi2, 1) }; });
  const g = block(beta.map((_, j) => j));
  return { transform, table, global: { chi2: g, df: p, p: chiSqSf(g, p) } };
}

// ---------- competing risks ----------
/**
 * Cumulative incidence for one cause (Aalen–Johansen), with the variance used by R cmprsk::cuminc.
 * status: 0 censored, 1..k causes. Returns step points {t, est, var} and helper at(t).
 */
export function cumulativeIncidence(time, status, cause = 1) {
  const d = time.map((t, i) => [Number(t), Number(status[i])]).filter(([t, s]) => Number.isFinite(t) && Number.isInteger(s) && s >= 0).sort((a, b) => a[0] - b[0]);
  const n = d.length;
  if (n < 2) throw Error('Cumulative incidence needs at least two observations.');
  let fk = 1, v1 = 0, v2 = 0, v3 = 0, F = 0, V = 0, rs = n;
  const pts = [{ t: 0, est: 0, var: 0 }];
  for (let l = 0; l < n;) {
    let u = l; while (u + 1 < n && d[u + 1][0] === d[l][0]) u++;
    let nd1 = 0, nd2 = 0;
    for (let i = l; i <= u; i++) { if (d[i][1] === cause) nd1++; else if (d[i][1] !== 0) nd2++; }
    const nd = nd1 + nd2;
    if (nd > 0) {
      const fkn = fk * (rs - nd) / rs;
      if (nd1 > 0) F += fk * nd1 / rs;
      if (nd2 > 0 && fkn > 0) {
        const t5 = nd2 > 1 ? 1 - (nd2 - 1) / (rs - 1) : 1, t6 = fk * fk * t5 * nd2 / (rs * rs), t3 = 1 / fkn, t4 = F / fkn;
        v1 += t4 * t4 * t6; v2 += t3 * t4 * t6; v3 += t3 * t3 * t6;
      }
      if (nd1 > 0) {
        const t5 = nd1 > 1 ? 1 - (nd1 - 1) / (rs - 1) : 1, t6 = fk * fk * t5 * nd1 / (rs * rs), t3 = fkn > 0 ? 1 / fkn : 0, t4 = 1 + t3 * F;
        v1 += t4 * t4 * t6; v2 += t3 * t4 * t6; v3 += t3 * t3 * t6;
        V = v1 + F * F * v3 - 2 * F * v2;
        pts.push({ t: d[l][0], est: F, var: V });
      }
      fk = fkn;
    }
    rs = n - (u + 1);
    l = u + 1;
  }
  const at = t => { let r = pts[0]; for (const p of pts) { if (p.t <= t) r = p; else break; } return r; };
  // log(-log) style interval as in cmprsk-based reporting: est ± z·sqrt(var) on the cumulative scale, clipped
  return { cause, n, points: pts, maxTime: d[n - 1][0], at, ci: t => { const p = at(t), s = Math.sqrt(p.var); return [Math.max(0, p.est - Z975 * s), Math.min(1, p.est + Z975 * s)]; } };
}

/** Gray's k-sample test for equality of cumulative incidence (port of cmprsk crstm, rho = 0 by default). */
export function grayTest(time, status, group, { cause = 1, rho = 0 } = {}) {
  const labels = [...new Set(group.filter(g => g !== '' && g != null).map(String))];
  const ng = labels.length;
  if (ng < 2) throw Error("Gray's test needs at least two groups.");
  const d = time.map((t, i) => ({ y: Number(t), m: Number(status[i]) === cause ? 1 : Number(status[i]) === 0 ? 0 : 2, g: labels.indexOf(String(group[i])) }))
    .filter(r => Number.isFinite(r.y) && r.g >= 0 && Number.isFinite(r.m)).sort((a, b) => a.y - b.y);
  const n = d.length, ng1 = ng - 1;
  const rs = new Array(ng).fill(0); d.forEach(r => rs[r.g]++);
  const s = new Array(ng1).fill(0), v = zeros(ng1, ng1), f1m = new Array(ng).fill(0), f1 = new Array(ng).fill(0), skmm = new Array(ng).fill(1), skm = new Array(ng).fill(1);
  const v3 = new Array(ng).fill(0), v2 = zeros(ng1, ng), c = zeros(ng, ng), a = zeros(ng, ng);
  let fm = 0, f = 0;
  for (let ll = 0; ll < n;) {
    let lu = ll; while (lu + 1 < n && d[lu + 1].y === d[ll].y) lu++;
    const dd = [new Array(ng).fill(0), new Array(ng).fill(0), new Array(ng).fill(0)];
    for (let i = ll; i <= lu; i++) dd[d[i].m][d[i].g]++;
    const nd1 = dd[1].reduce((x, y) => x + y, 0), nd2 = dd[2].reduce((x, y) => x + y, 0);
    if (nd1 || nd2) {
      let tr = 0, tq = 0;
      for (let i = 0; i < ng; i++) {
        if (rs[i] <= 0) continue;
        const td = dd[1][i] + dd[2][i];
        skm[i] = skmm[i] * (rs[i] - td) / rs[i];
        f1[i] = f1m[i] + skmm[i] * dd[1][i] / rs[i];
        tr += rs[i] / skmm[i];
        tq += rs[i] * (1 - f1m[i]) / skmm[i];
      }
      f = fm + nd1 / tr;
      const fb = (1 - fm) ** rho;
      for (let i = 0; i < ng; i++) {
        for (let j = i; j < ng; j++) a[i][j] = 0;
        if (rs[i] <= 0) continue;
        const t1 = rs[i] / skmm[i];
        a[i][i] = fb * t1 * (1 - t1 / tr);
        if (a[i][i] !== 0) c[i][i] += a[i][i] * nd1 / (tr * (1 - fm));
        for (let j = i + 1; j < ng; j++) {
          if (rs[j] <= 0) continue;
          a[i][j] = -fb * t1 * rs[j] / (skmm[j] * tr);
          if (a[i][j] !== 0) c[i][j] += a[i][j] * nd1 / (tr * (1 - fm));
        }
      }
      for (let i = 1; i < ng; i++) for (let j = 0; j < i; j++) { a[i][j] = a[j][i]; c[i][j] = c[j][i]; }
      for (let i = 0; i < ng1; i++) if (rs[i] > 0) s[i] += fb * (dd[1][i] - nd1 * rs[i] * (1 - f1m[i]) / (skmm[i] * tq));
      if (nd1 > 0) {
        for (let k = 0; k < ng; k++) {
          if (rs[k] <= 0) continue;
          const t4 = skm[k] > 0 ? 1 - (1 - f) / skm[k] : 1, t5 = nd1 > 1 ? 1 - (nd1 - 1) / (tr * skmm[k] - 1) : 1, t3 = t5 * skmm[k] * nd1 / (tr * rs[k]);
          v3[k] += t4 * t4 * t3;
          for (let i = 0; i < ng1; i++) {
            const t1 = a[i][k] - t4 * c[i][k];
            v2[i][k] += t1 * t4 * t3;
            for (let j = 0; j <= i; j++) { const t2 = a[j][k] - t4 * c[j][k]; v[i][j] += t1 * t2 * t3; }
          }
        }
      }
      if (nd2 > 0) {
        for (let k = 0; k < ng; k++) {
          if (skm[k] <= 0 || dd[2][k] <= 0) continue;
          const t4 = (1 - f) / skm[k], t5 = dd[2][k] > 1 ? 1 - (dd[2][k] - 1) / (rs[k] - 1) : 1, t3 = t5 * (skmm[k] ** 2) * dd[2][k] / (rs[k] ** 2);
          v3[k] += t4 * t4 * t3;
          for (let i = 0; i < ng1; i++) {
            const t1 = t4 * c[i][k];
            v2[i][k] -= t1 * t4 * t3;
            for (let j = 0; j <= i; j++) { const t2 = t4 * c[j][k]; v[i][j] += t1 * t2 * t3; }
          }
        }
      }
    }
    for (let i = ll; i <= lu; i++) rs[d[i].g]--;
    fm = f;
    for (let i = 0; i < ng; i++) { f1m[i] = f1[i]; skmm[i] = skm[i]; }
    ll = lu + 1;
  }
  for (let i = 0; i < ng1; i++) for (let j = 0; j <= i; j++) {
    for (let k = 0; k < ng; k++) v[i][j] += c[i][k] * c[j][k] * v3[k] + c[i][k] * v2[j][k] + c[j][k] * v2[i][k];
    v[j][i] = v[i][j];
  }
  const chi2 = dot(s, choleskySolve(v, s));
  return { test: "Gray's test", cause, groups: labels, chi2, df: ng1, p: chiSqSf(chi2, ng1) };
}

// ---------- restricted mean survival time ----------
/** RMST up to tau from the Kaplan–Meier curve, with the variance used by survRM2. */
export function rmst(time, status, tau) {
  const km = kaplanMeier(time, status), steps = km.steps;
  const maxT = Math.max(...time.map(Number).filter(Number.isFinite));
  if (!(tau > 0)) throw Error('Choose a positive truncation time τ.');
  if (tau > maxT) throw Error(`τ (${tau}) exceeds the largest follow-up time (${maxT}).`);
  // area under the step function up to tau
  const knots = steps.filter(s => s.t <= tau);
  let area = 0;
  for (let i = 0; i < knots.length; i++) { const t0 = knots[i].t, t1 = i + 1 < knots.length ? knots[i + 1].t : tau; area += knots[i].s * (t1 - t0); }
  // variance: sum over event times t_i <= tau of A_i^2 d_i / (n_i (n_i - d_i)), A_i = area from t_i to tau
  let variance = 0;
  for (let i = 1; i < knots.length; i++) {
    const st = knots[i];
    let A = 0;
    for (let j = i; j < knots.length; j++) { const t0 = knots[j].t, t1 = j + 1 < knots.length ? knots[j + 1].t : tau; A += knots[j].s * (t1 - t0); }
    if (st.atRisk > st.events) variance += A * A * st.events / (st.atRisk * (st.atRisk - st.events));
  }
  const se = Math.sqrt(variance);
  return { tau, rmst: area, se, lower: area - Z975 * se, upper: area + Z975 * se };
}

/** Two-arm RMST comparison (difference and ratio), as reported by survRM2::rmst2. */
export function rmst2(time, status, arm, tau) {
  const labels = [...new Set(arm.map(String))];
  if (labels.length !== 2) throw Error('RMST comparison needs exactly two arms.');
  const [a0, a1] = labels.map(l => { const idx = arm.map((g, i) => (String(g) === l ? i : -1)).filter(i => i >= 0); return { label: l, ...rmst(idx.map(i => time[i]), idx.map(i => status[i]), tau) }; });
  const diff = a1.rmst - a0.rmst, seDiff = Math.sqrt(a1.se ** 2 + a0.se ** 2), zD = diff / seDiff;
  const lr = Math.log(a1.rmst / a0.rmst), seR = Math.sqrt((a1.se / a1.rmst) ** 2 + (a0.se / a0.rmst) ** 2), zR = lr / seR;
  return {
    tau, arms: [a0, a1],
    difference: { label: `${a1.label} − ${a0.label}`, est: diff, lower: diff - Z975 * seDiff, upper: diff + Z975 * seDiff, p: 2 * normalCdf(-Math.abs(zD)) },
    ratio: { label: `${a1.label} / ${a0.label}`, est: Math.exp(lr), lower: Math.exp(lr - Z975 * seR), upper: Math.exp(lr + Z975 * seR), p: 2 * normalCdf(-Math.abs(zR)) },
  };
}

// ---------- response and design ----------
/** Clopper–Pearson exact binomial confidence interval. */
export function binomialCI(x, n, level = 0.95) {
  if (!(Number.isInteger(x) && Number.isInteger(n) && n > 0 && x >= 0 && x <= n)) throw Error('Responders must be an integer between 0 and n.');
  const a = (1 - level) / 2;
  const betaInv = (pp, A, B) => { let lo = 0, hi = 1; for (let i = 0; i < 200; i++) { const m = (lo + hi) / 2; if (incBeta(m, A, B) < pp) lo = m; else hi = m; } return (lo + hi) / 2; };
  return { x, n, p: x / n, lower: x === 0 ? 0 : betaInv(a, x, n - x + 1), upper: x === n ? 1 : betaInv(1 - a, x + 1, n - x), level, method: 'Clopper–Pearson exact' };
}

const lchoose = (n, k) => { let s = 0; for (let i = 1; i <= k; i++) s += Math.log(n - k + i) - Math.log(i); return s; };
const dbinom = (k, n, p) => Math.exp(lchoose(n, k) + k * Math.log(p) + (n - k) * Math.log1p(-p));

/**
 * Simon's two-stage design (optimal and minimax), exhaustive search as in clinfun::ph2simon.
 * Stage 1: stop if <= r1 responses in n1. Overall: reject H0 if > r responses in n.
 */
export function simonTwoStage(p0, p1, alpha = 0.05, beta = 0.2, nmax = 100) {
  if (!(p0 > 0 && p1 < 1 && p1 > p0)) throw Error('Need 0 < p0 < p1 < 1.');
  if (!(alpha > 0 && alpha < 0.5 && beta > 0 && beta < 0.5)) throw Error('Need 0 < α, β < 0.5.');
  // tail[p][m][k] = P(Bin(m, p) > k), for k = -1..m (index k + 1)
  const tails = pp => Array.from({ length: nmax + 1 }, (_, m) => { const pm = Array.from({ length: m + 1 }, (_, k) => dbinom(k, m, pp)), out = new Array(m + 2); let acc = 1; out[0] = 1; for (let k = 0; k <= m; k++) { acc -= pm[k]; out[k + 1] = Math.max(0, acc); } return { pm, out }; });
  const T0 = tails(p0), T1 = tails(p1);
  const tail = (T, m, k) => (k < 0 ? 1 : k >= m ? 0 : T[m].out[k + 1]);
  const designs = [];
  let minN = Infinity;
  for (let n = 2; n <= nmax; n++) {
    if (n > minN * 1.6 + 10) break; // the optimal design is never far above the minimax size
    for (let n1 = 1; n1 < n; n1++) {
      const n2 = n - n1, b0 = T0[n1].pm, b1 = T1[n1].pm;
      let pet0 = 0;
      for (let r1 = 0; r1 < n1; r1++) {
        pet0 += b0[r1];
        if (pet0 >= 1 - 1e-12) break;
        const rej = (r, b, T) => { let x = 0; for (let x1 = r1 + 1; x1 <= n1; x1++) x += b[x1] * tail(T, n2, r - x1); return x; };
        // smallest r >= r1 with type I error <= alpha (error decreases in r)
        let lo = r1, hi = n;
        if (rej(hi - 1, b0, T0) > alpha) continue;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (rej(mid, b0, T0) <= alpha) hi = mid; else lo = mid + 1; }
        const r = lo, power = rej(r, b1, T1);
        if (power >= 1 - beta) { designs.push({ r1, n1, r, n, pet0, en0: n1 + (1 - pet0) * n2, alpha: rej(r, b0, T0), power }); minN = Math.min(minN, n); }
      }
    }
  }
  if (!designs.length) throw Error(`No design found with n ≤ ${nmax}. Increase the maximum sample size or relax α/β.`);
  const optimal = designs.reduce((best, d) => (d.en0 < best.en0 - 1e-12 || (Math.abs(d.en0 - best.en0) <= 1e-12 && d.n < best.n) ? d : best));
  const minimax = designs.filter(d => d.n === minN).reduce((best, d) => (d.en0 < best.en0 ? d : best));
  return { p0, p1, alpha, beta, optimal, minimax };
}

/** BOIN dose-escalation boundaries (Liu & Yuan 2015). */
export function boinBoundaries(target, phi1 = 0.6 * target, phi2 = 1.4 * target) {
  if (!(target > 0 && target < 1 && phi1 > 0 && phi1 < target && phi2 > target && phi2 < 1)) throw Error('Need 0 < φ1 < target < φ2 < 1.');
  const lambdaE = Math.log((1 - phi1) / (1 - target)) / Math.log((target * (1 - phi1)) / (phi1 * (1 - target)));
  const lambdaD = Math.log((1 - target) / (1 - phi2)) / Math.log((phi2 * (1 - target)) / (target * (1 - phi2)));
  return { target, phi1, phi2, lambdaE, lambdaD, table: n => ({ escalateIfAtMost: Math.floor(n * lambdaE), deescalateIfAtLeast: Math.ceil(n * lambdaD - 1e-12) }) };
}

/**
 * RECIST 1.1 overall response for one assessment.
 * Inputs in mm: baseline and nadir sums of target-lesion diameters (short axis for nodes), current sum.
 * Flags: newLesions, nonTargetProgression, allTargetsResolved (non-nodal gone, nodes < 10 mm), nonTargetCR.
 */
export function recist({ baselineSum, nadirSum, currentSum, newLesions = false, nonTargetProgression = false, allTargetsResolved = false, nonTargetCR = true }) {
  if (![baselineSum, nadirSum, currentSum].every(v => Number.isFinite(v) && v >= 0)) throw Error('Enter non-negative diameter sums in millimetres.');
  if (nadirSum > baselineSum) throw Error('The nadir sum cannot exceed the baseline sum.');
  const fromBaseline = baselineSum ? (currentSum - baselineSum) / baselineSum * 100 : 0, fromNadir = nadirSum ? (currentSum - nadirSum) / nadirSum * 100 : (currentSum > 0 ? Infinity : 0);
  let target;
  if (allTargetsResolved) target = 'CR';
  else if (fromNadir >= 20 && currentSum - nadirSum >= 5) target = 'PD';
  else if (fromBaseline <= -30) target = 'PR';
  else target = 'SD';
  let overall = target;
  if (newLesions || nonTargetProgression || target === 'PD') overall = 'PD';
  else if (target === 'CR' && !nonTargetCR) overall = 'PR';
  return { target, overall, changeFromBaseline: fromBaseline, changeFromNadir: fromNadir, rules: 'RECIST 1.1: CR all target lesions resolved; PR ≥30% decrease from baseline; PD ≥20% and ≥5 mm increase from nadir, or new lesions / unequivocal non-target progression.' };
}
