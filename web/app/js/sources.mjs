// Cerebro OS — federated connectors for literature, trials and datasets.
// Every connector normalizes to one record shape and reports failures per source,
// so a single outage never hides results from the others.

const TIMEOUT = 20000;
const sleep = ms => new Promise(r => setTimeout(r, ms));
/** Fetch JSON with a timeout and polite retry on 429/503 (honours Retry-After up to 5 s). */
async function getJSON(url, init = {}, attempts = 3) {
  for (let i = 0; ; i++) {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT), ...init });
    if (res.ok) return res.json();
    if ((res.status === 429 || res.status === 503) && i < attempts - 1) { await sleep(Math.min(5000, (Number(res.headers.get('retry-after')) || 0) * 1000 || 800 * 2 ** i)); continue; }
    throw Error(res.status === 429 ? 'Rate limited by the source — try again shortly' : `HTTP ${res.status}`);
  }
}
/** Optional NCBI API key (raises PubMed limit from 3 to 10 requests/second). */
let ncbiKey = '';
export const setNcbiKey = k => { ncbiKey = /^[a-f0-9]{30,40}$/i.test(k || '') ? k : ''; };
export const normTitle = t => String(t || '').toLowerCase().replace(/<[^>]+>/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const stripTags = s => String(s || '').replace(/<[^>]+>/g, '');

/** Record: { key, title, authors, year, journal, doi, pmid, pmcid, source, sources[], open, url, type, citedBy, extra } */

export const SOURCES = {
  europepmc: { label: 'Europe PMC', kind: 'literature' },
  pubmed: { label: 'PubMed', kind: 'literature' },
  ctgov: { label: 'ClinicalTrials.gov', kind: 'trials' },
};

// ---------- Europe PMC ----------
export async function searchEuropePMC(q, { since, openOnly, sort, page = 0, cursor = '*', pageSize = 25 } = {}) {
  let query = `(${q})`;
  if (since) query += ` AND FIRST_PDATE:[${since}-01-01 TO 3000-12-31]`;
  if (openOnly) query += ' AND OPEN_ACCESS:Y';
  if (sort === 'date') query += ' sort_date:y';
  const data = await getJSON(`https://www.ebi.ac.uk/europepmc/webservices/rest/search?format=json&resultType=lite&pageSize=${pageSize}&cursorMark=${encodeURIComponent(cursor)}&query=${encodeURIComponent(query)}`);
  const records = (data.resultList?.result || []).map(p => ({
    key: `${p.source}:${p.id}`, title: stripTags(p.title), authors: p.authorString, year: p.pubYear, journal: p.journalTitle || p.bookOrReportDetails?.publisher,
    doi: p.doi?.toLowerCase(), pmid: p.pmid, pmcid: p.pmcid, source: 'Europe PMC', sources: ['Europe PMC'], open: p.isOpenAccess === 'Y',
    url: `https://europepmc.org/article/${encodeURIComponent(p.source)}/${encodeURIComponent(p.id)}`, type: p.source === 'PPR' ? 'preprint' : 'article', citedBy: p.citedByCount ?? null,
    extra: { epmcSource: p.source, epmcId: p.id, pubType: p.pubType },
  }));
  return { total: Number(data.hitCount || 0), records, next: data.nextCursorMark && data.nextCursorMark !== cursor ? data.nextCursorMark : null, link: `https://europepmc.org/search?query=${encodeURIComponent(query)}` };
}

// ---------- PubMed (NCBI E-utilities) ----------
export async function searchPubMed(q, { since, openOnly, sort, start = 0, pageSize = 25 } = {}) {
  let term = `(${q})`;
  if (since) term += ` AND ("${since}"[dp] : "3000"[dp])`;
  if (openOnly) term += ' AND free full text[sb]';
  const base = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/', tool = `&tool=cerebro-os${ncbiKey ? '&api_key=' + ncbiKey : ''}`;
  const s = await getJSON(`${base}esearch.fcgi?db=pubmed&retmode=json&retmax=${pageSize}&retstart=${start}&sort=${sort === 'date' ? 'pub_date' : 'relevance'}&term=${encodeURIComponent(term)}${tool}`);
  const ids = s.esearchresult?.idlist || [], total = Number(s.esearchresult?.count || 0);
  if (!ids.length) return { total, records: [], next: null, link: `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(term)}` };
  const sum = await getJSON(`${base}esummary.fcgi?db=pubmed&retmode=json&id=${ids.join(',')}${tool}`);
  const records = ids.map(id => sum.result?.[id]).filter(Boolean).map(r => {
    const ids2 = Object.fromEntries((r.articleids || []).map(a => [a.idtype, a.value]));
    return { key: `MED:${r.uid}`, title: stripTags(r.title), authors: (r.authors || []).map(a => a.name).join(', '), year: (r.pubdate || '').slice(0, 4), journal: r.fulljournalname || r.source,
      doi: ids2.doi?.toLowerCase(), pmid: r.uid, pmcid: ids2.pmc, source: 'PubMed', sources: ['PubMed'], open: Boolean(ids2.pmc), url: `https://pubmed.ncbi.nlm.nih.gov/${r.uid}/`, type: (r.pubtype || []).includes('Preprint') ? 'preprint' : 'article', citedBy: null,
      extra: { pubTypes: r.pubtype } };
  });
  return { total, records, next: start + pageSize < total ? start + pageSize : null, link: `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(term)}` };
}

// ---------- ClinicalTrials.gov v2 ----------
export async function searchTrials(q, { since, sort, token = null, pageSize = 20 } = {}) {
  const params = new URLSearchParams({ 'query.term': q, pageSize: String(pageSize), countTotal: 'true', format: 'json' });
  if (since) params.set('filter.advanced', `AREA[StartDate]RANGE[${since}-01-01,MAX]`);
  if (sort === 'date') params.set('sort', 'LastUpdatePostDate:desc');
  if (token) params.set('pageToken', token);
  const data = await getJSON(`https://clinicaltrials.gov/api/v2/studies?${params}`);
  const records = (data.studies || []).map(s => {
    const p = s.protocolSection || {}, id = p.identificationModule?.nctId;
    return { key: `NCT:${id}`, title: p.identificationModule?.briefTitle, authors: p.sponsorCollaboratorsModule?.leadSponsor?.name, year: (p.statusModule?.startDateStruct?.date || '').slice(0, 4),
      journal: `${p.designModule?.studyType || 'Study'}${p.designModule?.phases?.length ? ' · ' + p.designModule.phases.join('/') : ''} · ${(p.statusModule?.overallStatus || '').replace(/_/g, ' ').toLowerCase()}`,
      doi: null, pmid: null, source: 'ClinicalTrials.gov', sources: ['ClinicalTrials.gov'], open: true, url: `https://clinicaltrials.gov/study/${id}`, type: 'trial', citedBy: null,
      abstract: p.descriptionModule?.briefSummary, extra: { nct: id, conditions: p.conditionsModule?.conditions || [], status: p.statusModule?.overallStatus, enrollment: p.designModule?.enrollmentInfo?.count } };
  });
  return { total: Number(data.totalCount ?? records.length), records, next: data.nextPageToken || null, link: `https://clinicaltrials.gov/search?term=${encodeURIComponent(q)}` };
}

/** Merge records across sources: DOI → PMID → normalized title. Returns { records, duplicates }. */
export function dedupe(records) {
  const out = [], index = new Map();
  let duplicates = 0;
  for (const r of records) {
    const keys = [r.doi && `doi:${r.doi}`, r.pmid && `pmid:${r.pmid}`, r.type !== 'trial' && normTitle(r.title).length > 20 && `t:${normTitle(r.title)}`].filter(Boolean);
    const hit = keys.map(k => index.get(k)).find(x => x !== undefined);
    if (hit !== undefined) {
      const m = out[hit];
      duplicates++;
      m.sources = [...new Set([...m.sources, ...r.sources])];
      m.doi ||= r.doi; m.pmid ||= r.pmid; m.pmcid ||= r.pmcid; m.open ||= r.open; m.citedBy ??= r.citedBy; m.abstract ||= r.abstract;
      keys.forEach(k => index.set(k, hit));
    } else { keys.forEach(k => index.set(k, out.length)); out.push({ ...r }); }
  }
  return { records: out, duplicates };
}

/** Run a federated search across the selected sources. */
export async function federatedSearch(q, opts, selected = ['europepmc', 'pubmed', 'ctgov']) {
  const runners = { europepmc: () => searchEuropePMC(q, opts), pubmed: () => searchPubMed(q, opts), ctgov: () => searchTrials(q, opts) };
  const settled = await Promise.allSettled(selected.map(s => runners[s]()));
  const perSource = {}, all = [];
  settled.forEach((r, i) => {
    const s = selected[i];
    if (r.status === 'fulfilled') { perSource[s] = { ok: true, total: r.value.total, returned: r.value.records.length, next: r.value.next, link: r.value.link }; all.push(...r.value.records); }
    else perSource[s] = { ok: false, error: r.reason?.message || 'Unavailable' };
  });
  // interleave so one source does not dominate the top of the list
  const lists = selected.map(s => all.filter(r => r.sources[0] === SOURCES[s].label)), mixed = [];
  for (let i = 0; i < Math.max(0, ...lists.map(l => l.length)); i++) lists.forEach(l => l[i] && mixed.push(l[i]));
  const { records, duplicates } = dedupe(mixed);
  return { records, duplicates, perSource, query: q, opts, at: new Date().toISOString() };
}

/** Fetch an abstract on demand. */
export async function fetchAbstract(rec) {
  if (rec.abstract) return rec.abstract;
  if (rec.extra?.epmcId || rec.pmid) {
    const q = rec.extra?.epmcId ? `EXT_ID:${rec.extra.epmcId} AND SRC:${rec.extra.epmcSource}` : `EXT_ID:${rec.pmid} AND SRC:MED`;
    try {
      const d = await getJSON(`https://www.ebi.ac.uk/europepmc/webservices/rest/search?format=json&resultType=core&pageSize=1&query=${encodeURIComponent(q)}`);
      const a = d.resultList?.result?.[0]?.abstractText;
      if (a) return stripTags(a);
    } catch { /* try PubMed */ }
  }
  if (rec.pmid) {
    const res = await fetch(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&rettype=abstract&retmode=text&id=${rec.pmid}&tool=cerebro-os`, { signal: AbortSignal.timeout(TIMEOUT) });
    if (res.ok) return (await res.text()).trim();
  }
  return null;
}

// ---------- datasets ----------
export async function searchDANDI(q) {
  const d = await getJSON(`https://api.dandiarchive.org/api/dandisets/?search=${encodeURIComponent(q)}&page_size=20&ordering=-modified`);
  return { total: d.count, records: (d.results || []).map(x => { const v = x.most_recent_published_version || x.draft_version || {}; return { id: `DANDI:${x.identifier}`, repo: 'DANDI', name: v.name || x.identifier, modality: 'Neurophysiology · NWB', version: v.version, size: v.size, files: v.asset_count, updated: x.modified, url: `https://dandiarchive.org/dandiset/${x.identifier}${v.version && v.version !== 'draft' ? '/' + v.version : ''}` }; }) };
}
export async function searchOpenNeuro(q) {
  const body = { query: 'query($q: DatasetSearchInput!){ advancedSearch(query:$q, first: 20){ edges { node { id latestSnapshot { tag created description { Name } summary { modalities subjects totalFiles size } } } } } }', variables: { q: { keywords: q.split(/\s+/).filter(Boolean), publicOnly: true } } };
  const d = await getJSON('https://openneuro.org/crn/graphql', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const edges = (d.data?.advancedSearch?.edges || []).filter(e => e?.node?.latestSnapshot);
  return { total: edges.length, records: edges.map(({ node: n }) => { const s = n.latestSnapshot; return { id: `OpenNeuro:${n.id}`, repo: 'OpenNeuro', name: s.description?.Name || n.id, modality: (s.summary?.modalities || []).join(', ').toUpperCase() || 'BIDS', version: s.tag, subjects: s.summary?.subjects?.length, size: s.summary?.size, files: s.summary?.totalFiles, updated: s.created, url: `https://openneuro.org/datasets/${n.id}/versions/${s.tag}` }; }) };
}

// ---------- citation export ----------
const bibKey = r => `${(r.authors || 'anon').split(/[ ,]/)[0].replace(/[^A-Za-z]/g, '') || 'ref'}${r.year || ''}${normTitle(r.title).split(' ')[0] || ''}`;
const bibEsc = s => String(s || '').replace(/[{}]/g, '');
export function toBibTeX(records) {
  return records.map(r => `@${r.type === 'trial' ? 'misc' : 'article'}{${bibKey(r)},\n  title = {${bibEsc(r.title)}},\n  author = {${bibEsc((r.authors || '').split(/,\s*/).join(' and '))}},\n  year = {${r.year || ''}},\n  journal = {${bibEsc(r.journal)}},${r.doi ? `\n  doi = {${r.doi}},` : ''}${r.pmid ? `\n  pmid = {${r.pmid}},` : ''}\n  url = {${r.url}}\n}`).join('\n\n');
}
export function toRIS(records) {
  return records.map(r => [`TY  - ${r.type === 'trial' ? 'GEN' : 'JOUR'}`, `TI  - ${r.title}`, ...(r.authors || '').split(/,\s*/).filter(Boolean).map(a => `AU  - ${a}`), `PY  - ${r.year || ''}`, `JO  - ${r.journal || ''}`, r.doi && `DO  - ${r.doi}`, r.pmid && `AN  - PMID:${r.pmid}`, `UR  - ${r.url}`, 'ER  - '].filter(Boolean).join('\n')).join('\n\n');
}
