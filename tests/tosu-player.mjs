// Unit tests for tosu/player.js (level from finished plays, expected acc), run on the built counter folder:
//   node tools/build-tosu.mjs && node --test tests/tosu-player.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { validateLadder, ladderStar } from '../docs/js/acc-ladder.js';
import { scoreV1Acc, playLevel, expectedAcc, usableAcc, estimateLevel, fmtExpectedAcc, predictView, LEVEL_BAND, TOO_HARD }
  from '../dist/osu-star-tosu/player.js';

const P = validateLadder(JSON.parse(fs.readFileSync(new URL('../docs/model/acc-ladder.json', import.meta.url), 'utf8')));

test('ScoreV1 acc from tosu hit counts', () => {
  assert.equal(scoreV1Acc({ geki: 10, 300: 0, katu: 0, 100: 0, 50: 0, 0: 0 }), 100);
  assert.equal(scoreV1Acc({ geki: 1, 300: 1, katu: 1, 100: 1, 50: 1, 0: 1 }), (300 * 2 + 200 + 100 + 50) / (300 * 6) * 100);
  assert.equal(scoreV1Acc({}), null);
});

test('96 % on a chart reads as the chart star; forward and backward ladder agree', () => {
  for (const rate of [1, 1.5, 0.75]) {
    for (const star of [2, 4.5, 6.3, 8]) {
      assert.ok(Math.abs(playLevel(P, star, 96, rate) - star) < 1e-12);
      for (const t of [86, 90, 93, 97, 98.5]) {
        const L = playLevel(P, star, t, rate);
        assert.ok(Math.abs(L - ladderStar(P, star, t, rate)) < 1e-12);
        assert.ok(Math.abs(expectedAcc(P, L, star, rate) - t) < 1e-9, `${rate} ${star} ${t}`);
      }
    }
  }
});

test('higher level -> higher expected acc; harder chart -> lower expected acc', () => {
  assert.ok(expectedAcc(P, 6, 5) > expectedAcc(P, 5, 5));
  assert.ok(expectedAcc(P, 6, 6) < expectedAcc(P, 6, 5));
});

test('usable plays, window and mean', () => {
  assert.equal(usableAcc(P, 84.9), false);
  assert.equal(usableAcc(P, 85), true);
  assert.equal(usableAcc(P, 99), false);
  const plays = [
    { acc: 95, star: 5, reliable: true },
    { acc: 99.5, star: 4, reliable: true },    // too high to read back
    { acc: 94, star: null, reliable: true },   // no reading yet
    { acc: 92, star: 5.5, reliable: false },   // unreliable star
    { acc: 93, star: 5.2, reliable: true },
    { acc: 97, star: 4.8, reliable: true, rate: 1.5 },
  ];
  const few = estimateLevel(P, plays, 5);
  assert.equal(few.used.length, 3);
  assert.equal(few.level, null);
  const e = estimateLevel(P, plays, 3);
  const want = [playLevel(P, 5, 95), playLevel(P, 5.2, 93), playLevel(P, 4.8, 97, 1.5)];
  assert.ok(Math.abs(e.level - want.reduce((a, b) => a + b) / 3) < 1e-12);
  assert.equal(e.lo, Math.min(...want));
  assert.equal(e.hi, Math.max(...want));
});

test('expected acc text', () => {
  assert.equal(fmtExpectedAcc(P, 94.26), '94.3%');
  assert.equal(fmtExpectedAcc(P, 80), '低于 85%');
  assert.equal(fmtExpectedAcc(P, 99.9), '高于 99.5%');
});

test('8-in-10 interval and the too-hard rule', () => {
  const v = predictView(P, 5.5, 5.5);
  assert.equal(v.tooHard, false);
  assert.ok(v.lo < v.acc && v.acc < v.hi && v.hi <= 100);
  assert.ok(Math.abs(v.lo - expectedAcc(P, 5.5 + LEVEL_BAND.lo, 5.5)) < 1e-12);
  assert.ok(Math.abs(v.hi - expectedAcc(P, 5.5 + LEVEL_BAND.hi, 5.5)) < 1e-12);
  // backtest example (level 5.5): 4.5-star chart 98.4 % (97.1-99.2), 5.5-star chart 96.0 % (92.5-98.0)
  const easy = predictView(P, 5.5, 4.5);
  assert.equal(easy.acc.toFixed(1), '98.4');
  assert.equal(easy.lo.toFixed(1), '97.1');
  assert.equal(easy.hi.toFixed(1), '99.2');
  assert.equal(v.acc.toFixed(1), '96.0');
  assert.equal(v.lo.toFixed(1), '92.5');
  assert.equal(v.hi.toFixed(1), '98.0');
  assert.equal(predictView(P, 5.5, 5.5 + TOO_HARD).tooHard, false);
  assert.equal(predictView(P, 5.5, 5.5 + TOO_HARD + 0.01).tooHard, true);
  assert.ok(predictView(P, 9, 2).hi <= 100);
});
