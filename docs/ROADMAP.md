# Cerebro OS — Build-out and Scaling Plan

_Last updated: 2026-10-22_

Related plans: **`docs/TOOLS.md`** (tools for physicians, researchers and scientists) and **`docs/ONCOLOGY.md`** (cancer research and data-analysis track).

## 1. What Cerebro OS is

A local-first research workspace for neuroscience and neurology. It covers the path from a research question to a reproducible result in one place:

| Step | In Cerebro OS | Replaces |
|---|---|---|
| Evidence | One query across Europe PMC, PubMed and ClinicalTrials.gov, de-duplicated | Three separate search sites |
| Screening | Include/exclude/maybe with reasons; automatic PRISMA 2020 diagram | Spreadsheets and a hand-drawn flow chart |
| Data | Versioned open datasets from OpenNeuro and DANDI | Browsing repository websites |
| Analysis | Statistics, regression, survival, EEG signal, meta-analysis, power | A stats package or scripts |
| Protocol | SPIRIT-, STROBE- and PRISMA-P-style templates | Word documents |
| Reproducibility | Method version, inputs and SHA-256 input fingerprint for every run | Usually nothing |

Research use only. Not a medical device. No patient data.

## 2. How it works today

```
 Browser (all work happens here)                Cerebro server (stateless)
 ┌──────────────────────────────────────┐      ┌──────────────────────────────┐
 │ Workspace app (web/app)              │ ◄─── │ Serves static files          │
 │  • Analysis engines (web/lib),       │      │ Blocks OpenAI agents (UA, IP │
 │    verified against SciPy/NumPy      │      │   ranges, referrer)          │
 │  • Web Worker for heavy computation  │      │ Security headers + CSP       │
 │  • Projects in IndexedDB on device   │      │ Rate limiting, health checks │
 │  • Fetch guard: research APIs only   │      └──────────────────────────────┘
 └──────────────┬───────────────────────┘
                ▼ direct from the browser
   Europe PMC · PubMed · ClinicalTrials.gov · OpenNeuro · DANDI
```

- **Local-first.** Projects, decisions and run history are stored in the user's browser. Participant-level data loaded into the lab is never uploaded.
- **The server holds no data.** It serves files and enforces policy, so it is cheap and easy to scale.
- **Verified maths.** 59 automated tests, with reference values computed independently in SciPy/NumPy (`docs/VALIDATION.md`).
- **OpenAI restraint, five layers.** Server 403 by user agent and published IP ranges; robots.txt, ai.txt and noai tags; CSP egress allowlist; runtime fetch guard; no framing. Details are in `docs/DEPLOYMENT.md`.

### Ports (see `docs/PORTS.md`; enforced by `tests/ports.test.mjs`)

| Port | Use |
|---|---|
| 4700 | Server: `npm start`, Docker, compose. Landing page at `/`, workspace at `/app/` |
| 4701 | Development server (`npm run dev`) |
| 4702 | Optional nginx edge (compose `nginx` profile) |

All are bound to 127.0.0.1. Never use the ports reserved by the other local platforms (EUREKA, AXIOM, OCTET, NOETHER, HELIX and the rest); the full list is in `docs/PORTS.md`.

## 3. Current scale characteristics

| Dimension | Today |
|---|---|
| Visitors | Effectively unlimited: static files behind a CDN, and compute runs on each user's device |
| Server | `WORKERS=auto` cluster mode; Docker, docker-compose and Kubernetes (3 replicas, HPA, PDB) included |
| Per-user data | CSV files up to 50 MB; signals up to 5 M samples (Web Worker) |
| **Main limit** | **Single user, single device: no accounts, sync or collaboration** |

## 4. Plan, in order

Each phase builds on the one before. Tick items as they ship.

