// 页面逻辑：拖放/选择文件 → 主线程读头部 → 逐个送 worker 计算 → 渲染结果卡片。
import { spawnHelpers } from './pool.js';
import {
  validateDanReferences, referencesForModel, selectDanReferences, DAN_REFERENCE_NOTE, DAN_REFERENCE_WARNING,
} from './dan-reference.js';
import {
  listOsz, parseOsuHeader, decodeText, skipReason, mergeMeta, displayName,
  unreliableReasons, jackHint, buildCopyText, buildSegmentsSvg, fmtStar, fmtTime, SEG_CAPTION,
  MOD_SHORT, HT_NOTE, modLabel, subRows, SUB_NOTE,
} from './ui-lib.js';

const RATES = [1, 0.75, 1.5];
const MOD_KEY = 'osu-star-web.mod';
// 不随倍速变化的拒绝原因：算一次就够，三档共用
const RATE_FREE_REJECT = ['not_mania', 'not_4k', 'too_few_notes'];

export const FEEDBACK_URL = 'https://github.com/sky2002/osu-star-web/issues/new';

const $ = (sel) => document.querySelector(sel);

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

// ---------------------------------------------------------------- 状态
const state = {
  worker: null,
  phase: 'loading', // loading | ready | error
  ver: null, // {version, frozen}
  items: [],
  current: null, // { it, rate, job }
  uid: 0,
  job: 0,
  mod: loadMod(),
  references: null,
  referencesPhase: 'loading',
};

function loadMod() {
  try {
    const v = Number(localStorage.getItem(MOD_KEY));
    return RATES.includes(v) ? v : 1;
  } catch { return 1; }
}

function saveMod(rate) {
  try { localStorage.setItem(MOD_KEY, String(rate)); } catch { /* 无痕模式等：不记住也没关系 */ }
}

async function loadDanReferences() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(new URL('../data/dan-references.json', import.meta.url), { signal: controller.signal });
    if (!response.ok) throw new Error('段位参考加载失败');
    state.references = validateDanReferences(await response.json());
    state.referencesPhase = 'ready';
  } catch {
    state.referencesPhase = 'error';
  } finally {
    clearTimeout(timeout);
    for (const item of state.items) {
      if (item.status === 'done' && item.result?.ok) renderItem(item);
    }
  }
}

function setStatus(kind, text) {
  const box = $('#status');
  box.className = 'status ' + kind;
  $('#status-text').textContent = text;
}

const BROWSER_HINT = '请换用新版 Chrome、Edge 或 Firefox 再试。';

// ---------------------------------------------------------------- worker
function startWorker() {
  const mock = new URLSearchParams(location.search).get('mock') === '1';
  let w;
  try {
    w = new Worker(new URL(mock ? './mock-worker.js' : './worker.js', import.meta.url), { type: 'module' });
  } catch (e) {
    return initFailed('当前浏览器无法启动计算模块。' + BROWSER_HINT);
  }
  state.worker = w;
  w.onmessage = onWorkerMessage;
  w.onerror = (ev) => {
    const msg = ev && ev.message ? ev.message : '计算模块文件无法加载';
    if (state.phase === 'loading') return initFailed(`模型加载失败：${msg}。${BROWSER_HINT}`);
    if (state.current) finishCurrent({ ok: false, reason: 'parse_error', message: '计算时出错：' + msg });
  };
  w.onmessageerror = () => {
    if (state.phase === 'loading') initFailed('与计算模块通信失败。' + BROWSER_HINT);
  };
  // helper workers for long charts (second layer in parallel); the compute worker gets their ports
  const nHelpers = mock ? 0 : Math.max(0, Math.min(8, (navigator.hardwareConcurrency || 2) - 2));
  const ports = nHelpers >= 2 ? spawnHelpers(nHelpers) : [];
  w.postMessage({ type: 'init', ports }, ports);
}

