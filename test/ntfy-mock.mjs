// Mini relais compatible ntfy (POST /topic, GET /topic/json en flux) pour les tests locaux
import http from 'node:http';
export function startNtfy(port = 8095) {
  const subs = {}; let seq = 0;
  const srv = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Headers', '*');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    const u = new URL(req.url, 'http://x'), m = u.pathname.match(/^\/([^/]+)(\/json)?$/); if (!m) { res.writeHead(404); return res.end(); }
    const topic = m[1];
    if (req.method === 'POST') {
      let b = ''; req.on('data', d => b += d); req.on('end', () => {
        if (Buffer.byteLength(b) > 4096) { res.writeHead(413); return res.end('too large'); }
        const o = { id: 'm' + (++seq), time: Date.now() / 1000, event: 'message', topic, message: b };
        (subs[topic] || []).forEach(r => r.write(JSON.stringify(o) + '\n')); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o));
      }); return;
    }
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson' }); res.write(JSON.stringify({ id: 'o', event: 'open', topic }) + '\n');
    (subs[topic] = subs[topic] || []).push(res); req.on('close', () => { subs[topic] = subs[topic].filter(r => r !== res); });
  });
  return new Promise(ok => srv.listen(port, () => ok(srv)));
}
