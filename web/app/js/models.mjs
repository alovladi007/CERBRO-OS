// Cerebro OS — main-thread client for the pretrained-model worker.
let worker, seq = 0;
const pending = new Map();
export function modelCall(op, payload = {}, transfer = []) {
  if (!worker) {
    worker = new Worker(new URL('../../lib/models/infer-worker.mjs', import.meta.url), { type: 'module' });
    worker.onmessage = e => { const p = pending.get(e.data.id); if (!p) return; pending.delete(e.data.id); if (e.data.error) { const err = Error(e.data.error); err.code = e.data.code; err.file = e.data.file; p.reject(err); } else p.resolve(e.data.result); };
    worker.onerror = e => { pending.forEach(p => p.reject(Error(e.message || 'The model worker failed to start.'))); pending.clear(); worker = null; };
  }
  const id = ++seq;
  return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); worker.postMessage({ id, op, ...payload }, transfer); });
}
export const getRegistry = () => fetch('/models/registry.json').then(r => r.json());
/** Text handed over from another view (e.g. an abstract in Evidence search). */
export const handoff = { text: null };
