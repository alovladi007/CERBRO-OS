// Cerebro OS — UMAP embedding and trustworthiness (Stage 1, docs/ML.md).
// UMAP follows McInnes, Healy & Melville (2018) and the umap-learn reference implementation:
// exact k-nearest neighbours, smooth-kNN fuzzy simplicial set with fuzzy-union symmetrisation,
// a/b curve fitted to (spread, min_dist), PCA initialisation, and SGD with negative sampling.
// Seeded and single-threaded, so the same seed gives the same layout. Not bit-identical to
// umap-learn (different random streams); quality is checked by trustworthiness instead.
import { rng, pca } from './ml.mjs';

const dist2 = (a, b) => { let s = 0; for (let j = 0; j < a.length; j++) { const d = a[j] - b[j]; s += d * d; } return s; };

/** Exact k nearest neighbours (excluding self). Returns { idx, dist } arrays of length n × k. */
export function knn(X, k) {
  const n = X.length, idx = [], dist = [];
  for (let i = 0; i < n; i++) {
    const d = [];
    for (let j = 0; j < n; j++) if (j !== i) d.push([dist2(X[i], X[j]), j]);
    d.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    idx.push(d.slice(0, k).map(v => v[1])); dist.push(d.slice(0, k).map(v => Math.sqrt(v[0])));
  }
  return { idx, dist };
}

/** Fit a, b so that 1 / (1 + a d^(2b)) approximates the min_dist/spread target curve (umap-learn find_ab_params). */
export function findAB(spread = 1, minDist = 0.1) {
  const xs = Array.from({ length: 300 }, (_, i) => (3 * spread * i) / 299), ys = xs.map(x => (x < minDist ? 1 : Math.exp(-(x - minDist) / spread)));
  let a = 1, b = 1, lambda = 1e-3;
  const sse = (A, B) => xs.reduce((s, x, i) => s + (1 / (1 + A * x ** (2 * B)) - ys[i]) ** 2, 0);
  let cur = sse(a, b);
  for (let it = 0; it < 500; it++) {
    let JtJ00 = 0, JtJ01 = 0, JtJ11 = 0, g0 = 0, g1 = 0;
    xs.forEach((x, i) => {
      if (x === 0) return;
      const xb = x ** (2 * b), f = 1 / (1 + a * xb), r = f - ys[i], dfa = -xb * f * f, dfb = -a * xb * 2 * Math.log(x) * f * f;
      JtJ00 += dfa * dfa; JtJ01 += dfa * dfb; JtJ11 += dfb * dfb; g0 += dfa * r; g1 += dfb * r;
    });
    const A00 = JtJ00 * (1 + lambda), A11 = JtJ11 * (1 + lambda), det = A00 * A11 - JtJ01 * JtJ01;
    const da = -(A11 * g0 - JtJ01 * g1) / det, db = -(-JtJ01 * g0 + A00 * g1) / det;
    const next = sse(a + da, b + db);
    if (next < cur) { a += da; b += db; lambda /= 3; if (cur - next < 1e-16) { cur = next; break; } cur = next; } else lambda *= 3;
    if (lambda > 1e10) break;
  }
  return { a, b };
}

/** Fuzzy simplicial set: smooth-kNN memberships, symmetrised by fuzzy union. Returns edge list. */
function fuzzyGraph(knnRes, k) {
  const n = knnRes.idx.length, target = Math.log2(k), rows = new Map();
  for (let i = 0; i < n; i++) {
    const d = knnRes.dist[i], rho = d.find(v => v > 0) ?? 0;
    let lo = 0, hi = Infinity, sigma = 1;
    for (let it = 0; it < 64; it++) {
      let s = 0; for (let j = 0; j < d.length; j++) { const e = d[j] - rho; s += e > 0 ? Math.exp(-e / sigma) : 1; }
      if (Math.abs(s - target) < 1e-5) break;
      if (s > target) { hi = sigma; sigma = (lo + hi) / 2; } else { lo = sigma; sigma = hi === Infinity ? sigma * 2 : (lo + hi) / 2; }
    }
    const meanD = d.reduce((a, b) => a + b, 0) / d.length;
    sigma = Math.max(sigma, 1e-3 * meanD);
    knnRes.idx[i].forEach((j, q) => { const e = d[q] - rho; rows.set(i * n + j, e > 0 ? Math.exp(-e / sigma) : 1); });
  }
  const edges = [];
  for (const [key, w] of rows) {
    const i = Math.floor(key / n), j = key % n;
    if (i > j && rows.has(j * n + i)) continue;
    const wt = rows.get(j * n + i) ?? 0, u = w + wt - w * wt;
    edges.push([i, j, u]);
  }
  return edges;
}

