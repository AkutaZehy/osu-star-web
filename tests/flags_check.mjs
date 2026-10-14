// SV / storyboard rules vs the research table (star-cnn-r1 charts.csv frac_scroll_dev10, sb_lines) on all ranked charts in
// the fixture plus N more random ranked charts.   OSU_DIFF_ROOT=<research root> node tests/flags_check.mjs [N]
import fs from 'node:fs';
import path from 'node:path';
import { svFrac, sbLines } from '../docs/js/osu.js';
const root = process.env.OSU_DIFF_ROOT;
const N = Number(process.argv[2] || 2000);
const lines = fs.readFileSync(path.join(root, 'data/star-cnn-r1/charts.csv'), 'utf8').trim().split(/\r?\n/);
const head = lines[0].split(',');
const ib = head.indexOf('beatmap_id'), isv = head.indexOf('frac_scroll_dev10'), isb = head.indexOf('sb_lines');
let n = 0, maxd = 0, svDis = 0, sbDis = 0, missing = 0, nsv = 0, nsb = 0;
const step = Math.max(1, Math.floor((lines.length - 1) / N));
for (let i = 1; i < lines.length; i += step) {
  const c = lines[i].split(',');
  const p = path.join(root, 'data/crowd-chart-model-20261009/osu', c[ib] + '.osu');
  if (!fs.existsSync(p)) { missing++; continue; }
  const t = new TextDecoder('utf-8').decode(fs.readFileSync(p));
  const sv = svFrac(t), sb = sbLines(t);
  const rsv = c[isv] === '' ? null : Number(c[isv]), rsb = c[isb] === '' ? null : Number(c[isb]);
  n++;
  if (sv !== null && rsv !== null) maxd = Math.max(maxd, Math.abs(sv - rsv));
  if (((sv || 0) > 0.1) !== ((rsv || 0) > 0.1)) svDis++;
  if (((sb || 0) >= 1) !== ((rsb || 0) >= 1)) sbDis++;
  if ((rsv || 0) > 0.1) nsv++;
  if ((rsb || 0) >= 1) nsb++;
}
console.log(JSON.stringify({ charts: n, missing, sv_flag_ref: nsv, sb_flag_ref: nsb, sv_flag_disagree: svDis, sb_flag_disagree: sbDis, max_abs_d_svfrac: maxd }));
