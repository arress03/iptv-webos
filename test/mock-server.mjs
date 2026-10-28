// Faux serveur Xtream pour tester l'UI en local : node test/mock-server.mjs  (port 8089)
import http from 'node:http';
const cats = n => Array.from({ length: n }, (_, i) => ({ category_id: String(i + 1), category_name: `Catégorie ${i + 1}` }));
const live = Array.from({ length: 120 }, (_, i) => ({ num: i + 1, name: `Chaîne ${i + 1}`, stream_id: 1000 + i, stream_icon: `http://localhost:8089/img/${2000 + i}.svg`, rating: (5 + i % 5).toString(), category_id: String(i % 4 + 1) }));
const vod = Array.from({ length: 300 }, (_, i) => ({ stream_id: 2000 + i, name: `Film numéro ${i + 1}`, stream_icon: `http://localhost:8089/img/${2000 + i}.svg`, rating: (5 + i % 5).toString(), category_id: String(i % 5 + 1), container_extension: 'mp4' }));
const ser = Array.from({ length: 90 }, (_, i) => ({ series_id: 3000 + i, name: `Série ${i + 1}`, cover: `http://localhost:8089/img/${3000 + i}.svg`, rating: (6 + i % 4).toString(), category_id: String(i % 3 + 1) }));
const eps = { 1: [1, 2, 3].map(n => ({ id: 9000 + n, episode_num: n, title: `Épisode ${n}`, container_extension: 'mp4', info: { duration: '42:00', movie_image: `http://localhost:8089/bd/${n}.svg` } })), 2: [1, 2].map(n => ({ id: 9100 + n, episode_num: n, title: `Ep S2 ${n}`, container_extension: 'mp4', info: {} })) };
const hue = n => (n * 47) % 360;
const svg = (n, w, h, t) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue(n)},60%,45%)"/><stop offset="1" stop-color="hsl(${hue(n) + 60},70%,18%)"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><text x="50%" y="50%" fill="white" font-size="${w / 8}" font-family="sans-serif" text-anchor="middle" font-weight="700">${t}</text></svg>`;
let hits = 0;
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'); res.setHeader('Access-Control-Allow-Origin', '*');
  if (u.pathname.startsWith('/img/')) { const n = parseInt(u.pathname.slice(5)); res.setHeader('Content-Type', 'image/svg+xml'); return res.end(svg(n, 400, 600, 'N°' + n)); }
  if (u.pathname.startsWith('/bd/')) { res.setHeader('Content-Type', 'image/svg+xml'); return res.end(svg(parseInt(u.pathname.slice(4)), 1280, 720, '')); }
  if (u.pathname === '/search' || u.pathname === '/lookup') {
    res.setHeader('Content-Type', 'application/json');
    const term = u.searchParams.get('term') || 'Artiste', ent = u.searchParams.get('entity'), hash = [...term].reduce((a, c) => a + c.charCodeAt(0), 0);
    const art = n => `http://localhost:8089/img/${n}.svg`.replace('.svg', '.svg');
    if (u.pathname === '/lookup') { const id = u.searchParams.get('id'); return res.end(JSON.stringify({ results: [{ wrapperType: 'collection', collectionId: +id }, ...Array.from({ length: 10 }, (_, i) => ({ wrapperType: 'track', trackNumber: i + 1, trackName: `Titre ${i + 1} de l'album ${id}`, previewUrl: 'http://localhost:8090/t.webm' }))] })); }
    if (ent === 'album') return res.end(JSON.stringify({ results: Array.from({ length: 14 }, (_, i) => ({ collectionId: hash * 100 + i, collectionName: `Album ${i + 1} ${term}`, artistName: term, trackCount: 12, artworkUrl100: `http://localhost:8089/img/${3000 + ((hash + i) % 90)}.svg`, releaseDate: `${2005 + i}-05-01T07:00:00Z` })) }));
    return res.end(JSON.stringify({ results: Array.from({ length: 30 }, (_, i) => ({ trackId: hash * 1000 + i, trackName: `Morceau ${i + 1} ${term}`, artistName: term, collectionName: `Album ${i % 5}`, previewUrl: 'http://localhost:8090/t.webm', artworkUrl100: `http://localhost:8089/img/${2000 + ((hash + i) % 300)}.svg`, releaseDate: `${2000 + (i % 24)}-03-01T08:00:00Z` })) }));
  }
  if (!u.pathname.startsWith('/player_api.php')) { res.statusCode = 404; return res.end(); }
  hits++; const a = u.searchParams.get('action'); console.log(hits, a || 'auth');
  const j = { null: { user_info: { auth: 1, status: 'Active', max_connections: '2' } }, get_live_categories: cats(4), get_live_streams: live,
    get_vod_categories: cats(5), get_vod_streams: vod, get_series_categories: cats(3), get_series: ser,
    get_vod_info: { info: { plot: 'Un synopsis de test assez long pour voir comment le texte se comporte sur plusieurs lignes dans la fiche du film, avec un peu de contenu supplémentaire.', genre: 'Action, Thriller', releasedate: '2020-01-01', duration: '1h45', rating: '7.5', director: 'Jane Doe', cast: 'A B, C D, E F, G H', youtube_trailer: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', movie_image: 'http://localhost:8089/img/2008.svg', backdrop_path: ['http://localhost:8089/bd/3.svg'] }, movie_data: { container_extension: 'mp4' } },
    get_series_info: { info: { plot: 'Synopsis série.', genre: 'Drame', rating: '8', youtube_trailer: 'abc', backdrop_path: ['http://localhost:8089/bd/5.svg'], cover: 'http://localhost:8089/img/3002.svg' }, episodes: eps },
    get_short_epg: { epg_listings: [0, 1, 2].map(i => ({ title: Buffer.from(['Journal de 20h', 'Météo', 'Film du soir'][i]).toString('base64'), description: Buffer.from(i === 0 ? 'Le journal de la rédaction avec les principales informations de la journée, des reportages et des invités en plateau pour commenter l’actualité.' : '').toString('base64'), start_timestamp: String(Math.floor(Date.now() / 1000) - 1200 + i * 2400), stop_timestamp: String(Math.floor(Date.now() / 1000) + 1200 + i * 2400) })) } }[a === null ? 'null' : a];
  res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(j ?? []));
}).listen(8089);
