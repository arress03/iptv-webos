'use strict';
/* Service webOS : saisie des identifiants depuis un téléphone (page servie sur l'IP de la TV).
 * Les identifiants sont aussi écrits dans un fichier partagé par les 3 apps (saisie une seule fois). */
const Service = require('webos-service');
const http = require('http');
const https = require('https');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const ID = process.env.IPTV_SERVICE_ID || require('./package.json').name;
const service = new Service(ID);
const FILES = ['/media/developer/iptv-webos.json', '/tmp/iptv-webos.json'];
const PORTS = [8781, 8782, 8783, 8784, 8785];
const PAIR_MS = 10 * 60 * 1000;

let pair = null;          // { server, code, port, timer }
let keepAlive = null;

function readCfg() {
  for (const f of FILES) { try { const c = JSON.parse(fs.readFileSync(f, 'utf8')); if (c && c.server && c.username) return c; } catch (e) {} }
  return null;
}
function writeCfg(c) {
  let ok = false;
  for (const f of FILES) { try { fs.writeFileSync(f, JSON.stringify(c), { mode: 0o600 }); ok = true; break; } catch (e) {} }
  return ok;
}
function clearCfg() { FILES.forEach(f => { try { fs.unlinkSync(f); } catch (e) {} }); }
function localIps() {
  const out = [], ifs = os.networkInterfaces();
  Object.keys(ifs).forEach(n => (ifs[n] || []).forEach(a => { if (a.family === 'IPv4' && !a.internal) out.push(a.address); }));
  return out;
}

// Vérifie les identifiants auprès du fournisseur (une seule requête, 12 s max).
function checkProvider(c) {
  return new Promise(resolve => {
    let u;
    try { u = new URL(c.server + '/player_api.php?username=' + encodeURIComponent(c.username) + '&password=' + encodeURIComponent(c.password)); }
    catch (e) { return resolve({ ok: false, error: 'Adresse du serveur invalide.' }); }
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.get(u, { timeout: 12000 }, res => {
      let b = ''; res.setEncoding('utf8');
      res.on('data', d => { b += d; if (b.length > 1e6) req.destroy(); });
      res.on('end', () => {
        try {
          const j = JSON.parse(b), ui = j.user_info;
          if (!ui || String(ui.auth) !== '1') return resolve({ ok: false, error: 'Identifiants refusés par le serveur.' });
          resolve({ ok: true, max: ui.max_connections, exp: ui.exp_date });
        } catch (e) { resolve({ ok: false, error: 'Réponse inattendue du serveur.' }); }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'Le serveur ne répond pas.' }); });
    req.on('error', () => resolve({ ok: false, error: 'Serveur injoignable depuis la TV.' }));
  });
}

