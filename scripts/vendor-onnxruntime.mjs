#!/usr/bin/env node
// Vendor ONNX Runtime Web (MIT, Microsoft) into web/vendor/onnxruntime-web/<version>/ so the app
// never loads code from a CDN. Downloads the npm tarball, checks npm's published SHA-512
// integrity, extracts only the WebAssembly build, adds the licence files from the matching git
// tag, and writes manifest.json with the SHA-256 of every file (checked by tests/models.test.mjs).
//   node scripts/vendor-onnxruntime.mjs [version]
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = process.argv[2] || '1.30.0';
const FILES = ['ort.wasm.min.mjs', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm'];
const LICENCES = { 'LICENSE': 'LICENSE', 'ThirdPartyNotices.txt': 'ThirdPartyNotices.txt' };

const get = async url => { const r = await fetch(url); if (!r.ok) throw Error(`${url}: HTTP ${r.status}`); return Buffer.from(await r.arrayBuffer()); };
const meta = JSON.parse((await get(`https://registry.npmjs.org/onnxruntime-web/${VERSION}`)).toString());
if (meta.license !== 'MIT') throw Error(`Unexpected licence: ${meta.license}`);
const tgz = await get(meta.dist.tarball);
const [algo, want] = meta.dist.integrity.split('-');
if (algo !== 'sha512' || createHash('sha512').update(tgz).digest('base64') !== want) throw Error('npm integrity check failed');

// minimal ustar reader
const tar = gunzipSync(tgz), found = {};
for (let off = 0; off + 512 <= tar.length;) {
  const name = tar.toString('utf8', off, off + 100).replace(/\0.*$/s, ''), prefix = tar.toString('utf8', off + 345, off + 500).replace(/\0.*$/s, '');
  if (!name) break;
  const size = parseInt(tar.toString('utf8', off + 124, off + 136).replace(/\0.*$/s, '').trim() || '0', 8), full = prefix ? `${prefix}/${name}` : name;
  const base = full.replace(/^package\/dist\//, '');
  if (full.startsWith('package/dist/') && FILES.includes(base)) found[base] = tar.subarray(off + 512, off + 512 + size);
  off += 512 + Math.ceil(size / 512) * 512;
}
for (const f of FILES) if (!found[f]) throw Error(`${f} not found in the tarball`);

const dir = path.join(ROOT, 'web', 'vendor', 'onnxruntime-web', VERSION);
rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
for (const [out, src] of Object.entries(LICENCES)) found[out] = await get(`https://raw.githubusercontent.com/microsoft/onnxruntime/v${VERSION}/${src}`);
const manifest = { package: 'onnxruntime-web', version: VERSION, license: 'MIT', source: meta.dist.tarball, integrity: meta.dist.integrity, files: {} };
for (const [name, buf] of Object.entries(found).sort()) {
  writeFileSync(path.join(dir, name), buf);
  manifest.files[name] = { bytes: buf.length, sha256: createHash('sha256').update(buf).digest('hex') };
}
writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Vendored onnxruntime-web ${VERSION} into ${path.relative(ROOT, dir)} (${Object.keys(manifest.files).length} files).`);
