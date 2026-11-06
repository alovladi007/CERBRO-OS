import { $, $$, esc, icon, pageHead, notice, table, fmt, metric, logRun, download, empty } from '../ui.mjs';
import { geneDossier, CANCER_SOURCES, isGeneSymbol } from '../cancer-sources.mjs';

const ui = { last: null, allAssoc: false, civicType: 'ALL' };
const pct = v => (Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : '—');
const stage = s => String(s || '').replace(/_/g, ' ').toLowerCase().replace('phase ', 'phase ').replace(/^./, c => c.toUpperCase());
const link = (href, text) => `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(text)}</a>`;
const bar = (v, max) => `<span class="ibar" style="width:${Math.max(0, Math.min(100, (v / (max || 1)) * 100)).toFixed(0)}%"></span>`;
const EXAMPLES = ['KRAS', 'EGFR', 'BRAF', 'TP53', 'ERBB2', 'IDH1', 'BRCA2', 'ALK'];

function sourceLine(key, extra = '') {
  const s = CANCER_SOURCES[key];
  return `<p class="method-note">Source: ${link(s.url, s.label)}${extra}. ${esc(s.licence)}</p>`;
}
const WIDE = new Set(['freq', 'civic', 'trials']);
function section(id, title, key) { return `<section class="card${WIDE.has(id) ? ' wide' : ''}" id="sec-${id}"><h2>${title}</h2><div class="sec-body"><div class="loading">Fetching from ${esc(CANCER_SOURCES[key].label)}…</div></div></section>`; }
function setSection(id, html) { const el = $(`#sec-${id} .sec-body`); if (el) el.innerHTML = html; }

