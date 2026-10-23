# Cerebro OS — Machine Learning Plan

_Last updated: 2026-10-23 (Stages 1 and 2 shipped). Companion to `docs/ROADMAP.md` (phases), `docs/ONCOLOGY.md` (cancer track) and `docs/VALIDATION.md` (how engines are checked)._

**Aim:** make Cerebro OS the place where research ML, cancer ML first, is **trustworthy and reproducible**. Every model carries:
- its validation: cross-validation, calibration, external validation and subgroup checks;
- its provenance: data hash, seed, hyperparameters, method version and a model card;
- a reporting checklist (TRIPOD+AI).

Data stays local wherever possible. We do not try to compete on foundation-model size.

Research use only. A model that predicts outcomes for an individual patient to guide care is Software as a Medical Device (FDA; EU MDR/IVDR). Cerebro OS stays on the research side until the owner deliberately chooses a regulatory path.

## 1. The four layers

| Layer | What users get | Stage | Where it runs |
|---|---|---|---|
| **A. ML analysis tools** | Train, validate and report models on their own data | 1 | Browser (Web Worker) |
| **B. Pretrained models** | Apply vetted open models to new data (pathology, radiology, variant effect, literature extraction) | 2, then 3 for heavy models | Browser (WebGPU / ONNX Runtime Web), then GPU service |
| **C. AI research assistant** | Questions over literature and the user's own results, with every claim sourced | 5 | Server plus a non-OpenAI model provider |
| **D. Learning across institutions** | Federated training: the model travels, the data stays at each site | 4 | Hospital sites plus a coordinator |

## 2. Stage 1: ML analysis tools in the browser (shipped)

Lives in the **Analysis lab → Machine learning** tab, with the engine in `web/lib/ml.mjs`.

### Shipped in the first PR
| Area | Methods | Checked against |
|---|---|---|
| Penalised regression | Elastic-net logistic and elastic-net Cox (LASSO to ridge), regularisation path, λ chosen by inner cross-validation (λ-min or λ-1SE) | R `glmnet` 4.x (coefficients at fixed λ, λ-max) |
| Trees and ensembles | CART classification tree; random forest (bootstrap, mtry, out-of-bag); random survival forest (log-rank splitting, Nelson–Aalen leaves); gradient boosting (logistic and Cox partial-likelihood loss) | scikit-learn 1.9 (`DecisionTreeClassifier`, `GradientBoostingClassifier`); property tests for the random ensembles |
| Validation | Stratified k-fold CV with out-of-fold predictions; nested tuning; permutation importance on held-out folds; internal–external (leave-one-site-out) validation; frozen-model validation on a second dataset | — |
| Metrics | AUC with DeLong CI; Brier score; log-loss; calibration intercept and slope; binned calibration plots; Harrell's C; survival calibration at a horizon (predicted vs Kaplan–Meier); IPCW Brier score | R `pROC` (DeLong), `stats::glm` (calibration), `survival` (concordance) |
| Unsupervised | PCA; k-means (k-means++) with silhouette over a range of k; Kaplan–Meier by cluster for subtype discovery | scikit-learn `PCA`, `KMeans` (fixed initial centres), `silhouette_score` |
| Subgroup (bias) checks | Discrimination and calibration-in-the-large by a chosen column (sex, age band, site, ancestry where recorded) | — |
| Reporting | Model card (intended use, data hash, preprocessing, hyperparameters, seed, performance with intervals, subgroups, limits); TRIPOD+AI draft organised by the checklist's sections, auto-filled from the run, with the author-only items flagged | Collins et al., BMJ 2024;385:e078378 |

Preprocessing (median/mode imputation, one-hot coding, standardisation) is learned inside each training fold and frozen with the model, so cross-validation does not leak. Exported models are plain JSON with no code, and can be re-applied to new data in the browser.

