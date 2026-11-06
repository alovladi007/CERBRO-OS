// Cerebro OS — cancer data connectors (docs/ONCOLOGY.md §1, priority #2). Every call goes from the
// browser straight to the source (CORS-enabled public APIs on the egress allowlist in policy.mjs);
// nothing is proxied or stored on a server. Pure helpers (exported) turn raw responses into tables
// and are tested offline in tests/cancer.test.mjs.
import { binomialCI } from '../../lib/oncology.mjs';

const TIMEOUT = 20000;
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function fetchJSON(url, init = {}, attempts = 3) {
  for (let i = 0; ; i++) {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT), ...init });
    if (res.ok) return res.json();
    if ((res.status === 429 || res.status === 503 || res.status === 502) && i < attempts - 1) { await sleep(800 * 2 ** i); continue; }
    throw Error(res.status === 429 ? 'rate limited by the source; try again shortly' : `HTTP ${res.status}`);
  }
}
const postJSON = (url, body) => fetchJSON(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
async function graphql(url, query, variables) {
  const d = await postJSON(url, { query, variables });
  if (d.errors?.length) throw Error(d.errors[0].message);
  return d.data;
}

export const CANCER_SOURCES = {
  opentargets: { label: 'Open Targets Platform', url: 'https://platform.opentargets.org', licence: 'Open Targets data are released under CC0 1.0.' },
  civic: { label: 'CIViC', url: 'https://civicdb.org', licence: 'CIViC content is CC0 1.0 (public domain).' },
  cbioportal: { label: 'cBioPortal (TCGA PanCancer Atlas)', url: 'https://www.cbioportal.org', licence: 'Public TCGA PanCancer Atlas studies; cite Cerami 2012, Gao 2013 and the TCGA PanCancer Atlas.' },
  gdc: { label: 'NCI Genomic Data Commons', url: 'https://portal.gdc.cancer.gov', licence: 'Open-access tier only; follow the NIH GDC data use policies.' },
  ctgov: { label: 'ClinicalTrials.gov', url: 'https://clinicaltrials.gov', licence: 'US National Library of Medicine.' },
  europepmc: { label: 'Europe PMC', url: 'https://europepmc.org', licence: 'Metadata from Europe PMC.' },
};

export const isGeneSymbol = s => /^[A-Za-z0-9][A-Za-z0-9-]{0,19}$/.test(s || '');

// ---------- Open Targets ----------
const OT = 'https://api.platform.opentargets.org/api/v4/graphql';
export async function openTargets(symbol) {
  const s = await graphql(OT, 'query($q:String!){search(queryString:$q,entityNames:["target"],page:{index:0,size:10}){hits{id name}}}', { q: symbol });
  const hit = s.search.hits.find(h => h.name.toUpperCase() === symbol.toUpperCase());
  if (!hit) throw Error(`no human target named ${symbol}`);
  const d = await graphql(OT, `query($id:String!){target(ensemblId:$id){ id approvedSymbol approvedName biotype functionDescriptions
    tractability{ label modality value }
    associatedDiseases(page:{index:0,size:50}){ count rows{ score disease{ id name therapeuticAreas{ name } } } }
    drugAndClinicalCandidates{ count rows{ maxClinicalStage drug{ id name drugType mechanismsOfAction{ rows{ mechanismOfAction } } } diseases{ disease{ id name } } } } } }`, { id: hit.id });
  return summarizeOpenTargets(d.target);
}
const STAGES = ['APPROVAL', 'PHASE_4', 'PHASE_3', 'PHASE_2_3', 'PHASE_2', 'PHASE_1_2', 'PHASE_1', 'EARLY_PHASE_1', 'PRECLINICAL', 'UNKNOWN'];
export function summarizeOpenTargets(t) {
  const cancer = r => r.disease.therapeuticAreas?.some(a => /cancer|neoplasm|tumou?r/i.test(a.name));
  const assoc = t.associatedDiseases.rows.filter(r => r.disease).map(r => ({ id: r.disease.id, name: r.disease.name, score: r.score, cancer: cancer(r) }));
  const drugs = t.drugAndClinicalCandidates.rows.filter(r => r.drug).map(r => ({
    id: r.drug.id, name: r.drug.name, type: r.drug.drugType, stage: r.maxClinicalStage,
    mechanisms: [...new Set((r.drug.mechanismsOfAction?.rows || []).map(m => m.mechanismOfAction))],
    diseases: [...new Set((r.diseases || []).map(x => x.disease?.name).filter(Boolean))],
  })).sort((a, b) => STAGES.indexOf(a.stage) - STAGES.indexOf(b.stage) || a.name.localeCompare(b.name));
  // UniProt function text carries evidence codes such as {ECO:0000269|PubMed:123}; they are dropped for reading
  const fn = (t.functionDescriptions?.[0] || '').replace(/\s*\{ECO:[^}]*\}/g, '').replace(/\s+\./g, '.').replace(/\.{2,}/g, '.').trim();
  return { ensemblId: t.id, symbol: t.approvedSymbol, name: t.approvedName, biotype: t.biotype, function: fn,
    tractability: (t.tractability || []).filter(x => x.value).map(x => `${x.label} (${x.modality})`),
    associations: { total: t.associatedDiseases.count, top: assoc.slice(0, 15), cancer: assoc.filter(a => a.cancer).slice(0, 15) },
    drugs: { total: t.drugAndClinicalCandidates.count, rows: drugs }, url: `https://platform.opentargets.org/target/${t.id}` };
}

