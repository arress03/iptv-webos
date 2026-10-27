(function () {
  'use strict';
  var I = IPTV, el = I.el, Xt = I.Xt, Nav = I.Nav;
  I.Player.init(I.$('#video'));

  function open(it, done) {
    var layer = el('div', { class: 'detail' });
    var poster = el('div', { class: 'poster' });
    if (it.img) poster.style.backgroundImage = 'url("' + it.img.replace(/"/g, '%22') + '")';
    var meta = el('div', { class: 'badges' }), cast = el('div', { class: 'cast' }), plot = el('div', { class: 'plot' }), trailerId = null;
    var row = el('div', { class: 'row' });
    layer.appendChild(poster);
    layer.appendChild(el('div', { class: 'info' }, [el('h1', { text: it.name }), meta, plot, cast, row]));
    document.body.appendChild(layer); Nav.push(layer);
    var closed = false;
    function close() { if (closed) return; closed = true; off(); Nav.pop(); layer.remove(); done && done(); }
    var off = I.onKey(function (ev, k) { if ((k === I.KEY.BACK || k === I.KEY.ESC || k === I.KEY.BKSP) && Nav.layer === layer) { close(); return true; } return false; });

    var ext = it.ext || 'mp4';
    Xt.call('get_vod_info', { vod_id: it.id }, I.DAY).then(function (r) {
      var info = (r && r.info) || {}, md = (r && r.movie_data) || {};
      ext = md.container_extension || ext;
      var bits = [info.releasedate && String(info.releasedate).slice(0, 4), info.duration, info.genre].filter(Boolean);
      bits.forEach(function (b) { meta.appendChild(el('span', { text: b })); });
      if (parseFloat(info.rating) > 0) meta.appendChild(el('span', { class: 'star', text: '★ ' + parseFloat(info.rating).toFixed(1) }));
      plot.textContent = info.plot || info.description || '';
      var who = [info.director && ('De ' + info.director), info.cast && ('Avec ' + String(info.cast).split(',').slice(0, 5).join(','))].filter(Boolean);
      cast.textContent = who.join('  ·  ');
      var bd = Array.isArray(info.backdrop_path) ? info.backdrop_path[0] : info.backdrop_path;
      VOD.backdrop(layer, bd || info.movie_image || it.img);
      if (info.movie_image && !it.img) poster.style.backgroundImage = 'url("' + info.movie_image + '")';
      trailerId = info.youtube_trailer || null;
    }).catch(function () {}).then(buttons);

    function buttons() {
      var key = 'm:' + it.id, saved = VOD.Prog.get(key);
      function go(fromStart) {
        if (fromStart) VOD.Prog.set(key, 0, 0);
        layer.classList.add('hidden');
        Nav.pop(); // la couche détail ne reçoit plus de focus pendant la lecture
        VOD.play({ url: Xt.stream('movie', it.id, ext), key: key, title: it.name, sub: '',
          meta: { kind: 'movie', item: it },
          onClose: back, onEnded: back });
        function back() { Nav.push(layer); layer.classList.remove('hidden'); Nav.first(); }
      }
      if (saved) {
        var r = el('button', { f: 1, class: 'btn primary', text: '▶ Reprendre à ' + I.fmtTime(saved.p) });
        r.addEventListener('click', function () { go(false); }); row.appendChild(r);
        var s = el('button', { f: 1, class: 'btn', text: 'Depuis le début' });
        s.addEventListener('click', function () { go(true); }); row.appendChild(s);
      } else {
        var p = el('button', { f: 1, class: 'btn primary', text: '▶ Lecture' });
        p.addEventListener('click', function () { go(false); }); row.appendChild(p);
      }
      if (trailerId) { var t = el('button', { f: 1, class: 'btn', text: '🎬 Bande-annonce' }); t.addEventListener('click', function () { VOD.trailer(trailerId); }); row.appendChild(t); }
      var b = el('button', { f: 1, class: 'btn', text: 'Retour' });
      b.addEventListener('click', close); row.appendChild(b);
      Nav.first();
    }
  }

  I.ensureLogin({ title: 'Films' }).then(function () {
    VOD.browse({
      title: 'Films', kind: 'movie',
      catAction: 'get_vod_categories', listAction: 'get_vod_streams',
      map: function (r) { return { id: r.stream_id, name: r.name || '', img: r.stream_icon || '', cat: String(r.category_id), ext: r.container_extension, rating: r.rating }; },
      progKey: function (it) { return 'm:' + it.id; },
      open: open
    });
  });
})();
