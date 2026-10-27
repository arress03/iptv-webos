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

  /* ---------- Lecteur VOD ---------- */
  // opts : { url, key, title, sub, meta, onEnded, onClose }
  function playVod(opts) {
    var video = I.$('#video');
    var title = el('div', { class: 'title', text: opts.title || '' });
    var sub = el('div', { class: 'sub', text: opts.sub || '' });
    var bar = el('i'), cur = el('span', { text: '0:00' }), dur = el('span', { text: '0:00' });
    var osd = el('div', { class: 'osd' }, [title, sub, el('div', { class: 'prog' }, [bar]), el('div', { class: 'tm' }, [cur, dur])]);
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
    function onEnd() { Prog.set(opts.key, 1, 1); close(true); }
    var off = I.onKey(function (ev, k) {
      if (k === KEY.BACK || k === KEY.ESC || k === KEY.BKSP || k === KEY.STOP) { close(false); return true; }
      if (k === KEY.LEFT || k === KEY.RW) { seek(-10); return true; }
      if (k === KEY.RIGHT || k === KEY.FF) { seek(10); return true; }
      if (k === KEY.UP) { seek(60); return true; }
      if (k === KEY.DOWN) { seek(-60); return true; }
      if (k === KEY.ENTER || k === KEY.PLAY || k === KEY.PAUSE) { toggle(); return true; }
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
      var ph = el('div', { class: 'ph', text: it.img ? '' : it.name });
      if (it.img) {
        ph.style.backgroundImage = 'url("' + it.img.replace(/"/g, '%22') + '")';
        var probe = new Image(); probe.onerror = function () { ph.style.backgroundImage = ''; ph.textContent = it.name; }; probe.src = it.img;
      }
      var c = el('div', { f: 1, class: 'card' }, [ph, el('div', { class: 'nm', text: it.name })]);
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

  window.VOD = { browse: browse, play: playVod, Prog: Prog };
})();
