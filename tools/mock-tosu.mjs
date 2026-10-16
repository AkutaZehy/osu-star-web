// Local stand-in for tosu (self-test only): serves dist/osu-star-tosu at /osu-star-tosu/, the current .osu at
// /files/beatmap/file and a v2 websocket at /websocket/v2 that pushes the mock state every 300 ms.
//   node tools/mock-tosu.mjs [port]      default 24050
// Drive it with GET /mock?file=<path to .osu>&state=<tosu GameState number>&mods=<JSON array of {acronym, settings}>
// (each parameter optional; state 5 = song select, 2 = playing). GET /mock returns the current mock state.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const port = Number(process.argv[2]) || 24050;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.wasm': 'application/wasm; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};
const mock = { file: '', state: 5, mods: [], checksum: '', meta: {} };

function setFile(f) {
  const buf = fs.readFileSync(f);
  const text = buf.toString('utf8');
  const g = k => ((text.match(new RegExp(`^${k}:(.*)$`, 'm')) || [])[1] || '').trim();
  mock.file = f;
  mock.checksum = crypto.createHash('md5').update(buf).digest('hex');
  mock.meta = { artist: g('Artist'), title: g('Title'), version: g('Version'), mapper: g('Creator'), mode: Number(g('Mode') || 0) };
}

function v2() {
  const DT = mock.mods.some(m => m.acronym === 'DT' || m.acronym === 'NC');
  const HT = mock.mods.some(m => m.acronym === 'HT' || m.acronym === 'DC');
  const sc = (mock.mods.find(m => m.settings && typeof m.settings.speed_change === 'number') || {}).settings;
  return {
    client: 'lazer', state: { number: mock.state, name: mock.state === 2 ? 'play' : 'selectPlay' },
    beatmap: { checksum: mock.checksum, artist: mock.meta.artist, title: mock.meta.title, version: mock.meta.version,
      mapper: mock.meta.mapper, mode: { number: mock.meta.mode, name: '' } },
    play: { mods: { checksum: '', number: 0, name: mock.mods.map(m => m.acronym).join(''), array: mock.mods,
      rate: sc ? sc.speed_change : DT ? 1.5 : HT ? 0.75 : 1 } },
    files: { beatmap: path.basename(mock.file) }, folders: { beatmap: path.dirname(mock.file) },
  };
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/mock') {
    try {
      if (u.searchParams.has('file')) setFile(u.searchParams.get('file'));
      if (u.searchParams.has('state')) mock.state = Number(u.searchParams.get('state'));
      if (u.searchParams.has('mods')) mock.mods = JSON.parse(u.searchParams.get('mods'));
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ...mock, meta: mock.meta }));
    } catch (e) { res.writeHead(400).end(String(e.message || e)); }
    return;
  }
  if (u.pathname === '/files/beatmap/file') {
    if (!mock.file) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }).end(fs.readFileSync(mock.file));
    return;
  }
  let p = decodeURIComponent(u.pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(root, p);
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || '' }).end(buf);
  });
});

// minimal websocket server: handshake + unmasked text frames from the server; client frames are ignored
const clients = new Set();
server.on('upgrade', (req, socket) => {
  if (!req.url.startsWith('/websocket/v2')) { socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  clients.add(socket);
  socket.on('data', () => {});
  socket.on('error', () => clients.delete(socket));
  socket.on('close', () => clients.delete(socket));
});
function frame(text) {
  const body = Buffer.from(text, 'utf8');
  const n = body.length;
  const head = n < 126 ? Buffer.from([0x81, n]) : n < 65536 ? Buffer.from([0x81, 126, n >> 8, n & 255])
    : Buffer.concat([Buffer.from([0x81, 127]), (() => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(n)); return b; })()]);
  return Buffer.concat([head, body]);
}
setInterval(() => {
  const f = frame(JSON.stringify(v2()));
  for (const s of clients) { try { s.write(f); } catch (e) { clients.delete(s); } }
}, 300);

server.listen(port, '127.0.0.1', () => console.log(`mock tosu at http://127.0.0.1:${port}/osu-star-tosu/`));
