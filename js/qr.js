/*
 * qr.js – kleiner QR-Code-Erzeuger (Byte-Modus, Fehlerkorrektur L)
 * ----------------------------------------------------------------
 * Wird nur für die Kopplung mit der Tafel gebraucht. Alles läuft lokal.
 * QR.toCanvas(canvas, text, pixelProModul) zeichnet den Code.
 */
(function (root) {
  'use strict';

  // Tabellen für Fehlerkorrektur-Stufe L, Index = Version - 1
  var ECC_PER_BLOCK = [7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30];
  var NUM_BLOCKS = [1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25];

  function rawModules(ver) {
    var r = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
      var n = Math.floor(ver / 7) + 2;
      r -= (25 * n - 10) * n - 55;
      if (ver >= 7) r -= 36;
    }
    return r;
  }
  function dataCodewords(ver) {
    return Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK[ver - 1] * NUM_BLOCKS[ver - 1];
  }

  // Reed-Solomon-Rechnung (Fehlerkorrektur)
  function gfMul(x, y) {
    var z = 0;
    for (var i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11D);
      z ^= ((y >>> i) & 1) * x;
    }
    return z;
  }
  function rsDivisor(degree) {
    var res = [], i, j;
    for (i = 0; i < degree; i++) res.push(0);
    res[degree - 1] = 1;
    var root = 1;
    for (i = 0; i < degree; i++) {
      for (j = 0; j < degree; j++) {
        res[j] = gfMul(res[j], root);
        if (j + 1 < degree) res[j] ^= res[j + 1];
      }
      root = gfMul(root, 2);
    }
    return res;
  }
  function rsRemainder(data, divisor) {
    var res = divisor.map(function () { return 0; });
    data.forEach(function (b) {
      var factor = b ^ res.shift();
      res.push(0);
      divisor.forEach(function (coef, i) { res[i] ^= gfMul(coef, factor); });
    });
    return res;
  }

  // Daten in Blöcke teilen, Fehlerkorrektur anhängen und verschränken
  function addEcc(data, ver) {
    var nb = NUM_BLOCKS[ver - 1], eccLen = ECC_PER_BLOCK[ver - 1];
    var raw = Math.floor(rawModules(ver) / 8);
    var nShort = nb - raw % nb, shortLen = Math.floor(raw / nb);
    var blocks = [], div = rsDivisor(eccLen), k = 0, i;
    for (i = 0; i < nb; i++) {
      var dat = data.slice(k, k + shortLen - eccLen + (i < nShort ? 0 : 1));
      k += dat.length;
      var ecc = rsRemainder(dat, div);
      if (i < nShort) dat.push(0);
      blocks.push(dat.concat(ecc));
    }
    var out = [];
    for (i = 0; i < blocks[0].length; i++) {
      blocks.forEach(function (b, j) {
        if (i !== shortLen - eccLen || j >= nShort) out.push(b[i]);
      });
    }
    return out;
  }

  function alignPositions(ver) {
    if (ver === 1) return [];
    var n = Math.floor(ver / 7) + 2, size = ver * 4 + 17;
    var step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
    var res = [6];
    for (var pos = size - 7; res.length < n; pos -= step) res.splice(1, 0, pos);
    return res;
  }

  function bit(x, i) { return ((x >>> i) & 1) !== 0; }

  function encode(text) {
    var bytes = Array.from(new TextEncoder().encode(text));
    var ver;
    for (ver = 1; ver <= 40; ver++) {
      if (4 + (ver < 10 ? 8 : 16) + 8 * bytes.length <= dataCodewords(ver) * 8) break;
    }
    if (ver > 40) throw new Error('Der Text ist für einen QR-Code zu lang.');

    // Bits zusammenstellen
    var bits = [];
    function put(val, len) { for (var i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); }
    put(4, 4);                                  // Modus: Bytes
    put(bytes.length, ver < 10 ? 8 : 16);
    bytes.forEach(function (b) { put(b, 8); });
    var cap = dataCodewords(ver) * 8;
    put(0, Math.min(4, cap - bits.length));
    put(0, (8 - bits.length % 8) % 8);
    for (var pad = 0xEC; bits.length < cap; pad ^= 0xEC ^ 0x11) put(pad, 8);
    var cw = [];
    for (var i = 0; i < bits.length; i += 8) {
      var v = 0;
      for (var j = 0; j < 8; j++) v = (v << 1) | bits[i + j];
      cw.push(v);
    }
    var all = addEcc(cw, ver);

    // Matrix aufbauen
    var size = ver * 4 + 17, m = [], fn = [], y, x;
    for (y = 0; y < size; y++) { m.push(new Array(size).fill(false)); fn.push(new Array(size).fill(false)); }
    function setFn(x, y, dark) { m[y][x] = dark; fn[y][x] = true; }

    for (i = 0; i < size; i++) { setFn(6, i, i % 2 === 0); setFn(i, 6, i % 2 === 0); }   // Taktlinien
    function finder(cx, cy) {
      for (var dy = -4; dy <= 4; dy++) for (var dx = -4; dx <= 4; dx++) {
        var d = Math.max(Math.abs(dx), Math.abs(dy)), xx = cx + dx, yy = cy + dy;
        if (xx >= 0 && xx < size && yy >= 0 && yy < size) setFn(xx, yy, d !== 2 && d !== 4);
      }
    }
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
    var ap = alignPositions(ver);
    ap.forEach(function (ax, ia) {
      ap.forEach(function (ay, ib) {
        if ((ia === 0 && ib === 0) || (ia === 0 && ib === ap.length - 1) || (ia === ap.length - 1 && ib === 0)) return;
        for (var dy = -2; dy <= 2; dy++) for (var dx = -2; dx <= 2; dx++) setFn(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      });
    });
    function formatBits(mask) {
      var data = (1 << 3) | mask;               // Stufe L = 01
      var rem = data;
      for (var k = 0; k < 10; k++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      var b = ((data << 10) | rem) ^ 0x5412, k2;
      for (k2 = 0; k2 <= 5; k2++) setFn(8, k2, bit(b, k2));
      setFn(8, 7, bit(b, 6)); setFn(8, 8, bit(b, 7)); setFn(7, 8, bit(b, 8));
      for (k2 = 9; k2 < 15; k2++) setFn(14 - k2, 8, bit(b, k2));
      for (k2 = 0; k2 < 8; k2++) setFn(size - 1 - k2, 8, bit(b, k2));
      for (k2 = 8; k2 < 15; k2++) setFn(8, size - 15 + k2, bit(b, k2));
      setFn(8, size - 8, true);
    }
    formatBits(0);
    if (ver >= 7) {
      var rem = ver;
      for (i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
      var vb = (ver << 12) | rem;
      for (i = 0; i < 18; i++) {
        var a = size - 11 + i % 3, b2 = Math.floor(i / 3);
        setFn(a, b2, bit(vb, i)); setFn(b2, a, bit(vb, i));
      }
    }

    // Daten im Zickzack einzeichnen
    var idx = 0;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < size; vert++) {
        for (j = 0; j < 2; j++) {
          x = right - j;
          y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
          if (!fn[y][x] && idx < all.length * 8) { m[y][x] = bit(all[idx >>> 3], 7 - (idx & 7)); idx++; }
        }
      }
    }

    // Beste Maske wählen
    function applyMask(mask) {
      for (var yy = 0; yy < size; yy++) for (var xx = 0; xx < size; xx++) {
        var inv;
        switch (mask) {
          case 0: inv = (xx + yy) % 2 === 0; break;
          case 1: inv = yy % 2 === 0; break;
          case 2: inv = xx % 3 === 0; break;
          case 3: inv = (xx + yy) % 3 === 0; break;
          case 4: inv = (Math.floor(xx / 3) + Math.floor(yy / 2)) % 2 === 0; break;
          case 5: inv = xx * yy % 2 + xx * yy % 3 === 0; break;
          case 6: inv = (xx * yy % 2 + xx * yy % 3) % 2 === 0; break;
          default: inv = ((xx + yy) % 2 + xx * yy % 3) % 2 === 0;
        }
        if (!fn[yy][xx] && inv) m[yy][xx] = !m[yy][xx];
      }
    }
    function penalty() {
      var p = 0, r, c, run, dark = 0;
      for (r = 0; r < size; r++) {
        run = 1;
        for (c = 1; c < size; c++) {
          if (m[r][c] === m[r][c - 1]) { run++; if (run === 5) p += 3; else if (run > 5) p++; } else run = 1;
        }
        run = 1;
        for (c = 1; c < size; c++) {
          if (m[c][r] === m[c - 1][r]) { run++; if (run === 5) p += 3; else if (run > 5) p++; } else run = 1;
        }
      }
      for (r = 0; r < size; r++) for (c = 0; c < size; c++) {
        if (m[r][c]) dark++;
        if (r < size - 1 && c < size - 1 && m[r][c] === m[r][c + 1] && m[r][c] === m[r + 1][c] && m[r][c] === m[r + 1][c + 1]) p += 3;
      }
      p += (Math.ceil(Math.abs(dark * 20 - size * size * 10) / (size * size)) - 1) * 10;
      return p;
    }
    var best = 0, bestP = Infinity;
    for (var mask = 0; mask < 8; mask++) {
      applyMask(mask); formatBits(mask);
      var pen = penalty();
      if (pen < bestP) { bestP = pen; best = mask; }
      applyMask(mask);                          // wieder zurücknehmen
    }
    applyMask(best); formatBits(best);
    return { size: size, modules: m, version: ver };
  }

  function toCanvas(canvas, text, scale) {
    var qr = encode(text), quiet = 4, px = scale || 4;
    canvas.width = canvas.height = (qr.size + quiet * 2) * px;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#000';
    for (var y = 0; y < qr.size; y++) for (var x = 0; x < qr.size; x++) {
      if (qr.modules[y][x]) ctx.fillRect((x + quiet) * px, (y + quiet) * px, px, px);
    }
    return qr;
  }

  root.QR = { encode: encode, toCanvas: toCanvas };
})(window);