const renderers = {
  opentargets(t) {
    const assoc = ui.allAssoc ? t.associations.top : t.associations.cancer, mx = Math.max(...assoc.map(a => a.score), 0.01);
    setSection('target', `<div class="eyebrow">${esc(t.ensemblId)} · ${esc(t.biotype)}</div><h3 style="margin-top:4px">${esc(t.symbol)} — ${esc(t.name)}</h3><p>${esc(t.function)}</p>
      ${t.tractability.length ? `<div class="chips">${t.tractability.slice(0, 8).map(x => `<span class="chip">${esc(x)}</span>`).join('')}</div>` : ''}
      <p class="small">${link(t.url, 'Open Targets')} · ${link(`https://portal.gdc.cancer.gov/genes/${t.ensemblId}`, 'GDC')} · ${link(`https://www.ncbi.nlm.nih.gov/gene/?term=${t.symbol}%5Bsym%5D+AND+human%5Borgn%5D`, 'NCBI Gene')}</p>` + sourceLine('opentargets'));
    setSection('drugs', (t.drugs.rows.length ? table(['Drug', 'Highest stage', 'Mechanism', 'Indications (Open Targets)'], t.drugs.rows.slice(0, 25).map(d => [link(`https://platform.opentargets.org/drug/${d.id}`, d.name.charAt(0) + d.name.slice(1).toLowerCase()), stage(d.stage), esc(d.mechanisms.join('; ')), esc(d.diseases.slice(0, 5).join(', ') + (d.diseases.length > 5 ? ` and ${d.diseases.length - 5} more` : ''))]))
      : `<p class="muted">No approved drugs or clinical candidates act on ${esc(t.symbol)} itself in Open Targets. Drugs may still target its pathway or partners.</p>`) + sourceLine('opentargets', ` (${t.drugs.total} drug–target records)`));
    setSection('assoc', `<div class="chips"><button class="chip ${ui.allAssoc ? '' : 'on'}" data-assoc="cancer">Cancers</button><button class="chip ${ui.allAssoc ? 'on' : ''}" data-assoc="all">All diseases</button></div>`
      + (assoc.length ? table(['Disease', 'Association score', ''], assoc.map(a => [link(`https://platform.opentargets.org/evidence/${t.ensemblId}/${a.id}`, a.name), fmt(a.score), bar(a.score, mx)]), { numeric: [1] }) : '<p class="muted">No associations in this view.</p>')
      + `<p class="muted small">Open Targets association scores (0–1) combine genetic, somatic, drug, literature and animal-model evidence; they rank evidence strength, not effect size. Showing the top ${assoc.length} of ${t.associations.total} associations${ui.allAssoc ? '' : ' (cancer therapeutic areas)'}.</p>` + sourceLine('opentargets'));
    $$('[data-assoc]').forEach(b => b.onclick = () => { ui.allAssoc = b.dataset.assoc === 'all'; renderers.opentargets(t); });
  },
  cbioportal(c, sym) {
    const top = c.rows.slice(0, 20), mx = Math.max(...top.map(r => r.frequency), 0.01);
    setSection('freq', `<div class="metrics">${metric('Samples with a mutation', `${c.overall.mutated.toLocaleString()} / ${c.overall.sequenced.toLocaleString()}`, pct(c.overall.frequency) + ' across 32 TCGA cancer types')}${metric('Highest frequency', top[0] ? pct(top[0].frequency) : '—', top[0] ? esc(top[0].name) : '')}</div>`
      + table(['Cancer type (TCGA PanCancer Atlas)', 'Mutated / sequenced', 'Frequency', '95% CI', ''], top.map(r => [esc(r.name), `${r.mutated} / ${r.sequenced}`, pct(r.frequency), `${pct(r.lower)}–${pct(r.upper)}`, bar(r.frequency, mx)]), { numeric: [1, 2, 3] })
      + `<p class="muted small">Samples with at least one non-synonymous mutation in ${esc(sym)} as curated by cBioPortal, over samples with mutation data. Exact (Clopper–Pearson) intervals. Copy-number changes and fusions are not counted. ${link(c.url, 'Open this query in cBioPortal')}.</p>` + sourceLine('cbioportal'));
  },
  gdc(g, sym) {
    const top = g.rows.slice(0, 15), mx = Math.max(...top.map(r => r.cases), 1);
    setSection('gdc', (top.length ? table(['GDC project', 'Cases with a mutation', ''], top.map(r => [link(`https://portal.gdc.cancer.gov/projects/${r.project}`, r.project), r.cases.toLocaleString(), bar(r.cases, mx)]), { numeric: [1] }) : '<p class="muted">No cases with simple somatic mutations in this gene.</p>')
      + `<p class="muted small">${g.totalCases.toLocaleString()} cases across ${g.rows.length} projects have a simple somatic mutation in ${esc(sym)} (open-access mutation calls). These are counts, not frequencies: projects differ in size and sequencing. ${link(g.url, 'Open the GDC gene page')}.</p>` + sourceLine('gdc'));
  },
  civic(c, sym) {
    if (!c.gene) { setSection('civic', `<p class="muted">CIViC has no gene record for ${esc(sym)}.</p>` + sourceLine('civic')); return; }
    const types = Object.keys(c.byType).sort(), rows = c.items.filter(x => ui.civicType === 'ALL' || x.type === ui.civicType).slice(0, 40);
    setSection('civic', `<div class="metrics">${['A', 'B', 'C', 'D', 'E'].filter(l => c.byLevel[l]).map(l => metric(`Level ${l}`, c.byLevel[l], { A: 'validated', B: 'clinical', C: 'case study', D: 'preclinical', E: 'inferential' }[l])).join('')}</div>
      <div class="chips">${['ALL', ...types].map(t => `<button class="chip ${ui.civicType === t ? 'on' : ''}" data-civic="${t}">${t === 'ALL' ? 'All types' : esc(t.toLowerCase())} ${t === 'ALL' ? `(${c.shown})` : `(${c.byType[t]})`}</button>`).join('')}</div>`
      + table(['Level', 'Type', 'Molecular profile', 'Disease', 'Therapies', 'Significance', 'Source'], rows.map(x => [x.level, esc(x.type.toLowerCase()), esc(x.profile), esc(x.disease), esc(x.therapies.join(' + ')), esc(String(x.significance || '').toLowerCase().replace(/_/g, ' ')) + (x.direction === 'DOES_NOT_SUPPORT' ? ' (does not support)' : ''), `${link(x.url, `EID${x.id}`)}${x.sourceUrl ? ` · ${link(x.sourceUrl, x.citation)}` : ` · ${esc(x.citation)}`}`]))
      + `<p class="muted small">Accepted evidence items whose molecular profile names ${esc(sym)} (${c.shown} shown of ${c.total} matching the name search). Most actionable first. Research use: CIViC curates published evidence and is not a clinical interpretation of any patient's variant.</p>` + sourceLine('civic'));
    $$('[data-civic]').forEach(b => b.onclick = () => { ui.civicType = b.dataset.civic; renderers.civic(c, sym); });
  },
  trials(t) {
    setSection('trials', (t.rows.length ? table(['Trial', 'Phase', 'Conditions', 'Gene named in', 'Sponsor'], t.rows.map(r => [link(`https://clinicaltrials.gov/study/${r.nct}`, `${r.nct}: ${r.title}`), esc(r.phases.replace(/PHASE/g, '').replace(/^\s*$/, '—')), esc(r.conditions.join('; ')), esc(r.where), esc(r.sponsor)])) : '<p class="muted">No recruiting cancer trials name this gene.</p>')
      + `<p class="muted small">${t.total.toLocaleString()} recruiting cancer trials name the gene in their title, summary, keywords, interventions or eligibility criteria; ${t.rows.length} shown, title matches first. Eligibility depends on the full criteria. ${link(t.url, 'Search ClinicalTrials.gov')}.</p>` + sourceLine('ctgov'));
  },
  literature(l) {
    setSection('lit', `<div class="metrics">${metric('Cancer papers, last 5 years', l.total.toLocaleString(), 'gene in title or abstract')}</div>` + (l.rows.length ? `<ol class="small">${l.rows.map(r => `<li>${link(r.url, r.title.replace(/<[^>]+>/g, ''))} <span class="muted">${esc(r.journal || '')} ${esc(r.year || '')} · cited ${r.cited ?? 0}</span></li>`).join('')}</ol>` : '')
      + `<p class="muted small">Most-cited first. ${link(l.url, 'Run this search in Europe PMC')}, or open it in Evidence search to screen it.</p>` + sourceLine('europepmc'));
  },
};
// half-width cards are paired; wide cards take a full row
const SECTIONS = [['target', 'Target', 'opentargets'], ['drugs', 'Drugs and clinical candidates', 'opentargets'], ['freq', 'Mutation frequency across cancers', 'cbioportal'], ['civic', 'Clinical variant evidence', 'civic'],
  ['assoc', 'Disease associations', 'opentargets'], ['gdc', 'Cases with mutations in GDC projects', 'gdc'], ['trials', 'Recruiting cancer trials', 'ctgov'], ['lit', 'Literature', 'europepmc']];
const SECTION_OF = { opentargets: ['target', 'drugs', 'assoc'], cbioportal: ['freq'], civic: ['civic'], trials: ['trials'], literature: ['lit'], gdc: ['gdc'] };

function markdown(d) {
  const s = d.sections, t = s.opentargets, lines = [`# ${d.symbol} gene dossier`, '', `Retrieved ${d.retrievedAt} by Cerebro OS from public sources. Research use only.`, ''];
  if (t) lines.push(`## Target`, `${t.symbol} (${t.name}; ${t.ensemblId}, ${t.biotype}). ${t.function}`, '');
  if (s.cbioportal) lines.push('## Mutation frequency (TCGA PanCancer Atlas, cBioPortal)', `Overall ${s.cbioportal.overall.mutated}/${s.cbioportal.overall.sequenced} samples (${pct(s.cbioportal.overall.frequency)}).`, '', '| Cancer type | Mutated / sequenced | Frequency (95% CI) |', '|---|---|---|', ...s.cbioportal.rows.slice(0, 15).map(r => `| ${r.name} | ${r.mutated}/${r.sequenced} | ${pct(r.frequency)} (${pct(r.lower)}–${pct(r.upper)}) |`), '');
  if (s.civic?.items?.length) lines.push('## Clinical variant evidence (CIViC, accepted)', ...s.civic.items.filter(x => ['A', 'B'].includes(x.level)).slice(0, 20).map(x => `- Level ${x.level}, ${x.type.toLowerCase()}: ${x.profile}; ${x.disease}${x.therapies.length ? `; ${x.therapies.join(' + ')}` : ''}; ${String(x.significance || '').toLowerCase()} (${x.citation}; ${x.url})`), '');
  if (t?.drugs.rows.length) lines.push('## Drugs and clinical candidates (Open Targets)', ...t.drugs.rows.slice(0, 15).map(r => `- ${r.name}: ${stage(r.stage)}; ${r.mechanisms.join('; ')}`), '');
  if (s.trials?.rows.length) lines.push(`## Recruiting cancer trials (ClinicalTrials.gov; ${s.trials.total} total)`, ...s.trials.rows.map(r => `- ${r.nct}: ${r.title} (${r.phases || 'phase n/a'})`), '');
  if (s.literature) lines.push(`## Literature (Europe PMC)`, `${s.literature.total} cancer papers in the last 5 years mention ${d.symbol} in the title or abstract.`, ...s.literature.rows.map(r => `- ${r.title.replace(/<[^>]+>/g, '')} (${r.journal}, ${r.year}) ${r.url}`), '');
  if (Object.keys(d.errors).length) lines.push('## Sources that failed', ...Object.entries(d.errors).map(([k, v]) => `- ${k}: ${v}`), '');
  lines.push('---', 'Sources: Open Targets Platform (CC0), CIViC (CC0), cBioPortal (TCGA PanCancer Atlas), NCI GDC (open access), ClinicalTrials.gov, Europe PMC. Not a clinical interpretation.');
  return lines.join('\n');
}

export async function render(main) {
  main.innerHTML = pageHead('Gene dossier', 'One gene, every open source.', 'Target biology, mutation frequency across cancers, clinical variant evidence, drugs, recruiting trials and literature, fetched live from public sources by your browser. Every row links back to its source.')
    + notice('Research use only: this summarises published and public data about a gene. It is not an interpretation of any patient’s variant and not a treatment recommendation.')
    + `<form class="card flat inline" id="gene-form" style="margin-bottom:16px"><label class="field" style="margin:0;flex:1;min-width:180px">Gene symbol (HGNC)<input id="gene" autocomplete="off" spellcheck="false" placeholder="e.g. KRAS" value="${esc(ui.last?.symbol || '')}"></label>
      <button class="btn primary" id="go">${icon('dna', 16)} Build dossier</button><div class="chips" style="flex-basis:100%">${EXAMPLES.map(g => `<button type="button" class="chip" data-ex="${g}">${g}</button>`).join('')}</div><div class="error" id="err" role="alert" style="flex-basis:100%"></div></form>
      <div id="dossier">${empty('Enter a gene to begin.', 'Six sources are queried in parallel; each section appears as soon as its source answers.')}</div>`;
  const run = async sym => {
    const err = $('#err'); err.textContent = '';
    if (!isGeneSymbol(sym)) { err.textContent = 'Enter an HGNC gene symbol, e.g. KRAS, EGFR or BRCA1.'; return; }
    ui.civicType = 'ALL';
    const box = $('#dossier'), S = sym.toUpperCase(), btn = $('#go');
    box.innerHTML = `<div class="eyebrow" id="dossier-status">${esc(S)} · fetching live</div><div class="grid2 dossier">${SECTIONS.map(([id, title, key]) => section(id, title, key)).join('')}</div><div class="actions" id="dossier-actions"></div>`;
    btn.disabled = true;
    try {
      const d = await geneDossier(S, (key, partial) => {
        if (partial.sections[key]) renderers[key](partial.sections[key], S);
        else (SECTION_OF[key] || []).forEach(id => setSection(id, notice(`${esc(CANCER_SOURCES[key === 'trials' ? 'ctgov' : key === 'literature' ? 'europepmc' : key].label)} could not be reached: ${esc(partial.errors[key])}.`, 'warn')));
      });
      if (d.errors.gdc && !d.sections.gdc) setSection('gdc', notice(`GDC: ${esc(d.errors.gdc)}.`, 'warn'));
      ui.last = d;
      $('#dossier-status').textContent = `${S} · ${Object.keys(d.sections).length} of 6 sources answered${Object.keys(d.errors).length ? ` · ${Object.keys(d.errors).length} failed` : ''}`;
      const counts = { civicItems: d.sections.civic?.shown ?? null, drugs: d.sections.opentargets?.drugs.total ?? null, trials: d.sections.trials?.total ?? null, papers: d.sections.literature?.total ?? null, mutatedSamples: d.sections.cbioportal?.overall ?? null };
      const runRec = await logRun('gene-dossier', { symbol: S, retrievedAt: d.retrievedAt, sources: Object.keys(d.sections) }, { counts, errors: d.errors });
      $('#dossier-actions').innerHTML = `<button class="btn small" id="dl-md">${icon('download', 14)} Brief (Markdown)</button><button class="btn small" id="dl-json">${icon('download', 14)} Dossier data (JSON)</button><span class="muted small">Retrieved ${esc(new Date(d.retrievedAt).toLocaleString())} · run ${esc(runRec.id.slice(0, 8))}</span>`;
      $('#dl-md').onclick = () => download(`${S}-dossier.md`, markdown(d), 'text/markdown');
      $('#dl-json').onclick = () => download(`${S}-dossier.json`, JSON.stringify(d, null, 2));
    } catch (x) { err.textContent = x.message; }
    finally { btn.disabled = false; }
  };
  $('#gene-form').onsubmit = e => { e.preventDefault(); run($('#gene').value.trim()); };
  $$('[data-ex]').forEach(b => b.onclick = () => { $('#gene').value = b.dataset.ex; run(b.dataset.ex); });
}
