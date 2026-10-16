// Agreement check for the tosu counter's mod readings (any constant rate, HR / EZ, Difficulty Adjust OD): JS/ONNX pipeline
// (docs/js/engine.js, rate / hit / odOverride options) vs the Python reference (research repo analysis/web-tosu-r1/score_mods.py)
// on every chart and condition in tests/fixtures/reference-mods.json.
//   OSU_DIFF_ROOT=<research repository root> node tests/compare_mods.mjs [--part K/N] [--tol 0.01]
// --part K/N scores charts K, K+N, K+2N, ... (K from 0) and writes tests/out/compare-mods-part-K.json, so several processes
// can share the run; without --part every chart is scored. Exit code 1 if any reading differs by more than --tol stars,
// the theta* flag differs, or the accept / reject decision differs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ort from 'onnxruntime-web';
import { createEngine } from '../docs/js/engine.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const docs = path.join(here, '..', 'docs');
const root = process.env.OSU_DIFF_ROOT;
if (!root) { console.error('set OSU_DIFF_ROOT to the research repository root'); process.exit(2); }
const args = process.argv.slice(2);
const arg = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const TOL = Number(arg('--tol', 0.01));
const [K, N] = arg('--part', '0/1').split('/').map(Number);
ort.env.wasm.numThreads = 1;

const engine = await createEngine({
  ort,
  loadBytes: async p => new Uint8Array(fs.readFileSync(path.join(docs, p))),
  loadJson: async p => JSON.parse(fs.readFileSync(path.join(docs, p), 'utf8')),
});
const ref = JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'reference-mods.json'), 'utf8'));
const ext = path.join(root, 'data', 'web-export-r1', 'osz-extract');
const rows = ref.charts.filter((_, i) => i % N === K);
const out = [];
for (const c of rows) {
  const bytes = new Uint8Array(fs.readFileSync(c.member ? path.join(ext, c.sha256 + '.osu') : path.join(root, c.source)));
  for (const cond of ref.conditions) {
    const rc = c[cond.key];
    const t0 = performance.now();
    const r = await engine.scoreBytes(bytes, { withSegments: false, withSub: false, rate: cond.rate, hit: cond.hit,
      odOverride: cond.od === null ? null : cond.od });
    const row = { source: c.source, member: c.member, cond: cond.key, ms: performance.now() - t0 };
    if (rc.error) { row.ref_error = rc.error; row.js_ok = r.ok; row.agree = !r.ok; }
    else if (!r.ok) { row.js_error = r.detail || r.message; row.agree = false; }
    else {
      row.ref_star = rc.star; row.js_star = r.star; row.d_star = r.star - rc.star;
      row.d_theta = r.theta - rc.theta; row.flag_same = (r.thetaFlag || '') === (rc.theta_flag || '');
      row.d_feat = Math.max(...Object.keys(rc.features).map(k => Math.abs(rc.features[k] - r.features[k]) || 0));
      row.agree = Math.abs(row.d_star) <= TOL && row.flag_same;
    }
    out.push(row);
  }
}
fs.mkdirSync(path.join(here, 'out'), { recursive: true });
fs.writeFileSync(path.join(here, 'out', `compare-mods-part-${K}.json`), JSON.stringify(out, null, 0));
const scored = out.filter(r => r.d_star !== undefined);
const summary = {
  part: `${K}/${N}`, rows: out.length, scored: scored.length, ref_errors: out.filter(r => r.ref_error).length,
  disagree: out.filter(r => !r.agree).map(r => [r.source, r.cond, r.d_star, r.js_error || r.ref_error || '']),
  n_exact: scored.filter(r => r.d_star === 0).length,
  max_abs_d_star: Math.max(0, ...scored.map(r => Math.abs(r.d_star))),
  max_abs_d_theta: Math.max(0, ...scored.map(r => Math.abs(r.d_theta))),
  max_abs_d_feature: Math.max(0, ...scored.map(r => r.d_feat)),
};
console.log(JSON.stringify(summary, null, 1));
process.exit(out.every(r => r.agree) ? 0 : 1);
