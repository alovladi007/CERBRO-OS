// Stage 2 (docs/ML.md): pretrained models on the self-hosted ONNX Runtime Web.
//  • vendored runtime files match manifest.json (written by scripts/vendor-onnxruntime.mjs);
//  • the runtime runs in Node and reproduces Python onnxruntime on a tiny committed model;
//  • the model registry is complete and integrity checks refuse altered files;
//  • the WordPiece tokenizer matches Hugging Face `tokenizers`, and NER grouping matches the
//    transformers pipeline (reference logits from onnxruntime; tests/fixtures/ner-reference.py).
// Full inference with the 67 MB weights runs in `npm run test:models` (weights are not committed).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as ort from '../web/vendor/onnxruntime-web/1.30.0/ort.wasm.min.mjs';
import { configureOrt, verifyFile, checkPolicy, sha256Hex, ORT_VERSION } from '../web/lib/models/pipeline.mjs';
import { wordPieceTokenizer } from '../web/lib/models/tokenizer.mjs';
import { aggregate } from '../web/lib/models/ner.mjs';

const url = p => new URL(`../${p}`, import.meta.url);
const vendorDir = `web/vendor/onnxruntime-web/${ORT_VERSION}/`;
const registry = JSON.parse(readFileSync(url('web/models/registry.json')));
const NER = JSON.parse(readFileSync(url('tests/fixtures/ner-reference.json')));
const ner = registry.models.find(m => m.id === 'biomedical-ner-all');
const vocab = readFileSync(url('web/models/biomedical-ner-all/vocab.txt'), 'utf8');
const config = JSON.parse(readFileSync(url('web/models/biomedical-ner-all/config.json')));
configureOrt(ort);

test('vendored ONNX Runtime Web files match their manifest (MIT licence included)', () => {
  const man = JSON.parse(readFileSync(url(vendorDir + 'manifest.json')));
  assert.equal(man.version, ORT_VERSION); assert.equal(man.license, 'MIT');
  for (const [name, f] of Object.entries(man.files)) {
    const buf = readFileSync(url(vendorDir + name));
    assert.equal(buf.length, f.bytes, name);
    assert.equal(createHash('sha256').update(buf).digest('hex'), f.sha256, name);
  }
  assert.match(readFileSync(url(vendorDir + 'LICENSE'), 'utf8'), /MIT License/);
  // the runtime must not reach any third-party host
  const code = readFileSync(url(vendorDir + 'ort.wasm.min.mjs'), 'utf8') + readFileSync(url(vendorDir + 'ort-wasm-simd-threaded.mjs'), 'utf8');
  assert.deepEqual([...new Set(code.match(/https?:\/\/[a-z0-9.-]+/gi) || [])], ['https://web.dev']); // a documentation link in an error message
});

test('ONNX Runtime Web reproduces Python onnxruntime on a tiny logistic model', async () => {
  const s = await ort.InferenceSession.create(readFileSync(url('tests/fixtures/tiny-logistic.onnx')));
  const x = new ort.Tensor('float32', Float32Array.from([1, 2, 3, 0, 0, 0, -1.5, 0.5, 2]), [3, 3]);
  const out = await s.run({ x });
  const ref = [0.5621764659881592, 0.4255574941635132, 0.22270014882087708]; // onnxruntime 1.29 (Python)
  Array.from(out.p.data).forEach((v, i) => assert.ok(Math.abs(v - ref[i]) < 1e-7, `${v} vs ${ref[i]}`));
});

test('registry entries are complete, pinned and licensed; bundled files match their hashes', async () => {
  for (const m of registry.models) {
    checkPolicy(registry, m);
    assert.match(m.source.revision, /^[0-9a-f]{40}$/);
    assert.ok(m.intendedUse && m.limitations.length && m.citation && m.evaluatedOn);
    for (const f of m.files.filter(x => x.bundled)) {
      const buf = readFileSync(url(`web/models/${m.id}/${f.name}`));
      assert.equal(await verifyFile(f, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)), f.sha256);
    }
    assert.ok(readFileSync(url(`web/models/${m.id}/LICENSE`), 'utf8').includes('Apache License'));
  }
  assert.throws(() => checkPolicy({ deployment: { commercial: true } }, { ...ner, commercialUse: false }), /does not allow commercial use/);
  assert.throws(() => checkPolicy(registry, { ...ner, files: [{ name: 'x', sha256: 'abc' }] }), /incomplete/);
});

