// minimal .npy reader (little-endian f4/f8/i4/i8/b1, C order)
import fs from 'node:fs';
export function readNpy(p) {
  const b = fs.readFileSync(p);
  const hl = b.readUInt16LE(8);
  const header = b.slice(10, 10 + hl).toString('latin1');
  const descr = /'descr':\s*'([^']+)'/.exec(header)[1];
  const shape = /'shape':\s*\(([^)]*)\)/.exec(header)[1].split(',').filter(s => s.trim()).map(Number);
  const off = 10 + hl;
  const buf = b.buffer.slice(b.byteOffset + off, b.byteOffset + b.length);
  const T = { '<f4': Float32Array, '<f8': Float64Array, '<i4': Int32Array, '|b1': Uint8Array, '<i8': BigInt64Array }[descr];
  return { data: new T(buf), shape };
}
