/* Parcours catalogue (films / séries) + lecteur VOD avec reprise */
(function () {
  'use strict';
  var I = window.IPTV, el = I.el, KEY = I.KEY, Xt = I.Xt, Player = I.Player, Nav = I.Nav;

  /* ---------- Reprise de lecture ---------- */
  var Prog = {
    all: function () { return I.ls('prog') || {}; },
    get: function (k) { return this.all()[k] || null; },
    set: function (k, p, d, meta) {
      var a = this.all();
      if (p <= 0 || (d > 0 && p / d > 0.95)) { delete a[k]; }
      else if (p > 15) { a[k] = { p: p, d: d, t: Date.now(), meta: meta || (a[k] && a[k].meta) }; }
      var keys = Object.keys(a);
      if (keys.length > 300) { keys.sort(function (x, y) { return a[x].t - a[y].t; }).slice(0, keys.length - 300).forEach(function (x) { delete a[x]; }); }
      I.ls('prog', a);
    }
  };

  /* ---------- Pistes audio / sous-titres ---------- */
  function trackMenu(video, kind, onDone) {
    var list = kind === 'audio' ? video.audioTracks : video.textTracks, rows = [];
    if (list) for (var i = 0; i < list.length; i++) {
      var t = list[i]; if (kind === 'text' && t.kind && !/subtitles|captions/.test(t.kind)) continue;
      rows.push({ i: i, label: (t.label || t.language || ('Piste ' + (i + 1))) + (t.language && t.label ? ' (' + t.language + ')' : ''),
        on: kind === 'audio' ? !!t.enabled : t.mode === 'showing' });
    }
    if (!rows.length) { I.toast(kind === 'audio' ? 'Pas d’autre piste audio dans ce flux.' : 'Pas de sous-titres dans ce flux.', 3500); onDone(); return; }
    var box = el('div', { class: 'menu' }, [el('div', { class: 'msg', text: kind === 'audio' ? 'Langue audio' : 'Sous-titres' })]);
    function pick(r) {
      for (var j = 0; j < list.length; j++) {
        if (kind === 'audio') list[j].enabled = (j === r.i); else if (list[j].kind !== 'metadata') list[j].mode = (j === r.i ? 'showing' : 'disabled');
      }
      close();
    }
    if (kind === 'text') rows.unshift({ i: -1, label: 'Désactivés', on: !rows.some(function (r) { return r.on; }) });
    rows.forEach(function (r) {
      var b = el('button', { f: 1, class: 'btn' + (r.on ? ' primary' : ''), text: (r.on ? '✓ ' : '') + r.label });
      b.addEventListener('click', function () { pick(r); }); box.appendChild(b);
    });
    var layer = el('div', { class: 'layer dim' }, [box]);
    document.body.appendChild(layer); Nav.push(layer); Nav.first();
    var off = I.onKey(function (ev, k) { if (k === KEY.BACK || k === KEY.ESC || k === KEY.BKSP) { close(); return true; } return false; });
    function close() { off(); Nav.pop(); layer.remove(); onDone(); }
  }

  /* ---------- Bande-annonce : ouvre l'app YouTube de la TV (n'utilise aucune connexion du fournisseur) ---------- */
  function trailer(ytId) {
    if (!/^[A-Za-z0-9_-]{11}$/.test(ytId || '')) { I.toast('Bande-annonce indisponible.', 3000); return; }
    var target = 'https://www.youtube.com/tv?v=' + ytId;
    I.toast('Ouverture de YouTube…', 3000);
    I.lunaUri('luna://com.webos.applicationManager/launch', { id: 'youtube.leanback.v4', params: { contentTarget: target } }).then(function (r) {
      if (r && r.returnValue) return;
      // repli : lancement via le service root de Homebrew Channel
      var cmd = "luna-send -n 1 luna://com.webos.applicationManager/launch '" + JSON.stringify({ id: 'youtube.leanback.v4', params: { contentTarget: target } }) + "'";
      return I.lunaUri('luna://org.webosbrew.hbchannel.service/exec', { command: cmd }).then(function (r2) {
        if (!(r2 && r2.returnValue)) I.toast('Impossible d’ouvrir YouTube depuis l’app (' + ((r && r.errorText) || 'refusé') + ').', 5000);
      });
    });
  }

  /* ---------- Métadonnées enrichies : TMDB (clé optionnelle) ou Wikipédia (photos, titre exact uniquement) ---------- */
  var Meta = {
    ytId: function (v) {
      if (!v) return null; v = String(v).trim();
      var m = v.match(/(?:v=|youtu\.be\/|embed\/)([A-Za-z0-9_-]{11})/); if (m) return m[1];
      return /^[A-Za-z0-9_-]{11}$/.test(v) ? v : null;
    },
    names: function (str) {
      var seen = {};
      return String(str || '').split(/,|\/|;/).map(function (x) { return x.trim(); }).filter(function (x) { if (!x || seen[x]) return false; seen[x] = 1; return true; }).slice(0, 10);
    },
    wiki: function (names) {
      var out = {};
      function q(host, list) {
        if (!list.length) return Promise.resolve();
        var u = 'https://' + host + '/w/api.php?action=query&format=json&origin=*&redirects=1&prop=pageimages&piprop=thumbnail&pithumbsize=240&titles=' + encodeURIComponent(list.join('|'));
        return fetch(u).then(function (r) { return r.json(); }).then(function (j) {
          var qr = j.query || {}, norm = {}, red = {};
          (qr.normalized || []).forEach(function (n) { norm[n.to] = n.from; });
          (qr.redirects || []).forEach(function (r) { red[r.to] = r.from; });
          Object.keys(qr.pages || {}).forEach(function (id) {
            var p = qr.pages[id]; if (!p.thumbnail) return;
            var from = red[p.title] || p.title; from = norm[from] || from; out[from] = p.thumbnail.source;
          });
        }).catch(function () {});
      }
      return q('fr.wikipedia.org', names).then(function () { return q('en.wikipedia.org', names.filter(function (n) { return !out[n]; })); }).then(function () { return out; });
    },
    // o : { kind:'movie'|'tv', tmdbId, castStr }  → { overview, cast:[{name,role,photo}], trailer }
    enrich: function (o) {
      var self = this, key = I.ls('tmdb') || null, ck = 'meta|' + o.kind + '|' + (o.tmdbId || o.castStr) + '|' + (key ? 1 : 0);
      return I.DB.get(ck).then(function (hit) {
        if (hit && Date.now() - hit.t < 7 * 86400000) return hit.v;
        var p = Promise.resolve(null);
        if (key && o.tmdbId) {
          p = fetch('https://api.themoviedb.org/3/' + o.kind + '/' + encodeURIComponent(o.tmdbId) + '?api_key=' + encodeURIComponent(key) + '&language=fr-FR&include_video_language=fr,en&append_to_response=credits,videos')
            .then(function (r) { if (!r.ok) throw new Error('tmdb'); return r.json(); }).then(function (j) {
              var cast = ((j.credits && j.credits.cast) || []).slice(0, 12).map(function (c) { return { name: c.name, role: c.character, photo: c.profile_path ? 'https://image.tmdb.org/t/p/w185' + c.profile_path : null }; });
              var vids = ((j.videos && j.videos.results) || []).filter(function (v) { return v.site === 'YouTube'; });
              var tr = vids.filter(function (v) { return v.type === 'Trailer' && v.iso_639_1 === 'fr'; })[0] || vids.filter(function (v) { return v.type === 'Trailer'; })[0] || vids[0];
              return { overview: j.overview || '', cast: cast, trailer: tr ? tr.key : null };
            }).catch(function () { return null; });
        }
        return p.then(function (v) {
          v = v || { overview: '', cast: [], trailer: null };
          if (v.cast.length) return v;
          var names = self.names(o.castStr);
          if (!names.length) return v;
          return self.wiki(names).then(function (m) { v.cast = names.map(function (n) { return { name: n, photo: m[n] || null }; }); return v; });
        }).then(function (v) { I.DB.set(ck, { t: Date.now(), v: v }); return v; });
      });
    }
  };

  // Rangée d'acteurs : photo ronde (ou initiale si pas de photo), nom, rôle.
  function castView(box, cast) {
    box.innerHTML = '';
    (cast || []).forEach(function (c) {
      var ph = el('div', { class: 'av', text: (c.name || '?').charAt(0) });
      if (c.photo) { var im = el('img', { alt: '', loading: 'lazy' }); im.onload = function () { ph.textContent = ''; }; im.onerror = function () { im.remove(); }; im.src = c.photo; ph.appendChild(im); }
      box.appendChild(el('div', { class: 'cs' }, [ph, el('div', { class: 'cn', text: c.name }), c.role ? el('div', { class: 'cr', text: c.role }) : null]));
    });
  }

  /* ---------- Fond flou plein écran (fiche) ---------- */
  function backdrop(layer, url) {
    if (!url) return;
    var bg = el('div', { class: 'bd' }); bg.style.backgroundImage = 'url("' + String(url).replace(/"/g, '%22') + '")';
    layer.insertBefore(bg, layer.firstChild);
  }

  /* ---------- Lecteur VOD ---------- */
  // opts : { url, key, title, sub, meta, onEnded, onClose }
  function playVod(opts) {
    var video = I.$('#video');
    var title = el('div', { class: 'title', text: opts.title || '' });
    var sub = el('div', { class: 'sub', text: opts.sub || '' });
    var bar = el('i'), cur = el('span', { text: '0:00' }), dur = el('span', { text: '0:00' });
    var osd = el('div', { class: 'osd' }, [title, sub, el('div', { class: 'keys', text: '◀ ▶ ±10 s   ▲ ▼ ±1 min   Jaune/Vert : langue audio   Bleu/Rouge : sous-titres' }), el('div', { class: 'prog' }, [bar]), el('div', { class: 'tm' }, [cur, dur])]);
    var layer = el('div', { class: 'layer dim', style: 'background:transparent' });
    layer.setAttribute('tabindex', '-1');
    document.body.appendChild(layer); layer.appendChild(osd);
    Nav.push(layer);
    var hideT, saveT, closed = false, saved = Prog.get(opts.key);

    function show() { osd.classList.remove('off'); clearTimeout(hideT); hideT = setTimeout(function () { if (!video.paused) osd.classList.add('off'); }, 4000); }
    function refresh() {
      var d = video.duration || 0, c = video.currentTime || 0;
      bar.style.width = d ? (100 * c / d) + '%' : '0'; cur.textContent = I.fmtTime(c); dur.textContent = I.fmtTime(d);
    }
    function persist() { if (video.duration) Prog.set(opts.key, video.currentTime, video.duration, opts.meta); }
    function seek(delta) { if (!video.duration) return; video.currentTime = Math.min(video.duration - 1, Math.max(0, video.currentTime + delta)); refresh(); show(); }
    function toggle() { if (video.paused) video.play(); else video.pause(); show(); }
    function close(ended) {
      if (closed) return; closed = true;
      persist(); clearInterval(saveT); clearTimeout(hideT);
      video.removeEventListener('timeupdate', refresh); video.removeEventListener('ended', onEnd); video.removeEventListener('pause', show);
      off(); Player.stop(); Nav.pop(); layer.remove();
      if (ended && opts.onEnded) opts.onEnded(); else if (opts.onClose) opts.onClose();
    }
    function tracks(kind) { video.pause(); trackMenu(video, kind, function () { video.play(); show(); }); }
    function onEnd() { Prog.set(opts.key, 1, 1); close(true); }
    var off = I.onKey(function (ev, k) {
      if (k === KEY.BACK || k === KEY.ESC || k === KEY.BKSP || k === KEY.STOP) { close(false); return true; }
      if (k === KEY.LEFT || k === KEY.RW) { seek(-10); return true; }
      if (k === KEY.RIGHT || k === KEY.FF) { seek(10); return true; }
      if (k === KEY.UP) { seek(60); return true; }
      if (k === KEY.DOWN) { seek(-60); return true; }
      if (k === KEY.ENTER || k === KEY.PLAY || k === KEY.PAUSE) { toggle(); return true; }
      if (k === KEY.YELLOW || k === KEY.GREEN) { tracks('audio'); return true; }
      if (k === KEY.BLUE || k === KEY.RED) { tracks('text'); return true; }
      return true; // la lecture capte toutes les touches
    });
    video.addEventListener('timeupdate', refresh); video.addEventListener('ended', onEnd); video.addEventListener('pause', show);
    saveT = setInterval(persist, 10000);
    show();
    Player.play([opts.url], saved ? Math.max(0, saved.p - 5) : 0).then(function (ok) {
      if (!ok && !closed) { I.toast('Lecture impossible (format non pris en charge ou connexions max).', 4500); close(false); }
    });
    // si l'app est mise en arrière-plan, le lecteur est déjà coupé par core.js : on referme proprement l'écran
    document.addEventListener('visibilitychange', function h() { if (document.hidden) { document.removeEventListener('visibilitychange', h); close(false); } });
  }

  /* ---------- Parcours catalogue ---------- */
  // cfg : { title, catAction, listAction, map(raw)->{id,name,img,cat,...}, open(item), progKey(item) }
  function browse(cfg) {
    var root = el('div', { class: 'app' });
    var search = el('input', { f: 1, type: 'text', placeholder: 'Rechercher…', style: 'background:var(--panel2);padding:12px 24px;border-radius:30px;width:520px' });
    var top = el('div', { class: 'top' }, [el('h1', { text: cfg.title }), search, el('div', { class: 'pill', text: '● Menu' })]);
    var cats = el('div', { class: 'cats' }), grid = el('div', { class: 'grid' });
    root.appendChild(top); root.appendChild(el('div', { class: 'main' }, [cats, grid]));
    document.body.appendChild(root); Nav.layer = root;
    grid.appendChild(el('div', { class: 'empty', text: 'Chargement du catalogue…' }));

    var items = [], catList = [], curCat = 'all', view = [], shown = 0, CH = 42;

    function setCats() {
      cats.innerHTML = '';
      var base = [{ id: 'resume', name: '▶ Reprendre' }, { id: 'all', name: 'Tout' }].concat(catList);
      base.forEach(function (c) {
        var b = el('button', { f: 1, class: 'cat' + (c.id === curCat ? ' sel' : ''), text: c.name });
        b.addEventListener('click', function () { curCat = c.id; search.value = ''; setCats(); build(); Nav.focus(grid.firstChild || b); });
        cats.appendChild(b);
      });
    }
    function card(it) {
      var ph = el('div', { class: 'ph' });
      var fb = el('div', { class: 'fb', text: it.name });
      ph.appendChild(fb);
      if (it.img) {
        var im = el('img', { loading: 'lazy', decoding: 'async', alt: '' });
        im.onload = function () { fb.remove(); };
        im.onerror = function () { im.remove(); };
        im.src = it.img; ph.appendChild(im);
      }
      var c = el('div', { f: 1, class: 'card' }, [ph, el('div', { class: 'nm', text: it.name })]);
      if (it.rating && parseFloat(it.rating) > 0) c.appendChild(el('div', { class: 'rt', text: '★ ' + parseFloat(it.rating).toFixed(1) }));
      var pr = cfg.progKey && Prog.get(cfg.progKey(it));
      if (pr && pr.d) { var b = el('div', { class: 'bar' }); b.style.width = Math.min(100, 100 * pr.p / pr.d) + '%'; c.appendChild(b); }
      c.addEventListener('click', function () { cfg.open(it, refreshBars); });
      c.addEventListener('focus', function () { if (view.indexOf(it) >= shown - 12) more(); });
      return c;
    }
    function refreshBars() { build(true); }
    function more() {
      var end = Math.min(view.length, shown + CH);
      for (var i = shown; i < end; i++) grid.appendChild(card(view[i]));
      shown = end;
    }
    function build(keepFocus) {
      var q = I.norm(search.value.trim());
      if (curCat === 'resume') {
        var a = Prog.all();
        view = Object.keys(a).map(function (k) { return a[k]; }).filter(function (x) { return x.meta && x.meta.kind === cfg.kind; })
          .sort(function (x, y) { return y.t - x.t; }).map(function (x) { return x.meta.item; });
        // dédoublonnage (série : un seul bloc par série)
        var seen = {}; view = view.filter(function (it) { if (seen[it.id]) return false; seen[it.id] = 1; return true; });
      } else {
        view = items.filter(function (it) { return (curCat === 'all' || it.cat === curCat) && (!q || it.nn.indexOf(q) >= 0); });
      }
      grid.innerHTML = ''; shown = 0;
      if (!view.length) grid.appendChild(el('div', { class: 'empty', text: curCat === 'resume' ? 'Rien à reprendre pour l’instant.' : 'Aucun résultat.' }));
      else more();
    }
    var st;
    search.addEventListener('input', function () { clearTimeout(st); st = setTimeout(function () { curCat = 'all'; setCats(); build(); }, 350); });

    I.onKey(function (ev, k) {
      if (Nav.layer !== root) return false;
      if (k === KEY.RED) { I.settings(); return true; }
      var f = document.activeElement, cl = (f && f.classList) || { contains: function () { return false; } };
      var inGrid = cl.contains('card'), inCats = cl.contains('cat'), inSearch = f === search;
      var first = grid.querySelector('.card');
      if (k === KEY.LEFT && inGrid && first && f.offsetLeft === first.offsetLeft) { Nav.focus(cats.querySelector('.cat.sel') || cats.firstChild); return true; }
      if (k === KEY.LEFT && inSearch && search.selectionStart === 0) { Nav.focus(cats.querySelector('.cat.sel') || cats.firstChild); return true; }
      if (k === KEY.RIGHT && inCats) { Nav.focus(first); return true; }
      if (k === KEY.UP && inGrid && first && f.offsetTop === first.offsetTop) { Nav.focus(search); return true; }
      if (k === KEY.DOWN && inSearch) { Nav.focus(first || cats.firstChild); return true; }
      return false;
    });

    return Promise.all([Xt.call(cfg.catAction, {}, I.DAY), Xt.call(cfg.listAction, {}, I.DAY)]).then(function (r) {
      catList = (r[0] || []).map(function (c) { return { id: String(c.category_id), name: c.category_name }; });
      items = (r[1] || []).map(function (raw) { var it = cfg.map(raw); it.nn = I.norm(it.name); return it; });
      // ne garde que les catégories non vides
      var used = {}; items.forEach(function (i) { used[i.cat] = 1; });
      catList = catList.filter(function (c) { return used[c.id]; });
      curCat = Object.keys(Prog.all()).length && Object.keys(Prog.all()).some(function (k) { var m = Prog.all()[k].meta; return m && m.kind === cfg.kind; }) ? 'resume' : 'all';
      setCats(); build(); Nav.focus(grid.firstChild || cats.firstChild);
    }).catch(function (e) {
      grid.innerHTML = ''; grid.appendChild(el('div', { class: 'empty', text: 'Impossible de charger le catalogue (' + (e && e.message) + '). Appuie sur Retour puis relance.' }));
    });
  }

  window.VOD = { browse: browse, play: playVod, Prog: Prog, trailer: trailer, backdrop: backdrop, Meta: Meta, castView: castView };
})();
