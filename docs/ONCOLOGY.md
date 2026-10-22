# Cerebro OS — Cancer Research and Data Analysis Plan

_Last updated: 2026-10-22. Companion to `docs/ROADMAP.md` (phases) and `docs/TOOLS.md` (tools by community)._

Cerebro OS expands from neuroscience into **oncology** while keeping the local-first, verified-methods approach. **Neuro-oncology** (glioma, glioblastoma, brain metastases) is the bridge: it uses the neuroscience tools we already have and the cancer tools below.

## 1. Data sources (checked 2026-10-22: all callable from the browser via CORS)

| Source | What it gives | Access | Allowlist origin to add |
|---|---|---|---|
| NCI Genomic Data Commons (GDC) | TCGA/TARGET/CPTAC clinical, mutation, expression and copy-number metadata | Open tier is public; controlled data needs dbGaP | `https://api.gdc.cancer.gov` |
| cBioPortal | Curated cancer genomics studies, mutations, CNA, expression, survival | Public API | `https://www.cbioportal.org` |
| CIViC | Open, community-curated clinical variant evidence | Public GraphQL (CC0) | `https://civicdb.org` |
| Open Targets Platform | Target–disease associations, genetics, tractability | Public GraphQL | `https://api.platform.opentargets.org` |
| ChEMBL | Compounds, bioactivity, mechanisms | Public (already allowed via `www.ebi.ac.uk`) | — |
| OncoKB | Precision-oncology levels of evidence | Token required; academic licence; commercial use paid | `https://www.oncokb.org` (only with a licence) |
| TCIA | Cancer imaging collections (radiology, pathology) | Public API; some collections restricted | `https://services.cancerimagingarchive.net` |
| ClinicalTrials.gov | Trials, including biomarker eligibility | Already connected | — |
| Europe PMC / PubMed | Literature | Already connected | — |

Each new origin goes into `CONNECT_ALLOWLIST` in `web/app/js/policy.mjs`, followed by `npm run gen:hosts`. COSMIC, dbGaP controlled data and SEER need licences or data-use agreements, so add them only with those in place.

## 2. Tools by community

### Oncologists and clinicians (evidence and research support; not patient-specific advice)
| Tool | What it does |
|---|---|
| **Biomarker trial finder** | Cancer type + stage + biomarkers (e.g. EGFR L858R, MSI-H, HER2-low) → recruiting trials, with eligibility text highlighted |
| **Variant evidence lookup** | Gene/variant → CIViC evidence (and OncoKB levels where licensed), with tier labels and sources. Research use only; clinical variant reporting is a regulated laboratory activity (CLIA/CAP, FDA for companion diagnostics) |
| **RECIST 1.1 response calculator** | Target-lesion sums → CR/PR/SD/PD for research case report forms |
| **CTCAE v5 toxicity helper** | Searchable adverse-event grading reference for trial documentation (CTCAE is published by the NCI) |
| **Tumour board prep pack** | Literature brief + trials + variant evidence + guideline links on one printable page, all sourced |
| **Oncology journal-club kit** | Hazard-ratio interpretation, NNT from survival curves, surrogate-endpoint caveats, GRADE |

