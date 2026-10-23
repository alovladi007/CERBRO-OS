# Cerebro OS

**A local-first research workspace for neuroscience and cancer research.** Evidence search, systematic-review screening, dataset discovery, verified statistics, oncology analytics, machine learning, pretrained models, signal analysis, meta-analysis, power planning and study protocols in one place. Data stays in the browser, and every engine is checked against reference software.

Cerebro OS grew out of the *AXON Research v0.1* prototype. It is a ground-up rebuild: every v0.1 capability is kept, and AXON workspaces import automatically. It runs with **zero npm dependencies and no build step**, either as static files or through the bundled Node server. The only third-party code is the self-hosted ONNX Runtime Web (MIT), vendored with a hash manifest.

> Research use only. Cerebro OS is not a medical device and does not provide diagnosis, prognosis or treatment recommendations.

## Quick start

```sh
git clone https://github.com/alovladi007/CERBRO-OS.git && cd CERBRO-OS
npm run fetch:models # optional, once: download and verify model weights (67 MB)
npm start            # http://127.0.0.1:4700  (Node ≥ 20, no npm install needed)
```

Open http://127.0.0.1:4700 for the landing page and http://127.0.0.1:4700/app/ for the workspace. To update an existing copy: `git pull`, run `npm run fetch:models` if the registry changed, restart `npm start`, then press ⌘/Ctrl-Shift-R once in the browser (the app is an offline-capable PWA).

To try the tools on fictional data, use the buttons in **Analysis lab**:

- **Synthetic cohort**: general statistics, regression and survival.
- **Synthetic oncology trial**: the Oncology tab.
- **Synthetic biomarker cohort**: the Machine learning tab. Its structure is known, so you can see whether a method recovers it.

### Commands

```sh
npm start                  # server on 127.0.0.1:4700
npm run dev                # 127.0.0.1:4701 with access logs
npm test                   # 106 tests: numerical engines, ML, models, app logic, policy, server
npm run check              # syntax-check every module
npm run fetch:models       # download registered model weights from their pinned revisions; verify SHA-256
npm run fetch:models -- --check   # verify only
npm run test:models        # full model inference check (needs the weights)
npm run vendor:onnxruntime # re-vendor ONNX Runtime Web (checks npm integrity, writes a hash manifest)
npm run gen:hosts          # regenerate nginx/Netlify/Vercel/Cloudflare configs from policy.mjs
npm run check:hosts        # verify generated configs match policy.mjs
npm run refresh:openai     # update OpenAI crawler IP ranges
```

The build-out and scaling plan is in [`docs/ROADMAP.md`](docs/ROADMAP.md), with product tracks in [`docs/TOOLS.md`](docs/TOOLS.md), [`docs/ONCOLOGY.md`](docs/ONCOLOGY.md) (cancer research and data analysis) and [`docs/ML.md`](docs/ML.md) (machine learning). Ports are listed in [`docs/PORTS.md`](docs/PORTS.md); they avoid every port reserved by the other local platforms, and a test enforces this.

- `/` is the commercial landing page, with `/privacy.html`, `/terms.html` and `/security.html`.
- `/app/` is the research workspace.

## What's inside

