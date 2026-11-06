# Reference values for tests/ml.test.mjs (scikit-learn side). Run after ml-reference.R:
#   python3 tests/fixtures/ml-reference.py
# Reads ml-reference-r.json (R: glmnet, pROC, glm, survival, dcurves), adds scikit-learn, shap
# and scikit-survival results,
# and writes the combined tests/fixtures/ml-reference.json.
import json
import os
import numpy as np
import sklearn
from sklearn.tree import DecisionTreeClassifier
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.decomposition import PCA
from sklearn.cluster import KMeans
from sklearn.metrics import silhouette_score
from sklearn.manifold import trustworthiness
import shap
from sksurv.metrics import cumulative_dynamic_auc
from sksurv.util import Surv

d = json.load(open('tests/fixtures/ml-reference-r.json'))
X = np.array(d['X'], dtype=float)
y = np.array(d['y'], dtype=int)
train, test = X[:150], X[150:]

tree = DecisionTreeClassifier(max_depth=3, random_state=0).fit(train, y[:150])
# min_samples_leaf=10 keeps nodes large enough that exactly tied splits (broken by sklearn's RNG) do not occur
gbm = GradientBoostingClassifier(n_estimators=40, learning_rate=0.1, max_depth=3, min_samples_leaf=10, random_state=0).fit(train, y[:150])
pca = PCA(n_components=4).fit(X)
init = X[[0, 50, 100]][:, :3]
km = KMeans(n_clusters=3, init=init, n_init=1, algorithm='lloyd', tol=0, max_iter=1000).fit(X[:, :3])

d['sklearn'] = {
    'version': sklearn.__version__,
    'tree_proba': tree.predict_proba(test)[:, 1].tolist(),
    'gbm_proba': gbm.predict_proba(test)[:, 1].tolist(),
    'pca_explained': pca.explained_variance_ratio_.tolist(),
    'pca_variance': pca.explained_variance_.tolist(),
    'pca_components': pca.components_.tolist(),
    'kmeans_init': init.tolist(),
    'kmeans_labels': km.labels_.tolist(),
    'kmeans_inertia': float(km.inertia_),
    'silhouette': float(silhouette_score(X[:, :3], km.labels_)),
}
# TreeSHAP (path-dependent) on the same tree and boosting models
d['sklearn']['shap_version'] = shap.__version__
d['sklearn']['tree_shap'] = shap.TreeExplainer(tree, feature_perturbation='tree_path_dependent').shap_values(test[:10])[..., 1].tolist()
eg = shap.TreeExplainer(gbm, feature_perturbation='tree_path_dependent')
d['sklearn']['gbm_shap'] = eg.shap_values(test[:10]).tolist()
d['sklearn']['gbm_shap_base'] = float(np.ravel(eg.expected_value)[0])
# trustworthiness of the 2-D PCA projection
d['sklearn']['trust_k5'] = float(trustworthiness(X, pca.transform(X)[:, :2], n_neighbors=5))
# time-dependent AUC (Uno IPCW, cumulative/dynamic) with the R Cox risk score
yt = Surv.from_arrays(event=np.array(d['status'], dtype=bool), time=np.array(d['time'], dtype=float))
times = [3.0, 6.0, 9.0]
auc, _ = cumulative_dynamic_auc(yt, yt, np.array(d['conc']['risk']), times)
d['sksurv'] = {'times': times, 'auc': auc.tolist()}
# class weights: weighted CART, weighted boosting and TreeSHAP covers on a weighted tree
from sklearn.experimental import enable_iterative_imputer  # noqa: F401
from sklearn.impute import IterativeImputer
from sklearn.linear_model import Ridge
from sklearn.manifold import TSNE
from sklearn.manifold._t_sne import _joint_probabilities, _kl_divergence
from sklearn.metrics import pairwise_distances
wtr = np.where(y[:150] == 1, 150 / (2 * y[:150].sum()), 150 / (2 * (150 - y[:150].sum())))
wtree = DecisionTreeClassifier(max_depth=3, min_samples_leaf=5, class_weight='balanced', random_state=0).fit(train, y[:150])
wgbm = GradientBoostingClassifier(n_estimators=30, learning_rate=0.1, max_depth=2, min_samples_leaf=10, random_state=0).fit(train, y[:150], sample_weight=wtr)
d['weighted'] = {
    'tree_proba': wtree.predict_proba(test)[:, 1].tolist(),
    'tree_shap': shap.TreeExplainer(wtree, feature_perturbation='tree_path_dependent').shap_values(test[:10])[..., 1].tolist(),
    'gbm_proba': wgbm.predict_proba(test)[:, 1].tolist(),
}
# iterative imputation (chained ridge), deterministic
rs = np.random.RandomState(7)
Xm = X[:, :5].copy(); Xm[:, 4] = 0.6 * Xm[:, 0] - 0.4 * Xm[:, 1] + 0.2 * rs.randn(200)
for j, frac in [(0, 0.10), (2, 0.25), (4, 0.15)]:
    Xm[rs.rand(200) < frac, j] = np.nan
imp = IterativeImputer(estimator=Ridge(alpha=1.0), initial_strategy='median', imputation_order='ascending', skip_complete=True, max_iter=10, tol=1e-3, sample_posterior=False)
fitted = imp.fit_transform(Xm[:150])
Xnew = Xm[150:]
d['impute'] = {'X': np.where(np.isnan(Xm), None, Xm).tolist(), 'fit': fitted.tolist(), 'transform': imp.transform(Xnew).tolist(), 'n_iter': int(imp.n_iter_)}
# t-SNE: joint probabilities and KL/gradient at a fixed embedding; full run from a fixed start
Xs = X[:120, :6]
Pj = _joint_probabilities(pairwise_distances(Xs, squared=True), 20.0, 0)
Y0 = rs.randn(120, 2) * 1e-2
kl, grad = _kl_divergence(Y0.ravel(), Pj, 1, 120, 2)
ts = TSNE(n_components=2, perplexity=20.0, method='exact', init=(rs.randn(120, 2) * 1e-4).astype(np.float32), random_state=0, max_iter=500)
emb = ts.fit_transform(Xs)
# the same start in float64: scikit-learn's own final KL depends on the precision of the start
ts64 = TSNE(n_components=2, perplexity=20.0, method='exact', init=ts.init.astype(np.float64), random_state=0, max_iter=500).fit(Xs)
d['tsne'] = {'perplexity': 20.0, 'P': Pj.tolist(), 'Y0': Y0.tolist(), 'kl': float(kl), 'grad': grad.tolist(), 'init': ts.init.astype(float).tolist(), 'kl_final': float(ts.kl_divergence_), 'kl_final_f64': float(ts64.kl_divergence_), 'max_iter': 500, 'trust': float(trustworthiness(Xs, emb, n_neighbors=5))}
json.dump(d, open('tests/fixtures/ml-reference.json', 'w'))
os.remove('tests/fixtures/ml-reference-r.json')
