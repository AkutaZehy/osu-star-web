// Agreement check for HT (0.75x) / DT (1.5x): JS/ONNX pipeline (docs/js/engine.js, rate option) vs the Python reference
// (research repo analysis/web-rate-r1/score_rate.py, RateScorer) on every chart in tests/fixtures/reference-rates.json.
//   OSU_DIFF_ROOT=<research repository root> node tests/compare_rates.mjs [--limit N] [--tol 0.01]
// Exit code 1 if any chart differs by more than --tol stars, the theta* flag differs, or the accept / reject decision differs.
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
const ref = JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'reference-rates.json'), 'utf8'));
const oszCache = new Map();
function chartBytes(c) {
  const p = path.join(root, c.source);
  if (!c.member) return new Uint8Array(fs.readFileSync(p));
  if (!oszCache.has(p)) oszCache.set(p, unzipSync(new Uint8Array(fs.readFileSync(p))));
  return oszCache.get(p)[c.member];
}
const RATES = { ht: 0.75, dt: 1.5 };
const rows = [];
let n = 0;
for (const c of ref.charts) {
  if (n++ >= LIMIT) break;
  const bytes = chartBytes(c);
  for (const [key, rate] of Object.entries(RATES)) {
    const rc = c[key];
    const t0 = performance.now();
    const r = await engine.scoreBytes(bytes, { withSegments: false, rate });
    const row = { set: c.set, source: c.source, member: c.member, rate, ms: performance.now() - t0 };
    if (rc.error) { row.ref_error = rc.error; row.js_ok = r.ok; row.agree = !r.ok; }
    else if (!r.ok) { row.js_error = r.detail || r.message; row.agree = false; }
    else {
      row.ref_star = rc.star; row.js_star = r.star; row.d_star = r.star - rc.star;
      row.d_theta = r.theta - rc.theta; row.flag_same = (r.thetaFlag || '') === (rc.theta_flag || '');
      row.d_feat = Math.max(...Object.keys(rc.features).map(k => Math.abs(rc.features[k] - r.features[k]) || 0));
      row.unreliable = !r.reliable; row.reasons = r.flags.outOfRangeReasons;
      row.agree = Math.abs(row.d_star) <= TOL && row.flag_same;
    }
    rows.push(row);
  }
}
const summary = { tol: TOL, by_rate: {} };
for (const rate of Object.values(RATES)) {
  const g = rows.filter(r => r.rate === rate);
  const ok = g.filter(r => r.d_star !== undefined);
  const ad = ok.map(r => Math.abs(r.d_star)).sort((a, b) => a - b);
  const reasons = {};
  for (const r of ok) for (const why of (r.reasons || [])) reasons[why] = (reasons[why] || 0) + 1;
  summary.by_rate[rate] = {
    charts: g.length, scored: ok.length, ref_errors: g.filter(r => r.ref_error).length,
    reject_agree: g.filter(r => r.ref_error).every(r => r.agree),
    js_only_errors: g.filter(r => r.js_error).map(r => [r.source, r.member, r.js_error]),
    max_abs_d_star: ad[ad.length - 1], median_abs_d_star: ad[Math.floor(ad.length / 2)], n_exact: ad.filter(v => v === 0).length,
    n_over_1e6: ad.filter(v => v > 1e-6).length, n_over_tol: ad.filter(v => v > TOL).length,
    max_abs_d_theta: Math.max(...ok.map(r => Math.abs(r.d_theta))), max_abs_d_feature: Math.max(...ok.map(r => r.d_feat)),
    theta_flag_mismatch: ok.filter(r => !r.flag_same).length,
    unreliable: ok.filter(r => r.unreliable).length, reasons,
    largest: [...ok].sort((a, b) => Math.abs(b.d_star) - Math.abs(a.d_star)).slice(0, 3)
      .map(r => ({ source: r.source, member: r.member, ref: r.ref_star, js: r.js_star, d: r.d_star })),
    ms_median: g.map(r => r.ms).sort((a, b) => a - b)[Math.floor(g.length / 2)],
  };
}
fs.mkdirSync(path.join(here, 'out'), { recursive: true });
fs.writeFileSync(path.join(here, 'out', 'compare-rates-rows.json'), JSON.stringify(rows, null, 0));
fs.writeFileSync(path.join(here, 'out', 'compare-rates-summary.json'), JSON.stringify(summary, null, 1));
console.log(JSON.stringify(summary, null, 1));
process.exit(rows.some(r => !r.agree) ? 1 : 0);
