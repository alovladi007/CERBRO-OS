import { store } from '../store.mjs';
import { $, $$, esc, icon, pageHead, notice, empty, toast, download, confirmDialog } from '../ui.mjs';

const BASE = [
  ['title', 'Study title', 'e.g. Plasma p-tau217 and 3-year cognitive decline in amyloid-positive adults'],
  ['question', 'Research question', 'Population, intervention/exposure, comparison, outcome, timeframe (PICOT).'],
  ['hypothesis', 'Primary hypothesis', 'A testable hypothesis with the expected direction and magnitude.'],
  ['population', 'Population & eligibility', 'Inclusion/exclusion criteria, setting, recruitment and sampling.'],
  ['design', 'Design & comparator', 'Design, allocation, blinding, comparator, follow-up.'],
  ['outcomes', 'Primary & secondary outcomes', 'Measures, units, time points, primary endpoint; label exploratory outcomes.'],
  ['analysis', 'Statistical analysis plan', 'Estimand, models, covariates, confounding, missing data, multiplicity, sensitivity analyses.'],
  ['sample', 'Sample size rationale', 'Effect-size source, assumptions, power, attrition, feasibility (link a Power run).'],
  ['governance', 'Ethics & data governance', 'Approval status, consent, permitted use, access control, retention, de-identification.'],
  ['reproducibility', 'Reproducibility plan', 'Dataset IDs and versions, preprocessing, code version, environment, preregistration.'],
];
export const TEMPLATES = {
  rct: { label: 'Randomized trial (SPIRIT-style)', extra: [['randomization', 'Randomization & allocation concealment', 'Sequence generation, allocation ratio, concealment mechanism, stratification.'], ['interventions', 'Interventions', 'Each arm in replicable detail, adherence, concomitant care.'], ['harms', 'Harms & monitoring', 'Adverse event collection, data monitoring committee, stopping rules.']] },
  observational: { label: 'Observational study (STROBE-style)', extra: [['exposures', 'Exposures & confounders', 'Exposure definition and measurement, DAG or confounder rationale.'], ['bias', 'Bias', 'Selection, information and confounding bias and how they are addressed.']] },
  review: { label: 'Systematic review (PRISMA-P-style)', extra: [['sources', 'Information sources & search', 'Databases, registers, dates, full search strategy (link saved searches).'], ['selection', 'Study selection', 'Screening process, number of reviewers, conflict resolution.'], ['rob', 'Risk of bias & certainty', 'RoB 2 / ROBINS-I, GRADE approach.'], ['synthesis', 'Data synthesis', 'Effect measures, pooling model, heterogeneity, small-study effects.']] },
  generic: { label: 'General research protocol', extra: [] },
};
export const fieldsFor = p => [...BASE, ...(TEMPLATES[p.template || 'generic']?.extra || [])];
const completeness = p => { const f = fieldsFor(p); return f.filter(([k]) => String(p[k] || '').trim()).length / f.length; };

function list(main) {
  const ps = store.project.protocols;
  main.innerHTML = pageHead('Protocols', 'Give your study a clear foundation.', 'Structured protocol drafts with design-specific templates, completeness tracking and Markdown export.', `<a class="btn primary" href="#protocols/new">${icon('plus', 16)} New protocol</a>`)
    + notice('Drafts are saved in this browser. Saving here does not preregister a study or obtain ethics approval.')
    + (ps.length ? `<div class="grid2">${ps.map((p, i) => { const c = completeness(p); return `<article class="card"><div class="inline"><span class="tag accent">${esc(TEMPLATES[p.template || 'generic'].label)}</span><span class="tag">v${p.version || 1}</span></div><h3 style="margin-top:10px">${esc(p.title)}</h3><p class="muted small">${esc((p.question || 'Research question not yet defined.').slice(0, 220))}</p><div class="completeness"><i style="width:${c * 100}%"></i></div><p class="muted small">${Math.round(c * 100)}% complete · updated ${new Date(p.updatedAt).toLocaleDateString()}</p><div class="actions"><a class="btn small" href="#protocols/${encodeURIComponent(p.id)}">Continue editing</a><button class="btn small" data-export="${i}">${icon('download', 14)} Markdown</button><button class="btn small danger" data-del="${i}">${icon('trash', 14)}</button></div></article>`; }).join('')}</div>`
      : empty('Your next research question belongs here.', 'Start from a template to connect the question, outcomes, analysis plan and evidence.', '<div class="actions" style="justify-content:center"><a class="btn primary" href="#protocols/new">Create a protocol</a></div>'));
  $$('[data-export]').forEach(b => b.onclick = () => exportProtocol(ps[Number(b.dataset.export)]));
  $$('[data-del]').forEach(b => b.onclick = async () => { if (await confirmDialog('Delete this protocol draft? Export it first if you need a copy.', { confirmLabel: 'Delete', danger: true })) { store.update(p => p.protocols.splice(Number(b.dataset.del), 1)); list(main); } });
}