| Area | Capabilities |
|---|---|
| **Evidence** | One query across **Europe PMC, PubMed and ClinicalTrials.gov**. Results are de-duplicated (DOI → PMID → title) and can be filtered by year, open access and sort order. Abstracts load on demand. Results paginate. Saved searches report how many records are new since the last run. Export to BibTeX, RIS, CSV or JSON. |
| **Screening** | Keyboard-driven include/exclude/maybe decisions (I / E / M, reasons 1–8, J/K, U to undo). A live **PRISMA 2020** flow diagram can be exported as SVG or JSON, and decisions export as CSV. |
| **Datasets** | Live search of **OpenNeuro** and **DANDI**, showing versions, subject counts and sizes. A curated directory of 14 repositories and cohorts. |
| **Statistics** | Welch, Student and paired t-tests; Mann–Whitney U; one-way ANOVA; Kruskal–Wallis; χ²; Pearson and Spearman with CIs; Hedges' g; BH, Holm and Bonferroni corrections. |
| **Regression** | Multiple OLS with dummy-coded categorical predictors, CIs, R², F-test and a residual plot. |
| **Survival** | Kaplan–Meier with log-log CIs and medians; k-group log-rank test. |
| **Oncology** | Cox regression (Efron/Breslow, strata) with the proportional-hazards test; competing risks (cumulative incidence, Gray's test); RMST; waterfall, swimmer and spider plots with ORR/DCR exact CIs; Simon two-stage and BOIN designs; RECIST 1.1 calculator. Validated against R `survival`, `cmprsk`, `survRM2` and `clinfun`. |
| **Machine learning** | Penalised (elastic-net) logistic and Cox regression, decision trees, random forests, random survival forests and gradient boosting. Stratified cross-validation with leak-free preprocessing; AUC with DeLong CI, calibration plots, Harrell's C, IPCW Brier score; permutation importance; subgroup and leave-one-site-out validation; frozen models re-applied to new data; PCA and k-means subtype discovery. Decision curves, time-dependent AUC, bootstrap optimism correction, TreeSHAP explanations and UMAP maps. Exports a model card and a TRIPOD+AI draft. Validated against R `glmnet`/`pROC`/`dcurves`, scikit-learn, scikit-survival and `shap`. |
| **Pretrained models** | A registry of open-licence models with pinned revisions and SHA-256 checks, running in the browser on self-hosted ONNX Runtime Web (WebAssembly). First model: biomedical entity recognition for case reports and abstracts (also from Evidence search). Weights are fetched with `npm run fetch:models` or chosen from the user's device. |
| **Signal** | Bluestein/radix-2 FFT, Welch PSD, zero-phase high-pass, low-pass and notch filters, spectrogram, band power, spectral entropy, aperiodic 1/f exponent and artifact flagging. Handles up to 5 M samples in a Web Worker. |
| **Meta-analysis** | Fixed and random effects (DL, Paule–Mandel, REML), Hartung–Knapp, prediction intervals, forest and funnel plots, Egger's test, leave-one-out, cumulative analysis, ratio back-transform, and effect-size converters (means → g; 2×2 → log OR, log RR or RD). |
| **Power** | Exact noncentral-t power (two-sample, paired, one-sample, unequal allocation), proportions, correlation, time-to-event (Schoenfeld), power curves and minimum detectable effect. |
| **Protocols** | RCT (SPIRIT-style), observational (STROBE-style), systematic review (PRISMA-P-style) and generic templates. Tracks completeness and versions. Linked analysis runs and included records travel with the protocol. Export to Markdown or print to PDF. |
| **Provenance** | Every run records the method version, timestamp, inputs and a **SHA-256 input fingerprint**, and can be exported as JSON. |
| **Workspace** | Multiple projects, IndexedDB storage (localStorage fallback), backup and restore, a command palette (⌘/Ctrl-K), light and dark themes, and an installable offline PWA. |

## OpenAI / ChatGPT restraint

The operator does not permit OpenAI agents to access the platform. The restriction is enforced in layers:

1. **Server 403s.** The server refuses GPTBot, ChatGPT-User, OAI-SearchBot, ChatGPT-Agent and other OpenAI agents. It matches by **user agent** and by **OpenAI's published IP ranges**, which `npm run refresh:openai` updates. It also refuses requests with a ChatGPT/OpenAI Referer.
2. **Opt-out signals.** `robots.txt`, `ai.txt`, `noai` meta tags and per-agent `X-Robots-Tag` headers.
3. **The app never contacts OpenAI.** A strict CSP `connect-src` allowlist plus a runtime fetch, beacon and WebSocket guard (`web/app/js/guard.mjs`) block any call to OpenAI. Scripts load only from the site itself. `script-src` adds `'wasm-unsafe-eval'` so the self-hosted model runtime can compile WebAssembly; `eval` stays blocked.
4. **No embedding.** `frame-ancestors 'none'` and a frame-buster stop the site being framed, for example inside ChatGPT.
5. **Terms of service.** The terms prohibit using platform content to train or evaluate AI models.

All of these come from one file: `web/app/js/policy.mjs`. The configs for nginx, Netlify, Vercel and Cloudflare are generated from it. See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for each layer and its honest limits: nothing can stop a person copy-pasting content, or traffic from unpublished IP addresses.

## Scaling

- **Browser.** The client is stateless and local-first, so heavy computation scales with each user's own device. Analysis, model training and model inference run in Web Workers.
- **Models.** Weights are static files (`web/models/<id>/`), served from the site or a CDN. Verified copies are cached in each browser, and the server streams large files instead of buffering them.
- **Server.** The server holds no shared state. Use `WORKERS=auto` for multi-core cluster mode. Docker, docker-compose and Kubernetes manifests (HPA and PodDisruptionBudget) are in `deploy/`.
- **Static.** Any static CDN can serve `web/` directly.

## Validation

Each engine is checked against reference values computed independently with established software. The reference scripts are in `tests/fixtures/`, and the results are in [`docs/VALIDATION.md`](docs/VALIDATION.md).

- **Statistics:** SciPy/NumPy.
- **Oncology:** R `survival`, `cmprsk`, `survRM2` and `clinfun`.
- **Machine learning:** R `glmnet`, `pROC` and `dcurves`; scikit-learn; scikit-survival; `shap`.
- **Pretrained models:** Hugging Face `tokenizers` and `transformers`; Python `onnxruntime`.

These tests show the arithmetic matches; they are not scientific or clinical validation. The pretrained model's accuracy has not been measured here, and its model card says so. Benchmark claims against other platforms require matched user studies, which have not been run.

## Status and next steps

- **Shipped:**
  - Evidence, screening, datasets, statistics, the oncology suite.
  - ML Stage 1: training, validation, explanations, model cards, TRIPOD+AI.
  - ML Stage 2: pretrained models in the browser.
- **Next** (see [`docs/ML.md`](docs/ML.md) and [`docs/ROADMAP.md`](docs/ROADMAP.md)):
  - More registry models.
  - Accounts and sync (roadmap Phase 1), which a GPU job service (ML Stage 3) needs.
  - Federated learning across hospitals (Stage 4).
  - A sourced research assistant using a non-OpenAI provider (Stage 5).

## Layout

```
web/              static site root (deploy this)
  index.html      landing page · privacy/terms/security/404
  app/            workspace (index.html, app.css, js/ modules, js/views/, js/views/lab/)
  lib/            scientific core: stats, meta, power, signal, oncology, csv, worker
                  ml*.mjs: training, evaluation, SHAP, UMAP, reports
                  models/: tokenizer, NER grouping, ONNX pipeline, inference worker
  models/         model registry (registry.json) and per-model files; weights via fetch:models
  vendor/         ONNX Runtime Web 1.30.0 (MIT) with SHA-256 manifest
server/           zero-dependency Node server + OpenAI bot policy + IP-range snapshot
deploy/           nginx, Cloudflare Worker, Vercel middleware, docker-compose, k8s
scripts/          config generator, IP-range refresher, syntax checker, model fetch/test, runtime vendoring
tests/            node:test suites; fixtures/ holds the R and Python reference scripts and values
docs/             ROADMAP, TOOLS, ONCOLOGY, ML, VALIDATION, DEPLOYMENT, PORTS
```
