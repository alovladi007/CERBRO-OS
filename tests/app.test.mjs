// App-layer logic that runs without a DOM: de-duplication, citation export,
// workspace migration from AXON v0.1, and the runtime egress guard.
import test from 'node:test';
import assert from 'node:assert/strict';
import { dedupe, toBibTeX, toRIS, normTitle } from '../web/app/js/sources.mjs';
import { normalize, SCHEMA } from '../web/app/js/store.mjs';
import { installGuard, blockedRequests } from '../web/app/js/guard.mjs';

const rec = (o) => ({ key: o.key, title: o.title, authors: 'Doe J, Roe K', year: '2024', journal: 'J Neuro', doi: o.doi, pmid: o.pmid, sources: [o.src], open: !!o.open, url: 'https://example.org/' + o.key, type: 'article', ...o.extra });

test('dedupe merges by DOI, then PMID, then normalized title', () => {
  const { records, duplicates } = dedupe([
    rec({ key: 'MED:1', title: 'Tau PET and decline', doi: '10.1/x', pmid: '1', src: 'Europe PMC' }),
    rec({ key: 'PM:1', title: 'Tau PET and decline.', doi: '10.1/x', src: 'PubMed', open: true }),
    rec({ key: 'PM:2', title: 'Other study', pmid: '2', src: 'PubMed' }),
    rec({ key: 'E:2', title: 'Other study (preprint)', pmid: '2', src: 'Europe PMC' }),
    rec({ key: 'E:3', title: 'A sufficiently long identical title here', src: 'Europe PMC' }),
    rec({ key: 'P:3', title: 'A Sufficiently Long Identical Title, Here!', src: 'PubMed' }),
  ]);
  assert.equal(records.length, 3);
  assert.equal(duplicates, 3);
  assert.deepEqual(records[0].sources, ['Europe PMC', 'PubMed']);
  assert.equal(records[0].open, true);
  assert.equal(normTitle('<i>Hello</i>, World!'), 'hello world');
});

test('BibTeX and RIS exports contain identifiers', () => {
  const r = [rec({ key: 'k', title: 'A {braced} title', doi: '10.9/abc', pmid: '42', src: 'PubMed' })];
  const bib = toBibTeX(r);
  assert.match(bib, /@article\{Doe2024a,/);
  assert.match(bib, /doi = \{10\.9\/abc\}/);
  assert.ok(!bib.includes('{braced}'), 'braces are escaped');
  const ris = toRIS(r);
  assert.match(ris, /^TY {2}- JOUR/);
  assert.match(ris, /AU {2}- Doe J\nAU {2}- Roe K/);
  assert.match(ris, /DO {2}- 10\.9\/abc/);
});

test('AXON v0.1 workspaces migrate into a Cerebro project', () => {
  const axon = { schema: 'axon-workspace-v1', papers: [{ key: 'MED:1', title: 'T', url: 'https://europepmc.org/article/MED/1', source: 'MED' }, { key: 'bad', title: 'x', url: 'javascript:alert(1)' }], protocols: [{ id: 'p1', title: 'Protocol' }], runs: [{ tool: 'meta-analysis', at: '2026-01-01', methodVersion: 'axon-0.1' }] };
  const ws = normalize(axon);
  assert.equal(ws.schema, SCHEMA);
  assert.equal(ws.projects.length, 1);
  assert.equal(ws.projects[0].papers.length, 1, 'non-https URLs are dropped');
  assert.equal(ws.projects[0].protocols.length, 1);
  assert.equal(ws.projects[0].runs.length, 1);
  assert.throws(() => normalize({ hello: 'world' }));
  assert.throws(() => normalize({ schema: SCHEMA, projects: [{ id: 'a', name: 'A', papers: [{ key: 'k', title: 't', url: 'http://insecure' }] }] }));
  const round = normalize(JSON.parse(JSON.stringify(ws)));
  assert.equal(round.activeProjectId, ws.activeProjectId);
});

test('runtime guard refuses OpenAI and off-allowlist hosts, allows research APIs', async () => {
  const calls = [];
  const scope = { location: { origin: 'https://cerebro.example' }, fetch: async (u) => { calls.push(String(u)); return { ok: true }; }, top: null, self: null };
  scope.top = scope.self = scope;
  installGuard(scope);
  await assert.rejects(scope.fetch('https://api.openai.com/v1/chat/completions'), /OpenAI/);
  await assert.rejects(scope.fetch('https://chatgpt.com/backend-api'), /OpenAI/);
  await assert.rejects(scope.fetch('https://tracker.example.com/pixel'), /allowlist/);
  await scope.fetch('https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=x');
  await scope.fetch('/api/policy');
  assert.deepEqual(calls, ['https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=x', '/api/policy']);
  assert.ok(blockedRequests().length >= 3);
});
