/*
 * dom.js – winzige Hilfe zum Bauen von Bildschirmelementen (für App und Tafel).
 * Texte werden immer als Text eingefügt, nie als HTML. So kann nichts eingeschleust werden.
 */
(function (root) {
  'use strict';

  // h('button', { class: 'btn', onclick: fn }, 'Text', weitereKinder …)
  function h(tag, props) {
    var el = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) {
      var v = props[k];
      if (v === false || v == null) return;
      if (k === 'class') el.className = v;
      else if (k.indexOf('on') === 0) el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    });
    add(el, Array.prototype.slice.call(arguments, 2));
    return el;
  }

  function add(el, kids) {
    kids.forEach(function (kid) {
      if (kid == null || kid === false) return;
      if (Array.isArray(kid)) add(el, kid);
      else el.append(kid.nodeType ? kid : document.createTextNode(kid));
    });
  }

  // Ersetzt den Inhalt eines Elements (Listen werden aufgelöst)
  function mount(el) {
    var tmp = document.createDocumentFragment();
    add(tmp, Array.prototype.slice.call(arguments, 1));
    el.replaceChildren(tmp);
  }

  root.Dom = { h: h, mount: mount };
})(window);
