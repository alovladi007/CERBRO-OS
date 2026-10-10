// Cerebro OS — local-first workspace store.
// IndexedDB is the primary store (large quotas, async); localStorage is the fallback.
// Migrates AXON v0.1 workspaces automatically.

const DB = 'cerebro-os', OBJ = 'kv', KEY = 'workspace', LS_KEY = 'cerebro-workspace-v2', LEGACY_KEY = 'axon-workspace-v1';
export const SCHEMA = 'cerebro-workspace-v2';
export const MAX_RUNS = 500;

const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();

export function newProject(name = 'My first project') {
  return { id: uid(), name, createdAt: now(), updatedAt: now(), papers: [], protocols: [], runs: [], searches: [], screening: {}, identified: {}, notes: '' };
}

function emptyWorkspace() {
  const p = newProject();
  return { schema: SCHEMA, activeProjectId: p.id, projects: [p], settings: { theme: 'system', density: 'comfortable', welcomed: false } };
}

/** Normalize any supported payload (v2 workspace or AXON v1) into a v2 workspace, validating shape. */
export function normalize(data) {
  const https = u => typeof u === 'string' && /^https:\/\//i.test(u);
  if (data?.schema === 'axon-workspace-v1' || (Array.isArray(data?.papers) && Array.isArray(data?.protocols) && Array.isArray(data?.runs) && !data.projects)) {
    const p = newProject('Imported AXON workspace');
    p.papers = data.papers.filter(x => typeof x.key === 'string' && typeof x.title === 'string' && https(x.url)).map(x => ({ ...x, sources: x.sources || [x.source].filter(Boolean) }));
    p.protocols = data.protocols.filter(x => typeof x.id === 'string' && typeof x.title === 'string');
    p.runs = data.runs.filter(r => typeof r.tool === 'string' && typeof r.at === 'string').slice(0, MAX_RUNS);
    return { schema: SCHEMA, activeProjectId: p.id, projects: [p], settings: { theme: 'system', density: 'comfortable', welcomed: true } };
  }
  if (data?.schema !== SCHEMA || !Array.isArray(data.projects) || !data.projects.length) throw Error('This is not a Cerebro OS or AXON workspace export.');
  const projects = data.projects.map(p => {
    if (typeof p.id !== 'string' || typeof p.name !== 'string') throw Error('Invalid project record.');
    const base = newProject(p.name);
    const merged = { ...base, ...p };
    for (const k of ['papers', 'protocols', 'runs', 'searches']) if (!Array.isArray(merged[k])) merged[k] = [];
    if (merged.papers.some(x => typeof x.key !== 'string' || typeof x.title !== 'string' || !https(x.url))) throw Error(`Invalid publication record in project “${p.name}”.`);
    if (typeof merged.screening !== 'object' || !merged.screening) merged.screening = {};
    if (typeof merged.identified !== 'object' || !merged.identified) merged.identified = {};
    merged.runs = merged.runs.slice(0, MAX_RUNS);
    return merged;
  });
  return { schema: SCHEMA, activeProjectId: projects.some(p => p.id === data.activeProjectId) ? data.activeProjectId : projects[0].id, projects, settings: { theme: 'system', density: 'comfortable', welcomed: true, ...(data.settings || {}) } };
}

function idb() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) return reject(Error('IndexedDB unavailable'));
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(OBJ);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbGet(key) { const db = await idb(); return new Promise((res, rej) => { const r = db.transaction(OBJ).objectStore(OBJ).get(key); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
async function idbSet(key, value) { const db = await idb(); return new Promise((res, rej) => { const tx = db.transaction(OBJ, 'readwrite'); tx.objectStore(OBJ).put(value, key); tx.oncomplete = () => res(true); tx.onerror = () => rej(tx.error); }); }

const listeners = new Set();
export const store = {
  state: emptyWorkspace(),
  backend: 'memory',
  get project() { return this.state.projects.find(p => p.id === this.state.activeProjectId) || this.state.projects[0]; },
  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  async load() {
    let data = null;
    try { data = await idbGet(KEY); if (data) this.backend = 'IndexedDB'; } catch { /* fall through */ }
    if (!data) { try { const raw = localStorage.getItem(LS_KEY); if (raw) { data = JSON.parse(raw); this.backend = 'localStorage'; } } catch { /* ignore */ } }
    let migrated = false;
    if (!data) { try { const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY)); if (legacy) { data = legacy; migrated = true; } } catch { /* ignore */ } }
    if (data) { try { this.state = normalize(data); } catch { this.state = emptyWorkspace(); } }
    await this.save();
    return { migrated };
  },

  saveTimer: null,
  /** Debounced persistence. Returns a promise for the write. */
  save() {
    clearTimeout(this.saveTimer);
    return new Promise(resolve => {
      this.saveTimer = setTimeout(async () => {
        const snapshot = JSON.parse(JSON.stringify(this.state));
        try { await idbSet(KEY, snapshot); this.backend = 'IndexedDB'; resolve(true); return; } catch { /* fallback */ }
        try { localStorage.setItem(LS_KEY, JSON.stringify(snapshot)); this.backend = 'localStorage'; resolve(true); } catch { this.backend = 'memory'; resolve(false); }
      }, 120);
    });
  },

  update(mutator) {
    mutator(this.project, this.state);
    this.project.updatedAt = now();
    const p = this.save();
    listeners.forEach(fn => fn(this.state));
    return p;
  },

  switchProject(id) { if (this.state.projects.some(p => p.id === id)) { this.state.activeProjectId = id; this.save(); listeners.forEach(fn => fn(this.state)); } },
  createProject(name) { const p = newProject(name); this.state.projects.push(p); this.state.activeProjectId = p.id; this.save(); listeners.forEach(fn => fn(this.state)); return p; },
  deleteProject(id) {
    if (this.state.projects.length < 2) throw Error('Keep at least one project.');
    this.state.projects = this.state.projects.filter(p => p.id !== id);
    if (this.state.activeProjectId === id) this.state.activeProjectId = this.state.projects[0].id;
    this.save(); listeners.forEach(fn => fn(this.state));
  },
  replace(data) { this.state = normalize(data); this.save(); listeners.forEach(fn => fn(this.state)); },
  exportJSON() { return JSON.stringify({ ...this.state, exportedAt: now(), app: 'Cerebro OS' }, null, 2); },
  async estimate() { try { return await navigator.storage?.estimate?.(); } catch { return null; } },
};
