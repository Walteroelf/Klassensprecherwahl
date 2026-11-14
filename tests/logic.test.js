// Automatische Tests für die Zähllogik. Start: "node --test tests/" (kein Zusatzpaket nötig).
const test = require('node:test');
const assert = require('node:assert');
const L = require('../js/logic.js');

// Hilfsfunktion: eine offene Wahl mit n Kandidaten (abwechselnd Gruppe 0 / 1)
function makeElection(mode, n, voters, opts) {
  const e = L.newElection('Test');
  e.mode = mode;
  e.voterCount = voters;
  e.status = 'open';
  e.unlocked = voters;          // so viele Freischaltungen wie Wähler (Standard für die Tests)
  for (let i = 0; i < n; i++) {
    e.candidates.push({ id: 'c' + i, name: 'Kind ' + i, group: i % 2, photo: '' });
  }
  Object.assign(e, opts || {});
  return e;
}
const pick = (id) => ({ candidateId: id });
const ABST = { abstain: true };

test('Modus "Eine Stimme": zählt eine Stimme und eine Enthaltung', () => {
  const e = makeElection('single', 6, 5);
  let t = L.newTally();
  t = L.applyBallot(e, t, [pick('c1')]);
  t = L.applyBallot(e, t, [pick('c1')]);
  t = L.applyBallot(e, t, [ABST]);
  assert.strictEqual(t.counts.c1, 2);
  assert.strictEqual(t.abstain.all, 1);
  assert.strictEqual(t.ballots, 3);
  assert.deepStrictEqual(L.checkConsistency({ ...e, unlocked: 3 }, t), []);
});

test('Modus "Eine Stimme": falsche Stimmenzahl oder fremder Kandidat wird abgelehnt', () => {
  const e = makeElection('single', 3, 5);
  const t = L.newTally();
  assert.throws(() => L.applyBallot(e, t, [pick('c0'), pick('c1')]));
  assert.throws(() => L.applyBallot(e, t, [pick('gibtsnicht')]));
  assert.throws(() => L.applyBallot(e, t, []));
});

test('Modus "Zwei Stimmen" mit Doppelwahl erlaubt', () => {
  const e = makeElection('two', 4, 3, { allowDouble: true });
  const t = L.applyBallot(e, L.newTally(), [pick('c2'), pick('c2')]);
  assert.strictEqual(t.counts.c2, 2);
  assert.strictEqual(t.ballots, 1);
});

test('Modus "Zwei Stimmen" ohne Doppelwahl: dieselbe Person wird abgelehnt', () => {
  const e = makeElection('two', 4, 3, { allowDouble: false });
  const t0 = L.newTally();
  assert.throws(() => L.applyBallot(e, t0, [pick('c2'), pick('c2')]));
  // zwei Enthaltungen oder Enthaltung + Person sind erlaubt
  let t = L.applyBallot(e, t0, [ABST, ABST]);
  assert.strictEqual(t.abstain.all, 2);
  t = L.applyBallot(e, t, [pick('c1'), ABST]);
  assert.strictEqual(t.counts.c1, 1);
});

test('Gruppenmodus: je Seite eine Person, getrennte Auszählung', () => {
  const e = makeElection('group', 6, 4);   // c0,c2,c4 = Gruppe 0; c1,c3,c5 = Gruppe 1
  let t = L.applyBallot(e, L.newTally(), [pick('c0'), pick('c1')]);
  t = L.applyBallot(e, t, [pick('c0'), ABST]);
  // Person aus der falschen Gruppe auf einer Seite ist ungültig
  assert.throws(() => L.applyBallot(e, t, [pick('c1'), pick('c0')]));
  const res = L.computeResults(e, t);
  assert.strictEqual(res.length, 2);
  assert.strictEqual(res[0].scope, '0');
  assert.strictEqual(res[0].rows[0].candidate.id, 'c0');
  assert.strictEqual(res[0].rows[0].votes, 2);
  assert.strictEqual(res[1].rows[0].candidate.id, 'c1');
  assert.strictEqual(res[1].abstentions, 1);
  assert.strictEqual(res[0].rows.length, 3);   // nur Gruppe 0 in der ersten Liste
});

test('Es werden nie mehr Stimmzettel angenommen als Wähler eingetragen sind', () => {
  const e = makeElection('single', 3, 2);
  let t = L.newTally();
  t = L.applyBallot(e, t, [pick('c0')]);
  t = L.applyBallot(e, t, [pick('c1')]);
  assert.throws(() => L.applyBallot(e, t, [pick('c0')]), /alle Stimmen/);
  assert.strictEqual(t.ballots, 2);
});

