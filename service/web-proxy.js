'use strict';
/* Proxy local filtrant de TVWeb : écoute UNIQUEMENT sur 127.0.0.1.
   - bloque les domaines/motifs publicitaires, retire les en-têtes qui interdisent l'affichage en iframe,
   - réécrit les URL (HTML/CSS/m3u8) pour que tout passe par lui, injecte le script client (navigation télécommande, anti-popups),
   - repère les flux vidéo (mp4/m3u8/…) pour les lire dans le lecteur de l'app. */
const http = require('http'), https = require('https'), zlib = require('zlib'), fs = require('fs'), net = require('net');
const b64u = s => Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString();
const PATTERNS = [/\/(?:pop(?:under|up|ads?)|adserver|ad-?banner|banner-?ads?)[\/._-]/i, /[?&](?:pop(?:under)?|adunit)=/i, /\/ads?\/(?!.*\.(?:mp4|m3u8)$)[^/]*\.(?:js|gif|png|jpg|html)(?:\?|$)/i];
const COSMETIC = 'ins.adsbygoogle,iframe[src*="doubleclick"],iframe[src*="googlesyndication"],[id^="google_ads"],.adsbox,.ad-banner,.ads-banner,.adsbygoogle,.popup-ad,div[class*="popunder"],[id^="div-gpt-ad"],[class*="advert-"],#ads,#ad-container{display:none!important}';

function isPrivateHost(h) {
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.localhost')) return true;
  if (net.isIPv4(h)) { const p = h.split('.').map(Number); return p[0] === 10 || p[0] === 127 || p[0] === 0 || (p[0] === 169 && p[1] === 254) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168); }
  if (net.isIPv6(h)) return true;
  return false;
}

