/*
 * db.js – lokale Speicherung in IndexedDB (nur im Browser dieses Geräts)
 * ---------------------------------------------------------------------
 * Vier getrennte "Schubladen":
 *   elections – Einstellungen und Kandidaten (mit Fotos)
 *   tallies   – NUR die Stimmenzähler (strikt getrennt vom Rest)
 *   voters    – optionale Wählerliste (wird beim Abschluss der Wahl gelöscht)
 *   meta      – Code-Hash (mit Salt), Sperrzeit nach Fehlversuchen, App-Einstellungen
 * Nichts davon verlässt das Gerät.
 */
(function (root) {
  'use strict';
  var NAME = 'klassensprecherwahl';
  var dbPromise = null;

  function open() {
    if (!dbPromise) {
      dbPromise = new Promise(function (resolve, reject) {
        var req = indexedDB.open(NAME, 2);
        req.onupgradeneeded = function () {
          var db = req.result;
          ['elections', 'tallies', 'voters', 'meta'].forEach(function (s) {
            if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
          });
        };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error); };
      });
    }
    return dbPromise;
  }

  // Führt eine Aktion aus und wartet, bis sie wirklich gesichert ist.
  function run(store, mode, action) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(store, mode);
        var result;
        var req = action(tx.objectStore(store));
        if (req) req.onsuccess = function () { result = req.result; };
        tx.oncomplete = function () { resolve(result); };
        tx.onerror = tx.onabort = function () { reject(tx.error); };
      });
    });
  }

  root.DB = {
    getAll: function (store) { return run(store, 'readonly', function (s) { return s.getAll(); }); },
    get: function (store, id) { return run(store, 'readonly', function (s) { return s.get(id); }); },
    put: function (store, obj) { return run(store, 'readwrite', function (s) { return s.put(obj); }); },
    del: function (store, id) { return run(store, 'readwrite', function (s) { return s.delete(id); }); },

    // Löscht die komplette Datenbank (für "Alles löschen"). Es bleibt kein Rest zurück.
    destroy: function () {
      return open().then(function (db) {
        db.close();
        dbPromise = null;
        return new Promise(function (resolve, reject) {
          var r = indexedDB.deleteDatabase(NAME);
          r.onsuccess = function () { resolve(); };
          r.onerror = function () { reject(r.error); };
          r.onblocked = function () { reject(new Error('Die Datenbank wird noch benutzt.')); };
        });
      });
    }
  };
})(window);
