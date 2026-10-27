import { createRequire } from 'node:module'; const { chromium } = createRequire(import.meta.url)(process.env.PW || 'playwright');
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1920, height: 1080 } }); const errs = [];
p.on('pageerror', e => errs.push(e.message));
await p.addInitScript(() => {
  let polls = 0; window.__calls = [];
  window.PalmServiceBridge = function () { this.call = (uri, payload) => { const m = uri.split('/').pop(); window.__calls.push(m);
    let r = { returnValue: true };
    if (m === 'getConfig') r.config = null;
    if (m === 'startPair') Object.assign(r, { ips: ['192.168.1.42'], port: 8781, code: '123456' });
    if (m === 'pairStatus') { polls++; r.config = polls >= 2 ? { server: 'http://localhost:8089', username: 'u', password: 'p' } : null; }
    setTimeout(() => this.onservicecallback(JSON.stringify(r)), 20); }; };
});
await p.goto('http://localhost:8090/livetv/index.html'); await p.waitForSelector('.pair:not(.hidden)'); await p.waitForTimeout(300);
await p.screenshot({ path: '/tmp/claude-0/shots/7-pair.png' });
await p.waitForSelector('.live', { timeout: 15000 });
console.log('calls', await p.evaluate(() => window.__calls.join(',')));
console.log('cfg', await p.evaluate(() => localStorage.getItem('xt.cfg')));
console.log('errors', errs); await b.close();
