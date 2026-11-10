// Télécharge anime-offline-database (manami-project, ODbL 1.0) et produit data/anime.json (léger, pour la recherche).
// Usage : node scripts/build-data.mjs [--no-download]
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const URL_DB = 'https://github.com/manami-project/anime-offline-database/releases/latest/download/anime-offline-database-minified.json';
const RAW = 'data-raw/aod.json';
const OUT = 'data/anime.json';
const MAL_IMG = 'https://cdn.myanimelist.net/images/anime/';

// Types gardés pour la recherche (SPECIAL et UNKNOWN écartés : bruit).
const TYPES = ['TV', 'MOVIE', 'ONA', 'OVA'];

mkdirSync('data-raw', { recursive: true });
mkdirSync('data', { recursive: true });

if (!process.argv.includes('--no-download') || !existsSync(RAW)) {
  const res = await fetch(URL_DB);
  if (!res.ok) throw new Error('Téléchargement impossible : ' + res.status);
  writeFileSync(RAW, Buffer.from(await res.arrayBuffer()));
}

const db = JSON.parse(readFileSync(RAW, 'utf8'));

const idFrom = (sources, host) => {
  const u = sources.find((s) => s.includes(host + '/anime/'));
  const m = u && u.match(/\/anime\/(\d+)/);
  return m ? Number(m[1]) : 0;
};

// Synonymes en alphabet latin uniquement (les autres alourdissent sans aider la recherche).
const latin = (s) => /^[\p{Script=Latin}\p{N}\p{P}\p{Zs}]+$/u.test(s);

// Forme normalisée (sans accents ni ponctuation) pour écarter les variantes quasi identiques (L'Attaque / L’attaque).
const normName = (x) => x.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

const rows = [];
const kept = []; // entrée brute de chaque ligne, pour retrouver ses relations
for (const a of db.data) {
  if (!TYPES.includes(a.type)) continue;
  const anilist = idFrom(a.sources, 'anilist.co');
  const mal = idFrom(a.sources, 'myanimelist.net');
  if (!anilist && !mal) continue;
  const pic = a.picture.startsWith(MAL_IMG) ? a.picture.slice(MAL_IMG.length) : a.picture;
  const seen = new Set([normName(a.title)]);
  const syn = a.synonyms.filter(latin).filter((x) => { const k = normName(x); return k && !seen.has(k) && seen.add(k); }).slice(0, 40);
  // [titre, type, année, image, idAniList, idMAL, synonymes, score, licence]
  kept.push(a);
  rows.push([
    a.title,
    TYPES.indexOf(a.type),
    a.animeSeason?.year || 0,
    pic,
    anilist,
    mal,
    syn,
    a.score?.arithmeticMean ? Math.round(a.score.arithmeticMean * 100) / 100 : 0,
    0,
  ]);
}

// ---------- Licences : on relie les animés « liés » de la base (séries, films, OVA, ONA uniquement ; les spéciaux
// servent souvent de pont entre deux franchises sans rapport). Corrections à la main dans data-manual/cuts.json.
const keyOf = (r) => (r[4] ? 'a' + r[4] : 'm' + r[5]);
const rowOfKey = new Map(rows.map((r, i) => [keyOf(r), i]));
const rowOfUrl = new Map();
kept.forEach((a, i) => a.sources.forEach((u) => rowOfUrl.set(u, i)));

const manual = existsSync('data-manual/cuts.json') ? JSON.parse(readFileSync('data-manual/cuts.json', 'utf8')) : {};
const edgeId = (i, j) => (i < j ? i + '-' + j : j + '-' + i);
const cuts = new Set((manual.cuts || []).map(([x, y]) => edgeId(rowOfKey.get(x), rowOfKey.get(y))));
const solo = new Set((manual.solo || []).map((k) => rowOfKey.get(k)));

