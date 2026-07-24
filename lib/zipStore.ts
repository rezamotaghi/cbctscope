// Store-only ZIP writer (no compression) — shared by the client export menu (PNG slice
// stacks: PNGs are already compressed, recompressing wastes time for ~0 gain) and the
// server DICOM passthrough route (zip of a slice-series folder). Pure Uint8Array/DataView,
// no fs, no deps — isomorphic by construction. Classic ZIP only (no ZIP64): fine for the
// sizes here; guards throw before emitting a corrupt archive if a limit is ever hit.
export interface ZipEntry {
  name: string; // forward-slash path inside the archive (ASCII expected)
  data: Uint8Array;
}

let crcTable: Uint32Array | null = null;
function crc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = crcTable[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** MS-DOS packed time/date (ZIP's native timestamp format), from local time now. */
function dosStamp(): { time: number; date: number } {
  const d = new Date();
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: (Math.max(0, d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/**
 * Assemble a store-only ZIP as an ordered chunk list (avoids one giant copy): client does
 * `new Blob(chunks)`, server does `Buffer.concat(...)`. Layout per the PKWARE APPNOTE:
 * [local header + data]* then the central directory then the end-of-central-directory record.
 */
export function zipStore(entries: ZipEntry[]): Uint8Array[] {
  if (entries.length >= 0xffff) throw new Error('zip: too many entries');
  const enc = new TextEncoder();
  const { time, date } = dosStamp();
  const chunks: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    if (e.data.length >= 0xffffffff) throw new Error(`zip: entry too large: ${e.name}`);
    const name = enc.encode(e.name);
    const crc = crc32(e.data);
    const lfh = new Uint8Array(30 + name.length);
    const lv = new DataView(lfh.buffer);
    lv.setUint32(0, 0x04034b50, true); // local file header signature
    lv.setUint16(4, 20, true); // version needed
    lv.setUint16(6, 0, true); // flags
    lv.setUint16(8, 0, true); // method: store
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, e.data.length, true); // compressed = uncompressed (store)
    lv.setUint32(22, e.data.length, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true); // extra len
    lfh.set(name, 30);
    chunks.push(lfh, e.data);

    const cen = new Uint8Array(46 + name.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true); // central directory signature
    cv.setUint16(4, 20, true); // version made by
    cv.setUint16(6, 20, true); // version needed
    cv.setUint16(8, 0, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, e.data.length, true);
    cv.setUint32(24, e.data.length, true);
    cv.setUint16(28, name.length, true);
    // extra/comment/disk/attrs all zero (30..37)
    cv.setUint32(42, offset, true); // local header offset
    cen.set(name, 46);
    centrals.push(cen);

    offset += lfh.length + e.data.length;
    if (offset >= 0xffffffff) throw new Error('zip: archive too large');
  }
  let cdSize = 0;
  for (const c of centrals) {
    chunks.push(c);
    cdSize += c.length;
  }
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true); // end-of-central-directory signature
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true); // central directory starts where the data ended
  chunks.push(eocd);
  return chunks;
}
