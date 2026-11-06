// Cancer data connectors (docs/ONCOLOGY.md §1): offline tests of the pure transformations on
// recorded KRAS responses (tests/fixtures/cancer-api/kras.json, from capture.mjs) and on
// hand-built edge cases. No network access.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { summarizeOpenTargets, summarizeCivic, mutationFrequency, gdcCounts, rankTrials, isGeneSymbol } from '../web/app/js/cancer-sources.mjs';
import { binomialCI } from '../web/lib/oncology.mjs';
import { egressDecision } from '../web/app/js/policy.mjs';

const F = JSON.parse(readFileSync(new URL('./fixtures/cancer-api/kras.json', import.meta.url)));

test('mutation frequency counts each sample once, matches an independent recount, and carries exact CIs', () => {
  const r = mutationFrequency(F.cbioStudies, F.cbioMutations), by = Object.fromEntries(r.rows.map(x => [x.studyId, x]));
  // independent recount in Python (tests/fixtures/cancer-api: distinct uniqueSampleKey per study)
  assert.deepEqual([by.paad_tcga_pan_can_atlas_2018.mutated, by.paad_tcga_pan_can_atlas_2018.sequenced], [117, 179]);
  assert.deepEqual([by.coadread_tcga_pan_can_atlas_2018.mutated, by.luad_tcga_pan_can_atlas_2018.mutated], [218, 168]);
  assert.deepEqual([r.overall.mutated, r.overall.sequenced], [763, 10443]);
  assert.ok(F.cbioMutations.length > r.overall.mutated, 'some samples carry more than one KRAS mutation');
  const ci = binomialCI(117, 179);
  assert.equal(by.paad_tcga_pan_can_atlas_2018.lower, ci.lower); assert.equal(by.paad_tcga_pan_can_atlas_2018.upper, ci.upper);
  r.rows.slice(1).forEach((x, i) => assert.ok(x.frequency <= r.rows[i].frequency));
  const edge = mutationFrequency([{ studyId: 'a', name: 'A (TCGA, PanCancer Atlas)', sequencedSampleCount: 4 }, { studyId: 'b', name: 'B', sequencedSampleCount: 0 }],
    [{ studyId: 'a', uniqueSampleKey: 's1' }, { studyId: 'a', uniqueSampleKey: 's1' }, { studyId: 'a', uniqueSampleKey: 's2' }]);
  assert.deepEqual(edge.rows.map(x => [x.name, x.mutated, x.sequenced]), [['A', 2, 4]]);
});

test('Open Targets summary drops null records, orders drugs by stage, filters cancers and strips evidence codes', () => {
  const t = summarizeOpenTargets(F.opentargets);
  assert.equal(t.symbol, 'KRAS'); assert.equal(t.ensemblId, 'ENSG00000133703');
  assert.doesNotMatch(t.function, /\{ECO:/);
  assert.ok(t.drugs.rows.length >= 1 && t.drugs.rows.every(d => d.name && d.diseases.every(Boolean)));
  assert.equal(t.drugs.rows[0].stage, 'APPROVAL');
  assert.ok(t.associations.cancer.length > 0 && t.associations.cancer.length <= 15);
  const synthetic = summarizeOpenTargets({ id: 'X', approvedSymbol: 'X', approvedName: 'x', biotype: 'protein_coding', functionDescriptions: ['Does a thing {ECO:0000269|PubMed:1}.'], tractability: [],
    associatedDiseases: { count: 2, rows: [{ score: 0.5, disease: { id: 'd1', name: 'lung cancer', therapeuticAreas: [{ name: 'cancer or benign tumor' }] } }, { score: 0.4, disease: null }] },
    drugAndClinicalCandidates: { count: 3, rows: [{ maxClinicalStage: 'PHASE_2', drug: { id: 'c2', name: 'B', mechanismsOfAction: { rows: [] } }, diseases: [{ disease: null }] }, { maxClinicalStage: 'APPROVAL', drug: { id: 'c1', name: 'A', mechanismsOfAction: { rows: [{ mechanismOfAction: 'X inhibitor' }] } }, diseases: [] }, { maxClinicalStage: 'APPROVAL', drug: null, diseases: [] }] } });
  assert.equal(synthetic.function, 'Does a thing.');
  assert.deepEqual(synthetic.drugs.rows.map(d => d.name), ['A', 'B']);
  assert.deepEqual(synthetic.associations.cancer.map(a => a.name), ['lung cancer']);
});

test('CIViC summary keeps the gene as a whole word, counts by level and type, most actionable first', () => {
  const c = summarizeCivic(F.civic.nodes, 'KRAS');
  assert.ok(c.items.every(x => /(^|[^A-Za-z0-9])KRAS([^A-Za-z0-9]|$)/i.test(x.profile)));
  assert.equal(Object.values(c.byLevel).reduce((a, b) => a + b, 0), c.items.length);
  c.items.slice(1).forEach((x, i) => assert.ok(x.level >= c.items[i].level));
  const mk = (id, level, profile) => ({ id, evidenceLevel: level, evidenceType: 'PREDICTIVE', molecularProfile: { name: profile }, therapies: [], disease: { name: 'd' }, source: {} });
  const s = summarizeCivic([mk(3, 'B', 'KRAS G12C'), mk(1, 'A', 'BRAF V600E'), mk(2, 'A', 'NRAS Q61 OR KRAS G12'), mk(4, 'C', 'KRASP1 Amplification')], 'KRAS');
  assert.deepEqual(s.items.map(x => x.id), [2, 3]);
});

test('GDC counts read the per-project bucket for the requested gene only', () => {
  const g = gdcCounts(F.gdc, 'ENSG00000133703');
  assert.ok(g.rows.length > 10 && g.rows.every(r => r.cases > 0));
  assert.equal(g.totalCases, g.rows.reduce((s, r) => s + r.cases, 0));
  const other = gdcCounts(F.gdc, 'ENSG00000000000');
  assert.equal(other.rows.length, 0);
});

test('trials naming the gene in the title rank first', () => {
  const st = (id, title, summary, n) => ({ protocolSection: { identificationModule: { nctId: id, briefTitle: title }, descriptionModule: { briefSummary: summary }, designModule: { phases: ['PHASE2'], enrollmentInfo: { count: n } } } });
  const r = rankTrials([st('N1', 'Nivolumab in skin cancer', 'no gene', 900), st('N2', 'Sotorasib for KRAS G12C', '', 50), st('N3', 'Lung study', 'KRAS-mutant patients', 100)], 'KRAS');
  assert.deepEqual(r.map(x => x.nct), ['N2', 'N3', 'N1']);
  assert.deepEqual(r.map(x => x.where), ['title', 'summary', 'eligibility or keywords']);
});

test('gene symbols are validated before they reach any query; every connector host is on the allowlist', () => {
  for (const ok of ['KRAS', 'ERBB2', 'HLA-A', 'C1orf112']) assert.ok(isGeneSymbol(ok), ok);
  for (const bad of ['', 'KRAS OR 1=1', 'a"b', 'x}{', 'BRCA1/2', '../etc', 'A'.repeat(21)]) assert.equal(isGeneSymbol(bad), false, bad);
  for (const u of ['https://api.platform.opentargets.org/api/v4/graphql', 'https://civicdb.org/api/graphql', 'https://www.cbioportal.org/api/genes/KRAS', 'https://api.gdc.cancer.gov/analysis/top_cases_counts_by_genes'])
    assert.equal(egressDecision(u, 'https://cerebro-os.example').allowed, true, u);
});