// Deux animés ne sont fusionnés que si leurs titres se ressemblent : un nom commence comme l'autre (« Pokemon » / « Pokemon XY »)
// ou ils partagent leurs deux premiers mots. Ça coupe les ponts entre franchises sans rapport.
const STOP = /^(the|a|an|l|le|la|les|un|une|de|des)\s+/;
const namesOf = (i) => [rows[i][0], ...rows[i][6].slice(0, 10)].map((x) => normName(x).replace(STOP, '')).filter((x) => x.length >= 4);
const nameCache = rows.map((_, i) => namesOf(i));
const resembles = (i, j) => {
  for (const a of nameCache[i]) for (const b of nameCache[j]) {
    const [short, long] = a.length <= b.length ? [a, b] : [b, a];
    if (long === short || long.startsWith(short + ' ')) return true;
    const ta = a.split(' '), tb = b.split(' ');
    if (ta.length >= 2 && tb.length >= 2 && ta[0] === tb[0] && ta[1] === tb[1]) return true;
  }
  return false;
};
const parent = rows.map((_, i) => i);
const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
const union = (i, j) => { parent[find(i)] = find(j); };
kept.forEach((a, i) => {
  if (solo.has(i)) return;
  for (const u of a.relatedAnime || []) {
    const j = rowOfUrl.get(u);
    if (j === undefined || j === i || solo.has(j) || cuts.has(edgeId(i, j)) || !resembles(i, j)) continue;
    union(i, j);
  }
});
for (const [x, y] of manual.join || []) union(rowOfKey.get(x), rowOfKey.get(y));

const members = new Map();
rows.forEach((_, i) => { const r = find(i); (members.get(r) || members.set(r, []).get(r)).push(i); });
const chrono = (i, j) => (rows[i][2] || 9999) - (rows[j][2] || 9999) || rows[i][1] - rows[j][1] || rows[i][0].localeCompare(rows[j][0]);

// Une licence ne contient que des séries TV. Quand un groupe contient au moins une série TV, ses films / OVA / ONA sont
// retirés de la base (ils surchargeaient les licences : Dragon Ball Z, Détective Conan…). Les films indépendants restent.
const hidden = new Set();
for (const list of members.values()) {
  if (list.length > 1 && list.some((i) => rows[i][1] === 0)) list.forEach((i) => { if (rows[i][1] !== 0) hidden.add(i); });
}
const groups = {};
let gid = 0;
const lists = [...members.values()].map((l) => l.filter((i) => !hidden.has(i))).filter((l) => l.length > 1).sort((a, b) => b.length - a.length);
for (const list of lists) {
  list.sort(chrono);
  const rep = list.find((i) => rows[i][1] === 0) ?? list[0]; // jaquette : la série TV la plus ancienne
  gid += 1;
  groups[gid] = [rep, ...list.filter((i) => i !== rep)];
  list.forEach((i) => { rows[i][8] = gid; });
}

// ---------- Lignes finales (sans les éléments retirés) et indices de groupes recalculés
const newIdx = new Map();
const outRows = [];
rows.forEach((r, i) => { if (!hidden.has(i)) { newIdx.set(i, outRows.length); outRows.push(r); } });
const outGroups = Object.fromEntries(Object.entries(groups).map(([id, g]) => [id, g.map((i) => newIdx.get(i))]));

// ---------- Rapport (court) pour repérer les fusions suspectes
const sizes = Object.values(outGroups).map((g) => g.length);
const bucket = (lo, hi) => sizes.filter((n) => n >= lo && n <= hi).length;
console.log(`Licences (séries TV) : ${sizes.length} groupes (2 : ${bucket(2, 2)}, 3-5 : ${bucket(3, 5)}, 6-10 : ${bucket(6, 10)}, 11+ : ${bucket(11, 9999)}) ; ${hidden.size} films/OVA/ONA rattachés à une série retirés ; ${outRows.length} lignes gardées`);
console.log('Plus gros groupes :');
Object.entries(outGroups).slice(0, 12).forEach(([id, g]) => console.log(`  #${id} ${String(g.length).padStart(3)} · ${outRows[g[0]][0]}`));

