import { createRequire } from 'node:module'; import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { createRequire as cr } from 'node:module';
const req = cr(import.meta.url); const { createProxy } = req('../service/web-proxy.js');
const { chromium } = req(process.env.PW);
const root = path.resolve(new URL('..', import.meta.url).pathname), site = '/tmp/website'; fs.rmSync(site, { recursive: true, force: true }); fs.mkdirSync(site, { recursive: true });
fs.cpSync(root + '/apps/web', site, { recursive: true }); fs.copyFileSync(root + '/node_modules/hls.js/dist/hls.min.js', site + '/hls.min.js');
const HTML = `<!doctype html><html><head><title>Site test</title><script src="http://localhost:8098/ad.js"></script><script src="/app.js"></script></head><body style="margin:0;font:30px sans-serif">
<h1>Bonjour</h1><a id="l1" href="/page2">page 2</a> <a id="l2" href="http://127.0.0.1:8097/abs">absolu</a> <button id="pop" onclick="window.open('http://localhost:8098/pop')">popup</button>
<div id="ad1" class="adsbygoogle" style="height:60px">PUB</div><video id="vid" src="/t.webm" width="320" height="180" controls muted></video>
<iframe id="fr" src="/frame" width="300" height="100"></iframe><div id="ov" style="position:fixed;inset:0;opacity:0;z-index:99"></div><p id="out"></p></body></html>`;
const upstream = http.createServer((q, r) => {
  const h = { 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "frame-ancestors 'none'" };
  if (q.url === '/') { r.writeHead(200, { ...h, 'Content-Type': 'text/html', 'Set-Cookie': 'sid=abc; Path=/; HttpOnly; SameSite=Lax' }); return r.end(HTML); }
  if (q.url === '/app.js') { r.writeHead(200, { ...h, 'Content-Type': 'application/javascript' }); return r.end("window.OK=1; fetch('/api').then(x=>x.text()).then(t=>{document.getElementById('out').textContent=t+'|'+document.cookie.length});"); }
  if (q.url === '/api') { r.writeHead(200, { 'Content-Type': 'text/plain' }); return r.end('api-ok cookie=' + (q.headers.cookie || 'none')); }
  if (q.url === '/page2') { r.writeHead(200, { ...h, 'Content-Type': 'text/html' }); return r.end('<title>P2</title><h1 id="p2">Page deux</h1><a href="/">retour</a>'); }
  if (q.url === '/abs') { r.writeHead(200, { ...h, 'Content-Type': 'text/html' }); return r.end('<h1 id="abs">Absolu</h1>'); }
  if (q.url === '/frame') { r.writeHead(200, { ...h, 'Content-Type': 'text/html' }); return r.end('<p id="infr">dans iframe</p>'); }
  if (q.url === '/t.webm') { const f = fs.readFileSync(root + '/test/t.webm'); r.writeHead(200, { 'Content-Type': 'video/webm', 'Content-Length': f.length }); return r.end(f); }
  r.writeHead(404); r.end();
}).listen(8097);
const ads = http.createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'application/javascript' }); r.end('window.AD=1;'); }).listen(8098);
const px = createProxy({ hosts: ['localhost'], clientJs: root + '/service/web-client.js' }); await new Promise(ok => px.listen(8796, ok));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const st = http.createServer((q, r) => { const f = path.join(site, q.url.split('?')[0].replace(/^\/$/, '/index.html')); if (!fs.existsSync(f)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); r.end(fs.readFileSync(f)); }).listen(8091);
const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] }); const errs = []; const ok = (n, c) => console.log((c ? 'OK  ' : 'FAIL') + ' ' + n);
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } }); p.on('pageerror', e => errs.push(e.message));
await p.goto('http://localhost:8091/index.html?port=8796'); await p.waitForSelector('#urlin');
await p.fill('#urlin', '127.0.0.1:8097'); await p.press('#urlin', 'Enter');
const fr = () => p.frames().find(f => f !== p.mainFrame());
await p.waitForFunction(() => document.getElementById('page').classList.contains('on')); await p.waitForTimeout(1500);
let f = fr(); console.log('frame url', f.url(), (await f.content()).slice(0,300)); ok('page chargée malgré X-Frame-Options/CSP', await f.evaluate(() => document.getElementById('l1') != null));
ok('script pub bloqué (window.AD indéfini)', await f.evaluate(() => typeof window.AD === 'undefined'));
ok('script du site exécuté + fetch racine relatif', await f.evaluate(() => window.OK === 1)); await p.waitForTimeout(500);
console.log('   sortie fetch:', await f.evaluate(() => document.getElementById('out').textContent));
ok('pub cosmétique masquée', await f.evaluate(() => getComputedStyle(document.getElementById('ad1')).display === 'none'));
ok('iframe interne via proxy', await f.childFrames()[0]?.evaluate(() => !!document.getElementById('infr')));
ok('vidéo détectée', (await (await fetch('http://127.0.0.1:8796/__sniff')).json()).length >= 1);
await p.waitForTimeout(3200); console.log('   bouclier:', await p.textContent('#nblk'), 'vidéos:', await p.textContent('#nvid'));
// popup
await f.click('#pop'); await p.waitForTimeout(300); ok('popup bloquée (toast)', (await p.textContent('#toast')).includes('Popup'));
// overlay transparent plein écran : le 1er clic le retire
await f.evaluate(() => document.getElementById('ov').style.pointerEvents = 'auto'); await p.mouse.click(900, 900); await p.waitForTimeout(300); ok('overlay retiré', await f.evaluate(() => !document.getElementById('ov')));
// navigation clavier
await f.evaluate(() => document.activeElement && document.activeElement.blur()); await p.keyboard.press('ArrowDown'); await p.waitForTimeout(100);
ok('focus clavier sur un lien', await f.evaluate(() => document.activeElement && document.activeElement.id === 'l1'));
await p.keyboard.press('Enter'); await p.waitForTimeout(1200); f = fr(); ok('lien suivi (page 2)', await f.evaluate(() => !!document.getElementById('p2')));
// Retour -> page précédente puis accueil
await p.keyboard.press('Escape'); await p.waitForTimeout(1200); f = fr(); ok('Retour = page précédente', await f.evaluate(() => !!document.getElementById('l1')));
await p.screenshot({ path: '/tmp/claude-0/shots/w-1-page.png' });
// barre d'outils + lecteur
await p.evaluate(() => TVWebApp.mode()); await f.evaluate(() => parent.postMessage({ tvweb: true, kind: 'key', code: 'toolbar' }, '*')); await p.waitForTimeout(300);
ok('barre visible', await p.evaluate(() => !document.getElementById('bar').classList.contains('hidden'))); await p.screenshot({ path: '/tmp/claude-0/shots/w-2-bar.png' });
await p.keyboard.press('ArrowDown'); await f.evaluate(() => parent.postMessage({ tvweb: true, kind: 'key', code: 405 }, '*')); await p.waitForTimeout(400);
await p.screenshot({ path: '/tmp/claude-0/shots/w-3-vlist.png' }); await p.keyboard.press('Enter'); await p.waitForTimeout(1500);
ok('lecteur en lecture', await p.evaluate(() => { const v = document.getElementById('pv'); return !document.getElementById('player').classList.contains('hidden') && (v.currentTime > 0 || v.readyState > 1); }));
await p.keyboard.press('Escape'); await p.waitForTimeout(200); ok('lecteur fermé', await p.evaluate(() => document.getElementById('player').classList.contains('hidden')));
console.log('erreurs page:', errs, 'stats', JSON.stringify(px.stats));
await b.close(); [upstream, ads, st].forEach(s => s.close()); px.close();
