// Contrôle des licences : cherche, dans les groupes construits par build-data.mjs, les liens qui ne tiennent que par un « pont »
// entre deux franchises sans rapport (crossover, parodie, spécial…). Ne modifie rien : écrit un rapport JSON.
// Usage : node scripts/check-licences.mjs [rapport.json]     (lit data-raw/aod.json et data-manual/cuts.json)
import { readFileSync, writeFileSync } from 'node:fs';

const db = JSON.parse(readFileSync('data-raw/aod.json', 'utf8'));
const TYPES = ['TV', 'MOVIE', 'ONA', 'OVA'];
const idFrom = (s, h) => { const u = s.find((x) => x.includes(h + '/anime/')); const m = u && u.match(/\/anime\/(\d+)/); return m ? Number(m[1]) : 0; };
const normName = (x) => x.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const latin = (s) => /^[\p{Script=Latin}\p{N}\p{P}\p{Zs}]+$/u.test(s);
const kept = db.data.filter((a) => TYPES.includes(a.type) && (idFrom(a.sources, 'anilist.co') || idFrom(a.sources, 'myanimelist.net')));
const manual = JSON.parse(readFileSync('data-manual/cuts.json', 'utf8'));
const key = (a) => { const x = idFrom(a.sources, 'anilist.co'); return x ? 'a' + x : 'm' + idFrom(a.sources, 'myanimelist.net'); };
const rowOfKey = new Map(kept.map((a, i) => [key(a), i]));
const byUrl = new Map(); kept.forEach((a, i) => a.sources.forEach((u) => byUrl.set(u, i)));
const syn = (a) => { const seen = new Set([normName(a.title)]); return a.synonyms.filter(latin).filter((x) => { const k = normName(x); return k && !seen.has(k) && seen.add(k); }).slice(0, 40); };
const STOP = /^(the|a|an|l|le|la|les|un|une|de|des)\s+/;
const names = kept.map((a) => [a.title, ...syn(a).slice(0, 10)].map((x) => normName(x).replace(STOP, '')).filter((x) => x.length >= 4));
const resembles = (i, j) => { for (const a of names[i]) for (const b of names[j]) { const [s, l] = a.length <= b.length ? [a, b] : [b, a]; if (l === s || l.startsWith(s + ' ')) return true; const ta = a.split(' '), tb = b.split(' '); if (ta.length >= 2 && tb.length >= 2 && ta[0] === tb[0] && ta[1] === tb[1]) return true; } return false; };
const edgeId = (i, j) => (i < j ? i + '-' + j : j + '-' + i);
const cuts = new Set((manual.cuts || []).map(([x, y]) => edgeId(rowOfKey.get(x), rowOfKey.get(y))));
const solo = new Set((manual.solo || []).map((k) => rowOfKey.get(k)));

// graphe des liens acceptés (comme dans build-data.mjs)
const adj = kept.map(() => new Set());
kept.forEach((a, i) => { if (solo.has(i)) return; for (const u of a.relatedAnime || []) { const j = byUrl.get(u); if (j === undefined || j === i || solo.has(j) || cuts.has(edgeId(i, j)) || !resembles(i, j)) continue; adj[i].add(j); adj[j].add(i); } });

// groupes = composantes connexes
const comp = new Array(kept.length).fill(-1); const groups = [];
for (let s = 0; s < kept.length; s++) { if (comp[s] >= 0) continue; const st = [s], g = []; comp[s] = groups.length; while (st.length) { const x = st.pop(); g.push(x); for (const y of adj[x]) if (comp[y] < 0) { comp[y] = groups.length; st.push(y); } } groups.push(g); }

// jetons « de franchise » : mots de 4+ lettres, hors mots génériques, pas trop répandus dans toute la base
const GEN = new Set(['season', 'part', 'movie', 'final', 'special', 'episode', 'specials', 'recap', 'film', 'story', 'monogatari', 'series', 'ova', 'the', 'and', 'kara', 'senshi', 'gakuen', 'school', 'academy', 'tensei', 'isekai', 'kimi', 'boku', 'watashi', 'ore', 'tokubetsu', 'hen', 'zenpen', 'kouhen', 'gekijouban', 'shin', 'new']);
// TITRES=1 : seulement les titres principaux (plus strict : repère les ponts que les synonymes masquent)
const ONLY_TITLES = process.env.TITRES === '1';
const toks = kept.map((a) => { const s = new Set(); for (const n of (ONLY_TITLES ? [normName(a.title)] : [normName(a.title), ...syn(a).slice(0, 6).map(normName)])) for (const t of n.split(' ')) if (t.length >= 4 && !GEN.has(t) && !/^\d+$/.test(t) && !/^\d+(st|nd|rd|th)$/.test(t)) s.add(t); return s; });
const df = new Map(); toks.forEach((s) => s.forEach((t) => df.set(t, (df.get(t) || 0) + 1)));
const rare = (t) => df.get(t) <= 400;
const tokenSet = (nodes) => { const s = new Set(); nodes.forEach((i) => toks[i].forEach((t) => { if (rare(t)) s.add(t); })); return s; };
const disjoint = (A, B) => { for (const t of A) if (B.has(t)) return false; return true; };
const reach = (start, banNode, banEdge) => { const seen = new Set([start]); const st = [start]; while (st.length) { const x = st.pop(); for (const y of adj[x]) { if (y === banNode || seen.has(y)) continue; if (banEdge && edgeId(x, y) === banEdge) continue; seen.add(y); st.push(y); } } return seen; };


