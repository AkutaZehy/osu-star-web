// 页面逻辑：拖放/选择文件 → 主线程读头部 → 逐个送 worker 计算 → 渲染结果卡片。
import { spawnHelpers } from './pool.js';
import {
  listOsz, parseOsuHeader, decodeText, skipReason, mergeMeta, displayName,
  unreliableReasons, jackHint, buildCopyText, buildSegmentsSvg, fmtStar, fmtTime, SEG_CAPTION,
} from './ui-lib.js';

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
  current: null,
  uid: 0,
};

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
    if (m.id !== undefined && state.current && state.current.uid === m.id) {
      finishCurrent({ ok: false, reason: 'parse_error', message: m.message || '计算出错' });
    } else if (state.phase === 'loading') {
      initFailed(`模型加载失败：${m.message || '未知错误'}。${BROWSER_HINT}`);
    }
  } else if (m.type === 'progress') {
    const it = state.items.find((x) => x.uid === m.id);
    if (it && it.status === 'running') {
      it.stage = m.stage || '';
      it.pct = Math.max(0, Math.min(100, Number(m.pct) || 0));
      updateProgress(it);
    }
  } else if (m.type === 'result') {
    if (state.current && state.current.uid === m.id) finishCurrent(m.result);
    else { state.current = null; pump(); }
  }
}

function pump() {
  if (state.phase !== 'ready' || state.current) return;
  const next = state.items.find((x) => x.status === 'queued');
  if (!next) return;
  state.current = next;
  next.status = 'running';
  next.stage = '开始';
  next.pct = 0;
  renderItem(next);
  const bytes = next.bytes;
  next.bytes = null;
  state.worker.postMessage(
    { type: 'score', id: next.uid, bytes, name: next.name, oszHasOsb: next.oszHasOsb },
    [bytes.buffer],
  );
}

function finishCurrent(result) {
  const it = state.current;
  state.current = null;
  if (it) {
    it.status = 'done';
    it.result = result || { ok: false, reason: 'parse_error', message: '没有收到计算结果' };
    renderItem(it);
  }
  pump();
}

function failItem(it, message) {
  it.status = 'done';
  it.bytes = null;
  it.result = { ok: false, reason: 'parse_error', message };
  renderItem(it);
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
    uid: ++state.uid, name, header, bytes, oszHasOsb: !!oszHasOsb,
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
    side = h('div', { class: 'star' }, '★ ' + fmtStar(r.star));
    if (reasons.length) {
      extra.push(h('div', { class: 'warn' },
        h('span', { class: 'tag', text: '不可靠' }),
        h('ul', null, reasons.map((x) => h('li', { text: x })))));
    }
    const jh = jackHint(r);
    if (jh) extra.push(h('div', { class: 'note', text: jh }));
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

function subline(it, meta) {
  const r = it.result;
  const bits = [];
  if (meta.creator) bits.push('mapper：' + meta.creator);
  const n = r && r.ok ? r.nNotes : (it.header && it.header.nObjects);
  if (n) bits.push(`物件 ${n}`);
  if (r && r.ok) {
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
    const text = buildCopyText(it.result, it.header, it.name, state.ver);
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

  $('#clear').addEventListener('click', () => {
    state.items = state.items.filter((x) => x === state.current);
    resultsEl().replaceChildren(...state.items.map((x) => x.el));
    if (!state.items.length) $('#results-sec').hidden = true;
  });
}

setupUi();
startWorker();
