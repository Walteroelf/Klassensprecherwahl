/*
 * qrscan.js – QR-Codes mit der Kamera lesen (alles lokal, kein Online-Dienst)
 * ---------------------------------------------------------------------------
 * Safari kann QR-Codes nicht von selbst in Webseiten lesen. Deshalb gibt es hier einen
 * kleinen eigenen Leser. Er versteht genau die Codes, die qr.js erzeugt (Bytes, Stufe L).
 * Ablauf: Bild → schwarz/weiß → drei Eckmuster finden → Raster ablesen →
 *         Fehler korrigieren (Reed-Solomon) → Text.
 *
 *   QRScan.decode(imageData)         → Text oder null
 *   QRScan.start(video, onText, onError) → { stop() }   (öffnet die Kamera)
 */
(function (root) {
  'use strict';
  var T = root.QR.tables;

  /* ---------- Rechnen im Galois-Feld (für die Fehlerkorrektur) ---------- */
  var EXP = [], LOG = [];
  (function () {
    var x = 1, i;
    for (i = 0; i < 256; i++) { LOG.push(0); }
    for (i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11D; }
    for (i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  })();
  function mul(a, b) { return a && b ? EXP[LOG[a] + LOG[b]] : 0; }
  function inv(a) { return EXP[255 - LOG[a]]; }

  // Ein Block (Daten + Prüfbytes) korrigieren. Gibt die korrigierte Liste oder null zurück.
  function rsCorrect(msg, nsym) {
    var n = msg.length, synd = [], bad = false, i, j;
    for (i = 0; i < nsym; i++) {
      var s = 0;
      for (j = 0; j < n; j++) s = mul(s, EXP[i]) ^ msg[j];
      synd.push(s);
      if (s) bad = true;
    }
    if (!bad) return msg;

    // Berlekamp-Massey: Fehlerstellen-Polynom bestimmen
    var C = [1], B = [1], Lc = 0, m = 1, b = 1, d, coef, T2;
    for (var k = 0; k < nsym; k++) {
      d = synd[k];
      for (i = 1; i <= Lc; i++) d ^= mul(C[i] || 0, synd[k - i]);
      if (d === 0) { m++; continue; }
      coef = mul(d, inv(b));
      T2 = C.slice();
      while (C.length < B.length + m) C.push(0);
      for (i = 0; i < B.length; i++) C[i + m] ^= mul(coef, B[i]);
      if (2 * Lc <= k) { Lc = k + 1 - Lc; B = T2; b = d; m = 1; } else m++;
    }
    if (Lc * 2 > nsym) return null;

    // Nullstellen suchen (Chien)
    var pos = [];
    for (var p = 0; p < n; p++) {
      var x = EXP[(255 - p) % 255], v = 0, xp = 1;
      for (i = 0; i < C.length; i++) { v ^= mul(C[i], xp); xp = mul(xp, x); }
      if (v === 0) pos.push(p);
    }
    if (pos.length !== Lc) return null;

    // Fehlerwerte (Forney)
    var omega = [];
    for (i = 0; i < nsym; i++) {
      var o = 0;
      for (j = 0; j <= i && j < C.length; j++) o ^= mul(C[j], synd[i - j]);
      omega.push(o);
    }
    var out = msg.slice();
    for (i = 0; i < pos.length; i++) {
      var Xk = EXP[pos[i] % 255], Xi = inv(Xk), num = 0, den = 0, pw = 1;
      for (j = 0; j < omega.length; j++) { num ^= mul(omega[j], pw); pw = mul(pw, Xi); }
      pw = 1;                                    // Ableitung: nur ungerade Potenzen
      for (j = 1; j < C.length; j += 2) { den ^= mul(C[j], pw); pw = mul(pw, mul(Xi, Xi)); }
      if (!den) return null;
      out[n - 1 - pos[i]] ^= mul(Xk, mul(num, inv(den)));
    }
    // Kontrolle: danach müssen alle Prüfsummen stimmen
    for (i = 0; i < nsym; i++) {
      var s2 = 0;
      for (j = 0; j < n; j++) s2 = mul(s2, EXP[i]) ^ out[j];
      if (s2) return null;
    }
    return out;
  }

  /* ---------- Bild in Schwarz/Weiß umwandeln ---------- */
  function toGray(img) {
    var d = img.data, n = img.width * img.height, g = new Uint8Array(n);
    for (var i = 0, j = 0; i < n; i++, j += 4) g[i] = (d[j] * 77 + d[j + 1] * 151 + d[j + 2] * 28) >> 8;
    return g;
  }
  // Lokale Schwelle: jeder Punkt wird mit dem Durchschnitt seiner Umgebung verglichen
  function binAdaptive(g, w, h) {
    var win = Math.max(25, Math.floor(Math.min(w, h) / 8)) | 1, half = win >> 1;
    var sat = new Float64Array((w + 1) * (h + 1)), x, y;
    for (y = 0; y < h; y++) {
      var row = 0;
      for (x = 0; x < w; x++) { row += g[y * w + x]; sat[(y + 1) * (w + 1) + x + 1] = sat[y * (w + 1) + x + 1] + row; }
    }
    var bw = new Uint8Array(w * h);
    for (y = 0; y < h; y++) {
      var y0 = Math.max(0, y - half), y1 = Math.min(h, y + half + 1);
      for (x = 0; x < w; x++) {
        var x0 = Math.max(0, x - half), x1 = Math.min(w, x + half + 1);
        var sum = sat[y1 * (w + 1) + x1] - sat[y0 * (w + 1) + x1] - sat[y1 * (w + 1) + x0] + sat[y0 * (w + 1) + x0];
        var mean = sum / ((x1 - x0) * (y1 - y0));
        bw[y * w + x] = g[y * w + x] < mean - Math.max(6, mean * 0.05) ? 1 : 0;
      }
    }
    return bw;
  }
  // Eine einzige Schwelle für das ganze Bild (Otsu)
  function binGlobal(g, w, h) {
    var hist = new Array(256).fill(0), i, n = w * h;
    for (i = 0; i < n; i++) hist[g[i]]++;
    var sum = 0; for (i = 0; i < 256; i++) sum += i * hist[i];
    var sumB = 0, wB = 0, best = 0, thr = 128;
    for (i = 0; i < 256; i++) {
      wB += hist[i]; if (!wB) continue;
      var wF = n - wB; if (!wF) break;
      sumB += i * hist[i];
      var mB = sumB / wB, mF = (sum - sumB) / wF, between = wB * wF * (mB - mF) * (mB - mF);
      if (between > best) { best = between; thr = i; }
    }
    var bw = new Uint8Array(n);
    for (i = 0; i < n; i++) bw[i] = g[i] <= thr ? 1 : 0;
    return bw;
  }

  /* ---------- Eckmuster (Verhältnis 1:1:3:1:1) finden ---------- */
  function ratioOk(s) {
    var total = s[0] + s[1] + s[2] + s[3] + s[4];
    if (total < 7) return 0;
    var m = total / 7;
    if (Math.abs(s[0] - m) > m * 0.65 || Math.abs(s[1] - m) > m * 0.65 || Math.abs(s[3] - m) > m * 0.65 || Math.abs(s[4] - m) > m * 0.65) return 0;
    if (Math.abs(s[2] - 3 * m) > 1.5 * m) return 0;
    return m;
  }
  // Prüft eine Linie durch (x, y) in Richtung (dx, dy). Liefert Mitte (Verschiebung) und Gesamtlänge oder null.
  function cross(bw, w, h, x, y, dx, dy) {
    function dark(k) { var xx = x + dx * k, yy = y + dy * k; return xx >= 0 && yy >= 0 && xx < w && yy < h && bw[yy * w + xx] === 1; }
    function inside(k) { var xx = x + dx * k, yy = y + dy * k; return xx >= 0 && yy >= 0 && xx < w && yy < h; }
    var s = [0, 0, 0, 0, 0], a = 0, k;
    for (k = 0; inside(-k) && dark(-k); k++) { s[2]++; a++; }
    if (!inside(-k)) return null;
    for (; inside(-k) && !dark(-k); k++) s[1]++;
    if (!inside(-k)) return null;
    for (; inside(-k) && dark(-k); k++) s[0]++;
    var b = 0;
    for (k = 1; inside(k) && dark(k); k++) { s[2]++; b++; }
    if (!inside(k)) return null;
    for (; inside(k) && !dark(k); k++) s[3]++;
    if (!inside(k)) return null;
    for (; inside(k) && dark(k); k++) s[4]++;
    var m = ratioOk(s);
    if (!m) return null;
    return { shift: (b - a + 1) / 2, size: s[0] + s[1] + s[2] + s[3] + s[4] };
  }
  function findFinders(bw, w, h) {
    var cands = [], y, x, r;
    for (y = 0; y < h; y++) {
      // Zeile in Läufe zerlegen: Länge, Startpunkt und Farbe
      var lens = [], starts = [], cols = [], start = 0, cur = bw[y * w];
      for (x = 1; x <= w; x++) {
        if (x === w || bw[y * w + x] !== cur) { lens.push(x - start); starts.push(start); cols.push(cur); start = x; cur = x < w ? bw[y * w + x] : 0; }
      }
      for (r = 4; r < lens.length; r++) {
        if (cols[r] !== 1) continue;                            // Muster: schwarz-weiß-schwarz-weiß-schwarz
        if (!ratioOk([lens[r - 4], lens[r - 3], lens[r - 2], lens[r - 1], lens[r]])) continue;
        var cxi = Math.floor(starts[r - 2] + lens[r - 2] / 2);
        var vy = cross(bw, w, h, cxi, y, 0, 1);
        if (!vy) continue;
        var cy = Math.floor(y + vy.shift);
        var hx = cross(bw, w, h, cxi, cy, 1, 0);
        if (!hx) continue;
        var cx2 = Math.floor(cxi + hx.shift);
        var vy2 = cross(bw, w, h, cx2, cy, 0, 1);
        if (!vy2) continue;
        var px = cxi + hx.shift + 0.5, py = cy + vy2.shift + 0.5, sz = (hx.size + vy2.size) / 2 / 7;
        var merged = false;
        for (var i = 0; i < cands.length; i++) {
          var c = cands[i];
          if (Math.abs(c.x - px) < c.m * 2 && Math.abs(c.y - py) < c.m * 2 && Math.abs(c.m - sz) < c.m * 0.6) {
            c.x = (c.x * c.n + px) / (c.n + 1); c.y = (c.y * c.n + py) / (c.n + 1); c.m = (c.m * c.n + sz) / (c.n + 1); c.n++;
            merged = true; break;
          }
        }
        if (!merged) cands.push({ x: px, y: py, m: sz, n: 1 });
      }
    }
    return cands.filter(function (c) { return c.n >= 2; }).sort(function (a, b) { return b.n - a.n; }).slice(0, 9);
  }

  /* ---------- Geometrie ---------- */
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  // Projektive Abbildung aus vier Punktpaaren (Modulraum → Bild)
  function homography(src, dst) {
    var A = [], i, j, k;
    for (i = 0; i < 4; i++) {
      var x = src[i][0], y = src[i][1], u = dst[i][0], v = dst[i][1];
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
    }
    for (i = 0; i < 8; i++) {
      var piv = i;
      for (j = i + 1; j < 8; j++) if (Math.abs(A[j][i]) > Math.abs(A[piv][i])) piv = j;
      var tmp = A[i]; A[i] = A[piv]; A[piv] = tmp;
      if (Math.abs(A[i][i]) < 1e-12) return null;
      for (j = 0; j < 8; j++) {
        if (j === i) continue;
        var f = A[j][i] / A[i][i];
        for (k = i; k < 9; k++) A[j][k] -= f * A[i][k];
      }
    }
    var hh = []; for (i = 0; i < 8; i++) hh.push(A[i][8] / A[i][i]);
    return function (x, y) {
      var w = hh[6] * x + hh[7] * y + 1;
      return [(hh[0] * x + hh[1] * y + hh[2]) / w, (hh[3] * x + hh[4] * y + hh[5]) / w];
    };
  }

  /* ---------- Raster ablesen ---------- */
  function maskFn(mask) {
    switch (mask) {
      case 0: return function (x, y) { return (x + y) % 2 === 0; };
      case 1: return function (x, y) { return y % 2 === 0; };
      case 2: return function (x, y) { return x % 3 === 0; };
      case 3: return function (x, y) { return (x + y) % 3 === 0; };
      case 4: return function (x, y) { return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; };
      case 5: return function (x, y) { return x * y % 2 + x * y % 3 === 0; };
      case 6: return function (x, y) { return (x * y % 2 + x * y % 3) % 2 === 0; };
      default: return function (x, y) { return ((x + y) % 2 + x * y % 3) % 2 === 0; };
    }
  }
  // Welche Felder gehören nicht zu den Daten (Eckmuster, Takt, Format, Ausrichtung, Version)?
  function functionMap(ver) {
    var size = ver * 4 + 17, fn = [], x, y, i;
    for (y = 0; y < size; y++) fn.push(new Array(size).fill(false));
    for (i = 0; i < size; i++) { fn[i][6] = true; fn[6][i] = true; }
    function box(x0, y0, x1, y1) { for (var yy = y0; yy <= y1; yy++) for (var xx = x0; xx <= x1; xx++) if (xx >= 0 && yy >= 0 && xx < size && yy < size) fn[yy][xx] = true; }
    box(0, 0, 8, 8); box(size - 8, 0, size - 1, 8); box(0, size - 8, 8, size - 1);   // Ecken samt Formatfeldern
    var ap = T.alignPositions(ver);
    ap.forEach(function (ax, ia) {
      ap.forEach(function (ay, ib) {
        if ((ia === 0 && ib === 0) || (ia === 0 && ib === ap.length - 1) || (ia === ap.length - 1 && ib === 0)) return;
        box(ax - 2, ay - 2, ax + 2, ay + 2);
      });
    });
    if (ver >= 7) { box(size - 11, 0, size - 9, 5); box(0, size - 11, 5, size - 9); }
    return fn;
  }
  var FORMATS = (function () {                    // alle 8 gültigen Formatwörter für Stufe L
    var res = [];
    for (var mask = 0; mask < 8; mask++) {
      var data = (1 << 3) | mask, rem = data;
      for (var k = 0; k < 10; k++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      res.push(((data << 10) | rem) ^ 0x5412);
    }
    return res;
  })();
  function popcount(v) { var c = 0; while (v) { c += v & 1; v >>>= 1; } return c; }

  // Versucht, mit drei Eckmustern einen Code zu lesen. Die Größe wird geschätzt; schräg gehaltene Codes
  // wirken dabei breiter, deshalb werden auch die Nachbargrößen (±4 Module) probiert.
  function tryDecode(bw, w, h, tl, tr, bl) {
    var ms = (tl.m + tr.m + bl.m) / 3;
    var phi = Math.atan2(tr.y - tl.y, tr.x - tl.x);
    phi = Math.abs(((phi % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2));       // Drehung innerhalb 0…90°
    if (phi > Math.PI / 4) phi = Math.PI / 2 - phi;
    var msTrue = ms * Math.cos(phi);                                              // Messung entlang der Bildachsen ist zu lang
    var est = (dist(tl, tr) / msTrue + dist(tl, bl) / msTrue) / 2 + 7;
    var d0 = 17 + 4 * Math.round((est - 17) / 4), tried = [d0, d0 + 4, d0 - 4], i;
    for (i = 0; i < tried.length; i++) {
      if (tried[i] < 21 || tried[i] > 177) continue;
      var text = attempt(bw, w, h, tl, tr, bl, tried[i]);
      if (text) return text;
    }
    return null;
  }

  function attempt(bw, w, h, tl, tr, bl, dim) {
    var ver = (dim - 17) / 4, span = dim - 7;
    var ux = (tr.x - tl.x) / span, uy = (tr.y - tl.y) / span, vx = (bl.x - tl.x) / span, vy = (bl.y - tl.y) / span;
    function aff(mx, my) { return { x: tl.x + (mx - 3.5) * ux + (my - 3.5) * vx, y: tl.y + (mx - 3.5) * uy + (my - 3.5) * vy }; }
    function px(x, y) { x = Math.round(x); y = Math.round(y); return x >= 0 && y >= 0 && x < w && y < h ? bw[y * w + x] : 0; }

    // Vierter Punkt: das Ausrichtungsmuster unten rechts (ab Version 2) macht die Abbildung genauer
    var src = [[3.5, 3.5], [dim - 3.5, 3.5], [3.5, dim - 3.5]], dst = [[tl.x, tl.y], [tr.x, tr.y], [bl.x, bl.y]];
    var guess, found = null;
    if (ver >= 2) {
      guess = aff(dim - 6.5, dim - 6.5);
      var rad = Math.ceil(Math.hypot(ux, uy) * 4), best = -1, sumX = 0, sumY = 0, cnt = 0;
      for (var oy = -rad; oy <= rad; oy++) for (var ox = -rad; ox <= rad; ox++) {
        var sc = 0;
        for (var dy = -2; dy <= 2; dy++) for (var dx = -2; dx <= 2; dx++) {
          var dark = Math.max(Math.abs(dx), Math.abs(dy)) !== 1;
          if ((px(guess.x + ox + dx * ux + dy * vx, guess.y + oy + dx * uy + dy * vy) === 1) === dark) sc++;
        }
        // Bei Gleichstand den Mittelpunkt aller besten Stellen nehmen (genauer als die erste)
        if (sc > best) { best = sc; sumX = ox; sumY = oy; cnt = 1; }
        else if (sc === best) { sumX += ox; sumY += oy; cnt++; }
      }
      if (best >= 22) { found = { x: guess.x + sumX / cnt, y: guess.y + sumY / cnt }; src.push([dim - 6.5, dim - 6.5]); dst.push([found.x, found.y]); }
    }
    if (src.length < 4) { var g2 = aff(dim - 3.5, dim - 3.5); src.push([dim - 3.5, dim - 3.5]); dst.push([g2.x, g2.y]); }
    var map = homography(src, dst);
    if (!map) return null;

    // Raster abtasten (je Modul fünf Messpunkte, Mehrheit zählt)
    var grid = [], x, y, i;
    var offs = [[0, 0], [0.25, 0], [-0.25, 0], [0, 0.25], [0, -0.25]];
    for (y = 0; y < dim; y++) {
      var row = new Array(dim);
      for (x = 0; x < dim; x++) {
        var votes = 0;
        for (i = 0; i < 5; i++) { var p = map(x + 0.5 + offs[i][0], y + 0.5 + offs[i][1]); votes += px(p[0], p[1]); }
        row[x] = votes >= 3;
      }
      grid.push(row);
    }

    // Format lesen (Fehlerstufe L + Maske)
    function fbits(list) { var v = 0; list.forEach(function (c, k) { if (grid[c[1]][c[0]]) v |= 1 << k; }); return v; }
    var f1 = [], f2 = [], k;
    for (k = 0; k <= 5; k++) f1.push([8, k]);
    f1.push([8, 7], [8, 8], [7, 8]);
    for (k = 9; k < 15; k++) f1.push([14 - k, 8]);
    for (k = 0; k < 8; k++) f2.push([dim - 1 - k, 8]);
    for (k = 8; k < 15; k++) f2.push([8, dim - 15 + k]);
    var w1 = fbits(f1), w2 = fbits(f2), mask = -1, bestD = 4;
    FORMATS.forEach(function (fw, mk) {
      var dd = Math.min(popcount(fw ^ w1), popcount(fw ^ w2));
      if (dd < bestD) { bestD = dd; mask = mk; }
    });
    if (mask < 0) return null;

    // Daten im Zickzack lesen
    var fn = functionMap(ver), mf = maskFn(mask), bits = [], right, vert, j;
    for (right = dim - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (vert = 0; vert < dim; vert++) {
        for (j = 0; j < 2; j++) {
          x = right - j;
          y = ((right + 1) & 2) === 0 ? dim - 1 - vert : vert;
          if (!fn[y][x]) bits.push(grid[y][x] !== mf(x, y) ? 1 : 0);
        }
      }
    }
    var raw = Math.floor(T.rawModules(ver) / 8), cw = [];
    for (i = 0; i < raw; i++) {
      var val = 0;
      for (j = 0; j < 8; j++) val = (val << 1) | bits[i * 8 + j];
      cw.push(val);
    }

    // Blöcke trennen, korrigieren, Daten zusammensetzen
    var nb = T.NUM_BLOCKS[ver - 1], eccLen = T.ECC_PER_BLOCK[ver - 1];
    var nShort = nb - raw % nb, shortLen = Math.floor(raw / nb), blocks = [], q = 0;
    for (i = 0; i < nb; i++) blocks.push([]);
    for (i = 0; i <= shortLen; i++) {
      for (j = 0; j < nb; j++) {
        if (i !== shortLen - eccLen || j >= nShort) { if (q < cw.length) blocks[j].push(cw[q++]); }
      }
    }
    var data = [];
    for (i = 0; i < nb; i++) {
      var fixed = rsCorrect(blocks[i], eccLen);
      if (!fixed) return null;
      for (j = 0; j < fixed.length - eccLen; j++) data.push(fixed[j]);
    }

    // Text lesen (Byte-Modus)
    var pos = 0;
    function take(n) { var v = 0; for (var t = 0; t < n; t++, pos++) v = (v << 1) | ((data[pos >> 3] >> (7 - (pos & 7))) & 1); return v; }
    if (take(4) !== 4) return null;
    var len = take(ver < 10 ? 8 : 16);
    if ((pos + len * 8) > data.length * 8) return null;
    var out = new Uint8Array(len);
    for (i = 0; i < len; i++) out[i] = take(8);
    return new TextDecoder().decode(out);
  }

  function angleOk(c, a, b) {
    var ax = a.x - c.x, ay = a.y - c.y, bx = b.x - c.x, by = b.y - c.y;
    var cos = (ax * bx + ay * by) / (Math.hypot(ax, ay) * Math.hypot(bx, by));
    var r = Math.hypot(ax, ay) / Math.hypot(bx, by);
    return Math.abs(cos) < 0.4 && r > 0.55 && r < 1.8;
  }

  function decodeBinary(bw, w, h) {
    var f = findFinders(bw, w, h), i, j, k;
    for (i = 0; i < f.length; i++) for (j = i + 1; j < f.length; j++) for (k = j + 1; k < f.length; k++) {
      var tri = [f[i], f[j], f[k]];
      for (var c = 0; c < 3; c++) {                       // jede Ecke einmal als "oben links" probieren
        var tl = tri[c], a = tri[(c + 1) % 3], b = tri[(c + 2) % 3];
        if (!angleOk(tl, a, b)) continue;
        if (Math.max(tl.m, a.m, b.m) / Math.min(tl.m, a.m, b.m) > 1.8) continue;
        var crossP = (a.x - tl.x) * (b.y - tl.y) - (a.y - tl.y) * (b.x - tl.x);
        var tr = crossP > 0 ? a : b, bl = crossP > 0 ? b : a;
        var text = null;
        try { text = tryDecode(bw, w, h, tl, tr, bl); } catch (e) { text = null; }
        if (text) return text;
      }
    }
    return null;
  }

  function decode(img) {
    var g = toGray(img), w = img.width, h = img.height;
    return decodeBinary(binAdaptive(g, w, h), w, h) || decodeBinary(binGlobal(g, w, h), w, h);
  }

  /* ---------- Kamera ---------- */
  // Öffnet die Rückkamera im <video>-Element und ruft onText auf, sobald ein Code gelesen wurde.
  function start(video, onText, onError) {
    var stopped = false, stream = null, timer = null;
    var canvas = document.createElement('canvas'), ctx = canvas.getContext('2d', { willReadFrequently: true });
    var detector = null;
    try { if ('BarcodeDetector' in root) detector = new root.BarcodeDetector({ formats: ['qr_code'] }); } catch (e) { detector = null; }

    function stop() {
      stopped = true; clearTimeout(timer);
      if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
      video.srcObject = null;
    }
    async function loop() {
      if (stopped) return;
      var text = null;
      try {
        if (video.readyState >= 2 && video.videoWidth) {
          if (detector) {
            var codes = await detector.detect(video);
            if (codes.length) text = codes[0].rawValue;
          }
          if (!text) {
            var scale = Math.min(1, 960 / video.videoWidth);
            canvas.width = Math.round(video.videoWidth * scale); canvas.height = Math.round(video.videoHeight * scale);
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            text = decode(ctx.getImageData(0, 0, canvas.width, canvas.height));
          }
        }
      } catch (e) { text = null; }
      if (stopped) return;
      if (text) { stop(); onText(text); return; }
      timer = setTimeout(loop, 150);
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setTimeout(function () { onError(new Error('Die Kamera ist hier nicht verfügbar.')); }, 0);
      return { stop: stop };
    }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
      .then(function (s) {
        if (stopped) { s.getTracks().forEach(function (t) { t.stop(); }); return; }
        stream = s; video.srcObject = s; video.setAttribute('playsinline', ''); video.muted = true;
        return video.play().then(loop);
      })
      .catch(function () { onError(new Error('Die Kamera wurde nicht freigegeben. Bitte in den Einstellungen erlauben oder den Text einfügen.')); });
    return { stop: stop };
  }

  root.QRScan = { decode: decode, start: start, _rs: rsCorrect };
})(window);
