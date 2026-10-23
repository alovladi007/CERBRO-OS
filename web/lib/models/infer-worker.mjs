// Cerebro OS — pretrained-model worker. Loads registered models (from this site or from bytes the
// user chose on their device), verifies every file's SHA-256, caches verified files in Cache
// Storage, and runs inference off the UI thread. It only fetches same-origin /models/ paths.
import * as ort from '../../vendor/onnxruntime-web/1.30.0/ort.wasm.min.mjs';
import { configureOrt, verifyFile, checkPolicy, createNerPipeline } from './pipeline.mjs';

configureOrt(ort, new URL('../../vendor/onnxruntime-web/1.30.0/', import.meta.url).href);
const CACHE = 'cerebro-models-v1', loaded = new Map();
const cacheKey = f => `/__model-cache/${f.sha256}`;
let registry = null;

async function getRegistry() { return registry ??= await (await fetch(new URL('../../models/registry.json', import.meta.url))).json(); }
async function cached(f) { try { const c = await caches.open(CACHE); const r = await c.match(cacheKey(f)); return r ? await r.arrayBuffer() : null; } catch { return null; } }
async function putCache(f, buf) { try { const c = await caches.open(CACHE); await c.put(cacheKey(f), new Response(buf)); } catch { /* storage may be unavailable */ } }

async function fileBytes(model, f, provided) {
  if (provided?.[f.name]) { await verifyFile(f, provided[f.name]); await putCache(f, provided[f.name]); return { buf: provided[f.name], from: 'your device' }; }
  const c = await cached(f);
  if (c && c.byteLength === f.bytes) { await verifyFile(f, c); return { buf: c, from: 'browser cache' }; }
  const r = await fetch(new URL(`../../models/${model.id}/${f.name}`, import.meta.url));
  if (!r.ok) { const e = Error(`${f.name} is not hosted on this site.`); e.code = 'NOT_HOSTED'; e.file = f.name; throw e; }
  const buf = await r.arrayBuffer();
  await verifyFile(f, buf); await putCache(f, buf);
  return { buf, from: 'this site' };
}

async function status(id) {
  const reg = await getRegistry(), m = reg.models.find(x => x.id === id), out = {};
  for (const f of m.files) {
    if (await cached(f)) { out[f.name] = 'cached'; continue; }
    try { const r = await fetch(new URL(`../../models/${m.id}/${f.name}`, import.meta.url), { method: 'HEAD' }); out[f.name] = r.ok ? 'hosted' : 'missing'; } catch { out[f.name] = 'missing'; }
  }
  return { id, files: out, loaded: loaded.has(id) };
}

async function load(id, provided) {
  const reg = await getRegistry(), m = reg.models.find(x => x.id === id);
  if (!m) throw Error(`Unknown model: ${id}`);
  checkPolicy(reg, m);
  if (loaded.has(id)) return { id, sources: loaded.get(id).sources };
  const t0 = Date.now(), files = {}, sources = {};
  for (const f of m.files) { const { buf, from } = await fileBytes(m, f, provided); sources[f.name] = from; files[f.name] = f.name.endsWith('.json') ? JSON.parse(new TextDecoder().decode(buf)) : f.name.endsWith('.txt') ? new TextDecoder().decode(buf) : buf; }
  if (m.task !== 'token-classification') throw Error(`Task ${m.task} is not supported yet.`);
  const pipe = await createNerPipeline(ort, m, files);
  loaded.set(id, { pipe, sources });
  return { id, sources, ms: Date.now() - t0, weightsSha256: m.files.find(f => f.name.endsWith('.onnx')).sha256 };
}

self.onmessage = async e => {
  const { id, op, model, files, text, strategy } = e.data;
  try {
    let result;
    if (op === 'status') result = await status(model);
    else if (op === 'load') result = await load(model, files);
    else if (op === 'run') { if (!loaded.has(model)) await load(model); result = await loaded.get(model).pipe.run(text, { strategy }); }
    else if (op === 'clear') { await caches.delete(CACHE); loaded.clear(); result = { cleared: true }; }
    else throw Error(`Unknown operation: ${op}`);
    self.postMessage({ id, result });
  } catch (err) { self.postMessage({ id, error: err.message || String(err), code: err.code, file: err.file }); }
};
