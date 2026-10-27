import { createRequire } from 'node:module'; const { chromium } = createRequire(import.meta.url)(process.env.PW || 'playwright');
const b = await chromium.launch(); const p = await b.newPage();
await p.addInitScript(() => localStorage.setItem('xt.cfg', JSON.stringify({ server: 'http://localhost:8089', username: 'u', password: 'p' })));
await p.goto('http://localhost:8090/films/index.html'); await p.waitForSelector('.grid .card');
const r = await p.evaluate(async () => {
  const v = document.querySelector('#video'); IPTV.Player.init(v);
  const ok = await IPTV.Player.play(['http://localhost:8090/nope.ts', 'http://localhost:8090/t.webm'], 0);
  const playing = !v.paused && !!v.getAttribute('src');
  Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange'));
  return { ok, playing, srcAfterLeave: v.getAttribute('src'), active: IPTV.Player.active };
});
console.log(JSON.stringify(r)); await b.close();