// ---------- CIViC ----------
const CIVIC = 'https://civicdb.org/api/graphql';
export async function civic(symbol) {
  const g = await graphql(CIVIC, 'query($s:String!){ gene(entrezSymbol:$s){ id name link description } }', { s: symbol });
  if (!g.gene) return { gene: null, items: [], total: 0 };
  const items = []; let after = null, total = 0;
  for (let page = 0; page < 2; page++) {
    const d = await graphql(CIVIC, `query($s:String!,$a:String){ evidenceItems(molecularProfileName:$s, status: ACCEPTED, first: 100, after: $a){ totalCount pageInfo{ hasNextPage endCursor }
      nodes{ id evidenceLevel evidenceType evidenceDirection significance molecularProfile{ name } therapies{ name } disease{ name } source{ citation sourceType sourceUrl } } } }`, { s: symbol, a: after });
    items.push(...d.evidenceItems.nodes); total = d.evidenceItems.totalCount;
    if (!d.evidenceItems.pageInfo.hasNextPage) break;
    after = d.evidenceItems.pageInfo.endCursor;
  }
  return { gene: g.gene, ...summarizeCivic(items, symbol), total };
}
/** Keep evidence whose molecular profile names this gene as a word; count by level and type; most actionable first. */
export function summarizeCivic(items, symbol) {
  const re = new RegExp(`(^|[^A-Za-z0-9])${symbol.replace(/[^A-Za-z0-9-]/g, '')}([^A-Za-z0-9]|$)`, 'i');
  const keep = items.filter(x => re.test(x.molecularProfile?.name || ''));
  const byLevel = {}, byType = {};
  keep.forEach(x => { byLevel[x.evidenceLevel] = (byLevel[x.evidenceLevel] || 0) + 1; byType[x.evidenceType] = (byType[x.evidenceType] || 0) + 1; });
  const rows = keep.map(x => ({ id: x.id, level: x.evidenceLevel, type: x.evidenceType, direction: x.evidenceDirection, significance: x.significance, profile: x.molecularProfile.name,
    disease: x.disease?.name || '', therapies: (x.therapies || []).map(t => t.name), citation: x.source?.citation || '', sourceUrl: x.source?.sourceUrl || '', url: `https://civicdb.org/evidence/${x.id}` }))
    .sort((a, b) => a.level.localeCompare(b.level) || a.type.localeCompare(b.type) || a.id - b.id);
  return { items: rows, shown: rows.length, byLevel, byType };
}

// ---------- cBioPortal: mutation frequency in TCGA PanCancer Atlas ----------
const CBIO = 'https://www.cbioportal.org/api';
export async function cbioportal(symbol) {
  const gene = await fetchJSON(`${CBIO}/genes/${encodeURIComponent(symbol)}`);
  const studies = await fetchJSON(`${CBIO}/studies?keyword=tcga_pan_can_atlas_2018&projection=DETAILED&pageSize=100`);
  const muts = await postJSON(`${CBIO}/mutations/fetch?projection=ID`, { entrezGeneIds: [gene.entrezGeneId], molecularProfileIds: studies.map(s => `${s.studyId}_mutations`) });
  return { entrezGeneId: gene.entrezGeneId, ...mutationFrequency(studies, muts), url: `https://www.cbioportal.org/results/cancerTypesSummary?cancer_study_list=${studies.map(s => s.studyId).join(',')}&gene_list=${encodeURIComponent(symbol)}` };
}
/** Samples with ≥1 mutation / samples with mutation data, per study, with Clopper–Pearson 95% CIs. */
export function mutationFrequency(studies, mutations) {
  const mutated = new Map();
  for (const m of mutations) { if (!mutated.has(m.studyId)) mutated.set(m.studyId, new Set()); mutated.get(m.studyId).add(m.uniqueSampleKey || m.sampleId); }
  const rows = studies.filter(s => s.sequencedSampleCount > 0).map(s => {
    const x = mutated.get(s.studyId)?.size || 0, n = s.sequencedSampleCount, ci = binomialCI(Math.min(x, n), n);
    return { studyId: s.studyId, name: s.name.replace(/ \(TCGA, PanCancer Atlas\)$/, ''), cancerType: s.cancerTypeId, mutated: x, sequenced: n, frequency: x / n, lower: ci.lower, upper: ci.upper };
  }).sort((a, b) => b.frequency - a.frequency || a.name.localeCompare(b.name));
  const X = rows.reduce((s, r) => s + r.mutated, 0), N = rows.reduce((s, r) => s + r.sequenced, 0);
  return { rows, overall: { mutated: X, sequenced: N, frequency: N ? X / N : NaN } };
}

