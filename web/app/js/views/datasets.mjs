import { $, $$, esc, icon, pageHead, notice, empty } from '../ui.mjs';
import { searchDANDI, searchOpenNeuro } from '../sources.mjs';

export const RESOURCES = [
  { name: 'OpenNeuro', type: 'Neuroimaging', format: 'BIDS', url: 'https://openneuro.org/', desc: 'Shared MRI, PET, MEG, EEG and iEEG datasets with versioned snapshots and DOIs.', live: true },
  { name: 'DANDI Archive', type: 'Neurophysiology', format: 'NWB · BIDS', url: 'https://dandiarchive.org/', desc: 'Cellular neurophysiology, optical physiology and behaviour in standardized NWB, with versioned Dandisets.', live: true },
  { name: 'EBRAINS', type: 'Multimodal', format: 'Atlases · Knowledge Graph', url: 'https://ebrains.eu/data-tools-services', desc: 'Brain atlases, multimodal data and modelling tools from molecular to whole-brain scales.' },
  { name: 'NEMAR', type: 'Neurophysiology', format: 'EEG · MEG · iEEG', url: 'https://nemar.org/', desc: 'Human electrophysiology data mirrored from OpenNeuro with compute resources for BIDS recordings.' },
  { name: 'NeMO Archive', type: 'Molecular', format: 'Neuro-omics', url: 'https://nemoarchive.org/', desc: 'Transcriptomic, epigenomic and other molecular datasets from the BRAIN Initiative.' },
  { name: 'brainlife.io', type: 'Multimodal', format: 'Reproducible workflows', url: 'https://brainlife.io/', desc: 'Cloud platform for reproducible neuroimaging analysis apps and data provenance.' },
  { name: 'Allen Brain Map', type: 'Molecular', format: 'Atlases · cell types', url: 'https://portal.brain-map.org/', desc: 'Cell-type taxonomies, connectivity and gene-expression atlases of mouse and human brain.' },
  { name: 'Human Connectome Project', type: 'Neuroimaging', format: 'MRI · MEG', url: 'https://www.humanconnectome.org/', desc: 'High-quality multimodal connectivity data from healthy adults, development and ageing cohorts.' },
  { name: 'ADNI', type: 'Clinical cohort', format: 'MRI · PET · biomarkers', url: 'https://adni.loni.usc.edu/', desc: 'Longitudinal Alzheimer’s disease imaging, fluid biomarker and cognitive data (application required).' },
  { name: 'PPMI', type: 'Clinical cohort', format: 'Imaging · biosamples · digital', url: 'https://www.ppmi-info.org/', desc: 'Parkinson’s Progression Markers Initiative: longitudinal clinical, imaging and biomarker data (application required).' },
  { name: 'UK Biobank', type: 'Clinical cohort', format: 'Imaging · genetics · EHR', url: 'https://www.ukbiobank.ac.uk/', desc: 'Population-scale imaging, genomic and health-record data (approved researchers, fees apply).' },
  { name: 'PhysioNet', type: 'Neurophysiology', format: 'EEG · polysomnography', url: 'https://physionet.org/', desc: 'Physiologic signal databases including sleep, EEG and ICU waveforms with credentialed access tiers.' },
  { name: 'Temple University EEG Corpus', type: 'Neurophysiology', format: 'Clinical EEG', url: 'https://isip.piconepress.com/projects/nedc/html/tuh_eeg/', desc: 'Large clinical EEG corpus with seizure and artifact annotations (registration required).' },
  { name: 'NITRC', type: 'Neuroimaging', format: 'Tools · data', url: 'https://www.nitrc.org/', desc: 'Neuroimaging tools and resources clearinghouse, including the NITRC Image Repository.' },
];

const state = { q: '', live: null, loading: false };
const size = b => !b ? '—' : b > 1e12 ? (b / 1e12).toFixed(1) + ' TB' : b > 1e9 ? (b / 1e9).toFixed(1) + ' GB' : (b / 1e6).toFixed(0) + ' MB';

async function liveSearch(q) {
  state.q = q; state.loading = true; drawLive();
  const [on, da] = await Promise.allSettled([searchOpenNeuro(q), searchDANDI(q)]);
  state.live = { on, da }; state.loading = false; drawLive();
}

