import { $, $$, esc, icon, pageHead, notice, toast, compute } from '../ui.mjs';

export const TABS = [
  ['cohort', 'Cohort explorer', 'database'], ['stats', 'Hypothesis tests', 'chart'], ['regression', 'Regression', 'chart'], ['survival', 'Survival', 'chart'],
  ['oncology', 'Oncology', 'chart'], ['ml', 'Machine learning', 'sparkle'], ['signal', 'Signal studio', 'wave'], ['meta', 'Meta-analysis', 'sparkle'], ['power', 'Power & sample size', 'flask'],
];

/** Shared in-memory dataset for cohort / stats / regression / survival. Never persisted. */
export const lab = { data: null, listeners: new Set() };

/** Deterministic synthetic cohort (fictional participants) for demonstrations. */
export function syntheticCohort(n = 160, seed = 7) {
  let s = seed;
  const rnd = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const norm = () => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const rows = [];
  for (let i = 0; i < n; i++) {
    const grp = i % 2 ? 'Intervention' : 'Control', age = Math.round(68 + norm() * 7), sex = rnd() < .52 ? 'F' : 'M';
    const nfl = Math.max(4, 14 + (age - 68) * 0.6 + norm() * 5).toFixed(1);
    const base = Math.round(Math.min(30, Math.max(14, 24 - (nfl - 14) * 0.15 + norm() * 2.5)));
    const fu = rnd() < .06 ? '' : Math.round(Math.min(30, Math.max(10, base - 1.6 + (grp === 'Intervention' ? 1.2 : 0) + norm() * 1.8)));
    const hazard = 0.018 * Math.exp(0.05 * (nfl - 14)) * (grp === 'Intervention' ? 0.65 : 1), t = -Math.log(1 - rnd()) / hazard, cens = 18 + rnd() * 30;
    rows.push([`P${String(i + 1).padStart(3, '0')}`, grp, sex, String(age), nfl, String(base), String(fu), Math.min(t, cens).toFixed(1), t <= cens ? '1' : '0']);
  }
  return { name: 'Synthetic cohort · 160 fictional participants', headers: ['participant', 'group', 'sex', 'age', 'nfl_pg_ml', 'moca_baseline', 'moca_followup', 'months_to_progression', 'progressed'], rows };
}

/**
 * Deterministic synthetic two-arm oncology trial (fictional patients) for demonstrations:
 * overall survival, competing events, best tumour response and time on treatment.
 */
export function syntheticOncology(n = 240, seed = 11) {
  let s = seed;
  const rnd = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const norm = () => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const rows = [];
  for (let i = 0; i < n; i++) {
    const arm = i % 2 ? 'Experimental' : 'Control', age = Math.round(Math.min(88, Math.max(28, 63 + norm() * 10))), sex = rnd() < 0.45 ? 'F' : 'M';
    const ecog = rnd() < 0.45 ? 0 : rnd() < 0.75 ? 1 : 2, pdl1 = Math.round(Math.min(100, Math.max(0, Math.exp(1.8 + norm() * 1.4))));
    const lp = (arm === 'Experimental' ? -0.45 : 0) + 0.35 * ecog + 0.015 * (age - 63) - (arm === 'Experimental' ? 0.006 * pdl1 : 0);
    const tDeath = -Math.log(1 - rnd()) / (0.045 * Math.exp(lp)), tOther = -Math.log(1 - rnd()) / 0.008, cens = 6 + rnd() * 36;
    const t = Math.min(tDeath, tOther, cens), status = t === cens ? 0 : 1, cause = t === cens ? 0 : t === tDeath ? 1 : 2;
    const respond = rnd() < (arm === 'Experimental' ? 0.18 + 0.004 * pdl1 : 0.12);
    let change = respond ? -30 - rnd() * 60 : -25 + norm() * 22;
    if (!respond && rnd() < 0.25) change = 20 + rnd() * 50;
    change = Math.max(-100, Math.min(120, change));
    const best = change <= -99 ? 'CR' : change <= -30 ? 'PR' : change >= 20 ? 'PD' : 'SD';
    const onTx = Math.min(t, best === 'PD' ? 1 + rnd() * 4 : 2 + rnd() * t), ongoing = t === cens && rnd() < 0.5 ? 1 : 0;
    rows.push([`PT${String(i + 1).padStart(3, '0')}`, arm, String(age), sex, String(ecog), String(pdl1), t.toFixed(1), String(status), String(cause), change.toFixed(1), best, onTx.toFixed(1), String(ongoing)]);
  }
  return { name: 'Synthetic oncology trial · 240 fictional patients', headers: ['patient', 'arm', 'age', 'sex', 'ecog', 'pdl1_pct', 'os_months', 'death', 'event_type', 'best_pct_change', 'best_response', 'months_on_treatment', 'ongoing'], rows };
}