test('Ohne Wählerzahl (0 = unbekannt) gibt es keine Obergrenze, die Freischaltung begrenzt weiter', () => {
  const e = makeElection('single', 3, 0);
  e.unlocked = 0;
  assert.deepStrictEqual(L.validate(e), []);
  let t = L.newTally();
  for (let i = 0; i < 30; i++) { e.unlocked++; t = L.applyBallot(e, t, [pick('c0')]); }
  assert.strictEqual(t.ballots, 30);
  assert.throws(() => L.applyBallot(e, t, [pick('c0')]), /nicht freigeschaltet/);
  assert.deepStrictEqual(L.checkConsistency(e, t), []);
  e.voterCount = -1;
  assert.ok(L.validate(e).length >= 1);
});

test('Pro Freischaltung wird genau ein Stimmzettel angenommen', () => {
  const e = makeElection('single', 3, 5, { unlocked: 1 });
  let t = L.applyBallot(e, L.newTally(), [pick('c0')]);          // 1 Freischaltung → 1 Stimmzettel
  assert.throws(() => L.applyBallot(e, t, [pick('c1')]), /nicht freigeschaltet/);
  e.unlocked = 2;                                                  // neue Freischaltung → wieder möglich
  t = L.applyBallot(e, t, [pick('c1')]);
  assert.strictEqual(t.ballots, 2);
  assert.throws(() => L.applyBallot({ ...e, unlocked: 0 }, L.newTally(), [pick('c0')]), /nicht freigeschaltet/);
});

test('Bei geschlossener oder noch nicht geöffneter Wahl werden keine Stimmen angenommen', () => {
  const e = makeElection('single', 3, 2, { status: 'closed' });
  assert.throws(() => L.applyBallot(e, L.newTally(), [pick('c0')]));
  e.status = 'setup';
  assert.throws(() => L.applyBallot(e, L.newTally(), [pick('c0')]));
});

test('Ein Fehler verändert den Stimmenstand nicht', () => {
  const e = makeElection('two', 3, 5);
  const t = L.applyBallot(e, L.newTally(), [pick('c0'), pick('c1')]);
  const before = JSON.stringify(t);
  assert.throws(() => L.applyBallot(e, t, [pick('c0'), pick('c0')]));
  assert.strictEqual(JSON.stringify(t), before);
});

test('Wahlgeheimnis: der Stand enthält nur Zähler, keine Einzelstimmzettel', () => {
  const e = makeElection('single', 3, 5);
  const t = L.applyBallot(e, L.newTally(), [pick('c0')]);
  assert.deepStrictEqual(Object.keys(t).sort(), ['abstain', 'ballots', 'counts']);
  assert.ok(!/time|date|stamp|order/i.test(JSON.stringify(t)));
});

test('Ergebnis: Rangfolge mit Gleichstand (1, 1, 3)', () => {
  const e = makeElection('single', 3, 10);
  let t = L.newTally();
  [['c0'], ['c0'], ['c1'], ['c1'], ['c2']].forEach((p) => { t = L.applyBallot(e, t, [pick(p[0])]); });
  const r = L.computeResults(e, t)[0];
  assert.deepStrictEqual(r.rows.map((x) => x.rank), [1, 1, 3]);
  assert.strictEqual(r.totalVotes, 5);
});

test('Prüfung beim Abschluss warnt bei unpassenden Zahlen', () => {
  const e = makeElection('single', 3, 5, { unlocked: 4 });
  const t = L.applyBallot(e, L.newTally(), [pick('c0')]);
  assert.strictEqual(L.checkConsistency(e, t).length, 1);   // 4 Freischaltungen, 1 Stimmzettel
  const bad = { counts: { c0: 3 }, abstain: {}, ballots: 1 };
  assert.ok(L.checkConsistency({ ...e, unlocked: 1 }, bad).length >= 1);
});

test('Einstellungen werden geprüft', () => {
  const e = L.newElection('X');
  assert.ok(L.validate(e).length >= 1);               // keine Kandidaten
  const ok = makeElection('single', 6, 20);
  assert.deepStrictEqual(L.validate(ok), []);
  const g = makeElection('group', 6, 20);
  assert.deepStrictEqual(L.validate(g), []);
  g.parityGroups = [0, 0];
  assert.ok(L.validate(g).length >= 1);
  g.parityGroups = [0, 2];                              // Gruppe 2 hat keine Kandidaten
  assert.ok(L.validate(g).length >= 1);
});

