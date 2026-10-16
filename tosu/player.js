// Player level from recent finished plays, and the expected acc on a chart (pure functions, Node-testable).
// Each finished play gives one level reading with the web page's acc ladder (js/acc-ladder.js, the "达成水平" table read
// backwards): the level at which this chart's acc line equals the play's ScoreV1 acc. The player level is the mean of the
// last N usable readings; the expected acc on a chart is the ladder read forwards at that level.
// Backtest (research repo docs/player-level-backtest-r1-results-2026-10-16.md; 72 players, ~89k finished NoMod ranked plays,
// last 5 plays -> next play): the level read back from the next play falls within LEVEL_BAND of the estimate 8 times in 10
// (10th / 90th percentiles), about 80 % coverage when the chart is within 1 star of the level. On charts more than
// TOO_HARD stars above the level the rule is far too low for the finished plays (median +4-9 points), so no number.
import { ladderStar, logSlope, yOf } from './js/acc-ladder.js';

export const LEVEL_BAND = { lo: -0.62, hi: 0.64 };   // stars, 10th / 90th percentile of the backtest level error
export const TOO_HARD = 1;                           // chart star - level above this: no expected acc
export const WIDE_SPREAD = 2.5;                      // max - min level of the window: interval may be too narrow
export const NOVICE_BELOW = 3;                       // level below this: intervals measured wider

/** stable ScoreV1 accuracy (%) from tosu hit counts (geki = MAX, katu = 200); null without objects. */
export function scoreV1Acc(h) {
  if (!h) return null;
  const n = k => (Number.isFinite(h[k]) ? h[k] : 0);
  const max = n('geki'), g300 = n('300'), g200 = n('katu'), g100 = n('100'), g50 = n('50'), miss = n('0');
  const total = max + g300 + g200 + g100 + g50 + miss;
  if (!total) return null;
  return (300 * (max + g300) + 200 * g200 + 100 * g100 + 50 * g50) / (3 * total);
}

/** Level (same scale as the total star) at which a player reaches acc t on a chart read as star96 at this rate. */
export function playLevel(P, star96, t, rate = 1) {
  return ladderStar(P, star96, t, rate);
}

/** The ladder read forwards: expected ScoreV1 acc (%) on a chart for a player at `level`; may exceed 100 (clamped later). */
export function expectedAcc(P, level, star96, rate = 1) {
  const s = Math.exp(logSlope(P, star96, rate));
  const y = yOf(P, 96) - (level - star96) * s / P.star_b;
  return 100 * (1 + P.eps - Math.exp(y));
}

/** Whether one play's acc can be read backwards (acc-ladder.json reverse: below 85 % or from 99 % on it is unreliable). */
export function usableAcc(P, t) {
  return Number.isFinite(t) && t >= P.reverse.unreliable_below && t < P.reverse.unreliable_at_or_above;
}

/**
 * plays: newest first, each { acc, star (reading at the play's mods, or null), reliable, rate }.
 * Returns { used: [{ ...play, level }], needed, level (mean) | null, lo, hi } over the first `window` usable plays.
 */
export function estimateLevel(P, plays, window = 5) {
  const used = [];
  for (const p of plays) {
    if (used.length >= window) break;
    if (!Number.isFinite(p.star) || p.reliable === false || !usableAcc(P, p.acc)) continue;
    used.push({ ...p, level: playLevel(P, p.star, p.acc, p.rate || 1) });
  }
  if (used.length < window) return { used, needed: window, level: null, lo: null, hi: null };
  const lv = used.map(u => u.level);
  return { used, needed: window, level: lv.reduce((a, b) => a + b, 0) / lv.length, lo: Math.min(...lv), hi: Math.max(...lv) };
}

/** Expected acc as display text: inside the ladder's input range a number, outside it a bound. */
export function fmtExpectedAcc(P, t) {
  const [lo, hi] = P.input_range;
  if (!Number.isFinite(t)) return '—';
  if (t < lo) return `低于 ${lo}%`;
  if (t > hi) return `高于 ${hi}%`;
  return `${t.toFixed(1)}%`;
}

/**
 * What the card shows for one chart: { tooHard, gap } when the chart is more than TOO_HARD stars above the level,
 * otherwise { acc, lo, hi } (ScoreV1 %, the 8-in-10 interval from LEVEL_BAND, capped at 100).
 */
export function predictView(P, level, star96, rate = 1) {
  const gap = star96 - level;
  if (gap > TOO_HARD) return { tooHard: true, gap };
  const cap = t => Math.min(t, 100);
  return { tooHard: false, gap, acc: cap(expectedAcc(P, level, star96, rate)),
    lo: cap(expectedAcc(P, level + LEVEL_BAND.lo, star96, rate)), hi: cap(expectedAcc(P, level + LEVEL_BAND.hi, star96, rate)) };
}
