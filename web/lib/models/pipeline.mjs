// Cerebro OS — pretrained-model pipelines on ONNX Runtime Web (Stage 2, docs/ML.md).
// Shared by the inference worker (browser) and the tests (Node): integrity checks, session
// creation and the token-classification pipeline. No network access happens here.
import { wordPieceTokenizer } from './tokenizer.mjs';
import { aggregate } from './ner.mjs';

export const ORT_VERSION = '1.30.0';

/** SHA-256 hex digest of an ArrayBuffer / typed array (Web Crypto; browsers, workers, Node ≥ 19). */
export async function sha256Hex(buf) {
  const d = await crypto.subtle.digest('SHA-256', buf instanceof ArrayBuffer ? buf : buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Refuse bytes whose SHA-256 differs from the registry entry. */
export async function verifyFile(entry, buf) {
  if (buf.byteLength !== entry.bytes) throw Error(`${entry.name}: expected ${entry.bytes.toLocaleString()} bytes, got ${buf.byteLength.toLocaleString()}. This is not the registered file.`);
  const h = await sha256Hex(buf);
  if (h !== entry.sha256) throw Error(`${entry.name}: SHA-256 mismatch (expected ${entry.sha256.slice(0, 12)}…, got ${h.slice(0, 12)}…). The file was refused.`);
  return h;
}

/** Registry checks that do not depend on the files: licence and deployment policy. */
export function checkPolicy(registry, model) {
  if (!model.license || !model.source?.revision || !model.files?.every(f => /^[0-9a-f]{64}$/.test(f.sha256))) throw Error(`${model.id}: registry entry is incomplete (licence, pinned revision and SHA-256 per file are required).`);
  if (registry.deployment?.commercial && !model.commercialUse) throw Error(`${model.id}: its licence (${model.license}) does not allow commercial use, and this deployment is commercial.`);
}

/** Configure ORT for a single-threaded WebAssembly session. */
export function configureOrt(ort, wasmBase) {
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  if (wasmBase) ort.env.wasm.wasmPaths = wasmBase;
  ort.env.logLevel = 'error';
  return ort;
}

/** Token-classification (NER) pipeline. files: { 'model.onnx': ArrayBuffer, 'vocab.txt': string, 'config.json': object } */
export async function createNerPipeline(ort, model, files) {
  const session = await ort.InferenceSession.create(new Uint8Array(files['model.onnx']), { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  const tok = wordPieceTokenizer(files['vocab.txt'], { lowercase: model.tokenizer.lowercase });
  const id2label = files['config.json'].id2label, nLabels = Object.keys(id2label).length;
  async function run(text, { maxLength = model.tokenizer.maxLength, strategy = 'first' } = {}) {
    const t0 = Date.now(), windows = tok.encode(text, { maxLength }), entities = [];
    let tokens = 0;
    for (const w of windows) {
      if (w.ids.length <= 2) continue;
      const L = w.ids.length, ids = new ort.Tensor('int64', BigInt64Array.from(w.ids, BigInt), [1, L]), mask = new ort.Tensor('int64', new BigInt64Array(L).fill(1n), [1, L]);
      const out = await session.run({ input_ids: ids, attention_mask: mask }), data = out.logits.data;
      const logits = Array.from({ length: L }, (_, i) => Array.from(data.subarray(i * nLabels, (i + 1) * nLabels)));
      entities.push(...aggregate(w, logits, id2label, text, strategy));
      tokens += L - 2;
    }
    return { entities, windows: windows.length, tokens, strategy, ms: Date.now() - t0 };
  }
  return { run, labels: id2label, tokenizer: tok, session };
}