function initFailed(message) {
  state.phase = 'error';
  setStatus('error', message);
  // 已排队的谱面全部标为失败
  for (const it of state.items) {
    if (it.status === 'queued' || it.status === 'running') failItem(it, '计算模块没有启动，无法计算。');
  }
  state.current = null;
}

function onWorkerMessage(ev) {
  const m = ev.data || {};
  if (m.type === 'ready') {
    state.phase = 'ready';
    state.ver = { version: m.version, frozen: m.frozen };
    const sec = typeof m.loadMs === 'number' ? (m.loadMs / 1000).toFixed(1) : '?';
    setStatus('ready', `模型已就绪（加载 ${sec} 秒）· ${m.version}，冻结 ${m.frozen}`);
    pump();
  } else if (m.type === 'error') {
    if (m.id !== undefined && state.current && state.current.job === m.id) {
      finishCurrent({ ok: false, reason: 'parse_error', message: m.message || '计算出错' });
    } else if (state.phase === 'loading') {
      initFailed(`模型加载失败：${m.message || '未知错误'}。${BROWSER_HINT}`);
    }
  } else if (m.type === 'progress') {
    const cur = state.current;
    const it = cur && cur.job === m.id && cur.rate === state.mod ? cur.it : null;
    if (it && it.status === 'running') {
      it.stage = m.stage || '';
      it.pct = Math.max(0, Math.min(100, Number(m.pct) || 0));
      updateProgress(it);
    }
  } else if (m.type === 'result') {
    if (state.current && state.current.job === m.id) finishCurrent(m.result);
    else { state.current = null; pump(); }
  }
}

// 只算当前 Mod 还没有结果的谱；谱面字节留在页面里，换 Mod 时再送一份副本
function pump() {
  if (state.phase !== 'ready' || state.current) return;
  const rate = state.mod;
  const next = state.items.find((x) => x.bytes && !x.failed && !x.results.has(rate));
  if (!next) return;
  const job = ++state.job;
  state.current = { it: next, rate, job };
  next.status = 'running';
  next.stage = '开始';
  next.pct = 0;
  renderItem(next);
  const bytes = next.bytes.slice();
  state.worker.postMessage(
    { type: 'score', id: job, bytes, name: next.name, oszHasOsb: next.oszHasOsb, rate },
    [bytes.buffer],
  );
}

function finishCurrent(result) {
  const cur = state.current;
  state.current = null;
  if (cur) {
    const it = cur.it;
    const res = result || { ok: false, reason: 'parse_error', message: '没有收到计算结果' };
    if (!res.ok && RATE_FREE_REJECT.includes(res.reason)) for (const r of RATES) it.results.set(r, res);
    else it.results.set(cur.rate, res);
    if (cur.rate === state.mod) {
      it.status = 'done';
      it.result = res;
      renderItem(it);
    }
  }
  pump();
}

function failItem(it, message) {
  it.status = 'done';
  it.bytes = null;
  it.failed = true;
  it.result = { ok: false, reason: 'parse_error', message };
  renderItem(it);
}

function setMod(rate) {
  if (!RATES.includes(rate)) return;
  state.mod = rate;
  saveMod(rate);
  syncModButtons();
  for (const it of state.items) {
    if (it.status === 'skipped' || it.failed) continue;
    const cur = state.current;
    if (it.results.has(rate)) { it.status = 'done'; it.result = it.results.get(rate); }
    else if (cur && cur.it === it && cur.rate === rate) { it.status = 'running'; it.result = null; }
    else { it.status = 'queued'; it.result = null; }
    renderItem(it);
  }
  pump();
}

function syncModButtons() {
  for (const b of document.querySelectorAll('#mods [data-rate]')) {
    b.setAttribute('aria-pressed', String(Number(b.dataset.rate) === state.mod));
  }
}

// ---------------------------------------------------------------- 添加文件
function resultsEl() { return $('#results'); }

function showResultsSec() { $('#results-sec').hidden = false; }

function addGroup(title, note) {
  showResultsSec();
  resultsEl().append(h('div', { class: 'group' }, h('strong', { text: title }), note ? h('span', { class: 'muted', text: ' ' + note }) : null));
}

