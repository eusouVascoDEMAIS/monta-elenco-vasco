// Monta o Elenco: static page + Transfermarkt search proxy (Node 18+, no deps)
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3015;
const HOST = process.env.HOST || '127.0.0.1'; // 0.0.0.0 when hosted
const TM = 'https://www.transfermarkt.com.br/schnellsuche/ergebnis/schnellsuche?query=';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const cache = new Map(); // ponytail: wiped at 500 keys, use an LRU if traffic grows

const ent = s => s.replace(/&amp;/g, '&').replace(/&#0?39;/g, "'").replace(/&quot;/g, '"').trim();

function parseValor(t) {
  const m = t.match(/([\d.,]+)\s*(mil|mi|bi)/);
  if (!m) return 0;
  return Math.round(parseFloat(m[1].replace(',', '.')) * { bi: 1e9, mi: 1e6, mil: 1e3 }[m[2]]);
}

function parse(html) {
  const s = html.indexOf('id="player-grid"');
  if (s < 0) return [];
  const body = html.slice(s, html.indexOf('</tbody>', s));
  return body.split(/<tr class="(?:odd|even)">/).slice(1).map(r => {
    const p = r.match(/\/profil\/spieler\/(\d+)">([^<]+)</);
    if (!p) return null;
    const club = r.match(/<tr><td><a title="([^"]*)" href="[^"]*\/verein\/(\d+)"/);
    const plain = [...r.matchAll(/<td class="zentriert">([^<]*)<\/td>/g)].map(m => m[1].trim());
    const foto = (r.match(/src="([^"]+\/portrait\/[^"]+)"/) || [])[1] || '';
    const valorTxt = ent((r.match(/<td class="rechts hauptlink">([^<]*)</) || [])[1] || '-');
    const clube = club ? ent(club[1]) : '';
    return {
      id: p[1],
      nome: ent(p[2]),
      foto: foto.replace('/portrait/small/', '/portrait/header/'),
      pos: plain[0] || '',
      idade: parseInt(plain[1]) || null,
      clube: /^-+$/.test(clube) ? 'Sem clube' : clube,
      escudo: club && !/^-+$/.test(clube) ? `https://img.a.transfermarkt.technology/wappen/tiny/${club[2]}.png` : '',
      nac: [...r.matchAll(/title="([^"]+)" alt="[^"]*" class="flaggenrahmen"/g)].map(m => ent(m[1])),
      valor: parseValor(valorTxt),
    };
  }).filter(Boolean);
}

const SIGLA = {
  'Goleiro': 'GOL', 'Zagueiro': 'ZAG', 'Lateral Dir.': 'LD', 'Lateral Esq.': 'LE', 'Volante': 'VOL',
  'Meia Central': 'MC', 'Meia Ofensivo': 'MEI', 'Meia Direita': 'MD', 'Meia Esquerda': 'ME',
  'Ponta-Direita': 'PD', 'Ponta-Esquerda': 'PE', 'Seg. Atacante': 'SA', 'Centroavante': 'CA',
};

// Club squad page (kader): same row idea as the search, but lazy images and full position names
function parseElenco(html) {
  const s = html.indexOf('class="items"');
  if (s < 0) return [];
  const body = html.slice(s, html.indexOf('</tbody>', s));
  return body.split(/<tr class="(?:odd|even)">/).slice(1).map(r => {
    const p = r.match(/\/profil\/spieler\/(\d+)">\s*([^<]+?)\s*<\/a>/);
    if (!p) return null;
    const posNome = ent((r.match(/<tr>\s*<td>\s*([^<]+?)\s*<\/td>\s*<\/tr>/) || [])[1] || '');
    const foto = (r.match(/data-src="([^"]+\/portrait\/[^"]+)"/) || [])[1] || '';
    return {
      id: p[1],
      nome: ent(p[2]),
      foto: foto.replace('/portrait/medium/', '/portrait/header/'),
      pos: SIGLA[posNome] || posNome.slice(0, 3).toUpperCase(),
      idade: parseInt((r.match(/<td class="zentriert">(\d+)<\/td>/) || [])[1]) || null,
      clube: 'CR Vasco da Gama',
      escudo: 'https://img.a.transfermarkt.technology/wappen/tiny/978.png',
      nac: [...r.matchAll(/title="([^"]+)" alt="[^"]*" class="flaggenrahmen"/g)].map(m => ent(m[1])),
      valor: parseValor((r.match(/<td class="rechts hauptlink">(?:<a[^>]*>)?([^<]*)</) || [])[1] || ''),
    };
  }).filter(Boolean);
}

async function tm(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR' } });
  if (!r.ok) throw new Error('Transfermarkt respondeu ' + r.status);
  return r.text();
}

function json(res, data, code = 200) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/api/busca') {
    const q = (u.searchParams.get('q') || '').trim();
    if (q.length < 2) return json(res, []);
    const key = q.toLowerCase();
    try {
      if (cache.size > 500) cache.clear();
      if (!cache.has(key)) cache.set(key, parse(await tm(TM + encodeURIComponent(q))));
      return json(res, cache.get(key));
    } catch (e) {
      return json(res, { erro: e.message }, 502);
    }
  }
  if (u.pathname === '/api/elenco-vasco') {
    try {
      if (!cache.has('@vasco')) cache.set('@vasco', parseElenco(await tm('https://www.transfermarkt.com.br/cr-vasco-da-gama/kader/verein/978')));
      return json(res, cache.get('@vasco'));
    } catch (e) {
      return json(res, { erro: e.message }, 502);
    }
  }
  if (u.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return fs.createReadStream(path.join(__dirname, 'index.html')).pipe(res);
  }
  res.writeHead(404);
  res.end();
});

if (require.main === module) server.listen(PORT, HOST, () => console.log(`Monta o Elenco: http://${HOST}:${PORT}`));

module.exports = { parse, parseValor, parseElenco };
