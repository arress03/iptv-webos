/* Les jeux : Blindtest (normal / évolutif / superposé), Qui chante ?, Pochette, Timeline, Album dans l'ordre, Place sans savoir, Mots-mêlés */
(function () {
  'use strict';
  var I = window.IPTV, el = I.el, GD = window.GD, GU = window.GU, Nav = I.Nav, KEY = I.KEY, norm = I.norm, sleep = I.sleep;
  var menuFn = function () {};

  function fail(msg) {
    var b = el('button', { f: 1, class: 'btn primary', text: 'Retour au menu' }); b.addEventListener('click', function () { menuFn(); });
    GU.show(el('div', { class: 'endbox' }, [el('h1', { text: 'Oups' }), el('div', { class: 'sub', text: msg }), el('div', { class: 'bar2' }, [b])]), null, function () { menuFn(); });
    Nav.first();
  }
  function getPool(theme, kind, min) {
    GU.loading('Chargement des morceaux…');
    return GD.pool(theme, kind, function (a) { GU.setLoading('Chargement : ' + a + '…'); }).then(function (p) {
      if (p.length < min) throw new Error('Pas assez de résultats pour ce thème (' + p.length + '). Vérifie la connexion de la TV ou choisis un autre thème.');
      return p;
    });
  }
  function others(pool, target, n, keyFn) {
    var seen = {}; seen[keyFn(target)] = 1; var out = [];
    GD.shuffle(pool).forEach(function (x) { var k = keyFn(x); if (out.length < n && !seen[k]) { seen[k] = 1; out.push(x); } });
    return out;
  }
  var eq = function () { return el('div', { class: 'eq' }, [el('i'), el('i'), el('i'), el('i'), el('i')]); };
  var songKey = function (s) { return norm(s.title); };

  /* ---------- Blindtest ---------- */
  var STEPS = [0.25, 0.6, 1.2, 2.5, 5, 10, 30];
  function blindtest(mode, theme) {
    return getPool(theme, 'songs', 12).then(function (pool) {
      var total = 10, score = 0, targets = GD.pick(pool, total), r = 0;
      var titles = { normal: 'Blindtest', evolutif: 'Blindtest évolutif', superpose: 'Blindtest superposé' }[mode];
      return (function next() {
        if (r >= total) return GU.end('bt-' + mode, titles, score, function () { blindtest(mode, theme); }, menuFn);
        var t = targets[r], st = { i: 0, stop: false }, cfg;
        if (mode === 'superpose') {
          var t2 = others(pool, t, 1, songKey)[0], extra = others(pool.filter(function (s) { return s !== t2; }), t, 4, songKey);
          var opts = GD.shuffle([t, t2].concat(extra));
          cfg = { options: opts.map(function (s) { return { t: s.title, s: s.artist }; }), correct: [opts.indexOf(t), opts.indexOf(t2)], pick: 2, time: 30, prompt: 'Deux morceaux en même temps : trouve les deux !',
            start: function () { GU.A.play(t.preview, 0); GU.A.play(t2.preview, 1); }, stop: GU.A.stop, reveal: t.title + ' + ' + t2.title };
        } else {
          var o2 = GD.shuffle([t].concat(others(pool, t, 3, songKey)));
          cfg = { options: o2.map(function (s) { return { t: s.title, s: s.artist }; }), correct: [o2.indexOf(t)], time: mode === 'evolutif' ? 40 : 25,
            prompt: mode === 'evolutif' ? 'Extraits de plus en plus longs : moins tu en as besoin, plus tu marques' : 'Quel est ce morceau ?', reveal: t.title + ' — ' + t.artist,
            start: function () {
              if (mode !== 'evolutif') return GU.A.play(t.preview, 0);
              (function loop() {
                if (st.stop) return; GU.A.play(t.preview, 0, { len: STEPS[st.i] });
                sleep(STEPS[st.i] * 1000 + 1300).then(function () { if (st.stop) return; if (st.i < STEPS.length - 1) { st.i++; loop(); } else GU.A.play(t.preview, 0); });
              })();
            }, stop: function () { st.stop = true; GU.A.stop(); }, factor: mode === 'evolutif' ? function () { return (STEPS.length - st.i) / STEPS.length; } : null };
        }
        cfg.title = titles; cfg.round = r + 1; cfg.total = total; cfg.score = score; cfg.media = eq();
        return GU.ask(cfg).then(function (res) { if (res.quit) return menuFn(); score += res.pts; r++; return next(); });
      })();
    }).catch(function (e) { fail(e.message); });
  }

  /* ---------- Qui chante ? ---------- */
  function artistGame() {
    return getPool('mix', 'songs', 30).then(function (pool) {
      var total = 10, score = 0, r = 0, targets = GD.pick(pool, total);
      return (function next() {
        if (r >= total) return GU.end('artist', 'Qui chante ?', score, artistGame, menuFn);
        var t = targets[r], names = {}, opts = [t.artist]; names[norm(t.artist)] = 1;
        GD.shuffle(pool).forEach(function (s) { if (opts.length < 4 && !names[norm(s.artist)]) { names[norm(s.artist)] = 1; opts.push(s.artist); } });
        opts = GD.shuffle(opts);
        return GU.ask({ title: 'Qui chante ?', round: r + 1, total: total, score: score, prompt: 'Quel artiste chante ce morceau ?', media: eq(),
          options: opts.map(function (a) { return { t: a }; }), correct: [opts.indexOf(t.artist)], time: 20, start: function () { GU.A.play(t.preview, 0); }, stop: GU.A.stop, reveal: t.title + ' — ' + t.artist })
          .then(function (res) { if (res.quit) return menuFn(); score += res.pts; r++; return next(); });
      })();
    }).catch(function (e) { fail(e.message); });
  }

  /* ---------- Devine la pochette ---------- */
  function coverGame(theme) {
    return getPool(theme, 'albums', 8).then(function (pool) {
      var total = Math.min(10, pool.length), score = 0, r = 0, targets = GD.pick(pool, total);
      return (function next() {
        if (r >= total) return GU.end('cover', 'Devine la pochette', score, function () { coverGame(theme); }, menuFn);
        var t = targets[r], opts = GD.shuffle([t].concat(others(pool, t, 3, function (a) { return norm(a.name); })));
        var img = el('img', { class: 'cover-blur', src: t.cover, alt: '', style: 'filter:blur(34px)' });
        return GU.ask({ title: 'Pochette', round: r + 1, total: total, score: score, prompt: 'De quel album est cette pochette ?', media: img,
          options: opts.map(function (a) { return { t: a.name, s: a.artist }; }), correct: [opts.indexOf(t)], time: 20,
          start: function () { setTimeout(function () { img.style.transitionDuration = '19s'; img.style.filter = 'blur(0px)'; }, 60); }, stop: function () { img.style.transitionDuration = '0.3s'; img.style.filter = 'blur(0px)'; },
          reveal: t.name + ' — ' + t.artist + ' (' + t.year + ')' }).then(function (res) { if (res.quit) return menuFn(); score += res.pts; r++; return next(); });
      })();
    }).catch(function (e) { fail(e.message); });
  }

  /* ---------- La Timeline : du plus ancien au plus récent ---------- */
  function timeline(theme) {
    return getPool(theme, 'songs', 12).then(function (pool) {
      var total = 5, score = 0, r = 0;
      return (function next() {
        if (r >= total) return GU.end('timeline', 'La Timeline', score, function () { timeline(theme); }, menuFn);
        var byYear = {}; GD.shuffle(pool).forEach(function (s) { if (s.year && !byYear[s.year]) byYear[s.year] = s; });
        var years = Object.keys(byYear); if (years.length < 4) return fail('Pas assez d’années différentes pour ce thème.');
        var items = GD.pick(years, 4).map(function (y) { var s = byYear[y]; return { t: s.title, s: s.artist, img: s.cover, preview: s.preview, year: s.year }; });
        return GU.reorder({ title: 'Timeline', round: r + 1, total: total, score: score, prompt: 'Place les 4 morceaux du plus ancien au plus récent', items: items, layout: 'cards',
          key: function (it) { return it.year; }, label: function (it) { return it.year; }, per: 50 }).then(function (res) { if (res.quit) return menuFn(); score += res.pts; r++; return next(); });
      })();
    }).catch(function (e) { fail(e.message); });
  }

  /* ---------- Remets l'album dans l'ordre ---------- */
  function albumOrder(theme) {
    return getPool(theme, 'albums', 3).then(function (pool) {
      var total = 3, score = 0, r = 0, order = GD.shuffle(pool);
      return (function next() {
        if (r >= total || !order.length) return GU.end('albumorder', 'Album dans l’ordre', score, function () { albumOrder(theme); }, menuFn);
        var alb = order.shift(); GU.loading('Chargement de « ' + alb.name + ' »…');
        return GD.tracklist(alb.id).then(function (tr) {
          tr = tr.slice(0, 8); if (tr.length < 5) return next();
          var items = GD.shuffle(tr).map(function (x) { return { t: x.title, n: x.n, preview: x.preview }; });
          return GU.reorder({ title: alb.name, round: r + 1, total: total, score: score, prompt: 'Remets les titres de « ' + alb.name + ' » (' + alb.artist + ') dans l’ordre', items: items, layout: 'list',
            key: function (it) { return it.n; }, label: function (it) { return it.n; }, per: 40 }).then(function (res) { if (res.quit) return menuFn(); score += res.pts; r++; return next(); });
        });
      })();
    }).catch(function (e) { fail(e.message); });
  }

  /* ---------- Place sans savoir le suivant (du plus ancien au plus récent) ---------- */
  function rankGame(theme) {
    return getPool(theme, 'albums', 10).then(function (pool) {
      var seen = {}, items = GD.pick(pool.filter(function (a) { return a.year; }), 10);
      var placed = new Array(items.length).fill(null), i = 0;
      return (function nextItem() {
        if (i >= items.length) return reveal();
        var cur = items[i], slots = el('div', { class: 'slots' });
        placed.forEach(function (p, k) {
          var s = el('div', { f: 1, class: 'slot' }, [el('div', { class: 'sn', text: k + 1 }), p ? el('img', { src: p.cover, alt: '' }) : null]);
          s.addEventListener('click', function () { if (placed[k]) return I.toast('Case déjà prise', 1200); placed[k] = cur; i++; nextItem(); });
          slots.appendChild(s);
        });
        var h = GU.hud('Place sans savoir', i + 1, items.length, 0);
        var q = el('div', { class: 'q' }, [el('div', { class: 'prompt', text: 'Où place-t-on cet album ? 1 = le plus ancien, 10 = le plus récent' }),
          el('div', { class: 'media', style: 'height:300px' }, [el('img', { src: cur.cover, alt: '', style: 'height:290px;width:290px' })]),
          el('div', { class: 'prompt', style: 'font-size:32px', text: cur.name + ' — ' + cur.artist }), slots]);
        GU.show(el('div', { style: 'display:flex;flex-direction:column;height:100%' }, [h.node, q]), null, menuFn);
        h.sc.textContent = ''; Nav.focus(slots.children[Math.floor(placed.length / 2)] || slots.firstChild);
        // première case libre sous le focus
        var free = Array.prototype.filter.call(slots.children, function (c, k) { return !placed[k]; })[0]; Nav.focus(free);
      })();
      function reveal() {
        var years = items.map(function (a) { return a.year; }).sort(function (a, b) { return a - b; }), good = 0, slots = el('div', { class: 'slots' });
        placed.forEach(function (p, k) { var ok = p.year === years[k]; if (ok) good++; slots.appendChild(el('div', { class: 'slot ' + (ok ? 'ok' : 'ko') }, [el('div', { class: 'sn', text: k + 1 }), el('img', { src: p.cover, alt: '' }), el('div', { class: 'sy', text: p.year })])); });
        var score = good * 10, b = el('button', { f: 1, class: 'btn primary', text: 'Terminer' });
        b.addEventListener('click', function () { GU.end('rank', 'Place sans savoir', score, function () { rankGame(theme); }, menuFn); });
        GU.show(el('div', { class: 'q' }, [el('div', { class: 'prompt', text: good + ' / ' + items.length + ' bien placés' }), slots, el('div', { class: 'bar2' }, [b])]), null, menuFn); Nav.first();
      }
    }).catch(function (e) { fail(e.message); });
  }

  /* ---------- Mots-mêlés ---------- */
  function wordSearch() {
    var N = 12, names = GD.shuffle(GD.ARTISTS.map(function (a) { return { shown: a, w: norm(a).replace(/[^a-z]/g, '').toUpperCase() }; }).filter(function (x) { return x.w.length >= 3 && x.w.length <= 10; })).slice(0, 7);
    var grid = []; for (var r = 0; r < N; r++) { grid.push(new Array(N).fill('')); }
    var dirs = [[0, 1], [1, 0], [1, 1], [-1, 1]];
    names.forEach(function (n) {
      for (var tries = 0; tries < 300; tries++) {
        var d = dirs[Math.floor(Math.random() * dirs.length)], r0 = Math.floor(Math.random() * N), c0 = Math.floor(Math.random() * N), ok = true;
        for (var k = 0; k < n.w.length; k++) { var rr = r0 + d[0] * k, cc = c0 + d[1] * k; if (rr < 0 || rr >= N || cc < 0 || cc >= N || (grid[rr][cc] && grid[rr][cc] !== n.w[k])) { ok = false; break; } }
        if (ok) { for (k = 0; k < n.w.length; k++) grid[r0 + d[0] * k][c0 + d[1] * k] = n.w[k]; return; }
      }
    });
    var L = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'; grid.forEach(function (row) { row.forEach(function (v, c) { if (!v) row[c] = L[Math.floor(Math.random() * 26)]; }); });
    var cur = [0, 0], start = null, found = {}, cells = [], t0 = Date.now(), gridEl = el('div', { class: 'wsg', style: 'grid-template-columns:repeat(' + N + ',62px)' }), list = el('div', { class: 'wsw' });
    grid.forEach(function (row, r) { row.forEach(function (v, c) { var n = el('div', { class: 'wc', text: v }); cells[r * N + c] = n; gridEl.appendChild(n); }); });
    function drawList() { list.innerHTML = ''; names.forEach(function (n) { list.appendChild(el('div', { class: found[n.w] ? 'done' : '', text: n.shown.toUpperCase() })); }); }
    function paint() { cells.forEach(function (n, k) { n.classList.toggle('cur', k === cur[0] * N + cur[1]); n.classList.toggle('st', !!start && k === start[0] * N + start[1]); }); }
    drawList(); paint();
    var h = GU.hud('Mots-mêlés', 1, 1, 0); h.node.children[1].textContent = 'OK : début du mot, puis OK : fin du mot';
    function handle(ev, k) {
      if (k === KEY.LEFT) cur[1] = Math.max(0, cur[1] - 1); else if (k === KEY.RIGHT) cur[1] = Math.min(N - 1, cur[1] + 1);
      else if (k === KEY.UP) cur[0] = Math.max(0, cur[0] - 1); else if (k === KEY.DOWN) cur[0] = Math.min(N - 1, cur[0] + 1);
      else if (k === KEY.ENTER) {
        if (!start) start = cur.slice();
        else {
          var dr = cur[0] - start[0], dc = cur[1] - start[1], len = Math.max(Math.abs(dr), Math.abs(dc)), word = '', path = [];
          if (len > 0 && (dr === 0 || dc === 0 || Math.abs(dr) === Math.abs(dc))) {
            for (var i = 0; i <= len; i++) { var rr = start[0] + Math.sign(dr) * i, cc = start[1] + Math.sign(dc) * i; word += grid[rr][cc]; path.push(rr * N + cc); }
            var rev = word.split('').reverse().join(''), hit = names.filter(function (n) { return !found[n.w] && (n.w === word || n.w === rev); })[0];
            if (hit) { found[hit.w] = 1; path.forEach(function (p) { cells[p].classList.add('fd'); }); drawList(); I.toast('✓ ' + hit.shown, 1200); }
            else I.toast('Pas un mot de la liste', 1200);
          } else I.toast('Choisis une ligne droite', 1200);
          start = null;
          if (names.every(function (n) { return found[n.w]; })) { var sec = Math.round((Date.now() - t0) / 1000); return GU.end('words', 'Mots-mêlés (' + sec + ' s)', Math.max(100, 1000 - sec * 3), wordSearch, menuFn), true; }
        }
      } else return false;
      paint(); return true;
    }
    GU.show(el('div', { style: 'display:flex;flex-direction:column;height:100%' }, [h.node, el('div', { class: 'q', style: 'flex-direction:row;justify-content:center;align-items:flex-start' }, [gridEl, list])]), handle, menuFn);
  }

  window.GAMES = { blindtest: blindtest, artist: artistGame, cover: coverGame, timeline: timeline, albumOrder: albumOrder, rank: rankGame, words: wordSearch, setMenu: function (f) { menuFn = f; } };
})();