### Phase 0: Launch what exists (now)
- [x] Platform built: evidence, screening, datasets, analysis lab, protocols, provenance
- [x] OpenAI/ChatGPT restraint across all layers
- [x] Ports moved to the 4700 block, with a guard test
- [x] Scientific editorial redesign (PR #2)
- [x] Merge PR #2 into `main`
- [ ] Set `main` as the GitHub default branch (Settings → General)
- [ ] Choose a domain; deploy `web/` behind a CDN with HTTPS (or Docker on a small VM)
- [ ] Replace placeholders: legal entity, contact emails, pricing, `security.txt`; counsel review of the legal pages
- [ ] Schedule `npm run refresh:openai` (daily cron/CI) so OpenAI IP ranges stay current
- [ ] Put it in front of 5–10 researchers; record which steps they actually use

### Phase 1: Accounts and cloud sync (biggest unlock; makes it sellable to teams)
- [ ] Authentication: email magic link plus institutional SSO (OIDC)
- [ ] API service (stateless) and managed Postgres for projects
- [ ] Local-first sync: the browser stays the working copy; encrypted change sync to the server
- [ ] Encryption at rest, audit log, EU/US data residency option
- [ ] Account export/delete (GDPR)

### Phase 2: Team collaboration (what labs and institutions buy)
- [ ] Shared projects with roles (owner, reviewer, viewer)
- [ ] Dual-reviewer screening with conflict resolution and inter-rater agreement (Cohen's κ)
- [ ] Comments, protocol version history and sign-off
- [ ] Activity feed and email notifications

### Phase 3: Server-side compute (beyond what a browser can do)
- [ ] Job queue (Redis plus workers) running containerised Python/R pipelines
- [ ] BIDS validation; EEG/MEG (MNE) and MRI (fMRIPrep) pipelines on OpenNeuro datasets, pinned to dataset versions
- [ ] Results written to the same provenance log, with pipeline version and container digest

### Product tracks (run alongside the phases)
- **Tools by community:** see `docs/TOOLS.md`. First up: the end-to-end systematic review and the journal-club kit.
- **Cancer research and data analysis:** see `docs/ONCOLOGY.md`. First up: the oncology survival suite (Cox, competing risks, RMST, waterfall/swimmer plots), trial-design calculators, then cancer data connectors (GDC, cBioPortal, CIViC, Open Targets).
- **Analysis platform:** in-browser Python/R (Pyodide/WebR), notebooks, publication outputs. Details in `docs/ONCOLOGY.md` §3.

### Phase 4: Depth and integrations
- [ ] More sources: bioRxiv/medRxiv, Crossref, OpenAlex (with API key)
- [ ] Email alerts on saved searches ("new since last run")
- [ ] Zotero and EndNote sync; OSF/PROSPERO export for preregistration
- [ ] Mixed-effects models; Bayesian meta-analysis; full-text PDF screening
- [ ] Optional evidence assistant using a **non-OpenAI** provider: answers cite their sources and need a human to accept them

### Phase 5: Enterprise and compliance (hospitals, pharma)
- [ ] SSO/SAML, SCIM; self-hosting package and support
- [ ] Security programme: penetration test, then SOC 2 Type I, then Type II
- [ ] HIPAA/GDPR processes **before** handling any patient data (today the platform deliberately avoids it)

## 5. Target production architecture (from Phase 1)

```
CDN (static site + app) ──► Load balancer ──► API servers (stateless, autoscaled)
                                                │
                       Postgres (managed, read replicas) · Redis (queue/cache)
                       Object storage (exports, datasets) · Workers (compute jobs)
```

When these services are added, give them ports in the 4700 block (for example API 4710, Postgres 4720, Redis 4730), record them in `docs/PORTS.md`, and add them to `tests/ports.test.mjs`.

## 6. Commercial notes
- Pricing on the landing page is a placeholder: Researcher $0 / Professional $29 per user per month / Lab-Enterprise custom.
- Keep cloud sync and team features labelled "Roadmap" until Phases 1–2 ship. Don't charge before accounts exist.
- Honesty rules for marketing: no fabricated testimonials, logos, user counts, certifications or superiority claims.

## 7. Working agreements
- Each change goes on a branch, then a draft PR. CI runs `npm run check`, `npm run check:hosts` and `npm test` on Node 20 and 22.
- Merging to `main` only on the owner's explicit approval.
- Policy lives in one place: `web/app/js/policy.mjs`. Regenerate host configs with `npm run gen:hosts`.
- Never add OpenAI/ChatGPT endpoints, SDKs or embeds.