function addNotice(text) {
  showResultsSec();
  resultsEl().append(h('div', { class: 'card skipped' }, h('div', { class: 'body' }, h('div', { class: 'muted', text: text }))));
}

function addItem({ name, header, bytes, oszHasOsb, skip }) {
  const it = {
    uid: ++state.uid, name, header, bytes, oszHasOsb: !!oszHasOsb, results: new Map(), failed: false,
    status: skip ? 'skipped' : 'queued', skip, result: null, stage: '', pct: 0, el: h('article', { class: 'card' }),
  };
  state.items.push(it);
  showResultsSec();
  resultsEl().append(it.el);
  if (skip) it.bytes = null;
  if (!skip && state.phase === 'error') failItem(it, '计算模块没有启动，无法计算。');
  else renderItem(it);
  return it;
}

async function handleFiles(fileList) {
  const files = Array.from(fileList || []);
  for (const f of files) {
    const lower = f.name.toLowerCase();
    try {
      if (lower.endsWith('.osz')) {
        const u8 = new Uint8Array(await f.arrayBuffer());
        let parsed;
        try { parsed = listOsz(u8); } catch (e) { addNotice(`${f.name}：无法解压（${e && e.message ? e.message : '文件损坏'}）。`); continue; }
        if (!parsed.entries.length) { addNotice(`${f.name}：压缩包里没有 .osu 难度。`); continue; }
        const ok = parsed.entries.filter((e) => !e.skip).length;
        addGroup(f.name, `${parsed.entries.length} 个难度，${ok} 个可计算${parsed.hasOsb ? '；含 .osb（storyboard）' : ''}`);
        for (const e of parsed.entries) {
          addItem({
            name: e.name, header: e.header, skip: e.skip,
            bytes: e.skip ? null : e.bytes.slice(), oszHasOsb: parsed.hasOsb,
          });
        }
      } else if (lower.endsWith('.osu')) {
        const u8 = new Uint8Array(await f.arrayBuffer());
        const header = parseOsuHeader(decodeText(u8));
        // 非 mania 4K 也交给 worker 拒绝一次，保证 .osu 的提示口径与 worker 一致
        addItem({ name: f.name, header, bytes: u8, oszHasOsb: false, skip: null });
      } else {
        addNotice(`${f.name}：只支持 .osu 和 .osz 文件。`);
      }
    } catch (e) {
      addNotice(`${f.name}：读取失败（${e && e.message ? e.message : '未知错误'}）。`);
    }
  }
  pump();
}

// ---------------------------------------------------------------- 渲染
function updateProgress(it) {
  const bar = it.el.querySelector('.bar > i');
  const lbl = it.el.querySelector('.stage');
  if (bar) bar.style.width = it.pct + '%';
  if (lbl) lbl.textContent = `${it.stage || '计算中'} ${Math.round(it.pct)}%`;
}

