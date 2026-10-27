(function () {
  'use strict';
  var I = IPTV, el = I.el, Xt = I.Xt, Nav = I.Nav, Player = I.Player, KEY = I.KEY;
  var video = I.$('#video'); Player.init(video);

  var ZAP_DELAY = 450;           // un chaîne survolée moins de 450 ms n'est jamais demandée au serveur
  var channels = [], cats = [], favs = I.ls('live.favs') || [];
  var listCat = null;            // catégorie dont on zappe la liste
  var cur = null;                // chaîne en cours
  var zapT, retries = 0, okT;

  var zap = el('div', { class: 'zap off' });
  document.body.appendChild(zap);
  var zapHide;
  function showZap(ch, epg) {
    zap.innerHTML = '';
    zap.appendChild(el('div', { class: 'h' }, [el('b', { text: ch.num }), document.createTextNode(ch.name)]));
    if (epg && epg[0]) zap.appendChild(el('div', { class: 'e', text: 'Maintenant : ' + epg[0] }));
    if (epg && epg[1]) zap.appendChild(el('div', { class: 'e2', text: 'Ensuite : ' + epg[1] }));
    zap.classList.remove('off'); clearTimeout(zapHide); zapHide = setTimeout(function () { zap.classList.add('off'); }, 4500);
  }

  function urls(ch) {
    var ts = Xt.stream('live', ch.id, 'ts'), hls = Xt.stream('live', ch.id, 'm3u8');
    return (I.ls('live.mode') === 'hls') ? [hls, ts] : [ts, hls];
  }
  function fetchEpg(ch) {
    Xt.call('get_short_epg', { stream_id: ch.id, limit: 2 }, 120000).then(function (r) {
      if (cur !== ch) return;
      var l = (r && r.epg_listings) || [];
      showZap(ch, l.map(function (e) {
        var t = I.b64(e.title || ''), s = e.start_timestamp ? new Date(e.start_timestamp * 1000) : null;
        return (s ? ('0' + s.getHours()).slice(-2) + ':' + ('0' + s.getMinutes()).slice(-2) + '  ' : '') + t;
      }));
    }).catch(function () {});
  }
  // Lance réellement la chaîne (appelé après le délai anti-rafale).
  function start(ch) {
    cur = ch; I.ls('live.last', ch.id); retries = 0;
    showZap(ch);
    Player.play(urls(ch), 0).then(function (ok) {
      if (cur !== ch) return;
      if (ok) { fetchEpg(ch); clearTimeout(okT); okT = setTimeout(function () { retries = 0; }, 15000); }
      else I.toast('Chaîne indisponible (ou connexions max atteintes).', 4000);
    });
  }
  // Demande de zapping : affiche tout de suite, ne contacte le serveur qu'après stabilisation.
  function tune(ch, immediate) {
    clearTimeout(zapT);
    showZap(ch);
    markOn(ch);
    zapT = setTimeout(function () { start(ch); }, immediate ? 0 : ZAP_DELAY);
    cur = ch;
  }
  // Flux coupé en cours de route : on se reconnecte (3 essais max), sans rafale.
  function recover() {
    if (!cur || !Player.active || document.hidden || retries >= 3 || panel) return;
    retries++; var ch = cur;
    setTimeout(function () { if (cur === ch && !document.hidden) start(ch); }, 1500 * retries);
  }
  video.addEventListener('error', function () { if (video.getAttribute('src')) recover(); });
  video.addEventListener('ended', recover);

  function list() { return listCat === 'fav' ? channels.filter(function (c) { return favs.indexOf(c.id) >= 0; }) : channels.filter(function (c) { return c.cat === listCat; }); }
  function step(d) {
    var l = list(); if (!l.length) return;
    var i = l.indexOf(cur); if (i < 0) i = 0; else i = (i + d + l.length) % l.length;
    tune(l[i]);
  }

  /* ---------- Panneau chaînes ---------- */
  var panel = null;
  function markOn(ch) {
    if (!panel) return;
    Array.prototype.forEach.call(panel.list.children, function (n) { n.classList.toggle('on', n._ch === ch); });
  }
  function toggleFav(ch) {
    var i = favs.indexOf(ch.id);
    if (i >= 0) favs.splice(i, 1); else favs.push(ch.id);
    I.ls('live.favs', favs); I.toast(i >= 0 ? 'Retiré des favoris' : '★ Ajouté aux favoris');
  }
  function openPanel() {
    if (panel) return;
    var selCat = listCat || (cats[0] && cats[0].id);
    var catsBox = el('div', { class: 'cats' }), listBox = el('div', { class: 'list' });
    var search = el('input', { f: 1, type: 'text', placeholder: 'Rechercher une chaîne…' });
    var pv = el('div', { class: 'pv' });
    var root = el('div', { class: 'live' + (Player.active ? '' : ' solid') }, [catsBox, el('div', { class: 'chans' }, [search, listBox]), pv,
      el('div', { class: 'hint', text: 'OK : regarder   ·   Rouge : réglages   ·   Vert : favori' })]);
    document.body.appendChild(root); Nav.push(root);
    panel = { root: root, list: listBox, close: function () { clearTimeout(pvT); pvTok++; } };
    var view = [], shown = 0, pvT = null, pvTok = 0;

    function hhmm(ts) { var d = new Date(ts * 1000); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }
    // Aperçu : uniquement le guide (aucun flux ouvert) ; demandé après 450 ms d'arrêt sur la chaîne.
    function preview(ch) {
      clearTimeout(pvT); var tok = ++pvTok;
      pv.innerHTML = '';
      var logo = el('div', { class: 'pl' }); if (ch.logo) logo.style.backgroundImage = 'url("' + ch.logo.replace(/"/g, '%22') + '")';
      pv.appendChild(el('div', { class: 'ph2' }, [logo, el('div', { class: 'pn', text: ch.num + '  ' + ch.name })]));
      var body = el('div', { class: 'pb' }, [el('div', { class: 'pm', text: 'Chargement du programme…' })]); pv.appendChild(body);
      pvT = setTimeout(function () {
        Xt.call('get_short_epg', { stream_id: ch.id, limit: 3 }, 120000).then(function (r) {
          if (tok !== pvTok) return;
          var l = ((r && r.epg_listings) || []).map(function (e) {
            return { t: I.b64(e.title || ''), d: I.b64(e.description || ''), s: parseInt(e.start_timestamp, 10), e: parseInt(e.stop_timestamp, 10) };
          }), now = Math.floor(Date.now() / 1000);
          body.innerHTML = '';
          if (!l.length) { body.appendChild(el('div', { class: 'pm', text: 'Pas de guide pour cette chaîne.' })); return; }
          var i = 0; l.forEach(function (x, k) { if (x.s <= now && now < x.e) i = k; });
          var c = l[i];
          body.appendChild(el('div', { class: 'pk', text: 'EN CE MOMENT' }));
          body.appendChild(el('div', { class: 'pt2', text: c.t }));
          if (c.s && c.e) {
            body.appendChild(el('div', { class: 'pm', text: hhmm(c.s) + ' – ' + hhmm(c.e) }));
            var bar = el('i'); bar.style.width = Math.max(0, Math.min(100, 100 * (now - c.s) / Math.max(1, c.e - c.s))) + '%';
            body.appendChild(el('div', { class: 'pbar' }, [bar]));
          }
          if (c.d) body.appendChild(el('div', { class: 'pd', text: c.d.length > 360 ? c.d.slice(0, 357) + '…' : c.d }));
          l.slice(i + 1, i + 3).forEach(function (x) { body.appendChild(el('div', { class: 'pn2', text: (x.s ? hhmm(x.s) + '  ' : '') + x.t })); });
        }).catch(function () { if (tok === pvTok) { body.innerHTML = ''; body.appendChild(el('div', { class: 'pm', text: 'Guide indisponible.' })); } });
      }, 450);
    }

    function drawCats() {
      catsBox.innerHTML = '';
      [{ id: 'fav', name: '★ Favoris' }].concat(cats).forEach(function (c) {
        var b = el('button', { f: 1, class: 'cat' + (c.id === selCat ? ' sel' : ''), text: c.name });
        b.addEventListener('click', function () { selCat = c.id; search.value = ''; drawCats(); drawList(); Nav.focus(listBox.firstChild || b); });
        catsBox.appendChild(b);
      });
    }
    function row(ch) {
      var logo = el('div', { class: 'logo' });
      if (ch.logo) logo.style.backgroundImage = 'url("' + ch.logo.replace(/"/g, '%22') + '")';
      var r = el('div', { f: 1, class: 'ch' + (ch === cur ? ' on' : '') }, [el('div', { class: 'n', text: ch.num }), logo,
        el('div', { class: 't', text: ch.name }), favs.indexOf(ch.id) >= 0 ? el('div', { class: 'fav', text: '★' }) : null]);
      r._ch = ch;
      r.addEventListener('click', function () { listCat = selCat === 'fav' ? 'fav' : ch.cat; closePanel(); tune(ch, true); });
      r.addEventListener('focus', function () { if (view.indexOf(ch) >= shown - 10) more(); preview(ch); });
      return r;
    }
    function more() { var end = Math.min(view.length, shown + 60); for (var i = shown; i < end; i++) listBox.appendChild(row(view[i])); shown = end; }
    function drawList() {
      var q = I.norm(search.value.trim());
      view = q ? channels.filter(function (c) { return c.nn.indexOf(q) >= 0; })
        : (selCat === 'fav' ? channels.filter(function (c) { return favs.indexOf(c.id) >= 0; }) : channels.filter(function (c) { return c.cat === selCat; }));
      listBox.innerHTML = ''; shown = 0; more();
      if (!view.length) listBox.appendChild(el('div', { class: 'empty', text: selCat === 'fav' && !q ? 'Aucun favori : appuie sur le bouton vert sur une chaîne.' : 'Aucun résultat.' }));
    }
    var st; search.addEventListener('input', function () { clearTimeout(st); st = setTimeout(drawList, 350); });
    drawCats(); drawList();
    var curRow = Array.prototype.filter.call(listBox.children, function (n) { return n._ch === cur; })[0];
    Nav.focus(curRow || listBox.firstChild || catsBox.firstChild);

    panel.off = I.onKey(function (ev, k) {
      var f = document.activeElement, cl = (f && f.classList) || { contains: function () { return false; } };
      var inList = !!(f && f._ch), inCats = cl.contains('cat'), inSearch = f === search, firstRow = listBox.firstChild && listBox.firstChild._ch ? listBox.firstChild : null;
      var selCatEl = catsBox.querySelector('.cat.sel') || catsBox.firstChild;
      // Navigation par zones : catégories ← → chaînes, recherche au-dessus des chaînes.
      if (k === KEY.LEFT && inList) { Nav.focus(selCatEl); return true; }
      if (k === KEY.LEFT && inSearch && search.selectionStart === 0) { Nav.focus(selCatEl); return true; }
      if (k === KEY.RIGHT && inCats) { Nav.focus(firstRow || search); return true; }
      if (k === KEY.UP && inList && f === firstRow) { Nav.focus(search); return true; }
      if (k === KEY.DOWN && inSearch) { Nav.focus(firstRow || selCatEl); return true; }
      if (k === KEY.GREEN && f && f._ch) { toggleFav(f._ch); var n = row(f._ch); f.replaceWith(n); Nav.focus(n); return true; }
      if (k === KEY.RED) { openSettings(); return true; }
      return false;
    });
  }
  function closePanel() { if (!panel) return; panel.off(); panel.close && panel.close(); Nav.pop(); panel.root.remove(); panel = null; }
  function openSettings() {
    var mode = I.ls('live.mode') === 'hls' ? 'hls' : 'ts';
    I.settings([{ label: 'Mode : ' + (mode === 'ts' ? 'TS direct (latence minimale) → passer en HLS' : 'HLS (plus compatible) → passer en TS direct'),
      run: function () { I.ls('live.mode', mode === 'ts' ? 'hls' : 'ts'); I.toast('Mode ' + (mode === 'ts' ? 'HLS' : 'TS direct') + ' activé'); if (cur) start(cur); } }]);
  }

  /* ---------- Touches en lecture plein écran ---------- */
  I.onKey(function (ev, k) {
    if (panel || Nav.layer !== document.body) return false;
    if (k === KEY.UP || k === KEY.CHUP) { step(-1); return true; }
    if (k === KEY.DOWN || k === KEY.CHDOWN) { step(1); return true; }
    if (k === KEY.ENTER || k === KEY.LEFT || k === KEY.RIGHT) { openPanel(); return true; }
    if (k === KEY.RED) { openSettings(); return true; }
    if (k === KEY.GREEN && cur) { toggleFav(cur); return true; }
    return false;
  });
  // Retour : ferme le panneau ; sinon quitte l'app (le flux est coupé par le socle commun).
  I.setBack(function () {
    if (panel) { if (Player.active || cur) closePanel(); else I.exitApp(); }
    else { I.release(); I.exitApp(); }
  });

  /* ---------- Démarrage ---------- */
  I.ensureLogin({ title: 'IPTVLive' }).then(function () {
    return Promise.all([Xt.call('get_live_categories', {}, I.DAY), Xt.call('get_live_streams', {}, I.DAY)]);
  }).then(function (r) {
    channels = (r[1] || []).map(function (s, i) {
      return { id: s.stream_id, name: s.name || '', nn: I.norm(s.name), logo: s.stream_icon || '', cat: String(s.category_id), num: s.num || (i + 1) };
    });
    var used = {}; channels.forEach(function (c) { used[c.cat] = 1; });
    cats = (r[0] || []).map(function (c) { return { id: String(c.category_id), name: c.category_name }; }).filter(function (c) { return used[c.id]; });
    var last = I.ls('live.last'), ch = null;
    channels.forEach(function (c) { if (c.id === last) ch = c; });
    if (ch) { listCat = ch.cat; tune(ch, true); } else { listCat = cats[0] && cats[0].id; openPanel(); }
  }).catch(function (e) {
    I.toast('Catalogue indisponible : ' + (e && e.message), 6000);
  });
})();
