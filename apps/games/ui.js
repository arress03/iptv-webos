/* Moteur d'interface des jeux : écrans, audio, questions à choix, réordonnancement */
(function () {
  'use strict';
  var I = window.IPTV, el = I.el, KEY = I.KEY, Nav = I.Nav, sleep = I.sleep;
  var main = I.$('#main');

  /* ---------- Audio (jamais plus de 2 flux à la fois, coupé en quittant l'app) ---------- */
  var audios = [new Audio(), new Audio()];
  var A = {
    play: function (url, i, opts) {
      i = i || 0; opts = opts || {}; var a = audios[i];
      a.pause(); if (a.getAttribute('src') !== url) a.src = url; else a.currentTime = 0; a.volume = 1;
      var p = a.play(); if (p && p.catch) p.catch(function () {});
      clearTimeout(a._t);
      if (opts.len) a._t = setTimeout(function () { a.pause(); }, opts.len * 1000);
    },
    stop: function () { audios.forEach(function (a) { clearTimeout(a._t); a.pause(); a.removeAttribute('src'); try { a.load(); } catch (e) {} }); }
  };
  document.addEventListener('visibilitychange', function () { if (document.hidden) A.stop(); });
  window.addEventListener('pagehide', A.stop);

  /* ---------- Écrans ---------- */
  var offKey = null, backFn = null;
  function show(node, keyFn, back) {
    if (offKey) { offKey(); offKey = null; }
    main.innerHTML = ''; main.appendChild(node); Nav.layer = main;
    if (keyFn) offKey = I.onKey(keyFn);
    backFn = back || null;
  }
  I.setBack(function () { if (backFn) backFn(); else { A.stop(); I.exitApp(); } });
  function loading(text) { show(el('div', { class: 'load', text: text || 'Chargement…' })); }
  function setLoading(text) { var l = I.$('.load', main); if (l) l.textContent = text; }

  function hud(title, round, total, score) {
    var sc = el('span', { class: 'sc', text: score + ' pts' });
    return { node: el('div', { class: 'hud' }, [el('span', { text: title }), el('span', {}, [document.createTextNode('Manche '), el('b', { text: round + ' / ' + total })]), sc]), sc: sc };
  }

  /* ---------- Question à choix (1 bonne réponse parmi 4, ou 2 parmi 6) ---------- */
  // cfg: { title, round, total, score, prompt, media(node), options:[{t,s}], correct:[idx], pick:1|2, time, start(), stop(), factor() }
  function ask(cfg) {
    return new Promise(function (resolve) {
      var h = hud(cfg.title, cfg.round, cfg.total, cfg.score);
      var bar = el('i'), reveal = el('div', { class: 'reveal' });
      var optsBox = el('div', { class: 'opts' }), picked = [], done = false, t0 = Date.now(), time = cfg.time || 20;
      var need = cfg.pick || 1, nodes = [];
      (cfg.options || []).forEach(function (o, i) {
        var n = el('div', { f: 1, class: 'opt c' + i }, [document.createTextNode(o.t), o.s ? el('small', { text: o.s }) : null]);
        n.addEventListener('click', function () { choose(i); }); nodes.push(n); optsBox.appendChild(n);
      });
      var q = el('div', { class: 'q' }, [el('div', { class: 'prompt', text: cfg.prompt || '' }), el('div', { class: 'media' }, cfg.media ? [cfg.media] : []), el('div', { class: 'timer' }, [bar]), optsBox, reveal]);
      show(el('div', { style: 'display:flex;flex-direction:column;height:100%' }, [h.node, q]), function (ev, k) {
        var map = { 403: 0, 404: 1, 405: 2, 406: 3 };
        if (map[k] !== undefined && map[k] < nodes.length && !done) { choose(map[k]); return true; }
        return false;
      }, function () { finish(true); resolve({ quit: true }); });
      Nav.first();
      cfg.start && cfg.start();
      var iv = setInterval(function () {
        var left = Math.max(0, 1 - (Date.now() - t0) / (time * 1000)); bar.style.width = (left * 100) + '%';
        if (left <= 0) submit();
      }, 100);
      function choose(i) {
        if (done) return;
        if (need === 1) { picked = [i]; return submit(); }
        var p = picked.indexOf(i); if (p >= 0) { picked.splice(p, 1); nodes[i].classList.remove('on'); } else { picked.push(i); nodes[i].classList.add('on'); }
        if (picked.length >= need) submit();
      }
      function finish(silent) { done = true; clearInterval(iv); cfg.stop && cfg.stop(); }
      function submit() {
        if (done) return; var left = Math.max(0, 1 - (Date.now() - t0) / (time * 1000)); finish();
        var good = picked.filter(function (i) { return cfg.correct.indexOf(i) >= 0; }).length;
        nodes.forEach(function (n, i) { n.classList.remove('on'); if (cfg.correct.indexOf(i) >= 0) n.classList.add('ok'); else if (picked.indexOf(i) >= 0) n.classList.add('ko'); });
        var f = cfg.factor ? cfg.factor() : 1, pts = 0;
        if (cfg.correct.length === 1) pts = good ? Math.round((100 + 100 * left) * f) : 0; else pts = Math.round(good * (60 + 60 * left) * f);
        if (cfg.reveal) reveal.textContent = cfg.reveal;
        h.sc.textContent = (cfg.score + pts) + ' pts';
        reveal.textContent = (good === cfg.correct.length ? '✓ ' : good ? '~ ' : '✗ ') + (cfg.reveal || '') + (pts ? '   +' + pts : '');
        setTimeout(function () { resolve({ pts: pts, good: good }); }, 2200);
      }
    });
  }

  /* ---------- Réordonnancement (Timeline, Album dans l'ordre) ---------- */
  // cfg: { title, round, total, score, prompt, items:[{t,s,img,preview,year}], layout:'cards'|'list', key(item)->valeur de tri, label(item)->texte révélé }
  function reorder(cfg) {
    return new Promise(function (resolve) {
      var h = hud(cfg.title, cfg.round, cfg.total, cfg.score);
      var order = cfg.items.slice(), pickIdx = -1, locked = false, prevT;
      var box = el('div', { class: cfg.layout === 'list' ? 'rlist' : 'row3' });
      var ok = el('button', { f: 1, class: 'btn primary', text: 'Valider' });
      var info = el('div', { class: 'reveal', text: 'OK : saisir un élément, ◀ ▶ le déplacer, OK : le poser. Valider quand c’est bon.' });
      function draw(res) {
        box.innerHTML = '';
        order.forEach(function (it, i) {
          var n;
          if (cfg.layout === 'list') n = el('div', { f: 1, class: 'rl' }, [el('div', { class: 'n', text: (i + 1) + '.' }), el('div', { class: 't', text: it.t })]);
          else n = el('div', { f: 1, class: 'rc' }, [el('div', { class: 'num', text: i + 1 }), it.img ? el('img', { src: it.img, alt: '' }) : null, el('div', { class: 'rt', text: it.t + (it.s ? ' — ' + it.s : '') }), el('div', { class: 'ry', text: res ? cfg.label(it) : '' })]);
          if (i === pickIdx) n.classList.add('pick');
          if (res) n.classList.add(res[i] ? 'ok' : 'ko');
          n.addEventListener('click', function () { if (!locked) toggle(i); });
          n.addEventListener('focus', function () { if (it.preview && !locked) { clearTimeout(prevT); prevT = setTimeout(function () { A.play(it.preview, 0); }, 350); } });
          box.appendChild(n);
        });
      }
      function toggle(i) { pickIdx = pickIdx === i ? -1 : i; draw(); Nav.focus(box.children[i]); }
      draw();
      var q = el('div', { class: 'q' }, [el('div', { class: 'prompt', text: cfg.prompt }), box, info, el('div', { class: 'bar2' }, [ok])]);
      show(el('div', { style: 'display:flex;flex-direction:column;height:100%' }, [h.node, q]), function (ev, k) {
        if (locked) return false;
        var f = document.activeElement, i = Array.prototype.indexOf.call(box.children, f);
        var horiz = cfg.layout !== 'list', prev = horiz ? KEY.LEFT : KEY.UP, next = horiz ? KEY.RIGHT : KEY.DOWN;
        if (pickIdx >= 0 && i === pickIdx && (k === prev || k === next)) {
          var j = i + (k === next ? 1 : -1); if (j < 0 || j >= order.length) return true;
          var x = order[i]; order[i] = order[j]; order[j] = x; pickIdx = j; draw(); Nav.focus(box.children[j]); return true;
        }
        return false;
      }, function () { A.stop(); resolve({ quit: true }); });
      Nav.focus(box.children[0]);
      ok.addEventListener('click', function () {
        if (locked) return; locked = true; A.stop(); pickIdx = -1;
        var keys = order.map(cfg.key), sorted = keys.slice().sort(function (a, b) { return a - b; });
        var res = keys.map(function (k, i) { return k === sorted[i]; });
        draw(res); var good = res.filter(Boolean).length, pts = good * (cfg.per || 50);
        h.sc.textContent = (cfg.score + pts) + ' pts'; info.textContent = good + ' / ' + order.length + ' bien placés   +' + pts;
        ok.textContent = 'Suivant'; ok.onclick = null; Nav.focus(ok);
        ok.addEventListener('click', function () { resolve({ pts: pts, good: good }); }, { once: true });
      });
    });
  }

  /* ---------- Fin de partie + meilleur score ---------- */
  function end(key, title, score, again, menu) {
    var hs = I.ls('gd.hs') || {}, best = hs[key] || 0, isBest = score > best;
    if (isBest) { hs[key] = score; I.ls('gd.hs', hs); }
    var a = el('button', { f: 1, class: 'btn primary', text: 'Rejouer' }), m = el('button', { f: 1, class: 'btn', text: 'Menu' });
    a.addEventListener('click', again); m.addEventListener('click', menu);
    show(el('div', { class: 'endbox' }, [el('h1', { text: title }), el('div', { class: 'big', text: score }), el('div', { class: 'sub', text: isBest ? '🏆 Nouveau record !' : 'Record : ' + best }), el('div', { class: 'bar2' }, [a, m])]), null, menu);
    Nav.first();
  }

  window.GU = { show: show, loading: loading, setLoading: setLoading, hud: hud, ask: ask, reorder: reorder, end: end, A: A, main: main };
})();
