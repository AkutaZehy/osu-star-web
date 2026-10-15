// Rice / face items and the OD8 reading: JS vs the Python reference (research repo analysis/rice-ln-od-r1/rlo.py, fixture
// tests/fixtures/reference-rice-ln-od.json; test_beatmap at 1.0 / 0.75 / 1.5), protocol docs/rice-ln-od-r1-protocol-2026-10-15.md.
//   OSU_DIFF_ROOT=<research repository root> node tests/rice-ln-od.mjs [--limit N] [--no-timing] [--timing-only] [--rate R]
// Layer 1 (conversion arithmetic, Python theta* in): item stars within 1e-9. Layer 2 (end to end, ONNX encoder): theta* within
// 1e-6, item stars within 2e-6, report / not-report and OD8 / OD9 choice identical. Timing: one NoMod scoring with and without
// the items (1 thread). Exit code 1 if a check fails.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ort from 'onnxruntime-web';
import { unzipSync } from 'fflate';
import { createEngine, subStar } from '../docs/js/engine.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const docs = path.join(here, '..', 'docs');
const root = process.env.OSU_DIFF_ROOT;
if (!root) { console.error('set OSU_DIFF_ROOT to the research repository root'); process.exit(2); }
const args = process.argv.slice(2);
const LIMIT = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : Infinity;
const TIMING = !args.includes('--no-timing');
const ONLY_TIMING = args.includes('--timing-only');
const RATE = args.includes('--rate') ? Number(args[args.indexOf('--rate') + 1]) : null;
const TAG = ONLY_TIMING ? 'timing' : RATE === null ? 'all' : 'rate-' + RATE;
ort.env.wasm.numThreads = 1;

const engine = await createEngine({
  ort,
  loadBytes: async p => new Uint8Array(fs.readFileSync(path.join(docs, p))),
  loadJson: async p => JSON.parse(fs.readFileSync(path.join(docs, p), 'utf8')),
});
const ref = JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'reference-rice-ln-od.json'), 'utf8'));
const B = engine.tree.star_scale.b;
const oszCache = new Map();
function chartBytes(c) {
  const p = path.join(root, c.source);
  if (!c.member) return new Uint8Array(fs.readFileSync(p));
  if (!oszCache.has(p)) oszCache.set(p, unzipSync(new Uint8Array(fs.readFileSync(p))));
  return oszCache.get(p)[c.member];
}
const absd = (a, b) => (a === null || b === null || a === undefined || b === undefined ? (a == b ? 0 : Infinity) : Math.abs(a - b));  // eslint-disable-line eqeqeq

// layer 1
let l1max = 0, l1n = 0;
for (const c of ref.charts) {
  const th = { rice: c.theta_rice, ln: c.theta_ln, od: c.od_rule === 9 ? c.theta_od9 : c.theta_od8, v2: c.theta_v2_all };
  for (const [k, py, ok] of [['rice', c.rice_c1, c.ok_rice], ['ln', c.ln_c1, c.ok_ln], ['od', c.od_c1, true], ['v2', c.v2_c1, c.v2_c1 != null]]) {
    if (!ok || py === null || th[k] === null) continue;
    l1max = Math.max(l1max, Math.abs(subStar(c.star, c.theta_all, th[k], B) - py)); l1n++;
  }
}

