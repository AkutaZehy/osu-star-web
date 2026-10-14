// .osu parsing, ported from the research code (same rules, same rejections).
//   loadChart     <- tools/chart_star_public.py load_chart + _notes   (notes for the encoder / theta*)
//   parseOsuFeat  <- analysis/star-cnn-r1/sc_common.py parse_osu      (notes for the 22 hand features)
//   svFrac        <- docs/analysis/model-redesign-2026-09-26/s3_chartmeta.py parse -> frac_scroll_dev10
//   sbLines       <- analysis/r2-retrain-20261010/gimmick-flags-r1/features.py events_scan -> sb_lines
import { splitlines, fileLines, pyFloat, pyInt, round6, ssRight, median } from './pyutil.js';

export class ChartError extends Error {
  constructor(reason, message) { super(message); this.reason = reason; }
}

export function metadata(text) {
  const out = {};
  let sec = '';
  for (const raw of fileLines(text)) {
    const line = raw.trim();
    if (!line || line.startsWith('//')) continue;
    if (line.startsWith('[')) { sec = line; if (sec === '[HitObjects]') break; continue; }
    if ((sec === '[Metadata]' || sec === '[General]' || sec === '[Difficulty]') && line.includes(':')) {
      const k = line.slice(0, line.indexOf(':')).trim();
      const v = line.slice(line.indexOf(':') + 1).trim();
      out[k] = v;
    }
  }
  return {
    title: out.TitleUnicode || out.Title || '', titleAscii: out.Title || '', artist: out.ArtistUnicode || out.Artist || '',
    version: out.Version || '', creator: out.Creator || '', beatmapId: out.BeatmapID && out.BeatmapID !== '0' ? out.BeatmapID : null,
    beatmapSetId: out.BeatmapSetID && out.BeatmapSetID !== '-1' ? out.BeatmapSetID : null,
    mode: out.Mode !== undefined ? out.Mode : null, keys: out.CircleSize !== undefined ? out.CircleSize : null,
  };
}

