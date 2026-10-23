#!/usr/bin/env node
// Full-inference check for registered models (needs the weights: npm run fetch:models).
// Runs the Cerebro OS pipeline on ONNX Runtime Web (WebAssembly, as in the browser) and compares
// token labels with the Python references in tests/fixtures/ner-reference.json (int8 and fp32).
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ort from '../web/vendor/onnxruntime-web/1.30.0/ort.wasm.min.mjs';
import { configureOrt, verifyFile, createNerPipeline } from '../web/lib/models/pipeline.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reg = JSON.parse(readFileSync(path.join(ROOT, 'web/models/registry.json'), 'utf8'));
const REF = JSON.parse(readFileSync(path.join(ROOT, 'tests/fixtures/ner-reference.json'), 'utf8'));
const m = reg.models.find(x => x.id === 'biomedical-ner-all'), dir = path.join(ROOT, 'web/models', m.id);
if (!existsSync(path.join(dir, 'model.onnx'))) { console.error('Model weights are not present. Run `npm run fetch:models` first.'); process.exit(1); }
configureOrt(ort);
const ab = p => { const b = readFileSync(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const weights = ab(path.join(dir, 'model.onnx'));
await verifyFile(m.files.find(f => f.name === 'model.onnx'), weights);
const pipe = await createNerPipeline(ort, m, { 'model.onnx': weights, 'vocab.txt': readFileSync(path.join(dir, 'vocab.txt'), 'utf8'), 'config.json': JSON.parse(readFileSync(path.join(dir, 'config.json'), 'utf8')) });
// Dynamic int8 models are not bit-reproducible across runtimes: integer kernels differ (Python
// onnxruntime's own optimisation levels disagree by several logits). The yardstick is therefore the
// full-precision model: token labels from this runtime must agree with fp32 at least as well as
// Python onnxruntime's int8 labels do (within one percentage point), and on at least 90% of tokens.
const argmax = row => row.reduce((k, v, j) => (v > row[k] ? j : k), 0);
let fail = 0;
for (let k = 0; k < REF.logits.length; k++) {
  const ids = REF.tokenizer[k].ids, L = ids.length;
  const out = await pipe.session.run({ input_ids: new ort.Tensor('int64', BigInt64Array.from(ids, BigInt), [1, L]), attention_mask: new ort.Tensor('int64', new BigInt64Array(L).fill(1n), [1, L]) });
  const d = out.logits.data, C = d.length / L, web = Array.from({ length: L }, (_, i) => Array.from(d.subarray(i * C, (i + 1) * C)));
  let maxDiff = 0, agreePy = 0, agreeWebF = 0, agreePyF = 0;
  for (let i = 0; i < L; i++) {
    for (let c = 0; c < C; c++) maxDiff = Math.max(maxDiff, Math.abs(web[i][c] - REF.logits[k][i][c]));
    const w = argmax(web[i]), p = argmax(REF.logits[k][i]), f = argmax(REF.logits_fp32[k][i]);
    agreePy += w === p; agreeWebF += w === f; agreePyF += p === f;
  }
  const ok = agreeWebF / L >= agreePyF / L - 0.01 && agreeWebF / L >= 0.9;
  if (!ok) fail++;
  const ents = (await pipe.run(REF.texts[k], { strategy: 'first' })).entities;
  console.log(`${ok ? 'ok  ' : 'FAIL'} text ${k}: ${L} tokens · labels agree with fp32 ${(100 * agreeWebF / L).toFixed(1)}% (Python int8 ${(100 * agreePyF / L).toFixed(1)}%) · with Python int8 ${(100 * agreePy / L).toFixed(1)}% · max |Δlogit| vs Python int8 ${maxDiff.toFixed(3)} · ${ents.length} entities`);
}
process.exit(fail ? 1 : 0);