export function exportProtocol(p) {
  const project = store.project, runs = project.runs.filter(r => (p.linkedRuns || []).includes(r.id));
  const text = `# ${p.title}\n\n*${TEMPLATES[p.template || 'generic'].label} · version ${p.version || 1} · Cerebro OS*  \nUpdated: ${p.updatedAt}\n\n`
    + fieldsFor(p).slice(1).map(([k, l]) => `## ${l}\n\n${p[k] || '_Not yet specified._'}\n`).join('\n')
    + (runs.length ? `\n## Linked analyses\n\n${runs.map(r => `- ${r.tool} — ${r.at} — method ${r.methodVersion} — input SHA-256 \`${r.inputSha256}\``).join('\n')}\n` : '')
    + `\n## Evidence snapshot (included records)\n\n${(p.evidence || []).map(e => `- ${e.title}${e.doi ? ` — doi:${e.doi}` : ''}\n  ${e.url}`).join('\n') || '_None linked._'}\n\n---\nThis draft is not a preregistration or ethics approval.\n`;
  download(`${p.title.replace(/[^\w]+/g, '-').slice(0, 60) || 'protocol'}.md`, text, 'text/markdown');
}

function edit(main, id) {
  const existing = store.project.protocols.find(p => p.id === id), p = existing ? { ...existing } : { id: crypto.randomUUID(), template: 'generic' };
  const draw = () => {
    const included = store.project.papers.filter(r => store.project.screening[r.key]?.decision === 'include');
    main.innerHTML = pageHead('Protocols', existing ? 'Continue your protocol.' : 'Start with a research question.', 'Make each assumption explicit. Fields save as a draft when you press Save.', '<a class="btn" href="#protocols">← All protocols</a>')
      + `<form id="pf" class="card"><div class="form-grid"><label class="field">Template<select name="template" id="tpl">${Object.entries(TEMPLATES).map(([k, t]) => `<option value="${k}" ${p.template === k ? 'selected' : ''}>${t.label}</option>`).join('')}</select></label><div class="field">Completeness<div class="completeness"><i style="width:${completeness(p) * 100}%"></i></div><small>${Math.round(completeness(p) * 100)}% of sections drafted</small></div>
        ${fieldsFor(p).map(([k, l, ph], i) => `<label class="field ${i < 3 || ['analysis', 'reproducibility', 'governance'].includes(k) ? 'full' : ''}">${l}${k === 'title' ? `<input name="${k}" value="${esc(p[k] || '')}" placeholder="${esc(ph)}" maxlength="240" required>` : `<textarea name="${k}" placeholder="${esc(ph)}" maxlength="20000">${esc(p[k] || '')}</textarea>`}</label>`).join('')}
        <div class="field full">Link analysis runs<div class="chips">${store.project.runs.slice(0, 20).map(r => `<label class="chip"><input type="checkbox" name="run" value="${r.id}" ${(p.linkedRuns || []).includes(r.id) ? 'checked' : ''}> ${esc(r.tool)} · ${new Date(r.at).toLocaleDateString()}</label>`).join('') || '<span class="muted">No analysis runs yet — results from the lab can be linked here.</span>'}</div></div></div>
        ${notice(`The ${included.length} record(s) marked <strong>Include</strong> in screening are attached as the evidence snapshot when you save.`)}
        <div class="actions"><button class="btn primary">${icon('check', 16)} Save draft</button><button class="btn" type="button" id="md">${icon('download', 16)} Export Markdown</button><button class="btn" type="button" id="print">Print / PDF</button></div></form>`;
    $('#tpl').onchange = e => { Object.assign(p, Object.fromEntries(new FormData($('#pf')))); p.template = e.target.value; draw(); };
    $('#pf').onsubmit = e => {
      e.preventDefault();
      const fd = new FormData(e.target), fields = Object.fromEntries([...fd].filter(([k]) => k !== 'run'));
      const updated = { ...p, ...fields, title: fields.title.trim(), linkedRuns: fd.getAll('run'), version: (existing?.version || 0) + 1, createdAt: p.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString(), evidence: included.map(({ title, url, doi }) => ({ title, url, doi })) };
      store.update(pr => { const i = pr.protocols.findIndex(x => x.id === p.id); if (i >= 0) pr.protocols[i] = updated; else pr.protocols.unshift(updated); });
      toast(`Protocol saved (version ${updated.version}).`, 'good');
      location.hash = 'protocols';
    };
    $('#md').onclick = () => exportProtocol({ ...p, ...Object.fromEntries(new FormData($('#pf'))), updatedAt: new Date().toISOString() });
    $('#print').onclick = () => window.print();
  };
  draw();
}

export function render(main, { params }) {
  if (params[0] === 'new') edit(main, null);
  else if (params[0]) edit(main, params[0]);
  else list(main);
}