### Shipped in the second PR (Stage 1 completion)
| Area | Methods | Checked against |
|---|---|---|
| Clinical utility | Decision-curve analysis (net benefit vs. treat all / treat none), binary and time-to-event | R `dcurves` (to 1e-12) |
| Discrimination over time | Cumulative/dynamic time-dependent AUC with IPCW (Uno) | scikit-survival `cumulative_dynamic_auc` (to 1e-12) |
| Optimism | Harrell's bootstrap optimism correction (whole procedure refitted per replicate) | Property tests |
| Explanations | Exact path-dependent TreeSHAP (tree, forest, survival forest, boosting); exact linear SHAP for penalised models; per-row explanations | `shap.TreeExplainer` (to 1e-10) |
| Embeddings | Seeded UMAP (as umap-learn) with trustworthiness | a/b curve vs. scipy `curve_fit`; trustworthiness vs. scikit-learn |

### Still to do in Stage 1
- t-SNE; multiple imputation (MICE) inside cross-validation; class weights with a calibration warning.
- Hyperparameter search for forests and boosting (small nested grid).
- Calibration curves with smoothing (loess); net-benefit confidence bands.

## 3. Stage 2: pretrained models in the browser (shipped)

**What shipped** (workspace → **Pretrained models**):
- ONNX Runtime Web 1.30.0 (MIT) vendored under `web/vendor/onnxruntime-web/1.30.0/` by `npm run vendor:onnxruntime`. The script checks npm's SHA-512 integrity and writes a SHA-256 manifest, which the tests verify. The runtime makes no third-party requests.
- CSP: `script-src 'self' 'wasm-unsafe-eval'`. This allows WebAssembly compilation only; `eval` stays blocked, and the tests assert there is no `'unsafe-eval'`. `connect-src` is unchanged: model files load from this site, or from a file the user chooses on their device.
- Model registry `web/models/registry.json`. Each entry has a pinned source revision, licence, commercial-use flag, intended use, training data, evaluation status, limitations and citation, plus the size and SHA-256 of every file. Files are refused on any mismatch. Verified files are cached in the browser (Cache Storage), and inference runs in a module worker.
- `npm run fetch:models` downloads registered weights from their pinned revision and verifies them. The weights are not committed.
- First model: **biomedical entity recognition** (`onnx-community/biomedical-ner-all-ONNX`, Apache-2.0; DistilBERT, int8).
  - The WordPiece tokenizer matches Hugging Face `tokenizers` exactly, including offsets.
  - Entity grouping matches the transformers pipeline ("simple" and "first").
  - Long texts are split into 512-token windows at word boundaries.
  - It is reachable from Evidence search ("Tag entities" on an abstract).
- Validation of int8 inference (`npm run test:models`): integer kernels differ between runtimes, so outputs are compared with the full-precision model. This runtime's token labels agree with fp32 at least as often as Python onnxruntime's int8 labels do (91–95% of tokens on sample texts).

**Design notes (as planned):**
- **Runtime.** ONNX Runtime Web (WASM, then WebGPU) is self-hosted under `web/vendor/`, with no CDN.
  - This needs a reviewed CSP change: `script-src 'wasm-unsafe-eval'`.
  - Model weights are downloaded only from origins added to `CONNECT_ALLOWLIST` in `policy.mjs` (e.g. Hugging Face), followed by `npm run gen:hosts`.
  - OpenAI hosts stay blocked by the guard.
- **Model registry** (`web/app/js/models/registry.json`). Each entry records:
  - name, task, version, SHA-256 of the weights, licence (commercial use allowed or not);
  - input specification, intended use, the populations it was evaluated on, and the citation.
  - A model is refused if its weight hash does not match.
- **First candidates**, chosen for open licences and small size:
  - literature extraction (NER for genes, drugs and diseases);
  - variant-effect lookup tables;
  - small radiology segmentation;
  - pathology tile classifiers for demonstrations.
  - Many pathology foundation models are non-commercial only. The registry shows this and blocks commercial-tier use.
- **Provenance.** Each inference run logs the model hash and version.

## 4. Stage 3: GPU job service (ROADMAP Phase 3)

- **Architecture:**
  - API (stateless) → queue (Redis) → GPU workers (PyTorch, scikit-learn, R) in pinned containers.
  - Results go to object storage and back into the same provenance log, with the container digest.
