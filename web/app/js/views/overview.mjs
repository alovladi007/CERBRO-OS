import { store } from '../store.mjs';
import { esc, icon, pageHead } from '../ui.mjs';

const TOOLS = [
  ['Evidence search', 'Europe PMC, PubMed and ClinicalTrials.gov in one query, de-duplicated, with saved-search monitoring.', 'evidence'],
  ['Screening & PRISMA 2020', 'Keyboard-driven include/exclude decisions with recorded reasons and a live flow diagram.', 'screening'],
  ['Dataset discovery', 'Live search across OpenNeuro and DANDI with versions, plus a directory of major repositories.', 'datasets'],
  ['Statistics & regression', 't-tests, non-parametric tests, ANOVA, χ², correlation, OLS regression, multiplicity control.', 'lab/stats'],
  ['Signal studio', 'Welch PSD, zero-phase filtering, spectrogram, band power and the aperiodic 1/f exponent.', 'lab/signal'],
  ['Meta-analysis & power', 'REML, Paule–Mandel and DL random effects, Hartung–Knapp, Egger’s test, exact noncentral-t power.', 'lab/meta'],
];

export function render(main) {
  const p = store.project, screened = Object.values(p.screening), included = screened.filter(s => s.decision === 'include').length;
  const lastRun = p.runs[0], lastSearch = p.searches[0];
  main.innerHTML = pageHead('Overview', esc(p.name), '', `<a class="btn primary" href="#evidence">${icon('search', 15)} New search</a><a class="btn" href="#protocols/new">New protocol</a>`)
    + `<div class="lede"><p>From question to reproducible result. Search the literature, screen it transparently, find versioned open data, and run verified analyses — every result recorded with its method and an input fingerprint.</p>
       <p class="small muted" style="font:inherit;font-size:13px">Workspace stored locally in this browser (${esc(store.backend)}). Nothing leaves this device unless you export it.</p></div>`
    + `<div class="stats">
        <a class="stat" href="#library"><span>Saved records</span><strong>${p.papers.length}</strong><small>Literature and trials</small></a>
        <a class="stat" href="#screening"><span>Screened</span><strong>${screened.length}</strong><small>${included} included</small></a>
        <a class="stat" href="#protocols"><span>Protocols</span><strong>${p.protocols.length}</strong><small>Structured drafts</small></a>
        <a class="stat" href="#library/runs"><span>Analysis runs</span><strong>${p.runs.length}</strong><small>With SHA-256 provenance</small></a>
      </div>`
    + `<div class="section-head"><h2>Toolkit</h2><a href="#lab">Open the analysis lab →</a></div>
      <div class="grid3 tools">${TOOLS.map(([h, t, href], i) => `<a class="tool" href="#${href}"><span class="num-label">${String(i + 1).padStart(2, '0')}</span><h3>${h}</h3><p>${t}</p></a>`).join('')}</div>`
    + `<div class="grid2" style="margin-top:36px">
        <section><div class="section-head" style="margin-top:0"><h2>Recent activity</h2></div>
          ${lastSearch ? `<a class="list-row" href="#evidence/${encodeURIComponent(lastSearch.query)}"><div><h3>${esc(lastSearch.query)}</h3><p>Search · ${new Date(lastSearch.lastRun).toLocaleString()} · ${lastSearch.lastCount ?? 0} records</p></div>${icon('external', 15)}</a>` : ''}
          ${lastRun ? `<a class="list-row" href="#library/runs"><div><h3>${esc(lastRun.tool)}</h3><p>Analysis · ${new Date(lastRun.at).toLocaleString()} · <span class="mono">${lastRun.inputSha256?.slice(0, 12) || ''}</span></p></div>${icon('external', 15)}</a>` : ''}
          ${!lastSearch && !lastRun ? '<p class="muted">Nothing yet. Start with a search, or load the synthetic cohort in the analysis lab.</p>' : ''}
          <div class="section-head"><h2>Starting points</h2></div>
          ${[['Neurodegeneration', 'Alzheimer disease plasma p-tau217 biomarker'], ['Neurophysiology', 'EEG aperiodic exponent aging'], ['Neurovascular', 'stroke rehabilitation brain-computer interface'], ['Movement disorders', 'Parkinson disease digital biomarkers wearable']].map(([h, q]) => `<a class="list-row" href="#evidence/${encodeURIComponent(q)}"><div><h3>${h}</h3><p>${esc(q)}</p></div>${icon('search', 15)}</a>`).join('')}
        </section>
        <section><div class="section-head" style="margin-top:0"><h2>From question to study</h2></div><ol class="steps">
          <li><div><strong>Map the evidence</strong><span>Federated search, saved queries and alerts for new records.</span></div></li>
          <li><div><strong>Screen transparently</strong><span>Recorded decisions and reasons feed the PRISMA diagram.</span></div></li>
          <li><div><strong>Find the data</strong><span>Versioned open datasets; licences checked at source.</span></div></li>
          <li><div><strong>Analyze with verified methods</strong><span>Engines tested against SciPy reference values.</span></div></li>
          <li><div><strong>Write the protocol</strong><span>SPIRIT-, STROBE- and PRISMA-P-style templates.</span></div></li>
          <li><div><strong>Reproduce</strong><span>Every run carries its method version and input fingerprint.</span></div></li>
        </ol></section>
      </div>`;
}