function createProxy(opts) {
  const hosts = new Set((opts.hosts || []).map(s => s.toLowerCase()));
  const clientJs = fs.readFileSync(opts.clientJs, 'utf8');
  const jar = {}, sniff = [], allowPrivate = new Set(), stats = { requests: 0, blocked: 0, byHost: {} };
  const px = href => { const u = new URL(href); return '/o/' + b64u(u.origin) + u.pathname + u.search + u.hash; };
  function blockedHost(h) { h = h.toLowerCase(); for (;;) { if (hosts.has(h)) return true; const i = h.indexOf('.'); if (i < 0) return false; h = h.slice(i + 1); } }
  function isBlocked(u) { return blockedHost(u.hostname) || PATTERNS.some(r => r.test(u.pathname + u.search)); }
  function rwUrl(v, base) {
    v = String(v).trim(); if (!v || /^(data:|blob:|javascript:|mailto:|tel:|#|about:)/i.test(v)) return v;
    try { const a = new URL(v.replace(/&amp;/g, '&'), base); return /^https?:$/.test(a.protocol) ? px(a.href) : v; } catch (e) { return v; }
  }
  const rwCss = (css, base) => css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (m, q, u) => 'url(' + q + rwUrl(u, base) + q + ')').replace(/@import\s+(['"])([^'"]+)\1/gi, (m, q, u) => '@import ' + q + rwUrl(u, base) + q);
  function rwHtml(html, base) {
    html = html.replace(/\sintegrity\s*=\s*("[^"]*"|'[^']*')/gi, '').replace(/<base\b[^>]*>/gi, '');
    html = html.replace(/(\s(?:href|src|action|poster|data-src|data-url|data-href|data-lazy-src|formaction)\s*=\s*)("([^"]*)"|'([^']*)'|([^\s>"']+))/gi, (m, pre, q, a, b, c) => {
      const v = a !== undefined ? a : b !== undefined ? b : c; return pre + '"' + rwUrl(v, base).replace(/"/g, '&quot;') + '"';
    });
    html = html.replace(/(\ssrcset\s*=\s*)("([^"]*)"|'([^']*)')/gi, (m, pre, q, a, b) => pre + '"' + (a !== undefined ? a : b).split(',').map(s => { s = s.trim(); const i = s.search(/\s/); return i < 0 ? rwUrl(s, base) : rwUrl(s.slice(0, i), base) + s.slice(i); }).join(', ') + '"');
    html = html.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, (m, a, css, c) => a + rwCss(css, base) + c);
    html = html.replace(/(\sstyle\s*=\s*)("[^"]*"|'[^']*')/gi, (m, pre, v) => pre + v[0] + rwCss(v.slice(1, -1), base) + v[0]);
    html = html.replace(/(<meta\b[^>]*http-equiv\s*=\s*["']?refresh[^>]*content\s*=\s*["'])(\d+\s*;\s*url=)([^"']+)/gi, (m, a, b, u) => a + b + rwUrl(u, base));
    const inject = '<script src="/__tvweb.js"></script><style>' + COSMETIC + '</style>';
    return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, m => m + inject) : inject + html;
  }
  function rwM3u8(txt, base) {
    return txt.split(/\r?\n/).map(l => { l = l.trim(); if (!l) return l; if (l[0] === '#') return l.replace(/URI="([^"]+)"/g, (m, u) => 'URI="' + rwUrl(u, base) + '"'); return rwUrl(l, base); }).join('\n');
  }
  function cookieHeader(host) { const j = jar[host]; return j ? Object.keys(j).map(k => k + '=' + j[k]).join('; ') : ''; }
  function reply(res, code, type, body) { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(body); }
  function blockedReply(res, u) {
    stats.blocked++; stats.byHost[u.hostname] = (stats.byHost[u.hostname] || 0) + 1;
    const p = u.pathname.toLowerCase();
    if (/\.js$/.test(p)) return reply(res, 200, 'application/javascript', '/* bloqué */');
    if (/\.css$/.test(p)) return reply(res, 200, 'text/css', '');
    if (/\.(png|gif|jpe?g|webp|svg)$/.test(p)) return reply(res, 200, 'image/gif', Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'));
    if (/\.(html?|php)$/.test(p) || !/\.[a-z0-9]{2,5}$/.test(p)) return reply(res, 200, 'text/html', '<!doctype html><meta charset="utf-8"><body style="background:transparent">');
    return reply(res, 204, 'text/plain', '');
  }

  function forward(req, res, target, top) {
    let t; try { t = new URL(target); } catch (e) { return reply(res, 400, 'text/plain', 'URL invalide'); }
    if (!/^https?:$/.test(t.protocol)) return reply(res, 400, 'text/plain', 'protocole non supporté');
    stats.requests++;
    if (!top && isBlocked(t)) return blockedReply(res, t);
    if (isPrivateHost(t.hostname) && !allowPrivate.has(t.hostname)) return reply(res, 403, 'text/plain', 'adresse locale refusée');
    const h = Object.assign({}, req.headers); delete h.host; delete h['accept-encoding']; delete h['content-length']; delete h['x-forwarded-for'];
    h.referer = t.origin + '/'; if (h.origin) h.origin = t.origin; h['accept-encoding'] = 'identity';
    const ck = cookieHeader(t.hostname); if (ck) h.cookie = ck; else delete h.cookie;
    if (req.method !== 'GET' && req.method !== 'HEAD') { /* corps transmis tel quel (chunked) */ delete h['transfer-encoding']; }
    const lib = t.protocol === 'https:' ? https : http;
    const pr = lib.request({ hostname: t.hostname, port: t.port || undefined, path: t.pathname + t.search, method: req.method, headers: h, timeout: 25000, rejectUnauthorized: true }, up => {
      const hd = Object.assign({}, up.headers);
      ['x-frame-options', 'content-security-policy', 'content-security-policy-report-only', 'strict-transport-security', 'cross-origin-opener-policy', 'cross-origin-embedder-policy'].forEach(k => delete hd[k]);
      hd['access-control-allow-origin'] = '*';
      const sc = hd['set-cookie']; delete hd['set-cookie'];
      if (sc) { (jar[t.hostname] = jar[t.hostname] || {}); [].concat(sc).forEach(c => { const kv = c.split(';')[0], i = kv.indexOf('='); if (i > 0) { const n = kv.slice(0, i).trim(), v = kv.slice(i + 1); if (/max-age=0|expires=.*1970/i.test(c)) delete jar[t.hostname][n]; else jar[t.hostname][n] = v; } }); }
      if (hd.location && up.statusCode >= 300 && up.statusCode < 400) { try { hd.location = px(new URL(hd.location, t).href); } catch (e) {} }
      const ct = String(hd['content-type'] || '').toLowerCase(), pth = t.pathname.toLowerCase();
      const isM3u8 = /mpegurl/.test(ct) || /\.m3u8$/.test(pth), isHtml = /text\/html/.test(ct), isCss = /text\/css/.test(ct) || /\.css$/.test(pth);
      if ((up.statusCode === 200 || up.statusCode === 206) && (/^(video|audio)\//.test(ct) || isM3u8 || /dash\+xml/.test(ct) || /\.(mp4|webm|mkv|mpd)$/.test(pth)) && !/\.(ts|m4s|aac)$/.test(pth) && !sniff.some(s => s.url === t.href)) {
        sniff.push({ url: t.href, via: px(t.href), type: ct || 'media', page: req.headers.referer || '', t: Date.now() }); if (sniff.length > 30) sniff.shift();
      }
      if (!(isHtml || isCss || isM3u8)) { res.writeHead(up.statusCode, hd); up.pipe(res); return; }
      let stream = up; const enc = String(hd['content-encoding'] || '').toLowerCase();
      if (enc === 'gzip') stream = up.pipe(zlib.createGunzip()); else if (enc === 'deflate') stream = up.pipe(zlib.createInflate()); else if (enc === 'br') stream = up.pipe(zlib.createBrotliDecompress());
      delete hd['content-encoding']; delete hd['content-length']; delete hd.etag;
      const chunks = []; stream.on('data', c => chunks.push(c)); stream.on('error', () => res.destroy());
      stream.on('end', () => {
        let txt = Buffer.concat(chunks).toString('utf8');
        txt = isM3u8 ? rwM3u8(txt, t.href) : isCss ? rwCss(txt, t.href) : rwHtml(txt, t.href);
        hd['content-type'] = (isHtml ? 'text/html' : isCss ? 'text/css' : ct.split(';')[0]) + '; charset=utf-8'; res.writeHead(up.statusCode, hd); res.end(txt);
      });
    });
    pr.on('timeout', () => pr.destroy(new Error('délai dépassé')));
    pr.on('error', e => { if (!res.headersSent) reply(res, 502, 'text/html; charset=utf-8', '<body style="font:28px sans-serif;background:#0b0d12;color:#eee;padding:60px">Impossible de charger la page :<br><br>' + String(e.message).replace(/[<>&]/g, '') + '</body>'); else res.destroy(); });
    if (req.method === 'GET' || req.method === 'HEAD') pr.end(); else req.pipe(pr);
  }

  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' }); return res.end(); }
    if (u.pathname === '/__tvweb.js') return reply(res, 200, 'application/javascript; charset=utf-8', clientJs);
    if (u.pathname === '/__ping') return reply(res, 200, 'text/plain', 'ok');
    if (u.pathname === '/__stats') return reply(res, 200, 'application/json', JSON.stringify(stats));
    if (u.pathname === '/__sniff') return reply(res, 200, 'application/json', JSON.stringify(sniff));
    if (u.pathname === '/__clear') { sniff.length = 0; Object.keys(jar).forEach(k => delete jar[k]); stats.blocked = 0; stats.requests = 0; stats.byHost = {}; return reply(res, 200, 'text/plain', 'ok'); }
    if (u.pathname === '/__go') {
      let t = (u.searchParams.get('u') || '').trim(); if (!t) return reply(res, 400, 'text/plain', 'url manquante');
      if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) { let pre = 'https://'; try { if (isPrivateHost(new URL('http://' + t).hostname)) pre = 'http://'; } catch (e) {} t = pre + t; }
      try { const x = new URL(t); if (isPrivateHost(x.hostname)) allowPrivate.add(x.hostname); res.writeHead(302, { Location: px(x.href) }); return res.end(); } catch (e) { return reply(res, 400, 'text/plain', 'URL invalide'); }
    }
    const m = u.pathname.match(/^\/o\/([A-Za-z0-9_-]+)(\/.*)?$/); let target;
    if (m) { try { target = unb64u(m[1]) + (m[2] || '/') + u.search; } catch (e) { return reply(res, 400, 'text/plain', 'adresse invalide'); } }
    else { const rm = (req.headers.referer || '').match(/\/o\/([A-Za-z0-9_-]+)/); if (!rm) return reply(res, 404, 'text/plain', 'introuvable'); target = unb64u(rm[1]) + u.pathname + u.search; }
    forward(req, res, target, req.headers['sec-fetch-dest'] === 'iframe' && false);
  });
  return { server, stats, sniff, hosts, listen: (port, cb) => server.listen(port, '127.0.0.1', cb), close: () => server.close() };
}

/* liste d'hôtes : format hosts (« 0.0.0.0 domaine ») ou un domaine par ligne */
function parseHosts(txt) {
  const out = []; txt.split(/\r?\n/).forEach(l => { l = l.replace(/#.*/, '').trim(); if (!l) return; const p = l.split(/\s+/), d = (p.length > 1 && /^(0\.0\.0\.0|127\.0\.0\.1)$/.test(p[0]) ? p[1] : p[0]).toLowerCase(); if (/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d) && d !== 'localhost') out.push(d); });
  return out;
}
module.exports = { createProxy, parseHosts, b64u, unb64u };