// ---------- GDC: cases with a simple somatic mutation, per project ----------
export async function gdc(ensemblId) {
  const d = await fetchJSON(`https://api.gdc.cancer.gov/analysis/top_cases_counts_by_genes?gene_ids=${encodeURIComponent(ensemblId)}`);
  return { ...gdcCounts(d, ensemblId), url: `https://portal.gdc.cancer.gov/genes/${ensemblId}` };
}
export function gdcCounts(d, ensemblId) {
  const rows = (d.aggregations?.projects?.buckets || []).map(b => ({ project: b.key, cases: b.genes?.my_genes?.gene_id?.buckets?.find(g => g.key === ensemblId)?.doc_count ?? 0 }))
    .filter(r => r.cases > 0).sort((a, b) => b.cases - a.cases || a.project.localeCompare(b.project));
  return { rows, totalCases: rows.reduce((s, r) => s + r.cases, 0) };
}

// ---------- ClinicalTrials.gov and Europe PMC ----------
export async function recruitingTrials(symbol) {
  // the gene must appear where trials state biomarkers: title, summary, keywords, interventions or eligibility
  const term = ['OfficialTitle', 'BriefSummary', 'Keyword', 'InterventionName', 'EligibilityCriteria'].map(a => `AREA[${a}]${symbol}`).join(' OR ');
  const p = new URLSearchParams({ 'query.term': term, 'query.cond': 'cancer OR neoplasm OR tumor OR carcinoma OR lymphoma OR leukemia', 'filter.overallStatus': 'RECRUITING', pageSize: '30', countTotal: 'true', format: 'json' });
  const d = await fetchJSON(`https://clinicaltrials.gov/api/v2/studies?${p}`);
  return { total: d.totalCount ?? 0, url: `https://clinicaltrials.gov/search?term=${encodeURIComponent(symbol)}&cond=cancer&aggFilters=status:rec`, rows: rankTrials(d.studies || [], symbol).slice(0, 15) };
}
/** Trials naming the gene in their title first, then in their summary; then by enrolment. */
export function rankTrials(studies, symbol) {
  const re = new RegExp(`(^|[^A-Za-z0-9])${symbol}([^A-Za-z0-9]|$)`, 'i');
  return studies.map(s => { const m = s.protocolSection || {}; const title = m.identificationModule?.briefTitle || '';
    return { nct: m.identificationModule?.nctId, title, phases: (m.designModule?.phases || []).join('/'), conditions: (m.conditionsModule?.conditions || []).slice(0, 3), sponsor: m.sponsorCollaboratorsModule?.leadSponsor?.name || '',
      rank: re.test(title) ? 0 : re.test(m.descriptionModule?.briefSummary || '') ? 1 : 2, enrollment: m.designModule?.enrollmentInfo?.count || 0, where: re.test(title) ? 'title' : re.test(m.descriptionModule?.briefSummary || '') ? 'summary' : 'eligibility or keywords' }; })
    .sort((a, b) => a.rank - b.rank || b.enrollment - a.enrollment).map(({ rank, ...r }) => r);
}
export async function literature(symbol) {
  const q = `(TITLE:"${symbol}" OR ABSTRACT:"${symbol}") AND (cancer OR tumor OR tumour OR carcinoma OR neoplasm) AND PUB_YEAR:[${new Date().getFullYear() - 4} TO ${new Date().getFullYear()}]`;
  const d = await fetchJSON(`https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(q)}&format=json&pageSize=5&sort=CITED%20desc&resultType=lite`);
  return { query: q, total: d.hitCount ?? 0, url: `https://europepmc.org/search?query=${encodeURIComponent(q)}`,
    rows: (d.resultList?.result || []).map(r => ({ title: r.title, journal: r.journalTitle, year: r.pubYear, cited: r.citedByCount, pmid: r.pmid, url: r.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${r.pmid}/` : `https://europepmc.org/article/${r.source}/${r.id}` })) };
}

/** Build a dossier; each section settles independently so one failing source does not hide the others. */
export async function geneDossier(symbol, onSection = () => {}) {
  if (!isGeneSymbol(symbol)) throw Error('Enter an HGNC gene symbol, e.g. KRAS, EGFR or BRCA1.');
  const sym = symbol.toUpperCase(), started = new Date().toISOString(), out = { symbol: sym, retrievedAt: started, sections: {}, errors: {} };
  const run = async (key, p) => { try { out.sections[key] = await p; } catch (e) { out.errors[key] = e.message || String(e); } onSection(key, out); };
  const ot = run('opentargets', openTargets(sym));
  await Promise.all([ot, run('civic', civic(sym)), run('cbioportal', cbioportal(sym)), run('trials', recruitingTrials(sym)), run('literature', literature(sym))]);
  if (out.sections.opentargets) await run('gdc', gdc(out.sections.opentargets.ensemblId));
  else out.errors.gdc = 'needs the Ensembl gene ID from Open Targets';
  return out;
}
