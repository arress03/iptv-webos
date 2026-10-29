'use strict';
/* Service webOS de TVWeb : lance le proxy filtrant local (127.0.0.1) et met à jour la liste de blocage. */
const Service = require('webos-service');
const fs = require('fs'), os = require('os'), path = require('path'), https = require('https');
const { createProxy, parseHosts } = require('./web-proxy.js');
const ID = process.env.IPTV_SERVICE_ID || require('./package.json').name;
const service = new Service(ID);
const PORTS = [8795, 8796, 8797, 8798, 8799];
const DEFAULT_LIST = 'https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts';
let proxy = null, port = 0;

function cacheFile() { for (const d of ['/var/luna/preferences', os.tmpdir()]) { try { fs.accessSync(d, fs.constants.W_OK); return path.join(d, 'tvweb-hosts.txt'); } catch (e) {} } return null; }
function loadHosts() {
  let hosts = parseHosts(fs.readFileSync(path.join(__dirname, 'adblock-hosts.txt'), 'utf8'));
  try { const f = cacheFile(); if (f && fs.existsSync(f)) hosts = hosts.concat(parseHosts(fs.readFileSync(f, 'utf8'))); } catch (e) {}
  return hosts;
}
function startProxy(i, cb) {
  if (i >= PORTS.length) return cb(new Error('aucun port libre'));
  const p = createProxy({ hosts: loadHosts(), clientJs: path.join(__dirname, 'web-client.js') });
  p.server.once('error', () => startProxy(i + 1, cb));
  p.listen(PORTS[i], () => { proxy = p; port = PORTS[i]; cb(null); });
}

service.register('start', msg => {
  if (proxy) return msg.respond({ returnValue: true, port, hosts: proxy.hosts.size });
  startProxy(0, err => err ? msg.respond({ returnValue: false, errorText: String(err.message) }) : msg.respond({ returnValue: true, port, hosts: proxy.hosts.size }));
});

service.register('updateList', msg => {
  let u; try { u = new URL(String((msg.payload || {}).url || DEFAULT_LIST)); } catch (e) { return msg.respond({ returnValue: false, errorText: 'url invalide' }); }
  if (u.protocol !== 'https:') return msg.respond({ returnValue: false, errorText: 'https requis' });
  let done = false; const reply = o => { if (!done) { done = true; msg.respond(o); } };
  const req = https.get(u, { timeout: 20000, headers: { 'User-Agent': 'tvweb' } }, res => {
    if (res.statusCode !== 200) { res.resume(); return reply({ returnValue: false, errorText: 'HTTP ' + res.statusCode }); }
    let b = ''; res.setEncoding('utf8'); res.on('data', d => { b += d; if (b.length > 8e6) req.destroy(); });
    res.on('end', () => {
      const list = parseHosts(b); if (list.length < 100) return reply({ returnValue: false, errorText: 'liste trop courte' });
      try { const f = cacheFile(); if (f) fs.writeFileSync(f, list.join('\n')); } catch (e) {}
      if (proxy) list.forEach(h => proxy.hosts.add(h));
      reply({ returnValue: true, added: list.length, total: proxy ? proxy.hosts.size : list.length });
    });
  });
  req.on('timeout', () => req.destroy()); req.on('error', e => reply({ returnValue: false, errorText: String(e.message) }));
});
