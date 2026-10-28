/* Données musicales : API publique iTunes Search (extraits de 30 s, pochettes, dates).
 * Les appels passent par le service de la TV (pas de blocage CORS) ; repli : appel direct. */
(function () {
  'use strict';
  var I = window.IPTV;
  var BASE = I.ls('gd.base') || 'https://itunes.apple.com';   // 'gd.base' : uniquement pour les tests locaux

  var ARTISTS = ['Booba', 'PNL', 'Jul', 'Nekfeu', 'SCH', 'Ninho', 'Damso', 'Orelsan', 'Kaaris', 'Gazo', 'Tiakola', 'Niska', 'Naps', 'Lomepal',
    'Hamza', 'Josman', 'Vald', 'Alpha Wann', 'Laylow', 'Sofiane', 'Soprano', 'MC Solaar', 'IAM', 'Oxmo Puccino', 'Rohff', 'Lacrim', 'Maes',
    'Koba LaD', 'Zola', 'Werenoi', 'Dadju', 'Gims', 'Bigflo & Oli', 'Freeze Corleone', 'Leto', 'Central Cee', 'Kendrick Lamar', 'Drake', 'Eminem', 'Travis Scott'];

  function clean(t) { return String(t || '').replace(/\s*[\(\[][^\)\]]*[\)\]]/g, '').replace(/\s*-\s*(single|ep|remix|live).*$/i, '').trim(); }
  function bad(t) { return /remix|instrumental|live|karaok|acoustic|version|mix\b/i.test(t || ''); }
  function art600(u) { return u ? String(u).replace(/\/\d+x\d+bb\./, '/600x600bb.') : ''; }
  function shuffle(a) { a = a.slice(); for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), x = a[i]; a[i] = a[j]; a[j] = x; } return a; }
  function pick(a, n) { return shuffle(a).slice(0, n); }

  function api(path) {
    var url = BASE + path, key = 'gd|' + url;
    return I.DB.get(key).then(function (hit) {
      if (hit && Date.now() - hit.t < 7 * 86400000) return hit.v;
      return I.luna('fetchJson', { url: url }).then(function (r) {
        if (r && r.returnValue && r.body) return JSON.parse(r.body);
        return fetch(url).then(function (x) { if (!x.ok) throw new Error('HTTP ' + x.status); return x.json(); });   // repli sans service
      }).then(function (v) { I.DB.set(key, { t: Date.now(), v: v }); return v; });
    });
  }
  var q = function (s) { return encodeURIComponent(s); };

  function songs(artist) {
    return api('/search?term=' + q(artist) + '&media=music&entity=song&attribute=artistTerm&country=FR&limit=50').then(function (j) {
      var na = I.norm(artist), seen = {};
      return (j.results || []).filter(function (s) {
        var key = I.norm(clean(s.trackName));
        if (!s.previewUrl || !s.trackName || bad(s.trackName) || seen[key] || I.norm(s.artistName).indexOf(na) < 0) return false;
        seen[key] = 1; return true;
      }).map(function (s) {
        return { id: s.trackId, title: clean(s.trackName), artist: s.artistName, album: s.collectionName, preview: s.previewUrl, cover: art600(s.artworkUrl100),
          year: parseInt(String(s.releaseDate).slice(0, 4), 10), date: s.releaseDate };
      });
    });
  }
  function albums(artist) {
    return api('/search?term=' + q(artist) + '&media=music&entity=album&attribute=artistTerm&country=FR&limit=50').then(function (j) {
      var na = I.norm(artist), seen = {};
      return (j.results || []).filter(function (a) {
        var key = I.norm(clean(a.collectionName));
        if (!a.collectionName || a.trackCount < 8 || bad(a.collectionName) || seen[key] || I.norm(a.artistName).indexOf(na) < 0) return false;
        seen[key] = 1; return true;
      }).map(function (a) {
        return { id: a.collectionId, name: clean(a.collectionName), artist: a.artistName, cover: art600(a.artworkUrl100), year: parseInt(String(a.releaseDate).slice(0, 4), 10), date: a.releaseDate, count: a.trackCount };
      });
    });
  }
  function tracklist(albumId) {
    return api('/lookup?id=' + albumId + '&entity=song&country=FR').then(function (j) {
      return (j.results || []).filter(function (s) { return s.wrapperType === 'track' && s.trackName; })
        .sort(function (a, b) { return a.trackNumber - b.trackNumber; }).map(function (s) { return { n: s.trackNumber, title: clean(s.trackName), preview: s.previewUrl }; });
    });
  }
  // Réserve de morceaux pour un thème : un artiste, ou "mix" (plusieurs artistes tirés au hasard). Appels espacés et séquentiels.
  function pool(theme, kind, progress) {
    var list = theme === 'mix' ? pick(ARTISTS, 7) : [theme], out = [], i = 0, fn = kind === 'albums' ? albums : songs;
    return (function next() {
      if (i >= list.length) return Promise.resolve(out);
      progress && progress(list[i], i, list.length);
      return fn(list[i++]).then(function (r) { out = out.concat(r); return I.sleep(250); }).catch(function () {}).then(next);
    })();
  }

  window.GD = { ARTISTS: ARTISTS, api: api, songs: songs, albums: albums, tracklist: tracklist, pool: pool, shuffle: shuffle, pick: pick, clean: clean };
})();