function renderItem(it) {
  const header = it.header || {};
  const r = it.result;
  const meta = mergeMeta(header, r && !it.skip ? r : null);
  const title = displayName(meta, it.name);
  const el = it.el;
  el.className = 'card';
  el.replaceChildren();

  const info = h('div', { class: 'info' },
    h('div', { class: 'name', text: title }),
    h('div', { class: 'sub muted' }, subline(it, meta)));

  let side;
  const extra = [];
  if (it.status === 'skipped') {
    el.classList.add('skipped');
    side = h('div', { class: 'star none', text: '—' });
    extra.push(h('div', { class: 'msg muted', text: it.skip }));
  } else if (it.status === 'queued') {
    el.classList.add('pending');
    side = h('div', { class: 'star none', text: '…' });
    extra.push(h('div', { class: 'msg muted', text: state.phase === 'ready' ? '排队中' : '等待模型加载' }));
  } else if (it.status === 'running') {
    el.classList.add('pending');
    side = h('div', { class: 'star none', text: '…' });
    extra.push(
      h('div', { class: 'bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100' }, h('i', { style: `width:${it.pct}%` })),
      h('div', { class: 'stage muted', text: `${it.stage || '计算中'} ${Math.round(it.pct)}%` }),
    );
  } else if (r && r.ok) {
    const reasons = unreliableReasons(r);
    if (reasons.length) el.classList.add('unreliable');
    const tag = MOD_SHORT[r.rate || 1];
    side = h('div', { class: 'star' }, '★ ' + fmtStar(r.star), tag ? h('span', { class: 'mod-tag', text: tag }) : null);
    if (reasons.length) {
      extra.push(h('div', { class: 'warn' },
        h('span', { class: 'tag', text: '不可靠' }),
        h('ul', null, reasons.map((x) => h('li', { text: x })))));
    }
    const jh = jackHint(r);
    if (jh) extra.push(h('div', { class: 'note', text: jh }));
    if (r.rate === 0.75) extra.push(h('div', { class: 'note', text: HT_NOTE }));
    const sp = subPanel(r);
    if (sp) extra.push(sp);
    extra.push(danReferencePanel(r));
    const svg = buildSegmentsSvg(r.segments, r.hardest);
    if (svg) {
      const box = h('div', { class: 'seg' });
      const holder = h('div', { class: 'seg-svg' });
      holder.innerHTML = svg;
      box.append(holder);
      if (r.hardest && Number.isFinite(r.hardest.star)) {
        box.append(h('div', { class: 'seg-hard', text: `最难的一段：${fmtTime(r.hardest.startS)}–${fmtTime(r.hardest.endS)}（高亮处）` }));
      }
      box.append(h('div', { class: 'seg-cap muted', text: SEG_CAPTION }));
      extra.push(box);
    }
  } else {
    el.classList.add('rejected');
    side = h('div', { class: 'star none', text: '—' });
    extra.push(h('div', { class: 'msg muted', text: (r && r.message) || '没有读数' }));
  }

  if (it.status === 'done') extra.push(copyRow(it));
  el.append(side, h('div', { class: 'body' }, info, extra));
}

function subPanel(result) {
  const rows = subRows(result);
  if (!rows.length) return null;
  const list = h('ul', { class: 'sub-list' });
  for (const r of rows) {
    list.append(h('li', { class: r.star === null ? 'none' : null },
      h('span', { class: 'sub-label', text: r.label }),
      h('strong', { class: 'sub-star', text: r.star === null ? '—' : '★ ' + fmtStar(r.star) }),
      r.text ? h('span', { class: 'sub-text muted', text: r.text }) : null));
  }
  return h('section', { class: 'sub-items', 'aria-label': '米 / 面分项与 OD 口径' },
    h('h3', { text: '分项（约定换算）' }), list, h('p', { class: 'muted sub-caption', text: SUB_NOTE }));
}

function danReferencePanel(result) {
  const panel = h('section', { class: 'dan-reference', 'aria-label': '附近段位参考谱' },
    h('h3', { text: '附近段位参考谱' }));
  const view = selectDanReferences(result, referencesForModel(state.references, state.ver));
  if (!view?.available) {
    panel.append(h('p', { class: 'muted dan-caption', text: state.referencesPhase === 'loading' ? '正在加载段位参考…' : '段位参考暂不可用；星数计算不受影响。' }));
    return panel;
  }
  panel.append(h('p', { class: 'muted dan-caption', text: DAN_REFERENCE_NOTE }));
  if (view.resultUnreliable) panel.append(h('p', { class: 'dan-caution', text: DAN_REFERENCE_WARNING }));
  const groups = h('div', { class: 'dan-groups' });
  for (const group of view.groups) {
    const section = h('div', { class: 'dan-group' }, h('h4', { text: group.label }));
    if (!group.matches.length) {
      section.append(h('p', { class: 'muted dan-empty', text: '暂无接近的参考谱' }));
    } else {
      const list = h('ul', { class: 'dan-list' });
      for (const entry of group.matches) {
        const name = entry.url
          ? h('a', { href: entry.url, target: '_blank', rel: 'noopener', text: entry.label })
          : h('span', { text: entry.label });
        list.append(h('li', null,
          h('div', { class: 'dan-name' }, name, entry.reliable ? null : h('span', { class: 'dan-caution', text: '读数不可靠' })),
          h('strong', { class: 'dan-star', text: '★ ' + fmtStar(entry.star) })));
      }
      section.append(list);
    }
    if (group.note) section.append(h('p', { class: 'muted dan-caption', text: group.note }));
    groups.append(section);
  }
  panel.append(groups);
  return panel;
}

