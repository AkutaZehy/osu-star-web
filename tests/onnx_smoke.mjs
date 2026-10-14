// Smoke + timing: ONNX encoder in onnxruntime-web (wasm) vs the PyTorch check batch from export.py.
import fs from 'node:fs';
import path from 'node:path';
import * as ort from 'onnxruntime-web';
const dir = process.argv[2];
const threads = Number(process.argv[3] || 1);
ort.env.wasm.numThreads = threads;
const rd = (n, T) => { const b = fs.readFileSync(path.join(dir, n + '.bin')); return new T(b.buffer, b.byteOffset, b.byteLength / T.BYTES_PER_ELEMENT); };
const sess = await ort.InferenceSession.create(fs.readFileSync(new URL('../docs/model/encoder.onnx', import.meta.url)), { executionProviders: ['wasm'] });
const W = 3;
const feeds = {
  xw: new ort.Tensor('float32', rd('xw', Float32Array), [W, 256, 17]),
  valid: new ort.Tensor('bool', rd('valid', Uint8Array), [W, 256]),
  m1: new ort.Tensor('bool', rd('m1', Uint8Array), [W, 1, 256, 256]),
  m2: new ort.Tensor('bool', rd('m2', Uint8Array), [W, 1, 256, 256]),
};
const out = await sess.run(feeds);
const ref = rd('l', Float32Array);
let md = 0; const l = out.l.data;
for (let i = 0; i < ref.length; i++) md = Math.max(md, Math.abs(l[i] - ref[i]));
console.log('maxdiff vs torch', md);
for (const Wb of [16, 64]) {
  const xw = new Float32Array(Wb * 256 * 17).map(() => Math.random());
  const v = new Uint8Array(Wb * 256).fill(1);
  const m = new Uint8Array(Wb * 256 * 256).fill(1);
  const f = { xw: new ort.Tensor('float32', xw, [Wb, 256, 17]), valid: new ort.Tensor('bool', v, [Wb, 256]), m1: new ort.Tensor('bool', m, [Wb, 1, 256, 256]), m2: new ort.Tensor('bool', m, [Wb, 1, 256, 256]) };
  await sess.run(f);
  const t = performance.now(); await sess.run(f); console.log('W', Wb, 'threads', threads, 'ms', (performance.now() - t).toFixed(0), 'ms/window', ((performance.now() - t) / Wb).toFixed(1));
}
