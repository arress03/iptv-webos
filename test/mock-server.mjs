// Faux serveur Xtream pour tester l'UI en local : node test/mock-server.mjs  (port 8089)
import http from 'node:http';
const cats = n => Array.from({ length: n }, (_, i) => ({ category_id: String(i + 1), category_name: `Catégorie ${i + 1}` }));
const live = Array.from({ length: 120 }, (_, i) => ({ num: i + 1, name: `Chaîne ${i + 1}`, stream_id: 1000 + i, stream_icon: '', category_id: String(i % 4 + 1) }));
const vod = Array.from({ length: 300 }, (_, i) => ({ stream_id: 2000 + i, name: `Film numéro ${i + 1}`, stream_icon: '', category_id: String(i % 5 + 1), container_extension: 'mp4' }));
const ser = Array.from({ length: 90 }, (_, i) => ({ series_id: 3000 + i, name: `Série ${i + 1}`, cover: '', category_id: String(i % 3 + 1) }));
const eps = { 1: [1, 2, 3].map(n => ({ id: 9000 + n, episode_num: n, title: `Épisode ${n}`, container_extension: 'mp4', info: { duration: '42:00' } })), 2: [1, 2].map(n => ({ id: 9100 + n, episode_num: n, title: `Ep S2 ${n}`, container_extension: 'mp4', info: {} })) };
let hits = 0;
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'); res.setHeader('Access-Control-Allow-Origin', '*');
  if (!u.pathname.startsWith('/player_api.php')) { res.statusCode = 404; return res.end(); }
  hits++; const a = u.searchParams.get('action'); console.log(hits, a || 'auth');
  const j = { null: { user_info: { auth: 1, status: 'Active', max_connections: '2' } }, get_live_categories: cats(4), get_live_streams: live,
    get_vod_categories: cats(5), get_vod_streams: vod, get_series_categories: cats(3), get_series: ser,
    get_vod_info: { info: { plot: 'Un synopsis de test.', genre: 'Action', releasedate: '2020-01-01', duration: '1h45', rating: '7.5' }, movie_data: { container_extension: 'mp4' } },
    get_series_info: { info: { plot: 'Synopsis série.', genre: 'Drame', rating: '8' }, episodes: eps },
    get_short_epg: { epg_listings: [{ title: Buffer.from('Journal').toString('base64'), start_timestamp: Math.floor(Date.now() / 1000) }, { title: Buffer.from('Météo').toString('base64'), start_timestamp: Math.floor(Date.now() / 1000) + 1800 }] } }[a === null ? 'null' : a];
  res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(j ?? []));
}).listen(8089);
