(function () {
  'use strict';
  var I = window.IPTV, el = I.el, GU = window.GU, G = window.GAMES, GD = window.GD, Nav = I.Nav;

  function grid(items, cls, onPick) {
    var box = el('div', { class: cls || 'tiles' });
    items.forEach(function (it) {
      var n = el('div', { f: 1, class: 'tile' }, [el('div', {}, [el('div', { class: 'ic', text: it.ic || '' }), el('div', { class: 'tn', text: it.name }), it.desc ? el('div', { class: 'td', text: it.desc }) : null]), it.hs ? el('div', { class: 'hs', text: it.hs }) : null]);
      n.addEventListener('click', function () { onPick(it); }); box.appendChild(n);
    });
    return box;
  }
  function screen(title, sub, node, back) { GU.show(el('div', {}, [el('h1', { text: title }), el('div', { class: 'sub', text: sub || '' }), node]), null, back); Nav.first(); }

  function themePicker(title, withMix, then, back) {
    var items = (withMix ? [{ name: 'Mix', ic: '🎲', desc: 'Plusieurs artistes au hasard', v: 'mix' }] : []).concat(GD.ARTISTS.map(function (a) { return { name: a, ic: '🎤', v: a }; }));
    var box = grid(items, 'tiles', function (it) { then(it.v); }); box.style.gridTemplateColumns = 'repeat(5, 1fr)';
    Array.prototype.forEach.call(box.children, function (c) { c.style.minHeight = '140px'; c.querySelector('.ic').style.fontSize = '40px'; });
    var wrap = el('div', { style: 'overflow-y:auto;max-height:820px;padding:8px' }, [box]); wrap.className = 'themes';
    screen(title, 'Choisis un thème', wrap, back);
  }

  function menu() {
    var hs = I.ls('gd.hs') || {}, best = function (k) { return hs[k] ? '🏆 ' + hs[k] : ''; };
    var items = [
      { id: 'bt', ic: '🎧', name: 'Blindtest', desc: 'Normal, évolutif ou superposé', hs: best('bt-normal') },
      { id: 'artist', ic: '🎤', name: 'Qui chante ?', desc: 'Retrouve l’artiste', hs: best('artist') },
      { id: 'cover', ic: '🖼️', name: 'Pochette', desc: 'Devine l’album (image floue)', hs: best('cover') },
      { id: 'timeline', ic: '📅', name: 'La Timeline', desc: '4 morceaux du plus ancien au plus récent', hs: best('timeline') },
      { id: 'order', ic: '💿', name: 'Album dans l’ordre', desc: 'Remets les titres dans l’ordre', hs: best('albumorder') },
      { id: 'rank', ic: '🧩', name: 'Place sans savoir', desc: 'Classe 10 albums sans voir le suivant', hs: best('rank') },
      { id: 'words', ic: '🔤', name: 'Mots-mêlés', desc: 'Retrouve les noms d’artistes', hs: best('words') }
    ];
    G.setMenu(menu);
    screen('RapGame', 'Jeux musicaux : extraits de 30 s, pochettes et dates du catalogue iTunes', grid(items, 'tiles', function (it) {
      if (it.id === 'bt') return modePicker();
      if (it.id === 'artist') return G.artist();
      if (it.id === 'words') return G.words();
      var fn = { cover: G.cover, timeline: G.timeline, order: G.albumOrder, rank: G.rank }[it.id];
      themePicker(it.name, true, function (t) { fn(t); }, menu);
    }), null);
  }
  function modePicker() {
    var items = [{ name: 'Normal', ic: '🎵', desc: 'Trouve le titre', v: 'normal' }, { name: 'Évolutif', ic: '⏱️', desc: 'Extraits de plus en plus longs : moins tu en as besoin, plus tu gagnes', v: 'evolutif' },
      { name: 'Superposé', ic: '🎶', desc: 'Deux morceaux en même temps : trouve les deux', v: 'superpose' }];
    screen('Blindtest', 'Choisis un mode', grid(items, 'tiles', function (it) { themePicker('Blindtest ' + it.name.toLowerCase(), true, function (t) { G.blindtest(it.v, t); }, modePicker); }), menu);
  }
  menu();
})();
