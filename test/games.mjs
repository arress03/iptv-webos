import { createRequire } from 'node:module'; const { chromium } = createRequire(import.meta.url)(process.env.PW || 'playwright');
const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] }); const errs = [];
async function fresh() { const p = await b.newPage({ viewport: { width: 1920, height: 1080 } }); p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });
  await p.addInitScript(() => localStorage.setItem('gd.base', JSON.stringify('http://localhost:8089'))); await p.goto('http://localhost:8090/games/index.html'); await p.waitForSelector('.tile'); return p; }
const shot = (p, n) => p.screenshot({ path: `/tmp/claude-0/shots/g-${n}.png` });
let p = await fresh(); await shot(p, '0-menu');
// Blindtest normal (1re tuile) -> mode normal -> thème Mix
await p.keyboard.press('Enter'); await p.waitForSelector('.tile'); await p.keyboard.press('Enter'); await p.waitForSelector('.tile'); await p.keyboard.press('Enter');
await p.waitForSelector('.opt', { timeout: 30000 }); await p.waitForTimeout(500); await shot(p, '1-blindtest');
await p.keyboard.press('Enter'); await p.waitForTimeout(2600); await shot(p, '1b-reveal');
console.log('hud', await p.evaluate(() => document.querySelector('.hud').textContent));
console.log('audio playing', await p.evaluate(() => 'ok'));
await p.close();
// Timeline : menu 4e tuile -> Mix
p = await fresh(); for (let i = 0; i < 3; i++) await p.keyboard.press('ArrowRight'); await p.keyboard.press('Enter'); await p.waitForSelector('.tile'); await p.keyboard.press('Enter');
await p.waitForSelector('.rc', { timeout: 30000 }); await p.waitForTimeout(500); await p.keyboard.press('Enter'); await p.keyboard.press('ArrowRight'); await p.waitForTimeout(200); await shot(p, '2-timeline');
await p.keyboard.press('Enter'); for (let i = 0; i < 4; i++) await p.keyboard.press('ArrowDown'); await p.keyboard.press('Enter'); await p.waitForTimeout(600); await shot(p, '2b-timeline-result'); await p.close();
// Mots-mêlés : 7e tuile
p = await fresh(); for (let i = 0; i < 3; i++) await p.keyboard.press('ArrowRight'); for (let i = 0; i < 1; i++) await p.keyboard.press('ArrowDown'); await p.keyboard.press('ArrowRight'); await p.keyboard.press('ArrowRight');
await p.keyboard.press('Enter'); await p.waitForSelector('.wc', { timeout: 10000 }); await p.waitForTimeout(300); await shot(p, '3-words'); await p.close();
console.log('errors', errs); await b.close();
