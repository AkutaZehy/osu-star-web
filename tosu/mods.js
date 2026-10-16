// tosu play.mods (v2 websocket) -> what the P1h reader can use. tosu reports the mods of the current play, the result
// screen or song select; with lazer the array carries each mod's settings (speed_change, overall_difficulty, ...).
// Returns { ok, rate, hit, od, label, tested, notes[] } or { ok: false, why }.

const SPEED_UP = new Set(['DT', 'NC']), SLOW_DOWN = new Set(['HT', 'DC']);
// mods that change the notes or the judgement in ways the reader does not model
const CHART_CHANGING = {
  RD: '随机（RD）会打乱列', IN: '反转（IN）会改谱面', HO: 'Hold Off 会去掉长条', NR: 'No Release 改变长条尾判定',
  DS: '双轨（DS）会改键数', WU: 'Wind Up 倍速随时间变化', WD: 'Wind Down 倍速随时间变化', AS: '自适应倍速（AS）倍速随时间变化',
};
// visibility, fail and score-mode mods: no effect on the notes or the windows
const IGNORED = new Set(['NF', 'SD', 'PF', 'HD', 'FI', 'FL', 'CO', 'MR', 'TD', 'SV2', 'V2', 'CL', 'TC', 'BL', 'MU', 'CS', 'SO', 'AT', 'CN',
  'AP', 'RX', 'ST', 'SG', 'BR', 'FR', 'SI', 'GR', 'DF', 'TR', 'WG', 'NS', 'BM', 'AL', 'SR', 'BU', 'DP', 'CM', 'MF', 'FF']);

const r2 = x => Math.round(x * 100) / 100;

export function readMods(mods) {
  const arr = Array.isArray(mods && mods.array) ? mods.array : [];
  let rate = 1, hit = '', od = null;
  const notes = [], ignored = [], untested = [];
  for (const m of arr) {
    const ac = String((m && m.acronym) || m || '').toUpperCase();
    const st = (m && m.settings) || {};
    if (!ac) continue;
    if (SPEED_UP.has(ac)) rate = Number.isFinite(st.speed_change) ? st.speed_change : 1.5;
    else if (SLOW_DOWN.has(ac)) rate = Number.isFinite(st.speed_change) ? st.speed_change : 0.75;
    else if (ac === 'HR') hit = 'hr';
    else if (ac === 'EZ') hit = 'ez';
    else if (ac === 'DA') {
      if (Number.isFinite(st.circle_size) && st.circle_size !== 4) return { ok: false, why: 'Difficulty Adjust 改了键数，只支持 4K' };
      if (Number.isFinite(st.overall_difficulty)) od = st.overall_difficulty;
    } else if (/^\d+K$/.test(ac)) {
      if (ac !== '4K') return { ok: false, why: `${ac} 改了键数，只支持 4K` };
    } else if (CHART_CHANGING[ac]) return { ok: false, why: `${CHART_CHANGING[ac]}，读数不适用` };
    else if (IGNORED.has(ac)) ignored.push(ac);
    else ignored.push(ac + '?');
  }
  if (!(rate >= 0.5 && rate <= 2)) return { ok: false, why: `倍速 ${rate} 超出支持范围（0.5–2 倍）` };
  if (od !== null && !(od >= 0 && od <= 11)) return { ok: false, why: `OD ${od} 超出支持范围（0–11）` };
  const parts = [];
  if (rate === 1.5) parts.push('DT');
  else if (rate === 0.75) parts.push('HT');
  else if (rate !== 1) parts.push(`${r2(rate)}x`);
  if (hit) parts.push(hit.toUpperCase());
  if (od !== null) parts.push(`OD${r2(od)}`);
  // what the tree has answers for: NoMod and 1.5x (file OD, no HR / EZ); HT has none (same as the web page)
  if (rate !== 1 && rate !== 1.5) untested.push(rate === 0.75 ? 'HT 读数未经检验' : `${r2(rate)} 倍速未经检验（只检验过 1.0 / 1.5 倍）`);
  if (hit) untested.push(`${hit.toUpperCase()} 未经检验（按 stable 规则：判定区间 ${hit === 'hr' ? '÷' : '×'}1.4）`);
  if (od !== null) untested.push('改 OD 未经检验（按改后的 OD 判定）');
  if (ignored.length) notes.push(`未计入：${ignored.join(' ')}`);
  return { ok: true, rate, hit, od, label: parts.join(' ') || 'NoMod', tested: untested.length === 0, untested, notes,
    key: `${rate}|${hit}|${od === null ? '' : od}` };
}