export async function setData(text, name) {
  const parsed = text.length > 300000 ? await compute('parseCSV', text) : (await import('../../../lib/csv.mjs')).parseCSV(text);
  const { profileColumns } = await import('../../../lib/csv.mjs');
  lab.data = { name, ...parsed, profile: profileColumns(parsed) };
  lab.listeners.forEach(fn => fn());
  return lab.data;
}
export function setDataObject(obj) {
  return import('../../../lib/csv.mjs').then(({ profileColumns }) => { lab.data = { ...obj, profile: profileColumns(obj) }; lab.listeners.forEach(fn => fn()); return lab.data; });
}
export const numericCols = () => lab.data?.profile.filter(c => c.type === 'numeric' || c.type === 'binary') || [];
export const groupCols = () => lab.data?.profile.filter(c => (c.type === 'categorical' || c.type === 'binary') && c.unique <= 50) || [];
export const colValues = i => lab.data.rows.map(r => r[i]);
export const colNumbers = i => lab.data.rows.map(r => (r[i] === '' || r[i] == null ? NaN : Number(r[i])));
export const opts = (cols, selected) => cols.map(c => `<option value="${c.index}" ${String(selected) === String(c.index) ? 'selected' : ''}>${esc(c.name)}</option>`).join('');

/** Data-source bar used by tabs that operate on the shared dataset. */
export function dataBar() {
  return `<div class="card flat" style="margin-bottom:16px"><div class="inline" style="justify-content:space-between">
    <div class="inline">${icon('database', 18)}<div><strong>${lab.data ? esc(lab.data.name) : 'No dataset loaded'}</strong><div class="muted small">${lab.data ? `${lab.data.rows.length.toLocaleString()} rows · ${lab.data.headers.length} columns · delimiter “${lab.data.delimiter === '\t' ? 'tab' : esc(lab.data.delimiter || ',')}” · held in memory only` : 'Load a CSV/TSV (up to 50 MB, parsed off the main thread) or the synthetic example.'}</div></div></div>
    <div class="inline"><label class="btn small" for="csv-file">${icon('upload', 14)} Load CSV</label><input type="file" id="csv-file" accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values" hidden><button class="btn small" id="demo-data">Synthetic cohort</button><button class="btn small" id="demo-onc">Synthetic oncology trial</button><button class="btn small" id="demo-bx">Synthetic biomarker cohort</button></div>
  </div></div>`;
}
export function wireDataBar(root) {
  $('#demo-data', root).onclick = () => setDataObject(syntheticCohort()).then(() => toast('Synthetic cohort loaded (fictional data).'));
  const onc = $('#demo-onc', root);
  if (onc) onc.onclick = () => setDataObject(syntheticOncology()).then(() => toast('Synthetic oncology trial loaded (fictional data).'));
  const bx = $('#demo-bx', root);
  if (bx) bx.onclick = () => import('../../../lib/ml-demo.mjs').then(m => setDataObject(m.syntheticBiomarker())).then(() => toast('Synthetic biomarker cohort loaded (fictional data).'));
  $('#csv-file', root).onchange = async e => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    if (f.size > 50e6) { toast('Choose a file smaller than 50 MB.', 'error'); return; }
    try { await setData(await f.text(), f.name); toast(`${f.name} loaded locally — nothing was uploaded.`, 'good'); }
    catch (err) { toast(err.message, 'error'); }
  };
}

let unsub = null;
export async function render(main, { params }) {
  const tab = TABS.some(t => t[0] === params[0]) ? params[0] : 'cohort';
  main.innerHTML = pageHead('Analysis lab', 'Make the method visible.', 'Verified statistical engines that run entirely in your browser. Every run records its inputs, method version and a SHA-256 fingerprint.')
    + `<div class="tabs" role="tablist" aria-label="Lab tools">${TABS.map(([id, l, ic]) => `<a class="tab" role="tab" href="#lab/${id}" aria-selected="${id === tab}">${icon(ic, 15)} ${l}</a>`).join('')}</div><div id="lab-body"></div>`;
  $$('.tab', main).forEach(a => a.style.textDecoration = 'none');
  const body = $('#lab-body');
  const mod = await import(`./lab/${tab}.mjs`);
  if (unsub) lab.listeners.delete(unsub);
  unsub = () => { if (location.hash.startsWith(`#lab/${tab}`) || (tab === 'cohort' && location.hash === '#lab')) mod.render(body); };
  lab.listeners.add(unsub);
  try { await mod.render(body); } catch (e) { body.innerHTML = notice(`This tool failed to load: ${esc(e.message)}`, 'warn'); }
}