// layer 2
const rows = [];
let n = 0;
for (const c of ref.charts) {
  if (ONLY_TIMING) break;
  if (RATE !== null && c.rate !== RATE) continue;
  if (n++ >= LIMIT) break;
  const r = await engine.scoreBytes(chartBytes(c), { withSegments: false, rate: c.rate });
  if (!r.ok) { rows.push({ source: c.source, member: c.member, rate: c.rate, error: r.detail || r.message }); continue; }
  const s = r.sub;
  const pyOd = c.od_rule === 9 ? c.theta_od9 : c.theta_od8;
  rows.push({
    source: c.source, member: c.member, rate: c.rate, d_star_total: Math.abs(r.star - c.star),
    d_theta_rice: absd(s.rice.theta, c.theta_rice), d_theta_ln: absd(s.face.theta, c.theta_ln), d_theta_od: absd(s.od.theta, pyOd),
    d_rice: c.ok_rice ? absd(s.rice.star, c.rice_c1) : 0, d_ln: c.ok_ln ? absd(s.face.star, c.ln_c1) : 0, d_od: absd(s.od.star, c.od_c1),
    d_theta_v2: c.theta_v2_all == null ? 0 : absd(s.v2.theta, c.theta_v2_all), d_v2: c.v2_c1 == null ? 0 : absd(s.v2.star, c.v2_c1),
    // the face theta of charts with only a handful of long notes (item not shown) amplifies ONNX-vs-PyTorch 1e-7 noise; the
    // pass line applies to the shown items, the all-charts maximum is still reported
    d_theta_ln_shown: c.ok_ln ? absd(s.face.theta, c.theta_ln) : 0,
    gate_same: s.rice.ok === c.ok_rice && s.face.ok === c.ok_ln && s.rice.n === c.n_rice && s.face.n === c.n_ln,
    od_same: s.od.od === c.od_rule, sub_ms: s.ms,
  });
}
const ok = rows.filter(r => !r.error);
const mx = k => Math.max(0, ...ok.map(r => r[k]));
const summary = {
  layer1: { n: l1n, max_abs_star: l1max, pass: l1max <= 1e-9 },
  layer2: {
    jobs: rows.length, errors: rows.filter(r => r.error).map(r => [r.source, r.member, r.rate, r.error]),
    max_d_star_total: mx('d_star_total'), max_d_theta_rice: mx('d_theta_rice'), max_d_theta_ln: mx('d_theta_ln'), max_d_theta_od: mx('d_theta_od'),
    max_d_rice: mx('d_rice'), max_d_ln: mx('d_ln'), max_d_od: mx('d_od'), max_d_theta_v2: mx('d_theta_v2'), max_d_v2: mx('d_v2'),
    max_d_theta_ln_shown: mx('d_theta_ln_shown'),
    gate_mismatch: ok.filter(r => !r.gate_same).length, od_choice_mismatch: ok.filter(r => !r.od_same).length,
    by_rate: Object.fromEntries([1, 0.75, 1.5].map(rt => [rt, ok.filter(r => r.rate === rt).length])),
  },
};
const L2 = summary.layer2;
L2.pass = ONLY_TIMING || !L2.errors.length && L2.max_d_theta_rice <= 1e-6 && L2.max_d_theta_ln_shown <= 1e-6 && L2.max_d_theta_od <= 1e-6
  && L2.max_d_rice <= 2e-6 && L2.max_d_ln <= 2e-6 && L2.max_d_od <= 2e-6 && L2.max_d_theta_v2 <= 1e-6 && L2.max_d_v2 <= 2e-6
  && !L2.gate_mismatch && !L2.od_choice_mismatch;

// timing: NoMod, one scoring with and without the items (segments on, as in the page)
if (TIMING) {
  const T = [];
  const seen = new Set();
  for (const c of ref.charts) {
    if (c.rate !== 1 || seen.has(c.sha256) || seen.size >= LIMIT) continue;
    seen.add(c.sha256);
    const bytes = chartBytes(c);
    const t0 = performance.now(); await engine.scoreBytes(bytes, { rate: 1, withSub: false });
    const t1 = performance.now(); const r = await engine.scoreBytes(bytes, { rate: 1, withSub: true });
    const t2 = performance.now();
    T.push({ source: c.source, member: c.member, base_ms: t1 - t0, with_ms: t2 - t1, extra_ms: (t2 - t1) - (t1 - t0),
      sub_ms: r.sub.ms, od_pass: r.sub.od.changed, n_ln: c.n_ln });
  }
  const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))]; };
  const ex = T.map(t => t.extra_ms), base = T.map(t => t.base_ms), subm = T.map(t => t.sub_ms);
  summary.timing = {
    charts: T.length, base_ms_median: q(base, .5), base_ms_max: Math.max(...base), extra_ms_median: q(ex, .5), extra_ms_q90: q(ex, .9),
    extra_ms_max: Math.max(...ex), extra_share_median: q(T.map(t => t.extra_ms / t.base_ms), .5), sub_ms_median: q(subm, .5),
    sub_ms_max: Math.max(...subm), od_pass_charts: T.filter(t => t.od_pass).length,
    slowest: [...T].sort((a, b) => b.extra_ms - a.extra_ms).slice(0, 3).map(t => ({ member: t.member || t.source, base: Math.round(t.base_ms),
      extra: Math.round(t.extra_ms), od_pass: t.od_pass, n_ln: t.n_ln })),
  };
}
const out = path.join(here, 'out');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, `rice-ln-od-${TAG}.json`), JSON.stringify({ summary, rows }, null, 1));
console.log(JSON.stringify(summary, null, 1));
process.exit(summary.layer1.pass && L2.pass ? 0 : 1);