// Hilfsfunktion: Wahl mit vorgegebenen Stimmen je Kandidat auszählen
function tallyOf(e, votesById) {
  const t = L.newTally();
  t.counts = { ...votesById };
  return t;
}

test('Gleichstand: findet punktgleiche Kandidaten, ignoriert Plätze ohne Stimmen', () => {
  const e = makeElection('single', 5, 20);
  const res = L.computeResults(e, tallyOf(e, { c0: 4, c1: 4, c2: 2, c3: 2, c4: 0 }));
  const ties = L.findTies(res);
  assert.strictEqual(ties.length, 2);                                     // Platz 1 (c0,c1) und Platz 3 (c2,c3)
  assert.deepStrictEqual(ties.map((t) => t.rank), [1, 3]);
  assert.deepStrictEqual(ties[0].rows.map((r) => r.candidate.id).sort(), ['c0', 'c1']);
  const clear = L.computeResults(e, tallyOf(e, { c0: 5, c1: 3, c2: 1, c3: 0, c4: 0 }));
  assert.strictEqual(L.findTies(clear).length, 0);                        // 0 : 0 zählt nicht
});

test('Gleichstand im Gruppenmodus wird je Gruppe einzeln behandelt', () => {
  const e = makeElection('group', 6, 20);   // Gruppe 0: c0,c2,c4  Gruppe 1: c1,c3,c5
  const res = L.computeResults(e, tallyOf(e, { c0: 3, c2: 3, c4: 1, c1: 5, c3: 2, c5: 1 }));
  const ties = L.findTies(res);
  assert.strictEqual(ties.length, 1);
  assert.strictEqual(ties[0].scope, '0');
  assert.strictEqual(ties[0].title, 'Mädchen');
});

test('Stichwahl: nur die punktgleichen Kandidaten, gleiche Schutzregeln', () => {
  const e = makeElection('two', 5, 4);
  const res = L.computeResults(e, tallyOf(e, { c0: 3, c1: 3, c2: 1 }));
  const tie = L.findTies(res)[0];
  const r = L.makeRunoff(e, tie);
  assert.strictEqual(r.mode, 'single');
  assert.strictEqual(r.voterCount, 4);
  assert.deepStrictEqual(r.candidates.map((c) => c.id).sort(), ['c0', 'c1']);
  assert.strictEqual(r.status, 'setup');
  assert.deepStrictEqual(L.validate(r), []);
  assert.notStrictEqual(r.id, e.id);
  // Die Stichwahl zählt getrennt, höchstens so viele Stimmzettel wie Wähler, und jeweils mit Freischaltung
  r.status = 'open';
  let t = L.newTally();
  for (let i = 0; i < 4; i++) { r.unlocked = i + 1; t = L.applyBallot(r, t, [pick(i % 2 ? 'c0' : 'c1')]); }
  r.unlocked = 5;
  assert.throws(() => L.applyBallot(r, t, [pick('c0')]), /alle Stimmen/);
  assert.throws(() => L.applyBallot({ ...r, unlocked: 4 }, L.newTally(), [pick('c2')]));   // Nicht-Kandidat
  assert.strictEqual(L.runoffKey(tie), L.runoffKey(L.findTies(res)[0]));
});

test('Countdown: Plätze werden von hinten nach vorn enthüllt, je Gruppe', () => {
  const e = makeElection('group', 6, 20);
  const res = L.computeResults(e, tallyOf(e, { c0: 3, c2: 2, c4: 1, c1: 5, c3: 2, c5: 1 }));
  const seq = L.revealOrder(res);
  assert.strictEqual(seq.length, 6);
  assert.deepStrictEqual(seq.slice(0, 3), [[0, 2], [0, 1], [0, 0]]);
  assert.deepStrictEqual(seq.slice(3), [[1, 2], [1, 1], [1, 0]]);
});

test('Mischen: gleiche Elemente, Original unverändert, Reihenfolge variiert', () => {
  const list = ['a', 'b', 'c', 'd', 'e', 'f'];
  const s = L.shuffle(list);
  assert.deepStrictEqual(s.slice().sort(), list);
  assert.deepStrictEqual(list, ['a', 'b', 'c', 'd', 'e', 'f']);
  const variants = new Set();
  for (let i = 0; i < 50; i++) variants.add(L.shuffle(list).join(''));
  assert.ok(variants.size > 1);
});
