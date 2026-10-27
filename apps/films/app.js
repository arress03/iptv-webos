(function () {
  'use strict';
  var I = IPTV, el = I.el, Xt = I.Xt, Nav = I.Nav;
  I.Player.init(I.$('#video'));

  function open(it, done) {
    var layer = el('div', { class: 'detail' });
    var poster = el('div', { class: 'poster' });
    if (it.img) poster.style.backgroundImage = 'url("' + it.img.replace(/"/g, '%22') + '")';
    var meta = el('div', { class: 'meta', text: '…' }), plot = el('div', { class: 'plot' });
    var row = el('div', { class: 'row' });
    layer.appendChild(poster);
    layer.appendChild(el('div', { class: 'info' }, [el('h1', { text: it.name }), meta, plot, row]));
    document.body.appendChild(layer); Nav.push(layer);
    var closed = false;
    function close() { if (closed) return; closed = true; off(); Nav.pop(); layer.remove(); done && done(); }
    var off = I.onKey(function (ev, k) { if ((k === I.KEY.BACK || k === I.KEY.ESC || k === I.KEY.BKSP) && Nav.layer === layer) { close(); return true; } return false; });

    var ext = it.ext || 'mp4';
    Xt.call('get_vod_info', { vod_id: it.id }, I.DAY).then(function (r) {
      var info = (r && r.info) || {}, md = (r && r.movie_data) || {};
      ext = md.container_extension || ext;
      var bits = [info.releasedate && String(info.releasedate).slice(0, 4), info.genre, info.duration, info.rating && ('★ ' + info.rating)].filter(Boolean);
      meta.textContent = bits.join('  ·  ');
      plot.textContent = info.plot || info.description || '';
      if (info.movie_image && !it.img) poster.style.backgroundImage = 'url("' + info.movie_image + '")';
    }).catch(function () { meta.textContent = ''; }).then(buttons);

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
      var b = el('button', { f: 1, class: 'btn', text: 'Retour' });
      b.addEventListener('click', close); row.appendChild(b);
      Nav.first();
    }
  }

  I.ensureLogin({ title: 'Films' }).then(function () {
    VOD.browse({
      title: 'Films', kind: 'movie',
      catAction: 'get_vod_categories', listAction: 'get_vod_streams',
      map: function (r) { return { id: r.stream_id, name: r.name || '', img: r.stream_icon || '', cat: String(r.category_id), ext: r.container_extension }; },
      progKey: function (it) { return 'm:' + it.id; },
      open: open
    });
  });
})();