// ---------- Noms courts (pour l'image de partage) : « Re:Zero kara Hajimeru Isekai Seikatsu » -> « Re:Zero ».
// rows[i][9] = nom court ('' s'il n'y en a pas de sûr). Deux règles prudentes, puis corrections à la main dans data-manual/short-names.json :
//  1. le début du titre (mots entiers, 2 mots ou avec ponctuation) qui existe tel quel comme autre nom de la licence ;
//  2. un nom courant de la licence, simple, cité par au moins 3 variantes de noms (ex. « Frieren », « KonoSuba », « DanMachi »).
const normS = (x) => x.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const startIdx = new Map(); const seenStart = new Set();
outRows.forEach((r, i) => {
  const g = r[8] || 'i' + i;
  for (const n of [r[0], ...r[6].slice(0, 6)]) { const k = normS(n).split(' '); for (let L = 1; L <= Math.min(3, k.length); L++) { const p = k.slice(0, L).join(' '); const key = p + '|' + g; if (seenStart.has(key)) continue; seenStart.add(key); startIdx.set(p, (startIdx.get(p) || 0) + 1); } }
});
const asciiName = (x) => /^[A-Za-z][A-Za-z0-9 ':.!-]*$/.test(x);
function shortNameOf(i) {
  const r = outRows[i], g = r[8] ? outGroups[r[8]] : [i];
  const names = new Map();
  for (const j of g) { if (outRows[j][1] !== 0 && g.length > 1) continue; for (const n of [outRows[j][0], ...outRows[j][6]]) { const k = normS(n); if (k && !names.has(k)) names.set(k, n); } }
  const title = r[0], nt = normS(title), tw = nt.split(' ');
  const supOf = (k) => { let n = 0; for (const k2 of names.keys()) if (k2 !== k && (k2 === k || k2.startsWith(k + ' '))) n++; return n; };
  for (let L = 1; L < tw.length; L++) {
    const k = tw.slice(0, L).join(' ');
    if (k.length < 6 || !names.has(k) || (startIdx.get(k) || 0) > 3) continue;
    let out = ''; for (const ch of title) { out += ch; if (normS(out) === k) break; }
    out = out.trim();
    if (normS(out) !== k || (L < 2 && !/[:.\-]/.test(out))) continue; // un seul mot sans ponctuation : trop risqué (« Shingeki », « Tanaka »)
    return out;
  }
  let best = null;
  for (const [k, orig] of names) {
    if (k.length < 5 || k.length > 22 || !asciiName(orig) || !/^[A-Z]/.test(orig)) continue;
    const sharesWord = k.split(' ').some((w) => w.length >= 4 && tw.includes(w));
    if (!sharesWord && k.length > 9) continue; // pas de traduction anglaise longue (« Demon Slayer ») : on garde le nom d'origine
    if (/\d/.test(k) || /season|part|movie|special|ova|the animation/.test(k)) continue;
    if (orig === orig.toUpperCase() && orig.length <= 6) continue;
    if (supOf(k) < 3 || (startIdx.get(k) || 0) > 3) continue;
    if (!best || k.length < best.k.length) best = { k, orig };
  }
  return best && best.k.length < nt.length - 3 ? best.orig : '';
}
const shortManual = existsSync('data-manual/short-names.json') ? JSON.parse(readFileSync('data-manual/short-names.json', 'utf8')) : {};
let nShort = 0;
outRows.forEach((r, i) => {
  const k = r[4] ? 'a' + r[4] : 'm' + r[5];
  r[9] = k in shortManual ? shortManual[k] : shortNameOf(i);
  if (r[9]) nShort++;
});
console.log(nShort + ' noms courts calculés (corrections manuelles : ' + Object.keys(shortManual).filter((x) => !x.startsWith('_')).length + ')');

const out = JSON.stringify({
  source: 'anime-offline-database (manami-project), licence ODbL 1.0',
  lastUpdate: db.lastUpdate,
  imgBase: MAL_IMG,
  types: TYPES,
  rows: outRows,
  groups: outGroups, // identifiant de licence -> indices des lignes (le premier est la jaquette)
});
writeFileSync(OUT, out);
console.log(`${db.data.length} entrées brutes -> ${outRows.length} gardées`);
console.log(`data/anime.json : ${(out.length / 1e6).toFixed(2)} Mo, gzip ${(gzipSync(out).length / 1e6).toFixed(2)} Mo`);
