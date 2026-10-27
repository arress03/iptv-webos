import { createRequire } from 'node:module'; const { chromium } = createRequire(import.meta.url)(process.env.PW || 'playwright');
const b = await chromium.launch(); const errs = [];
async function open(app) {
  const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  p.on('pageerror', e => errs.push(app + ' PAGEERR ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(app + ' ' + m.text()); });
  await p.goto(`http://localhost:8090/${app}/index.html`); return p;
}
const shot = (p, n) => p.screenshot({ path: `/tmp/claude-0/shots/${n}.png` });
// 1. écran de connexion
let p = await open('films'); await p.waitForSelector('.login'); await shot(p, '1-login');
await p.fill('input >> nth=0', 'http://localhost:8089'); await p.fill('input >> nth=1', 'u'); await p.fill('input >> nth=2', 'p');
await p.click('.btn.primary'); await p.waitForSelector('.grid .card'); await p.waitForTimeout(500); await shot(p, '2-films');
const cfg = await p.evaluate(() => localStorage.getItem('xt.cfg')); console.log('cfg saved', !!cfg);
// navigation clavier + détail
await p.keyboard.press('ArrowRight'); await p.keyboard.press('ArrowDown'); await p.keyboard.press('Enter'); await p.waitForSelector('.detail'); await p.waitForTimeout(500); await shot(p, '3-film-detail');
await p.keyboard.press('Escape'); await p.waitForTimeout(300); console.log('detail closed', await p.$('.detail') === null);
// 2. séries
for (const [app, shotn] of [['series', '4-series'], ['livetv', '5-live']]) {
  const q = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  q.on('pageerror', e => errs.push(app + ' PAGEERR ' + e.message)); q.on('console', m => { if (m.type() === 'error') errs.push(app + ' ' + m.text()); });
  await q.addInitScript(c => localStorage.setItem('xt.cfg', c), cfg);
  await q.goto(`http://localhost:8090/${app}/index.html`); await q.waitForSelector(app === 'series' ? '.grid .card' : '.live'); await q.waitForTimeout(600); await shot(q, shotn);
  if (app === 'series') { await q.keyboard.press('ArrowRight'); await q.keyboard.press('Enter'); await q.waitForSelector('.ep'); await q.waitForTimeout(300); await shot(q, '4b-series-detail'); }
  if (app === 'livetv') { await q.keyboard.press('ArrowRight'); await q.keyboard.press('Enter'); await q.waitForTimeout(1200); await shot(q, '5b-live-zap'); console.log('panel closed', await q.$('.live') === null); }
}
console.log('ERRORS', JSON.stringify(errs, null, 1)); await b.close();