function subline(it, meta) {
  const r = it.result;
  const bits = [];
  if (meta.creator) bits.push('mapper：' + meta.creator);
  const n = r && r.ok ? r.nNotes : (it.header && it.header.nObjects);
  if (n) bits.push(`物件 ${n}`);
  if (r && r.ok) {
    if ((r.rate || 1) !== 1) bits.push(modLabel(r.rate));
    if (Number.isFinite(r.durationS)) bits.push(`时长 ${fmtTime(r.durationS)}`);
    if (Number.isFinite(r.od)) bits.push(`OD ${Number(r.od).toFixed(1)}`);
    if (Number.isFinite(r.seconds)) bits.push(`计算 ${r.seconds.toFixed(1)} 秒`);
  }
  return bits.join(' · ');
}

function copyRow(it) {
  const btn = h('button', { type: 'button', class: 'btn small', text: '复制读数信息' });
  const row = h('div', { class: 'actions' }, btn);
  btn.addEventListener('click', async () => {
    const references = selectDanReferences(it.result, referencesForModel(state.references, state.ver));
    const text = buildCopyText(it.result, it.header, it.name, state.ver, references);
    const ok = await copyText(text);
    row.querySelector('textarea')?.remove();
    if (ok) {
      btn.textContent = '已复制';
      btn.disabled = true;
      setTimeout(() => { btn.textContent = '复制读数信息'; btn.disabled = false; }, 2000);
    } else {
      btn.textContent = '复制失败，请手动复制下面的文字';
      const ta = h('textarea', { class: 'manual', readonly: true, rows: '8' });
      ta.value = text;
      row.append(ta);
      ta.focus();
      ta.select();
    }
  });
  return row;
}

async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (e) { /* 退回到 textarea 方式 */ }
  const ta = h('textarea', { readonly: true, style: 'position:fixed;left:-9999px;top:0;opacity:0' });
  ta.value = text;
  document.body.append(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
  ta.remove();
  return ok;
}

// ---------------------------------------------------------------- 初始化
function setupUi() {
  for (const a of document.querySelectorAll('a[data-feedback]')) a.href = FEEDBACK_URL;

  const input = $('#file-input');
  const drop = $('#drop');
  $('#pick').addEventListener('click', (e) => { e.preventDefault(); input.click(); });
  input.addEventListener('change', () => {
    const files = Array.from(input.files);
    input.value = '';
    handleFiles(files);
  });

  let depth = 0;
  drop.addEventListener('dragenter', (e) => { e.preventDefault(); depth++; drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) drop.classList.remove('over'); });
  drop.addEventListener('dragover', (e) => e.preventDefault());
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    depth = 0;
    drop.classList.remove('over');
    handleFiles(Array.from(e.dataTransfer.files));
  });
  // 拖偏了也别让浏览器直接打开文件
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  for (const b of document.querySelectorAll('#mods [data-rate]')) {
    b.addEventListener('click', () => setMod(Number(b.dataset.rate)));
  }
  syncModButtons();

  $('#clear').addEventListener('click', () => {
    state.items = state.items.filter((x) => state.current && x === state.current.it);
    resultsEl().replaceChildren(...state.items.map((x) => x.el));
    if (!state.items.length) $('#results-sec').hidden = true;
  });
}

setupUi();
startWorker();
loadDanReferences();
