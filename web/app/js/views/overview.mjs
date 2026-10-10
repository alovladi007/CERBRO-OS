import { store } from '../store.mjs';
import { esc, icon, pageHead } from '../ui.mjs';

function network() {
  let nodes = '', edges = '';
  const pts = [];
  for (let i = 0; i < 120; i++) {
    const t = i * 2.39996, r = Math.sqrt(i / 120), x = 210 + Math.cos(t) * 170 * r, y = 110 + Math.sin(t) * 95 * r;
    pts.push([x, y]);
    if (i > 3) { const j = i - 4 - (i % 3); edges += `<path class="edge" d="M${x.toFixed(1)} ${y.toFixed(1)}L${pts[Math.max(0, j)][0].toFixed(1)} ${pts[Math.max(0, j)][1].toFixed(1)}"/>`; }
    nodes += `<circle class="${i % 5 ? 'node' : 'node2'}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${i % 9 === 0 ? 3.2 : 1.7}" opacity="${(.35 + r * .6).toFixed(2)}"/>`;
  }
  return `<svg viewBox="0 0 420 220" role="img" aria-label="Abstract research network illustration">${edges}${nodes}</svg>`;
}

export function render(main) {
  const p = store.project, screened = Object.values(p.screening), included = screened.filter(s => s.decision === 'include').length;
  const lastRun = p.runs[0], lastSearch = p.searches[0];
  main.innerHTML = pageHead('Workspace overview', esc(p.name), 'From question to reproducible result: evidence, data, analysis and protocol in one place.', `<a class="btn primary" href="#evidence">${icon('search', 16)} New search</a><a class="btn" href="#protocols/new">${icon('plus', 16)} New protocol</a>`)
    + `<section class="hero"><div><div class="eyebrow">Cerebro OS · Research workspace</div><h2>Every connection, a new possibility.</h2><p>Search three evidence sources at once, screen with a live PRISMA diagram, discover open datasets, and run verified statistics locally — every result fingerprinted for reproducibility.</p><div class="actions"><a class="btn primary" href="#evidence">Explore the evidence</a><a class="btn" href="#lab">Open the analysis lab</a></div></div><div>${network()}</div></section>`
    + `<div class="stats" style="margin-top:18px">
        <a class="stat" href="#library"><span>Saved records</span><strong>${p.papers.length}</strong><small>Across literature &amp; trials</small></a>
        <a class="stat" href="#screening"><span>Screened</span><strong>${screened.length}</strong><small>${included} included so far</small></a>
        <a class="stat" href="#protocols"><span>Protocols</span><strong>${p.protocols.length}</strong><small>Structured study drafts</small></a>
        <a class="stat" href="#library/runs"><span>Analysis runs</span><strong>${p.runs.length}</strong><small>With SHA-256 provenance</small></a>
      </div>`
    + `<div class="section-head"><h2>Research toolkit</h2><a href="#lab">All lab tools →</a></div>
      <div class="grid3">${[
        ['search', 'Federated evidence search', 'Europe PMC, PubMed and ClinicalTrials.gov in one query, de-duplicated, with saved-search monitoring.', 'evidence'],
        ['filter', 'Screening & PRISMA 2020', 'Keyboard-driven include/exclude decisions with reasons and an automatic flow diagram.', 'screening'],
        ['database', 'Dataset discovery', 'Live search across OpenNeuro and DANDI plus a curated directory of major repositories.', 'datasets'],
        ['chart', 'Statistics & regression', 't-tests, non-parametric tests, ANOVA, χ², correlation, OLS regression, multiplicity control.', 'lab/stats'],
        ['wave', 'Signal studio', 'Welch PSD, zero-phase filters, spectrogram, band power, aperiodic 1/f exponent.', 'lab/signal'],
        ['sparkle', 'Meta-analysis & power', 'REML/PM/DL random effects, HKSJ, funnel & Egger, exact noncentral-t power.', 'lab/meta'],
      ].map(([i, h, t, href]) => `<a class="card tool" href="#${href}"><span class="ti">${icon(i, 20)}</span><h3>${h}</h3><p>${t}</p></a>`).join('')}</div>`
    + `<div class="grid2" style="margin-top:18px">
        <section class="card"><h2>Recent activity</h2>
          ${lastSearch ? `<a class="list-row" href="#evidence/${encodeURIComponent(lastSearch.query)}"><div><h3>${esc(lastSearch.query)}</h3><p>Last search · ${new Date(lastSearch.lastRun).toLocaleString()} · ${lastSearch.lastCount ?? 0} records</p></div>${icon('external', 16)}</a>` : ''}
          ${lastRun ? `<a class="list-row" href="#library/runs"><div><h3>${esc(lastRun.tool)}</h3><p>Last analysis · ${new Date(lastRun.at).toLocaleString()} · <span class="mono">${lastRun.inputSha256?.slice(0, 12) || ''}</span></p></div>${icon('external', 16)}</a>` : ''}
          ${!lastSearch && !lastRun ? '<p class="muted">Nothing yet. Start with a search, or load a synthetic example in the lab.</p>' : ''}
          <div class="section-head" style="margin-top:14px"><h3>Starting points</h3></div>
          ${[['Neurodegeneration', 'Alzheimer disease plasma p-tau217 biomarker'], ['Neurophysiology', 'EEG aperiodic exponent aging'], ['Neurovascular', 'stroke rehabilitation brain-computer interface'], ['Movement disorders', 'Parkinson disease digital biomarkers wearable']].map(([h, q]) => `<a class="list-row" href="#evidence/${encodeURIComponent(q)}"><div><h3>${h}</h3><p>${esc(q)}</p></div>${icon('search', 16)}</a>`).join('')}
        </section>
        <section class="card"><h2>From question to study</h2><ol class="steps" style="margin-top:12px">
          <li><div><strong>Map the evidence</strong><span>Federated search, saved queries and alerts for new records.</span></div></li>
          <li><div><strong>Screen transparently</strong><span>Recorded decisions and reasons feed the PRISMA diagram.</span></div></li>
          <li><div><strong>Find the data</strong><span>Versioned open datasets with licences checked at source.</span></div></li>
          <li><div><strong>Analyze with verified methods</strong><span>Engines tested against SciPy reference values.</span></div></li>
          <li><div><strong>Write the protocol</strong><span>SPIRIT, STROBE and PRISMA-P style templates.</span></div></li>
          <li><div><strong>Reproduce</strong><span>Every run carries its method version and input fingerprint.</span></div></li>
        </ol></section>
      </div>`;
}
