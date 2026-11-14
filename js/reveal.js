/*
 * reveal.js – Ergebnis-Countdown
 * ------------------------------
 * Zeigt die Ergebnisse spannend an: Die Plätze werden von hinten nach vorn enthüllt, jeweils per
 * Tippen auf "Weiter". Der zuletzt enthüllte Platz steht groß OBEN im Bild, die früheren darunter,
 * der Weiter-Knopf bleibt am unteren Rand sichtbar. So muss nie gescrollt werden.
 * Mit "Alle sofort zeigen" lässt sich der Countdown überspringen.
 * results = [{ title, abstentions (oder null = nicht zeigen), rows: [{ name, votes, rank, photo? }] }]
 * opts.footer() liefert zusätzliche Inhalte, die erst am Ende erscheinen (z. B. Hinweis auf Gleichstand).
 */
(function (root) {
  'use strict';
  var h = Dom.h;

  function create(results, heading, opts) {
    opts = opts || {};
    // Reihenfolge der Enthüllung: je Bereich von hinten nach vorn
    var seq = [];
    results.forEach(function (r, b) { for (var i = r.rows.length - 1; i >= 0; i--) seq.push({ b: b, i: i }); });
    var shown = 0;
    var wrap = h('div', { class: 'reveal' });

    function photo(row, big) {
      var cls = 'photo' + (big ? ' photo-big' : '');
      if (row.photo) return h('img', { class: cls, src: row.photo, alt: row.name });
      return h('div', { class: cls + ' photo-ph' }, row.name.charAt(0).toUpperCase());
    }
    function groupTag(r) { return r.title ? h('div', { class: 'gtag' }, 'Gruppe ' + r.title) : null; }
    function plural(n) { return n + (n === 1 ? ' Stimme' : ' Stimmen'); }

    function render() {
      var done = shown >= seq.length;
      var body;
      if (shown === 0) {
        body = h('div', { class: 'stage wait' }, h('div', { class: 'big' }, '🥁'), h('h2', {}, 'Bereit?'),
          h('p', {}, 'Tippe unten auf „Weiter“. Es wird immer der nächste Platz aufgedeckt.'));
      } else if (!done) {
        var cur = seq[shown - 1], r = results[cur.b], row = r.rows[cur.i];
        var earlier = seq.slice(0, shown - 1).reverse();
        body = [
          h('div', { class: 'stage reveal-in' + (row.rank === 1 && row.votes > 0 ? ' win' : '') },
            groupTag(r), h('div', { class: 'place' }, 'Platz ' + row.rank), photo(row, true),
            h('div', { class: 'sname' }, row.name), h('div', { class: 'svotes' }, plural(row.votes))),
          earlier.length ? h('div', { class: 'card earlier' }, earlier.map(function (e) {
            var rr = results[e.b], x = rr.rows[e.i];
            return h('div', { class: 'res-row' }, h('div', { class: 'rank' }, x.rank + '.'), photo(x),
              h('div', { class: 'rname' }, x.name, rr.title ? h('div', { class: 'small' }, 'Gruppe ' + rr.title) : null),
              h('div', { class: 'votes' }, String(x.votes)));
          })) : null
        ];
      } else {
        // Alles enthüllt: die vollständige Rangliste
        body = [results.map(function (r) {
          return h('div', { class: 'card' },
            r.title ? h('h2', {}, 'Gruppe ' + r.title) : null,
            r.rows.map(function (row) {
              return h('div', { class: 'res-row reveal-in' + (row.rank === 1 && row.votes > 0 ? ' win' : '') },
                h('div', { class: 'rank' }, row.rank + '.'), photo(row),
                h('div', { class: 'rname' }, row.name), h('div', { class: 'votes' }, String(row.votes)));
            }),
            r.abstentions != null ? h('div', { class: 'res-row' },
              h('div', { class: 'rank' }, '–'), h('div', { class: 'rname' }, 'Enthaltungen'), h('div', { class: 'votes' }, String(r.abstentions))) : null);
        }), opts.footer ? opts.footer() : null];
      }
      var bar = done ? null : h('div', { class: 'reveal-bar' },
        h('button', { class: 'btn btn-big btn-green', onclick: function () { shown++; render(); window.scrollTo(0, 0); } }, 'Weiter ▶'),
        h('button', { class: 'btn btn-secondary', onclick: function () { shown = seq.length; render(); window.scrollTo(0, 0); } }, 'Alle sofort zeigen'));
      Dom.mount(wrap, heading, body, bar);
    }
    render();
    return wrap;
  }

  root.Reveal = { create: create };
})(window);
