/* IPTV webOS – socle commun (Xtream, cache, navigation télécommande, lecteur à connexion unique) */
(function () {
  'use strict';

  var KEY = { LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13, BACK: 461, ESC: 27, BKSP: 8,
    PLAY: 415, PAUSE: 19, STOP: 413, FF: 417, RW: 412, CHUP: 427, CHDOWN: 428,
    RED: 403, GREEN: 404, YELLOW: 405, BLUE: 406 };

  function $(sel, root) { return (root || document).querySelector(sel); }
  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') e.className = attrs[k];
      else if (k === 'text') e.textContent = attrs[k];
      else if (k === 'f') { e.setAttribute('data-f', ''); e.setAttribute('tabindex', '-1'); }
      else e.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function b64(s) { try { return decodeURIComponent(escape(atob(s))); } catch (e) { try { return atob(s); } catch (e2) { return s || ''; } } }
  function ls(k, v) {
    try { if (v === undefined) { var x = localStorage.getItem(k); return x === null ? null : JSON.parse(x); }
      if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { return null; }
  }

  /* ---------- Cache IndexedDB (catalogues volumineux) ---------- */
  var DB = {
    _p: null,
    open: function () {
      if (!this._p) this._p = new Promise(function (res, rej) {
        var r = indexedDB.open('iptv-cache', 1);
        r.onupgradeneeded = function () { r.result.createObjectStore('kv'); };
        r.onsuccess = function () { res(r.result); };
        r.onerror = function () { rej(r.error); };
      });
      return this._p;
    },
    get: function (k) {
      return this.open().then(function (db) { return new Promise(function (res) {
        var q = db.transaction('kv').objectStore('kv').get(k);
        q.onsuccess = function () { res(q.result); }; q.onerror = function () { res(undefined); };
      }); }).catch(function () { return undefined; });
    },
    set: function (k, v) {
      return this.open().then(function (db) { return new Promise(function (res) {
        var tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(v, k);
        tx.oncomplete = function () { res(); }; tx.onerror = function () { res(); };
      }); }).catch(function () {});
    },
    clear: function () {
      return this.open().then(function (db) { return new Promise(function (res) {
        var tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').clear();
        tx.oncomplete = function () { res(); }; tx.onerror = function () { res(); };
      }); }).catch(function () {});
    }
  };

  /* ---------- Client Xtream : file d'attente unique + cache ---------- */
  var Xt = {
    cfg: ls('xt.cfg'),
    _chain: Promise.resolve(),
    _ctrl: null,
    save: function (c) { this.cfg = c; ls('xt.cfg', c); },
    clearAccount: function () { this.cfg = null; ls('xt.cfg', null); return DB.clear(); },
    // Accepte "host:port", "http://host:port", ou une URL M3U get.php?username=..&password=..
    parseServer: function (raw) {
      raw = (raw || '').trim();
      if (!raw) return null;
      if (!/^https?:\/\//i.test(raw)) raw = 'http://' + raw;
      try {
        var u = new URL(raw);
        var out = { server: u.protocol + '//' + u.host };
        if (u.searchParams.get('username')) out.username = u.searchParams.get('username');
        if (u.searchParams.get('password')) out.password = u.searchParams.get('password');
        return out;
      } catch (e) { return null; }
    },
    _url: function (action, params) {
      var c = this.cfg, q = 'username=' + encodeURIComponent(c.username) + '&password=' + encodeURIComponent(c.password);
      if (action) q += '&action=' + action;
      Object.keys(params || {}).forEach(function (k) { q += '&' + k + '=' + encodeURIComponent(params[k]); });
      return c.server + '/player_api.php?' + q;
    },
    _fetch: function (url, timeout) {
      var self = this;
      // Un seul appel API à la fois + 150 ms d'écart : jamais de rafale vers le serveur.
      var job = this._chain.then(function () {
        var ctrl = new AbortController(); self._ctrl = ctrl;
        var timer = setTimeout(function () { ctrl.abort(); }, timeout || 40000);
        return fetch(url, { signal: ctrl.signal }).then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        }).finally(function () { clearTimeout(timer); return sleep(150); });
      });
      this._chain = job.catch(function () {});
      return job;
    },
    // ttl en ms. Pas de ttl = toujours réseau.
    call: function (action, params, ttl, force) {
      var self = this, key = (this.cfg.server + '|' + this.cfg.username + '|' + action + '|' + JSON.stringify(params || {}));
      var pre = (ttl && !force) ? DB.get(key) : Promise.resolve(undefined);
      return pre.then(function (hit) {
        if (hit && Date.now() - hit.t < ttl) return hit.v;
        return self._fetch(self._url(action, params)).catch(function () {
          return sleep(1500).then(function () { return self._fetch(self._url(action, params)); });
        }).then(function (v) { if (ttl) DB.set(key, { t: Date.now(), v: v }); return v; });
      });
    },
    auth: function () { return this._fetch(this._url('', {}), 20000); },
    abort: function () { try { if (this._ctrl) this._ctrl.abort(); } catch (e) {} },
    stream: function (kind, id, ext) {
      var c = this.cfg;
      return c.server + '/' + kind + '/' + encodeURIComponent(c.username) + '/' + encodeURIComponent(c.password) + '/' + id + (ext ? '.' + ext : '');
    }
  };
  var DAY = 12 * 3600 * 1000;

  /* ---------- Navigation spatiale (D-pad + Magic Remote) ---------- */
  var Nav = {
    layer: document.body,
    stack: [],
    push: function (root) { this.stack.push(this.layer); this.layer = root; },
    pop: function () { this.layer = this.stack.pop() || document.body; },
    list: function () {
      var r = this.layer;
      return Array.prototype.filter.call(r.querySelectorAll('[data-f]'), function (e) { return e.offsetParent !== null && !e.disabled; });
    },
    focus: function (e) { if (!e) return; e.focus({ preventScroll: true }); e.scrollIntoView({ block: 'nearest', inline: 'nearest' }); },
    first: function () { this.focus(this.list()[0]); },
    move: function (dir) {
      var cur = document.activeElement, all = this.list();
      if (!cur || !cur.hasAttribute || !cur.hasAttribute('data-f') || !this.layer.contains(cur)) { this.focus(all[0]); return; }
      var a = cur.getBoundingClientRect(), ax = a.left + a.width / 2, ay = a.top + a.height / 2, best = null, bs = 1e12;
      all.forEach(function (e) {
        if (e === cur) return;
        var b = e.getBoundingClientRect(), bx = b.left + b.width / 2, by = b.top + b.height / 2, dx = bx - ax, dy = by - ay, p, s;
        if (dir === 'left' && dx < -2) { p = -dx; s = Math.abs(dy); }
        else if (dir === 'right' && dx > 2) { p = dx; s = Math.abs(dy); }
        else if (dir === 'up' && dy < -2) { p = -dy; s = Math.abs(dx); }
        else if (dir === 'down' && dy > 2) { p = dy; s = Math.abs(dx); }
        else return;
        var score = p + s * 3;
        if (score < bs) { bs = score; best = e; }
      });
      if (best) this.focus(best);
    }
  };

  /* ---------- Gestion des touches ---------- */
  var keyHandlers = [];   // pile : le dernier handler a la priorité ; retourne true si consommé
  function onKey(fn) { keyHandlers.push(fn); return function () { var i = keyHandlers.indexOf(fn); if (i >= 0) keyHandlers.splice(i, 1); }; }
  var backFallback = null;
  function exitApp() {
    try { if (window.webOS && webOS.platformBack) { webOS.platformBack(); return; } } catch (e) {}
    try { window.close(); } catch (e2) {}
  }
  document.addEventListener('keydown', function (ev) {
    var k = ev.keyCode;
    for (var i = keyHandlers.length - 1; i >= 0; i--) {
      if (keyHandlers[i](ev, k)) { ev.preventDefault(); return; }
    }
    var inInput = /^(INPUT|TEXTAREA)$/.test((document.activeElement || {}).tagName || '');
    if (k === KEY.UP) { Nav.move('up'); ev.preventDefault(); }
    else if (k === KEY.DOWN) { Nav.move('down'); ev.preventDefault(); }
    else if (k === KEY.LEFT && !inInput) { Nav.move('left'); ev.preventDefault(); }
    else if (k === KEY.RIGHT && !inInput) { Nav.move('right'); ev.preventDefault(); }
    else if (k === KEY.ENTER && !inInput) {
      var c = document.activeElement; if (c && c.hasAttribute && c.hasAttribute('data-f')) { c.click(); ev.preventDefault(); }
    } else if (k === KEY.BACK || k === KEY.ESC || (k === KEY.BKSP && !inInput)) {
      ev.preventDefault();
      if (backFallback) backFallback(); else exitApp();
    }
  }, true);
  // Pointeur Magic Remote : le survol donne le focus
  document.addEventListener('mouseover', function (ev) {
    var t = ev.target.closest && ev.target.closest('[data-f]');
    if (t && Nav.layer.contains(t) && t !== document.activeElement && t.tagName !== 'INPUT') t.focus({ preventScroll: true });
  });

  /* ---------- Toast ---------- */
  var toastT;
  function toast(msg, ms) {
    var t = $('#toast');
    if (!t) { t = el('div', { id: 'toast' }); document.body.appendChild(t); }
    t.textContent = msg; t.classList.add('on');
    clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove('on'); }, ms || 2500);
  }

  /* ---------- Lecteur : UNE seule connexion, libération garantie ---------- */
  var Player = {
    video: null, hls: null, token: 0, active: false, onStall: null,
    init: function (video) {
      this.video = video; var self = this;
      video.addEventListener('waiting', function () { document.body.classList.add('buffering'); });
      video.addEventListener('playing', function () { document.body.classList.remove('buffering'); });
    },
    // Coupe tout : plus aucune connexion ouverte vers le fournisseur (libère l'écran).
    stop: function () {
      this.token++; this.active = false;
      document.body.classList.remove('buffering');
      var v = this.video;
      if (this.hls) { try { this.hls.destroy(); } catch (e) {} this.hls = null; }
      if (v) { try { v.pause(); } catch (e) {} v.removeAttribute('src'); try { v.load(); } catch (e2) {} }
    },
    _try: function (url, startAt, tk) {
      var self = this, v = this.video;
      return new Promise(function (resolve) {
        var done = false, timer;
        function finish(ok) { if (done) return; done = true; clearTimeout(timer); v.removeEventListener('playing', onPlay); v.removeEventListener('error', onErr); resolve(ok); }
        function onPlay() { finish(true); }
        function onErr() { finish(false); }
        v.addEventListener('playing', onPlay); v.addEventListener('error', onErr);
        timer = setTimeout(function () { finish(false); }, 9000);
        var isHls = /\.m3u8(\?|$)/i.test(url);
        if (isHls && window.Hls && Hls.isSupported() && !v.canPlayType('application/vnd.apple.mpegurl')) {
          var h = new Hls({ lowLatencyMode: true, liveSyncDurationCount: 3, liveMaxLatencyDurationCount: 6,
            maxBufferLength: 20, backBufferLength: 20, manifestLoadingMaxRetry: 2, levelLoadingMaxRetry: 2, fragLoadingMaxRetry: 3 });
          self.hls = h; h.on(Hls.Events.ERROR, function (e, d) { if (d.fatal) finish(false); });
          h.loadSource(url); h.attachMedia(v);
        } else { v.src = url; }
        if (startAt > 0) v.addEventListener('loadedmetadata', function once() { v.removeEventListener('loadedmetadata', once); try { v.currentTime = startAt; } catch (e) {} });
        var p = v.play(); if (p && p.catch) p.catch(function () {});
      }).then(function (ok) { return ok && tk === self.token; });
    },
    // urls : candidats essayés dans l'ordre, un seul ouvert à la fois. Retourne true si lecture lancée.
    play: function (urls, startAt) {
      var self = this;
      this.stop(); var tk = this.token; this.active = true;
      document.body.classList.add('buffering');
      var i = 0, round = 0;
      function next() {
        if (tk !== self.token) return Promise.resolve(false);
        if (i >= urls.length) {
          // Place peut-être pas encore libérée côté serveur : on retente 2 fois après une pause.
          if (round++ < 2) { i = 0; toast('Connexion refusée ? Nouvel essai…', 3000); return sleep(3000).then(next); }
          document.body.classList.remove('buffering'); self.active = false;
          return Promise.resolve(false);
        }
        var u = urls[i++];
        self._reset();
        return self._try(u, startAt, tk).then(function (ok) { return ok ? true : next(); });
      }
      return next();
    },
    _reset: function () {
      if (this.hls) { try { this.hls.destroy(); } catch (e) {} this.hls = null; }
      var v = this.video; try { v.pause(); } catch (e) {} v.removeAttribute('src'); try { v.load(); } catch (e2) {}
    }
  };

  // L'utilisateur quitte l'app (Home, autre app, relance, fermeture) → on libère l'écran, sans déconnecter le compte.
  function release() { Player.stop(); Xt.abort(); }
  document.addEventListener('visibilitychange', function () { if (document.hidden) release(); });
  window.addEventListener('pagehide', release);
  window.addEventListener('beforeunload', release);
  document.addEventListener('webOSRelaunch', release);


  /* ---------- Pont vers le service de la TV (saisie par téléphone, identifiants partagés) ---------- */
  var SERVICE = document.documentElement.getAttribute('data-service');
  function luna(method, params) {
    return new Promise(function (resolve) {
      try {
        if (!SERVICE || typeof PalmServiceBridge === 'undefined') return resolve({ returnValue: false, errorText: 'no-bridge' });
        var b = new PalmServiceBridge(), done = false;
        var t = setTimeout(function () { if (!done) { done = true; resolve({ returnValue: false, errorText: 'timeout' }); } }, 6000);
        b.onservicecallback = function (m) { if (done) return; done = true; clearTimeout(t); var r; try { r = JSON.parse(m); } catch (e) { r = { returnValue: false, errorText: 'parse' }; } resolve(r); };
        b.call('luna://' + SERVICE + '/' + method, JSON.stringify(params || {}));
      } catch (e) { resolve({ returnValue: false, errorText: String(e) }); }
    });
  }

  // Appel d'un service quelconque (ex. lancer YouTube). Résout toujours, jamais d'exception.
  function lunaUri(uri, params) {
    return new Promise(function (resolve) {
      try {
        if (typeof PalmServiceBridge === 'undefined') return resolve({ returnValue: false, errorText: 'no-bridge' });
        var b = new PalmServiceBridge(), done = false;
        var t = setTimeout(function () { if (!done) { done = true; resolve({ returnValue: false, errorText: 'timeout' }); } }, 6000);
        b.onservicecallback = function (m) { if (done) return; done = true; clearTimeout(t); var r; try { r = JSON.parse(m); } catch (e) { r = { returnValue: false, errorText: 'parse' }; } resolve(r); };
        b.call(uri, JSON.stringify(params || {}));
      } catch (e) { resolve({ returnValue: false, errorText: String(e) }); }
    });
  }

  /* ---------- Écran de connexion ---------- */
  function login(opts) {
    return new Promise(function (resolve) {
      var cfg = Xt.cfg || {};
      var msg = el('div', { class: 'msg', text: 'Saisis les identifiants de ton fournisseur (une seule fois, enregistrés sur la TV).' });
      var inSrv = el('input', { f: 1, type: 'text', placeholder: 'http://serveur:port  (ou colle l’URL M3U)', value: cfg.server || '', autocapitalize: 'off', autocomplete: 'off' });
      var inUser = el('input', { f: 1, type: 'text', placeholder: 'Utilisateur', value: cfg.username || '', autocapitalize: 'off', autocomplete: 'off' });
      var inPass = el('input', { f: 1, type: 'text', placeholder: 'Mot de passe', value: cfg.password || '', autocapitalize: 'off', autocomplete: 'off' });
      var btn = el('button', { f: 1, class: 'btn primary', text: 'Se connecter' });
      var pairBox = el('div', { class: 'pair hidden' });
      var box = el('div', { class: 'login' }, [el('h1', { text: opts && opts.title || 'IPTV' }), pairBox, msg, inSrv, inUser, inPass, btn]);
      var layer = el('div', { class: 'layer' }, [box]);
      document.body.appendChild(layer); Nav.push(layer); Nav.first();
      var poll = null, finished = false;
      function finish(ui) { if (finished) return; finished = true; clearInterval(poll); luna('stopPair'); Nav.pop(); layer.remove(); resolve(ui); }
      function useConfig(c) {
        Xt.cfg = { server: c.server, username: c.username, password: c.password };
        if (c.tmdb) ls('tmdb', c.tmdb);
        msg.className = 'msg'; msg.textContent = 'Vérification…';
        return Xt.auth().then(function (r) {
          var ui = r && r.user_info;
          if (!ui || String(ui.auth) !== '1') { msg.className = 'msg err'; msg.textContent = 'Identifiants refusés par le serveur.'; Xt.cfg = null; return false; }
          Xt.save(Xt.cfg); finish(ui); return true;
        }).catch(function () { msg.className = 'msg err'; msg.textContent = 'Serveur injoignable.'; Xt.cfg = null; return false; });
      }
      luna('startPair').then(function (r) {
        if (!r || !r.returnValue) return;   // pas de service : saisie sur la TV uniquement
        var url = 'http://' + ((r.ips && r.ips[0]) || '<IP de la TV>') + ':' + r.port;
        pairBox.classList.remove('hidden');
        pairBox.appendChild(el('div', { class: 'pt', text: 'Depuis ton téléphone (même Wi-Fi) :' }));
        pairBox.appendChild(el('div', { class: 'pu', text: url }));
        pairBox.appendChild(el('div', { class: 'pc', text: 'Code : ' + r.code }));
        var busy = false;
        poll = setInterval(function () {
          if (busy || finished) return; busy = true;
          luna('pairStatus').then(function (s) { if (s && s.config && s.config.server && !finished) return useConfig(s.config); }).then(function () { busy = false; });
        }, 2000);
      });
      inSrv.addEventListener('change', function () {
        var p = Xt.parseServer(inSrv.value);
        if (p) { inSrv.value = p.server; if (p.username) inUser.value = p.username; if (p.password) inPass.value = p.password; }
      });
      btn.addEventListener('click', function () {
        var p = Xt.parseServer(inSrv.value);
        if (!p || !inUser.value.trim() || !inPass.value.trim()) { msg.textContent = 'Serveur, utilisateur et mot de passe sont requis.'; msg.className = 'msg err'; return; }
        Xt.cfg = { server: p.server, username: inUser.value.trim(), password: inPass.value.trim() };
        msg.className = 'msg'; msg.textContent = 'Vérification…'; btn.disabled = true;
        Xt.auth().then(function (r) {
          btn.disabled = false;
          var ui = r && r.user_info;
          if (!ui || String(ui.auth) !== '1') { msg.className = 'msg err'; msg.textContent = 'Identifiants refusés par le serveur.'; return; }
          if (ui.status && ui.status !== 'Active') { msg.className = 'msg err'; msg.textContent = 'Compte non actif : ' + ui.status; return; }
          Xt.save(Xt.cfg); Nav.pop(); layer.remove(); resolve(ui);
        }).catch(function (e) {
          btn.disabled = false; msg.className = 'msg err';
          msg.textContent = 'Serveur injoignable (' + (e && e.message || 'erreur') + '). Vérifie l’adresse et le port.';
        });
      });
    });
  }
  function ensureLogin(opts) {
    // Identifiants partagés entre les 3 apps IPTV (fichier géré par le service) : une seule saisie.
    return luna('getConfig').then(function (r) {
      var c = r && r.config;
      if (c && c.server && c.username) {
        if (c.tmdb) ls('tmdb', c.tmdb);
        var cur = Xt.cfg;
        if (!cur || cur.server !== c.server || cur.username !== c.username || cur.password !== c.password) Xt.save({ server: c.server, username: c.username, password: c.password });
        return null;
      }
      if (Xt.cfg) { luna('setConfig', { config: Object.assign({}, Xt.cfg, ls('tmdb') ? { tmdb: ls('tmdb') } : {}) }); return null; }
      return login(opts);
    });
  }

  function tmdbPrompt() {
    var inp = el('input', { f: 1, type: 'text', placeholder: 'Clé API TMDB (v3)', value: ls('tmdb') || '', autocapitalize: 'off', autocomplete: 'off' });
    var ok = el('button', { f: 1, class: 'btn primary', text: 'Enregistrer' });
    var box = el('div', { class: 'menu' }, [el('div', { class: 'msg', text: 'Clé gratuite sur themoviedb.org (Paramètres → API). Laisse vide pour désactiver.' }), inp, ok]);
    var layer = el('div', { class: 'layer dim' }, [box]);
    document.body.appendChild(layer); Nav.push(layer); Nav.first();
    function close() { off(); Nav.pop(); layer.remove(); }
    var off = onKey(function (ev, k) { if (k === KEY.BACK || k === KEY.ESC) { close(); return true; } return false; });
    ok.addEventListener('click', function () {
      var v = inp.value.replace(/[^A-Za-z0-9]/g, ''); ls('tmdb', v || null);
      if (Xt.cfg) luna('setConfig', { config: Object.assign({}, Xt.cfg, v ? { tmdb: v } : {}) });
      close(); toast(v ? 'Clé TMDB enregistrée' : 'TMDB désactivé');
    });
  }

  /* ---------- Menu réglages (touche rouge) ---------- */
  function settings(extra) {
    var items = (extra || []).concat([
      { label: 'Clé TMDB (descriptions, acteurs, trailers)…', run: tmdbPrompt },
      { label: 'Rafraîchir le catalogue', run: function () { DB.clear().then(function () { location.reload(); }); } },
      { label: 'Changer de compte (toutes les apps IPTV)', run: function () { luna('clearConfig').then(function () { return Xt.clearAccount(); }).then(function () { location.reload(); }); } },
      { label: 'Fermer', run: function () {} }
    ]);
    var list = el('div', { class: 'menu' }, items.map(function (it) {
      var b = el('button', { f: 1, class: 'btn', text: it.label });
      b.addEventListener('click', function () { close(); it.run(); });
      return b;
    }));
    var layer = el('div', { class: 'layer dim' }, [list]);
    document.body.appendChild(layer); Nav.push(layer); Nav.first();
    var off = onKey(function (ev, k) { if (k === KEY.BACK || k === KEY.ESC || k === KEY.RED) { close(); return true; } return false; });
    function close() { off(); Nav.pop(); layer.remove(); }
  }

  /* ---------- Utilitaires ---------- */
  function fmtTime(s) {
    s = Math.max(0, Math.floor(s || 0)); var h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
    return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (x < 10 ? '0' : '') + x;
  }
  function norm(s) { return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function setBack(fn) { backFallback = fn; }

  window.IPTV = { KEY: KEY, $: $, el: el, sleep: sleep, b64: b64, ls: ls, DB: DB, Xt: Xt, DAY: DAY, Nav: Nav,
    onKey: onKey, setBack: setBack, exitApp: exitApp, toast: toast, Player: Player, login: login,
    ensureLogin: ensureLogin, luna: luna, lunaUri: lunaUri, settings: settings, fmtTime: fmtTime, norm: norm, release: release };
})();
