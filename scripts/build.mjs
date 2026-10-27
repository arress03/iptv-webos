// Construit les 3 .ipk, calcule les empreintes et génère le dépôt Homebrew Channel (repo.json + manifests).
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto'; import { execFileSync } from 'node:child_process';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const repo = process.env.GITHUB_REPOSITORY || 'OWNER/REPO';          // ex. theo/iptv-webos
const branch = process.env.GITHUB_REF_NAME && !process.env.GITHUB_REF_NAME.startsWith('v') ? process.env.GITHUB_REF_NAME : 'main';
const out = path.join(root, 'dist'); fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
const tmp = path.join(root, '.build'); fs.rmSync(tmp, { recursive: true, force: true });
const shared = { livetv: ['core.js', 'ui.css'], films: ['core.js', 'ui.css', 'vod.js'], series: ['core.js', 'ui.css', 'vod.js'] };
const ares = path.join(root, 'node_modules/.bin/ares-package');
const packages = [];
for (const dir of ['livetv', 'films', 'series']) {
  const src = path.join(root, 'apps', dir), dst = path.join(tmp, dir);
  fs.cpSync(src, dst, { recursive: true });
  for (const f of shared[dir]) fs.copyFileSync(path.join(root, 'shared', f), path.join(dst, f));
  if (dir === 'livetv') fs.copyFileSync(path.join(root, 'node_modules/hls.js/dist/hls.min.js'), path.join(dst, 'hls.min.js'));
  const info = JSON.parse(fs.readFileSync(path.join(src, 'appinfo.json'), 'utf8'));
  // Service de saisie par téléphone (un par app : son identifiant commence par celui de l'app)
  const sid = info.id + '.service', sdir = path.join(tmp, dir + '-service');
  fs.mkdirSync(sdir, { recursive: true });
  fs.copyFileSync(path.join(root, 'service', 'service.js'), path.join(sdir, 'service.js'));
  fs.writeFileSync(path.join(sdir, 'package.json'), JSON.stringify({ name: sid, version: info.version, description: 'Saisie des identifiants IPTV', main: 'service.js' }, null, 2));
  const cmds = ['startPair', 'pairStatus', 'stopPair', 'getConfig', 'setConfig', 'clearConfig'].map(n => ({ name: n, public: true }));
  fs.writeFileSync(path.join(sdir, 'services.json'), JSON.stringify({ id: sid, description: 'Saisie des identifiants IPTV', services: [{ name: sid, description: 'Saisie des identifiants IPTV', commands: cmds }] }, null, 2));
  execFileSync(ares, ['--no-minify', '-o', out, dst, sdir], { stdio: 'inherit' });
  const ipkName = `${info.id}_${info.version}_all.ipk`, ipk = path.join(out, ipkName);
  if (!fs.existsSync(ipk)) throw new Error('IPK introuvable : ' + ipkName);
  const buf = fs.readFileSync(ipk), sha = crypto.createHash('sha256').update(buf).digest('hex');
  const tag = process.env.GITHUB_REF_NAME && process.env.GITHUB_REF_NAME.startsWith('v') ? process.env.GITHUB_REF_NAME : 'v' + info.version;
  const rel = `https://github.com/${repo}/releases/download/${tag}`;
  const iconUri = `https://raw.githubusercontent.com/${repo}/${branch}/apps/${dir}/largeIcon.png`;
  const manifest = { id: info.id, version: info.version, type: 'web', title: info.title, appDescription: info.appDescription,
    iconUri, sourceUrl: `https://github.com/${repo}`, rootRequired: false,
    ipkUrl: `${rel}/${ipkName}`, ipkHash: { sha256: sha }, ipkSize: buf.length };
  fs.writeFileSync(path.join(out, `${info.id}.json`), JSON.stringify(manifest, null, 2));
  packages.push({ id: info.id, title: info.title, iconUri, shortDescription: info.appDescription, category: 'multimedia', pool: 'main',
    manifestUrl: `${rel}/${info.id}.json`, manifest });
  console.log(ipkName, sha);
}
fs.writeFileSync(path.join(out, 'repo.json'), JSON.stringify({ paging: { page: 0, count: packages.length, maxPage: 0, itemsTotal: packages.length }, packages }, null, 2));
fs.rmSync(tmp, { recursive: true, force: true });