### Clinical and translational researchers: oncology analytics suite *(the core)*
| Area | Methods to add | Status |
|---|---|---|
| Survival | Cox proportional hazards (Efron ties), hazard ratios with CIs, Schoenfeld-residual PH test, stratified Cox, restricted mean survival time (RMST), landmark analysis, time-dependent covariates | **Shipped:** Cox (Efron/Breslow, strata), PH test, RMST. Next: landmark, time-dependent covariates |
| Competing risks | Cumulative incidence (Aalen–Johansen), Gray's test, Fine–Gray subdistribution hazards | **Shipped:** CIF and Gray's test. Next: Fine–Gray |
| Response and trial plots | Waterfall, swimmer and spider plots; ORR and DCR with exact (Clopper–Pearson) CIs | **Shipped** |
| Trial design | Simon two-stage, single-arm exact binomial, BOIN / 3+3 dose finding, group-sequential boundaries (O'Brien–Fleming, Lan–DeMets), non-inferiority, events-driven sample size | **Shipped:** Simon, BOIN, exact CI, RECIST 1.1 calculator. Next: group sequential, non-inferiority |
| Biomarkers | ROC/AUC with DeLong CI, sensitivity/specificity, cut-point analysis with optimism correction, time-dependent ROC, nomograms | New |
| Regression | Logistic, Poisson/negative binomial, multiple imputation (MICE), propensity scores (matching, IPTW) for real-world evidence | OLS already exists |
| Cancer epidemiology | Crude and age-standardised rates (direct/indirect, SEER and WHO standard populations), SIR/SMR with exact CIs, relative survival (Ederer II / Pohar-Perme), joinpoint-style trend analysis | New |
| Meta-analysis | Hazard-ratio pooling from reported HR/CI or reconstructed from KM curves (Guyot method), network meta-analysis | Generic pooling already exists |

Every engine follows the existing rule: reference values from established software (R `survival`, `cmprsk`, `survRM2`, `clinfun`; Python `lifelines`, `statsmodels`) go in the test suite before release.

### Cancer biologists and bioinformaticians
| Tool | What it does | Where it runs |
|---|---|---|
| **Gene → target dossier** | Open Targets associations + ChEMBL compounds + CIViC variants + ClinicalTrials.gov + literature, as one sourced page | Browser |
| **Cohort explorer for TCGA/cBioPortal** | Pick a study → mutation frequency, CNA, expression; KM split by gene alteration or expression | Browser |
| **Mutation landscape from MAF/VCF** | OncoPrint, lollipop plots, tumour mutational burden (TMB), co-occurrence and mutual exclusivity (Fisher with FDR) | Browser (Web Worker) |
| **Mutational signatures** | SBS-96 catalogue; NNLS fit to reference signatures (check the licence terms of the COSMIC signature set) | Browser |
| **Expression analysis** | Normalisation, differential expression (negative-binomial GLM), volcano/heatmap, enrichment against open gene sets (GO, Reactome) | Small data in the browser; large data on server compute |
| **Drug-response explorer** | DepMap/GDSC sensitivity vs genomic features | Browser for summaries; server for full matrices |
| **Pipelines** | nf-core rnaseq/sarek (somatic variants), single-cell (scvi-tools), spatial | Server compute (Phase 3) |
| **Imaging** | TCIA collection search; DICOM metadata; later, whole-slide pathology viewing and radiomics | Browser search; server for heavy imaging |

## 3. Data-analysis platform upgrades (cross-cutting)

1. **In-browser Python and R (WebAssembly).** Run Pyodide (Python with SciPy/statsmodels/lifelines) and WebR (R with survival) **locally in the browser**. Researchers get the reference tools themselves and data still never leaves the device. This needs self-hosted packages and a CSP change to allow `'wasm-unsafe-eval'` for scripts. Both are deliberate, reviewed policy edits.
2. **Analysis notebooks.** Ordered, re-runnable steps (load → clean → model → figure), each logged in the SHA-256 provenance chain and exportable as a methods section.
3. **Data handling.** Parquet/Arrow and large-file streaming, codebooks and data dictionaries, cleaning recipes, and a de-identification checker (flags dates, IDs and free-text names before analysis).
4. **Publication outputs.** Table 1, regression tables, CONSORT/PRISMA diagrams, and vector figures following journal styles.
5. **Server compute (Phase 3).** Job queue for Nextflow pipelines and large models. Results return to the same provenance log.

## 4. Priorities (cancer track)

| # | Deliverable | Community | Effort | Dependency |
|---|---|---|---|---|
| 1 | ✅ Oncology survival suite: Cox PH + PH test, competing risks, RMST, waterfall/swimmer/spider plots, ORR exact CI | Researchers | Medium | Shipped (Analysis lab → Oncology) |
| 2 | Cancer data connectors (GDC, cBioPortal, CIViC, Open Targets) + gene → target dossier | Scientists and MDs | Medium | Allowlist update |
| 3 | Biomarker trial finder + tumour board prep pack | MDs | Low–medium | #2 |
| 4 | ✅ Trial design calculators: Simon two-stage, BOIN, exact CI (group sequential next) | Researchers | Low | Shipped |
| 5 | Mutation landscape from MAF (OncoPrint, lollipop, TMB, signatures) | Scientists | Medium | None |
| 6 | TCGA/cBioPortal cohort explorer with KM by alteration | Scientists | Medium | #1, #2 |
| 7 | In-browser Python/R (Pyodide/WebR) + notebooks | All | High | CSP review |
| 8 | Server pipelines (nf-core rnaseq/sarek, single cell) | Scientists | High | ROADMAP Phases 1 and 3 |

**First 90 days:** weeks 1–5 #1 and #4; weeks 6–9 #2 and #3; weeks 10–13 #5. Then pilot with one oncology research group and one tumour-board coordinator, and write up the validation study of the survival suite against R `survival`.

## 5. Reaching each cancer community
- **Oncologists:** fellowship programs, tumour boards and oncology journal clubs. Free for trainees. Every answer sourced, with evidence levels.
- **Trialists and biostatisticians:** cancer-centre biostatistics cores and cooperative-group statisticians. Lead with validated designs and exportable statistical analysis plans.
- **Cancer biologists:** cBioPortal/TCGA users, AACR workshops and open-source communities. Keep the connectors and visualisations free and open; charge for compute and teams.
- **Patient advocates (later):** a plain-language trial finder, built with advocacy groups, with no personal data collected.
- **Credibility:** publish validation studies, give each release a DOI, and use neuro-oncology case studies that bridge both communities.

## 6. Guardrails specific to oncology
- **Regulatory:** variant interpretation, treatment matching and prognosis for an individual patient are regulated (FDA SaMD / companion diagnostics, CLIA/CAP lab reporting, EU MDR/IVDR). Stay research-use and non-patient-specific until a deliberate regulatory plan exists.
- **Controlled data:** TCGA controlled-tier, dbGaP and similar data require approved access. Never cache or redistribute it. Process it locally or on approved infrastructure.
- **Licences:** OncoKB, COSMIC (including the signature sets) and MSigDB have licence terms. Prefer CC0/open sources (CIViC, GO, Reactome) by default.
- **Privacy:** genomic data is identifying. Keep it local-first, apply the de-identification checker, and complete the HIPAA/GDPR work before any server-side storage of patient data.
- **OpenAI policy is unchanged:** no OpenAI endpoints or SDKs. Any AI assistant uses a non-OpenAI provider, with sourced, human-reviewed outputs.
