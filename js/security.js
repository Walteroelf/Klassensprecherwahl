/*
 * security.js – sechsstelliger Code der Lehrkraft
 * -----------------------------------------------
 * - Der Code wird NIE im Klartext gespeichert, sondern nur als Hash (PBKDF2-SHA-256)
 *   zusammen mit einem zufälligen Salt.
 * - Nach mehreren Fehlversuchen sperrt die Eingabe, und die Sperrzeit steigt:
 *   ab dem 3. Fehlversuch 1, 2, 4, 8 … Minuten (höchstens 30 Minuten).
 * - Die Sperre wird gespeichert und überlebt deshalb ein Neuladen der Seite.
 */
(function (root) {
  'use strict';
  var ITERATIONS = 150000;
  var FREE_TRIES = 2;            // so viele Fehlversuche ohne Sperre
  var MAX_LOCK_MIN = 30;

  function toB64(bytes) {
    var s = '';
    bytes.forEach(function (b) { s += String.fromCharCode(b); });
    return btoa(s);
  }
  function fromB64(t) {
    var s = atob(t), b = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
    return b;
  }

  async function derive(code, salt) {
    if (!root.crypto || !root.crypto.subtle) {
      throw new Error('Die Sicherheitsfunktionen des Browsers fehlen. Bitte die App über https öffnen.');
    }
    var key = await crypto.subtle.importKey('raw', new TextEncoder().encode(code), 'PBKDF2', false, ['deriveBits']);
    var bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: salt, iterations: ITERATIONS, hash: 'SHA-256' }, key, 256);
    return new Uint8Array(bits);
  }

  // Vergleich, der immer gleich lange dauert
  function same(a, b) {
    if (a.length !== b.length) return false;
    var d = 0;
    for (var i = 0; i < a.length; i++) d |= a[i] ^ b[i];
    return d === 0;
  }

  async function hasPin() { return !!(await DB.get('meta', 'pin')); }

  async function setPin(code) {
    if (!/^\d{6}$/.test(code)) throw new Error('Der Code muss aus 6 Ziffern bestehen.');
    var salt = crypto.getRandomValues(new Uint8Array(16));
    var hash = await derive(code, salt);
    await DB.put('meta', { id: 'pin', salt: toB64(Array.from(salt)), hash: toB64(Array.from(hash)), iter: ITERATIONS });
    await DB.put('meta', { id: 'lock', fails: 0, until: 0 });
  }

  // Wie viele Millisekunden die Eingabe noch gesperrt ist (0 = frei)
  async function lockRemaining() {
    var l = await DB.get('meta', 'lock');
    return l ? Math.max(0, l.until - Date.now()) : 0;
  }

  // Prüft einen Code. Ergebnis: { ok } oder { ok:false, lockedMs }
  async function check(code) {
    var left = await lockRemaining();
    if (left > 0) return { ok: false, lockedMs: left };
    var rec = await DB.get('meta', 'pin');
    if (!rec) return { ok: false };
    var hash = await derive(code, fromB64(rec.salt));
    var lock = (await DB.get('meta', 'lock')) || { id: 'lock', fails: 0, until: 0 };
    if (same(hash, fromB64(rec.hash))) {
      lock.fails = 0; lock.until = 0;
      await DB.put('meta', lock);
      return { ok: true };
    }
    lock.fails += 1;
    var lockedMs = 0;
    if (lock.fails > FREE_TRIES) {
      var minutes = Math.min(MAX_LOCK_MIN, Math.pow(2, lock.fails - FREE_TRIES - 1));
      lockedMs = minutes * 60000;
      lock.until = Date.now() + lockedMs;
    }
    await DB.put('meta', lock);
    return { ok: false, lockedMs: lockedMs };
  }

  root.Security = { hasPin: hasPin, setPin: setPin, check: check, lockRemaining: lockRemaining };
})(window);
