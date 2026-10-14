// 页面用到的纯函数（不碰 DOM，Node 里也能直接 import 测试）。
import { unzipSync } from '../vendor/fflate/fflate.mjs';

export const STAR_NOTE_JACK =
  'jack/chordjack 较多：按 acc 定义，读数通常比段位手感低约 1 段';
export const SEG_CAPTION =
  '分段曲线：每 10 秒一段，按旧公共星数刻度，只用来看起伏，不等于总星数';

const MODE_NAMES = ['std', 'taiko', 'catch', 'mania'];

export function decodeText(u8) {
  return new TextDecoder('utf-8').decode(u8); // 默认会去掉 BOM
}

/** 读 .osu 头部字段（Mode、CircleSize、Title、Artist、Version 等）并数物件行数。 */
export function parseOsuHeader(text) {
  const out = {
    mode: 0, circleSize: null, title: '', artist: '', version: '', creator: '',
    beatmapId: null, beatmapSetId: null, nObjects: 0,
  };
  let section = '';
  const lines = text.split('\n');
  for (const raw of lines) {
    const t = raw.trim();
    if (!t || t.startsWith('//')) continue;
    if (t[0] === '[' && t[t.length - 1] === ']') { section = t.slice(1, -1); continue; }
    if (section === 'HitObjects') { out.nObjects++; continue; }
    const ix = t.indexOf(':');
    if (ix < 0) continue;
    const k = t.slice(0, ix).trim();
    const v = t.slice(ix + 1).trim();
    if (section === 'General') {
      if (k === 'Mode') out.mode = parseInt(v, 10) || 0;
    } else if (section === 'Difficulty') {
      if (k === 'CircleSize') { const x = parseFloat(v); out.circleSize = Number.isFinite(x) ? x : null; }
    } else if (section === 'Metadata') {
      if (k === 'Title') out.title = v;
      else if (k === 'Artist') out.artist = v;
      else if (k === 'Version') out.version = v;
      else if (k === 'Creator') out.creator = v;
      else if (k === 'BeatmapID') { const n = parseInt(v, 10); out.beatmapId = n > 0 ? n : null; }
      else if (k === 'BeatmapSetID') { const n = parseInt(v, 10); out.beatmapSetId = n > 0 ? n : null; }
    }
  }
  return out;
}

export function isMania4K(h) {
  return h.mode === 3 && h.circleSize !== null && Math.abs(h.circleSize - 4) < 1e-6;
}

/** 主线程判断为不支持时的中文说明；支持则返回 null。 */
export function skipReason(h) {
  if (isMania4K(h)) return null;
  const why = h.mode !== 3
    ? `模式：${MODE_NAMES[h.mode] || h.mode}`
    : `键数：${h.circleSize === null ? '未知' : h.circleSize + 'K'}`;
  return `跳过：不是 mania 4K（${why}）`;
}

export function baseName(path) {
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return i >= 0 ? path.slice(i + 1) : path;
}

/**
 * 解开 .osz，列出全部 .osu。只解压 .osu / .osb，音频图片一概不碰。
 * 返回 { entries:[{path,name,bytes,header,skip}], hasOsb }；skip 为 null 表示可送去计算。
 */
export function listOsz(u8) {
  const files = unzipSync(u8, { filter: (f) => /\.(osu|osb)$/i.test(f.name) });
  let hasOsb = false;
  const entries = [];
  for (const path of Object.keys(files)) {
    const name = baseName(path);
    if (path.startsWith('__MACOSX/') || name.startsWith('._')) continue;
    if (/\.osb$/i.test(name)) { hasOsb = true; continue; }
    if (!/\.osu$/i.test(name)) continue;
    const bytes = files[path];
    const header = parseOsuHeader(decodeText(bytes));
    entries.push({ path, name, bytes, header, skip: skipReason(header) });
  }
  return { entries, hasOsb };
}

export function fmtStar(x) { return Number(x).toFixed(2); }

