// MD5 of a string's UTF-8 bytes, as lowercase hex. Last.fm request signatures
// require MD5, which WebCrypto does not provide.
(function (root) {
  'use strict';

  const SHIFTS = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];
  const K = new Uint32Array(64);
  for (let i = 0; i < 64; i++) {
    K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296);
  }

  function md5(str) {
    const bytes = new TextEncoder().encode(String(str));
    const len = bytes.length;
    const padded = new Uint8Array((((len + 8) >> 6) + 1) << 6);
    padded.set(bytes);
    padded[len] = 0x80;
    const view = new DataView(padded.buffer);
    view.setUint32(padded.length - 8, (len << 3) >>> 0, true);
    view.setUint32(padded.length - 4, Math.floor(len / 536870912), true);

    let a0 = 0x67452301;
    let b0 = 0xefcdab89;
    let c0 = 0x98badcfe;
    let d0 = 0x10325476;

    for (let off = 0; off < padded.length; off += 64) {
      let a = a0;
      let b = b0;
      let c = c0;
      let d = d0;
      for (let i = 0; i < 64; i++) {
        let f;
        let g;
        if (i < 16) {
          f = (b & c) | (~b & d);
          g = i;
        } else if (i < 32) {
          f = (d & b) | (~d & c);
          g = (5 * i + 1) % 16;
        } else if (i < 48) {
          f = b ^ c ^ d;
          g = (3 * i + 5) % 16;
        } else {
          f = c ^ (b | ~d);
          g = (7 * i) % 16;
        }
        f = (f + a + K[i] + view.getUint32(off + g * 4, true)) >>> 0;
        a = d;
        d = c;
        c = b;
        b = (b + ((f << SHIFTS[i]) | (f >>> (32 - SHIFTS[i])))) >>> 0;
      }
      a0 = (a0 + a) >>> 0;
      b0 = (b0 + b) >>> 0;
      c0 = (c0 + c) >>> 0;
      d0 = (d0 + d) >>> 0;
    }

    const out = new DataView(new ArrayBuffer(16));
    out.setUint32(0, a0, true);
    out.setUint32(4, b0, true);
    out.setUint32(8, c0, true);
    out.setUint32(12, d0, true);
    let hex = '';
    for (let i = 0; i < 16; i++) {
      hex += out.getUint8(i).toString(16).padStart(2, '0');
    }
    return hex;
  }

  root.md5 = md5;
  if (typeof module !== 'undefined' && module.exports) module.exports = { md5 };
})(globalThis);
