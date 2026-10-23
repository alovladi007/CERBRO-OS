// Stage 1 completion: decision curves (R dcurves), time-dependent AUC (scikit-survival
// cumulative_dynamic_auc), TreeSHAP (shap.TreeExplainer, path-dependent), trustworthiness
// (sklearn.manifold.trustworthiness), the UMAP a/b curve (scipy curve_fit, as umap-learn),
// optimism correction and the training report. Reference values: tests/fixtures/ml-reference.json.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as M from '../web/lib/ml.mjs';
import * as E from '../web/lib/ml-eval.mjs';
import * as S from '../web/lib/ml-shap.mjs';
import * as U from '../web/lib/ml-embed.mjs';
import { trainReport, clusterReport } from '../web/lib/ml-pipeline.mjs';
import { syntheticBiomarker } from '../web/lib/ml-demo.mjs';

const R = JSON.parse(readFileSync(new URL('./fixtures/ml-reference.json', import.meta.url)));
const close = (a, b, tol, label = '') => { [].concat(a).forEach((v, i) => assert.ok(Math.abs(v - [].concat(b)[i]) <= tol, `${label}[${i}] ${v} vs ${[].concat(b)[i]}`)); };

test('decision curves match R dcurves (binary and time-to-event)', () => {
  const th = R.dca.thresholds;
  const b = E.decisionCurve(R.y, R.calib.prob, { thresholds: th });
  close(b.map(r => r.model), R.dca.binary.p, 1e-12, 'model'); close(b.map(r => r.all), R.dca.binary['Treat All'], 1e-12, 'all');
  const s = E.decisionCurve({ time: R.time, status: R.status, horizon: 5 }, R.dca.surv_risk, { thresholds: th });
  close(s.map(r => r.model), R.dca.surv.p, 1e-12, 'surv model'); close(s.map(r => r.all), R.dca.surv['Treat All'], 1e-12, 'surv all');
});

test('time-dependent AUC matches scikit-survival cumulative_dynamic_auc (Uno IPCW)', () => {
  R.sksurv.times.forEach((t, k) => close(E.timeDependentAUC(R.time, R.status, R.conc.risk, t).auc, R.sksurv.auc[k], 1e-12, `t=${t}`));
});

test('TreeSHAP matches shap.TreeExplainer for a decision tree and gradient boosting, and is additive', () => {
  const tr = R.X.slice(0, 150), y = R.y.slice(0, 150), te = R.X.slice(150, 160);
  const tree = M.fitModel('tree', tr, y, { maxDepth: 3, minLeaf: 1 }), st = S.shapValues(tree, te);
  st.values.forEach((row, i) => close(row, R.sklearn.tree_shap[i], 1e-12, `tree row ${i}`));
  const gbm = M.fitModel('gbm', tr, y, { nTrees: 40, learningRate: 0.1, maxDepth: 3, minLeaf: 10, subsample: 1 }), sg = S.shapValues(gbm, te);
  sg.values.forEach((row, i) => close(row, R.sklearn.gbm_shap[i], 1e-10, `gbm row ${i}`));
  close(sg.base, R.sklearn.gbm_shap_base, 1e-12, 'base');
  // local accuracy: base + sum(phi) = raw model output (log-odds)
  const p = M.predictModel(gbm, te).prob;
  sg.values.forEach((row, i) => close(sg.base + row.reduce((a, v) => a + v, 0), Math.log(p[i] / (1 - p[i])), 1e-9, `additivity ${i}`));
});

test('trustworthiness matches scikit-learn; UMAP curve parameters match umap-learn', () => {
  const P = M.pca(R.X, { scale: false, components: 2 });
  close(U.trustworthiness(R.X, P.scores, 5), R.sklearn.trust_k5, 1e-12, 'trust');
  const { a, b } = U.findAB(1, 0.1);
  close([a, b], [1.57694346, 0.89506088], 2e-6, 'a, b'); // scipy.optimize.curve_fit, as umap-learn find_ab_params
});

const demo = syntheticBiomarker(), H = demo.headers, rows = demo.rows;
const feats = ['age', 'ecog', 'arm', 'tmb', 'KRAS_mut', 'EGFR_mut', 'gene_01', 'gene_02'].map(name => ({ name, kind: name === 'arm' ? 'categorical' : 'numeric' }));
const surv = { type: 'survival', time: 'os_months', event: 'death' }, bin = { type: 'binary', column: 'response', positive: '1' };

test('UMAP is reproducible and preserves neighbourhoods better than PCA on the planted subtypes', () => {
  const genes = Array.from({ length: 12 }, (_, i) => ({ name: `gene_${String(i + 1).padStart(2, '0')}`, kind: 'numeric' }));
  const a = clusterReport({ headers: H, rows, features: genes, embedding: 'umap', seed: 3 }), b = clusterReport({ headers: H, rows, features: genes, embedding: 'umap', seed: 3 });
  assert.deepEqual(a.umap.embedding, b.umap.embedding);
  assert.ok(a.umap.trust > a.pca.trust && a.umap.trust > 0.9, `UMAP ${a.umap.trust} vs PCA ${a.pca.trust}`);
});

test('optimism correction lowers apparent discrimination and is reproducible', () => {
  const spec = { headers: H, rows, outcome: bin, features: feats, model: 'logit_enet', seed: 5 };
  const o = E.optimismBootstrap(spec, { B: 15 }), o2 = E.optimismBootstrap(spec, { B: 15 });
  assert.deepEqual(o.metrics, o2.metrics);
  const auc = o.metrics.find(m => m.metric === 'auc');
  assert.ok(auc.optimism > 0 && auc.corrected < auc.apparent && auc.replicates === 15);
  const so = E.optimismBootstrap({ headers: H, rows, outcome: surv, features: feats, model: 'cox_enet', seed: 5 }, { B: 8 });
  assert.ok(so.metrics.find(m => m.metric === 'c').corrected < so.metrics.find(m => m.metric === 'c').apparent);
});

test('training report adds decision curves, time-dependent AUC and SHAP that ranks the true signal', () => {
  const r = trainReport({ headers: H, rows, outcome: surv, features: feats, model: 'gbm_cox', folds: 3, seed: 2, importance: false });
  assert.equal(r.decisionCurve.length, 99);
  assert.ok(r.timeAUC.length >= 2 && r.timeAUC.every(t => t.auc > 0.6));
  assert.deepEqual(r.shap.meanAbs.slice(0, 3).map(m => m.feature).sort(), ['KRAS_mut', 'ecog', 'gene_01']);
  const rb = trainReport({ headers: H, rows, outcome: bin, features: feats, model: 'rf', params: { nTrees: 60 }, folds: 3, seed: 2, importance: false });
  assert.ok(['gene_02', 'tmb'].includes(rb.shap.meanAbs[0].feature), rb.shap.meanAbs[0].feature);
  assert.equal(rb.shap.values[0].length, feats.length); // dummy columns are summed back to features
  assert.equal(r.oof, undefined);
});
