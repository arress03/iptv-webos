(function () {
  'use strict';
  var API = 'https://lrclib.net/api/';
  var $ = function (id) { return document.getElementById(id); };
  var q = $('q'), list = $('list'), status = $('status'), view = $('view');
  var results = [], sel = 0, mode = 'search';   // search | list | lyrics
  var cur = null, lines = [], synced = false, scroll = 0, clock = null;
  var playing = false, pos = 0, last = 0, idx = -1;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function fmt(s) { s = Math.round(s || 0); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }

  function get(url, cb) {
    var x = new XMLHttpRequest(); x.open('GET', url); x.timeout = 15000;
    x.onload = function () {
      if (x.status < 200 || x.status >= 300) return cb('HTTP ' + x.status);
      try { cb(null, JSON.parse(x.responseText)); } catch (e) { cb('Réponse illisible'); }
    };
    x.onerror = function () { cb('Pas de réseau ou serveur injoignable'); };
    x.ontimeout = function () { cb('Délai dépassé'); };
    x.send();
  }

  function setMode(m) {
    mode = m;
    view.classList.toggle('hidden', m !== 'lyrics');
    if (m === 'search') q.focus(); else q.blur();
  }

  function search() {
    var v = q.value.trim(); if (!v) return;
    status.textContent = 'Recherche…'; list.innerHTML = ''; results = [];
    get(API + 'search?q=' + encodeURIComponent(v), function (err, data) {
      if (err) { status.textContent = 'Erreur : ' + err; return; }
      results = (data || []).filter(function (r) { return r.plainLyrics || r.syncedLyrics || r.instrumental; });
      if (!results.length) { status.textContent = 'Aucun résultat pour « ' + v + ' ».'; return; }
      status.textContent = results.length + ' résultat(s) — choisis avec ↑ ↓ puis OK';
      sel = 0; renderList(); setMode('list');
    });
  }

  function renderList() {
    var per = 7, start = Math.max(0, Math.min(sel - 3, results.length - per)), h = '';
    for (var i = start; i < Math.min(results.length, start + per); i++) {
      var r = results[i];
      h += '<div class="it' + (i === sel ? ' sel' : '') + '"><div><div class="n">' + esc(r.trackName) + '</div><div class="s">' + esc(r.artistName) +
        (r.albumName ? ' · ' + esc(r.albumName) : '') + (r.instrumental ? ' · instrumental' : r.syncedLyrics ? ' · synchronisées' : '') + '</div></div><div class="d">' + fmt(r.duration) + '</div></div>';
    }
    list.innerHTML = h;
  }

  function parseLrc(t) {
    var out = [];
    String(t).split(/\r?\n/).forEach(function (l) {
      var m = l.match(/^\s*((?:\[\d+:\d+(?:[.:]\d+)?\])+)\s*(.*)$/); if (!m) return;
      var txt = m[2], re = /\[(\d+):(\d+(?:[.:]\d+)?)\]/g, k;
      while ((k = re.exec(m[1]))) out.push({ t: +k[1] * 60 + parseFloat(k[2].replace(':', '.')), s: txt });
    });
    out.sort(function (a, b) { return a.t - b.t; });
    return out;
  }

  function openLyrics(r) {
    cur = r; stop(); pos = 0; idx = -1; scroll = 0;
    $('t').textContent = r.trackName; $('a').textContent = r.artistName + (r.albumName ? ' — ' + r.albumName : '');
    var box = $('lyr'), h = '';
    if (r.instrumental) { lines = []; synced = false; h = '<div class="ln">♪ Morceau instrumental ♪</div>'; }
    else if (r.syncedLyrics && parseLrc(r.syncedLyrics).length) {
      lines = parseLrc(r.syncedLyrics); synced = true;
      lines.forEach(function (l) { h += '<div class="ln">' + (esc(l.s) || '♪') + '</div>'; });
    } else {
      lines = []; synced = false;
      String(r.plainLyrics || '').split(/\r?\n/).forEach(function (l) { h += '<div class="ln">' + (esc(l) || '&nbsp;') + '</div>'; });
    }
    box.className = synced ? 'synced' : '';
    box.innerHTML = '<div class="in" id="in">' + h + '</div>';
    $('mode').textContent = synced ? 'Paroles synchronisées (karaoké)' : 'Paroles complètes';
    foot(); setMode('lyrics'); apply();
  }

  function foot() {
    $('foot').textContent = synced
      ? 'OK : ' + (playing ? 'pause' : 'lancer le défilement') + ' · ←/→ : ±2 s · ↑/↓ : ligne · Retour : résultats   [' + fmt(pos) + ' / ' + fmt(cur.duration) + ']'
      : '↑/↓ : défiler · Retour : résultats';
  }

  function apply() {
    var inn = $('in'); if (!inn) return;
    var kids = inn.children, y = 0;
    if (synced) {
      var n = -1; for (var i = 0; i < lines.length; i++) if (lines[i].t <= pos + 0.15) n = i; else break;
      if (n !== idx) {
        if (idx >= 0 && kids[idx]) kids[idx].className = 'ln';
        idx = n; if (n >= 0 && kids[n]) kids[n].className = 'ln cur';
      }
      var t = idx >= 0 ? kids[idx] : kids[0];
      y = t ? t.offsetTop - 300 : 0; scroll = Math.max(0, y);
    }
    inn.style.transform = 'translateY(' + (-scroll) + 'px)';
  }

  function tick() {
    var now = Date.now(); pos += (now - last) / 1000; last = now;
    if (cur && pos > cur.duration + 5) { stop(); }
    apply(); foot();
  }
  function play() { if (playing) return; playing = true; last = Date.now(); clock = setInterval(tick, 200); }
  function stop() { playing = false; if (clock) clearInterval(clock); clock = null; }

  function key(e) {
    var k = e.keyCode, back = k === 461 || k === 27 || k === 8 && mode !== 'search' || k === 10009;
    if (mode === 'search') {
      if (k === 13) { e.preventDefault(); search(); }
      else if (k === 40 && results.length) { e.preventDefault(); setMode('list'); }
      else if (k === 461 || k === 10009) { try { window.close(); } catch (x) {} }
      return;
    }
    if (mode === 'list') {
      if (k === 38) { e.preventDefault(); if (sel > 0) { sel--; renderList(); } else setMode('search'); }
      else if (k === 40) { e.preventDefault(); if (sel < results.length - 1) { sel++; renderList(); } }
      else if (k === 13) { e.preventDefault(); openLyrics(results[sel]); }
      else if (back) { e.preventDefault(); setMode('search'); }
      return;
    }
    if (back) { e.preventDefault(); stop(); setMode('list'); return; }
    var inn = $('in'); if (!inn) return;
    if (k === 13 && synced) { e.preventDefault(); if (playing) stop(); else play(); foot(); }
    else if (k === 37 && synced) { e.preventDefault(); pos = Math.max(0, pos - 2); apply(); foot(); }
    else if (k === 39 && synced) { e.preventDefault(); pos += 2; apply(); foot(); }
    else if (k === 38 || k === 40) {
      e.preventDefault();
      if (synced) { var j = Math.max(0, Math.min(lines.length - 1, (idx < 0 ? 0 : idx) + (k === 40 ? 1 : -1))); pos = lines[j].t; if (!playing) last = Date.now(); apply(); foot(); }
      else { var max = Math.max(0, inn.offsetHeight - $('lyr').clientHeight + 40); scroll = Math.max(0, Math.min(max, scroll + (k === 40 ? 160 : -160))); apply(); }
    }
  }

  document.addEventListener('keydown', key);
  window.addEventListener('load', function () { q.focus(); });
  window.LyricsApp = { search: search, openLyrics: openLyrics, state: function () { return { mode: mode, results: results, idx: idx, pos: pos }; }, setPos: function (p) { pos = p; apply(); } };
})();
