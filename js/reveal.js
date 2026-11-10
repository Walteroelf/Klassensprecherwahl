/*
 * reveal.js – Ergebnis-Countdown
 * ------------------------------
 * Zeigt die Ergebnisse spannend an: Die Plätze werden von hinten nach vorn enthüllt,
 * jeweils per Tippen auf "Weiter". Mit "Alle sofort zeigen" lässt sich der Countdown überspringen.
 * Genutzt auf der Tafel und (mit Fotos) auf dem iPad.
 * results = [{ title, abstentions, rows: [{ name, votes, rank, photo? }] }]
 */
(function (root) {
  'use strict';
  var h = Dom.h;

  function create(results, heading) {
    // Reihenfolge der Enthüllung: je Bereich von hinten nach vorn
    var seq = [];
    results.forEach(function (r, b) { for (var i = r.rows.length - 1; i >= 0; i--) seq.push(b + '-' + i); });
    var shown = 0;
    var wrap = h('div', { class: 'reveal' });

    function photo(row) {
      if (row.photo) return h('img', { class: 'photo', src: row.photo, alt: row.name });
      return h('div', { class: 'photo photo-ph' }, row.name.charAt(0).toUpperCase());
    }

    function render() {
      var open = {};
      seq.slice(0, shown).forEach(function (k) { open[k] = true; });
      var cards = results.map(function (r, b) {
        var done = r.rows.every(function (_, i) { return open[b + '-' + i]; });
        return h('div', { class: 'card' },
          r.title ? h('h2', {}, 'Gruppe ' + r.title) : null,
          r.rows.map(function (row, i) {
            if (!open[b + '-' + i]) {
              return h('div', { class: 'res-row hidden-row' },
                h('div', { class: 'rank' }, row.rank + '.'), h('div', { class: 'rname' }, '???'), h('div', { class: 'votes' }, '?'));
            }
            return h('div', { class: 'res-row reveal-in' + (row.rank === 1 && row.votes > 0 ? ' win' : '') },
              h('div', { class: 'rank' }, row.rank + '.'), photo(row),
              h('div', { class: 'rname' }, row.name), h('div', { class: 'votes' }, String(row.votes)));
          }),
          done ? h('div', { class: 'res-row' },
            h('div', { class: 'rank' }, '–'), h('div', { class: 'rname' }, 'Enthaltungen'), h('div', { class: 'votes' }, String(r.abstentions))) : null);
      });
      var controls = shown < seq.length ?
        h('div', { class: 'row board-buttons' },
          h('button', { class: 'btn btn-big btn-green', onclick: function () { shown++; render(); } }, 'Weiter ▶'),
          h('button', { class: 'btn btn-secondary', onclick: function () { shown = seq.length; render(); } }, 'Alle sofort zeigen')) :
        h('p', { class: 'muted', style: null }, 'Alle Plätze sind enthüllt.');
      Dom.mount(wrap, heading, cards, controls);
    }
    render();
    return wrap;
  }

  root.Reveal = { create: create };
})(window);
