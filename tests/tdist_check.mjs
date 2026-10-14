import { buildTable } from '../docs/js/tdist.js';
import { readNpy } from './npy.mjs';
import fs from 'node:fs';
const root = process.env.OSU_DIFF_ROOT;
const R = JSON.parse(fs.readFileSync(new URL('../docs/model/reader.json', import.meta.url)));
const t0 = performance.now();
const tab = buildTable(R.t_nus);
const ms = performance.now() - t0;
const ref = readNpy(root + '/data/web-export-r1/ttable.npy').data;
let md = 0, nd = 0;
for (let i = 0; i < ref.length; i++) { const d = Math.abs(ref[i] - tab[i]); if (d > 0) nd++; md = Math.max(md, d); }
console.log(JSON.stringify({ build_ms: Math.round(ms), entries: ref.length, n_differ: nd, max_abs_diff: md }));
