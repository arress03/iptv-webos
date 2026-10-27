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

  /* ---------- Bande-annonce (YouTube, n'utilise aucune connexion du fournisseur) ---------- */
  function trailer(ytId) {
    var fr = el('iframe', { src: 'https://www.youtube.com/embed/' + encodeURIComponent(ytId) + '?autoplay=1&rel=0&controls=1&hl=fr&cc_lang_pref=fr',
      allow: 'autoplay; encrypted-media; fullscreen', style: 'position:absolute;inset:0;width:100%;height:100%;border:0' });
    var hint = el('div', { class: 'msg', style: 'position:absolute;left:50%;bottom:24px;transform:translateX(-50%);z-index:2', text: 'Retour pour fermer' });
    var layer = el('div', { class: 'layer', style: 'background:#000;z-index:60' }, [fr, hint]);
    document.body.appendChild(layer); Nav.push(layer);
    var off = I.onKey(function (ev, k) { if (k === KEY.BACK || k === KEY.ESC || k === KEY.BKSP) { off(); Nav.pop(); layer.remove(); return true; } return false; });
    setTimeout(function () { hint.remove(); }, 4000);
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
      if (k === KEY.RED && Nav.layer === root) { I.settings(); return true; }
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

  window.VOD = { browse: browse, play: playVod, Prog: Prog, trailer: trailer, backdrop: backdrop };
})();
