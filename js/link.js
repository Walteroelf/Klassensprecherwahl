/*
 * link.js – direkte Verbindung zwischen iPad und Tafel (WebRTC, ohne Server)
 * --------------------------------------------------------------------------
 * Beide Geräte müssen im selben WLAN sein. Es wird KEIN Server im Internet benutzt
 * (iceServers ist leer). Damit sich die Geräte finden, tauschen sie einmalig einen
 * Verbindungstext aus (als QR-Code oder zum Kopieren):
 *   Tafel  erzeugt  createOffer()      → Text A (Angebot)
 *   iPad   liest A  acceptOffer(A)     → Text B (Antwort)
 *   Tafel  liest B  acceptAnswer(B)    → verbunden
 * Über die Verbindung laufen nur kleine Steuernachrichten (JSON), nie Einzelstimmen.
 */
(function (root) {
  'use strict';
  var pc = null, dc = null;
  var listeners = { open: [], close: [], message: [] };

  function emit(name, arg) {
    listeners[name].forEach(function (f) { try { f(arg); } catch (e) { /* ignorieren */ } });
  }
  function on(name, fn) { listeners[name].push(fn); }

  /* ----- Verbindungstext kürzen und kodieren ----- */
  function toB64u(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function fromB64u(t) {
    t = t.replace(/-/g, '+').replace(/_/g, '/');
    while (t.length % 4) t += '=';
    var s = atob(t), b = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
    return b;
  }
  async function pipe(bytes, stream) {
    var w = stream.writable.getWriter();
    w.write(bytes).catch(function () {});
    w.close().catch(function () {});
    return new Uint8Array(await new Response(stream.readable).arrayBuffer());
  }
  async function pack(desc) {
    var raw = new TextEncoder().encode(JSON.stringify({ t: desc.type, s: desc.sdp }));
    if (typeof CompressionStream === 'function') return 'K1.' + toB64u(await pipe(raw, new CompressionStream('deflate-raw')));
    return 'K0.' + toB64u(raw);
  }
  async function unpack(text) {
    var m = /^(K[01])\.([A-Za-z0-9_-]+)$/.exec(String(text).replace(/\s+/g, ''));
    if (!m) throw new Error('Das ist kein gültiger Verbindungstext.');
    var bytes = fromB64u(m[2]);
    if (m[1] === 'K1') {
      if (typeof DecompressionStream !== 'function') throw new Error('Dieser Browser ist zu alt für die Tafel-Verbindung.');
      bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
    }
    var o = JSON.parse(new TextDecoder().decode(bytes));
    return { type: o.t, sdp: o.s };
  }

  /* ----- Verbindung ----- */
  function close() {
    if (dc) { dc.onclose = null; try { dc.close(); } catch (e) { /* egal */ } }
    if (pc) { pc.onconnectionstatechange = null; try { pc.close(); } catch (e) { /* egal */ } }
    dc = pc = null;
  }
  function newPeer() {
    close();
    if (!root.RTCPeerConnection) throw new Error('Dieser Browser unterstützt die Tafel-Verbindung nicht.');
    var mine = pc = new RTCPeerConnection({ iceServers: [] });     // bewusst kein Server
    pc.onconnectionstatechange = function () {
      if (pc === mine && (mine.connectionState === 'failed' || mine.connectionState === 'closed' || mine.connectionState === 'disconnected')) emit('close');
    };
  }
  function setupChannel(ch) {
    dc = ch;
    var opened = false;                    // "open" nur einmal melden
    function fireOpen() { if (!opened) { opened = true; emit('open'); } }
    ch.onopen = fireOpen;
    ch.onclose = function () { emit('close'); };
    ch.onmessage = function (ev) {
      var msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg && typeof msg === 'object') emit('message', msg);
    };
    if (ch.readyState === 'open') fireOpen();
  }
  function gathered() {                      // warten, bis alle Adressen im Text stehen
    return new Promise(function (resolve) {
      if (pc.iceGatheringState === 'complete') return resolve();
      function check() {
        if (pc.iceGatheringState === 'complete') { pc.removeEventListener('icegatheringstatechange', check); resolve(); }
      }
      pc.addEventListener('icegatheringstatechange', check);
      setTimeout(resolve, 5000);
    });
  }

  async function createOffer() {            // Tafel
    newPeer();
    setupChannel(pc.createDataChannel('ctl'));
    await pc.setLocalDescription(await pc.createOffer());
    await gathered();
    return pack(pc.localDescription);
  }
  async function acceptOffer(text) {        // iPad
    var offer = await unpack(text);
    if (offer.type !== 'offer') throw new Error('Das ist keine Anfrage der Tafel.');
    newPeer();
    pc.ondatachannel = function (ev) { setupChannel(ev.channel); };
    await pc.setRemoteDescription(offer);
    await pc.setLocalDescription(await pc.createAnswer());
    await gathered();
    return pack(pc.localDescription);
  }
  async function acceptAnswer(text) {       // Tafel
    var answer = await unpack(text);
    if (answer.type !== 'answer' || !pc) throw new Error('Das ist keine Antwort des iPads.');
    await pc.setRemoteDescription(answer);
  }

  function isOpen() { return !!dc && dc.readyState === 'open'; }
  function send(obj) { if (isOpen()) dc.send(JSON.stringify(obj)); }

  root.Link = {
    on: on, createOffer: createOffer, acceptOffer: acceptOffer, acceptAnswer: acceptAnswer,
    isOpen: isOpen, send: send, close: close
  };
})(window);
