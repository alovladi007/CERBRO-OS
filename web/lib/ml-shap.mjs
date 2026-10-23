// Cerebro OS — SHAP explanations (Stage 1, docs/ML.md).
// Tree models: exact path-dependent TreeSHAP (Lundberg, Erion & Lee 2018, Algorithm 2), as
// shap.TreeExplainer(feature_perturbation = "tree_path_dependent"). Linear models: exact SHAP
// for independent features, phi_j = beta_j (x_j − mean_j). Values are on the model's raw scale:
// log-odds (logistic, boosting), probability (tree, forest), log relative hazard (Cox),
// summed cumulative hazard (random survival forest).

/** Leaf value used for explanation. */
const leafValue = node => (node.chf ? node.chf.reduce((s, v) => s + v, 0) : node.v);

function extendPath(P, depth, zero, one, feature) {
  P.f[depth] = feature; P.z[depth] = zero; P.o[depth] = one; P.w[depth] = depth === 0 ? 1 : 0;
  for (let i = depth - 1; i >= 0; i--) {
    P.w[i + 1] += one * P.w[i] * (i + 1) / (depth + 1);
    P.w[i] = zero * P.w[i] * (depth - i) / (depth + 1);
  }
}
function unwindPath(P, depth, k) {
  const one = P.o[k], zero = P.z[k];
  let next = P.w[depth];
  for (let i = depth - 1; i >= 0; i--) {
    if (one !== 0) { const tmp = P.w[i]; P.w[i] = next * (depth + 1) / ((i + 1) * one); next = tmp - P.w[i] * zero * (depth - i) / (depth + 1); }
    else P.w[i] = P.w[i] * (depth + 1) / (zero * (depth - i));
  }
  for (let i = k; i < depth; i++) { P.f[i] = P.f[i + 1]; P.z[i] = P.z[i + 1]; P.o[i] = P.o[i + 1]; }
}
function unwoundSum(P, depth, k) {
  const one = P.o[k], zero = P.z[k];
  let next = P.w[depth], total = 0;
  for (let i = depth - 1; i >= 0; i--) {
    if (one !== 0) { const tmp = next * (depth + 1) / ((i + 1) * one); total += tmp; next = P.w[i] - tmp * zero * (depth - i) / (depth + 1); }
    else total += P.w[i] / zero / ((depth - i) / (depth + 1));
  }
  return total;
}
const copyPath = P => ({ f: P.f.slice(), z: P.z.slice(), o: P.o.slice(), w: P.w.slice() });

function recurse(node, x, phi, parent, depth, zero, one, feature, scale) {
  const P = copyPath(parent);
  extendPath(P, depth, zero, one, feature);
  if (node.f === undefined) {
    const v = leafValue(node) * scale;
    for (let i = 1; i <= depth; i++) phi[P.f[i]] += unwoundSum(P, depth, i) * (P.o[i] - P.z[i]) * v;
    return;
  }
  const hot = x[node.f] <= node.t ? node.l : node.r, cold = hot === node.l ? node.r : node.l;
  let inZero = 1, inOne = 1, d = depth, k = 0;
  while (k <= d && P.f[k] !== node.f) k++;
  if (k !== d + 1) { inZero = P.z[k]; inOne = P.o[k]; unwindPath(P, d, k); d--; }
  recurse(hot, x, phi, P, d + 1, hot.n / node.n * inZero, inOne, node.f, scale);
  recurse(cold, x, phi, P, d + 1, cold.n / node.n * inZero, 0, node.f, scale);
}
function treeDepth(t) { return t.f === undefined ? 0 : 1 + Math.max(treeDepth(t.l), treeDepth(t.r)); }
/** Expected leaf value under the training distribution (cover-weighted). */
function treeExpectation(t) { return t.f === undefined ? leafValue(t) : (t.l.n * treeExpectation(t.l) + t.r.n * treeExpectation(t.r)) / t.n; }

/** SHAP values for one tree; adds into phi (length p). */
export function treeShap(tree, x, phi, scale = 1) {
  const size = treeDepth(tree) + 2, P = { f: new Array(size).fill(-1), z: new Array(size).fill(0), o: new Array(size).fill(0), w: new Array(size).fill(0) };
  recurse(tree, x, phi, P, 0, 1, 1, -1, scale);
}

/**
 * SHAP values for a fitted Cerebro model on encoded rows X.
 * Returns { base, values: number[][] } with base + sum(values[i]) = the model's raw output for row i.
 */
export function shapValues(model, X, { mean = null } = {}) {
  const p = X[0]?.length || 0;
  switch (model.type) {
    case 'logit_enet': case 'cox_enet': {
      const mu = mean || new Array(p).fill(0).map((_, j) => X.reduce((s, r) => s + r[j], 0) / X.length);
      const base = (model.b0 || 0) + model.beta.reduce((s, b, j) => s + b * mu[j], 0);
      return { base, scale: model.type === 'logit_enet' ? 'log-odds' : 'log relative hazard', values: X.map(x => model.beta.map((b, j) => b * (x[j] - mu[j]))) };
    }
    case 'tree': case 'rf': case 'rsf': {
      const trees = model.type === 'tree' ? [model.tree] : model.trees, w = 1 / trees.length;
      const base = trees.reduce((s, t) => s + w * treeExpectation(t), 0);
      return { base, scale: model.type === 'rsf' ? 'summed cumulative hazard' : 'probability', values: X.map(x => { const phi = new Array(p).fill(0); trees.forEach(t => treeShap(t, x, phi, w)); return phi; }) };
    }
    case 'gbm': case 'gbm_cox': {
      const base = model.f0 + model.trees.reduce((s, t) => s + model.learningRate * treeExpectation(t), 0);
      return { base, scale: model.type === 'gbm' ? 'log-odds' : 'log relative hazard', values: X.map(x => { const phi = new Array(p).fill(0); model.trees.forEach(t => treeShap(t, x, phi, model.learningRate)); return phi; }) };
    }
    default: throw Error(`SHAP is not available for ${model.type}.`);
  }
}

/** Aggregate encoded-column SHAP values to original features (dummy columns of one categorical are summed). */
export function shapByFeature(pre, values) {
  const groups = []; let j = 0;
  for (const s of pre.spec) { const width = s.kind === 'numeric' ? 1 : s.levels.length; groups.push({ name: s.name, cols: Array.from({ length: width }, (_, k) => j + k) }); j += width; }
  return { features: groups.map(g => g.name), values: values.map(row => groups.map(g => g.cols.reduce((s, c) => s + row[c], 0))) };
}
