/* Signalisation WebRTC par relais HTTP (ntfy) — partagée par l'app TV et la page émettrice web.
   Les messages (offre / réponse SDP) sont découpés en morceaux < 4 Ko. Le flux vidéo, lui, ne passe PAS par le relais (WebRTC pair à pair). */
(function (g) {
  'use strict';
  var ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', CHUNK = 2400, DEFAULT_RELAY = 'https://ntfy.sh';
  function rnd(n) {
    var a = new Uint8Array(n); g.crypto.getRandomValues(a); var s = '';
    for (var i = 0; i < n; i++) s += ALPHA.charAt(a[i] % ALPHA.length);
    return s;
  }
  function Sig(o) {
    this.base = (o.relay || DEFAULT_RELAY).replace(/\/+$/, '');
    this.topic = 'tvcast-' + String(o.code).toUpperCase();
    this.role = o.role; this.sid = rnd(8); this.on = function () {}; this.onstate = function () {};
    this.asm = {}; this.stopped = false; this.last = ''; this.ctl = null;
  }
  Sig.prototype.open = function () {
    var self = this;
    return new Promise(function (resolve, reject) {
      var first = true;
      (function connect() {
        if (self.stopped) return;
        self.ctl = new AbortController();
        var url = self.base + '/' + self.topic + '/json' + (self.last ? '?since=' + encodeURIComponent(self.last) : '');
        fetch(url, { signal: self.ctl.signal, cache: 'no-store' }).then(function (res) {
          if (!res.ok) throw new Error('relais HTTP ' + res.status);
          self.onstate(true); if (first) { first = false; resolve(); }
          var rd = res.body.getReader(), dec = new TextDecoder(), buf = '';
          return (function pump() {
            return rd.read().then(function (r) {
              if (r.done) return;
              buf += dec.decode(r.value, { stream: true });
              var i; while ((i = buf.indexOf('\n')) >= 0) { var line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (line) self._line(line); }
              return pump();
            });
          })();
        }).then(function () { throw new Error('flux fermé'); }).catch(function (e) {
          if (self.stopped) return;
          self.onstate(false);
          if (first) { first = false; reject(e); }
          setTimeout(connect, 2500);
        });
      })();
    });
  };
  Sig.prototype._line = function (line) {
    var o; try { o = JSON.parse(line); } catch (e) { return; }
    if (o.id) this.last = o.id;
    if (o.event !== 'message' || !o.message) return;
    var m; try { m = JSON.parse(o.message); } catch (e2) { return; }
    if (!m || m.r === this.role || (m.t && m.t !== this.sid)) return;
    var key = m.s + ':' + m.k, a = this.asm[key] || (this.asm[key] = { n: m.n, p: [], c: 0 });
    if (a.p[m.i] == null) { a.p[m.i] = m.d; a.c++; }
    if (a.c < a.n) return;
    delete this.asm[key];
    var payload; try { payload = JSON.parse(a.p.join('')); } catch (e3) { return; }
    this.on(m.k, payload, m.s);
  };
  Sig.prototype.send = function (kind, obj, to) {
    var self = this, s = JSON.stringify(obj || {}), n = Math.max(1, Math.ceil(s.length / CHUNK)), jobs = [];
    function post(body, tries) {
      return fetch(self.base + '/' + self.topic, { method: 'POST', body: body }).then(function (r) {
        if (!r.ok) throw new Error('relais HTTP ' + r.status);
      }).catch(function (e) { if (tries > 0) return new Promise(function (ok) { setTimeout(ok, 1200); }).then(function () { return post(body, tries - 1); }); throw e; });
    }
    for (var i = 0; i < n; i++) jobs.push({ r: self.role, s: self.sid, k: kind, t: to || undefined, i: i, n: n, d: s.slice(i * CHUNK, (i + 1) * CHUNK) });
    return jobs.reduce(function (p, j) { return p.then(function () { return post(JSON.stringify(j), 2); }); }, Promise.resolve());
  };
  Sig.prototype.close = function () { this.stopped = true; try { this.ctl && this.ctl.abort(); } catch (e) {} };

  /* attend la fin de la collecte ICE (pas de trickle : un seul message dans chaque sens) */
  function iceDone(pc, ms) {
    return new Promise(function (ok) {
      if (pc.iceGatheringState === 'complete') return ok();
      var t = setTimeout(done, ms || 3000);
      function done() { clearTimeout(t); pc.removeEventListener('icegatheringstatechange', ch); ok(); }
      function ch() { if (pc.iceGatheringState === 'complete') done(); }
      pc.addEventListener('icegatheringstatechange', ch);
    });
  }
  g.TVCast = { Sig: Sig, rnd: rnd, iceDone: iceDone, DEFAULT_RELAY: DEFAULT_RELAY,
    ICE: [{ urls: 'stun:stun.l.google.com:19302' }] };
})(typeof window !== 'undefined' ? window : globalThis);