// chart_star_public.load_chart: notes [start, end, col, hold] (relative, rounded, sorted by (start, col)), declared OD
export function loadChart(text) {
  const fields = {};
  const notes = [];
  let section = '';
  for (const raw of splitlines(text)) {
    const line = raw.trim();
    if (!line || line.startsWith('//')) continue;
    if (line.startsWith('[')) { section = line; continue; }
    if ((section === '[General]' || section === '[Difficulty]') && line.includes(':')) {
      const i = line.indexOf(':');
      fields[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    } else if (section === '[HitObjects]') {
      const p = line.split(',');
      if (p.length < 4) throw new ChartError('parse_error', 'hit object line too short');
      const x = pyFloat(p[0]), start = pyFloat(p[2]), kind = pyInt(p[3]);
      if (!(x >= 0 && x <= 512) || !(kind & (1 | 128))) throw new ChartError('parse_error', 'Unsupported hit object');
      const hold = (kind & 128) !== 0;
      if (hold && p.length < 6) throw new ChartError('parse_error', 'hold note without end time');
      const end = hold ? pyFloat(p[5].split(':')[0]) : start;
      const col = Math.min(3, Math.trunc(x * 4 / 512));
      notes.push([start, end, col, hold ? 1 : 0]);
    }
  }
  const cs = fields.CircleSize !== undefined ? pyFloat(fields.CircleSize) : NaN;
  if (fields.Mode !== '3' || cs !== 4) throw new ChartError('not_4k', 'Only explicitly declared osu!mania 4K charts are supported');
  const od = fields.OverallDifficulty !== undefined ? pyFloat(fields.OverallDifficulty) : NaN;
  // _notes
  if (!notes.length) throw new ChartError('too_few_notes', 'no notes');
  let mn = Infinity;
  for (const n of notes) {
    if (!Number.isFinite(n[0]) || !Number.isFinite(n[1])) throw new ChartError('parse_error', 'non-finite note time');
    if (n[1] < n[0]) throw new ChartError('parse_error', 'Invalid duration or 4K column');
    if (n[3] === 0 && n[1] !== n[0]) throw new ChartError('parse_error', 'Inconsistent hold flag');
    if (n[0] < mn) mn = n[0];
  }
  for (const n of notes) { n[0] = round6(n[0] - mn); n[1] = round6(n[1] - mn); }
  const idx = notes.map((_, i) => i);
  idx.sort((a, b) => (notes[a][0] - notes[b][0]) || (notes[a][2] - notes[b][2]) || (a - b));
  return { notes: idx.map(i => notes[i]), od };
}

// sc_common.parse_osu (text-mode lines, utf-8 with replacement)
export function parseOsuFeat(text) {
  let od = null, cs = null, mode = null, sec = null;
  const notes = [];
  for (const raw of fileLines(text)) {
    const line = raw.trim();
    if (!line || line.startsWith('//')) continue;
    if (line.startsWith('[')) { sec = line; continue; }
    if (sec === '[General]' && line.startsWith('Mode:')) mode = pyInt(line.split(':')[1]);
    else if (sec === '[Difficulty]') {
      if (line.startsWith('OverallDifficulty:')) od = pyFloat(line.split(':')[1]);
      else if (line.startsWith('CircleSize:')) cs = pyFloat(line.split(':')[1]);
    } else if (sec === '[HitObjects]') {
      const p = line.split(',');
      if (p.length < 5) continue;
      const x = pyFloat(p[0]), t = Math.trunc(pyFloat(p[2])), typ = pyInt(p[3]);
      const col = Math.min(3, Math.max(0, Math.trunc(Math.floor(x * 4 / 512))));
      let end = -1;
      if ((typ & 128) && p.length > 5) {
        end = Math.trunc(pyFloat(p[5].split(':')[0]));
        if (end <= t) end = -1;
      }
      notes.push([t, col, end]);
    }
  }
  return { od, cs, mode, notes };
}

// s3_chartmeta.parse -> frac_scroll_dev10 (null when no red line or no notes)
export function svFrac(text) {
  const tps = [], heads = [];
  let section = '';
  for (const raw of splitlines(text)) {
    const line = raw.trim();
    if (!line || line.startsWith('//')) continue;
    if (line.startsWith('[')) { section = line; continue; }
    if (section === '[TimingPoints]') {
      const p = line.split(',');
      if (p.length < 2) continue;
      tps.push([pyFloat(p[0]), pyFloat(p[1]), p.length > 6 ? pyInt(p[6]) : 1]);
    } else if (section === '[HitObjects]') {
      heads.push(pyFloat(line.split(',')[2]));
    }
  }
  heads.sort((a, b) => a - b);
  const reds = tps.filter(t => t[2] === 1 && t[1] > 0).map(t => [t[0], t[1]]);
  const greens = tps.filter(t => t[2] === 0 && t[1] < 0).map(t => [t[0], -100 / t[1]]);
  greens.sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
  if (!reds.length || !heads.length) return null;
  reds.sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
  const rt = reds.map(r => r[0]), rb = reds.map(r => r[1]);
  const gt = greens.length ? greens.map(g => g[0]) : [-1e18];
  const gv = greens.length ? greens.map(g => g[1]) : [1];
  const n = heads.length;
  const bl = new Float64Array(n), ri = new Int32Array(n);
  const cnt = new Map();
  for (let k = 0; k < n; k++) {
    ri[k] = Math.max(ssRight(rt, heads[k]) - 1, 0);
    bl[k] = rb[ri[k]];
    const key = Math.round(60000 / bl[k] * 100) / 100;   // np.round(., 2) (half-even ties are irrelevant for the mode)
    cnt.set(key, (cnt.get(key) || 0) + 1);
  }
  let mainBpm = null, best = -1;
  for (const [k, c] of cnt) if (c > best) { best = c; mainBpm = k; }   // first maximum in insertion order (Counter)
  const ls = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const bpm = 60000 / bl[k];
    const gi = ssRight(gt, heads[k]) - 1;
    let sv = gi >= 0 ? gv[Math.max(gi, 0)] : 1;
    const gtime = gi >= 0 ? gt[Math.max(gi, 0)] : -1e18;
    if (rt[ri[k]] > gtime) sv = 1;
    const scroll = Math.min(Math.max(sv, 0.01), 100) * bpm / mainBpm;
    ls[k] = Math.log(scroll);
  }
  const med = median(ls);
  let c = 0;
  for (let k = 0; k < n; k++) if (Math.abs(ls[k] - med) > Math.log(1.1)) c++;
  return c / n;
}

// gimmick-flags events_scan -> embedded storyboard object lines (Sprite / Animation)
export function sbLines(text) {
  let sec = '', obj = 0;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    const s = line.trim();
    if (s.startsWith('[')) { sec = s; continue; }
    if (sec !== '[Events]' || !s || s.startsWith('//')) continue;
    if (line[0] === ' ' || line[0] === '_') continue;
    const head = s.split(',', 1)[0].trim();
    if (head === 'Sprite' || head === '4' || head === 'Animation' || head === '6') obj++;
  }
  return obj;
}
