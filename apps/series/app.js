(function () {
  'use strict';
  var I = IPTV, el = I.el, Xt = I.Xt, Nav = I.Nav;
  I.Player.init(I.$('#video'));

  function open(it, done) {
    var layer = el('div', { class: 'detail' });
    var poster = el('div', { class: 'poster' });
    if (it.img) poster.style.backgroundImage = 'url("' + it.img.replace(/"/g, '%22') + '")';
    var meta = el('div', { class: 'badges' }), plot = el('div', { class: 'plot', style: 'max-height:110px' }), trailerBtn = el('button', { f: 1, class: 'btn hidden', text: '🎬 Bande-annonce' });
    var seasonsBox = el('div', { class: 'seasons' }), eps = el('div', { class: 'eps' });
    layer.appendChild(poster);
    layer.appendChild(el('div', { class: 'info' }, [el('h1', { text: it.name }), meta, plot, el('div', { class: 'row' }, [trailerBtn]), seasonsBox, eps]));
    document.body.appendChild(layer); Nav.push(layer);
    var closed = false, data = null, curSeason = null, order = [];
    function close() { if (closed) return; closed = true; off(); Nav.pop(); layer.remove(); done && done(); }
    var off = I.onKey(function (ev, k) { if ((k === I.KEY.BACK || k === I.KEY.ESC || k === I.KEY.BKSP) && Nav.layer === layer) { close(); return true; } return false; });

    Xt.call('get_series_info', { series_id: it.id }, I.DAY).then(function (r) {
      data = r || {};
      var info = data.info || {};
      var bits = [info.releaseDate && String(info.releaseDate).slice(0, 4), info.genre].filter(Boolean);
      bits.forEach(function (b) { meta.appendChild(el('span', { text: b })); });
      if (parseFloat(info.rating) > 0) meta.appendChild(el('span', { class: 'star', text: '★ ' + parseFloat(info.rating).toFixed(1) }));
      plot.textContent = info.plot || '';
      var bd = Array.isArray(info.backdrop_path) ? info.backdrop_path[0] : info.backdrop_path;
      VOD.backdrop(layer, bd || info.cover || it.img);
      if (info.cover && !it.img) poster.style.backgroundImage = 'url("' + info.cover + '")';
      if (info.youtube_trailer) { trailerBtn.classList.remove('hidden'); trailerBtn.onclick = function () { VOD.trailer(info.youtube_trailer); }; }
      var ep = data.episodes || {};
      var nums = Object.keys(ep).sort(function (a, b) { return a - b; });
      if (!nums.length) { plot.textContent = 'Aucun épisode disponible.'; return; }
      // liste à plat pour enchaîner les épisodes
      order = [];
      nums.forEach(function (s) { ep[s].slice().sort(function (a, b) { return a.episode_num - b.episode_num; }).forEach(function (e) { e._s = s; order.push(e); }); });
      var last = lastSeen();
      curSeason = last ? String(last._s) : nums[0];
      seasonsBox.innerHTML = '';
      nums.forEach(function (s) {
        var b = el('button', { f: 1, class: 'cat' + (s === curSeason ? ' sel' : ''), text: 'Saison ' + s });
        b.addEventListener('click', function () { curSeason = s; Array.prototype.forEach.call(seasonsBox.children, function (c) { c.classList.toggle('sel', c === b); }); renderEps(); Nav.focus(eps.firstChild); });
        seasonsBox.appendChild(b);
      });
      renderEps(last);
      var target = last && eps.querySelector('[data-id="' + last.id + '"]');
      Nav.focus(target || eps.firstChild || seasonsBox.firstChild);
    }).catch(function (e) { plot.textContent = 'Erreur de chargement (' + (e && e.message) + ')'; });

    function lastSeen() {
      var best = null, bt = 0;
      order.forEach(function (e) { var p = VOD.Prog.get('e:' + e.id); if (p && p.t > bt) { bt = p.t; best = e; } });
      return best;
    }
    function renderEps() {
      eps.innerHTML = '';
      (data.episodes[curSeason] || []).slice().sort(function (a, b) { return a.episode_num - b.episode_num; }).forEach(function (e) {
        var p = VOD.Prog.get('e:' + e.id);
        var right = p ? (p.d ? Math.round(100 * p.p / p.d) + ' %' : '') : ((e.info && e.info.duration) || '');
        var th = el('div', { class: 'th' }); if (e.info && e.info.movie_image) th.style.backgroundImage = 'url("' + e.info.movie_image + '")';
        var row = el('div', { f: 1, class: 'ep', 'data-id': e.id }, [th, el('div', { class: 't', text: e.episode_num + '. ' + (e.title || 'Épisode ' + e.episode_num) }), el('div', { class: 's', text: right })]);
        row.addEventListener('click', function () { play(e); });
        eps.appendChild(row);
      });
    }
    function play(e) {
      layer.classList.add('hidden'); Nav.pop();
      var idx = order.indexOf(e), key = 'e:' + e.id;
      VOD.play({
        url: Xt.stream('series', e.id, e.container_extension || 'mp4'), key: key,
        title: it.name, sub: 'S' + e._s + ' · E' + e.episode_num + (e.title ? ' — ' + e.title : ''),
        meta: { kind: 'series', item: it },
        onClose: back,
        onEnded: function () { var n = order[idx + 1]; if (n) { Nav.push(layer); play(n); } else back(); }
      });
      function back() {
        Nav.push(layer); layer.classList.remove('hidden');
        if (data) { renderEps(); var t = eps.querySelector('[data-id="' + e.id + '"]'); Nav.focus(t || eps.firstChild); }
      }
    }
  }

  I.ensureLogin({ title: 'Séries' }).then(function () {
    VOD.browse({
      title: 'Séries', kind: 'series',
      catAction: 'get_series_categories', listAction: 'get_series',
      map: function (r) { return { id: r.series_id, name: r.name || '', img: r.cover || '', cat: String(r.category_id), rating: r.rating }; },
      progKey: function () { return null; },
      open: open
    });
  });
})();
