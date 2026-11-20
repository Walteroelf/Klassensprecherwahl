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

  // Zeichen, die als Linien-Symbol aus dem Sprite in index.html erscheinen (statt Emoji)
  var ICONS = {
    '\u{1F5F3}': 'urne', '\u{1F4D6}': 'buch', '\u2190': 'pfeil-links', '\u2699': 'zahnrad', '\u{1F393}': 'hut',
    '\u{1F527}': 'schluessel', '\u{1F5BC}': 'bild', '\u{1F4F8}': 'kamera', '\u{1F4F7}': 'kamera', '\u{1F504}': 'wechseln',
    '\u2713': 'haken', '\u2705': 'haken', '\u26A0': 'warnung', '\u21A9': 'zurueck', '\u{1F4F2}': 'telefon',
    '\u{1F50A}': 'lautsprecher', '\u{1F3C6}': 'pokal', '\u{1F389}': 'stern', '\u{1F4C4}': 'dokument', '\u2197': 'teilen',
    '\u{1F441}': 'auge', '\u{1F440}': 'auge', '\u23F3': 'sanduhr', '\u{1F941}': 'stern', '\u{1F512}': 'schloss',
    '\u26F6': 'vollbild', '\u232B': 'ruecktaste', '\u25B6': 'pfeil-rechts'
  };
  var ICON_RE = /(\u{1F5F3}|\u{1F4D6}|\u2190|\u2699|\u{1F393}|\u{1F527}|\u{1F5BC}|\u{1F4F8}|\u{1F4F7}|\u{1F504}|\u2713|\u2705|\u26A0|\u21A9|\u{1F4F2}|\u{1F50A}|\u{1F3C6}|\u{1F389}|\u{1F4C4}|\u2197|\u{1F441}|\u{1F440}|\u23F3|\u{1F941}|\u{1F512}|\u26F6|\u232B|\u25B6)\uFE0F?/gu;

  function ico(name) {
    var NS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'symbol');
    svg.setAttribute('aria-hidden', 'true');
    var use = document.createElementNS(NS, 'use');
    use.setAttribute('href', '#i-' + name);
    svg.appendChild(use);
    return svg;
  }

  // Text einfügen; Emoji und Pfeile werden dabei zu Symbolen
  function text(el, str) {
    str = String(str);
    var last = 0, m;
    ICON_RE.lastIndex = 0;
    while ((m = ICON_RE.exec(str))) {
      if (m.index > last) el.append(document.createTextNode(str.slice(last, m.index)));
      el.append(ico(ICONS[m[1]]));
      last = m.index + m[0].length;
    }
    if (last < str.length) el.append(document.createTextNode(str.slice(last)));
  }

  function add(el, kids) {
    kids.forEach(function (kid) {
      if (kid == null || kid === false) return;
      if (Array.isArray(kid)) add(el, kid);
      else if (kid.nodeType) el.append(kid);
      else text(el, kid);
    });
  }

  // Ersetzt den Inhalt eines Elements (Listen werden aufgelöst)
  function mount(el) {
    var tmp = document.createDocumentFragment();
    add(tmp, Array.prototype.slice.call(arguments, 1));
    el.replaceChildren(tmp);
  }

  root.Dom = { h: h, mount: mount, ico: ico };
})(window);