- **Planned ports, all in the 4700 block on loopback** (to be added to `docs/PORTS.md` and `tests/ports.test.mjs` when the services exist):
  - 4740: ML job API;
  - 4741: job dashboard.
- **Jobs:**
  - training large ensembles and deep survival models (DeepSurv-style);
  - whole-slide pathology inference;
  - radiology segmentation;
  - nf-core pipelines feeding models.
- **Prerequisites:** accounts (Phase 1) and encryption at rest. Patient data must not touch the server before the HIPAA/GDPR work (ROADMAP Phase 5).

## 5. Stage 4: federated learning across institutions

- **Model.** A site runs a Cerebro node next to its data. The coordinator sends model parameters and receives only updates, never rows.
- **Algorithms:**
  - Federated averaging for GLMs and neural nets.
  - Exact federated Cox and logistic regression via summed gradients and Hessians, which equal the pooled fit.
  - Secure aggregation and optional differential privacy.
- **Building blocks already in Stage 1:**
  - Frozen JSON models and in-browser validation on a second dataset.
  - Leave-one-site-out validation. This is the single-machine rehearsal of a federated study.
- **Framework.** Evaluate Flower (Apache-2.0) for the node and coordinator. Planned coordinator port: 4750.
- **Prerequisites:** partner sites, data-use and federation agreements, IRB approvals, and security review. The legal work is the long pole.

## 6. Stage 5: AI research assistant (non-OpenAI)

- **Purpose.** Questions over literature (Europe PMC, PubMed, ClinicalTrials.gov) and the user's own runs. Each claim links to a record or a run ID, and answers without sources are not shown.
- **Provider.** A non-OpenAI model through a server-side proxy, so keys are not exposed in the browser.
  - Policy: no OpenAI endpoints, SDKs or embeds (`web/app/js/policy.mjs`).
  - Users opt in to send any of their own data.
- **Example:** "Summarise trials of KRAS G12C inhibitors with PFS > 6 months".
  - Retrieve trials and papers.
  - Extract endpoints with quotes.
  - Show a table where every cell is sourced.
  - A human accepts the result before it is saved.

## 7. Validation rules (all stages)

1. **Correct arithmetic.** Engines are checked against reference software (R `glmnet`, `pROC`, `survival`; scikit-learn) in `tests/ml.test.mjs`.
2. **Honest performance.** Every reported metric comes from held-out data, never from training predictions. CIs are shown, and calibration is shown next to discrimination.
3. **External validation.** It is prompted whenever a site, centre or period column exists.
4. **Subgroup checks.** These appear in the model card when a grouping column is chosen. Small subgroups (< 30 events or cases) are flagged as unreliable.
5. **Reproducibility.** Seeds, hyperparameters, the data hash and the method version are logged, and the same seed gives the same model.
6. **Reporting.** A TRIPOD+AI draft is generated. Prediction-model claims in marketing are never made.

## 8. Priorities

| # | Deliverable | Stage | Effort | Dependency |
|---|---|---|---|---|
| 1 | ✅ ML engine v1: elastic-net logistic and Cox, forests, RSF, boosting, CV, calibration, DeLong, PCA, k-means, model cards, TRIPOD+AI draft | 1 | Medium | Shipped (Analysis lab → Machine learning) |
| 2 | ✅ UMAP, decision curves, time-dependent AUC, optimism correction, TreeSHAP (MICE, t-SNE next) | 1 | Medium | Shipped |
| 3 | ✅ ONNX runtime + model registry + CSP change; biomedical entity recognition | 2 | Medium | Shipped |
| 3b | More registry models: gene/variant NER for abstracts, small radiology segmentation, pathology tile demo (licences checked); WebGPU backend | 2 | Medium | Licence review per model |
| 4 | Sourced research assistant (non-OpenAI) | 5 | Medium | Provider choice, server proxy |
| 5 | GPU job service | 3 | High | ROADMAP Phase 1 (accounts) |
| 6 | Federated pilot with two sites | 4 | High | Partners, agreements |