test('integrity check refuses a file whose bytes differ from the registry', async () => {
  const f = { name: 'model.onnx', bytes: 4, sha256: await sha256Hex(new Uint8Array([1, 2, 3, 4])) };
  assert.equal(await verifyFile(f, new Uint8Array([1, 2, 3, 4]).buffer), f.sha256);
  await assert.rejects(verifyFile(f, new Uint8Array([1, 2, 3, 5]).buffer), /SHA-256 mismatch/);
  await assert.rejects(verifyFile(f, new Uint8Array([1, 2, 3]).buffer), /expected 4 bytes/);
});

test('WordPiece tokenizer matches Hugging Face tokenizers (ids, tokens and offsets)', () => {
  const tok = wordPieceTokenizer(vocab, { lowercase: true });
  NER.texts.forEach((t, k) => {
    const [w] = tok.encode(t), ref = NER.tokenizer[k];
    assert.deepEqual(w.tokens, ref.tokens, `tokens ${k}`);
    assert.deepEqual(w.ids, ref.ids, `ids ${k}`);
    assert.deepEqual(w.offsets, ref.offsets, `offsets ${k}`);
  });
});

test('long texts are split into windows at word boundaries, each within the model limit', () => {
  const tok = wordPieceTokenizer(vocab), text = Array.from({ length: 400 }, (_, i) => `Patient ${i} received pembrolizumab.`).join(' ');
  const ws = tok.encode(text, { maxLength: 128 }), flat = tok.tokenize(text);
  assert.ok(ws.length > 1 && ws.every(w => w.ids.length <= 128 && w.tokens[0] === '[CLS]' && w.tokens.at(-1) === '[SEP]'));
  assert.equal(ws.reduce((s, w) => s + w.ids.length - 2, 0), flat.length);
  ws.slice(1).forEach(w => assert.ok(!w.tokens[1].startsWith('##'), 'a window must not start inside a word'));
});

for (const strategy of ['simple', 'first']) {
  test(`NER grouping ("${strategy}") matches the transformers token-classification pipeline`, () => {
    const tok = wordPieceTokenizer(vocab);
    NER.logits.forEach((logits, k) => {
      const text = NER.texts[k], [w] = tok.encode(text), got = aggregate(w, logits, config.id2label, text, strategy), ref = NER.entities[strategy][k];
      assert.equal(got.length, ref.length, `text ${k}: ${got.length} vs ${ref.length} entities`);
      got.forEach((e, i) => {
        assert.equal(e.entity, ref[i].entity); assert.equal(e.start, ref[i].start); assert.equal(e.end, ref[i].end); assert.equal(e.word, ref[i].word);
        assert.ok(Math.abs(e.score - ref[i].score) < 1e-5, `score ${e.score} vs ${ref[i].score}`);
      });
    });
  });
}

test('service worker: every app-shell path exists, and updates keep the verified model cache', () => {
  const sw = readFileSync(url('web/sw.js'), 'utf8'), shell = JSON.parse(sw.match(/const SHELL = (\[[\s\S]*?\]);/)[1].replace(/'/g, '"').replace(/,\s*\]/, ']'));
  for (const p of shell) assert.ok(readFileSync(url(`web${p.endsWith('/') ? p + 'index.html' : p}`)), p);
  assert.match(sw, /!k\.startsWith\('cerebro-models'\)/);
  assert.match(readFileSync(url('web/lib/models/infer-worker.mjs'), 'utf8'), /const CACHE = 'cerebro-models-v1'/);
});
