/* TVCast — récepteur de partage d'écran (WebRTC) pour webOS */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var RELAY = (function () { try { return JSON.parse(localStorage.getItem('cast.relay')) || null; } catch (e) { return null; } })() || window.CAST_RELAY || TVCast.DEFAULT_RELAY;
  var PAGE = window.CAST_URL || 'https://OWNER.github.io/iptv-webos/cast/';
  var sig = null, code = '', pc = null, sess = null /* {sid,name} */, pending = null, askTimer = null, badgeTimer = null, discTimer = null;

  function setState(t, cls) { var s = $('state'); s.textContent = t; s.className = 'state ' + (cls || ''); }
  function showQr() {
    $('url').textContent = PAGE.replace(/^https?:\/\//, '').replace(/\/$/, '');
    try { var q = qrcode(0, 'M'); q.addData(PAGE + '#' + code); q.make(); $('qr').innerHTML = q.createSvgTag({ cellSize: 6, margin: 0, scalable: true }); } catch (e) { $('qr').textContent = ''; }
  }
  function badge(t, ms) { var b = $('badge'); b.textContent = t; b.classList.remove('hidden'); clearTimeout(badgeTimer); if (ms) badgeTimer = setTimeout(function () { b.classList.add('hidden'); }, ms); }

  function newSession() {
    if (sig) sig.close();
    code = TVCast.rnd(8); $('code').textContent = code.slice(0, 4) + ' ' + code.slice(4);
    sig = new TVCast.Sig({ relay: RELAY, code: code, role: 't' });
    sig.onstate = function (ok) { if (!sess) setState(ok ? 'En attente d’un appareil…' : 'Relais injoignable, nouvelle tentative…', ok ? 'ok' : 'err'); };
    sig.on = onMsg; showQr();
    sig.open().catch(function (e) { setState('Relais injoignable : ' + (e && e.message || e), 'err'); });
  }

  function onMsg(kind, p, from) {
    if (kind === 'offer') {
      if (sess || pending) { sig.send('busy', {}, from).catch(function () {}); return; }
      pending = { sid: from, name: String(p.name || 'Un appareil').slice(0, 40), sdp: p.sdp };
      $('who').textContent = pending.name; $('ask').classList.remove('hidden');
      clearTimeout(askTimer); askTimer = setTimeout(function () { decide(false); }, 40000);
    } else if (kind === 'bye') {
      if ((sess && sess.sid === from) || (pending && pending.sid === from)) { if (pending && pending.sid === from) closeAsk(); else endSession(false); }
    }
  }
  function closeAsk() { clearTimeout(askTimer); pending = null; $('ask').classList.add('hidden'); }

  function decide(yes) {
    var p = pending; if (!p) return; closeAsk();
    if (!yes) { sig.send('refused', {}, p.sid).catch(function () {}); return; }
    sess = { sid: p.sid, name: p.name }; setState('Connexion à ' + p.name + '…', '');
    pc = new RTCPeerConnection({ iceServers: TVCast.ICE });
    var stream = new MediaStream();
    pc.ontrack = function (ev) {
      stream.addTrack(ev.track);
      try { ev.receiver.playoutDelayHint = 0; } catch (e) {}
      try { if ('jitterBufferTarget' in ev.receiver) ev.receiver.jitterBufferTarget = 0; } catch (e2) {}
      var v = $('v'); if (v.srcObject !== stream) { v.srcObject = stream; v.classList.add('on'); }
      v.play().catch(function () {});
      $('panel').classList.add('hidden'); badge('Partage de ' + sess.name, 4000);
    };
    pc.onconnectionstatechange = function () {
      var s = pc && pc.connectionState; clearTimeout(discTimer);
      if (s === 'failed' || s === 'closed') endSession(true);
      else if (s === 'disconnected') discTimer = setTimeout(function () { endSession(true); }, 6000);
    };
    pc.setRemoteDescription({ type: 'offer', sdp: p.sdp }).then(function () { return pc.createAnswer(); })
      .then(function (a) { return pc.setLocalDescription(a); }).then(function () { return TVCast.iceDone(pc, 3000); })
      .then(function () { return sig.send('answer', { sdp: pc.localDescription.sdp }, p.sid); })
      .catch(function (e) { setState('Échec : ' + (e && e.message || e), 'err'); endSession(false); });
  }

  function endSession(notify) {
    clearTimeout(discTimer);
    if (notify && sess && sig) sig.send('bye', {}, sess.sid).catch(function () {});
    try { pc && pc.close(); } catch (e) {} pc = null; sess = null;
    var v = $('v'); try { v.pause(); } catch (e2) {} v.srcObject = null; v.removeAttribute('src'); v.classList.remove('on');
    $('panel').classList.remove('hidden'); $('badge').classList.add('hidden');
    newSession();   // nouveau code après chaque partage
  }

  function exitApp() { try { if (window.webOS && webOS.platformBack) { webOS.platformBack(); return; } } catch (e) {} try { window.close(); } catch (e2) {} }
  document.addEventListener('keydown', function (e) {
    var k = e.keyCode;
    if (pending) { if (k === 13) decide(true); else if (k === 461 || k === 27 || k === 8) decide(false); e.preventDefault(); return; }
    if (k === 461 || k === 27 || k === 8) { e.preventDefault(); if (sess) endSession(true); else exitApp(); }
    else if (k === 13 && sess) { badge('Partage de ' + sess.name + ' · Retour = arrêter', 3000); }
  });
  document.addEventListener('visibilitychange', function () { if (document.hidden && sess) endSession(true); });
  window.addEventListener('pagehide', function () { if (sess) endSession(true); });
  window.TVCastApp = { decide: decide, state: function () { return { code: code, sess: sess, pending: pending }; } };
  newSession();
})();
