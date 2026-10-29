/* Script injecté dans chaque page par le proxy TVWeb : réécriture des URL dynamiques, anti-popups, navigation à la télécommande. */
(function () {
  'use strict';
  var m = location.pathname.match(/^\/o\/([A-Za-z0-9_-]+)(\/.*)?$/); if (!m) return;
  var ORIGIN; try { ORIGIN = atob(m[1].replace(/-/g, '+').replace(/_/g, '/')); } catch (e) { return; }
  var PREFIX = '/o/' + m[1], PROTO = ORIGIN.split(':')[0] + ':';
  var REAL = ORIGIN + (m[2] || '/') + location.search + location.hash;
  function b64u(s) { return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function rw(u) {
    if (u == null) return u; if (typeof u !== 'string') { try { u = String(u.href || u); } catch (e) { return u; } }
    if (/^\/\/|^https?:\/\//i.test(u)) {
      try { var a = new URL(u.indexOf('//') === 0 ? PROTO + u : u); if (a.origin === location.origin) return u; return '/o/' + b64u(a.origin) + a.pathname + a.search + a.hash; } catch (e) { return u; }
    }
    if (u.charAt(0) === '/' && u.indexOf('/o/') !== 0 && u.indexOf('/__') !== 0) return PREFIX + u;
    return u;
  }
  var post = function (o) { try { parent.postMessage(Object.assign({ tvweb: true }, o), '*'); } catch (e) {} };

  /* réseau */
  var of = window.fetch; if (of) window.fetch = function (i, init) { try { if (typeof i === 'string' || i instanceof URL) i = rw(String(i)); else if (i && i.url) i = new Request(rw(i.url), i); } catch (e) {} return of.call(this, i, init); };
  var ox = XMLHttpRequest.prototype.open; XMLHttpRequest.prototype.open = function (mt, u) { var a = [].slice.call(arguments); a[1] = rw(String(u)); return ox.apply(this, a); };
  if (navigator.sendBeacon) { var ob = navigator.sendBeacon.bind(navigator); navigator.sendBeacon = function (u, d) { return ob(rw(u), d); }; }
  /* attributs src / href / action posés par script */
  function hookProp(proto, prop) { var d = Object.getOwnPropertyDescriptor(proto, prop); if (!d || !d.set) return; Object.defineProperty(proto, prop, { get: d.get, set: function (v) { d.set.call(this, rw(String(v))); }, configurable: true, enumerable: d.enumerable }); }
  [['HTMLScriptElement', 'src'], ['HTMLImageElement', 'src'], ['HTMLIFrameElement', 'src'], ['HTMLMediaElement', 'src'], ['HTMLSourceElement', 'src'], ['HTMLLinkElement', 'href'], ['HTMLAnchorElement', 'href'], ['HTMLFormElement', 'action'], ['HTMLEmbedElement', 'src'], ['HTMLTrackElement', 'src']].forEach(function (p) { if (window[p[0]]) hookProp(window[p[0]].prototype, p[1]); });
  var sa = Element.prototype.setAttribute; Element.prototype.setAttribute = function (n, v) { if (/^(src|href|action|poster|data-src)$/i.test(n) && typeof v === 'string') v = rw(v); return sa.call(this, n, v); };
  ['pushState', 'replaceState'].forEach(function (k) { var o = history[k]; history[k] = function (s, t, u) { try { if (typeof u === 'string' && u.charAt(0) === '/' && u.indexOf('/o/') !== 0) u = PREFIX + u; } catch (e) {} return o.call(this, s, t, u); }; });
  /* popups : toujours refusées, on compte */
  window.open = function () { post({ kind: 'popup' }); return null; };

  /* styles : focus visible + pubs évidentes */
  var st = document.createElement('style'); st.textContent = ':focus{outline:4px solid #4f8cff!important;outline-offset:2px!important}html{scroll-behavior:auto!important}'; (document.head || document.documentElement).appendChild(st);

  /* couches transparentes plein écran (clics détournés) : retirées au premier clic */
  document.addEventListener('click', function (e) {
    var t = e.target; if (!t || t === document.body || t === document.documentElement || t.tagName === 'VIDEO' || t.tagName === 'A' || t.tagName === 'BUTTON') return;
    var cs = getComputedStyle(t), r = t.getBoundingClientRect();
    if ((cs.position === 'fixed' || cs.position === 'absolute') && r.width > innerWidth * 0.6 && r.height > innerHeight * 0.6 && !t.textContent.trim() && !t.children.length && (parseFloat(cs.opacity) < 0.1 || cs.backgroundColor === 'rgba(0, 0, 0, 0)')) {
      e.preventDefault(); e.stopPropagation(); t.remove(); post({ kind: 'overlay' });
    }
  }, true);

  /* navigation spatiale */
  var SEL = 'a[href],button,input:not([type=hidden]),select,textarea,summary,[tabindex]:not([tabindex="-1"]),[onclick],[role=button],video';
  function rect(e) { return e.getBoundingClientRect(); }
  function vis(e) { var r = rect(e); if (r.width < 6 || r.height < 6) return false; var cs = getComputedStyle(e); if (cs.visibility === 'hidden' || cs.display === 'none' || cs.pointerEvents === 'none' || parseFloat(cs.opacity) < 0.05) return false; return r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth; }
  function cands() { return [].filter.call(document.querySelectorAll(SEL), vis); }
  function move(dir) {
    var cur = document.activeElement, list = cands(), best = null, bs = 1e12;
    if (!cur || cur === document.body || !vis(cur)) { list.sort(function (a, b) { var A = rect(a), B = rect(b); return (A.top - B.top) || (A.left - B.left); }); if (list[0]) { list[0].focus({ preventScroll: true }); return true; } return false; }
    var c = rect(cur), cx = c.left + c.width / 2, cy = c.top + c.height / 2;
    list.forEach(function (e) {
      if (e === cur || cur.contains(e) || e.contains(cur)) return;
      var r = rect(e), x = r.left + r.width / 2, y = r.top + r.height / 2, dx = x - cx, dy = y - cy, p, s;
      if (dir === 'ArrowRight') { p = r.left - c.right; s = Math.abs(dy); if (dx <= 0) return; } else if (dir === 'ArrowLeft') { p = c.left - r.right; s = Math.abs(dy); if (dx >= 0) return; }
      else if (dir === 'ArrowDown') { p = r.top - c.bottom; s = Math.abs(dx); if (dy <= 0) return; } else { p = c.top - r.bottom; s = Math.abs(dx); if (dy >= 0) return; }
      var sc = Math.max(p, 0) + s * 2.2; if (sc < bs) { bs = sc; best = e; }
    });
    if (best) { best.focus({ preventScroll: true }); var r2 = rect(best); if (r2.top < 80 || r2.bottom > innerHeight - 80) best.scrollIntoView({ block: 'center' }); return true; }
    return false;
  }
  function typing(e) { var t = e && e.tagName; return t === 'TEXTAREA' || (t === 'INPUT' && /^(text|search|url|email|password|tel|number|)$/i.test(e.type)) || (e && e.isContentEditable); }
  window.addEventListener('keydown', function (e) {
    var k = e.key, kc = e.keyCode, a = document.activeElement;
    if (kc === 461 || kc === 27 || kc === 8 && !typing(a)) { if (typing(a) && kc !== 461) return; e.preventDefault(); post({ kind: 'key', code: 461 }); return; }
    if (kc >= 403 && kc <= 406) { e.preventDefault(); post({ kind: 'key', code: kc }); return; }
    if (k.indexOf('Arrow') !== 0) return;
    if (typing(a) && (k === 'ArrowLeft' || k === 'ArrowRight')) return;
    if (a && a.tagName === 'VIDEO' && (k === 'ArrowLeft' || k === 'ArrowRight')) { e.preventDefault(); a.currentTime += k === 'ArrowRight' ? 10 : -10; return; }
    e.preventDefault();
    if (!move(k)) { if (k === 'ArrowDown') scrollBy(0, 420); else if (k === 'ArrowUp') { if (scrollY <= 0) post({ kind: 'key', code: 'toolbar' }); else scrollBy(0, -420); } }
  }, true);
  window.addEventListener('keydown', function (e) { if (e.keyCode === 13 && document.activeElement && document.activeElement.tagName === 'VIDEO') { var v = document.activeElement; if (v.paused) v.play(); else v.pause(); e.preventDefault(); } }, true);

  function announce() { post({ kind: 'nav', url: REAL.split('#')[0], title: document.title }); }
  window.addEventListener('load', announce); document.addEventListener('DOMContentLoaded', announce);
  new MutationObserver(function () { clearTimeout(announce.t); announce.t = setTimeout(announce, 400); }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
})();
