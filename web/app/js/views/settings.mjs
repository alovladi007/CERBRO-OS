import { store } from '../store.mjs';
import { $, esc, icon, pageHead, notice, toast, applyTheme, confirmDialog, table } from '../ui.mjs';
import { CONNECT_ALLOWLIST, OPENAI_USER_AGENTS, OPENAI_DENY_HOSTS, egressDecision } from '../policy.mjs';
import { blockedRequests } from '../guard.mjs';
import { METHOD_VERSION } from '../../../lib/science.mjs';
import { setNcbiKey } from '../sources.mjs';

export async function render(main) {
  const s = store.state, est = await store.estimate();
  const probe = egressDecision('https://api.openai.com/v1/chat/completions', location.origin);
  main.innerHTML = pageHead('System', 'Settings, privacy & policy.', 'Projects, appearance, storage, network policy and the methods behind every tool.')
    + `<div class="grid2">
      <section class="card"><h2>Projects</h2><p class="muted small">Each project has its own searches, screening decisions, protocols and run history.</p>
        ${table(['Project', 'Records', 'Runs', ''], s.projects.map(p => [`<strong>${esc(p.name)}</strong>${p.id === s.activeProjectId ? ' <span class="tag accent">active</span>' : ''}`, p.papers.length, p.runs.length, `<button class="btn small" data-rename="${p.id}">Rename</button> ${s.projects.length > 1 ? `<button class="btn small danger" data-delete="${p.id}">Delete</button>` : ''}`]), { numeric: [1, 2] })}</section>
      <section class="card"><h2>Appearance & sources</h2>
        <label class="field">Theme<select id="theme"><option value="system">Match system</option><option value="light">Light</option><option value="dark">Dark</option></select></label>
        <label class="field">NCBI API key (optional)<input id="ncbi" type="password" autocomplete="off" value="${esc(s.settings.ncbiKey || '')}" placeholder="Raises PubMed limit to 10 requests/second"><small>Stored only in this browser and sent only to eutils.ncbi.nlm.nih.gov.</small></label>
        <button class="btn small" id="save-settings">Save settings</button>
        <hr class="divider"><h3>Storage</h3><p class="muted small">Backend: <strong>${esc(store.backend)}</strong>${est ? ` · using ${(est.usage / 1e6).toFixed(1)} MB of ${(est.quota / 1e9).toFixed(1)} GB available to this site` : ''}. Participant-level data loaded in the lab is never written to storage.</p></section>
    </div>
    <section class="card" style="margin-top:18px"><div class="inline">${icon('shield', 22)}<h2>Network & AI policy</h2></div>
      ${notice(`<strong>OpenAI / ChatGPT is blocked.</strong> Live check: a request to <span class="mono">api.openai.com</span> from this page is <strong>${probe.allowed ? 'ALLOWED (unexpected)' : 'refused'}</strong> — ${esc(probe.reason || '')}.`, probe.allowed ? 'warn' : 'good')}
      <div class="grid2"><div><h3>Allowed research endpoints</h3><p class="muted small">Enforced by Content-Security-Policy <em>and</em> a runtime fetch guard. Nothing else can be contacted.</p><pre class="policy">${CONNECT_ALLOWLIST.map(esc).join('\n')}</pre></div>
      <div><h3>Refused AI agents & hosts</h3><p class="muted small">Server returns 403 to these user agents and to OpenAI’s published crawler IP ranges; robots.txt disallows them; the app refuses to call or be framed by these hosts.</p><pre class="policy">User-agents: ${OPENAI_USER_AGENTS.map(esc).join(', ')}\nHosts: ${OPENAI_DENY_HOSTS.map(esc).join(', ')}</pre><div id="server-policy" class="muted small" style="margin-top:8px"></div></div></div>
      <h3 style="margin-top:14px">Blocked requests this session</h3>${blockedRequests().length ? table(['When', 'URL', 'Reason'], blockedRequests().map(b => [new Date(b.at).toLocaleTimeString(), `<span class="mono">${esc(b.url)}</span>`, esc(b.reason)])) : '<p class="muted small">None — no component has attempted a disallowed request.</p>'}
    </section>
    <section class="card" style="margin-top:18px"><h2>Methods & validation</h2>
      <p class="muted">Method version <span class="mono">${METHOD_VERSION}</span>. Every numerical engine is covered by an automated test suite with reference values computed independently in SciPy/NumPy (t, χ², F and noncentral-t distributions; Welch/Student/paired t; Mann–Whitney; ANOVA; Kruskal–Wallis; χ²; Pearson/Spearman; OLS; Kaplan–Meier and log-rank; DL/PM/REML τ²; Hartung–Knapp; exact power; FFT, Welch PSD and filters). Unit tests are not clinical validation.</p>
      <div class="grid3">${[['Evidence', 'Europe PMC, PubMed E-utilities and ClinicalTrials.gov v2 are queried directly from your browser. De-duplication: DOI → PMID → normalized title.'], ['Statistics', 'Two-sided tests; Welch by default; Hedges’ g with large-sample CI; BH/Holm/Bonferroni; complete-case regression; Greenwood/log-log KM CIs.'], ['Meta-analysis', 'Inverse variance; DL, PM, REML τ²; HKSJ with q*≥1; t-based prediction interval (k−2 df); Egger regression; leave-one-out; cumulative.'], ['Power', 'Exact noncentral t (Lenth AS 243); pooled-variance proportions; Fisher z; Schoenfeld events.'], ['Signal', 'Bluestein/radix-2 FFT; periodic-Hann Welch PSD; RBJ biquad filters applied forward–backward; 1/f fit in log–log space.'], ['Limits', 'Research use only. Not a medical device. No diagnosis, prognosis or treatment recommendations. No PHI handling certification.']].map(([h, t]) => `<div class="card flat"><h3>${h}</h3><p class="muted small">${t}</p></div>`).join('')}</div>
    </section>
    <section class="card" style="margin-top:18px"><h2>Danger zone</h2><p class="muted small">Erase every project in this browser. Export a backup first.</p><button class="btn danger" id="wipe">${icon('trash', 15)} Erase local workspace</button></section>`;
  $('#theme').value = (() => { try { return localStorage.getItem('cerebro-theme') || 'system'; } catch { return 'system'; } })();
  $('#theme').onchange = e => applyTheme(e.target.value);
  $('#save-settings').onclick = () => { const k = $('#ncbi').value.trim(); store.state.settings.ncbiKey = k; setNcbiKey(k); store.save(); toast('Settings saved.', 'good'); };
  main.querySelectorAll('[data-rename]').forEach(b => b.onclick = () => { const p = s.projects.find(x => x.id === b.dataset.rename), name = prompt('Project name', p.name); if (name?.trim()) { p.name = name.trim().slice(0, 80); store.save(); render(main); } });
  main.querySelectorAll('[data-delete]').forEach(b => b.onclick = async () => { const p = s.projects.find(x => x.id === b.dataset.delete); if (await confirmDialog(`Delete project “${p.name}” and everything in it?`, { confirmLabel: 'Delete project', danger: true })) { store.deleteProject(p.id); render(main); } });
  $('#wipe').onclick = async () => { if (await confirmDialog('Erase all projects stored in this browser? This cannot be undone.', { confirmLabel: 'Erase everything', danger: true })) { const { newProject, SCHEMA } = await import('../store.mjs'); const p = newProject(); store.replace({ schema: SCHEMA, activeProjectId: p.id, projects: [p] }); toast('Workspace erased.'); location.hash = 'overview'; } };
  fetch('/api/policy').then(r => (r.ok && (r.headers.get('content-type') || '').includes('json') ? r.json() : null)).then(j => {
    const el = $('#server-policy'); if (!el) return;
    const bots = j?.openai?.ipRanges?.bots;
    el.textContent = bots ? `Server enforcement active · OpenAI IP ranges loaded: ${Object.entries(bots).map(([k, v]) => `${k} ${v.count}`).join(', ')}` : 'Static hosting: server-side blocking comes from your host configuration (see docs/DEPLOYMENT.md).';
  }).catch(() => { const el = $('#server-policy'); if (el) el.textContent = 'Static hosting: server-side blocking comes from your host configuration (see docs/DEPLOYMENT.md).'; });
}