const PAGE = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>IPTV – Identifiants</title><style>
body{margin:0;background:#0b0d12;color:#eef1f7;font:18px/1.4 system-ui,sans-serif;display:flex;justify-content:center;padding:28px 16px}
main{width:100%;max-width:440px}h1{font-size:26px;margin:0 0 6px}p{color:#8f98ab;margin:0 0 20px}
label{display:block;margin:14px 0 6px;color:#c9d0de;font-size:15px}
input{width:100%;box-sizing:border-box;background:#1b2130;border:0;border-radius:12px;padding:14px 16px;color:#fff;font-size:18px}
button{margin-top:22px;width:100%;background:#4f8cff;color:#fff;border:0;border-radius:12px;padding:16px;font-size:18px;font-weight:600}
#m{margin-top:16px;min-height:24px}.err{color:#ff6b6b}.ok{color:#5ee08a}
</style></head><body><main><h1>Identifiants IPTV</h1><p>Envoyés directement à ta TV (réseau local), rien ne transite sur Internet.</p>
<label>Code affiché sur la TV</label><input id="code" inputmode="numeric" maxlength="6" autocomplete="off">
<label>Serveur ou URL M3U</label><input id="srv" placeholder="http://serveur:port" autocapitalize="off" autocomplete="off">
<label>Utilisateur</label><input id="usr" autocapitalize="off" autocomplete="off">
<label>Mot de passe</label><input id="pwd" autocapitalize="off" autocomplete="off">
<button id="go">Envoyer à la TV</button><div id="m"></div></main><script>
var $=function(i){return document.getElementById(i)};
$('srv').addEventListener('change',function(){try{var s=$('srv').value.trim();if(!/^https?:/i.test(s))s='http://'+s;var u=new URL(s);
$('srv').value=u.protocol+'//'+u.host;if(u.searchParams.get('username'))$('usr').value=u.searchParams.get('username');if(u.searchParams.get('password'))$('pwd').value=u.searchParams.get('password')}catch(e){}});
$('go').onclick=function(){$('srv').dispatchEvent(new Event('change'));var m=$('m');m.className='';m.textContent='Vérification…';
fetch('/api/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:$('code').value.trim(),server:$('srv').value.trim(),username:$('usr').value.trim(),password:$('pwd').value.trim()})})
.then(function(r){return r.json()}).then(function(j){if(j.ok){m.className='ok';m.textContent='✓ Connecté'+(j.max?' ('+j.max+' écrans max)':'')+'. Tu peux regarder la TV.'}else{m.className='err';m.textContent=j.error||'Erreur'}})
.catch(function(){m.className='err';m.textContent='TV injoignable.'})};
</script></body></html>`;

function stopPair() {
  if (!pair) return;
  clearTimeout(pair.timer);
  try { pair.srv.close(); } catch (e) {}
  pair = null;
  if (keepAlive) { try { service.activityManager.complete(keepAlive, () => {}); } catch (e) {} keepAlive = null; }
}

function startPair(cb) {
  if (pair) return cb(null, pair);
  const code = String(crypto.randomBytes(4).readUInt32BE(0) % 1000000).padStart(6, '0');
  const srv = http.createServer((req, res) => {
    if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/?'))) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end(PAGE);
    }
    if (req.method === 'POST' && req.url === '/api/save') {
      let b = ''; req.on('data', d => { b += d; if (b.length > 4096) req.destroy(); });
      req.on('end', () => {
        const send = (o) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
        let j; try { j = JSON.parse(b); } catch (e) { return send({ ok: false, error: 'Requête invalide.' }); }
        if (!pair) return send({ ok: false, error: 'Session terminée : relance la saisie sur la TV.' });
        if (String(j.code) !== pair.code) {
          if (++pair.bad >= 5) { send({ ok: false, error: 'Trop d’essais : relance la saisie sur la TV.' }); return stopPair(); }
          return send({ ok: false, error: 'Code incorrect (regarde l’écran de la TV).' });
        }
        let server = String(j.server || '').trim(); if (!/^https?:\/\//i.test(server)) server = 'http://' + server;
        try { server = new URL(server).origin; } catch (e) { return send({ ok: false, error: 'Adresse du serveur invalide.' }); }
        const c = { server, username: String(j.username || '').trim(), password: String(j.password || '').trim() };
        if (!c.username || !c.password) return send({ ok: false, error: 'Utilisateur et mot de passe requis.' });
        checkProvider(c).then(r => {
          if (!r.ok) return send(r);
          const saved = writeCfg(c); pair.received = c;
          send({ ok: true, max: r.max, saved });
          setTimeout(stopPair, 4000);
        });
      });
      return;
    }
    res.writeHead(404); res.end();
  });
  let i = 0;
  (function tryListen() {
    const port = PORTS[i];
    srv.once('error', e => { if (e.code === 'EADDRINUSE' && ++i < PORTS.length) tryListen(); else cb(e); });
    srv.listen(port, '0.0.0.0', () => {
      srv.removeAllListeners('error');
      pair = { srv, code, port, bad: 0, received: null, timer: setTimeout(stopPair, PAIR_MS) };
      try { service.activityManager.create('keepAlive', a => { keepAlive = a; }); } catch (e) {}
      cb(null, pair);
    });
  })();
}

service.register('startPair', msg => {
  startPair((err, p) => {
    if (err) return msg.respond({ returnValue: false, errorText: String(err.message || err) });
    msg.respond({ returnValue: true, ips: localIps(), port: p.port, code: p.code });
  });
});
service.register('pairStatus', msg => {
  msg.respond({ returnValue: true, active: !!pair, config: (pair && pair.received) || readCfg() });
});
service.register('stopPair', msg => { stopPair(); msg.respond({ returnValue: true }); });
service.register('getConfig', msg => msg.respond({ returnValue: true, config: readCfg() }));
service.register('setConfig', msg => {
  const c = msg.payload && msg.payload.config;
  if (!c || !c.server || !c.username) return msg.respond({ returnValue: false, errorText: 'config invalide' });
  msg.respond({ returnValue: true, saved: writeCfg({ server: c.server, username: c.username, password: c.password || '' }) });
});
service.register('clearConfig', msg => { clearCfg(); msg.respond({ returnValue: true }); });

module.exports = { checkProvider };
