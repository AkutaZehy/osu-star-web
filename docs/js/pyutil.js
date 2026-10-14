// Small helpers that reproduce the exact Python / NumPy arithmetic used by the research reference.

// numpy.rint: round half to even
export function rint(x) {
  const f = Math.floor(x);
  const d = x - f;
  if (d > 0.5) return f + 1;
  if (d < 0.5) return f;
  return (f % 2 === 0) ? f : f + 1;
}

// numpy.round(x, 6) = rint(x * 1e6) / 1e6
export function round6(x) { return rint(x * 1e6) / 1e6; }

export const f32 = Math.fround;

// numpy.searchsorted on a sorted numeric array
export function ssLeft(a, v, lo = 0, hi = a.length) {
  while (lo < hi) { const m = (lo + hi) >>> 1; if (a[m] < v) lo = m + 1; else hi = m; }
  return lo;
}
export function ssRight(a, v, lo = 0, hi = a.length) {
  while (lo < hi) { const m = (lo + hi) >>> 1; if (a[m] <= v) lo = m + 1; else hi = m; }
  return lo;
}

// numpy.quantile(a, q) with the default 'linear' method (a need not be sorted)
export function quantileSorted(s, q) {
  const n = s.length;
  const v = (n - 1) * q;
  let a, b;
  const prev = Math.floor(v);
  if (v >= n - 1) { a = b = s[n - 1]; } else { a = s[prev]; b = s[prev + 1]; }
  const g = v - prev;
  const d = b - a;
  return g >= 0.5 ? b - d * (1 - g) : a + d * g;
}
export function quantile(arr, q) {
  const s = Float64Array.from(arr).sort();
  return quantileSorted(s, q);
}
export function median(arr) {
  const s = Float64Array.from(arr).sort();
  const n = s.length;
  if (n % 2) return s[(n - 1) / 2];
  return (s[n / 2 - 1] + s[n / 2]) / 2;
}

// Python str.splitlines() separators
const SPLIT_RE = new RegExp('\r\n|[\n\r\v\f\x1c\x1d\x1e\x85' + String.fromCharCode(0x2028, 0x2029) + ']');
export function splitlines(text) {
  return text.split(SPLIT_RE);
}
// text-mode file iteration (universal newlines): only \n, \r, \r\n
export function fileLines(text) {
  return text.split(/\r\n|\n|\r/);
}

// Python str.strip() (whitespace incl. unicode spaces); JS trim is close enough for .osu headers
export function strip(s) { return s.trim(); }

const FLOAT_RE = /^[+-]?((\d(_?\d)*)?\.?(\d(_?\d)*)?)([eE][+-]?\d(_?\d)*)?$/;
// Python float(str)
export function pyFloat(s) {
  const t = s.trim();
  const lo = t.toLowerCase();
  if (/^[+-]?(inf|infinity)$/.test(lo)) return lo.startsWith('-') ? -Infinity : Infinity;
  if (/^[+-]?nan$/.test(lo)) return NaN;
  if (!FLOAT_RE.test(t) || !/\d/.test(t)) throw new Error('could not convert string to float: ' + JSON.stringify(s));
  return Number(t.replace(/_/g, ''));
}
// Python int(str)
export function pyInt(s) {
  const t = s.trim();
  if (!/^[+-]?\d(_?\d)*$/.test(t)) throw new Error('invalid literal for int(): ' + JSON.stringify(s));
  return parseInt(t.replace(/_/g, ''), 10);
}
// Python int(float) truncation
export function trunc(x) { return Math.trunc(x); }

// numpy.lexsort-style stable argsort with a comparator over indices
export function argsortStable(n, cmp) {
  const idx = Array.from({ length: n }, (_, i) => i);
  idx.sort((a, b) => cmp(a, b) || a - b);
  return idx;
}