function drawLive() {
  const box = $('#live');
  if (!box) return;
  if (state.loading) { box.innerHTML = `<div class="loading">Searching OpenNeuro and DANDI for “${esc(state.q)}”…</div>`; return; }
  if (!state.live) { box.innerHTML = empty('Search open datasets by keyword.', 'Try “epilepsy”, “hippocampus”, “Parkinson”, “resting state”, or “visual cortex”.'); return; }
  const rows = [], errors = [];
  for (const [k, label] of [['on', 'OpenNeuro'], ['da', 'DANDI']]) {
    const r = state.live[k];
    if (r.status === 'fulfilled') rows.push(...r.value.records); else errors.push(label);
  }
  box.innerHTML = (errors.length ? notice(`${errors.join(' and ')} could not be reached right now. Other results are shown.`, 'warn') : '')
    + (rows.length ? `<div class="grid2">${rows.map(r => `<article class="card dataset"><div class="head"><div><div class="eyebrow">${esc(r.repo)} · ${esc(r.id.split(':')[1])}</div><h3>${esc(r.name)}</h3></div><a class="icon-btn" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer" aria-label="Open dataset at source">${icon('external', 15)}</a></div>
        <dl class="kv"><dt>Modality</dt><dd>${esc(r.modality)}</dd><dt>Version</dt><dd>${esc(r.version || 'draft')}</dd>${r.subjects ? `<dt>Subjects</dt><dd>${r.subjects}</dd>` : ''}<dt>Size</dt><dd>${size(r.size)}${r.files ? ` · ${r.files.toLocaleString()} files` : ''}</dd><dt>Updated</dt><dd>${r.updated ? new Date(r.updated).toLocaleDateString() : '—'}</dd></dl>
        <div class="inline"><button class="btn small" data-cite="${esc(r.url)}" data-name="${esc(r.name)}" data-version="${esc(r.version || '')}">Copy citation pin</button></div></article>`).join('')}</div>`
      : empty('No public datasets matched.', 'Try a broader keyword.'));
  $$('[data-cite]', box).forEach(b => b.onclick = async () => {
    const text = `${b.dataset.name}${b.dataset.version ? ` (version ${b.dataset.version})` : ''}. ${b.dataset.cite} — accessed ${new Date().toISOString().slice(0, 10)}`;
    try { await navigator.clipboard.writeText(text); b.textContent = 'Copied ✓'; } catch { b.textContent = 'Copy unavailable'; }
  });
}

export function render(main) {
  const types = [...new Set(RESOURCES.map(r => r.type))];
  main.innerHTML = pageHead('Data', 'Find your next dataset.', 'Live search across OpenNeuro and DANDI, plus a curated directory of major neuroscience repositories and cohorts.')
    + `<form class="card" id="ds-form"><div class="searchbar"><input id="ds-q" type="search" placeholder="Search open datasets: epilepsy, hippocampus, sleep EEG…" value="${esc(state.q)}" required maxlength="120" aria-label="Dataset keywords"><button class="btn primary">${icon('search', 16)} Search repositories</button></div><p class="hint" style="margin:10px 0 0">Version numbers are shown so you can pin exactly what you analyze. Always check licence, consent restrictions and data-use terms at the source.</p></form>
      <div id="live" style="margin-top:18px"></div>
      <div class="section-head"><h2>Repository directory</h2><div class="inline"><input id="dir-q" placeholder="Filter directory…" aria-label="Filter directory" style="width:200px"><select id="dir-type" aria-label="Category" style="width:auto"><option value="">All categories</option>${types.map(t => `<option>${t}</option>`).join('')}</select></div></div>
      <div id="dir" class="grid3"></div>`;
  $('#ds-form').onsubmit = e => { e.preventDefault(); const q = $('#ds-q').value.trim(); if (q) liveSearch(q); };
  const filter = () => {
    const q = $('#dir-q').value.toLowerCase(), t = $('#dir-type').value, list = RESOURCES.filter(r => (!t || r.type === t) && JSON.stringify(r).toLowerCase().includes(q));
    $('#dir').innerHTML = list.length ? list.map(r => `<article class="card dataset"><div class="eyebrow">${esc(r.type)}</div><h3>${esc(r.name)}</h3><p class="muted small" style="margin:0">${esc(r.desc)}</p><div class="inline"><span class="tag">${esc(r.format)}</span>${r.live ? '<span class="tag good">Live search</span>' : ''}</div><div><a class="btn small" href="${r.url}" target="_blank" rel="noopener noreferrer">Visit ${icon('external', 13)}</a></div></article>`).join('') : empty('No resources match.');
  };
  $('#dir-q').oninput = filter; $('#dir-type').onchange = filter;
  filter(); drawLive();
}
