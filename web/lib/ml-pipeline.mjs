// Cerebro OS — full training report: cross-validated performance (ml.mjs) plus clinical utility
// (decision curves, time-dependent AUC; ml-eval.mjs) and SHAP explanations of the final model
// (ml-shap.mjs). This is what the Machine learning tab runs in the Web Worker.
import { trainEvaluate, transform, clusterAnalysis } from './ml.mjs';
import { decisionCurve, timeDependentAUC, optimismBootstrap } from './ml-eval.mjs';
import { shapValues, shapByFeature } from './ml-shap.mjs';
import { umap, trustworthiness } from './ml-embed.mjs';

const thresholds = Array.from({ length: 99 }, (_, i) => (i + 1) / 100);
const treeCost = t => (t.f === undefined ? 1 : treeCost(t.l) + treeCost(t.r));
const depth = t => (t.f === undefined ? 0 : 1 + Math.max(depth(t.l), depth(t.r)));

export function trainReport(spec) {
  const r = trainEvaluate(spec), { oof } = r;
  if (r.task === 'binary') r.decisionCurve = decisionCurve(oof.y, oof.prob, { thresholds });
  else {
    r.decisionCurve = decisionCurve({ time: oof.time, status: oof.status, horizon: r.horizon }, oof.surv.map(s => 1 - s), { thresholds });
    const ev = oof.time.filter((_, i) => oof.status[i]).sort((a, b) => a - b), q = f => ev[Math.floor(f * (ev.length - 1))];
    r.timeAUC = [...new Set([q(0.25), q(0.5), r.horizon, q(0.75)])].sort((a, b) => a - b).map(t => timeDependentAUC(oof.time, oof.status, oof.risk, t));
  }
  // SHAP on the final model; tree ensembles are capped by cost (leaves × depth²) and use a fixed row sample
  const fm = r.finalModel, { headers, rows } = spec;
  const used = rows.filter(row => r.task === 'binary' ? row[headers.indexOf(r.outcome.column)] !== '' : row[headers.indexOf(r.outcome.time)] !== '' && row[headers.indexOf(r.outcome.event)] !== '');
  const trees = fm.model.trees || (fm.model.tree ? [fm.model.tree] : []);
  const perRow = trees.reduce((s, t) => s + treeCost(t) * (depth(t) + 1) ** 2, 0) || 1;
  const cap = Math.max(50, Math.min(used.length, Math.floor(3e8 / perRow))), step = used.length / cap;
  const sample = Array.from({ length: Math.min(cap, used.length) }, (_, i) => used[Math.floor(i * step)]);
  try {
    const X = transform(fm.preprocessor, headers, sample).X, sh = shapValues(fm.model, X), agg = shapByFeature(fm.preprocessor, sh.values);
    r.shap = { base: sh.base, scale: sh.scale, rows: sample.length, of: used.length, features: agg.features, values: agg.values.map(v => v.map(x => +x.toPrecision(6))),
      x: sample.map(row => agg.features.map(f => row[headers.indexOf(f)])),
      meanAbs: agg.features.map((f, j) => ({ feature: f, value: agg.values.reduce((s, v) => s + Math.abs(v[j]), 0) / agg.values.length })).sort((a, b) => b.value - a.value) };
  } catch (e) { r.shap = { error: e.message }; }
  delete r.oof;
  return r;
}

export { optimismBootstrap };

/** Subtype discovery with an optional UMAP map and trustworthiness of each 2-D map. */
export function clusterReport(spec) {
  const c = clusterAnalysis(spec);
  if (spec.embedding === 'umap') {
    const Z = c._Z, u = umap(Z, { nNeighbors: spec.nNeighbors ?? 15, minDist: spec.minDist ?? 0.1, seed: spec.seed ?? 2026 });
    c.umap = { embedding: u.embedding, nNeighbors: u.nNeighbors, minDist: u.minDist, epochs: u.epochs };
    if (Z.length <= 3000) { c.umap.trust = trustworthiness(Z, u.embedding, 10); c.pca.trust = trustworthiness(Z, c.pca.scores, 10); }
  }
  delete c._Z;
  return c;
}
