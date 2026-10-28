'use strict';
/* Service webOS des jeux : relais HTTPS limité à l'API iTunes (évite les blocages CORS du navigateur de la TV). */
const Service = require('webos-service');
const https = require('https');
const ID = process.env.IPTV_SERVICE_ID || require('./package.json').name;
const service = new Service(ID);
const ALLOWED = ['itunes.apple.com'];

service.register('fetchJson', msg => {
  let u;
  try { u = new URL(String((msg.payload || {}).url)); } catch (e) { return msg.respond({ returnValue: false, errorText: 'url invalide' }); }
  if (u.protocol !== 'https:' || ALLOWED.indexOf(u.hostname) < 0) return msg.respond({ returnValue: false, errorText: 'hôte non autorisé' });
  let sent = false; const reply = o => { if (!sent) { sent = true; msg.respond(o); } };
  const req = https.get(u, { timeout: 12000, headers: { 'User-Agent': 'iptv-webos-games' } }, res => {
    let b = ''; res.setEncoding('utf8');
    res.on('data', d => { b += d; if (b.length > 3e6) req.destroy(); });
    res.on('end', () => reply({ returnValue: res.statusCode === 200, status: res.statusCode, body: b }));
  });
  req.on('timeout', () => { req.destroy(); });
  req.on('error', e => reply({ returnValue: false, errorText: String(e.message || e) }));
});
