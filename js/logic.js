/*
 * logic.js – Zähllogik der Klassensprecherwahl
 * ---------------------------------------------
 * Diese Datei kennt keine Oberfläche und keinen Speicher. Sie ist reine
 * Rechenlogik und läuft deshalb im Browser UND in den automatischen Tests.
 *
 * WAHLGEHEIMNIS: Eine Stimme wird nur als Zähler erhöht
 * (tally.counts[kandidatId] bzw. tally.abstain[bereich]).
 * Es gibt keine Liste einzelner Stimmzettel, keinen Zeitstempel und keine
 * Reihenfolge. Aus dem gespeicherten Stand lässt sich nie ablesen, wer was
 * gewählt hat.
 */
(function (root) {
  'use strict';

  var MODES = { SINGLE: 'single', TWO: 'two', GROUP: 'group' };

  function uid() {
    return 'id' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  /** Neue, leere Wahl (nur Einstellungen, ohne Stimmen). */
  function newElection(title) {
    return {
      id: uid(),
      title: title || 'Klassensprecherwahl',
      mode: MODES.SINGLE,
      allowDouble: false,          // Modus "zwei Stimmen": dieselbe Person zweimal erlaubt?
      voterCount: 0,               // Anzahl Wähler (Obergrenze für Stimmzettel)
      groupNames: ['Mädchen', 'Jungen', 'Gruppe 3'],
      parityGroups: [0, 1],        // Welche zwei Gruppen im Gruppenmodus gewählt werden
      candidates: [],              // { id, name, group (0..2), photo (Data-URL) }
      status: 'setup',             // 'setup' | 'open' | 'closed'
      unlocked: 0                  // Wie oft wurde die Kabine freigeschaltet (nur eine Zahl)
    };
  }

  /** Leerer Stimmenstand. */
  function newTally() {
    return { counts: {}, abstain: {}, ballots: 0 };
  }

  /**
   * Die "Seiten" der Wahlkabine. Jede Seite = genau eine Stimme.
   * scope = Auszählbereich ('all' oder Gruppennummer als Text).
   */
  function pages(e) {
    var all = e.candidates.map(function (c) { return c.id; });
    if (e.mode === MODES.SINGLE) {
      return [{ scope: 'all', title: null, candidateIds: all }];
    }
    if (e.mode === MODES.TWO) {
      return [
        { scope: 'all', title: null, candidateIds: all },
        { scope: 'all', title: null, candidateIds: all }
      ];
    }
    return e.parityGroups.map(function (g) {
      return {
        scope: String(g),
        title: e.groupNames[g],
        candidateIds: e.candidates.filter(function (c) { return c.group === g; })
          .map(function (c) { return c.id; })
      };
    });
  }

  /** Prüft die Einstellungen. Liefert eine Liste von Fehlertexten (leer = ok). */
  function validate(e) {
    var errs = [];
    if (!e.title || !e.title.trim()) errs.push('Die Wahl braucht einen Titel.');
    if (!Number.isInteger(e.voterCount) || e.voterCount < 1) {
      errs.push('Bitte die Anzahl der Wähler eintragen (mindestens 1).');
    }
    e.candidates.forEach(function (c) {
      if (!c.name || !c.name.trim()) errs.push('Ein Kandidat hat keinen Namen.');
    });
    if (e.mode === MODES.GROUP) {
      if (e.parityGroups[0] === e.parityGroups[1]) {
        errs.push('Bitte zwei verschiedene Gruppen auswählen.');
      } else {
        pages(e).forEach(function (p) {
          if (p.candidateIds.length < 2) {
            errs.push('In der Gruppe „' + p.title + '“ werden mindestens 2 Kandidaten gebraucht.');
          }
        });
      }
    } else if (e.candidates.length < 2) {
      errs.push('Bitte mindestens 2 Kandidaten anlegen.');
    }
    return errs;
  }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  /**
   * Nimmt EINEN kompletten Stimmzettel an und liefert den neuen Stimmenstand.
   * picks = ein Eintrag je Seite: { candidateId } oder { abstain: true }.
   * Bei jedem Fehler wird eine Exception geworfen und NICHTS verändert.
   */
  function applyBallot(e, tally, picks) {
    if (e.status !== 'open') throw new Error('Die Wahl ist nicht geöffnet.');
    if (tally.ballots >= e.voterCount) {
      throw new Error('Es sind bereits alle Stimmen abgegeben.');
    }
    // Pro Freischaltung genau ein Stimmzettel: ohne offene Freischaltung wird nichts angenommen.
    if ((e.unlocked || 0) <= tally.ballots) {
      throw new Error('Die Wahlkabine war nicht freigeschaltet.');
    }
    var ps = pages(e);
    if (!Array.isArray(picks) || picks.length !== ps.length) {
      throw new Error('Falsche Anzahl an Stimmen.');
    }
    picks.forEach(function (pick, i) {
      if (pick && pick.abstain === true) return;
      if (!pick || ps[i].candidateIds.indexOf(pick.candidateId) === -1) {
        throw new Error('Ungültige Stimme.');
      }
    });
    if (e.mode === MODES.TWO && !e.allowDouble &&
        picks[0].candidateId && picks[0].candidateId === picks[1].candidateId) {
      throw new Error('Dieselbe Person darf nicht zweimal gewählt werden.');
    }
    var next = clone(tally);
    picks.forEach(function (pick, i) {
      if (pick.abstain === true) {
        next.abstain[ps[i].scope] = (next.abstain[ps[i].scope] || 0) + 1;
      } else {
        next.counts[pick.candidateId] = (next.counts[pick.candidateId] || 0) + 1;
      }
    });
    next.ballots += 1;
    return next;
  }

  /**
   * Ergebnis: je Auszählbereich eine Rangliste mit Plätzen (Gleichstand = gleicher Platz,
   * z. B. 1, 1, 3) und die Enthaltungen.
   */
  function computeResults(e, tally) {
    var seen = {};
    var result = [];
    pages(e).forEach(function (p) {
      if (seen[p.scope]) return;
      seen[p.scope] = true;
      var rows = p.candidateIds.map(function (id) {
        var cand = e.candidates.filter(function (c) { return c.id === id; })[0];
        return { candidate: cand, votes: tally.counts[id] || 0, rank: 0 };
      });
      rows.sort(function (a, b) {
        return b.votes - a.votes || a.candidate.name.localeCompare(b.candidate.name, 'de');
      });
      rows.forEach(function (r, i) {
        r.rank = (i > 0 && rows[i - 1].votes === r.votes) ? rows[i - 1].rank : i + 1;
      });
      var abstentions = tally.abstain[p.scope] || 0;
      var sum = rows.reduce(function (s, r) { return s + r.votes; }, abstentions);
      result.push({
        scope: p.scope,
        title: e.mode === MODES.GROUP ? p.title : null,
        rows: rows,
        abstentions: abstentions,
        totalVotes: sum
      });
    });
    return result;
  }

  /** Plausibilitätsprüfung beim Abschluss. Liefert Warntexte (leer = alles stimmig). */
  function checkConsistency(e, tally) {
    var msgs = [];
    var perBallot = pages(e).length;
    var votes = 0;
    Object.keys(tally.counts).forEach(function (k) { votes += tally.counts[k]; });
    Object.keys(tally.abstain).forEach(function (k) { votes += tally.abstain[k]; });
    if (votes !== tally.ballots * perBallot) {
      msgs.push('Die Zahl der gezählten Stimmen (' + votes + ') passt nicht zur Zahl der Stimmzettel (' +
        tally.ballots + ' × ' + perBallot + ').');
    }
    if (tally.ballots > e.voterCount) {
      msgs.push('Es wurden mehr Stimmzettel abgegeben als Wähler eingetragen sind.');
    }
    if ((e.unlocked || 0) !== tally.ballots) {
      msgs.push('Die Kabine wurde ' + (e.unlocked || 0) + '-mal freigeschaltet, aber es wurden ' +
        tally.ballots + ' Stimmzettel abgegeben.');
    }
    return msgs;
  }

  /** Zufallszahl 0..n-1 aus dem sicheren Zufallsgenerator des Geräts. */
  function randomInt(n) {
    var c = root.crypto || (typeof require === 'function' ? require('crypto').webcrypto : null);
    if (c && c.getRandomValues) {
      var max = Math.floor(4294967296 / n) * n, x;
      var buf = new Uint32Array(1);
      do { c.getRandomValues(buf); x = buf[0]; } while (x >= max);
      return x % n;
    }
    return Math.floor(Math.random() * n);
  }

  /** Neue zufällige Reihenfolge (Fisher-Yates). Das Original bleibt unverändert. */
  function shuffle(list, rnd) {
    var a = list.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = rnd ? Math.floor(rnd() * (i + 1)) : randomInt(i + 1);
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /**
   * Gleichstände: Kandidaten mit gleichem Platz und mindestens einer Stimme.
   * Jeder Bereich (z. B. jede Gruppe) und jeder Platz wird einzeln behandelt.
   * Liefert eine Liste von { scope, title, rank, rows }.
   */
  function findTies(results) {
    var out = [];
    results.forEach(function (r) {
      var byRank = {};
      r.rows.forEach(function (row) {
        if (row.votes > 0) (byRank[row.rank] = byRank[row.rank] || []).push(row);
      });
      Object.keys(byRank).forEach(function (k) {
        if (byRank[k].length > 1) out.push({ scope: r.scope, title: r.title, rank: Number(k), rows: byRank[k] });
      });
    });
    return out;
  }

  /** Eindeutiger Schlüssel eines Gleichstands (damit keine Stichwahl doppelt angelegt wird). */
  function runoffKey(tie) {
    return tie.scope + ':' + tie.rows.map(function (r) { return r.candidate.id; }).sort().join(',');
  }

  /**
   * Stichwahl: eine neue, eigene Wahl nur mit den punktgleichen Kandidaten.
   * Eine Stimme pro Wähler, gleiche Wählerzahl, eigener Stimmenstand – es gelten
   * dieselben Schutzregeln wie in der Hauptwahl.
   */
  function makeRunoff(parent, tie) {
    var e = newElection('Stichwahl – ' + parent.title + (tie.title ? ' – ' + tie.title : '') + ' (Platz ' + tie.rank + ')');
    e.mode = MODES.SINGLE;
    e.voterCount = parent.voterCount;
    e.groupNames = parent.groupNames.slice();
    e.candidates = tie.rows.map(function (r) { return clone(r.candidate); });
    e.runoffOf = { id: parent.id, key: runoffKey(tie) };
    return e;
  }

  /** Reihenfolge der Enthüllung beim Countdown: je Bereich von hinten nach vorn. */
  function revealOrder(results) {
    var seq = [];
    results.forEach(function (r, b) {
      for (var i = r.rows.length - 1; i >= 0; i--) seq.push([b, i]);
    });
    return seq;
  }

  var api = {
    MODES: MODES, uid: uid, newElection: newElection, newTally: newTally,
    pages: pages, validate: validate, applyBallot: applyBallot,
    computeResults: computeResults, checkConsistency: checkConsistency, shuffle: shuffle,
    findTies: findTies, runoffKey: runoffKey, makeRunoff: makeRunoff, revealOrder: revealOrder
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Logic = api;
})(typeof window !== 'undefined' ? window : globalThis);