/** UMAP embedding of X (rows already scaled as desired). */
export function umap(X, { nNeighbors = 15, minDist = 0.1, spread = 1, nEpochs = null, seed = 1, negativeSampleRate = 5, dims = 2 } = {}) {
  const n = X.length;
  if (n < 4) throw Error('UMAP needs at least 4 rows.');
  if (n > 5000) throw Error('UMAP in the browser supports up to 5,000 rows.');
  const k = Math.min(nNeighbors, n - 1), r = rng(seed), { a, b } = findAB(spread, minDist), epochs = nEpochs ?? (n <= 10000 ? 500 : 200);
  let edges = fuzzyGraph(knn(X, k), k);
  const wMax = Math.max(...edges.map(e => e[2]));
  edges = edges.filter(e => e[2] >= wMax / epochs);
  // PCA initialisation, scaled to [-10, 10] as umap-learn, plus a little noise
  const P = pca(X, { scale: false, components: dims }).scores, mx = Math.max(...P.flat().map(Math.abs)) || 1;
  const Y = P.map(row => row.map(v => (10 * v) / mx + (r() - 0.5) * 1e-4));
  const eps = edges.map(e => wMax / e[2]), next = eps.slice(), nextNeg = eps.map(v => v / negativeSampleRate);
  const clip = v => (v > 4 ? 4 : v < -4 ? -4 : v);
  for (let ep = 0; ep < epochs; ep++) {
    const alpha = 1 - ep / epochs;
    for (let e = 0; e < edges.length; e++) {
      if (next[e] > ep) continue;
      const [i, j] = edges[e], yi = Y[i], yj = Y[j];
      let d2 = 0; for (let q = 0; q < dims; q++) d2 += (yi[q] - yj[q]) ** 2;
      const att = d2 > 0 ? (-2 * a * b * d2 ** (b - 1)) / (a * d2 ** b + 1) : 0;
      for (let q = 0; q < dims; q++) { const g = clip(att * (yi[q] - yj[q])) * alpha; yi[q] += g; yj[q] -= g; }
      next[e] += eps[e];
      const nNeg = Math.floor((ep - nextNeg[e]) / (eps[e] / negativeSampleRate));
      for (let s = 0; s < nNeg; s++) {
        const m = Math.floor(r() * n); if (m === i) continue;
        const ym = Y[m]; let dn = 0; for (let q = 0; q < dims; q++) dn += (yi[q] - ym[q]) ** 2;
        const rep = dn > 0 ? (2 * b) / ((0.001 + dn) * (a * dn ** b + 1)) : 0;
        if (rep > 0) for (let q = 0; q < dims; q++) yi[q] += clip(rep * (yi[q] - ym[q])) * alpha;
      }
      nextNeg[e] += nNeg * (eps[e] / negativeSampleRate);
    }
  }
  return { embedding: Y, a, b, nNeighbors: k, minDist, epochs, edges: edges.length };
}

/** Trustworthiness of an embedding (Venna & Kaski 2001), as sklearn.manifold.trustworthiness. */
export function trustworthiness(X, Y, k = 5) {
  const n = X.length;
  if (k >= n / 2) throw Error('k must be below n / 2.');
  let t = 0;
  for (let i = 0; i < n; i++) {
    const dx = []; for (let j = 0; j < n; j++) if (j !== i) dx.push([dist2(X[i], X[j]), j]);
    dx.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    const rank = new Map(dx.map(([, j], r) => [j, r + 1]));
    const dy = []; for (let j = 0; j < n; j++) if (j !== i) dy.push([dist2(Y[i], Y[j]), j]);
    dy.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    for (let q = 0; q < k; q++) { const r = rank.get(dy[q][1]); if (r > k) t += r - k; }
  }
  return 1 - (2 / (n * k * (2 * n - 3 * k - 1))) * t;
}

// ---------- t-SNE (exact), as scikit-learn TSNE(method = "exact") ----------
const MACHINE_EPSILON = 2.220446049250313e-16;

/**
 * Joint probabilities p_ij (condensed upper triangle, row-major i < j), as sklearn's
 * _joint_probabilities: squared Euclidean distances in float32, per-row binary search on the
 * Gaussian precision until the entropy matches log(perplexity) within 1e-5, symmetrised and normalised.
 */
export function tsneJointProbabilities(X, perplexity = 30) {
  const n = X.length, D = Array.from({ length: n }, () => new Float64Array(n));
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { const d = Math.fround(dist2(X[i], X[j])); D[i][j] = d; D[j][i] = d; }
  const P = Array.from({ length: n }, () => new Float64Array(n)), target = Math.log(Math.fround(perplexity)), tolE = Math.fround(1e-5);
  for (let i = 0; i < n; i++) {
    let bmin = -Infinity, bmax = Infinity, beta = 1;
    for (let step = 0; step < 100; step++) {
      let sum = 0;
      for (let j = 0; j < n; j++) if (j !== i) { P[i][j] = Math.exp(-D[i][j] * beta); sum += P[i][j]; }
      if (sum === 0) sum = Math.fround(1e-8);
      let sd = 0;
      for (let j = 0; j < n; j++) { P[i][j] /= sum; sd += D[i][j] * P[i][j]; }
      const diff = Math.log(sum) + beta * sd - target;
      if (Math.abs(diff) <= tolE) break;
      if (diff > 0) { bmin = beta; beta = bmax === Infinity ? beta * 2 : (beta + bmax) / 2; }
      else { bmax = beta; beta = bmin === -Infinity ? beta / 2 : (beta + bmin) / 2; }
    }
  }
  const cond = new Float64Array((n * (n - 1)) / 2); let k = 0, total = 0;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { cond[k] = P[i][j] + P[j][i]; total += 2 * cond[k]; k++; }
  total = Math.max(total, MACHINE_EPSILON);
  for (let q = 0; q < cond.length; q++) cond[q] = Math.max(cond[q] / total, MACHINE_EPSILON);
  return cond;
}

