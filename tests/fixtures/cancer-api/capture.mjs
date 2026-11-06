// Records trimmed public-API responses for KRAS used by tests/cancer.test.mjs (run with Node ≥ 20):
//   node tests/fixtures/cancer-api/capture.mjs
// Only fields the connectors read are kept. Sources: Open Targets (CC0), CIViC (CC0), cBioPortal, GDC, ClinicalTrials.gov.
import { writeFileSync } from 'node:fs';
const post = (u, b) => fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then(r => r.json());
const get = u => fetch(u).then(r => r.json());
const out = { capturedAt: new Date().toISOString(), symbol: 'KRAS' };
const ot = await post('https://api.platform.opentargets.org/api/v4/graphql', { query: `{ target(ensemblId:"ENSG00000133703"){ id approvedSymbol approvedName biotype functionDescriptions tractability{ label modality value }
  associatedDiseases(page:{index:0,size:50}){ count rows{ score disease{ id name therapeuticAreas{ name } } } }
  drugAndClinicalCandidates{ count rows{ maxClinicalStage drug{ id name drugType mechanismsOfAction{ rows{ mechanismOfAction } } } diseases{ disease{ id name } } } } } }` });
out.opentargets = ot.data.target;
const cv = await post('https://civicdb.org/api/graphql', { query: `{ evidenceItems(molecularProfileName:"KRAS", status: ACCEPTED, first: 100){ totalCount nodes{ id evidenceLevel evidenceType evidenceDirection significance molecularProfile{ name } therapies{ name } disease{ name } source{ citation sourceType sourceUrl } } } }` });
out.civic = cv.data.evidenceItems;
const studies = await get('https://www.cbioportal.org/api/studies?keyword=tcga_pan_can_atlas_2018&projection=DETAILED&pageSize=100');
out.cbioStudies = studies.map(s => ({ studyId: s.studyId, name: s.name, cancerTypeId: s.cancerTypeId, sequencedSampleCount: s.sequencedSampleCount }));
const muts = await post('https://www.cbioportal.org/api/mutations/fetch?projection=ID', { entrezGeneIds: [3845], molecularProfileIds: studies.map(s => `${s.studyId}_mutations`) });
out.cbioMutations = muts.map(m => ({ studyId: m.studyId, uniqueSampleKey: m.uniqueSampleKey }));
out.gdc = await get('https://api.gdc.cancer.gov/analysis/top_cases_counts_by_genes?gene_ids=ENSG00000133703');
writeFileSync(new URL('./kras.json', import.meta.url), JSON.stringify(out));
console.log('wrote kras.json', out.cbioMutations.length, 'mutations');
