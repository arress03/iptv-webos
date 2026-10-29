(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var q = new URLSearchParams(location.search);
  var RELAY = q.get('relay') || TVCast.DEFAULT_RELAY, sig = null, pc = null, stream = null, answerTimer = null;
  function status(t, c) { var s = $('st'); s.textContent = t; s.className = c || ''; }
  var supported = !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);
  if (!supported) { var n = $('nosup'); n.classList.remove('hidden'); n.innerHTML = 'Ce navigateur ne peut pas partager l’écran (c’est le cas de Chrome et Firefox sur Android, et de Safari avant iOS 27). Sur Android, utilise l’app TVCast ; sur iPhone, mets iOS à jour ou utilise AirPlay.'; $('go').disabled = true; }
  var hash = (location.hash || '').replace('#', '').replace(/[^A-Za-z0-9]/g, '').toUpperCase(); if (hash) $('code').value = hash.slice(0, 4) + ' ' + hash.slice(4, 8);
  $('apk').href = 'https://github.com/' + (document.documentElement.dataset.repo || 'arress03/iptv-webos') + '/releases/latest';
  $('code').addEventListener('input', function (e) { var v = e.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 8); e.target.value = v.length > 4 ? v.slice(0, 4) + ' ' + v.slice(4) : v; });
  function deviceName() {
    var u = navigator.userAgent, b = /Edg\//.test(u) ? 'Edge' : /Firefox\//.test(u) ? 'Firefox' : /Chrome\//.test(u) ? 'Chrome' : /Safari\//.test(u) ? 'Safari' : 'Navigateur';
    var d = /iPhone/.test(u) ? 'iPhone' : /iPad/.test(u) ? 'iPad' : /Android/.test(u) ? 'Android' : /Mac OS/.test(u) ? 'Mac' : /Windows/.test(u) ? 'PC Windows' : /Linux/.test(u) ? 'PC Linux' : 'Appareil';
    return d + ' · ' + b;
  }
  function reset(msg, cls) {
    clearTimeout(answerTimer);
    try { pc && pc.close(); } catch (e) {} pc = null;
    if (stream) { stream.getTracks().forEach(function (t) { t.onended = null; t.stop(); }); stream = null; }
    if (sig) { sig.close(); sig = null; }
    $('go').classList.remove('hidden'); $('stop').classList.add('hidden'); $('code').disabled = false; if (msg) status(msg, cls);
  }
  function stop(notify) { if (notify && sig) sig.send('bye', {}).catch(function () {}); setTimeout(function () { reset('Partage arrêté.', ''); }, notify ? 150 : 0); }
  $('stop').onclick = function () { stop(true); };
  $('go').onclick = async function () {
    var code = $('code').value.replace(/\s/g, '').toUpperCase();
    if (code.length !== 8) { status('Entre le code à 8 caractères affiché sur la télé.', 'err'); return; }
    try {
      status('Choisis l’écran ou la fenêtre à partager…');
      var h = +$('q').value, fps = +$('fps').value;
      stream = await navigator.mediaDevices.getDisplayMedia({ video: { height: { ideal: h }, width: { ideal: Math.round(h * 16 / 9) }, frameRate: { ideal: fps } }, audio: $('aud').checked });
      $('go').classList.add('hidden'); $('stop').classList.remove('hidden'); $('code').disabled = true;
      status('Connexion au relais…');
      sig = new TVCast.Sig({ relay: RELAY, code: code, role: 's' });
      sig.on = function (kind, p) {
        if (kind === 'answer') {
          clearTimeout(answerTimer);
          pc.setRemoteDescription({ type: 'answer', sdp: p.sdp }).then(function () {
            var s = pc.getSenders().filter(function (x) { return x.track && x.track.kind === 'video'; })[0];
            if (s && s.getParameters) { var pr = s.getParameters(); if (!pr.encodings || !pr.encodings.length) pr.encodings = [{}]; pr.encodings[0].maxBitrate = h >= 1080 ? 8e6 : 4e6; return s.setParameters(pr).catch(function () {}); }
          }).catch(function (e) { reset('Erreur : ' + e.message, 'err'); });
        } else if (kind === 'refused') reset('La télé a refusé le partage.', 'err');
        else if (kind === 'busy') reset('La télé est déjà utilisée par un autre appareil.', 'err');
        else if (kind === 'bye') reset('La télé a arrêté le partage.', '');
      };
      await sig.open();
      pc = new RTCPeerConnection({ iceServers: TVCast.ICE });
      stream.getTracks().forEach(function (t) { if (t.kind === 'video') try { t.contentHint = 'motion'; } catch (e) {} pc.addTrack(t, stream); t.onended = function () { stop(true); }; });
      pc.onconnectionstatechange = function () {
        if (!pc) return; var s = pc.connectionState;
        if (s === 'connected') status('Partage en cours sur la télé ✓', 'ok'); else if (s === 'failed') reset('Connexion impossible (réseaux différents ?).', 'err');
      };
      await pc.setLocalDescription(await pc.createOffer()); await TVCast.iceDone(pc, 3000);
      status('En attente de l’acceptation sur la télé (OK sur la télécommande)…');
      await sig.send('offer', { name: deviceName(), sdp: pc.localDescription.sdp });
      answerTimer = setTimeout(function () { reset('Pas de réponse de la télé (code incorrect ou app fermée).', 'err'); }, 60000);
    } catch (e) { reset(e && e.name === 'NotAllowedError' ? 'Partage annulé.' : 'Erreur : ' + (e && e.message || e), e && e.name === 'NotAllowedError' ? '' : 'err'); }
  };
  window.__tvcast = { stop: stop };
})();
