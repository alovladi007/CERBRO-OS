# Cerebro OS — Tools by Community

_Last updated: 2026-10-22. The cancer-specific expansion is in `docs/ONCOLOGY.md`; phases are in `docs/ROADMAP.md`._

The highest-impact tools serve the loop **evidence → study → data → result → practice**. Cerebro OS already covers that loop, so each tool below plugs into it.

## 1. Physicians (MDs)
Their job: answer clinical questions fast, stay current, and do the research their training requires. **Line we stay behind:** no patient-specific diagnosis or treatment advice (that would be regulated software as a medical device).

| Tool | What it does |
|---|---|
| Clinical question → evidence brief | Structured question (patient, intervention, comparison, outcome) → federated search → brief with study design and certainty labels; every claim linked to its source |
| Trial finder | De-identified criteria → recruiting trials with contacts |
| Critical-appraisal / journal-club kit | NNT/NNH, likelihood ratios, post-test probability, RoB 2, ROBINS-I, GRADE |
| Quality-improvement / audit toolkit | Run charts, statistical process control charts, before/after comparisons, audit-cycle template |
| Clinical scales for research | Standardised scoring stored de-identified; check each scale's licence first |
| Evidence alerts | Weekly "new since last run" digest of saved searches |

**Reach:** residency programs, chief residents, journal clubs; free for trainees; sources and certainty ratings on everything.
**Measures:** time to answer, questions answered per session, journal clubs run on the platform.

## 2. Clinical and academic researchers
| Tool | What it does |
|---|---|
| End-to-end systematic review | Dual screening with conflict resolution and Cohen's κ, data extraction, risk of bias, GRADE, PRISMA, meta-analysis |
| Living systematic reviews | Scheduled searches → screening queue → meta-analysis updates automatically |
| Grant toolkit | NIH Data Management & Sharing Plan generator, sample-size justification, analysis-plan builder |
| Reporting-checklist checker | CONSORT, STROBE, PRISMA, ARRIVE and STARD gap check |
| Manuscript-ready outputs | Table 1, flow diagrams, vector figures, methods text from the provenance log |
| Preregistration bridge | Protocol → OSF / PROSPERO package |

**Reach:** research librarians, research offices, methods courses; a methods/software paper and a validation study; a citable DOI.
**Measures:** reviews completed, time from protocol to PRISMA, citations.

## 3. Basic and translational scientists
| Tool | What it does |
|---|---|
| BIDS/NWB toolkit | Validate, convert and check metadata for OpenNeuro/DANDI deposit |
| EEG/MEG pipeline | ICA, epoching, ERPs, connectivity, group statistics (server compute) |
| Dataset reanalysis workbench | Pinned-version open dataset → standard pipeline → reproducible result |
| Target/drug evidence explorer | Open Targets + ChEMBL + trials + literature |
| Preclinical study design | Animal-study power, randomisation and blinding, ARRIVE 2.0 |
| Lab notebook with provenance | Experiments linked to data, analyses and figures |

**Reach:** BIDS/NWB/MNE communities, SfN/OHBM workshops; open core (free validators, paid compute and teams).
**Measures:** datasets shared, pipeline runs, labs actively using it.

## 4. Build order (all communities)
1. End-to-end systematic review (builds on existing screening and meta-analysis)
2. Critical-appraisal / journal-club kit
3. Reporting checker + manuscript outputs
4. Grant toolkit (NIH Data Management & Sharing Plan)
5. BIDS/NWB validator and converter
6. Trial finder
7. EEG pipeline and dataset reanalysis (needs ROADMAP Phases 1 and 3)

The cancer track (`docs/ONCOLOGY.md`) runs alongside this list. Its first deliverable, the oncology survival suite, shares engine work with items 1 and 3.

## Guardrails
Regulatory line (research use, not patient-specific), privacy (no identifiable patient data before Phase 5), licences for scales, checklists and databases, and sources on every output. No OpenAI.