// ---------- Méthode « séries TV » : on ne regarde que les séries TV du groupe (ce sont elles qui deviennent des cartes).
// Si leurs titres principaux forment plusieurs familles sans mot rare en commun, le groupe mélange des franchises.
const tvTok = kept.map((a) => { const t = new Set(); for (const w of normName(a.title).split(' ')) if (w.length >= 4 && !GEN.has(w) && !/^d+$/.test(w) && !/^d+(st|nd|rd|th)$/.test(w) && df.get(w) <= 400) t.add(w); return t; });
const share = (i, j) => { for (const t of tvTok[i]) if (tvTok[j].has(t)) return true; return false; };
const flagged = [];
for (const g of groups) {
  const tvs = g.filter((i) => kept[i].type === 'TV');
  if (tvs.length < 2) continue;
  const par = new Map(tvs.map((i) => [i, i])); const f = (x) => { while (par.get(x) !== x) { par.set(x, par.get(par.get(x))); x = par.get(x); } return x; };
  for (let p = 0; p < tvs.length; p++) for (let q = p + 1; q < tvs.length; q++) if (share(tvs[p], tvs[q])) par.set(f(tvs[p]), f(tvs[q]));
  const cl = new Map(); tvs.forEach((i) => { const r = f(i); (cl.get(r) || cl.set(r, []).get(r)).push(i); });
  if (cl.size >= 2) flagged.push({ g, clusters: [...cl.values()] });
}
flagged.sort((a, b) => b.g.length - a.g.length);
writeFileSync(process.argv[2] || 'licences-rapport.json', JSON.stringify(flagged.map((f) => ({ size: f.g.length, clusters: f.clusters.map((c) => c.map((i) => [kept[i].title, kept[i].animeSeason?.year || 0, key(kept[i])])) }))));
console.log('groupes de 3+ :', groups.filter((g) => g.length >= 3).length, '; groupes dont les séries TV forment 2 familles ou plus :', flagged.length);

// ---------- --appliquer=0,1,5 : sépare les familles des groupes choisis (numéros du rapport)
// Chaque animé du groupe est rattaché à la famille dont il partage le plus de mots rares ; les liens entre familles sont coupés
// et les animés « hybrides » (autant de mots communs avec deux familles, ex. un crossover) sont sortis du groupe.
const arg = process.argv.find((x) => x.startsWith('--appliquer='));
if (arg) {
  const pick = arg.slice(12).split(',').map(Number);
  const newCuts = [], newSolo = [];
  for (const n of pick) {
    const { g, clusters } = flagged[n];
    const ctoks = clusters.map((c) => { const t = new Set(); c.forEach((i) => tvTok[i].forEach((w) => t.add(w))); return t; });
    const assign = new Map();
    for (const i of g) {
      const k = clusters.findIndex((c) => c.includes(i));
      if (k >= 0) { assign.set(i, k); continue; }
      const sc = ctoks.map((t) => { let m = 0; tvTok[i].forEach((w) => { if (t.has(w)) m++; }); return m; });
      const best = Math.max(...sc), at = sc.indexOf(best);
      assign.set(i, best > 0 && sc.filter((x) => x === best).length === 1 ? at : -1); // -1 : hybride
    }
    for (const i of g) if (assign.get(i) === -1) newSolo.push(key(kept[i]));
    const done = new Set();
    for (const u of g) for (const v of adj[u]) {
      const au = assign.get(u), av = assign.get(v);
      if (au === -1 || av === -1 || au === av) continue;
      const id = edgeId(u, v); if (done.has(id)) continue; done.add(id); newCuts.push([key(kept[u]), key(kept[v])]);
    }
  }
  const m = JSON.parse(readFileSync('data-manual/cuts.json', 'utf8'));
  m.cuts = [...(m.cuts || []), ...newCuts]; m.solo = [...new Set([...(m.solo || []), ...newSolo])];
  writeFileSync('data-manual/cuts.json', JSON.stringify(m, null, 2) + String.fromCharCode(10));
  console.log('ajouté :', newCuts.length, 'liens coupés et', newSolo.length, 'animés sortis des groupes (data-manual/cuts.json). Relance build-data.mjs --no-download.');
}
