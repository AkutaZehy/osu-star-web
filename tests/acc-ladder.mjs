// 达成水平阶梯：JS（docs/js/acc-ladder.js）对 Python 参照（研究仓库 analysis/acc-ladder-r1/ladder_ref.py）逐位核对。
// 输入的总星数取 fixture 里的 Python 参考读数（96% 读数链路的一致性由 compare.mjs / compare_rates.mjs 检查），
// 不需要谱面文件：node --test tests/acc-ladder.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { validateLadder, ladder, parseAcc, reverseNote, ladderCopyLine } from '../docs/js/acc-ladder.js';

const P = validateLadder(JSON.parse(fs.readFileSync(new URL('../docs/model/acc-ladder.json', import.meta.url), 'utf8')));
const ref = JSON.parse(fs.readFileSync(new URL('./fixtures/reference-ladder.json', import.meta.url), 'utf8'));
const TOL = 1e-9;

test('JS ladder matches the Python reference to 1e-9 stars, same label', () => {
  let maxd = 0;
  const bad = [];
  for (const c of ref.cases) {
    const r = ladder(P, c.star96, c.t, c.rate);
    const d = Math.abs(r.star - c.star);
    maxd = Math.max(maxd, d);
    if (!(d <= TOL) || r.label !== c.label || r.below !== c.below) bad.push({ ...c, js: r });
  }
  console.log(`cases ${ref.cases.length}, charts ${ref.n_charts}, max |diff| ${maxd.toExponential(2)}`);
  assert.equal(bad.length, 0, JSON.stringify(bad.slice(0, 3)));
  for (const rate of [1, 0.75, 1.5]) for (const t of [85, 90, 93, 96, 98, 99]) {
    assert.ok(ref.cases.some((c) => c.rate === rate && c.t === t), `fixture covers rate ${rate} t ${t}`);
  }
});

test('96% row equals the total star', () => {
  for (const s of [-1, 0.3, 2, 5.5, 7.2, 9.8]) for (const rate of [1, 0.75, 1.5]) assert.ok(Math.abs(ladder(P, s, 96, rate).star - s) < 1e-12);
});

test('ladder is increasing in acc', () => {
  for (const s of [1, 4, 7, 9.5]) {
    let prev = -Infinity;
    for (let t = 85; t <= 99.5; t += 0.5) { const v = ladder(P, s, t, 1).star; assert.ok(v > prev); prev = v; }
  }
});

test('input range and reverse-reading notes', () => {
  assert.equal(parseAcc(P, '93.5'), 93.5);
  assert.equal(parseAcc(P, '93%'), 93);
  assert.equal(parseAcc(P, '84.9'), null);
  assert.equal(parseAcc(P, '99.6'), null);
  assert.equal(parseAcc(P, 'abc'), null);
  assert.equal(reverseNote(P, 95), null);
  assert.equal(reverseNote(P, P.reverse.unreliable_at_or_above).level, 'bad');
  assert.equal(reverseNote(P, 87).level, 'warn');
});

test('8 stars and up: 90/93 observed, 96 and above extrapolated (NoMod)', () => {
  for (const s of [8.2, 9, 9.8]) {
    assert.equal(ladder(P, s, 90, 1).label, 'observed');
    assert.equal(ladder(P, s, 93, 1).label, 'observed');
    for (const t of [96, 98, 99, 99.5]) assert.equal(ladder(P, s, t, 1).label, 'extrap');
  }
});

test('copy line', () => {
  const line = ladderCopyLine(P, { ok: true, star: 6.57, rate: 1 });
  assert.match(line, /^达成水平（ScoreV1）：90% /);
  assert.equal(ladderCopyLine(P, { ok: false }), null);
});
