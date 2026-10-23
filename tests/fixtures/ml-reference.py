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
json.dump(d, open('tests/fixtures/ml-reference.json', 'w'))
os.remove('tests/fixtures/ml-reference-r.json')