/** KL divergence and gradient for a 2-D embedding Y (flat), as sklearn's _kl_divergence (Student t, 1 dof). */
export function tsneKL(P, Y, n, dims = 2, computeError = true) {
  const m = P.length, q = new Float64Array(m); let sum = 0, k = 0;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { let d = 0; for (let c = 0; c < dims; c++) d += (Y[i * dims + c] - Y[j * dims + c]) ** 2; q[k] = 1 / (1 + d); sum += q[k]; k++; }
  let kl = NaN;
  if (computeError) { kl = 0; for (let t = 0; t < m; t++) { const Q = Math.max(q[t] / (2 * sum), MACHINE_EPSILON); kl += P[t] * Math.log(Math.max(P[t], MACHINE_EPSILON) / Q); } kl *= 2; }
  const grad = new Float64Array(n * dims); k = 0;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const Q = Math.max(q[k] / (2 * sum), MACHINE_EPSILON), pq = (P[k] - Q) * q[k];
    for (let c = 0; c < dims; c++) { const g = pq * (Y[i * dims + c] - Y[j * dims + c]); grad[i * dims + c] += g; grad[j * dims + c] -= g; }
    k++;
  }
  for (let t = 0; t < grad.length; t++) grad[t] *= 4; // 2 (dof + 1) / dof with dof = 1
  return { kl, grad };
}

/**
 * Exact t-SNE (van der Maaten & Hinton 2008) with scikit-learn's schedule: PCA initialisation scaled to
 * SD 1e-4, learning rate max(n / 12 / 4, 50), 250 iterations of early exaggeration 12 at momentum 0.5,
 * then momentum 0.8 up to maxIter, gains with min_gain 0.01, convergence checked every 50 iterations.
 */
export function tsne(X, { perplexity = 30, maxIter = 1000, earlyExaggeration = 12, init = null, nIterWithoutProgress = 300, minGradNorm = 1e-7 } = {}) {
  const n = X.length, dims = 2;
  if (n > 2000) throw Error('Exact t-SNE in the browser supports up to 2,000 rows.');
  if (n - 1 < 3 * perplexity) throw Error(`Perplexity ${perplexity} needs more than ${3 * perplexity + 1} rows.`);
  const P = tsneJointProbabilities(X, perplexity);
  let Y0 = init;
  if (!Y0) { const S = pca(X, { scale: false, components: 2 }).scores, sd = Math.sqrt(S.reduce((s, r) => s + r[0] * r[0], 0) / n - (S.reduce((s, r) => s + r[0], 0) / n) ** 2) || 1; Y0 = S.map(r => r.map(v => (Math.fround(v) / sd) * 1e-4)); }
  const p = Float64Array.from(Y0.flat()), lr = Math.max(n / earlyExaggeration / 4, 50);
  const descend = (it0, maxIt, momentum, noProgress) => {
    const update = new Float64Array(p.length), gains = new Float64Array(p.length).fill(1);
    let error = Number.MAX_VALUE, bestError = Number.MAX_VALUE, bestIter = it0, last = it0;
    for (let i = it0; i < maxIt; i++) {
      last = i;
      const check = (i + 1) % 50 === 0, r = tsneKL(P, p, n, dims, check || i === maxIt - 1), grad = r.grad; error = r.kl;
      for (let t = 0; t < p.length; t++) {
        if (update[t] * grad[t] < 0) gains[t] += 0.2; else gains[t] *= 0.8;
        if (gains[t] < 0.01) gains[t] = 0.01;
        grad[t] *= gains[t]; update[t] = momentum * update[t] - lr * grad[t]; p[t] += update[t];
      }
      if (check) {
        const gn = Math.sqrt(grad.reduce((s, v) => s + v * v, 0));
        if (error < bestError) { bestError = error; bestIter = i; } else if (i - bestIter > noProgress) break;
        if (gn <= minGradNorm) break;
      }
    }
    return { error, it: last }; // index of the last iteration run, as sklearn
  };
  for (let t = 0; t < P.length; t++) P[t] *= earlyExaggeration;
  let r = descend(0, 250, 0.5, 250);
  for (let t = 0; t < P.length; t++) P[t] /= earlyExaggeration;
  if (r.it < 250 || maxIter > 250) r = descend(r.it + 1, maxIter, 0.8, nIterWithoutProgress);
  const embedding = Array.from({ length: n }, (_, i) => [p[2 * i], p[2 * i + 1]]);
  return { embedding, kl: r.error, iterations: r.it, perplexity, learningRate: lr };
}
