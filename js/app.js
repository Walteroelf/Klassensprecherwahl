/*
 * app.js – Oberfläche der Klassensprecherwahl (iPad)
 * --------------------------------------------------
 * Die App startet IMMER in der Wahlkabine (gesperrter Wartebildschirm).
 * Den Lehrerbereich erreichst du nur über eine versteckte Geste (langes Tippen auf das
 * kleine Logo oben links) und danach den sechsstelligen Code.
 *
 *   Wahlkabine:   lockedScreen, boothView (Stimmabgabe)
 *   Lehrerbereich: homeView, setupView, candidateView, menuView, runView (Kabinen steuern), resultView
 *   Schutz:       askCode (Zahlenfeld), teacherLogin, Auto-Sperre, Alles löschen
 *   Kabinen:      Hauptgerät: runView, pairSlotView, unlockSlot, onBallot (zählt alles)
 *                 Wahlkabine: kabineConnectView, kabineLocked, remoteUnlock (sendet nur den Stimmzettel)
 */
(function () {
  'use strict';
  var L = window.Logic, DB = window.DB, S = window.Security, Link = window.Link, QR = window.QR, QRScan = window.QRScan;
  var Reveal = window.Reveal, ExportDoc = window.ExportDoc;
  var h = Dom.h;
  var app = document.getElementById('app');

  var LOCK_MS = 120000;      // Auto-Sperre: 2 Minuten ohne Berührung nach der Freischaltung
  var WARN_MS = 20000;       // so lange vorher warnt die Kabine
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
  // Wählerzahl 0 = unbekannt: keine Obergrenze, kein "x von y"
  function limited(e) { return e.voterCount > 0; }
  function reached(e, n) { return limited(e) && n >= e.voterCount; }
  function countText(e, n) { return limited(e) ? n + ' von ' + e.voterCount + ' haben abgestimmt' : n + ' Stimmzettel abgegeben'; }
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
  var settings = { id: 'settings', boardEnabled: false, activeId: null, bigText: false, contrast: false, speech: false, showHint: true, role: null };
  var cur = null;              // aktuelle Wahl: { e, t (Stimmenstand), v (Wählerliste), practice? }
  var practice = null;         // Probemodus: lebt NUR im Arbeitsspeicher, wird nie gespeichert
  var previewing = false;      // Kandidaten-Vorschau läuft
  var booth = null;            // laufende Freischaltung/Stimmabgabe (nur im Arbeitsspeicher!)
  var teacherAuthed = false;   // nur nach richtigem Code true, nie gespeichert
  var lastVoted = false;       // Kabine zeigt "Abgestimmt"
  var committing = false;
  var boothTimer = null, boothTick = null;
  var slots = [null, null, null];   // Hauptgerät: bis zu drei Wahlkabinen
  var kab = null;                   // Wahlkabine: Verbindung zum Hauptgerät
  var ballotQueue = Promise.resolve();

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
    // Nach einem Neuladen gibt es keine offene Kabine mehr: hängende Freischaltungen verfallen
    if (e.status === 'open' && (e.unlocked || 0) > t.ballots && !booth) { e.unlocked = t.ballots; await DB.put('elections', e); }
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
  function logoEl(onHold) {
    var timer = null;
    var el = h('div', { class: 'logo', 'aria-hidden': 'true' }, '🗳️');
    function cancel() { clearTimeout(timer); timer = null; }
    el.addEventListener('pointerdown', function () { cancel(); timer = setTimeout(function () { timer = null; (onHold || teacherLogin)(); }, 1500); });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (ev) { el.addEventListener(ev, cancel); });
    el.addEventListener('contextmenu', function (ev) { ev.preventDefault(); });
    return el;
  }

  function lockedScreen() {
    if (cur && cur.remote) { kabineLocked(); return; }
    var text;
    if (!cur) text = 'Es ist noch keine Wahl vorbereitet.';
    else if (cur.e.status === 'closed') text = 'Die Wahl ist beendet.';
    else if (reached(cur.e, cur.t.ballots)) text = 'Alle Wähler haben abgestimmt.';
    else text = 'Die Wahlkabine ist gesperrt. Bitte warte, bis du aufgerufen wirst.';
    show('booth',
      h('div', { class: 'locked' },
        h('div', { class: 'big' }, '🗳️'),
        h('h1', {}, cur ? cur.e.title : 'Klassensprecherwahl'),
        h('p', {}, text),
        cur && cur.e.status !== 'closed' ? h('p', { class: 'counter' }, '🗳️ ' + countText(cur.e, cur.t.ballots)) : null,
        settings.showHint ? h('p', { class: 'hint' }, 'Lehrkraft: Wahlurnen-Symbol oben links etwa 2 Sekunden gedrückt halten, dann Code eingeben.') : null),
      logoEl());
  }

  // Kurzanleitung im Lehrerbereich
  function helpView() {
    if (!requireTeacher()) return;
    function step(who, text) { return h('li', {}, h('span', { class: 'who' }, who), ' ', text); }
    show('help',
      h('div', { class: 'topbar' }, h('h1', {}, '📖 Kurzanleitung'),
        h('button', { class: 'btn btn-secondary btn-small', onclick: homeView }, '← Zurück')),
      h('div', { class: 'card' },
        h('h2', {}, 'So läuft eine Wahl ab'),
        h('ol', { class: 'steps' },
          step('Hauptgerät', 'Startbildschirm: „Hauptgerät“ wählen (beim ersten Mal Code festlegen). „Neue Wahl anlegen“: Titel, Modus, Kandidaten mit Foto, Wählerzahl.'),
          step('Hauptgerät', 'Unter „Kinder wählen lassen“ auf „Kabinen verbinden“ tippen. Pro Kabine: Das iPad wählt „Wahlkabine“ und scannt den QR-Code, danach hält es seinen Code vor die Kamera des Hauptgeräts. Die Wahl wird automatisch übertragen.'),
          step('Hauptgerät', 'Ein Kind aufrufen und bei einer freien Kabine auf „Kind freischalten“ tippen. Das Hauptgerät kann auf die Tafel gespiegelt werden.'),
          step('Kind', 'Foto antippen, mit „Ja, wählen“ bestätigen. Danach sperrt sich die Kabine, bis du sie wieder freischaltest.'),
          step('Hauptgerät', 'Wenn alle gewählt haben: „Wahl abschließen“. Erst jetzt erscheint das Ergebnis (Countdown, PDF, Stichwahl).'))),
      h('div', { class: 'card' },
        h('h2', {}, 'Gut zu wissen'),
        h('ul', { class: 'steps' },
          h('li', {}, 'Die Wahlkabinen (iPads) bleiben in der Kabine. Dort gibt es keine Einstellungen, nur den Wartebildschirm und die Wahl.'),
          h('li', {}, 'Abgegebene Stimmen lassen sich nie zurücknehmen. „Rückgängig“ gilt nur für eine Freischaltung ohne Stimme.'),
          h('li', {}, 'Nach 2 Minuten ohne Berührung sperrt sich die Kabine von selbst. Reißt die Verbindung ab, muss die Kabine neu verbunden werden.'),
          h('li', {}, 'Für den Geführten Zugriff (Home-Taste sperren) siehe README. Auf der Kabine beendest du den Kabinen-Modus mit dem Wahlurnen-Symbol (2 Sekunden halten).'),
          h('li', {}, 'Code vergessen: nur über das Löschen der Website-Daten in Safari möglich, dabei gehen alle Wahlen verloren.'))));
  }

  /* ---------- Anmeldung als Lehrkraft ---------- */
  function askTeacherCode() {
    return askCode({ title: 'Code eingeben', text: 'Bereich für die Lehrkraft', getLock: S.lockRemaining, onCode: verifyCode });
  }
  // Über das Logo in der Wahlkabine (versteckte Geste)
  async function teacherLogin() {
    if (booth) return;
    if (!(await askTeacherCode())) return;
    teacherAuthed = true;
    pushState();
    if (cur) menuView(); else homeView();
  }
  // Ohne Code kein Zugang: zurück dorthin, wo dieses Gerät hingehört
  function requireTeacher() {
    if (teacherAuthed) return true;
    if (settings.role === 'booth') boothHome(); else startView();
    return false;
  }

  /* ---------- Startbildschirm: Wofür wird dieses Gerät benutzt? ---------- */
  function startView() {
    stopBoothTimers();
    teacherAuthed = false; booth = null; previewing = false; cur = null;
    pushState();
    var beginText = 'Mit Code öffnen';
    show('start',
      h('div', { class: 'start' },
        h('h1', {}, '🗳️ Klassensprecherwahl'),
        h('p', { class: 'lead' }, 'Hauptgerät für die Lehrkraft'),
        h('button', { class: 'btn btn-big', onclick: chooseTeacher }, beginText),
        h('div', { class: 'spacer' }), h('div', { class: 'spacer' }),
        h('p', { class: 'muted' }, 'Dieses Gerät ist ein iPad für die Kinder? ',
          h('button', { class: 'btn btn-secondary btn-small', onclick: chooseKabine }, 'Als Wahlkabine verwenden'))));
  }
  async function chooseKabine() { settings.role = 'kabine'; await saveSettings(); kabineHome(); }
  // Beim ersten Mal legt die Lehrkraft ihren Code fest
  function welcomeView() {
    show('welcome',
      h('div', { class: 'locked' },
        h('div', { class: 'big' }, '🗳️'),
        h('h1', {}, 'Willkommen'),
        h('p', {}, 'Lege zuerst deinen sechsstelligen Code fest. Er schützt das Hauptgerät.'),
        h('button', { class: 'btn btn-green', onclick: async function () {
          if (await chooseNewCode(false)) {
            await info('Code gespeichert', 'Merke dir den Code gut. Er schützt den Bereich der Lehrkraft.');
            teacherAuthed = true;
            homeView();
          }
        } }, 'Code festlegen'),
        h('div', { class: 'spacer' }),
        h('button', { class: 'btn btn-secondary', onclick: startView }, 'Zurück')));
  }
  async function chooseTeacher() {
    if (!(await S.hasPin())) { welcomeView(); return; }
    if (!(await askTeacherCode())) return;
    teacherAuthed = true;
    homeView();
  }
  async function leaveToStart() { settings.role = null; await saveSettings(); startView(); }

  /* ---------- Lehrkraft: Meine Wahlen ---------- */
  function homeView() {
    if (!requireTeacher()) return;
    booth = null;
    var TODO = { setup: 'Weiter einrichten', open: 'Wahl steuern', closed: 'Ergebnis ansehen' };
    show('home',
      h('div', { class: 'topbar' },
        h('h1', {}, '⚙️ Hauptgerät'),
        h('button', { class: 'btn btn-secondary btn-small', onclick: leaveToStart }, '← Zum Start')),
      h('p', { class: 'muted' }, 'Hier bereitest du die Wahl vor, rufst die Kinder auf und siehst am Ende das Ergebnis.'),
      practice ? h('div', { class: 'warn' }, '🎓 Der Probemodus läuft noch. ',
        h('button', { class: 'btn btn-small', onclick: function () { cur = practice; menuView(); } }, 'Fortsetzen')) : null,
      h('h2', {}, 'Meine Wahlen'),
      elections.length ? elections.map(function (e) {
        return h('div', { class: 'card row' },
          h('div', { class: 'grow' },
            h('strong', {}, e.title), ' ',
            h('span', { class: 'badge ' + e.status }, STATUS_NAMES[e.status]),
            settings.activeId === e.id ? [' ', h('span', { class: 'badge open' }, 'in der Kabine')] : null,
            h('div', { class: 'muted' }, MODE_NAMES[e.mode] + ' · ' + e.candidates.length + ' Kandidaten')),
          h('button', { class: 'btn', onclick: function () { openElection(e.id); } }, TODO[e.status]));
      }) : h('div', { class: 'card' }, h('p', {}, 'Du hast noch keine Wahl. Lege jetzt deine erste Wahl an.')),
      h('button', { class: 'btn btn-big btn-green', onclick: function () { setupView(L.newElection(), { voters: '' }, true); } }, '＋ Neue Wahl anlegen'),
      h('div', { class: 'spacer' }), h('div', { class: 'spacer' }),
      h('div', { class: 'row' },
        h('button', { class: 'btn btn-secondary', onclick: settingsView }, '🔧 Weitere Einstellungen'),
        h('button', { class: 'btn btn-secondary', onclick: helpView }, '📖 Kurzanleitung')));
  }

  /* ---------- Lehrkraft: Weitere Einstellungen ---------- */
  function settingsView() {
    if (!requireTeacher()) return;
    show('settings',
      h('div', { class: 'topbar' },
        h('h1', {}, '🔧 Weitere Einstellungen'),
        h('button', { class: 'btn btn-secondary btn-small', onclick: homeView }, '← Zurück')),
      h('h2', {}, 'Anzeige und Vorlesen'),
      a11yCard(),
      h('h2', {}, 'Probemodus'),
      h('div', { class: 'card' },
        h('p', {}, 'Zeigt den Kindern den Ablauf. Die Teststimmen zählen nicht und werden am Ende vollständig gelöscht.'),
        practice ? h('div', {}, h('button', { class: 'btn', onclick: function () { cur = practice; menuView(); } }, 'Probemodus fortsetzen'), h('div', { class: 'spacer' })) : null,
        h('button', { class: 'btn btn-secondary', onclick: startSamplePractice }, 'Probemodus mit Beispielkandidaten'),
        h('p', { class: 'muted' }, 'Mit deinen echten Kandidaten startest du den Probemodus direkt in der jeweiligen Wahl.')),
      h('h2', {}, 'Code'),
      h('div', { class: 'card' }, h('button', { class: 'btn btn-secondary', onclick: changeCode }, 'Code ändern')),
      h('h2', {}, 'Alles löschen'),
      h('div', { class: 'card' },
        h('p', {}, 'Entfernt alle Wahlen, Fotos, Stimmen, Listen und den Code von diesem Gerät.'),
        h('button', { class: 'btn btn-danger', onclick: deleteAll }, 'Alles löschen')));
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
      toggle('showHint', 'Hinweis für die Lehrkraft auf dem Wartebildschirm zeigen'),
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
      slots.forEach(function (sl) { if (sl) sl.link.close(); }); if (kab) kab.link.close();
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

      e.mode === 'group' ? h('div', {},
        h('h2', {}, 'Gruppen'),
        h('p', { class: 'muted' }, 'Jedes Kind wird einer Gruppe zugeordnet, z. B. Mädchen und Jungen. Die Kinder wählen je Gruppe eine Person.'),
        e.groupNames.map(function (n, g) {
          return h('div', {},
            h('label', { class: 'field' }, SPLIT + (g + 1)),
            h('input', { type: 'text', value: n, onchange: function (ev) { e.groupNames[g] = ev.target.value.trim() || (SPLIT + (g + 1)); again(); } }));
        }),
        h('label', { class: 'field' }, 'Erste Seite in der Wahlkabine'), groupSelect(0),
        h('label', { class: 'field' }, 'Zweite Seite in der Wahlkabine'), groupSelect(1)) : null,

      h('h2', {}, 'Kandidaten (' + e.candidates.length + ')'),
      h('div', { class: 'card' },
        h('button', { class: 'btn btn-green btn-block', onclick: function () { candidateView(e, ctx, isNew, null); } }, '＋ Kandidat hinzufügen'),
        e.candidates.length ? h('div', { class: 'spacer' }) : null,
        e.candidates.length ? e.candidates.map(function (c) {
          return h('div', { class: 'cand' },
            photoEl(c, 'thumb'),
            h('div', { class: 'name' }, c.name, e.mode === 'group' ? h('div', { class: 'small' }, e.groupNames[c.group]) : null),
            h('button', { class: 'btn btn-secondary btn-small', onclick: function () { candidateView(e, ctx, isNew, c); } }, 'Ändern'),
            h('button', { class: 'btn btn-secondary btn-small', onclick: async function () {
              if (await dialog({ title: c.name + ' entfernen?', ok: 'Entfernen', danger: true })) {
                e.candidates = e.candidates.filter(function (x) { return x !== c; });
                again();
              }
            } }, 'Entfernen'));
        }) : h('p', { class: 'muted' }, 'Noch keine Kandidaten.')),

      h('h2', {}, 'Wähler'),
      h('label', { class: 'field' }, 'Anzahl der Wähler'),
      h('input', { type: 'number', inputmode: 'numeric', min: '1', placeholder: 'leer = unbekannt', value: e.voterCount || '', oninput: function (ev) { e.voterCount = parseInt(ev.target.value, 10) || 0; } }),
      h('p', { class: 'muted' }, 'Optional. Wenn du die Zahl nicht kennst, lass das Feld leer: Dann gibt es keine Obergrenze, und du schließt die Wahl selbst ab. Ist eine Zahl eingetragen, werden nie mehr Stimmzettel angenommen.'),
      h('details', {},
        h('summary', {}, 'Wählerliste zum Abhaken (optional)'),
        h('label', { class: 'field' }, 'Ein Name pro Zeile'),
        h('textarea', { oninput: function (ev) { ctx.voters = ev.target.value; } }, ctx.voters),
        h('p', { class: 'muted' }, 'Die Liste dient nur zum Abhaken. Sie ist von den Stimmen getrennt und wird beim Abschluss der Wahl gelöscht.')),

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
      e.mode === 'group' ? h('label', { class: 'field' }, 'Gruppe') : null,
      e.mode === 'group' ? (function () {
        var sel = h('select', { onchange: function () { c.group = Number(sel.value); } },
          e.groupNames.map(function (n, g) { return h('option', { value: g, selected: c.group === g }, n); }));
        return sel;
      })() : null,
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

  // Ein Schritt im Lehrermenü: Nummer (oder Haken), Überschrift, Inhalt
  function stepCard(n, title, done) {
    return h('div', { class: 'card stepcard' },
      h('h2', {}, h('span', { class: 'num' + (done ? ' done' : '') }, done ? '✓' : String(n)), title),
      Array.prototype.slice.call(arguments, 3));
  }

  // Zur Wahlkabine wechseln: Dieses Gerät wird zum Wahlcomputer und zeigt den Wartebildschirm
  async function toBooth() {
    if (!cur.practice) {
      var errs = L.validate(cur.e);
      if (errs.length) { await info('Die Wahl ist noch nicht fertig eingerichtet', null, errs); return; }
      settings.activeId = cur.e.id;
    }
    settings.role = 'booth';
    await saveSettings();
    boothHome();
  }

  /* ---------- Lehrkraft: eine Wahl Schritt für Schritt ---------- */
  function menuView() {
    if (!requireTeacher()) return;
    stopBoothTimers();
    booth = null;
    var e = cur.e, t = cur.t, v = cur.v, isP = !!cur.practice;
    var closed = e.status === 'closed';
    var full = reached(e, t.ballots);
    var errs = isP ? [] : L.validate(e);
    var ready = errs.length === 0;
    var started = t.ballots > 0 || e.status === 'open';
    var pct = limited(e) ? Math.round(100 * t.ballots / e.voterCount) : 0;
    var bar = limited(e) ? h('div', { class: 'progress' }, h('div', {})) : null;
    if (bar) bar.firstChild.style.width = pct + '%';
    var title = (isP ? 'Probemodus: ' : '') + e.title;
    var back = h('button', { class: 'btn btn-secondary btn-small', onclick: async function () { await loadAll(); homeView(); } }, '← Meine Wahlen');
    var header = [
      h('div', { class: 'topbar' }, h('h1', {}, title), back),
      h('p', {}, h('span', { class: 'badge ' + e.status }, STATUS_NAMES[e.status]), ' ', MODE_NAMES[e.mode]),
      e.runoffOf ? h('p', { class: 'muted' }, 'Dies ist eine Stichwahl. Es stehen nur die punktgleichen Kandidaten zur Wahl.') : null
    ];

    // Abgeschlossene Wahl: nur noch das Ergebnis
    if (closed) {
      show('menu', header,
        h('div', { class: 'next' }, 'Die Wahl ist abgeschlossen.'),
        h('button', { class: 'btn btn-big', onclick: resultView }, cur.practice ? '🏆 Probeergebnis anzeigen' : '🏆 Ergebnis anzeigen'),
        h('div', { class: 'spacer' }),
        isP ? null : h('button', { class: 'btn btn-secondary btn-small', onclick: deleteElection }, 'Diese Wahl löschen'));
      return;
    }

    // Was ist als Nächstes zu tun?
    var next;
    if (!ready) next = 'Als Nächstes: Wahl fertig einrichten. ' + errs[0];
    else if (full) next = 'Alle Kinder haben gewählt. Als Nächstes: Wahl abschließen.';
    else if (!started) next = 'Als Nächstes: Kabinen verbinden und das erste Kind freischalten.';
    else next = 'Als Nächstes: das nächste Kind aufrufen und freischalten.';

    show('menu', header,
      h('div', { class: 'next' }, next),

      // 1. Einrichten
      isP ? null : stepCard(1, 'Wahl einrichten', ready,
        h('p', {}, e.candidates.length + ' Kandidaten · ' + (limited(e) ? e.voterCount + ' Wähler' : 'Wählerzahl unbekannt')),
        ready ? null : h('p', { class: 'warn' }, errs.join(' ')),
        h('div', { class: 'row' },
          t.ballots === 0 ? h('button', { class: 'btn btn-secondary', onclick: function () { setupView(JSON.parse(JSON.stringify(e)), { voters: v.list.map(function (p) { return p.name; }).join('\n') }, false); } }, '✏️ Bearbeiten') : null,
          h('button', { class: 'btn btn-secondary', onclick: candidatePreview }, '👀 Kandidaten zeigen')),
        t.ballots === 0 ? null : h('p', { class: 'muted' }, 'Nach der ersten Stimme sind die Einstellungen gesperrt.')),

      // 2. Kinder wählen lassen
      isP ? stepCard(2, 'Kinder wählen lassen', full,
        h('p', {}, h('strong', {}, countText(e, t.ballots))),
        bar,
        h('p', { class: 'muted' }, 'Im Probemodus wählt dieses Gerät selbst. Du rufst ein Kind auf und schaltest es frei, danach sperrt sich die Kabine sofort.'),
        full ? null : h('div', {},
          h('button', { class: 'btn btn-big btn-green', onclick: toBooth }, 'Wahlkabine starten'),
          h('div', { class: 'spacer' }),
          h('button', { class: 'btn btn-secondary', onclick: function () { unlockVoter(false); } }, 'Gleich das erste Kind freischalten')),
        h('p', { class: 'muted' }, 'Zurück hierher: Wahlurnen-Symbol oben links 2 Sekunden halten, dann Code.')) :
      stepCard(2, 'Kinder wählen lassen', full,
        h('p', {}, h('strong', {}, countText(e, t.ballots))),
        bar,
        h('p', { class: 'muted' }, 'Verbinde bis zu drei iPads als Wahlkabinen (per QR-Code). Du schaltest die Kinder hier einzeln frei. Dieses Gerät kannst du auf die Tafel spiegeln.'),
        h('button', { class: 'btn btn-big btn-green', disabled: !ready, onclick: runView },
          slots.some(function (sl) { return sl && sl.link.isOpen(); }) ? 'Wahl durchführen' : 'Kabinen verbinden und Wahl durchführen'),
        h('div', { class: 'spacer' }),
        h('p', { class: 'muted' }, 'Oder ohne zweites Gerät: Dieses Gerät wird selbst zur gesperrten Wahlkabine. Pro Kind: Wahlurnen-Symbol oben links 2 Sekunden halten, Code eingeben, „Nächstes Kind freischalten“.'),
        started ?
          h('div', { class: 'row' },
            h('button', { class: 'btn btn-secondary', disabled: full, onclick: function () { unlockVoter(false); } }, 'Nächstes Kind freischalten'),
            h('button', { class: 'btn btn-secondary', onclick: toBooth }, 'Dieses Gerät als Wahlkabine')) :
          h('div', { class: 'row' },
            h('button', { class: 'btn btn-secondary', disabled: !ready, onclick: toBooth }, 'Dieses Gerät als Wahlkabine'),
            h('button', { class: 'btn btn-secondary', disabled: !ready, onclick: function () { unlockVoter(false); } }, 'Gleich das erste Kind freischalten')),
        v.list.length ? h('details', {},
          h('summary', {}, 'Wählerliste zum Abhaken (' + v.list.filter(function (p) { return p.done; }).length + ' von ' + v.list.length + ')'),
          v.list.map(function (p) {
            return h('label', { class: 'checkline' },
              h('input', { type: 'checkbox', checked: p.done, onchange: async function (ev) { p.done = ev.target.checked; await DB.put('voters', v); } }),
              p.name);
          })) : null),

      // 3. Abschließen
      isP ?
        stepCard(3, 'Probemodus beenden', false,
          h('p', { class: 'muted' }, 'Zeigt das Probeergebnis. Danach werden alle Teststimmen gelöscht.'),
          h('button', { class: 'btn btn-danger', onclick: finishPractice }, 'Probemodus beenden')) :
        stepCard(3, 'Wahl abschließen', false,
          h('p', { class: 'muted' }, 'Erst wenn alle Kinder gewählt haben. Danach sind keine Stimmen mehr möglich, und das Ergebnis wird sichtbar.'),
          h('button', { class: 'btn ' + (full ? 'btn-big btn-green' : 'btn-danger'), onclick: closeElection }, 'Wahl abschließen')),

      isP ? null : h('details', {},
        h('summary', {}, 'Mehr …'),
        h('div', { class: 'row' },
          h('button', { class: 'btn btn-secondary', onclick: startOwnPractice }, '🎓 Probemodus mit diesen Kandidaten'),
          h('button', { class: 'btn btn-secondary', onclick: deleteElection }, 'Diese Wahl löschen'))));
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
    if (!(e.voterCount >= 0)) e.voterCount = 5;
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

  /* =====================================================================
   * Hauptgerät mit bis zu drei Wahlkabinen
   * ---------------------------------------------------------------------
   * Das Hauptgerät zählt ALLE Stimmen. Jede Kabine ist nur eine Eingabe: Sie bekommt die Kandidaten
   * (nur im Arbeitsspeicher), wird einzeln freigeschaltet und schickt am Ende einen Stimmzettel zurück.
   * Es wird nie gespeichert, welche Kabine oder welches Kind welchen Stimmzettel abgegeben hat.
   * ===================================================================== */
  var MAX_SLOTS = 3;
  var SLOT_TEXT = { offline: 'nicht verbunden', connecting: 'verbindet …', idle: 'frei', voting: 'wählt gerade …', warn: '⚠️ sperrt gleich automatisch', voted: '✅ hat gewählt' };

  function refreshRun() { if (currentView === 'run') runView(); }

  // Eine Kabine (Verbindung + Zustand) anlegen oder holen
  function getSlot(i) {
    if (slots[i]) return slots[i];
    var slot = slots[i] = { n: i + 1, link: Link.create(), state: 'offline', onReady: null };
    slot.link.on('open', function () { slot.state = 'connecting'; sendConfig(slot); refreshRun(); });
    slot.link.on('close', function () {
      if (cur && !cur.practice && (slot.state === 'voting' || slot.state === 'warn')) cancelOutstanding(slot);
      slot.state = 'offline'; refreshRun();
    });
    slot.link.on('message', function (m) { onSlotMessage(slot, m); });
    return slot;
  }
  function sendConfig(slot) {
    var e = cur.e;
    slot.link.send({ t: 'config', election: {
      id: e.id, title: e.title, mode: e.mode, allowDouble: e.allowDouble, voterCount: e.voterCount,
      groupNames: e.groupNames, parityGroups: e.parityGroups,
      candidates: e.candidates.map(function (c) { return { id: c.id, name: c.name, group: c.group, photo: c.photo }; })
    } });
  }
  function anyVoting() { return slots.some(function (s) { return s && (s.state === 'voting' || s.state === 'warn'); }); }

  // Eine nicht benutzte Freischaltung zurücknehmen (Rückgängig, Zeit abgelaufen, Verbindung weg)
  function cancelOutstanding(slot) {
    var e = cur.e;
    if ((e.unlocked || 0) > cur.t.ballots) { e.unlocked -= 1; persistElection(e); }
    slot.state = slot.link.isOpen() ? 'idle' : 'offline';
  }

  async function unlockSlot(i) {
    var slot = slots[i], e = cur.e;
    if (!slot || !slot.link.isOpen() || (slot.state !== 'idle' && slot.state !== 'voted') || e.status === 'closed') return;
    if (reached(e, e.unlocked || 0)) { await info('Alle Wähler waren dran', 'Es sind schon alle Stimmzettel vergeben.'); return; }
    if (e.status === 'setup') {
      var errs = L.validate(e);
      if (errs.length) { await info('Die Wahl ist noch nicht fertig eingerichtet', null, errs); return; }
      e.status = 'open';                   // ab jetzt sind die Einstellungen gesperrt
    }
    e.unlocked = (e.unlocked || 0) + 1;    // genau eine Freischaltung = genau ein Stimmzettel
    await persistElection(e);
    slot.state = 'voting';
    // Für jede Freischaltung eine neue Zufallsreihenfolge je Seite
    slot.link.send({ t: 'unlock', pages: L.pages(e).map(function (p) { return { scope: p.scope, title: p.title, order: L.shuffle(p.candidateIds) }; }) });
    runView();
  }
  function lockSlot(i) {
    var slot = slots[i];
    if (!slot || (slot.state !== 'voting' && slot.state !== 'warn')) return;
    slot.link.send({ t: 'lock' });
    cancelOutstanding(slot);
    runView();
  }

  function onSlotMessage(slot, m) {
    if (m.t === 'ready') {
      slot.state = 'idle';
      var f = slot.onReady; slot.onReady = null;
      if (f) f(); else refreshRun();
    } else if (m.t === 'st') {
      if ((m.phase === 'warn' || m.phase === 'voting') && (slot.state === 'voting' || slot.state === 'warn')) { slot.state = m.phase; refreshRun(); }
    } else if (m.t === 'timeout') {
      if (cur && (slot.state === 'voting' || slot.state === 'warn')) cancelOutstanding(slot);
      refreshRun();
    } else if (m.t === 'ballot') {
      ballotQueue = ballotQueue.then(function () { return onBallot(slot, m); }).catch(function () { /* weiter */ });
    }
  }
  // Stimmzettel einer Kabine zählen. Immer einer nach dem anderen, damit nie ein Stand überschrieben wird.
  async function onBallot(slot, m) {
    if (!cur || cur.practice || cur.e.status !== 'open' || (slot.state !== 'voting' && slot.state !== 'warn')) {
      slot.link.send({ t: 'ack', ok: false, msg: 'Die Freischaltung gilt nicht mehr. Bitte die Lehrkraft rufen.' });
      return;
    }
    try {
      var next = L.applyBallot(cur.e, cur.t, m.picks);     // wirft einen Fehler, wenn etwas nicht stimmt
      var stored = Object.assign({ id: cur.e.id }, next);
      await persistTally(stored);                          // erst speichern …
      cur.t = stored;                                      // … dann merken
      slot.state = 'voted';
      slot.link.send({ t: 'ack', ok: true });
    } catch (err) {
      slot.link.send({ t: 'ack', ok: false, msg: err.message });
      cancelOutstanding(slot);
    }
    refreshRun();
  }

  // Laufende Wahl: Zustand aller Kabinen, hier werden die Kinder freigeschaltet (gut für die Tafel)
  function runView() {
    if (!requireTeacher()) return;
    stopBoothTimers(); booth = null;
    if (!cur || cur.practice) { menuView(); return; }
    var e = cur.e, t = cur.t;
    var errs = L.validate(e);
    if (errs.length) { info('Die Wahl ist noch nicht fertig eingerichtet', null, errs).then(menuView); return; }
    var full = reached(e, t.ballots);
    var all = reached(e, e.unlocked || 0);
    var pct = limited(e) ? Math.min(100, Math.round(100 * t.ballots / e.voterCount)) : 0;
    var bar = limited(e) ? h('div', { class: 'progress big' }, h('div', {})) : null;
    if (bar) bar.firstChild.style.width = pct + '%';

    function slotCard(i) {
      var s = slots[i], st = s ? s.state : 'offline';
      var buttons;
      if (st === 'offline' || st === 'connecting') {
        buttons = [h('button', { class: 'btn btn-secondary', onclick: function () { pairSlotView(i); } }, st === 'connecting' ? 'Neu verbinden' : '📷 Verbinden')];
      } else if (st === 'voting' || st === 'warn') {
        buttons = [h('button', { class: 'btn btn-secondary', onclick: function () { lockSlot(i); } }, '↩ Rückgängig')];
      } else {
        buttons = [
          h('button', { class: 'btn btn-green', disabled: all, onclick: function () { unlockSlot(i); } }, 'Kind freischalten'),
          h('button', { class: 'btn btn-secondary btn-small', onclick: function () { s.link.close(); s.state = 'offline'; runView(); } }, 'Trennen')];
      }
      return h('div', { class: 'card slot ' + st },
        h('div', { class: 'grow' }, h('strong', {}, 'Kabine ' + (i + 1)), h('div', { class: 'st' }, SLOT_TEXT[st])),
        h('div', { class: 'row' }, buttons));
    }

    show('run',
      h('div', { class: 'topbar' }, h('h1', {}, e.title), h('button', { class: 'btn btn-secondary btn-small', onclick: menuView }, '← Einrichtung')),
      h('p', { class: 'run-count' }, countText(e, t.ballots)),
      bar,
      full ? h('div', { class: 'next' }, 'Alle Kinder haben gewählt. Du kannst die Wahl jetzt abschließen.') : null,
      h('div', { class: 'slots' }, [0, 1, 2].slice(0, MAX_SLOTS).map(slotCard)),
      h('p', { class: 'muted' }, 'Das Kind wählt allein in der Kabine. Danach sperrt sich die Kabine, bis du sie wieder freischaltest. Nach 2 Minuten ohne Berührung sperrt sie sich von selbst.'),
      h('details', {}, h('summary', {}, 'Wahl abschließen'),
        h('p', { class: 'muted' }, 'Danach sind keine Stimmen mehr möglich, und das Ergebnis wird sichtbar.' +
          (full || !limited(e) ? '' : ' Achtung: Es haben noch nicht alle Wähler abgestimmt.')),
        h('button', { class: 'btn btn-danger', disabled: anyVoting(), onclick: closeElection }, 'Wahl abschließen')));
  }

  // Eine Kabine verbinden: Dieses Gerät zeigt einen QR-Code, die Kabine scannt ihn, zeigt ihrerseits einen Code,
  // den dieses Gerät mit seiner Kamera liest. Danach wird die Wahl automatisch zur Kabine übertragen.
  async function pairSlotView(i) {
    if (!requireTeacher()) return;
    var slot = getSlot(i);
    show('pair', h('h1', {}, 'Kabine ' + (i + 1) + ' verbinden'), h('p', { class: 'muted' }, 'Verbindungscode wird erstellt …'));
    var offer;
    try { offer = await slot.link.createOffer(); }
    catch (err) { await info('Verbindung nicht möglich', err.message); runView(); return; }
    slot.state = 'offline';

    var scanner = null, timeout = null;
    var cv = h('canvas', { class: 'qr big' });
    QR.toCanvas(cv, offer, 5);
    var answer = h('textarea', { placeholder: 'Text der Kabine hier einfügen' });
    var status = h('p', { class: 'muted' }, '');
    var video = h('video', { class: 'scan', playsinline: true, muted: true, hidden: true });
    function stop() { if (scanner) { scanner.stop(); scanner = null; } video.hidden = true; clearTimeout(timeout); }
    function leave() { stop(); slot.onReady = null; slot.link.close(); slot.state = 'offline'; runView(); }

    slot.onReady = function () {
      stop();
      info('Kabine ' + (i + 1) + ' verbunden', 'Die Wahl ist auf der Kabine angekommen. Du kannst jetzt Kinder freischalten.').then(runView);
    };
    async function connect(text) {
      try {
        await slot.link.acceptAnswer(text);
        status.textContent = 'Verbindung wird aufgebaut …';
        clearTimeout(timeout);
        timeout = setTimeout(function () {
          status.textContent = 'Das dauert ungewöhnlich lange. Sind beide Geräte im selben WLAN? Bitte noch einmal versuchen.';
        }, 20000);
      } catch (err) { status.textContent = err.message; }
    }
    function startCamera() {
      status.textContent = 'Kamera wird gestartet …';
      video.hidden = false;
      scanner = QRScan.start(video, function (text) { scanner = null; video.hidden = true; connect(text); },
        function (err) { video.hidden = true; status.textContent = err.message; });
    }

    show('pair',
      h('div', { class: 'topbar' }, h('h1', {}, '📲 Kabine ' + (i + 1) + ' verbinden'), h('button', { class: 'btn btn-secondary btn-small', onclick: leave }, 'Abbrechen')),
      h('p', { class: 'muted' }, 'Beide Geräte müssen im selben WLAN sein.'),
      h('div', { class: 'pair-grid' },
        h('div', { class: 'card stepcard' },
          h('h2', {}, h('span', { class: 'num' }, '1'), 'Kabine scannt diesen Code'),
          h('p', {}, 'Am iPad: App öffnen → „Wahlkabine“ → „Kamera starten“ → auf diesen Code richten.'),
          cv,
          h('details', {}, h('summary', {}, 'Ohne Kamera am iPad: Text anzeigen'), h('textarea', { readonly: true }, offer))),
        h('div', { class: 'card stepcard' },
          h('h2', {}, h('span', { class: 'num' }, '2'), 'Dieses Gerät scannt die Kabine'),
          h('p', {}, 'Die Kabine zeigt danach einen eigenen Code. Halte ihn vor die Kamera dieses Geräts.'),
          video,
          h('button', { class: 'btn btn-big', onclick: startCamera }, '📷 Kamera starten'),
          status,
          h('details', {}, h('summary', {}, 'Ohne Kamera: Text einfügen'),
            h('p', { class: 'muted' }, 'Den Text, den die Kabine anzeigt, hier einfügen:'), answer,
            h('button', { class: 'btn btn-secondary', onclick: function () { connect(answer.value); } }, 'Verbinden')))));
  }

  /* =====================================================================
   * Wahlkabine (zweites Gerät)
   * ===================================================================== */
  var ackWait = null;

  function ensureKab() {
    if (kab) return kab;
    kab = { link: Link.create() };
    kab.link.on('open', function () {
      var st = document.getElementById('pairstate');
      if (st) st.textContent = '✅ Verbunden. Die Wahl wird übertragen …';
    });
    kab.link.on('close', function () {
      if (ackWait) ackWait({ ok: false, msg: 'Die Verbindung zum Hauptgerät ist unterbrochen.' });
      if (settings.role !== 'kabine') return;
      if (booth && !committing) { stopBoothTimers(); booth = null; }
      if (currentView !== 'pair') kabineLocked();
    });
    kab.link.on('message', onKabMessage);
    return kab;
  }

  function kabineHome() {
    ensureKab();
    stopBoothTimers(); booth = null; committing = false; lastVoted = false;
    if (cur && cur.remote && kab.link.isOpen()) kabineLocked(); else { cur = null; kabineConnectView(); }
  }

  function kabineConnectView() {
    ensureKab();
    var scanner = null;
    var video = h('video', { class: 'scan', playsinline: true, muted: true, hidden: true });
    var status = h('p', { class: 'muted' }, '');
    var area = h('div', {});
    function stop() { if (scanner) { scanner.stop(); scanner = null; } video.hidden = true; }

    async function gotOffer(text) {
      stop();
      try {
        var ans = await kab.link.acceptOffer(text);
        var cv = h('canvas', { class: 'qr big' });
        QR.toCanvas(cv, ans, 6);
        status.textContent = '';
        Dom.mount(area,
          h('div', { class: 'card stepcard' },
            h('h2', {}, h('span', { class: 'num' }, '2'), 'Diesen Code dem Hauptgerät zeigen'),
            h('p', {}, 'Halte diesen Bildschirm vor die Kamera des Hauptgeräts. Das Bild bleibt so stehen.'),
            cv,
            h('p', { class: 'muted', id: 'pairstate' }, 'Warte auf das Hauptgerät …'),
            h('details', {}, h('summary', {}, 'Hauptgerät hat keine Kamera? Text übertragen'),
              h('p', { class: 'muted' }, 'Diesen Text auf dem Hauptgerät unter „Ohne Kamera“ einfügen:'),
              h('textarea', { readonly: true }, ans))));
      } catch (err) {
        status.textContent = err.message;
        Dom.mount(area, startCard());
      }
    }
    function startCard() {
      var paste = h('textarea', { placeholder: 'Verbindungstext des Hauptgeräts hier einfügen' });
      return h('div', { class: 'card stepcard' },
        h('h2', {}, h('span', { class: 'num' }, '1'), 'QR-Code des Hauptgeräts scannen'),
        h('p', {}, 'Das Hauptgerät zeigt einen QR-Code (Wahl durchführen → Kabine verbinden). Tippe auf „Kamera starten“ und halte das iPad davor.'),
        video,
        h('button', { class: 'btn btn-big', onclick: function () {
          status.textContent = 'Kamera wird gestartet …';
          video.hidden = false;
          scanner = QRScan.start(video, gotOffer, function (err) { video.hidden = true; status.textContent = err.message; });
        } }, '📷 Kamera starten'),
        h('details', {}, h('summary', {}, 'Ohne Kamera: Text einfügen'),
          h('p', { class: 'muted' }, 'Verbindungstext des Hauptgeräts hier einfügen:'), paste,
          h('button', { class: 'btn btn-secondary', onclick: function () { gotOffer(paste.value); } }, 'Weiter')));
    }

    Dom.mount(area, startCard());
    show('pair',
      h('div', { class: 'topbar' }, h('h1', {}, '🗳️ Wahlkabine verbinden'),
        h('button', { class: 'btn btn-secondary btn-small', onclick: function () { stop(); kab.link.close(); leaveToStart(); } }, 'Abbrechen')),
      h('p', { class: 'muted' }, 'Beide Geräte müssen im selben WLAN sein.'),
      area, status);
  }

  // Gesperrter Wartebildschirm der Kabine
  function kabineLocked() {
    var open = kab && kab.link.isOpen();
    var text = !cur ? 'Es ist noch keine Wahl übertragen.' : cur.e.status === 'closed' ? 'Die Wahl ist beendet.' : 'Die Wahlkabine ist gesperrt. Bitte warte, bis du aufgerufen wirst.';
    show('booth',
      h('div', { class: 'locked' },
        h('div', { class: 'big' }, '🗳️'),
        h('h1', {}, cur ? cur.e.title : 'Wahlkabine'),
        h('p', {}, text),
        open ? null : h('div', {},
          h('p', { class: 'warn' }, '⚠️ Keine Verbindung zum Hauptgerät.'),
          h('button', { class: 'btn', onclick: kabineConnectView }, 'Neu verbinden')),
        settings.showHint ? h('p', { class: 'hint' }, 'Lehrkraft: Zum Beenden das Wahlurnen-Symbol oben links etwa 2 Sekunden gedrückt halten.') : null),
      logoEl(kabineExit));
  }
  async function kabineExit() {
    if (!(await dialog({ title: 'Wahlkabine beenden?', text: 'Die Verbindung zum Hauptgerät wird getrennt und die Wahl von diesem Gerät entfernt.', ok: 'Beenden', danger: true }))) return;
    stopBoothTimers(); booth = null;
    if (kab) kab.link.close();
    cur = null;
    await leaveToStart();
  }

  function onKabMessage(m) {
    if (m.t === 'config') { importConfig(m); }
    else if (m.t === 'unlock') { remoteUnlock(m); }
    else if (m.t === 'lock') {
      if (booth && !committing) { stopBoothTimers(); booth = null; kabineLocked(); }
    } else if (m.t === 'closed') {
      if (cur) cur.e.status = 'closed';
      if (!committing) { stopBoothTimers(); booth = null; kabineLocked(); }
    } else if (m.t === 'ack') { if (ackWait) ackWait(m); }
  }

  // Die Wahl (Namen, Fotos, Einstellungen) kommt vom Hauptgerät und bleibt nur im Arbeitsspeicher.
  function importConfig(m) {
    var src = m.election;
    if (!src || !Array.isArray(src.candidates)) return;
    var e = L.newElection(src.title);
    ['id', 'mode', 'allowDouble', 'voterCount', 'groupNames', 'parityGroups'].forEach(function (k) { if (src[k] !== undefined) e[k] = src[k]; });
    e.candidates = src.candidates.map(function (c) {
      return { id: String(c.id), name: String(c.name || ''), group: Number(c.group) || 0, photo: typeof c.photo === 'string' && /^data:image\//.test(c.photo) ? c.photo : '' };
    });
    if (L.validate(e).length) return;
    cur = { e: e, t: L.newTally(), v: { id: e.id, list: [] }, remote: true };
    kab.link.send({ t: 'ready' });
    kabineLocked();
  }

  // Das Hauptgerät schaltet frei und sagt, in welcher Reihenfolge die Fotos erscheinen
  function remoteUnlock(m) {
    if (!cur || !cur.remote || booth || committing || !Array.isArray(m.pages)) return;
    var ids = {};
    cur.e.candidates.forEach(function (c) { ids[c.id] = true; });
    var ok = m.pages.length > 0 && m.pages.every(function (p) { return Array.isArray(p.order) && p.order.every(function (id) { return ids[id]; }); });
    if (!ok) return;
    stopBoothTimers(); lastVoted = false;
    booth = {
      pages: m.pages.map(function (p) { return { scope: p.scope, title: p.title, order: p.order }; }),
      page: 0, picks: [], busy: false, deadline: Date.now() + LOCK_MS, warn: false
    };
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

  // Stimmzettel an das Hauptgerät schicken und auf die Bestätigung warten
  function sendBallot(picks) {
    return new Promise(function (resolve) {
      var tm = setTimeout(function () { fin({ ok: false, msg: 'Keine Antwort vom Hauptgerät. Bitte die Lehrkraft rufen.' }); }, 15000);
      function fin(r) { if (ackWait !== fin) return; ackWait = null; clearTimeout(tm); resolve(r); }
      ackWait = fin;
      if (!kab || !kab.link.isOpen()) { fin({ ok: false, msg: 'Die Verbindung zum Hauptgerät ist unterbrochen.' }); return; }
      kab.link.send({ t: 'ballot', picks: picks });
    });
  }
  function kabPhase() {
    if (booth) return booth.warn ? 'warn' : 'voting';
    if (committing) return 'voting';
    return lastVoted ? 'voted' : 'idle';
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
    if (anyVoting()) { await info('Eine Kabine wird gerade benutzt', 'Warte, bis das Kind fertig ist, oder nimm die Freischaltung mit „Rückgängig“ zurück.'); return; }
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
    slots.forEach(function (sl) { if (sl && sl.link.isOpen()) sl.link.send({ t: 'closed' }); });   // Kabinen sperren
    resultView();
  }

  /* ---------- Wahlkabine: Freischaltung und Stimmabgabe ---------- */
  function stopBoothTimers() { clearTimeout(boothTimer); clearInterval(boothTick); boothTimer = boothTick = null; }

  // fromBoard = true: Befehl der Tafel (keine Dialoge, nur stilles Ablehnen)
  async function unlockVoter(fromBoard) {
    var e = cur.e, t = cur.t;
    if (reached(e, t.ballots)) {
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
    if (cur && cur.remote) {                       // Kabine: Hauptgerät informieren
      stopBoothTimers(); booth = null;
      if (kab && kab.link.isOpen()) kab.link.send({ t: 'timeout' });
      kabineLocked();
      return;
    }
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
          settings.speech && speechAvailable() ? h('button', { class: 'btn btn-secondary', onclick: function () { speak('Ich möchte niemanden wählen'); } }, '🔊') : null)));
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
      if (cur.remote) {                                  // Kabine: das Hauptgerät zählt
        var ack = await sendBallot(b.picks);
        if (!ack.ok) throw new Error(ack.msg || 'Die Stimme wurde nicht angenommen.');
      } else {
        var next = L.applyBallot(cur.e, cur.t, b.picks);   // wirft einen Fehler, wenn etwas nicht stimmt
        var stored = Object.assign({ id: cur.e.id }, next);
        await persistTally(stored);                        // erst speichern …
        cur.t = stored;                                    // … dann merken
      }
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
      h('p', { class: 'muted' }, limited(e) ? t.ballots + ' von ' + e.voterCount + ' Wählern haben abgestimmt.' : t.ballots + ' Stimmzettel abgegeben.'),
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

  /* ---------- Zustand melden ---------- */
  // Wahlkabine: Phase an das Hauptgerät. Hauptgerät: Laufansicht neu zeichnen.
  function pushState() {
    if (cur && cur.remote) {
      if (kab && kab.link.isOpen()) kab.link.send({ t: 'st', phase: kabPhase() });
      return;
    }
    refreshRun();
  }

  /* ---------- Start ---------- */
  async function start() {
    try {
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist();  // Speicher vor automatischem Aufräumen schützen
      await loadAll();
      // Nur die installierte App (Home-Bildschirm) startet direkt in ihrer Rolle.
      // In einem normalen Browser-Tab (z. B. am Laptop) kommt immer die Startauswahl.
      var installed = window.navigator.standalone === true || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
      if (installed && settings.role === 'kabine') kabineHome();
      else if (installed && settings.role === 'booth' && (await S.hasPin())) await boothHome();
      else startView();
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
