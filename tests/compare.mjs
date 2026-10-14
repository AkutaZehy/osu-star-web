// Agreement check: JS/ONNX pipeline (docs/js/engine.js, onnxruntime-web wasm, 1 thread) vs the Python reference
// (research repo analysis/tree-topend-r3/score_osu.py, Scorer('P1h')) on every chart in tests/fixtures/reference.json.
//   OSU_DIFF_ROOT=<research repository root> node tests/compare.mjs [--limit N] [--tol 0.01]
// Exit code 1 if any chart differs by more than --tol stars or the accept / reject decision differs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ort from 'onnxruntime-web';
import { unzipSync } from 'fflate';
import { createEngine } from '../docs/js/engine.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const docs = path.join(here, '..', 'docs');
const root = process.env.OSU_DIFF_ROOT;
if (!root) { console.error('set OSU_DIFF_ROOT to the research repository root'); process.exit(2); }
const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? Number(args[args.indexOf(k) + 1]) : d);
const LIMIT = opt('--limit', Infinity), TOL = opt('--tol', 0.01);
ort.env.wasm.numThreads = 1;

const engine = await createEngine({
  ort,
  loadBytes: async p => new Uint8Array(fs.readFileSync(path.join(docs, p))),
  loadJson: async p => JSON.parse(fs.readFileSync(path.join(docs, p), 'utf8')),
});
const ref = JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'reference.json'), 'utf8'));
const oszCache = new Map();
function chartBytes(c) {
  const p = path.join(root, c.source);
  if (!c.member) return new Uint8Array(fs.readFileSync(p));
  if (!oszCache.has(p)) oszCache.set(p, unzipSync(new Uint8Array(fs.readFileSync(p))));
  return oszCache.get(p)[c.member];
}
const rows = [];
let n = 0;
for (const c of ref.charts) {
  if (n++ >= LIMIT) break;
  const bytes = chartBytes(c);
  const t0 = performance.now();
  const r = await engine.scoreBytes(bytes, { withSegments: false });
  const ms = performance.now() - t0;
  const row = { set: c.set, source: c.source, member: c.member, ms, md5: r.md5, nActions: r.nActions };
  if (c.error) { row.ref_error = c.error; row.js_ok = r.ok; row.js_reason = r.reason; row.agree = !r.ok; }
  else if (!r.ok) { row.js_error = r.detail || r.message; row.agree = false; }
  else {
    row.ref_star = c.star; row.js_star = r.star; row.d_star = r.star - c.star;
    row.d_theta = r.theta - c.theta; row.flag_same = (r.thetaFlag || '') === (c.theta_flag || '');
    row.d_acc = Math.max(...c.acc_v1.map((v, i) => Math.abs(v - r.acc[i])));
    row.d_feat = Math.max(...Object.keys(c.features).map(k => Math.abs(c.features[k] - r.features[k]) || 0));
    row.unreliable = !r.reliable; row.flags = r.flags;
    row.agree = Math.abs(row.d_star) <= TOL && row.flag_same;
  }
  rows.push(row);
}
const ok = rows.filter(r => r.d_star !== undefined);
const ad = ok.map(r => Math.abs(r.d_star)).sort((a, b) => a - b);
const q = p => ad.length ? ad[Math.min(ad.length - 1, Math.floor(p * (ad.length - 1)))] : null;
const big = [...ok].sort((a, b) => Math.abs(b.d_star) - Math.abs(a.d_star)).slice(0, 5);
const summary = {
  charts: rows.length, scored: ok.length, ref_errors: rows.filter(r => r.ref_error).length,
  reject_agree: rows.filter(r => r.ref_error).every(r => r.agree),
  js_only_errors: rows.filter(r => r.js_error).map(r => [r.source, r.member, r.js_error]),
  max_abs_d_star: q(1), p99_abs_d_star: q(0.99), median_abs_d_star: q(0.5), n_exact: ad.filter(v => v === 0).length,
  n_over_1e6: ad.filter(v => v > 1e-6).length, n_over_1e3: ad.filter(v => v > 1e-3).length, n_over_tol: ad.filter(v => v > TOL).length,
  max_abs_d_theta: Math.max(...ok.map(r => Math.abs(r.d_theta))), max_abs_d_feature: Math.max(...ok.map(r => r.d_feat)),
  theta_flag_mismatch: ok.filter(r => !r.flag_same).length,
  largest: big.map(r => ({ source: r.source, member: r.member, ref: r.ref_star, js: r.js_star, d: r.d_star })),
  ms_median: [...rows.map(r => r.ms)].sort((a, b) => a - b)[Math.floor(rows.length / 2)],
  ms_max: Math.max(...rows.map(r => r.ms)),
  slowest: [...rows].sort((a, b) => b.ms - a.ms).slice(0, 3).map(r => ({ source: r.source, member: r.member, ms: Math.round(r.ms), actions: r.nActions })),
  by_set: Object.fromEntries(['test_beatmap', 'ranked200'].map(s => [s, {
    n: ok.filter(r => r.set === s).length, max_abs_d_star: Math.max(0, ...ok.filter(r => r.set === s).map(r => Math.abs(r.d_star))) }])),
  flags: Object.fromEntries(['test_beatmap', 'ranked200'].map(s => {
    const g = ok.filter(r => r.set === s);
    const cnt = {};
    for (const r of g) for (const why of (r.flags.outOfRangeReasons || [])) cnt[why] = (cnt[why] || 0) + 1;
    return [s, { n: g.length, unreliable: g.filter(r => r.unreliable).length, sv: g.filter(r => r.flags.sv).length,
      storyboard: g.filter(r => r.flags.storyboard).length, out_of_range: g.filter(r => r.flags.outOfRange).length,
      jack_hint: g.filter(r => r.flags.jackHeavy).length, reasons: cnt }];
  })),
  ms_by_set: Object.fromEntries(['test_beatmap', 'ranked200'].map(s => {
    const m = rows.filter(r => r.set === s).map(r => r.ms).sort((a, b) => a - b);
    return [s, { median: m[Math.floor(m.length / 2)], p90: m[Math.floor(0.9 * (m.length - 1))], max: m[m.length - 1] }];
  })),
  load_ms: engine.loadMs, tol: TOL,
};
fs.mkdirSync(path.join(here, 'out'), { recursive: true });
fs.writeFileSync(path.join(here, 'out', 'compare-rows.json'), JSON.stringify(rows, null, 0));
fs.writeFileSync(path.join(here, 'out', 'compare-summary.json'), JSON.stringify(summary, null, 1));
console.log(JSON.stringify(summary, null, 1));
const fail = rows.some(r => !r.agree);
process.exit(fail ? 1 : 0);