export function fmtTime(s) {
  s = Math.max(0, Math.round(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** 合并主线程读到的头部和 worker 返回的元数据（worker 优先，缺失用头部）。 */
export function mergeMeta(header, result) {
  const r = result || {};
  const h = header || {};
  const pick = (a, b) => (a !== undefined && a !== null && a !== '' ? a : b);
  return {
    title: pick(r.title, h.title) || '',
    artist: pick(r.artist, h.artist) || '',
    version: pick(r.version, h.version) || '',
    creator: pick(r.creator, h.creator) || '',
    beatmapId: pick(r.beatmapId, h.beatmapId) || null,
    md5: r.md5 || null,
  };
}

export function displayName(meta, fileName) {
  const base = meta.artist || meta.title
    ? `${meta.artist || '?'} - ${meta.title || '?'}`
    : (fileName || '未知谱面');
  return meta.version ? `${base} [${meta.version}]` : base;
}

/** 不可靠原因（中文列表）。reliable 为 true 时返回空数组。 */
export function unreliableReasons(result) {
  if (!result || !result.ok || result.reliable) return [];
  const f = result.flags || {};
  const out = [];
  if (f.sv) {
    const pct = typeof f.svFrac === 'number' ? `（约 ${Math.round(f.svFrac * 100)}% 的物件处变速）` : '';
    out.push('有变速（SV），训练时排除了这类谱，读数未经检验' + pct);
  }
  if (f.storyboard) out.push('带 storyboard（可能是观赏/特效谱），读数未经检验');
  if (f.outOfRange) {
    const rs = Array.isArray(f.outOfRangeReasons) ? f.outOfRangeReasons.filter(Boolean) : [];
    out.push('超出排名谱训练范围：' + (rs.length ? rs.join('；') : '具体项目未给出'));
  }
  if (!out.length) out.push('读数未经检验');
  return out;
}

export function jackHint(result) {
  if (!result || !result.ok || !result.flags || !result.flags.jackHeavy) return null;
  return STAR_NOTE_JACK;
}

/** 「复制读数信息」的多行文本。ver 为 ready 消息的 {version, frozen}。 */
export function buildCopyText(result, header, fileName, ver) {
  const meta = mergeMeta(header, result);
  const verText = ver && ver.version
    ? `${ver.version}（冻结日期 ${ver.frozen || '未知'}）` : '未知';
  const lines = [];
  lines.push(`谱名：${meta.artist || '?'} - ${meta.title || '?'}`);
  lines.push(`难度名：${meta.version || '?'}`);
  if (meta.creator) lines.push(`mapper：${meta.creator}`);
  lines.push(`beatmap id：${meta.beatmapId || '无'}`);
  lines.push(`md5：${meta.md5 || '无'}`);
  if (result && result.ok) {
    lines.push(`星数：${fmtStar(result.star)}`);
  } else {
    lines.push(`星数：无（${(result && result.message) || '未计算'}）`);
  }
  lines.push(`版本：${verText}`);
  const rs = unreliableReasons(result);
  if (rs.length) {
    lines.push('读数不可靠：是');
    rs.forEach((r) => lines.push(`  - ${r}`));
  }
  const jh = jackHint(result);
  if (jh) lines.push(`提示：${jh}`);
  return lines.join('\n');
}

/**
 * 分段曲线（手写 SVG 字符串，只含数字和固定文字）。segments 为空返回 ''。
 * 物件很少的段（sparse）画成空心点并断开折线。
 */
export function buildSegmentsSvg(segments, hardest) {
  if (!Array.isArray(segments) || segments.length < 1) return '';
  const W = 320, H = 96, L = 30, R = 8, T = 8, B = 18;
  const end = Math.max(...segments.map((s) => s.endS), 1);
  const stars = segments.map((s) => s.star).filter((v) => Number.isFinite(v));
  if (!stars.length) return '';
  let lo = Math.min(...stars), hi = Math.max(...stars);
  if (hi - lo < 0.5) { const m = (hi + lo) / 2; lo = m - 0.25; hi = m + 0.25; }
  const shownHi = hi, shownLo = lo;
  const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
  const X = (t) => L + (t / end) * (W - L - R);
  const Y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const f = (v) => v.toFixed(1);
  let svg = `<svg class="spark" viewBox="0 0 ${W} ${H}" role="img" aria-label="分段星数曲线" preserveAspectRatio="xMidYMid meet">`;
  if (hardest && Number.isFinite(hardest.startS) && Number.isFinite(hardest.endS)) {
    const x0 = X(hardest.startS), x1 = Math.max(X(hardest.endS), x0 + 2);
    svg += `<rect class="hl" x="${f(x0)}" y="${T}" width="${f(x1 - x0)}" height="${H - T - B}"/>`;
  }
  svg += `<line class="axis" x1="${L}" y1="${H - B}" x2="${W - R}" y2="${H - B}"/>`;
  svg += `<text class="lbl" x="${L - 4}" y="${f(Y(shownHi) + 3)}" text-anchor="end">${shownHi.toFixed(1)}</text>`;
  svg += `<text class="lbl" x="${L - 4}" y="${f(Y(shownLo) + 3)}" text-anchor="end">${shownLo.toFixed(1)}</text>`;
  svg += `<text class="lbl" x="${L}" y="${H - 4}" text-anchor="start">0:00</text>`;
  svg += `<text class="lbl" x="${W - R}" y="${H - 4}" text-anchor="end">${fmtTime(end)}</text>`;
  let d = '', pen = false;
  for (const s of segments) {
    const x = X((s.startS + s.endS) / 2), y = Y(s.star);
    if (s.sparse || !Number.isFinite(s.star)) { pen = false; continue; }
    d += `${pen ? 'L' : 'M'}${f(x)} ${f(y)} `;
    pen = true;
  }
  if (d) svg += `<path class="line" d="${d.trim()}"/>`;
  for (const s of segments) {
    if (!Number.isFinite(s.star)) continue;
    const x = X((s.startS + s.endS) / 2), y = Y(s.star);
    const tip = `${fmtTime(s.startS)}–${fmtTime(s.endS)}　★ ${fmtStar(s.star)}${s.sparse ? '（物件很少）' : ''}`;
    svg += `<circle class="${s.sparse ? 'pt sparse' : 'pt'}" cx="${f(x)}" cy="${f(y)}" r="${s.sparse ? 2.2 : 1.6}"><title>${tip}</title></circle>`;
  }
  svg += '</svg>';
  return svg;
}
