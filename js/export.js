/*
 * export.js – Ergebnis als Bild oder PDF für das Klassenbuch
 * -----------------------------------------------------------
 * Der Export enthält NUR: Titel, Datum, Kandidaten (mit Foto) mit Summen und ggf. die Enthaltungen.
 * Niemals Einzelstimmen. Alles wird lokal auf dem Gerät erzeugt.
 * results = [{ title, abstentions, rows: [{ name, votes, rank }] }]
 */
(function (root) {
  'use strict';
  var W = 1240, H = 1754;          // A4 bei 150 dpi
  var FONT = '-apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif';

  function loadImg(src) {
    return new Promise(function (resolve) {
      var i = new Image();
      i.onload = function () { resolve(i); };
      i.onerror = function () { resolve(null); };
      i.src = src;
    });
  }

  // Seite zeichnen. Enthält die Ergebnisse (rows) Fotos (row.photo), werden sie neben den Namen gezeigt.
  // school (optional): { name, logo } erscheint oben auf der Seite
  async function render(title, dateMs, results, school) {
    var withPhotos = results.some(function (r) { return r.rows.some(function (x) { return x.photo; }); });
    var imgs = {};
    if (withPhotos) {
      var jobs = [];
      results.forEach(function (r, b) { r.rows.forEach(function (x, i) { if (x.photo) jobs.push(loadImg(x.photo).then(function (im) { imgs[b + '-' + i] = im; })); }); });
      await Promise.all(jobs);
    }
    school = school || {};
    var logoImg = school.logo ? await loadImg(school.logo) : null;
    var extra = (logoImg ? 150 : 0) + (school.name ? 60 : 0);        // Platz für Logo und Schulname oben
    var c = document.createElement('canvas');
    c.width = W; c.height = H;
    var g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#111'; g.textBaseline = 'alphabetic';
    var sy = 40;
    if (logoImg) {
      var lk = Math.min(130 / logoImg.height, 420 / logoImg.width), lw = logoImg.width * lk, lh = logoImg.height * lk;
      g.drawImage(logoImg, (W - lw) / 2, sy, lw, lh); sy += 150;
    }
    if (school.name) { g.textAlign = 'center'; g.fillStyle = '#333'; g.font = '600 40px ' + FONT; g.fillText(school.name, W / 2, sy + 32); g.fillStyle = '#111'; }

    // Titel (verkleinern, wenn er zu lang ist)
    var size = 72;
    g.font = '700 ' + size + 'px ' + FONT;
    while (g.measureText(title).width > W - 200 && size > 30) { size -= 2; g.font = '700 ' + size + 'px ' + FONT; }
    g.textAlign = 'center';
    g.fillText(title, W / 2, 170 + extra);
    g.font = '400 36px ' + FONT; g.fillStyle = '#444';
    g.fillText('Datum: ' + new Date(dateMs).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }), W / 2, 235 + extra);
    g.fillStyle = '#999'; g.fillRect(100, 275 + extra, W - 200, 3);

    // Zeilenhöhe so wählen, dass alles auf die Seite passt
    var lines = 0;
    results.forEach(function (r) { lines += r.rows.length + (r.abstentions != null ? 1 : 0) + (r.title ? 2 : 1); });
    var avail = (H - 275 - extra - 200) / Math.max(lines, 1);
    var rowH = withPhotos ? Math.max(56, Math.min(120, avail)) : Math.max(34, Math.min(72, avail));
    var fs = Math.round(rowH * (withPhotos ? 0.42 : 0.55));
    var ps = Math.round(rowH * 0.86);                      // Fotogröße
    var nameX = withPhotos ? 170 + ps + 24 : 190;
    var y = 275 + extra + rowH * 1.1;

    results.forEach(function (r, b) {
      if (r.title) {
        g.textAlign = 'left'; g.fillStyle = '#1e46a6'; g.font = '700 ' + Math.round(fs * 1.15) + 'px ' + FONT;
        g.fillText('Gruppe ' + r.title, 100, y); y += rowH * 1.1;
      }
      r.rows.forEach(function (row, i) {
        var win = row.rank === 1 && row.votes !== 0;
        if (withPhotos) {
          var cy = y - fs * 0.35, x0 = 170, y0 = cy - ps / 2, im = imgs[b + '-' + i];
          g.save();
          g.beginPath();
          if (g.roundRect) g.roundRect(x0, y0, ps, ps, ps * 0.18); else g.rect(x0, y0, ps, ps);
          g.clip();
          if (im) g.drawImage(im, x0, y0, ps, ps);
          else { g.fillStyle = '#e3e8f4'; g.fillRect(x0, y0, ps, ps); g.fillStyle = '#1e46a6'; g.font = '700 ' + Math.round(ps * 0.5) + 'px ' + FONT; g.textAlign = 'center'; g.fillText(row.name.charAt(0).toUpperCase(), x0 + ps / 2, y0 + ps * 0.68); }
          g.restore();
        }
        g.fillStyle = win ? '#11693a' : '#111';
        g.font = (win ? '700 ' : '400 ') + fs + 'px ' + FONT;
        g.textAlign = 'left';
        g.fillText(row.rank + '.', 100, y);
        g.fillText(row.name, nameX, y);
        if (row.votes != null) { g.textAlign = 'right'; g.fillText(String(row.votes), W - 100, y); }
        y += rowH;
      });
      if (r.abstentions != null) {            // bei begrenzter Platzzahl werden die Enthaltungen nicht gezeigt
        g.fillStyle = '#555'; g.font = 'italic 400 ' + fs + 'px ' + FONT; g.textAlign = 'left';
        g.fillText('Enthaltungen', nameX, y);
        g.textAlign = 'right'; g.fillText(String(r.abstentions), W - 100, y);
        y += rowH * 0.4;
      }
      y += rowH;
    });

    g.textAlign = 'center'; g.fillStyle = '#999'; g.font = '400 26px ' + FONT;
    g.fillText('Klassensprecherwahl-App', W / 2, H - 70);
    return c;
  }

  function toPngBlob(canvas) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (b) { b ? resolve(b) : reject(new Error('Bild konnte nicht erzeugt werden.')); }, 'image/png');
    });
  }

  // Ein einfaches einseitiges PDF (A4), das das Ergebnisbild enthält
  function toPdfBlob(canvas) {
    var bin = atob(canvas.toDataURL('image/jpeg', 0.92).split(',')[1]);
    var jpg = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) jpg[i] = bin.charCodeAt(i);
    var enc = new TextEncoder(), parts = [], offsets = {}, len = 0;
    function push(x) { var u = typeof x === 'string' ? enc.encode(x) : x; parts.push(u); len += u.length; }
    function obj(n, body) { offsets[n] = len; push(n + ' 0 obj\n' + body + '\nendobj\n'); }
    push('%PDF-1.4\n');
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
    obj(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>');
    offsets[4] = len;
    push('4 0 obj\n<< /Type /XObject /Subtype /Image /Width ' + canvas.width + ' /Height ' + canvas.height +
      ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + jpg.length + ' >>\nstream\n');
    push(jpg);
    push('\nendstream\nendobj\n');
    var content = 'q 595 0 0 842 0 0 cm /Im0 Do Q';
    obj(5, '<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream');
    var xref = len, x = 'xref\n0 6\n0000000000 65535 f \n';
    for (var n = 1; n <= 5; n++) x += ('0000000000' + offsets[n]).slice(-10) + ' 00000 n \n';
    push(x + 'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF');
    return new Blob(parts, { type: 'application/pdf' });
  }

  // Lokal speichern. Wo der Browser es kann (Chrome, Edge am Mac), öffnet sich ein Speichern-Fenster mit freier
  // Ortswahl (z. B. Schreibtisch). Sonst startet ein normaler Download (Safari: Ordner „Downloads“, am iPad „Dateien“).
  async function saveLocal(blob, filename) {
    if (window.showSaveFilePicker) {
      try {
        var ext = filename.split('.').pop();
        var handle = await window.showSaveFilePicker({
          suggestedName: filename,
          types: [{ description: ext === 'pdf' ? 'PDF-Dokument' : 'PNG-Bild', accept: { [blob.type]: ['.' + ext] } }]
        });
        var w = await handle.createWritable();
        await w.write(blob); await w.close();
        return 'saved';
      } catch (err) { if (err && err.name === 'AbortError') return 'cancel'; }
    }
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.append(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
    return 'download';
  }
  // Teilen-Menü des Geräts (Dateien, Drucken, Mail, AirDrop …)
  async function share(blob, filename, title) {
    var file = new File([blob], filename, { type: blob.type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: title }); return 'shared'; }
      catch (err) { if (err && err.name === 'AbortError') return 'cancel'; }
    }
    return saveLocal(blob, filename);
  }

  root.ExportDoc = { render: render, toPngBlob: toPngBlob, toPdfBlob: toPdfBlob, saveLocal: saveLocal, share: share };
})(window);
