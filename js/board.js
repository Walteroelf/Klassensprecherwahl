/*
 * board.js – Tafelansicht (Fernbedienung und Anzeige)
 * ---------------------------------------------------
 * Die Tafel bekommt vom iPad nur: Titel, Phase (bereit / stimmt ab / abgestimmt …) und die
 * Zahlen "abgegeben" und "Wähler gesamt". Nach dem Abschluss kommen zusätzlich die Summen.
 * NIE kommen Einzelstimmen an. Die Tafel speichert nichts dauerhaft.
 * Sie schickt nur zwei Befehle zurück: "next" (nächster Wähler) und "undo" (Freischaltung zurücknehmen).
 */
(function () {
  'use strict';
  var h = Dom.h, Link = window.Link, QR = window.QR;
  var app = document.getElementById('app');
  var state = null;
  var connected = false;
  var scanStop = null;

  function show() {
    stopScan();
    Dom.mount.apply(null, [app].concat(Array.prototype.slice.call(arguments)));
    // Orangefarbenes Banner, solange am iPad der Probemodus läuft
    var test = !!(state && state.practice);
    document.getElementById('testbanner').hidden = !test;
    document.body.classList.toggle('practice', test);
  }

  /* ---------- Kopplung ---------- */
  async function pairView(message) {
    show(h('h1', {}, 'Tafel verbinden'), h('p', { class: 'muted' }, message || 'Verbindungscode wird erstellt …'));
    var offer;
    try { offer = await Link.createOffer(); }
    catch (err) { show(h('h1', {}, 'Verbindung nicht möglich'), h('p', {}, err.message)); return; }

    var cv = h('canvas', { class: 'qr' });
    QR.toCanvas(cv, offer, 5);
    var answer = h('textarea', { placeholder: 'Antworttext des iPads hier einfügen' });
    var status = h('p', { class: 'muted' }, '');

    async function connect(text) {
      try { await Link.acceptAnswer(text); status.textContent = 'Verbindung wird aufgebaut …'; }
      catch (err) { status.textContent = err.message; }
    }

    var video = h('video', { class: 'scan', playsinline: true, muted: true, hidden: true });
    var scanBtn = ('BarcodeDetector' in window && navigator.mediaDevices) ?
      h('button', { class: 'btn btn-secondary', onclick: function () { startScan(video, status, connect); } }, '📷 QR-Code des iPads scannen') : null;

    show(
      h('h1', {}, 'Tafel verbinden'),
      h('p', { class: 'muted' }, 'iPad und Tafel müssen im selben WLAN sein.'),
      h('div', { class: 'pair-grid' },
        h('div', { class: 'card' },
          h('h2', {}, '1. Auf dem iPad scannen'),
          h('p', {}, 'Kamera-App des iPad auf diesen Code halten, Text kopieren und in der Wahl-App unter „Tafel verbinden“ einfügen.'),
          cv,
          h('details', {}, h('summary', {}, 'Oder als Text anzeigen'), h('textarea', { readonly: true }, offer))),
        h('div', { class: 'card' },
          h('h2', {}, '2. Antwort des iPads einlesen'),
          scanBtn, video,
          h('p', { class: 'muted' }, scanBtn ? 'Oder den Antworttext einfügen:' : 'Antworttext des iPads einfügen:'),
          answer,
          h('div', { class: 'spacer' }),
          h('button', { class: 'btn', onclick: function () { connect(answer.value); } }, 'Verbinden'),
          status)));
  }

  // Kamera-Scan (nur wenn der Browser einen QR-Leser mitbringt)
  async function startScan(video, status, onText) {
    try {
      var det = new BarcodeDetector({ formats: ['qr_code'] });
      var stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      video.srcObject = stream; video.hidden = false; await video.play();
      var timer = setInterval(async function () {
        try {
          var codes = await det.detect(video);
          if (codes.length) { stopScan(); onText(codes[0].rawValue); }
        } catch (e) { /* nächster Versuch */ }
      }, 400);
      scanStop = function () { clearInterval(timer); stream.getTracks().forEach(function (t) { t.stop(); }); video.hidden = true; scanStop = null; };
    } catch (err) { status.textContent = 'Kamera nicht verfügbar. Bitte den Text einfügen.'; }
  }
  function stopScan() { if (scanStop) scanStop(); }

  /* ---------- Hauptansicht ---------- */
  var TEXTS = {
    none: 'Am iPad ist noch keine Wahl ausgewählt.',
    idle: 'Bereit für den nächsten Wähler.',
    voting: 'Ein Wähler stimmt gerade ab …',
    warn: '⚠️ Die Wahlkabine sperrt gleich automatisch.',
    voted: 'Abgestimmt',
    paused: 'Die Lehrkraft arbeitet am iPad.',
    full: 'Alle Wähler haben abgestimmt.'
  };

  function mainView() {
    var s = state;
    if (!s) { show(h('h1', {}, 'Verbunden'), h('p', { class: 'muted' }, 'Warte auf das iPad …')); return; }
    if (s.phase === 'closed') { resultsView(); return; }
    var pct = s.voters ? Math.min(100, Math.round(100 * s.ballots / s.voters)) : 0;
    var bar = h('div', { class: 'progress big' }, h('div', {}));
    bar.firstChild.style.width = pct + '%';
    var allDone = s.voters > 0 && s.ballots >= s.voters;
    var canNext = (s.phase === 'idle' || s.phase === 'voted') && !allDone;
    var canUndo = s.phase === 'voting' || s.phase === 'warn';

    show(
      h('h1', { class: 'board-title' }, s.title || 'Klassensprecherwahl'),
      h('div', { class: 'board-status ' + s.phase }, TEXTS[s.phase] || ''),
      s.phase === 'voted' && allDone ? h('div', { class: 'board-sub' }, TEXTS.full) : null,
      bar,
      h('p', { class: 'board-count' }, s.ballots + ' abgegeben · ' + Math.max(0, s.voters - s.ballots) + ' fehlen noch'),
      h('div', { class: 'row board-buttons' },
        h('button', { class: 'btn btn-big btn-green', disabled: !canNext, onclick: function () { Link.send({ t: 'next' }); } }, 'Nächster Wähler'),
        canUndo ? h('button', { class: 'btn btn-secondary', onclick: function () { Link.send({ t: 'undo' }); } }, '↩ Rückgängig (Freischaltung)') : null));
  }

  // Ergebnis-Countdown: Plätze von hinten nach vorn, jeweils per Tippen auf "Weiter"
  function resultsView() {
    var s = state;
    show(Reveal.create(s.results || [], h('h1', { class: 'board-title' }, (s.practice ? 'Probeergebnis: ' : '🏆 ') + s.title)));
  }

  /* ---------- Verbindungsereignisse ---------- */
  Link.on('open', function () { connected = true; Link.send({ t: 'hello' }); mainView(); });
  Link.on('close', function () {
    if (!connected) return;
    connected = false; state = null;
    show(h('h1', {}, 'Verbindung getrennt'), h('p', {}, 'Die Verbindung zum iPad wurde unterbrochen.'),
      h('button', { class: 'btn', onclick: function () { pairView(); } }, 'Neu verbinden'));
  });
  Link.on('message', function (m) { if (m.t === 'state') { state = m; mainView(); } });

  pairView();
})();
