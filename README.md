# Cerebro OS

**The operating system for neuroscience research.** Evidence search, systematic-review screening, dataset discovery, verified statistics, signal analysis, meta-analysis, power planning and study protocols in one local-first workspace.

Cerebro OS grew out of the *AXON Research v0.1* prototype. It is a ground-up rebuild: every v0.1 capability is kept, and AXON workspaces import automatically. It runs with **zero dependencies and no build step**, either as static files or through the bundled Node server.

> Research use only. Cerebro OS is not a medical device and does not provide diagnosis, prognosis or treatment recommendations.

## Quick start

```sh
npm start            # http://localhost:4700  (Node ≥ 20, no npm install needed)
npm run dev          # http://localhost:4701 with access logs
npm test             # 57 tests: numerical engines, app logic, policy, server
npm run check        # syntax-check every module
```

The build-out and scaling plan is in [`docs/ROADMAP.md`](docs/ROADMAP.md), with product tracks in [`docs/TOOLS.md`](docs/TOOLS.md) and [`docs/ONCOLOGY.md`](docs/ONCOLOGY.md) (cancer research and data analysis). Ports are listed in [`docs/PORTS.md`](docs/PORTS.md); they avoid every port reserved by the other local platforms, and a test enforces this.

```sh
```

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
3. **The app never contacts OpenAI.** A strict CSP `connect-src` allowlist plus a runtime fetch, beacon and WebSocket guard (`web/app/js/guard.mjs`) block any call to OpenAI.
4. **No embedding.** `frame-ancestors 'none'` and a frame-buster stop the site being framed, for example inside ChatGPT.
5. **Terms of service.** The terms prohibit using platform content to train or evaluate AI models.

All of these come from one file: `web/app/js/policy.mjs`. The configs for nginx, Netlify, Vercel and Cloudflare are generated from it. See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for each layer and its honest limits: nothing can stop a person copy-pasting content, or traffic from unpublished IP addresses.

## Scaling

- **Browser.** The client is stateless and local-first, so heavy computation scales with each user's own device. Analysis runs in a Web Worker.
- **Server.** The server holds no shared state. Use `WORKERS=auto` for multi-core cluster mode. Docker, docker-compose and Kubernetes manifests (HPA and PodDisruptionBudget) are in `deploy/`.
- **Static.** Any static CDN can serve `web/` directly.

## Validation

The numerical engines are checked against reference values computed independently with SciPy/NumPy; see [`docs/VALIDATION.md`](docs/VALIDATION.md). Unit tests verify the arithmetic. They are not scientific or clinical validation. Benchmark claims against other platforms require matched user studies, which have not been run.

## Layout

```
web/            static site root (deploy this)
  index.html    landing page · privacy/terms/security/404
  app/          workspace (index.html, app.css, js/ modules, js/views/, js/views/lab/)
  lib/          scientific core: stats, meta, power, signal, csv, worker
server/         zero-dependency Node server + OpenAI bot policy + IP-range snapshot
deploy/         nginx, Cloudflare Worker, Vercel middleware, docker-compose, k8s
scripts/        config generator, IP-range refresher, syntax checker
tests/          node:test suites
```
