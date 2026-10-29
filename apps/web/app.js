/* TVWeb — navigateur TV filtré : l'iframe charge les pages via le proxy local du service */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var q = new URLSearchParams(location.search), SERVICE = document.documentElement.getAttribute('data-service');
  var base = '', frame = $('page'), cur = '', hlsI = null, mode = 'home';   // home | page | bar | player | vlist
  var favs = (function () { try { return JSON.parse(localStorage.getItem('tvweb.favs')) || []; } catch (e) { return []; } })();
  var seen = {}, vids = [], depth = 0, lastNav = '';

  function toast(t, ms) { var e = $('toast'); e.textContent = t; e.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(function () { e.classList.remove('on'); }, ms || 2200); }
  function luna(method, params) {
    return new Promise(function (res) {
      try {
        if (typeof PalmServiceBridge === 'undefined') return res({ returnValue: false, errorText: 'no-bridge' });
        var b = new PalmServiceBridge(), done = false, t = setTimeout(function () { if (!done) { done = true; res({ returnValue: false, errorText: 'timeout' }); } }, 8000);
        b.onservicecallback = function (m) { if (done) return; done = true; clearTimeout(t); try { res(JSON.parse(m)); } catch (e) { res({ returnValue: false }); } };
        b.call('luna://' + SERVICE + '/' + method, JSON.stringify(params || {}));
      } catch (e) { res({ returnValue: false, errorText: String(e) }); }
    });
  }
  function saveFavs() { try { localStorage.setItem('tvweb.favs', JSON.stringify(favs)); } catch (e) {} }

  /* ---------- accueil ---------- */
  function renderFavs() {
    var box = $('favs'); box.innerHTML = '';
    favs.forEach(function (f, i) {
      var d = document.createElement('div'); d.className = 'fav'; d.tabIndex = -1; d.setAttribute('data-f', 1); d.dataset.i = i;
      d.innerHTML = ''; d.appendChild(document.createTextNode(f.title || f.url)); var s = document.createElement('small'); s.textContent = f.url; d.appendChild(s);
      d.onclick = function () { open(f.url); }; box.appendChild(d);
    });
    if (!favs.length) box.innerHTML = '<div class="hint">Aucun favori. Ouvre un site puis appuie sur Bleu (ou ☆) pour l’ajouter.</div>';
  }
  function showHome() { mode = 'home'; frame.classList.remove('on'); frame.removeAttribute('src'); $('home').classList.remove('hidden'); $('bar').classList.add('hidden'); renderFavs(); $('urlin').focus(); }

  function open(u) {
    if (!base) { toast('Service indisponible'); return; }
    u = String(u || '').trim(); if (!u) return;
    cur = u; depth = 0; lastNav = ''; $('home').classList.add('hidden'); frame.classList.add('on'); mode = 'page'; $('bar').classList.add('hidden');
    frame.src = base + '/__go?u=' + encodeURIComponent(u); setTimeout(function () { try { frame.focus(); } catch (e) {} }, 100);
  }
  function showBar() { if (mode === 'page') { mode = 'bar'; $('bar').classList.remove('hidden'); $('b-url').value = cur; $('b-url').focus(); } }
  function hideBar() { if (mode === 'bar') { mode = 'page'; $('bar').classList.add('hidden'); try { frame.focus(); frame.contentWindow.focus(); } catch (e) {} } }
  function histBack() { try { frame.contentWindow.history.back(); } catch (e) {} }

  /* ---------- infos / vidéos détectées ---------- */
  function poll() {
    if (!base) return;
    fetch(base + '/__stats').then(function (r) { return r.json(); }).then(function (s) { $('nblk').textContent = s.blocked; }).catch(function () {});
    fetch(base + '/__sniff').then(function (r) { return r.json(); }).then(function (l) { vids = l; $('nvid').textContent = l.length; }).catch(function () {});
  }
  function showVids() {
    if (!vids.length) { toast('Aucune vidéo détectée sur cette page (lance-la d’abord)'); return; }
    var box = $('vitems'); box.innerHTML = '';
    vids.slice().reverse().forEach(function (v) {
      var d = document.createElement('div'); d.className = 'vi'; d.tabIndex = -1; d.setAttribute('data-f', 1); d.textContent = v.url.replace(/^https?:\/\//, '');
      d.onclick = function () { play(v); }; box.appendChild(d);
    });
    mode = 'vlist'; $('vlist').classList.remove('hidden'); box.firstChild.focus();
  }
  function closeVids() { $('vlist').classList.add('hidden'); mode = 'page'; }

  /* ---------- lecteur ---------- */
  function play(v) {
    $('vlist').classList.add('hidden'); var vid = $('pv'), src = base + v.via; mode = 'player'; $('player').classList.remove('hidden');
    try { frame.contentWindow.postMessage({ tvwebCmd: 'pause' }, '*'); } catch (e) {}
    if (/\.m3u8|mpegurl/i.test(v.url + v.type) && window.Hls && Hls.isSupported()) { hlsI = new Hls(); hlsI.loadSource(src); hlsI.attachMedia(vid); }
    else { vid.src = src; }
    vid.play().catch(function () {}); info(v.url.replace(/^https?:\/\//, ''));
  }
  function info(t) { var p = $('pinfo'); p.textContent = t; p.classList.add('on'); clearTimeout(info.t); info.t = setTimeout(function () { p.classList.remove('on'); }, 3500); }
  function stopPlayer() { var vid = $('pv'); try { vid.pause(); } catch (e) {} if (hlsI) { hlsI.destroy(); hlsI = null; } vid.removeAttribute('src'); vid.load(); $('player').classList.add('hidden'); mode = 'page'; }

  /* ---------- touches ---------- */
  function addFav() {
    var u = cur; if (!u) return; if (favs.some(function (f) { return f.url === u; })) { toast('Déjà dans les favoris'); return; }
    favs.push({ url: u, title: u.replace(/^https?:\/\/(www\.)?/, '').replace(/\/.*$/, '') }); saveFavs(); toast('Ajouté aux favoris ★');
  }
  function onCode(code) {   // code : 461, 403..406, 'toolbar'
    if (mode === 'player') { if (code === 461) stopPlayer(); return; }
    if (mode === 'vlist') { if (code === 461) closeVids(); return; }
    if (code === 'toolbar' || code === 403) { if (mode === 'page') showBar(); else if (mode === 'bar') hideBar(); return; }
    if (code === 461) { if (mode === 'bar') hideBar(); else if (mode === 'page') { if (depth <= 1) showHome(); else { depth -= 2; histBack(); } } else if (mode === 'home') exit(); return; }
    if (code === 404) { if (mode === 'page') frame.contentWindow.location.reload(); return; }
    if (code === 405) { if (mode === 'page' || mode === 'bar') showVids(); return; }
    if (code === 406) { if (mode === 'page' || mode === 'bar') addFav(); return; }
  }
  function exit() { try { if (window.webOS && webOS.platformBack) { webOS.platformBack(); return; } } catch (e) {} try { window.close(); } catch (e2) {} }
  function focusables() {
    var root = mode === 'bar' ? $('bar') : mode === 'vlist' ? $('vitems') : $('home');
    return [].slice.call(root.querySelectorAll('[data-f]')).filter(function (e) { return e.offsetParent !== null; });
  }
  document.addEventListener('keydown', function (e) {
    var k = e.keyCode, a = document.activeElement;
    if (mode === 'player') {
      var v = $('pv'); e.preventDefault();
      if (k === 461 || k === 27) stopPlayer(); else if (k === 13 || k === 415 || k === 19) { if (v.paused) v.play(); else v.pause(); info(v.paused ? '⏸' : '▶'); }
      else if (k === 39 || k === 417) { v.currentTime += 10; info('+10 s'); } else if (k === 37 || k === 412) { v.currentTime -= 10; info('−10 s'); }
      else if (k === 38) { v.volume = Math.min(1, v.volume + 0.1); info('Volume ' + Math.round(v.volume * 100) + '%'); } else if (k === 40) { v.volume = Math.max(0, v.volume - 0.1); info('Volume ' + Math.round(v.volume * 100) + '%'); }
      return;
    }
    if (k === 461 || k === 27 || (k === 403 || k === 404 || k === 405 || k === 406)) { if (k === 404 && mode === 'home') { var fv = a && a.classList && a.classList.contains('fav') ? +a.dataset.i : -1; if (fv >= 0) { favs.splice(fv, 1); saveFavs(); renderFavs(); toast('Favori supprimé'); } e.preventDefault(); return; } e.preventDefault(); onCode(k === 27 ? 461 : k); return; }
    if (mode === 'page') return;
    var typing = a && a.tagName === 'INPUT', list = focusables(), i = list.indexOf(a);
    if (k === 13) { if (a === $('urlin') || a === $('go')) open($('urlin').value); else if (a === $('b-url') || a === $('b-go')) open($('b-url').value); else if (a && a.click && a.tagName !== 'INPUT') a.click(); return; }
    var horizontal = mode === 'bar', fwd = horizontal ? 39 : 40, bwd = horizontal ? 37 : 38;
    if (typing && (k === 37 || k === 39) && !horizontal) return;
    if (typing && horizontal && (k === 37 || k === 39)) { if (!(a.selectionStart === 0 && k === 37) && !(a.selectionStart === a.value.length && k === 39)) return; }
    if (k === fwd) { e.preventDefault(); if (list[i + 1]) list[i + 1].focus(); }
    else if (k === bwd) { e.preventDefault(); if (list[i - 1]) list[i - 1].focus(); }
    else if (mode === 'bar' && k === 40) { e.preventDefault(); hideBar(); }
    else if (mode === 'home' && (k === 37 || k === 39)) { e.preventDefault(); if (a.classList.contains('fav')) { var j = i + (k === 39 ? 1 : -1); if (list[j]) list[j].focus(); } }
  });
  window.addEventListener('message', function (e) {
    var d = e.data; if (!d || !d.tvweb || e.source !== frame.contentWindow) return;
    if (d.kind === 'key') onCode(d.code);
    else if (d.kind === 'nav') { if (d.url && d.url !== lastNav) { lastNav = d.url; depth++; } cur = d.url ? realUrl(d.url) : cur; }
    else if (d.kind === 'popup') toast('Popup bloquée 🛡');
    else if (d.kind === 'overlay') toast('Pub superposée retirée 🛡');
  });
  function realUrl(u) { return u; }
  $('go').onclick = function () { open($('urlin').value); };
  $('b-go').onclick = function () { open($('b-url').value); };
  $('b-back').onclick = function () { histBack(); }; $('b-fwd').onclick = function () { try { frame.contentWindow.history.forward(); } catch (e) {} };
  $('b-rel').onclick = function () { try { frame.contentWindow.location.reload(); } catch (e) {} hideBar(); };
  $('b-fav').onclick = addFav; $('b-vid').onclick = showVids; $('b-home').onclick = showHome;
  // sécurité : une vidéo de la page ne doit pas continuer à jouer sous le lecteur
  document.addEventListener('visibilitychange', function () { if (document.hidden && mode === 'player') stopPlayer(); });

  /* ---------- démarrage ---------- */
  function boot() {
    var p = q.get('port');
    (p ? Promise.resolve({ returnValue: true, port: +p }) : luna('start')).then(function (r) {
      if (!r || !r.returnValue) { $('status').textContent = 'Service indisponible (' + (r && r.errorText) + ') — réinstalle l’app.'; return; }
      base = 'http://127.0.0.1:' + r.port; $('status').textContent = '🛡 Bloqueur actif · ' + (r.hosts || '') + ' domaines bloqués';
      setInterval(poll, 3000); var u = q.get('u'); if (u) open(u);
    });
    showHome();
  }
  window.TVWebApp = { open: open, mode: function () { return mode; } };
  boot();
})();
