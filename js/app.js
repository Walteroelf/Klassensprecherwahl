/*
 * app.js – Oberfläche der Klassensprecherwahl (iPad)
 * --------------------------------------------------
 * Die App startet IMMER in der Wahlkabine (gesperrter Wartebildschirm).
 * Den Lehrerbereich erreichst du nur über eine versteckte Geste (langes Tippen auf das
 * kleine Logo oben links) und danach den sechsstelligen Code.
 *
 *   Wahlkabine:   lockedScreen, boothView (Stimmabgabe)
 *   Lehrerbereich: homeView, setupView, candidateView, menuView, boardPairView, resultView
 *   Schutz:       askCode (Zahlenfeld), teacherLogin, Auto-Sperre, Alles löschen
 *   Tafel:        pushState (sendet nur Phase und Zähler), onLinkMessage (Befehle der Tafel)
 */
(function () {
  'use strict';
  var L = window.Logic, DB = window.DB, S = window.Security, Link = window.Link, QR = window.QR;
  var Reveal = window.Reveal, ExportDoc = window.ExportDoc;
  var h = Dom.h;
  var app = document.getElementById('app');

  var LOCK_MS = 120000;      // Auto-Sperre: 2 Minuten ohne Berührung nach der Freischaltung
  var WARN_MS = 20000;       // so lange vorher warnt die Tafel
  var SPLIT = 'Gruppe ';

  /* ---------- kleine Hilfsfunktionen ---------- */
  var currentView = '';
  function show(name) {
    currentView = name;
    Dom.mount.apply(null, [app].concat(Array.prototype.slice.call(arguments, 1)));
    // Orangefarbenes Banner "TESTWAHL", solange der Probemodus läuft
    var test = !!(cur && cur.practice);
    document.getElementById('testbanner').hidden = !test;
    document.body.classList.toggle('practice', test);
    window.scrollTo(0, 0);
  }

  /* ---------- Vorlesen (nur Sprachausgabe des Geräts, kein Online-Dienst) ---------- */
  var voice = null;
  function pickVoice() {
    if (!('speechSynthesis' in window)) return null;
    // Nur lokale (auf dem Gerät gespeicherte) deutsche Stimmen, nie Online-Stimmen
    voice = speechSynthesis.getVoices().filter(function (v) {
      return v.lang && v.lang.toLowerCase().indexOf('de') === 0 && v.localService;
    })[0] || null;
    return voice;
  }
  function speechAvailable() { return !!(voice || pickVoice()); }
  function speak(text) {
    if (!settings.speech || !speechAvailable()) return;
    speechSynthesis.cancel();
    var u = new SpeechSynthesisUtterance(text);
    u.voice = voice; u.lang = voice.lang; u.rate = 0.9;
    speechSynthesis.speak(u);
  }
  if ('speechSynthesis' in window) speechSynthesis.addEventListener('voiceschanged', pickVoice);

  // Große Schrift und hoher Kontrast
  function applyA11y() {
    document.documentElement.classList.toggle('a11y-big', !!settings.bigText);
    document.documentElement.classList.toggle('a11y-contrast', !!settings.contrast);
  }

  // Foto oder Platzhalter mit Anfangsbuchstabe
  function photoEl(cand, cls) {
    if (cand && cand.photo) return h('img', { class: 'photo ' + (cls || ''), src: cand.photo, alt: cand.name });
    return h('div', { class: 'photo photo-ph ' + (cls || '') }, cand && cand.name ? cand.name.charAt(0).toUpperCase() : '?');
  }

  // Pop-up. Liefert true (OK) oder false (Zurück).
  function dialog(o) {
    return new Promise(function (resolve) {
      var overlay;
      if (o.speak) speak(o.speak);
      function close(v) { overlay.remove(); resolve(v); }
      overlay = h('div', { class: 'overlay', role: 'dialog', 'aria-modal': 'true' },
        h('div', { class: 'dialog' },
          o.cand ? photoEl(o.cand) : null,
          o.title ? h('h2', {}, o.title) : null,
          o.text ? h('p', {}, o.text) : null,
          o.lines ? o.lines.map(function (t) { return h('p', { class: 'warn' }, t); }) : null,
          h('div', { class: 'dialog-buttons' },
            o.cancel === null ? null : h('button', { class: 'btn btn-secondary', onclick: function () { close(false); } }, o.cancel || 'Zurück'),
            h('button', { class: 'btn ' + (o.danger ? 'btn-danger' : 'btn-primary'), onclick: function () { close(true); } }, o.ok || 'OK'))));
      document.body.append(overlay);
    });
  }
  function info(title, text, lines) { return dialog({ title: title, text: text, lines: lines, cancel: null }); }

  var MODE_NAMES = { single: 'Eine Stimme', two: 'Zwei freie Stimmen', group: 'Eine Stimme je Gruppe' };
  var STATUS_NAMES = { setup: 'In Vorbereitung', open: 'Läuft', closed: 'Abgeschlossen' };

  // Foto verkleinern (Quadrat in der Mitte, höchstens 480 px) und als JPEG-Text zurückgeben
  function resizePhoto(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var s = Math.min(img.naturalWidth, img.naturalHeight);
        var size = Math.min(480, s);
        var c = document.createElement('canvas');
        c.width = c.height = size;
        c.getContext('2d').drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, size, size);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Das Bild konnte nicht gelesen werden.')); };
      img.src = url;
    });
  }

  /* ---------- Zustand ---------- */
  var elections = [];          // alle gespeicherten Wahlen
  var settings = { id: 'settings', boardEnabled: false, activeId: null, bigText: false, contrast: false, speech: false };
  var cur = null;              // aktuelle Wahl: { e, t (Stimmenstand), v (Wählerliste), practice? }
  var practice = null;         // Probemodus: lebt NUR im Arbeitsspeicher, wird nie gespeichert
  var previewing = false;      // Kandidaten-Vorschau läuft
  var booth = null;            // laufende Freischaltung/Stimmabgabe (nur im Arbeitsspeicher!)
  var teacherAuthed = false;   // nur nach richtigem Code true, nie gespeichert
  var lastVoted = false;       // Tafel soll "Abgestimmt" zeigen
  var committing = false;
  var boothTimer = null, boothTick = null;

  async function loadAll() {
    elections = (await DB.getAll('elections')).sort(function (a, b) { return a.title.localeCompare(b.title, 'de'); });
    var s = await DB.get('meta', 'settings');
    if (s) settings = Object.assign(settings, s);
    applyA11y();
  }
  function saveSettings() { return DB.put('meta', settings); }

  // Im Probemodus wird NICHTS gespeichert (komplett getrennt von der echten Wahl)
  function persistElection(e) { return cur.practice ? Promise.resolve() : DB.put('elections', e); }
  function persistTally(t) { return cur.practice ? Promise.resolve() : DB.put('tallies', t); }

  async function loadCur(id) {
    var e = await DB.get('elections', id);
    if (!e) { cur = null; return; }
    var t = (await DB.get('tallies', id)) || Object.assign({ id: id }, L.newTally());
    var v = (await DB.get('voters', id)) || { id: id, list: [] };
    cur = { e: e, t: t, v: v };
  }
  async function openElection(id) { practice = null; await loadCur(id); menuView(); }

  /* ---------- Zahlenfeld für den Code ---------- */
  // o.onCode(code) → { ok, msg, lockMs }.  Liefert true (Code angenommen) oder false (abgebrochen).
  function askCode(o) {
    return new Promise(function (resolve) {
      var code = '', busy = false, lockTimer = null, overlay;
      var dots = h('div', { class: 'dots' }, [0, 1, 2, 3, 4, 5].map(function () { return h('span', { class: 'dot' }); }));
      var msg = h('div', { class: 'code-msg' }, '');
      var keys = [];
      function draw() { Array.prototype.forEach.call(dots.children, function (d, i) { d.className = 'dot' + (i < code.length ? ' on' : ''); }); }
      function setKeys(disabled) { keys.forEach(function (k) { k.disabled = disabled; }); }
      function close(v) { clearInterval(lockTimer); overlay.remove(); resolve(v); }
      function startLock(ms) {
        var until = Date.now() + ms;
        setKeys(true);
        clearInterval(lockTimer);
        function tick() {
          var left = until - Date.now();
          if (left <= 0) { clearInterval(lockTimer); msg.textContent = 'Du kannst es jetzt wieder versuchen.'; busy = false; setKeys(false); return; }
          var min = Math.floor(left / 60000), sec = Math.ceil((left % 60000) / 1000);
          msg.textContent = 'Zu viele Versuche. Bitte warte noch ' + (min ? min + ' Min. ' : '') + sec + ' Sek.';
        }
        busy = true;
        tick();
        lockTimer = setInterval(tick, 500);
      }
      async function submit() {
        busy = true;
        var r;
        try { r = await o.onCode(code); } catch (err) { r = { ok: false, msg: err.message }; }
        if (r.ok) { close(true); return; }
        code = ''; draw();
        msg.textContent = r.msg || '';
        if (r.lockMs > 0) startLock(r.lockMs); else busy = false;
      }
      function press(d) {
        if (busy || code.length >= 6) return;
        code += d; draw();
        if (code.length === 6) submit();
      }
      function key(label, fn, cls) {
        var b = h('button', { class: 'key ' + (cls || ''), onclick: fn }, label);
        if (cls !== 'ghost') keys.push(b);
        return b;
      }
      var pad = [];
      for (var n = 1; n <= 9; n++) pad.push(key(String(n), press.bind(null, String(n))));
      pad.push(o.cancelable === false ? h('span', {}) : h('button', { class: 'key ghost', onclick: function () { close(false); } }, 'Abbrechen'));
      pad.push(key('0', press.bind(null, '0')));
      pad.push(key('⌫', function () { if (!busy) { code = code.slice(0, -1); draw(); } }));

      overlay = h('div', { class: 'overlay', role: 'dialog', 'aria-modal': 'true' },
        h('div', { class: 'dialog codepad' },
          h('h2', {}, o.title), o.text ? h('p', { class: 'muted' }, o.text) : null,
          dots, msg, h('div', { class: 'pad' }, pad)));
      document.body.append(overlay);
      if (o.getLock) o.getLock().then(function (ms) { if (ms > 0) { msg.textContent = ''; startLock(ms); } });
    });
  }

  async function verifyCode(code) {
    var r = await S.check(code);
    if (r.ok) return { ok: true };
    if (r.lockedMs) return { ok: false, lockMs: r.lockedMs };
    return { ok: false, msg: 'Falscher Code.' };
  }
  // Neuen Code festlegen (zweimal eingeben). Liefert true, wenn gesetzt.
  async function chooseNewCode(cancelable) {
    var first = null;
    for (;;) {
      var ok = await askCode({
        title: 'Neuen Code festlegen', text: 'Sechs Ziffern, nur für dich.', cancelable: cancelable,
        onCode: async function (c) { first = c; return { ok: true }; }
      });
      if (!ok) return false;
      var ok2 = await askCode({
        title: 'Code wiederholen', text: 'Bitte denselben Code noch einmal eingeben.', cancelable: false,
        onCode: async function (c) { return c === first ? { ok: true } : { ok: false, msg: 'Die Codes sind verschieden. Bitte von vorn.' }; }
      });
      if (ok2) { await S.setPin(first); return true; }
    }
  }

  /* ---------- Wahlkabine: Start, Wartebildschirm, versteckte Geste ---------- */
  async function boothHome() {
    stopBoothTimers();
    teacherAuthed = false; booth = null; lastVoted = false; committing = false; previewing = false;
    if (practice) cur = practice;
    else if (settings.activeId && elections.some(function (e) { return e.id === settings.activeId; })) await loadCur(settings.activeId);
    else cur = null;
    lockedScreen();
    pushState();
  }

  // Kleines, unbeschriftetes Logo. Langes Tippen (1,5 Sekunden) öffnet die Code-Eingabe.
  function logoEl() {
    var timer = null;
    var el = h('div', { class: 'logo', 'aria-hidden': 'true' }, '🗳️');
    function cancel() { clearTimeout(timer); timer = null; }
    el.addEventListener('pointerdown', function () { cancel(); timer = setTimeout(function () { timer = null; teacherLogin(); }, 1500); });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (ev) { el.addEventListener(ev, cancel); });
    el.addEventListener('contextmenu', function (ev) { ev.preventDefault(); });
    return el;
  }

  function lockedScreen() {
    var text;
    if (!cur) text = 'Es ist noch keine Wahl vorbereitet.';
    else if (cur.e.status === 'closed') text = 'Die Wahl ist beendet.';
    else if (cur.t.ballots >= cur.e.voterCount) text = 'Alle Wähler haben abgestimmt.';
    else text = 'Die Wahlkabine ist gesperrt. Bitte warte, bis du aufgerufen wirst.';
    show('booth',
      h('div', { class: 'locked' },
        h('div', { class: 'big' }, '🗳️'),
        h('h1', {}, cur ? cur.e.title : 'Klassensprecherwahl'),
        h('p', {}, text)),
      logoEl());
  }

  async function teacherLogin() {
    if (booth && (booth.busy || committing)) return;
    if (booth) booth.deadline = Date.now() + LOCK_MS;   // während der Code-Eingabe nicht automatisch sperren
    var ok = await askCode({ title: 'Code eingeben', text: 'Bereich für die Lehrkraft', getLock: S.lockRemaining, onCode: verifyCode });
    if (!ok) return;
    if (booth) await cancelUnlock();                     // laufende Freischaltung zurücknehmen (es wurde noch nichts gezählt)
    teacherAuthed = true;
    pushState();
    if (cur) menuView(); else homeView();
  }
  function requireTeacher() {
    if (teacherAuthed) return true;
    boothHome();
    return false;
  }

  /* ---------- Lehrerbereich: Übersicht ---------- */
  function homeView() {
    if (!requireTeacher()) return;
    booth = null;
    show('home',
      h('div', { class: 'topbar' },
        h('h1', {}, '🗳️ Klassensprecherwahl'),
        h('button', { class: 'btn btn-secondary btn-small', onclick: boothHome }, '← Zur Wahlkabine')),
      h('p', { class: 'muted' }, 'Alle Daten bleiben auf diesem Gerät. Es gibt keine Verbindung ins Internet.'),
      h('div', { class: 'spacer' }),
      h('button', { class: 'btn btn-big', onclick: function () { setupView(L.newElection(), { voters: '' }, true); } }, '＋ Neue Wahl anlegen'),
      elections.length ? h('h2', {}, 'Gespeicherte Wahlen') : null,
      elections.map(function (e) {
        return h('div', { class: 'card row' },
          h('div', { class: 'grow' },
            h('strong', {}, e.title), ' ',
            h('span', { class: 'badge ' + e.status }, STATUS_NAMES[e.status]),
            settings.activeId === e.id ? h('span', { class: 'badge open' }, ' in der Kabine') : null,
            h('div', { class: 'muted' }, MODE_NAMES[e.mode] + ' · ' + e.candidates.length + ' Kandidaten')),
          h('button', { class: 'btn', onclick: function () { openElection(e.id); } }, 'Öffnen'));
      }),
      h('h2', {}, 'Probemodus'),
      h('div', { class: 'card' },
        h('p', {}, 'Zeigt den Schülern den Ablauf. Teststimmen werden getrennt gezählt und am Ende vollständig gelöscht.'),
        practice ? h('button', { class: 'btn', onclick: function () { cur = practice; menuView(); } }, 'Probemodus fortsetzen') : null,
        h('div', { class: 'spacer' }),
        h('button', { class: 'btn btn-secondary', onclick: startSamplePractice }, 'Probemodus mit Beispielkandidaten')),
      h('h2', {}, 'Anzeige und Vorlesen'),
      a11yCard(),
      h('h2', {}, 'Sicherheit'),
      h('div', { class: 'row' },
        h('button', { class: 'btn btn-secondary', onclick: changeCode }, 'Code ändern')),
      h('div', { class: 'spacer' }), h('div', { class: 'spacer' }),
      h('button', { class: 'btn btn-danger', onclick: deleteAll }, 'Alles löschen'),
      h('p', { class: 'muted' }, 'Entfernt alle Wahlen, Fotos, Stimmen, Listen und den Code von diesem Gerät.'),
      h('p', { class: 'muted copyright' }, '© 2026 Walteroelf · Work in Progress · CC BY-NC-SA 4.0 (Lizenz: github.com/Walteroelf/Klassensprecherwahl)'));
  }

  // Einstellungen für Barrierefreiheit: große Schrift, hoher Kontrast, Vorlesen
  function a11yCard() {
    function toggle(key, label, extra) {
      return h('label', { class: 'checkline' },
        h('input', { type: 'checkbox', checked: !!settings[key], disabled: extra === 'off', onchange: async function (ev) {
          settings[key] = ev.target.checked; applyA11y(); await saveSettings();
          if (key === 'speech' && settings.speech) speak('Das Vorlesen ist eingeschaltet.');
        } }), label);
    }
    var ok = 'speechSynthesis' in window && speechAvailable();
    return h('div', { class: 'card' },
      toggle('bigText', 'Große Schrift'),
      toggle('contrast', 'Hoher Kontrast'),
      toggle('speech', 'Vorlesen von Namen und Anweisungen (Sprachausgabe des Geräts)', ok ? '' : 'off'),
      ok ? null : h('p', { class: 'muted' }, 'Auf diesem Gerät ist keine deutsche Offline-Stimme verfügbar. In den iPad-Einstellungen unter Bedienungshilfen → Gesprochene Inhalte → Stimmen kann eine deutsche Stimme geladen werden.'));
  }

  async function changeCode() {
    var ok = await askCode({ title: 'Alten Code eingeben', getLock: S.lockRemaining, onCode: verifyCode });
    if (!ok) return;
    if (await chooseNewCode(true)) await info('Code geändert', 'Der neue Code gilt ab sofort.');
  }

  // Alles löschen: doppelte Abfrage mit erneuter Code-Eingabe
  async function deleteAll() {
    if (!(await dialog({
      title: 'Wirklich ALLES löschen?',
      text: 'Alle Wahlen, Kandidaten, Fotos, Wählerlisten, Stimmen, Protokolle und der Code werden endgültig entfernt. Das lässt sich nicht rückgängig machen.',
      ok: 'Weiter', danger: true
    }))) return;
    var ok = await askCode({ title: 'Code zur Bestätigung', text: 'Letzte Sicherheitsabfrage', getLock: S.lockRemaining, onCode: verifyCode });
    if (!ok) return;
    try {
      Link.close();
      try { localStorage.clear(); sessionStorage.clear(); } catch (e) { /* nicht vorhanden */ }
      await DB.destroy();                                   // komplette Datenbank, ohne Reste
      if (window.caches) {                                  // Daten-Caches weg; der Programmcode-Cache bleibt für den Offline-Start
        var keys = await caches.keys();
        await Promise.all(keys.filter(function (k) { return k.indexOf('klassensprecherwahl-') !== 0; }).map(function (k) { return caches.delete(k); }));
      }
    } catch (err) {
      await info('Löschen nicht vollständig', err.message);
    }
    location.reload();
  }

  /* ---------- Lehrerbereich: Wahl einrichten ---------- */
  function setupView(e, ctx, isNew) {
    if (!requireTeacher()) return;
    var y = window.scrollY;
    function again() { setupView(e, ctx, isNew); window.scrollTo(0, y); }

    var modeChoice = function (mode, title, text) {
      return h('label', { class: 'choice' + (e.mode === mode ? ' on' : '') },
        h('input', { type: 'radio', name: 'mode', checked: e.mode === mode, onchange: function () { e.mode = mode; again(); } }),
        h('div', {}, h('strong', {}, title), h('div', { class: 'muted' }, text)));
    };
    var groupSelect = function (idx) {
      var sel = h('select', { onchange: function () { e.parityGroups[idx] = Number(sel.value); } },
        e.groupNames.map(function (n, g) { return h('option', { value: g, selected: e.parityGroups[idx] === g }, n); }));
      return sel;
    };

    show('setup',
      h('div', { class: 'topbar' }, h('h1', {}, isNew ? 'Neue Wahl' : 'Wahl bearbeiten')),

      h('label', { class: 'field' }, 'Titel der Wahl'),
      h('input', { type: 'text', value: e.title, oninput: function (ev) { e.title = ev.target.value; } }),

      h('h2', {}, 'Wahlmodus'),
      modeChoice('single', 'Eine Stimme', 'Jeder Wähler wählt genau eine Person.'),
      modeChoice('two', 'Zwei freie Stimmen', 'Jeder Wähler hat zwei Stimmen.'),
      e.mode === 'two' ? h('label', { class: 'checkline' },
        h('input', { type: 'checkbox', checked: e.allowDouble, onchange: function (ev) { e.allowDouble = ev.target.checked; } }),
        'Dieselbe Person darf zweimal gewählt werden') : null,
      modeChoice('group', 'Eine Stimme je Gruppe', 'Zwei Seiten nacheinander, je Seite eine Person (z. B. Mädchen / Jungen).'),

      h('h2', {}, 'Gruppen'),
      h('p', { class: 'muted' }, 'Die Gruppe wird nur für den Modus „Eine Stimme je Gruppe“ gebraucht.'),
      e.groupNames.map(function (n, g) {
        return h('div', {},
          h('label', { class: 'field' }, SPLIT + (g + 1)),
          h('input', { type: 'text', value: n, onchange: function (ev) { e.groupNames[g] = ev.target.value.trim() || (SPLIT + (g + 1)); again(); } }));
      }),
      e.mode === 'group' ? h('div', {},
        h('label', { class: 'field' }, 'Erste Seite in der Wahlkabine'), groupSelect(0),
        h('label', { class: 'field' }, 'Zweite Seite in der Wahlkabine'), groupSelect(1)) : null,

      h('h2', {}, 'Wähler'),
      h('label', { class: 'field' }, 'Anzahl der Wähler'),
      h('input', { type: 'number', inputmode: 'numeric', min: '1', value: e.voterCount || '', oninput: function (ev) { e.voterCount = parseInt(ev.target.value, 10) || 0; } }),
      h('p', { class: 'muted' }, 'Es werden nie mehr Stimmzettel angenommen, als hier eingetragen sind.'),
      h('label', { class: 'field' }, 'Wählerliste (optional, ein Name pro Zeile)'),
      h('textarea', { oninput: function (ev) { ctx.voters = ev.target.value; } }, ctx.voters),
      h('p', { class: 'muted' }, 'Die Liste dient nur zum Abhaken. Sie ist von den Stimmen getrennt und wird beim Abschluss der Wahl gelöscht.'),

      h('h2', {}, 'Kandidaten (' + e.candidates.length + ')'),
      h('div', { class: 'card' },
        e.candidates.length ? e.candidates.map(function (c) {
          return h('div', { class: 'cand' },
            photoEl(c, 'thumb'),
            h('div', { class: 'name' }, c.name, h('div', { class: 'small' }, e.groupNames[c.group])),
            h('button', { class: 'btn btn-secondary btn-small', onclick: function () { candidateView(e, ctx, isNew, c); } }, 'Ändern'),
            h('button', { class: 'btn btn-secondary btn-small', onclick: async function () {
              if (await dialog({ title: c.name + ' entfernen?', ok: 'Entfernen', danger: true })) {
                e.candidates = e.candidates.filter(function (x) { return x !== c; });
                again();
              }
            } }, 'Entfernen'));
        }) : h('p', { class: 'muted' }, 'Noch keine Kandidaten.'),
        h('div', { class: 'spacer' }),
        h('button', { class: 'btn', onclick: function () { candidateView(e, ctx, isNew, null); } }, '＋ Kandidat hinzufügen')),

      h('div', { class: 'spacer' }),
      h('div', { class: 'row' },
        h('button', { class: 'btn btn-green grow', onclick: function () { saveSetup(e, ctx, isNew); } }, 'Speichern'),
        h('button', { class: 'btn btn-secondary', onclick: function () { isNew ? homeView() : menuView(); } }, 'Abbrechen')));
  }

  async function saveSetup(e, ctx, isNew) {
    e.title = (e.title || '').trim() || 'Klassensprecherwahl';
    await DB.put('elections', e);
    if (isNew) await DB.put('tallies', Object.assign({ id: e.id }, L.newTally()));
    var names = ctx.voters.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
    var oldDone = {};
    if (!isNew && cur) cur.v.list.forEach(function (p) { oldDone[p.name] = p.done; });
    await DB.put('voters', { id: e.id, list: names.map(function (n) { return { name: n, done: !!oldDone[n] }; }) });
    if (!settings.activeId) { settings.activeId = e.id; await saveSettings(); }
    await loadAll();
    await openElection(e.id);
    if (names.length && e.voterCount && names.length !== e.voterCount) {
      await info('Hinweis', null, ['Die Wählerliste hat ' + names.length + ' Namen, eingetragen sind aber ' + e.voterCount + ' Wähler.']);
    }
  }

  function candidateView(e, ctx, isNew, existing) {
    if (!requireTeacher()) return;
    var c = existing ? Object.assign({}, existing) : { id: L.uid(), name: '', group: 0, photo: '' };
    var preview = h('div', { class: 'photo-edit' }, photoEl(c));
    var status = h('p', { class: 'muted' }, '');

    async function onFile(ev) {
      var f = ev.target.files && ev.target.files[0];
      if (!f) return;
      status.textContent = 'Foto wird verkleinert …';
      try {
        c.photo = await resizePhoto(f);
        Dom.mount(preview, photoEl(c));
        status.textContent = 'Foto übernommen.';
      } catch (err) { status.textContent = err.message; }
    }
    var cam = h('input', { type: 'file', accept: 'image/*', capture: 'user', hidden: true, onchange: onFile });
    var lib = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: onFile });

    show('candidate',
      h('h1', {}, existing ? 'Kandidat ändern' : 'Kandidat hinzufügen'),
      h('label', { class: 'field' }, 'Name'),
      h('input', { type: 'text', value: c.name, autocomplete: 'off', oninput: function (ev) { c.name = ev.target.value; } }),
      h('label', { class: 'field' }, 'Gruppe'),
      (function () {
        var sel = h('select', { onchange: function () { c.group = Number(sel.value); } },
          e.groupNames.map(function (n, g) { return h('option', { value: g, selected: c.group === g }, n); }));
        return sel;
      })(),
      h('label', { class: 'field' }, 'Foto'),
      preview,
      h('div', { class: 'row' },
        h('button', { class: 'btn btn-secondary', onclick: function () { cam.click(); } }, '📷 Foto aufnehmen'),
        h('button', { class: 'btn btn-secondary', onclick: function () { lib.click(); } }, '🖼️ Aus Mediathek')),
      cam, lib, status,
      h('div', { class: 'spacer' }),
      h('div', { class: 'row' },
        h('button', { class: 'btn btn-green grow', onclick: async function () {
          c.name = c.name.trim();
          if (!c.name) { await info('Name fehlt', 'Bitte einen Namen eintragen.'); return; }
          if (existing) e.candidates[e.candidates.indexOf(existing)] = c; else e.candidates.push(c);
          setupView(e, ctx, isNew);
        } }, 'Übernehmen'),
        h('button', { class: 'btn btn-secondary', onclick: function () { setupView(e, ctx, isNew); } }, 'Abbrechen')));
  }

  /* ---------- Lehrerbereich: Steuerung einer Wahl ---------- */
  function menuView() {
    if (!requireTeacher()) return;
    stopBoothTimers();
    booth = null;
    var e = cur.e, t = cur.t, v = cur.v;
    var closed = e.status === 'closed';
    var pct = e.voterCount ? Math.round(100 * t.ballots / e.voterCount) : 0;
    var bar = h('div', { class: 'progress' }, h('div', {}));
    bar.firstChild.style.width = pct + '%';

    show('menu',
      h('div', { class: 'topbar' },
        h('h1', {}, (cur.practice ? 'Probemodus: ' : '') + e.title),
        h('button', { class: 'btn btn-secondary btn-small', onclick: async function () { await loadAll(); homeView(); } }, '← Übersicht')),
      h('p', {}, h('span', { class: 'badge ' + e.status }, STATUS_NAMES[e.status]), ' ', MODE_NAMES[e.mode], ' · ', e.candidates.length + ' Kandidaten'),
      e.runoffOf ? h('p', { class: 'muted' }, 'Dies ist eine Stichwahl. Es stehen nur die punktgleichen Kandidaten zur Wahl.') : null,

      closed ? h('div', {}, h('button', { class: 'btn btn-big', onclick: resultView }, cur.practice ? '🏆 Probeergebnis anzeigen' : '🏆 Ergebnis anzeigen')) :
      h('div', {},
        h('div', { class: 'card' },
          h('strong', {}, t.ballots + ' von ' + e.voterCount + ' Wählern haben abgestimmt'),
          bar,
          h('div', { class: 'spacer' }),
          h('button', { class: 'btn btn-big btn-green', disabled: t.ballots >= e.voterCount, onclick: function () { unlockVoter(false); } }, 'Nächsten Wähler freischalten'),
          h('div', { class: 'spacer' }),
          h('button', { class: 'btn btn-secondary', onclick: async function () {
            if (!cur.practice) { settings.activeId = e.id; await saveSettings(); }
            boothHome();
          } }, 'Zur Wahlkabine (sperren)'),
          h('div', { class: 'spacer' }),
          h('button', { class: 'btn btn-secondary', onclick: candidatePreview }, '👀 Kandidaten-Vorschau für die Kinder')),

        v.list.length ? h('div', { class: 'card' },
          h('strong', {}, 'Wählerliste (' + v.list.filter(function (p) { return p.done; }).length + ' von ' + v.list.length + ' abgehakt)'),
          v.list.map(function (p) {
            return h('label', { class: 'checkline' },
              h('input', { type: 'checkbox', checked: p.done, onchange: async function (ev) { p.done = ev.target.checked; await DB.put('voters', v); menuView(); } }),
              p.name);
          })) : null,

        boardCard(),

        cur.practice ?
          h('div', { class: 'row' }, h('button', { class: 'btn btn-danger', onclick: finishPractice }, 'Probemodus beenden (Probeergebnis)')) :
          h('div', { class: 'row' },
            t.ballots === 0 ? h('button', { class: 'btn btn-secondary', onclick: function () { setupView(e, { voters: v.list.map(function (p) { return p.name; }).join('\n') }, false); } }, '⚙️ Einstellungen bearbeiten') : null,
            h('button', { class: 'btn btn-secondary', onclick: startOwnPractice }, '🎓 Probemodus mit diesen Kandidaten'),
            h('button', { class: 'btn btn-danger', onclick: closeElection }, 'Wahl abschließen'))),

      h('div', { class: 'spacer' }),
      cur.practice ? null : h('button', { class: 'btn btn-secondary btn-small', onclick: deleteElection }, 'Diese Wahl löschen'));
  }

  /* ---------- Probemodus ---------- */
  // Einfache Auswahl per Knöpfen. Liefert den Wert oder null (Zurück).
  function choice(title, text, options) {
    return new Promise(function (resolve) {
      var overlay;
      function close(v) { overlay.remove(); resolve(v); }
      overlay = h('div', { class: 'overlay', role: 'dialog', 'aria-modal': 'true' },
        h('div', { class: 'dialog' }, h('h2', {}, title), text ? h('p', {}, text) : null,
          options.map(function (o) { return h('button', { class: 'btn btn-block', onclick: function () { close(o[0]); } }, o[1]); }),
          h('button', { class: 'btn btn-secondary btn-block', onclick: function () { close(null); } }, 'Zurück')));
      document.body.append(overlay);
    });
  }

  // Probe-Wahl aus einer Vorlage bauen: eigene Kennung, Status "offen", frischer Stimmenstand
  function beginPractice(e) {
    e.id = 'practice'; e.status = 'open'; e.unlocked = 0; delete e.runoffOf; delete e.protocol;
    if (!(e.voterCount >= 1)) e.voterCount = 5;
    practice = { e: e, t: L.newTally(), v: { id: 'practice', list: [] }, practice: true };
    cur = practice;
    pushState();
    menuView();
  }
  async function startSamplePractice() {
    var mode = await choice('Probemodus mit Beispielkandidaten', 'Welchen Wahlmodus möchtest du zeigen?',
      [['single', 'Eine Stimme'], ['two', 'Zwei freie Stimmen'], ['group', 'Eine Stimme je Gruppe']]);
    if (!mode) return;
    var e = L.newElection('Beispielwahl');
    e.mode = mode; e.allowDouble = false; e.voterCount = 5;
    ['Alex', 'Bea', 'Chris', 'Dana', 'Eli', 'Fay'].forEach(function (n, i) {
      e.candidates.push({ id: 'p' + i, name: n, group: i % 2, photo: '' });
    });
    beginPractice(e);
  }
  async function startOwnPractice() {
    var errs = L.validate(cur.e);
    if (errs.length) { await info('Die Wahl ist noch nicht fertig eingerichtet', null, errs); return; }
    beginPractice(JSON.parse(JSON.stringify(cur.e)));     // Kopie: die echte Wahl bleibt unberührt
  }
  // Probemodus beenden: erst das Probeergebnis zeigen (auch auf der Tafel)
  async function finishPractice() {
    if (!(await dialog({ title: 'Probemodus beenden?', text: 'Das Probeergebnis wird gezeigt. Danach werden alle Teststimmen gelöscht.', ok: 'Ja, beenden' }))) return;
    cur.e.status = 'closed';
    cur.e.protocol = null;
    pushState();
    resultView();
  }
  async function discardPractice() {
    practice = null;               // der Probe-Speicher ist damit vollständig verworfen
    cur = null;
    if (settings.activeId) await loadCur(settings.activeId);
    pushState();
    homeView();
  }

  // Block "Tafel" im Lehrermenü
  function boardCard() {
    return h('div', { class: 'card' },
      h('label', { class: 'checkline' },
        h('input', { type: 'checkbox', checked: settings.boardEnabled, onchange: async function (ev) {
          settings.boardEnabled = ev.target.checked;
          await saveSettings();
          if (!settings.boardEnabled) Link.close();
          menuView();
        } }),
        h('strong', {}, 'Tafel verwenden')),
      settings.boardEnabled ? h('div', {},
        h('p', { class: Link.isOpen() ? '' : 'muted' }, Link.isOpen() ? '✅ Tafel ist verbunden.' : 'Die Tafel ist nicht verbunden.'),
        h('div', { class: 'row' },
          h('button', { class: 'btn btn-secondary', onclick: boardPairView }, Link.isOpen() ? 'Neu verbinden' : 'Tafel verbinden'),
          Link.isOpen() ? h('button', { class: 'btn btn-secondary', onclick: function () { Link.close(); menuView(); } }, 'Trennen') : null)) :
        h('p', { class: 'muted' }, 'Ohne Tafel schaltest du die Wähler direkt am iPad frei.'));
  }

  // Kopplung mit der Tafel: Verbindungstext der Tafel einfügen, Antwort als QR-Code zeigen
  function boardPairView() {
    if (!requireTeacher()) return;
    var offer = h('textarea', { placeholder: 'Verbindungstext der Tafel hier einfügen' });
    var out = h('div', {});
    show('pair',
      h('div', { class: 'topbar' }, h('h1', {}, 'Tafel verbinden'),
        h('button', { class: 'btn btn-secondary btn-small', onclick: menuView }, 'Zurück')),
      h('p', { class: 'muted' }, 'iPad und Tafel müssen im selben WLAN sein.'),
      h('div', { class: 'card' },
        h('ol', { class: 'steps' },
          h('li', {}, 'Öffne auf der Tafel die Seite „board.html“ dieser App. Sie zeigt einen QR-Code.'),
          h('li', {}, 'Scanne den QR-Code mit der Kamera-App des iPad, tippe auf den erkannten Text und wähle „Kopieren“.'),
          h('li', {}, 'Komm hierher zurück, füge den Text unten ein und tippe auf „Antwort erzeugen“.'),
          h('li', {}, 'Halte den QR-Code der Antwort vor die Tafelkamera oder übertrage den Text auf die Tafel.')),
        offer,
        h('div', { class: 'spacer' }),
        h('button', { class: 'btn', onclick: async function () {
          try {
            var ans = await Link.acceptOffer(offer.value);
            var cv = h('canvas', { class: 'qr' });
            QR.toCanvas(cv, ans, 4);
            Dom.mount(out, h('h2', {}, 'Antwort für die Tafel'), cv,
              h('p', { class: 'muted' }, 'Oder diesen Text auf der Tafel einfügen:'),
              h('textarea', { readonly: true }, ans));
          } catch (err) { await info('Verbindung nicht möglich', err.message); }
        } }, 'Antwort erzeugen')),
      out);
  }

  async function deleteElection() {
    var e = cur.e;
    if (!(await dialog({ title: '„' + e.title + '“ löschen?', text: 'Kandidaten, Fotos, Wählerliste und Stimmen dieser Wahl werden endgültig entfernt.', ok: 'Endgültig löschen', danger: true }))) return;
    await DB.del('elections', e.id); await DB.del('tallies', e.id); await DB.del('voters', e.id);
    if (settings.activeId === e.id) { settings.activeId = null; await saveSettings(); }
    cur = null;
    await loadAll(); homeView();
  }

  async function closeElection() {
    var e = cur.e, t = cur.t;
    var warnings = L.checkConsistency(e, t);
    var ok = await dialog({
      title: 'Wahl abschließen?',
      text: 'Danach sind keine Stimmen mehr möglich. Die Wählerliste wird gelöscht. Erst jetzt wird das Ergebnis sichtbar.',
      lines: warnings.length ? ['⚠️ Achtung: ' + warnings.join(' ')] : null,
      ok: 'Ja, abschließen', danger: true
    });
    if (!ok) return;
    var sum = function (o) { return Object.keys(o).reduce(function (s, k) { return s + o[k]; }, 0); };
    e.status = 'closed';
    // Wahlprotokoll: nur Zahlen und der Zeitpunkt des Abschlusses, nie wer was gewählt hat
    e.protocol = {
      unlocked: e.unlocked || 0, ballots: t.ballots, votes: sum(t.counts), abstentions: sum(t.abstain),
      closedAt: Date.now(), warnings: warnings
    };
    await DB.put('elections', e);
    await DB.del('voters', e.id);                 // Wählerliste ist weg
    cur.v = { id: e.id, list: [] };
    pushState();
    resultView();
  }

  /* ---------- Wahlkabine: Freischaltung und Stimmabgabe ---------- */
  function stopBoothTimers() { clearTimeout(boothTimer); clearInterval(boothTick); boothTimer = boothTick = null; }

  // fromBoard = true: Befehl der Tafel (keine Dialoge, nur stilles Ablehnen)
  async function unlockVoter(fromBoard) {
    var e = cur.e, t = cur.t;
    if (t.ballots >= e.voterCount) {
      if (!fromBoard) await info('Alle Wähler waren dran', 'Es sind schon alle Stimmzettel abgegeben.');
      return;
    }
    if (e.status === 'setup') {
      var errs = L.validate(e);
      if (errs.length) {
        if (!fromBoard) await info('Die Wahl ist noch nicht fertig eingerichtet', null, errs);
        return;
      }
      e.status = 'open';                   // ab jetzt sind die Einstellungen gesperrt
    }
    if (e.status !== 'open') return;
    stopBoothTimers();
    teacherAuthed = false; lastVoted = false;
    e.unlocked = (e.unlocked || 0) + 1;    // genau eine Freischaltung = genau ein Stimmzettel
    await persistElection(e);
    // Für jede Seite eine neue Zufallsreihenfolge
    booth = {
      pages: L.pages(e).map(function (p) { return { scope: p.scope, title: p.title, order: L.shuffle(p.candidateIds) }; }),
      page: 0, picks: [], busy: false, deadline: Date.now() + LOCK_MS, warn: false
    };
    // Auto-Sperre: wenn zwei Minuten nichts passiert, schließt sich die Kabine wieder
    boothTick = setInterval(function () {
      if (!booth) { stopBoothTimers(); return; }
      var left = booth.deadline - Date.now();
      if (left <= 0) { cancelUnlock(); return; }
      var w = left <= WARN_MS;
      if (w !== booth.warn) { booth.warn = w; pushState(); }
    }, 1000);
    boothView();
    pushState();
  }

  // Berührung = Aktivität: Frist zurücksetzen
  document.addEventListener('pointerdown', function () {
    if (booth && !booth.busy) {
      booth.deadline = Date.now() + LOCK_MS;
      if (booth.warn) { booth.warn = false; pushState(); }
    }
  }, true);
  // Verlässt die App den Bildschirm, wird die Freischaltung zurückgenommen
  document.addEventListener('visibilitychange', function () { if (document.hidden && booth) cancelUnlock(); });

  // Freischaltung zurücknehmen (Lehrer-Rückgängig oder Auto-Sperre). Nur möglich, solange noch nichts gezählt wurde.
  async function cancelUnlock() {
    if (!booth || committing) return;
    stopBoothTimers();
    booth = null;
    var e = cur.e;
    if ((e.unlocked || 0) > cur.t.ballots) { e.unlocked -= 1; await persistElection(e); }
    lockedScreen();
    pushState();
  }

  function boothView() {
    clearTimeout(boothTimer);
    if (!booth) { lockedScreen(); return; }
    var e = cur.e;
    var p = booth.pages[booth.page];
    var total = booth.pages.length;
    var headline = e.mode === 'group' ? 'Wähle eine Person: ' + p.title
      : (total > 1 ? 'Stimme ' + (booth.page + 1) + ' von ' + total : 'Wähle eine Person');
    var firstPick = booth.picks[0];

    show('booth',
      h('div', { class: 'booth' },
        h('div', { class: 'booth-head' }, h('h1', {}, headline), h('div', { class: 'muted' }, e.title)),
        h('div', { class: 'grid' },
          p.order.map(function (id) {
            var c = e.candidates.filter(function (x) { return x.id === id; })[0];
            var blocked = e.mode === 'two' && !e.allowDouble && booth.page === 1 && firstPick && firstPick.candidateId === id;
            return candTile(c, function () { choose(c); }, blocked);
          })),
        h('div', { class: 'abstain' },
          h('button', { class: 'btn btn-secondary', onclick: function () { choose(null); } }, 'Ich möchte niemanden wählen'),
          settings.speech && speechAvailable() ? h('button', { class: 'btn btn-secondary', onclick: function () { speak('Ich möchte niemanden wählen'); } }, '🔊') : null)),
      logoEl());
    speak(headline + '. Tippe auf ein Foto oder einen Namen.');
  }

  // Eine Kandidatenkarte (Foto und Name groß), bei Bedarf mit Vorlese-Knopf
  function candTile(c, onTap, disabled) {
    return h('div', { class: 'cand-wrap' },
      h('button', { class: 'cand-card', disabled: disabled, onclick: onTap }, photoEl(c), h('div', { class: 'cname' }, c.name)),
      settings.speech && speechAvailable() ? h('button', { class: 'speak', 'aria-label': 'Name vorlesen', onclick: function () { speak(c.name); } }, '🔊') : null);
  }

  // Kandidaten-Vorschau: jedes Kind prüft Foto und Namen. Hier wird nichts gewählt.
  // "Fertig" führt zurück in die gesperrte Wahlkabine, nicht in den Lehrerbereich.
  function candidatePreview() {
    if (!requireTeacher()) return;
    teacherAuthed = false; previewing = true; booth = null;
    pushState();
    var list = cur.e.candidates.slice().sort(function (a, b) { return a.name.localeCompare(b.name, 'de'); });
    show('booth',
      h('div', { class: 'booth' },
        h('div', { class: 'booth-head' }, h('h1', {}, 'Kandidaten-Vorschau'),
          h('div', { class: 'muted' }, 'Prüfe dein Foto und deinen Namen. Hier wird nicht gewählt.')),
        h('div', { class: 'grid' }, list.map(function (c) { return candTile(c, function () { speak(c.name); }, false); })),
        h('div', { class: 'abstain' }, h('button', { class: 'btn btn-big', onclick: boothHome }, 'Fertig'))));
  }

  // Der Wähler hat auf eine Person (oder "niemanden") getippt → erst Bestätigung per Pop-up
  async function choose(c) {
    var b = booth;
    var ok = await dialog(c
      ? { cand: c, title: c.name, text: 'Möchtest du dieser Person deine Stimme geben?', ok: 'Ja, wählen', speak: c.name + '. Möchtest du dieser Person deine Stimme geben?' }
      : { title: 'Niemanden wählen', text: 'Möchtest du niemanden wählen? Das zählt als Enthaltung.', ok: 'Ja, niemanden', speak: 'Möchtest du niemanden wählen? Das zählt als Enthaltung.' });
    if (!ok || !booth || booth !== b || b.busy) return;
    b.deadline = Date.now() + LOCK_MS;
    b.picks.push(c ? { candidateId: c.id } : { abstain: true });
    if (b.picks.length < b.pages.length) { b.page++; boothView(); return; }
    await commitBallot(b);
  }

  // Letzte Stimme bestätigt: Kabine sofort sperren, dann Stimmzettel zählen und sichern.
  async function commitBallot(b) {
    b.busy = true; committing = true;
    stopBoothTimers();
    booth = null;                           // Kabine ist ab hier gesperrt
    show('booth', h('div', { class: 'locked' }, h('div', { class: 'big' }, '⏳'), h('h1', {}, 'Einen Moment …')));
    try {
      var next = L.applyBallot(cur.e, cur.t, b.picks);   // wirft einen Fehler, wenn etwas nicht stimmt
      var stored = Object.assign({ id: cur.e.id }, next);
      await persistTally(stored);                        // erst speichern …
      cur.t = stored;                                    // … dann merken
    } catch (err) {
      committing = false;
      await info('Stimme nicht gezählt', err.message);
      lockedScreen(); pushState(); return;
    }
    committing = false;
    lastVoted = true;
    show('booth', h('div', { class: 'locked thanks' },
      h('div', { class: 'big' }, '✅'), h('h1', {}, 'Danke!'), h('p', {}, 'Deine Stimme ist gezählt.')));
    pushState();
    boothTimer = setTimeout(function () { if (currentView === 'booth' && !booth) lockedScreen(); }, 3000);
  }

  /* ---------- Ergebnis ---------- */
  function resultView() {
    if (!requireTeacher()) return;
    var e = cur.e, t = cur.t;
    var res = L.computeResults(e, t);
    var warnings = L.checkConsistency(e, t);
    var pr = e.protocol;
    var ties = cur.practice ? [] : L.findTies(res);
    show('result',
      h('div', { class: 'topbar' },
        h('h1', {}, (cur.practice ? 'Probeergebnis: ' : '🏆 ') + e.title),
        h('button', { class: 'btn btn-secondary btn-small', onclick: menuView }, '← Zurück')),
      h('p', { class: 'muted' }, t.ballots + ' von ' + e.voterCount + ' Wählern haben abgestimmt.'),
      warnings.length && !cur.practice ? h('div', { class: 'warn' }, '⚠️ ' + warnings.join(' ')) : null,
      h('div', { class: 'card' },
        h('button', { class: 'btn btn-big', onclick: countdownView }, '🎉 Ergebnis-Countdown starten'),
        cur.practice ? null : h('div', {},
          h('div', { class: 'spacer' }),
          h('div', { class: 'row' },
            h('button', { class: 'btn btn-secondary', onclick: function () { exportResult('pdf'); } }, '📄 Als PDF'),
            h('button', { class: 'btn btn-secondary', onclick: function () { exportResult('png'); } }, '🖼️ Als Bild')),
          h('p', { class: 'muted' }, 'Der Export enthält nur Titel, Datum, Kandidaten und Summen.')),
        cur.practice ? h('div', {},
          h('div', { class: 'spacer' }),
          h('button', { class: 'btn btn-danger', onclick: discardPractice }, 'Probemodus beenden und Teststimmen löschen')) : null),
      ties.map(function (tie) {
        var existing = elections.filter(function (x) { return x.runoffOf && x.runoffOf.id === e.id && x.runoffOf.key === L.runoffKey(tie); })[0];
        return h('div', { class: 'warn' },
          h('strong', {}, 'Gleichstand' + (tie.title ? ' in Gruppe ' + tie.title : '') + ' um Platz ' + tie.rank + ': '),
          tie.rows.map(function (r) { return r.candidate.name; }).join(', '),
          h('div', { class: 'spacer' }),
          existing ?
            h('button', { class: 'btn btn-secondary', onclick: function () { openElection(existing.id); } }, 'Stichwahl ansehen') :
            h('button', { class: 'btn', onclick: function () { startRunoff(tie); } }, 'Stichwahl starten'));
      }),
      res.map(function (r) {
        return h('div', { class: 'card' },
          r.title ? h('h2', {}, SPLIT + r.title) : null,
          r.rows.map(function (row) {
            return h('div', { class: 'res-row' + (row.rank === 1 && row.votes > 0 ? ' win' : '') },
              h('div', { class: 'rank' }, row.rank + '.'),
              photoEl(row.candidate),
              h('div', { class: 'rname' }, row.candidate.name),
              h('div', { class: 'votes' }, String(row.votes)));
          }),
          h('div', { class: 'res-row' },
            h('div', { class: 'rank' }, '–'),
            h('div', { class: 'rname' }, 'Enthaltungen'),
            h('div', { class: 'votes' }, String(r.abstentions))));
      }),
      pr ? h('div', { class: 'card' },
        h('h2', {}, 'Wahlprotokoll'),
        h('p', {}, 'Freigeschaltete Wähler: ' + pr.unlocked),
        h('p', {}, 'Abgegebene Stimmzettel: ' + pr.ballots),
        h('p', {}, 'Gezählte Stimmen: ' + pr.votes + ', Enthaltungen: ' + pr.abstentions),
        h('p', {}, 'Abgeschlossen am ' + new Date(pr.closedAt).toLocaleString('de-DE')),
        pr.warnings && pr.warnings.length ? h('p', { class: 'warn' }, '⚠️ ' + pr.warnings.join(' ')) : null) : null);
  }

  // Ergebnisdaten ohne Kandidatenobjekte (für Tafel, Countdown und Export)
  function plainResults(res, withPhotos) {
    return res.map(function (r) {
      return {
        title: r.title, abstentions: r.abstentions,
        rows: r.rows.map(function (x) {
          var row = { name: x.candidate.name, votes: x.votes, rank: x.rank };
          if (withPhotos) row.photo = x.candidate.photo;
          return row;
        })
      };
    });
  }

  function countdownView() {
    if (!requireTeacher()) return;
    var e = cur.e;
    var data = plainResults(L.computeResults(e, cur.t), true);
    show('countdown',
      h('div', { class: 'topbar' },
        h('h1', {}, (cur.practice ? 'Probeergebnis: ' : '🏆 ') + e.title),
        h('button', { class: 'btn btn-secondary btn-small', onclick: resultView }, '← Zurück')),
      Reveal.create(data, null));
  }

  async function exportResult(kind) {
    var e = cur.e;
    var data = plainResults(L.computeResults(e, cur.t), false);
    var canvas = ExportDoc.render(e.title, e.protocol ? e.protocol.closedAt : Date.now(), data);
    var name = e.title.replace(/[^A-Za-z0-9ÄÖÜäöüß-]+/g, '_');
    try {
      var blob = kind === 'pdf' ? ExportDoc.toPdfBlob(canvas) : await ExportDoc.toPngBlob(canvas);
      await ExportDoc.save(blob, name + (kind === 'pdf' ? '.pdf' : '.png'), e.title);
    } catch (err) { await info('Export nicht möglich', err.message); }
  }

  // Stichwahl: eigene Wahl nur mit den punktgleichen Kandidaten (gleiche Wählerzahl, eigene Zähler)
  async function startRunoff(tie) {
    var names = tie.rows.map(function (r) { return r.candidate.name; }).join(', ');
    if (!(await dialog({
      title: 'Stichwahl starten?',
      text: 'Es stehen nur ' + names + ' zur Wahl. Jeder Wähler hat eine Stimme. Das Ergebnis der Hauptwahl bleibt unverändert.',
      ok: 'Ja, Stichwahl anlegen'
    }))) return;
    var r = L.makeRunoff(cur.e, tie);
    await DB.put('elections', r);
    await DB.put('tallies', Object.assign({ id: r.id }, L.newTally()));
    await DB.put('voters', { id: r.id, list: [] });
    await loadAll();
    await openElection(r.id);
  }

  /* ---------- Tafel: nur Phase und Zähler senden, Befehle entgegennehmen ---------- */
  function phase() {
    if (!cur) return 'none';
    if (cur.e.status === 'closed') return 'closed';
    if (teacherAuthed || previewing) return 'paused';        // Lehrkraft arbeitet am iPad
    if (booth) return booth.warn ? 'warn' : 'voting';
    if (committing) return 'voting';
    if (lastVoted) return 'voted';
    if (cur.t.ballots >= cur.e.voterCount) return 'full';
    return 'idle';
  }

  function pushState() {
    if (!Link.isOpen()) return;
    var e = cur && cur.e, t = cur && cur.t;
    var msg = { t: 'state', phase: phase(), title: e ? e.title : '', ballots: t ? t.ballots : 0, voters: e ? e.voterCount : 0,
      practice: !!(cur && cur.practice) };
    if (msg.phase === 'closed') {
      // Ergebnisse gibt es erst nach dem Abschluss: Namen und Summen, keine Einzelstimmen
      msg.results = plainResults(L.computeResults(e, t), false);
    }
    Link.send(msg);
  }

  function onLinkMessage(m) {
    if (m.t === 'hello') { pushState(); return; }
    var p = phase();
    if (m.t === 'next' && (p === 'idle' || p === 'voted') && !committing) unlockVoter(true);
    else if (m.t === 'undo' && booth) cancelUnlock();
  }
  Link.on('open', function () {
    pushState();
    if (currentView === 'pair') { info('Tafel verbunden', 'Die Tafel ist jetzt mit dem iPad verbunden.').then(menuView); }
  });
  Link.on('close', function () { if (currentView === 'menu' && teacherAuthed) menuView(); });
  Link.on('message', onLinkMessage);

  /* ---------- Start ---------- */
  async function start() {
    try {
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist();  // Speicher vor automatischem Aufräumen schützen
      await loadAll();
      if (!(await S.hasPin())) {
        show('welcome',
          h('div', { class: 'locked' },
            h('div', { class: 'big' }, '🗳️'),
            h('h1', {}, 'Willkommen'),
            h('p', {}, 'Lege zuerst deinen sechsstelligen Code fest. Er schützt den Lehrerbereich.'),
            h('button', { class: 'btn btn-green', onclick: async function () {
              if (await chooseNewCode(false)) {
                await info('Code gespeichert', 'Merke dir den Code gut. Den Lehrerbereich öffnest du mit langem Tippen (ca. 2 Sekunden) auf das kleine Wahlurnen-Symbol oben links.');
                teacherAuthed = true;
                homeView();
              }
            } }, 'Code festlegen')));
      } else {
        await boothHome();
      }
    } catch (err) {
      Dom.mount(app, h('h1', {}, 'Speicher nicht verfügbar'),
        h('p', {}, 'Der Browser erlaubt keine lokale Speicherung. Bitte nicht den privaten Modus verwenden. (' + err.message + ')'));
    }
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register('sw.js').catch(function () { /* Offline-Betrieb ist optional */ });
    }
  }
  start();
})();
