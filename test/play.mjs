import { createRequire } from 'node:module'; const { chromium } = createRequire(import.meta.url)(process.env.PW || 'playwright');
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1920, height: 1080 } }); const errs = [];
p.on('pageerror', e => errs.push(e.message));
await p.addInitScript(() => localStorage.setItem('xt.cfg', JSON.stringify({ server: 'http://localhost:8089', username: 'u', password: 'p' })));
await p.goto('http://localhost:8090/films/index.html'); await p.waitForSelector('.grid .card');
await p.keyboard.press('Enter'); await p.waitForSelector('.detail .btn'); await p.waitForTimeout(400);
// trailer
await p.keyboard.press('ArrowRight'); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
console.log('trailer iframe', await p.$('iframe') !== null); await p.keyboard.press('Escape'); await p.waitForTimeout(200);
console.log('trailer closed', await p.$('iframe') === null);
// lecture : on remplace l'URL du film par la vidéo de test
await p.evaluate(() => { IPTV.Xt.stream = () => 'http://localhost:8090/t.webm'; });
await p.keyboard.press('ArrowLeft'); await p.keyboard.press('Enter'); await p.waitForTimeout(2500);
console.log('playing', await p.evaluate(() => !document.querySelector('#video').paused));
await p.keyboard.press('Enter'); await p.keyboard.press('ArrowRight'); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
await p.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 405, bubbles: true }))); await p.waitForTimeout(500);
await p.screenshot({ path: '/tmp/claude-0/shots/6-player.png' });
console.log('errors', errs); await b.close();
