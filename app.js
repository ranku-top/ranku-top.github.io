'use strict';

// ---------- Utilitaires ----------
const $ = (s, r = document) => r.querySelector(s);
const uid = () => Math.random().toString(36).slice(2, 9);
const h = (tag, props = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null) el.append(kid);
  return el;
};
// Texte noir ou blanc selon la luminosité de la couleur du tier.
const textOn = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  const lum = 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return lum > 150 ? '#14141f' : '#ffffff';
};
const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2500);
}

// ---------- État + sauvegarde locale ----------
const STORE = 'tierlist-anime-v1';
const DEFAULT_TIERS = [
  ['S', '#ff7f7f', 'Chef-d’œuvre'], ['A', '#ffbf7f', 'Excellent'], ['B', '#ffdf7f', 'Bien'], ['C', '#bfff7f', 'Moyen'], ['D', '#7fbfff', 'Bof'],
];
const OLD_COLORS = { '#ff5d73': '#ff7aa2', '#ff9f43': '#ffb83d', '#ffd24d': '#ffe066', '#7bd88f': '#4ade9f', '#5fb0ff': '#6ea0ff' };

// Teinte plus sombre d'une couleur (pour le dégradé de la lettre).
const shade = (hex, k) => {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(v * (1 + k)))).toString(16).padStart(2, '0');
  return '#' + f(n >> 16) + f((n >> 8) & 255) + f(n & 255);
};

const newList = (name, type = 'anime') => ({
  id: uid(),
  name,
  type,
  tiers: DEFAULT_TIERS.map(([n, c, d]) => ({ id: uid(), name: n, color: c, desc: d, items: [] })),
  pool: [],
  items: {}, // clé -> { t: titre, i: image }
});

let db;
try { db = JSON.parse(localStorage.getItem(STORE)); } catch { db = null; }
if (!db || !Array.isArray(db.lists)) {
  const l = newList('Ma tier list');
  db = { v: 1, cur: l.id, lists: [l], pastel: 1 };
}
// Une seule fois : les couleurs de tiers déjà enregistrées passent au code couleur pastel (même teinte, plus douce).
if (!db.pastel) { for (const l of db.lists) for (const t of l.tiers) if (/^#[0-9a-f]{6}$/i.test(t.color)) t.color = calmColor(t.color, { s: 1, l: 0.74 }); db.pastel = 1; try { localStorage.setItem(STORE, JSON.stringify(db)); } catch { /* ignore */ } }
// Mise à jour des anciennes listes : nouvelles couleurs par défaut et légendes (S, A, B, C, D).
for (const l of db.lists) {
  for (const t of l.tiers) {
    if (OLD_COLORS[t.color]) t.color = OLD_COLORS[t.color];
    if (t.desc === undefined) t.desc = (DEFAULT_TIERS.find((d) => d[0] === t.name) || [])[2] || '';
  }
}
db.tops ??= []; db.curTop ??= null; // les tops (classements 5 / 10 / 15)
const save = () => { try { localStorage.setItem(STORE, JSON.stringify(db)); } catch { toast('Sauvegarde impossible (stockage plein ?)'); } };
const cur = () => (UI.view === 'top' ? curTop() : db.lists.find((l) => l.id === db.cur) || db.lists[0]); // collection en cours : liste de tiers ou top

// ---------- Affichage ----------
let sortables = [];
let lastDrag = 0; // pour ne pas ouvrir la fiche juste après un glisser-déposer
let freshKey = null, freshTier = null; // pour animer ce qui vient d'être ajouté
let imgBase = 'https://cdn.myanimelist.net/images/anime/';

const imgUrl = (i) => (i.startsWith('http') || i.startsWith('data:') ? i : imgBase + i);

// Affiche qui ne charge pas (lien mort, site qui bloque) : on retrouve la couverture sur AniList grâce à l'id de la base ; sinon une case grise.
let picIds = null;
const covers = (() => { try { return JSON.parse(localStorage.getItem('ranku-covers') || '{}'); } catch { return {}; } })();
async function aniCover(id) {
  if (covers[id]) return covers[id];
  try {
    const res = await fetch('https://graphql.anilist.co', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query: 'query($i:Int){Media(id:$i){coverImage{large}}}', variables: { i: id } }) });
    const u = (await res.json())?.data?.Media?.coverImage?.large;
    if (u) { covers[id] = u; try { localStorage.setItem('ranku-covers', JSON.stringify(covers)); } catch { /* plein */ } }
    return u || null;
  } catch { return null; }
}
document.addEventListener('error', async (e) => {
  const im = e.target;
  if (!(im instanceof HTMLImageElement) || im.dataset.fb || im.src.startsWith('data:')) return;
  im.dataset.fb = '1';
  let url = null;
  if (animeData) {
    if (!picIds) { picIds = new Map(); for (const r of animeData.rows) if (r[4]) picIds.set(imgUrl(r[3]), r[4]); }
    const id = picIds.get(im.src);
    if (id) url = await aniCover(id);
  }
  if (url) im.src = url; else im.classList.add('noimg');
}, true);

function card(list, key) {
  const it = list.items[key];
  return h('div', { class: 'card' + (key === freshKey ? ' pop' : '') + (UI.sel.has(key) ? ' sel' : ''), dataset: { k: key }, title: it.t },
    h('img', { src: imgUrl(it.i), alt: it.t, loading: 'lazy', draggable: 'false' }),
    it.m && it.m.length > 1 ? h('span', { class: 'cnt' }, '×' + it.m.length) : null,
    h('span', { class: 'tt' }, it.t));
}

// écran affiché quand il n'y a plus ni tier list ni top : petit tutoriel
function renderWelcome() {
  showView();
  renderTabs();
  $('#welcomeView').replaceChildren(
    h('div', { class: 'wl-box' },
      h('div', { class: 'wl-big' }, '🗂️'),
      h('h2', {}, 'Rien ici pour l’instant'),
      h('p', { class: 'wl-p' }, 'Pour commencer, crée une tier list ou un top avec les boutons « + » de la barre à gauche :'),
      h('div', { class: 'wl-steps' },
        h('div', {}, h('span', { class: 'wl-plus' }, svgEl(PLUS_ICON)), h('b', {}, 'Tier lists'), ' : classe tes animés ou tes personnages par niveaux (S, A, B…).'),
        h('div', {}, h('span', { class: 'wl-plus' }, svgEl(PLUS_ICON)), h('b', {}, 'Tops'), ' : fais un top 5, 10 ou 15, numéroté de 1 à N.')),
      h('p', { class: 'wl-mob' }, 'Sur téléphone, ouvre d’abord le menu ☰ en haut à droite.'),
      h('div', { class: 'wl-btns' },
        h('button', { class: 'tb-btn p', id: 'wlTier', type: 'button' }, svgEl(PLUS_ICON), 'Créer une tier list'),
        h('button', { class: 'tb-btn p', id: 'wlTop', type: 'button' }, svgEl(PLUS_ICON), 'Créer un top'))));
}

const RESET_ICON = '<svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 0 2.5-5.8M4 4v4h4"/></svg>';
let resetArmed = false, resetTimer;
let delAllArmed = false, delAllTimer;
// supprime TOUTES les cartes de la tier list (tiers et Non classé) ; deux appuis pour éviter l'accident
function deleteAllCards() {
  const list = cur();
  if (!delAllArmed) {
    delAllArmed = true; render();
    clearTimeout(delAllTimer); delAllTimer = setTimeout(() => { delAllArmed = false; if (UI.view === 'tiers') render(); }, 4000);
    return;
  }
  clearTimeout(delAllTimer); delAllArmed = false;
  const n = Object.keys(list.items).length;
  list.items = {}; list.pool = []; list.tiers.forEach((t) => (t.items = []));
  save(); render();
  toast(`${n} carte${n > 1 ? 's' : ''} supprimée${n > 1 ? 's' : ''}`);
}
// remet toutes les cartes des tiers dans « Non classé » (en gardant l'ordre S, A, B…) ; deux appuis pour éviter l'accident
function resetTiers() {
  const list = cur();
  if (!resetArmed) {
    resetArmed = true; render();
    clearTimeout(resetTimer); resetTimer = setTimeout(() => { resetArmed = false; if (UI.view === 'tiers') render(); }, 4000);
    return;
  }
  clearTimeout(resetTimer); resetArmed = false;
  const back = list.tiers.flatMap((t) => t.items.filter((k) => list.items[k]));
  list.tiers.forEach((t) => (t.items = []));
  list.pool = [...back, ...list.pool.filter((k) => !back.includes(k))];
  save(); render();
  toast(`${back.length} carte${back.length > 1 ? 's' : ''} remise${back.length > 1 ? 's' : ''} dans Non classé`);
}

function render() {
  UI.view = fixView(UI.view);
  if (UI.view === 'welcome') { renderWelcome(); return; }
  if (UI.view === 'top') { renderTop(); return; }
  showView();
  const list = cur();
  if (UI.listId !== list.id) { UI.listId = list.id; UI.filter = ''; UI.sel.clear(); UI.selMode = false; } // filtre et sélection propres à chaque liste
  for (const k of [...UI.sel]) if (!list.items[k]) UI.sel.delete(k);
  renderTabs();

  sortables.forEach((s) => s.destroy());
  sortables = [];
  const board = $('#board');
  board.replaceChildren();

  // trait coloré continu sur le bord gauche : un seul dégradé de bas en haut des tiers
  const bar = `linear-gradient(180deg, ${list.tiers.map((t, i) => `${t.color} ${Math.round(((i + 0.5) / list.tiers.length) * 100)}%`).join(', ')})`;
  board.append(...pageHead(list, [
    h('button', { class: 'tb-btn p tb-add', type: 'button' }, svgEl(PLUS_ICON), 'Ajouter'),
    list.type === 'char'
      ? h('button', { class: 'tb-btn tb-chars', type: 'button' }, svgEl(IMPORT_ICON), 'Personnages de mes animés')
      : h('button', { class: 'tb-btn tb-import', type: 'button' }, svgEl(IMPORT_ICON), 'Importer'),
    h('button', { class: 'tb-btn', id: 'quickBtn', type: 'button', ...(poolTotal(list) ? {} : { disabled: '' }) }, 'Tri rapide'),
    h('button', { class: 'tb-btn' + (resetArmed ? ' danger-on' : ''), id: 'resetBtn', type: 'button', ...(list.tiers.some((t) => t.items.some((k) => list.items[k])) ? {} : { disabled: '' }) }, svgEl(RESET_ICON), resetArmed ? 'Sûr ? Appuie pour tout remettre' : 'Réinitialiser'),
    h('span', { class: 'sp' }),
    h('label', { class: 'size-ctl', title: 'Taille des affiches' }, svgEl(SIZE_SMALL), h('input', { type: 'range', id: 'sizeRange', min: '56', max: '140', step: '2', value: String(Math.round(currentCardW())) }), svgEl(SIZE_BIG)),
    h('button', { class: 'tb-btn tb-share', type: 'button' }, svgEl(SHARE_ICON), 'Partager'),
  ]));
  board.append(h('div', { class: 'tiers', style: `--bar:${bar}` }, list.tiers.map((t, i) =>
    h('div', { class: 'tier' + (t.id === freshTier ? ' pop' : ''), dataset: { id: t.id }, style: `--i:${i};--c1:${t.color};--c2:${shade(t.color, -0.2)};--ink:${textOn(t.color)}` },
      h('div', { class: 'mv' },
        h('button', { dataset: { mv: '-1', tier: t.id }, 'aria-label': 'Monter ce tier', type: 'button', ...(i === 0 ? { disabled: '' } : {}) }, '▲'),
        h('button', { dataset: { mv: '1', tier: t.id }, 'aria-label': 'Descendre ce tier', type: 'button', ...(i === list.tiers.length - 1 ? { disabled: '' } : {}) }, '▼')),
      h('button', { class: 'tier-label' + (t.name.length > 3 ? ' long' : ''), dataset: { tier: t.id }, type: 'button' },
        h('b', {}, t.name), t.desc ? h('small', {}, t.desc) : null),
      h('div', { class: 'zone', dataset: { zone: t.id } }, t.items.filter((k) => list.items[k]).map((k) => card(list, k))))),
    h('button', { class: 'add-tier', type: 'button' }, '＋ Ajouter un tier')));
  board.append(
    h('div', { class: 'cork' },
      h('div', { class: 'note' }, 'Non classé', h('b', { class: 'cnt-n' }, String(poolTotal(list)))),
      h('div', { class: 'cork-tools' },
        h('input', { class: 'pf', id: 'poolFilter', type: 'search', placeholder: 'Filtrer…', value: UI.filter, autocomplete: 'off' }),
        h('select', { class: 'ps', id: 'poolSort', 'aria-label': 'Trier Non classé' },
          h('option', { value: '' }, 'Trier…'),
          ...(list.type === 'char'
            ? [['title', 'Nom A → Z'], ['titleDesc', 'Nom Z → A'], ['anime', 'Par animé']]
            : [['title', 'Titre A → Z'], ['titleDesc', 'Titre Z → A'], ['yearAsc', 'Année : anciens d’abord'], ['yearDesc', 'Année : récents d’abord']]).map(([v, l]) => h('option', { value: v }, l))),
        h('button', { class: 'ct-btn ct-del' + (delAllArmed ? ' armed' : ''), id: 'delAllBtn', type: 'button', ...(Object.keys(list.items).length ? {} : { disabled: '' }) },
          delAllArmed ? `Sûr ? Supprimer ${Object.keys(list.items).length} carte${Object.keys(list.items).length > 1 ? 's' : ''}` : 'Tout supprimer'),
        ),
      h('div', { class: 'zone', dataset: { zone: 'pool' } }, list.pool.filter((k) => list.items[k]).map((k) => card(list, k)))));

  freshKey = null; freshTier = null;
  board.querySelectorAll('.zone').forEach((z) => {
    sortables.push(new Sortable(z, {
      group: 'items',
      animation: 160,
      forceFallback: true,       // glisser géré par Sortable lui-même (même comportement partout, souris et doigt)
      fallbackOnBody: true,      // la copie qui suit le curseur passe au-dessus de tout (barre du haut comprise)
      fallbackTolerance: 3,
      delay: 160,                // au doigt : appui bref avant de saisir, pour pouvoir faire défiler la page
      delayOnTouchOnly: true,
      touchStartThreshold: 6,
      emptyInsertThreshold: 30,  // facilite le dépôt dans un tier vide
      swapThreshold: 0.6,
      ghostClass: 'sortable-ghost',
      chosenClass: 'sortable-chosen',
      disabled: UI.selMode,      // pendant la sélection multiple, un toucher sélectionne au lieu de saisir
      onEnd: () => { lastDrag = Date.now(); syncFromDom(); },
    }));
  });
  updateBar();
  applyPoolFilter();
  renderSelBar();
}

// Relit l'ordre depuis le DOM après un glisser-déposer (le DOM est déjà à jour : pas de reconstruction).
function syncFromDom() {
  const list = cur();
  for (const z of document.querySelectorAll('#board .zone')) {
    const keys = [...z.children].map((c) => c.dataset.k).filter(Boolean);
    if (z.dataset.zone === 'pool') list.pool = keys;
    else list.tiers.find((t) => t.id === z.dataset.zone).items = keys;
  }
  save();
  updateBar();
  updatePoolCount();
}

function detach(list, key) {
  list.pool = list.pool.filter((k) => k !== key);
  list.tiers.forEach((t) => (t.items = t.items.filter((k) => k !== key)));
  if (list.slots) { list.slots = list.slots.map((k) => (k === key ? null : k)); compactSlots(list); }
}

$('#board').addEventListener('click', (e) => {
  if (e.target.closest('.tb-share')) { openShare(); return; }
  if (e.target.closest('.tb-add')) { openSearch(); return; }
  if (e.target.closest('.tb-chars')) { openChars(); return; }
  if (e.target.closest('.tb-import')) { openImport(); return; }
  if (e.target.closest('#resetBtn')) { resetTiers(); return; }
  if (e.target.closest('#delAllBtn')) { deleteAllCards(); return; }
  if (e.target.closest('#quickBtn')) { openQuick(); return; }
  const card = e.target.closest('.card');
  if (card && UI.selMode) { toggleSel(card); return; }
  if (card && Date.now() - lastDrag > 300) { openFiche(card.dataset.k); return; }
  const mv = e.target.closest('[data-mv]');
  if (mv) { swapTier(mv.dataset.tier, Number(mv.dataset.mv)); return; }
  if (e.target.closest('.add-tier')) { openTier(null); return; }
  const lab = e.target.closest('.tier-label');
  if (lab) openTier(lab.dataset.tier);
});

// ---------- Tiers : fenêtre unique pour créer ou modifier (nom, légende, couleur parmi une palette) ----------
const SWATCHES = ['#ff7f7f', '#ff9f7f', '#ffbf7f', '#ffdf7f', '#ffff7f', '#dfff7f', '#bfff7f', '#7fff7f', '#7fffbf', '#7fffff', '#7fdfff', '#7fbfff', '#7f9fff', '#7f7fff', '#9f7fff', '#bf7fff', '#df7fff', '#ff7fff', '#ff7fbf', '#bfbfbf', '#f0f0f0'];
let editTier = null; // id du tier modifié, null = création
let draft = { name: '', desc: '', color: SWATCHES[0] };

function paintTierPreview() {
  $('#tierPrev').style.cssText = `--c1:${draft.color};--c2:${shade(draft.color, -0.2)};--ink:${textOn(draft.color)}`;
}

function renderTierDialog() {
  const prev = $('#tierPrev');
  paintTierPreview();
  $('b', prev).textContent = draft.name || '?';
  $('small', prev).textContent = draft.desc;

  // dernière pastille : n'importe quelle couleur (sélecteur libre). Elle prend la couleur choisie.
  const custom = !SWATCHES.includes(draft.color);
  const input = h('input', { type: 'color', value: draft.color, 'aria-label': 'Choisir une autre couleur' });
  const customSw = h('label', { class: 'sw custom' + (custom ? ' on' : ''), title: 'Autre couleur…', style: custom ? `background:${draft.color}` : '' }, input);
  input.addEventListener('input', () => { // pendant le choix : on met à jour sans reconstruire (sinon le sélecteur se refermerait)
    draft.color = input.value;
    paintTierPreview();
    $('#swatches').querySelectorAll('.sw').forEach((b) => b.classList.remove('on'));
    customSw.classList.add('on');
    customSw.style.background = draft.color;
  });
  input.addEventListener('change', renderTierDialog);

  $('#swatches').replaceChildren(...SWATCHES.map((c) => h('button', {
    class: 'sw' + (c === draft.color ? ' on' : ''), style: `background:${c}`, type: 'button', 'aria-label': c,
    onclick: () => { draft.color = c; renderTierDialog(); },
  })), customSw);
}

function openTier(id) {
  const dlg = $('#dlgTier');
  editTier = id;
  if (id) {
    const t = cur().tiers.find((x) => x.id === id);
    draft = { name: t.name, desc: t.desc || '', color: t.color };
  } else {
    const used = new Set(cur().tiers.map((t) => t.color));
    draft = { name: '', desc: '', color: SWATCHES.find((c) => !used.has(c)) || SWATCHES[0] };
  }
  $('#tierTitle').textContent = id ? 'Modifier le tier' : 'Nouveau tier';
  $('#tierOk').textContent = id ? 'OK' : 'Ajouter';
  dlg.classList.toggle('is-new', !id);
  $('#tierName').value = draft.name;
  $('#tierDesc').value = draft.desc;
  renderTierDialog();
  dlg.returnValue = '';
  dlg.showModal();
  if (!id) $('#tierName').focus();
}

$('#tierName').addEventListener('input', (e) => { draft.name = e.target.value; renderTierDialog(); });
$('#tierDesc').addEventListener('input', (e) => { draft.desc = e.target.value; renderTierDialog(); });
// un nouveau tier doit avoir un nom
$('#tierOk').addEventListener('click', (e) => {
  if (!editTier && !draft.name.trim()) { e.preventDefault(); $('#tierName').focus(); }
});

function applyDraft() {
  const t = cur().tiers.find((x) => x.id === editTier);
  if (!t) return;
  t.name = draft.name.trim() || t.name;
  t.desc = draft.desc.trim();
  t.color = draft.color;
}
// Validation (bouton OK ou touche Entrée) : crée ou met à jour le tier tout de suite.
$('#formTier').addEventListener('submit', (e) => {
  if (e.submitter?.value !== 'ok') return;
  if (editTier) applyDraft();
  else { freshTier = uid(); cur().tiers.push({ id: freshTier, name: draft.name.trim(), color: draft.color, desc: draft.desc.trim(), items: [] }); }
  save(); render();
});
// Fermeture autrement (Échap, clic à côté) : en modification, les changements déjà faits sont gardés.
$('#dlgTier').addEventListener('close', () => { if (editTier) { applyDraft(); save(); render(); } });
function moveTier(d) {
  applyDraft();
  swapTier(editTier, d);
}
function swapTier(id, d) {
  const before = new Map([...document.querySelectorAll('#board .tier')].map((e) => [e.dataset.id, e.getBoundingClientRect().top]));
  const ts = cur().tiers;
  const i = ts.findIndex((x) => x.id === id);
  const j = i + d;
  if (j < 0 || j >= ts.length) return;
  [ts[i], ts[j]] = [ts[j], ts[i]];
  save(); render();
  // les deux tiers glissent vers leur nouvelle place
  document.querySelectorAll('#board .tier').forEach((e) => {
    const dy = (before.get(e.dataset.id) ?? 0) - e.getBoundingClientRect().top;
    if (dy) e.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 280, easing: 'cubic-bezier(.2,.8,.2,1)' });
  });
}
$('#tierUp').onclick = () => moveTier(-1);
$('#tierDown').onclick = () => moveTier(1);
$('#tierDel').onclick = () => {
  const list = cur();
  const t = list.tiers.find((x) => x.id === editTier);
  if (t.items.length && !confirm(`Supprimer le tier « ${t.name} » ? Ses animés iront dans « Non classé ».`)) return;
  list.pool.push(...t.items);
  list.tiers = list.tiers.filter((x) => x.id !== editTier);
  editTier = null;
  $('#dlgTier').close();
};

// ---------- Barre du haut fixe (Accueil / Tier lists / Tops) + en-tête de page (fil d'Ariane, titre, outils) ----------
const PENCIL = '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16v4z"/></svg>';
const PLUS_ICON = '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>';
const MENU_ICON = '<svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16"/></svg>';
function renderTabs() {
  renderSide();
  $('#listTabs').replaceChildren(h('button', { class: 'menu-btn', id: 'menuBtn', type: 'button', 'aria-label': 'Menu' }, svgEl(MENU_ICON)));
}
$('#listTabs').addEventListener('click', (e) => { if (e.target.closest('#menuBtn')) document.body.classList.toggle('side-open'); });
document.addEventListener('click', (e) => { if (document.body.classList.contains('side-open') && !e.target.closest('#side') && !e.target.closest('#menuBtn')) document.body.classList.remove('side-open'); });

// ----- Barre latérale façon explorateur : deux volets repliables (Tier lists, Tops), un « + » pour créer, un crayon au survol
document.body.dataset.layout = 'a';
function renderSide() {
  db.side ??= { tiers: true, tops: true };
  document.body.classList.toggle('side-min', !!db.sideMin);
  const ic = (p) => svgEl('<svg viewBox="0 0 24 24"><path d="' + p + '"/></svg>');
  const section = (kind, name, path, coll, curId, viewName) => {
    const open = db.side[kind] !== false;
    return [
      h('div', { class: 'sd-head' },
        h('button', { class: 'sd-nav' + (UI.view === viewName ? ' on' : ''), dataset: { toggle: kind }, type: 'button', 'aria-expanded': String(open) },
          h('i', { class: 'car' + (open ? ' open' : '') }, '▸'), ic(path), h('span', { class: 'sd-t' }, name)),
        h('button', { class: 'sd-plus', dataset: { add: kind }, type: 'button', 'aria-label': kind === 'tiers' ? 'Nouvelle tier list' : 'Nouveau top', title: kind === 'tiers' ? 'Nouvelle tier list' : 'Nouveau top' }, svgEl(PLUS_ICON))),
      ...(open ? [h('div', { class: 'sd-list' },
        ...(coll.length ? coll.map((l) => h('div', { class: 'sd-item' + (UI.view === viewName && l.id === curId ? ' on' : '') },
          h('button', { class: 'sd-sub', dataset: { open: l.id, kind }, type: 'button', title: l.name }, l.type === 'char' ? svgEl(USER_ICON) : null, h('span', {}, l.name)),
          h('button', { class: 'sd-ed', dataset: { edit: l.id, kind }, type: 'button', 'aria-label': 'Renommer ou supprimer', title: 'Renommer ou supprimer' }, svgEl(PENCIL))))
          : [h('div', { class: 'sd-none' }, 'Aucun pour l’instant')]))] : []),
    ];
  };
  $('#side').replaceChildren(
    h('div', { class: 'sd-top' },
      h('div', { class: 'brand sd-brand' }, h('img', { class: 'mark', src: 'icons/icon-192.png', alt: '', width: 34, height: 34 }), h('span', {}, 'Ran'), h('b', {}, 'ku')),
      h('button', { class: 'sd-collapse', id: 'sdCollapse', type: 'button', 'aria-label': db.sideMin ? 'Agrandir la barre' : 'Réduire la barre', title: db.sideMin ? 'Agrandir la barre' : 'Réduire la barre' }, svgEl('<svg viewBox="0 0 24 24"><path d="' + (db.sideMin ? 'M9 5l7 7-7 7' : 'M15 5l-7 7 7 7') + '"/></svg>'))),
    ...section('tiers', 'Tier lists', 'M4 6h8M4 12h12M4 18h16', db.lists, db.cur, 'tiers'),
    ...section('tops', 'Tops', 'M8 4h8v5a4 4 0 0 1-8 0V4zM12 13v4M8 21h8M10 17h4', db.tops, db.curTop, 'top'),
    h('span', { class: 'sd-fill' }));
}
$('#side').addEventListener('click', (e) => {
  if (e.target.closest('#sdCollapse')) { db.sideMin = !db.sideMin; save(); renderSide(); return; }
  const t = e.target.closest('[data-toggle]');
  if (t && db.sideMin && window.innerWidth >= 900) { db.sideMin = false; db.side[t.dataset.toggle] = true; save(); renderSide(); return; } // barre réduite : un clic sur l'icône la rouvre
  if (t) { db.side[t.dataset.toggle] = db.side[t.dataset.toggle] === false; save(); renderSide(); return; }
  const a = e.target.closest('[data-add]');
  if (a) { document.body.classList.remove('side-open'); a.dataset.add === 'tops' ? openTop(null) : openList(null); return; }
  const o = e.target.closest('[data-open]');
  if (o) {
    document.body.classList.remove('side-open');
    if (o.dataset.kind === 'tops') { db.curTop = o.dataset.open; save(); go('top'); } else { db.cur = o.dataset.open; save(); go('tiers'); }
    return;
  }
  const ed = e.target.closest('[data-edit]');
  if (ed) { document.body.classList.remove('side-open'); ed.dataset.kind === 'tops' ? openTop(ed.dataset.edit) : openList(ed.dataset.edit); }
});

// en-tête commun : titre, bouton Modifier, rangée d'outils étiquetés
function pageHead(l, toolEls) {
  return [
    h('div', { class: 'pg-title' },
      h('h2', { class: 'pg-h' }, l.type === 'char' ? svgEl(USER_ICON) : null, l.name),
      h('button', { class: 'tb-btn', id: 'pgEdit', type: 'button' }, svgEl(PENCIL), 'Modifier')),
    h('div', { class: 'tb-row' }, ...toolEls),
  ];
}
document.addEventListener('click', (e) => { if (e.target.closest('#pgEdit')) UI.view === 'top' ? openTop(db.curTop) : openList(db.cur); });

let editList = null; // id de la liste modifiée, null = création
let delArmed = false;
function openList(id) {
  const dlg = $('#dlgList');
  editList = id;
  delArmed = false;
  $('#listDel').textContent = 'Supprimer';
  $('#listTitle').textContent = id ? 'Modifier la liste' : 'Nouvelle tier list';
  $('#listOk').textContent = id ? 'OK' : 'Créer';
  $('#listName').value = id ? db.lists.find((l) => l.id === id).name : '';
  dlg.classList.toggle('is-new', !id);
  listType = 'anime'; renderListType();
  dlg.returnValue = '';
  dlg.showModal();
  $('#listName').focus();
}
$('#listOk').addEventListener('click', (e) => { if (!$('#listName').value.trim()) { e.preventDefault(); $('#listName').focus(); } });
$('#dlgList form').addEventListener('submit', (e) => {
  if (e.submitter?.value !== 'ok') return;
  const name = $('#listName').value.trim();
  if (!name) return;
  let created = false;
  if (editList) db.lists.find((l) => l.id === editList).name = name;
  else { const l = newList(name, listType); db.lists.push(l); db.cur = l.id; created = true; }
  save(); if (created) go('tiers'); else render();
});
$('#listDel').onclick = () => {
  if (!delArmed) { delArmed = true; $('#listDel').textContent = 'Sûr ? Appuie pour supprimer'; return; }
  db.lists = db.lists.filter((l) => l.id !== editList);
  if (db.cur === editList) db.cur = db.lists[0]?.id || null;
  editList = null;
  $('#dlgList').close('deleted');
  save(); render();
};
$('#btnAbout').onclick = () => {
  $('#aboutDate').textContent = animeData ? `Base mise à jour le ${animeData.lastUpdate}.` : '';
  $('#dlgAbout').showModal();
  loadData();
};

// ---------- Recherche : base locale + AniList en complément ----------
let animeData = null;
let index = null;
let loading = null;
let rowByAnilist = new Map(), rowByMal = new Map(); // idAniList / idMAL -> indice de ligne
let rowByKey = new Map(); // clé (a<idAniList> / m<idMAL>) -> indice de ligne dans la base

function loadData() {
  if (animeData) return Promise.resolve();
  loading ||= fetch('data/anime.json').then((r) => r.json()).then((d) => {
    animeData = d;
    imgBase = d.imgBase;
    rowByKey = new Map(d.rows.map((r, i) => [rowKey(r), i]));
    d.rows.forEach((r, i) => { if (r[4]) rowByAnilist.set(r[4], i); if (r[5]) rowByMal.set(r[5], i); });
    // n : titre puis synonymes, normalisés ; h : tout concaténé pour le filtre rapide
    index = d.rows.map((r) => {
      const n = [r[0], ...r[6]].map((x) => ' ' + norm(x).replace(/^(l|le|la|les|the|un|une) /, '') + ' ');
      return { r, n, h: ' ' + norm(r[0] + ' ' + r[6].join(' ')) + ' ' };
    });
  });
  return loading;
}

const rowKey = (r) => (r[4] ? 'a' + r[4] : 'm' + r[5]);
const rowOfKey = (k) => { const i = rowByKey.get(k); return i === undefined ? null : animeData.rows[i]; };
const gidOf = (k) => rowOfKey(k)?.[8] || 0;                                   // licence d'un animé (0 = seul)
const groupRows = (gid) => (animeData.groups[gid] || []).map((i) => animeData.rows[i]); // le premier = jaquette
const fmtOf = (r) => animeData.types[r[1]];
// clé de la carte de cette licence dans la liste (la clé peut changer si la jaquette de la base change : on cherche par contenu)
const groupItemKey = (list, gid) => (gid && animeData ? Object.keys(list.items).find((k) => list.items[k].m && gidOf(list.items[k].m[0]) === gid) || null : null);

function searchLocal(q) {
  const nq = norm(q).replace(/^(l|le|la|les|the|un|une) /, '');
  if (!nq) return [];
  const toks = nq.split(' ');
  const out = [];
  for (const e of index) {
    if (!toks.every((t) => e.h.includes(t))) continue;
    const r = e.r;
    // meilleur score parmi le titre et les synonymes (synonymes un peu moins bien notés), les noms courts passent devant
    let s = 10;
    e.n.forEach((name, i) => {
      let v = 0;
      if (name === ' ' + nq + ' ') v = 100;
      else if (name.startsWith(' ' + nq)) v = 60;
      else if (name.includes(' ' + nq)) v = 40;
      else if (toks.every((t) => name.includes(t))) v = 25;
      if (v) v = v - (i ? 5 : 0) - Math.min(20, (name.length - nq.length) * 0.4);
      if (v > s) s = v;
    });
    s += [3, 2, 0, 0][r[1]] + r[7] / 10;
    out.push([s, r]);
  }
  return out.sort((a, b) => b[0] - a[0]).slice(0, 40).map((x) => x[1]);
}

async function searchAniList(q) {
  const res = await fetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      query: `query($s:String){Page(perPage:15){media(search:$s,type:ANIME,sort:SEARCH_MATCH){id idMal title{romaji english} format seasonYear coverImage{large}}}}`,
      variables: { s: q },
    }),
  });
  if (!res.ok) throw new Error(res.status);
  const j = await res.json();
  return j.data.Page.media.filter((m) => !['MUSIC', 'SPECIAL'].includes(m.format));
}

function addItem(key, title, image, m, extra) {
  const list = cur();
  if (list.items[key]) return false;
  if (list.slots && !list.slots.includes(null)) return false; // top complet
  list.items[key] = m ? { t: title, i: image, m } : { t: title, i: image };
  if (extra) Object.assign(list.items[key], extra);
  if (list.slots) list.slots[list.slots.indexOf(null)] = key; // un top : première place libre
  else list.pool.push(key);
  freshKey = key;
  save();
  render();
  return true;
}

// ---------- Fenêtre « Ajouter des animés » ----------
const TYPE_FR = { TV: 'Série', MOVIE: 'Film', OVA: 'OVA', ONA: 'ONA' };
const FORMATS = { TV: 'TV', TV_SHORT: 'TV', MOVIE: 'MOVIE', OVA: 'OVA', ONA: 'ONA' };
const PILLS = [['all', 'Tous'], ['TV', 'Séries'], ['MOVIE', 'Films'], ['OVA', 'OVA / ONA']];
const S = { mode: null, anime: [], items: [], ani: [], ids: new Set(), byKey: new Map(), type: 'all', hide: false, session: new Set(), aniState: '', undoKey: null };
let toastSearchTimer;

const itemFromRow = (r) => {
  const gid = r[8];
  if (gid) {
    const g = groupRows(gid), rep = g[0];
    return { key: 'g' + rowKey(rep), gid, n: g.length, title: rep[0], img: rep[3], fmt: fmtOf(rep), year: rep[2] || '' };
  }
  return { key: rowKey(r), title: r[0], img: r[3], fmt: fmtOf(r), year: r[2] || '' };
};
const itemFromAni = (m) => {
  const f = FORMATS[m.format] || 'TV';
  return { key: 'a' + m.id, title: m.title.english || m.title.romaji, img: m.coverImage.large, fmt: f, year: m.seasonYear || '' };
};
const keyInList = (it) => (it.gid ? groupItemKey(cur(), it.gid) : (cur().items[it.key] ? it.key : null));
const isAdded = (it) => !!keyInList(it);
const inPill = (it, k) => k === 'all' || it.fmt === k || (k === 'OVA' && it.fmt === 'ONA');

// Titre avec les lettres tapées surlignées (sans accents ni majuscules).
const fold = (s) => [...s].map((c) => c.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()).join('');
function hlNodes(title, q) {
  const f = fold(title), qq = fold(q.trim()), i = qq ? f.indexOf(qq) : -1;
  if (i < 0 || f.length !== title.length) return [title];
  return [title.slice(0, i), h('mark', {}, title.slice(i, i + qq.length)), title.slice(i + qq.length)];
}

const svgEl = (html, cls) => { const t = document.createElement('template'); t.innerHTML = html.trim(); const el = t.content.firstChild; if (cls) el.classList.add(cls); return el; };
const CHECK = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const TRASH = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>';

function srChip(added) {
  return h('button', { class: 'sr-chip' + (added ? ' ad' : ''), type: 'button', 'aria-label': added ? 'Retirer de ma liste' : 'Ajouter à ma liste' },
    added
      ? [h('i', { class: 'ic' }, svgEl(CHECK, 'i-ck'), svgEl(TRASH, 'i-tr')), h('span', { class: 'lbl' }, h('span', {}, 'Retirer'))]
      : [h('i', { class: 'ic' }, '+'), 'Ajouter']);
}

function srItem(it, q, n = 0) {
  const added = isAdded(it);
  return h('div', { class: 'sr-it' + (added ? ' added' : '') + (it.gid ? ' stack' : ''), dataset: { k: it.key }, style: `--n:${Math.min(n, 14)}` },
    h('div', { class: 'sr-pic' }, h('img', { src: imgUrl(it.img), alt: '', loading: 'lazy' }), h('div', { class: 'sr-ov' }, srChip(added))),
    h('b', {}, hlNodes(it.title, q)),
    h('span', { class: 'sr-meta' }, it.char ? null : h('span', { class: 'sr-tag t-' + it.fmt }, TYPE_FR[it.fmt] || it.fmt), it.char ? it.sub : it.gid ? ` ${it.n} saisons` : (it.year ? ' ' + it.year : '')));
}

function renderSearch(animate) {
  const dlg = $('#dlgSearch'), grid = $('#results');
  const qv = $('#q').value, q = qv.trim(), list = cur();
  const top = grid.scrollTop;
  grid.classList.toggle('fresh', !!animate);
  dlg.classList.toggle('has-q', !!qv);
  const all = [...S.items, ...S.ani];
  S.byKey = new Map(all.map((it) => [it.key, it]));

  const visibleChars = () => S.items.filter((it) => inPill(it, S.type) && !(S.hide && isAdded(it)));
  const charTools = [];
  if (list.type === 'char' && q.length >= 2) {
    if (S.mode) {
      const left = visibleChars().filter((it) => !isAdded(it)).length;
      charTools.push(
        h('button', { class: 'sw-pill', id: 'srBack', type: 'button' }, '← Retour'),
        h('span', { class: 'sr-modelab' }, `Personnages de « ${S.mode.title} » · ${S.items.length} chargé${S.items.length > 1 ? 's' : ''}${S.mode.loading ? '…' : ''}`),
        h('button', { class: 'sw-pill on', id: 'srAll', type: 'button', ...(left ? {} : { disabled: '' }) }, left ? `Tout ajouter (${left})` : 'Tout est ajouté'),
        ...(S.mode.hasNext && !S.mode.loading ? [h('button', { class: 'sw-pill', id: 'srMore', type: 'button' }, 'Charger plus')] : []));
    } else if (S.anime.length) {
      charTools.push(h('span', { class: 'sr-modelab' }, 'Tous les personnages de :'),
        ...S.anime.map((m) => h('button', { class: 'sw-pill', dataset: { anime: String(m.id) }, type: 'button', title: m.title }, m.title + (m.year ? ' (' + m.year + ')' : ''))));
    }
  }
  $('#srTools').replaceChildren(
    ...charTools,
    ...(list.type === 'char' ? [] : PILLS).map(([k, n]) => h('button', { class: 'sw-pill' + (S.type === k ? ' on' : ''), dataset: { ty: k }, type: 'button' },
      n, q.length >= 2 ? h('small', {}, String(all.filter((it) => inPill(it, k)).length)) : null)),
    h('span', { class: 'sw-tog' + (S.hide ? ' on' : ''), id: 'srTog' }, h('i'), 'Masquer ceux déjà ajoutés'));

  const visible = (arr) => arr.filter((it) => inPill(it, S.type) && !(S.hide && isAdded(it)));
  const loc = visible(S.items), ani = visible(S.ani);
  const aniLabel = { '': 'Pas trouvé ? Chercher aussi sur AniList', loading: 'Recherche sur AniList…', done: S.ani.length ? `AniList : ${S.ani.length} résultat${S.ani.length > 1 ? 's' : ''} en plus` : 'Rien de plus sur AniList', error: 'AniList indisponible — réessayer' }[S.aniState];

  if (q.length < 2) {
    grid.replaceChildren(h('div', { class: 'sw-hint' },
      h('div', { class: 'big' }, '🔎'), h('p', {}, list.type === 'char' ? 'Tape le nom d’un personnage ou d’un animé' : 'Tape le titre d’un animé'),
      h('small', {}, list.type === 'char' ? 'Un personnage (« Gojo », « Luffy », « Eren »…) ou un animé (« One Piece ») : pour un animé, tu peux ajouter tous ses personnages d’un coup.' : 'En français, en anglais ou en japonais : « L’Attaque des Titans » et « Shingeki no Kyojin » marchent tous les deux.')));
    $('#srCnt').textContent = '';
  } else if (S.mode && !loc.length && !ani.length) {
    grid.replaceChildren(h('div', { class: 'sw-hint' }, S.mode.loading ? h('p', {}, 'Chargement des personnages…') : h('p', {}, S.items.length ? 'Tous les personnages sont déjà ajoutés.' : 'Aucun personnage trouvé pour cet animé.')));
    $('#srCnt').textContent = '';
  } else if (!loc.length && !ani.length) {
    grid.replaceChildren(h('div', { class: 'sw-hint' },
      h('div', { class: 'big' }, '🤔'), h('p', {}, `Rien dans la base pour « ${q} ».`),
      h('small', {}, list.type === 'char' ? (S.anime.length ? 'Essaie les animés proposés ci-dessus pour voir tous leurs personnages.' : 'Essaie une autre orthographe (le nom en romaji).') : 'Les sorties très récentes ne sont pas toujours dedans.'),
      list.type !== 'char' && (S.aniState === '' || S.aniState === 'error') ? h('button', { class: 'sw-go', id: 'srAni2', type: 'button' }, 'Chercher sur AniList') : null,
      h('button', { class: 'ghost sm cu-open', id: 'srCustom2', type: 'button' }, `＋ Créer « ${q} » moi-même`)));
    $('#srCnt').textContent = '';
  } else {
    grid.replaceChildren(...loc.map((it, i) => srItem(it, q, i)),
      ...(ani.length ? [h('div', { class: 'sw-sep' }, 'Sur AniList')] : []), ...ani.map((it, i) => srItem(it, q, i)));
    $('#srCnt').textContent = `${loc.length + ani.length} résultat${loc.length + ani.length > 1 ? 's' : ''}`;
  }
  grid.scrollTop = top;

  const link = $('#srAni');
  link.hidden = q.length < 2 || list.type === 'char';
  link.textContent = aniLabel;
  $('#srCount').textContent = S.session.size ? `${S.session.size} ajouté${S.session.size > 1 ? 's' : ''}` : '';
}

async function doSearch() {
  const q = $('#q').value.trim();
  S.ani = []; S.aniState = ''; S.mode = null; S.anime = [];
  if (q.length < 2) { S.items = []; renderSearch(true); return; }
  if (cur().type === 'char') { doCharSearch(q); return; }
  if (!animeData) {
    try { await loadData(); } catch { $('#results').replaceChildren(h('div', { class: 'sw-hint' }, h('p', {}, 'Base indisponible. Réessaie avec internet.'))); return; }
  }
  const rows = searchLocal(q);
  S.items = [...new Map(rows.map(itemFromRow).map((it) => [it.key, it])).values()]; // une seule carte par licence
  S.ids = new Set(rows.flatMap((r) => [r[4] && 'a' + r[4], r[5] && 'm' + r[5]]).filter(Boolean));
  renderSearch(true);
}

async function fetchAni() {
  const q = $('#q').value.trim();
  if (q.length < 2 || S.aniState === 'loading') return;
  S.aniState = 'loading'; renderSearch();
  try {
    const media = (await searchAniList(q)).filter((m) => !S.ids.has('a' + m.id) && !(m.idMal && S.ids.has('m' + m.idMal)));
    S.ani = media.map(itemFromAni); S.aniState = 'done';
  } catch { S.aniState = 'error'; }
  renderSearch();
}

function removeKey(key) {
  const list = cur();
  detach(list, key);
  delete list.items[key];
  S.session.delete(key);
  save(); render();
}

function showUndo(it) {
  const t = $('#srToast');
  S.undoKey = it.key;
  t.replaceChildren(h('span', {}, `« ${it.title} » ajouté dans Non classé`), h('button', { id: 'srUndo', type: 'button' }, 'Annuler'));
  t.classList.add('show');
  clearTimeout(toastSearchTimer);
  toastSearchTimer = setTimeout(() => t.classList.remove('show'), 3000);
}

function updateMeta() {
  const n = $('#results').querySelectorAll('.sr-it:not(.leaving)').length;
  if ($('#q').value.trim().length >= 2) {
    if (!n) { renderSearch(); return; }
    $('#srCnt').textContent = `${n} résultat${n > 1 ? 's' : ''}`;
  }
  $('#srCount').textContent = S.session.size ? `${S.session.size} ajouté${S.session.size > 1 ? 's' : ''}` : '';
}

function refreshItem(it, added) {
  const el = $(`.sr-it[data-k="${CSS.escape(it.key)}"]`);
  if (el) {
    el.classList.toggle('added', added);
    el.querySelector('.sr-ov').replaceChildren(srChip(added));
    if (added) el.querySelector('.sr-chip').classList.add('just', 'pop'); // pas de « Retirer » tant que la souris reste sur le bouton
    if (added && S.hide) { el.classList.add('leaving'); setTimeout(() => { el.remove(); updateMeta(); }, 260); }
  }
  updateMeta();
}

function toggleItem(it) {
  const k = keyInList(it);
  if (k) { removeKey(k); S.session.delete(it.key); }
  else {
    if (!addItem(it.key, it.title, it.img, it.gid ? groupRows(it.gid).map(rowKey) : undefined, it.char ? { a: it.sub } : undefined)) { toast('Ton top est complet'); return; }
    S.session.add(it.key); showUndo(it);
    const t = cur();
    if (t.slots && !t.slots.includes(null)) setTimeout(() => $('#dlgSearch').close(), 600); // top rempli : on referme la recherche
  }
  refreshItem(it, !!keyInList(it));
}

$('#results').addEventListener('click', (e) => {
  if (e.target.closest('#srAni2')) { fetchAni(); return; }
  const chip = e.target.closest('.sr-chip');
  if (!chip) return;
  const it = S.byKey.get(chip.closest('.sr-it').dataset.k);
  if (it) toggleItem(it);
});
$('#results').addEventListener('mouseout', (e) => {
  const c = e.target.closest('.sr-chip');
  if (c && !c.contains(e.relatedTarget)) c.classList.remove('just');
});
$('#srTools').addEventListener('click', (e) => {
  const an = e.target.closest('[data-anime]');
  if (an) { const m = S.anime.find((x) => String(x.id) === an.dataset.anime); if (m) loadAnimeChars(m); return; }
  if (e.target.closest('#srBack')) { S.mode = null; doSearch(); return; }
  if (e.target.closest('#srMore')) { loadAnimeChars(null, true); return; }
  if (e.target.closest('#srAll')) { addAllVisible(); return; }
  const p = e.target.closest('[data-ty]');
  if (p) { S.type = p.dataset.ty; renderSearch(); return; }
  if (e.target.closest('#srTog')) { S.hide = !S.hide; renderSearch(); }
});
$('#srAni').onclick = fetchAni;
$('#srToast').addEventListener('click', (e) => {
  if (e.target.id !== 'srUndo' || !S.undoKey) return;
  removeKey(S.undoKey); S.undoKey = null;
  $('#srToast').classList.remove('show');
  renderSearch();
});

let debounce;
$('#q').addEventListener('input', () => {
  $('#dlgSearch').classList.toggle('has-q', !!$('#q').value);
  clearTimeout(debounce);
  debounce = setTimeout(doSearch, 150);
});
$('#srClr').onclick = () => { $('#q').value = ''; $('#q').focus(); doSearch(); };
$('#srClose').onclick = () => $('#dlgSearch').close();
$('#srDone').onclick = () => $('#dlgSearch').close();
$('#dlgSearch').addEventListener('click', (e) => { if (e.target === $('#dlgSearch')) $('#dlgSearch').close(); });

function openSearch() {
  if (!cur()) return;
  const dlg = $('#dlgSearch');
  const chr = cur().type === 'char';
  const forTop = UI.view === 'top' ? ' à mon top' : '';
  $('#srTitle').textContent = (chr ? 'Ajouter des personnages' : 'Ajouter des animés') + forTop;
  $('#q').placeholder = chr ? 'Nom d’un personnage ou d’un animé…' : 'Titre d’un animé…';
  if (!dlg.open) dlg.showModal();
  $('#q').focus();
  renderSearch();
  loadData().then(() => { if ($('#q').value.trim()) doSearch(); }).catch(() => {});
}
// La touche « / » ouvre la recherche (ou y replace le curseur), comme sur beaucoup de sites.
document.addEventListener('keydown', (e) => {
  if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || e.target.closest('input, textarea, select')) return;
  e.preventDefault();
  openSearch();
});
$('#dlgSearch').addEventListener('close', () => {
  $('#q').value = '';
  Object.assign(S, { items: [], ani: [], aniState: '', undoKey: null, type: 'all', mode: null, anime: [] });
  S.session.clear();
  $('#srToast').classList.remove('show');
  render();
});

// ---------- Fiche d'une carte : saisons vues, jaquette, séparer / regrouper, retirer ----------
let ficheKey = null;

const rekey = (list, from, to) => {
  list.pool = list.pool.map((k) => (k === from ? to : k));
  list.tiers.forEach((t) => (t.items = t.items.map((k) => (k === from ? to : k))));
};
// place `key` juste après `after` dans le tier (ou le liège) qui contient `after`
function insertAfter(list, after, key) {
  const box = list.tiers.map((t) => t.items).concat([list.pool]).find((a) => a.includes(after)) || list.pool;
  box.splice(box.indexOf(after) + 1, 0, key);
}

async function openFiche(key) {
  if (!animeData) { try { await loadData(); } catch { /* hors ligne : la fiche s'affiche sans les saisons */ } }
  ficheKey = key;
  renderFiche();
  if (!$('#dlgFiche').open && ficheKey) $('#dlgFiche').showModal();
}

function fiAction(label, act, k, cls = '') {
  return h('button', { class: 'fi-a ' + cls, type: 'button', dataset: { fa: act, k }, title: label }, label);
}

const fiMember = (r, { off }) => {
  const f = fmtOf(r);
  return h('div', { class: 'fi-m' + (off ? ' off' : '') },
    h('span', { class: 'sr-tag t-' + f }, TYPE_FR[f]), h('span', { class: 't' }, r[0]), h('em', {}, r[2] || ''));
};

function renderFiche() {
  const list = cur(), it = list.items[ficheKey];
  if (!it) { ficheKey = null; if ($('#dlgFiche').open) $('#dlgFiche').close(); return; }
  $('#fiImg').src = imgUrl(it.i);
  $('#fiTitle').textContent = it.t;
  $('#fiReset').hidden = it.i0 === undefined;
  $('#fiDel').textContent = list.slots ? 'Retirer du top' : 'Retirer de ma liste';
  const box = $('#fiList');
  const gid = it.m ? gidOf(it.m[0]) : gidOf(ficheKey);
  const rows = animeData && gid ? groupRows(gid) : [];

  if (it.m && rows.length) {
    $('#fiSub').textContent = list.slots ? '' : `${rows.length} saison${rows.length > 1 ? 's' : ''}`;
    box.replaceChildren(
      h('p', { class: 'fi-hint' }, list.slots ? 'Touche ★ sous la jaquette que tu préfères, ou utilise ta propre image avec les boutons du haut.' : 'L’étoile choisit la jaquette de la carte. « Séparer » fait d’une saison une carte à part.'),
      ...rows.filter((r) => !list.slots || it.m.includes(rowKey(r))).map((r) => {
        const k = rowKey(r), on = it.m.includes(k), apart = !!list.items[k] && k !== ficheKey && !on;
        return h('div', { class: 'fi-row' },
          fiMember(r, { off: !on }),
          on ? fiAction(r[3] === it.i ? '★' : '☆', 'cover', k, r[3] === it.i ? 'on' : '') : null,
          on && it.m.length > 1 && !list.slots ? fiAction('Séparer', 'split', k) : null,
          apart && !list.slots ? fiAction('Regrouper', 'merge', k) : null,
          !on && !apart ? fiAction('Ajouter', 'toggle', k) : null);
      }));
  } else {
    const r = rowOfKey(ficheKey);
    $('#fiSub').textContent = r ? [TYPE_FR[fmtOf(r)], r[2] || null].filter(Boolean).join(' · ') : (it.a || '');
    box.replaceChildren(
      rows.length > 1 && !list.slots
        ? h('div', { class: 'fi-solo' }, h('p', {}, `Cette carte est séparée de sa licence (${rows.length} saisons).`), h('button', { class: 'ghost', id: 'fiRegroup', type: 'button' }, 'Regrouper avec sa licence'))
        : h('p', { class: 'fi-hint' }, it.a !== undefined ? 'Personnage' + (it.a ? ' de « ' + it.a + ' »' : '') + '.' : 'Aucune autre saison liée à cet animé dans la base.'));
  }
}

function fiAct(act, k) {
  const list = cur(), it = list.items[ficheKey], r = rowOfKey(k);
  if (act === 'toggle') {
    if (!it.m.includes(k)) it.m.push(k);
  } else if (act === 'cover') {
    it.i = r[3]; delete it.i0;
  } else if (act === 'split') {
    it.m = it.m.filter((x) => x !== k);
    list.items[k] = { t: r[0], i: r[3] };
    insertAfter(list, ficheKey, k);
    freshKey = k;
  } else if (act === 'merge') {
    detach(list, k); delete list.items[k];
    it.m.push(k);
  }
  save(); render(); renderFiche();
}

function regroupSolo() {
  const list = cur(), gid = gidOf(ficheKey);
  const target = groupItemKey(list, gid);
  if (target) { // la carte de la licence existe déjà : on y ajoute celle-ci
    list.items[target].m.push(ficheKey);
    detach(list, ficheKey); delete list.items[ficheKey];
    ficheKey = target;
  } else { // sinon cette carte devient la carte de la licence
    const rep = groupRows(gid)[0], nk = 'g' + rowKey(rep), old = list.items[ficheKey];
    list.items[nk] = { t: rep[0], i: old.i, m: [ficheKey] };
    rekey(list, ficheKey, nk);
    delete list.items[ficheKey];
    ficheKey = nk;
  }
  save(); render(); renderFiche();
}

$('#fiList').addEventListener('click', (e) => {
  const a = e.target.closest('[data-fa]');
  if (a) { fiAct(a.dataset.fa, a.dataset.k); return; }
  if (e.target.closest('#fiRegroup')) regroupSolo();
});
$('#fiDel').onclick = () => { const k = ficheKey; $('#dlgFiche').close(); removeKey(k); };
$('#fiOk').onclick = () => $('#dlgFiche').close();
$('#fiClose').onclick = () => $('#dlgFiche').close();
$('#dlgFiche').addEventListener('click', (e) => { if (e.target === $('#dlgFiche')) $('#dlgFiche').close(); });
$('#dlgFiche').addEventListener('close', () => { ficheKey = null; });

// ---------- Partager : image de la tier list (aperçu, télécharger, copier, partage natif) ----------
const SHARE_ICON = '<svg viewBox="0 0 24 24"><path d="M12 15V3M7.5 7.5L12 3l4.5 4.5M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>';
const SH = { blob: null, busy: 0 };

// Charge une image pour le canvas. Piège : si la page a déjà affiché l'image SANS CORS, le navigateur la garde ainsi en cache et un
// second chargement avec crossOrigin échoue (image absente de l'export). On la récupère donc par fetch « reload » (réponse CORS neuve),
// puis on la lit depuis un blob local ; si le fetch échoue, on tente le chargement direct.
const loadImage = (url) => new Promise((resolve) => {
  const done = (im) => resolve(im);
  const direct = (u, cors) => {
    const im = new Image();
    if (cors) im.crossOrigin = 'anonymous';
    const t = setTimeout(() => done(null), 9000);
    im.onload = () => { clearTimeout(t); done(im); };
    im.onerror = () => { clearTimeout(t); done(null); };
    im.src = u;
  };
  if (!/^https?:/i.test(url)) { direct(url, false); return; } // data: ou chemin local : pas de CORS en jeu
  fetch(url, { mode: 'cors', cache: 'reload' })
    .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(r.status))))
    .then((b) => {
      const o = URL.createObjectURL(b), im = new Image();
      im.onload = () => { URL.revokeObjectURL(o); done(im); };
      im.onerror = () => { URL.revokeObjectURL(o); direct(url, true); };
      im.src = o;
    })
    .catch(() => direct(url, true));
});

function rr(ctx, x, y, w, h, r) { // rectangle arrondi (compatible partout)
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawPoster(ctx, im, title, x, y, w, h, R = 12, flat = false) {
  if (!flat) { rr(ctx, x, y + 3, w, h, R); ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fill(); } // relief sous l'affiche, comme sur la page
  ctx.save();
  rr(ctx, x, y, w, h, R); ctx.clip();
  if (im) { // recadrage « cover »
    const k = Math.max(w / im.width, h / im.height), sw = w / k, sh = h / k;
    ctx.drawImage(im, (im.width - sw) / 2, (im.height - sh) / 2, sw, sh, x, y, w, h);
  } else {
    ctx.fillStyle = '#3a3f50'; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#c9cde0'; ctx.font = '600 13px Inter, sans-serif'; ctx.textAlign = 'center';
    title.split(' ').slice(0, 6).forEach((word, i) => ctx.fillText(word, x + w / 2, y + 30 + i * 16));
  }
  ctx.restore();
  if (!flat) { rr(ctx, x + 1, y + 1, w - 2, h - 2, R - 1); ctx.lineWidth = 2; ctx.strokeStyle = '#0e1016'; ctx.stroke(); }
}

// adoucit une couleur : saturation réduite, luminosité unifiée, et mélange facultatif avec une teinte du site (pour un rendu plus calme)
// couleur à la position t (0 à 1) d'un dégradé de plusieurs teintes
function gradColor(stops, t) {
  const rgb = stops.map((h) => { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; });
  const p = Math.max(0, Math.min(1, t)) * (rgb.length - 1), i = Math.min(rgb.length - 2, Math.floor(p)), f = p - i;
  return '#' + rgb[i].map((v, k) => Math.round(v + (rgb[i + 1][k] - v) * f).toString(16).padStart(2, '0')).join('');
}

// titre raccourci pour l'image : retire les marques de saison / partie, les années entre parenthèses et les longs sous-titres
function shortTitle(t) {
  let s = t.replace(/\s*\((?:TV|Movie|OVA|ONA|\d{4})\)\s*$/i, '');
  const tail = /\s+(?:\d+(?:st|nd|rd|th)\s+Season|Season\s+\d+|The\s+Final\s+Season|Final\s+Season|Part\s+\d+|Cour\s*\d+|\d+(?:nd|rd|th)\s+Cour|S\d+|II|III|IV)$/i;
  for (let i = 0; i < 4 && tail.test(s); i++) s = s.replace(tail, '');
  const m = s.match(/^(.{8,}?):\s+(.{12,})$/); // « Titre: très long sous-titre » -> « Titre »
  if (m) s = m[1];
  return s.trim() || t;
}

function calmColor(hex, c) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let hh = 0, s = 0, l = (mx + mn) / 2;
  if (d) { s = d / (1 - Math.abs(2 * l - 1)); hh = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; hh *= 60; if (hh < 0) hh += 360; }
  s = Math.min(1, s * c.s); l = c.l;
  const C = (1 - Math.abs(2 * l - 1)) * s, X = C * (1 - Math.abs(((hh / 60) % 2) - 1)), m = l - C / 2;
  const [r1, g1, b1] = hh < 60 ? [C, X, 0] : hh < 120 ? [X, C, 0] : hh < 180 ? [0, C, X] : hh < 240 ? [0, X, C] : hh < 300 ? [X, 0, C] : [C, 0, X];
  let rgb = [r1 + m, g1 + m, b1 + m].map((v) => v * 255);
  if (c.mix) { const t = parseInt(c.mix.hex.slice(1), 16), tr = [t >> 16, (t >> 8) & 255, t & 255]; rgb = rgb.map((v, i) => v * (1 - c.mix.amt) + tr[i] * c.mix.amt); }
  return '#' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}

const hexA = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };

// Même rendu que la page : un bloc arrondi, trait coloré continu à gauche, lueur de chaque tier, lettre qui rayonne, légende dessous.
// opts (aperçus et améliorations) : scale = résolution (2 = nette), cols = jaquettes par ligne, nameSize/outline = noms, tint = voile de couleur par tier, ring = liseré autour des jaquettes
async function buildShareImage(list, withNames = false, opts = {}) {
  const O = { nameStyle: 'gradient', shortNames: false, fitNames: false, palette: null, calm: { s: 1, l: 0.74 }, blocks: true, blockStyle: 'solid', gap: 3, radius: 4, flat: true, poster: [118, 168], title: null, scale: 1, cols: 8, nameSize: 13, outline: true, tint: false, ring: false, ...opts }; // par défaut : 10 par ligne, noms lisibles avec contour, liseré de couleur (le voile par tier est écarté)
  try { await Promise.all([document.fonts.load('800 60px "Baloo 2"'), document.fonts.load('600 14px Inter')]); } catch { /* polices système */ }
  const PAD = 24, LABEL = 170, GAP = O.gap, ROWPAD = 10, BAR = O.blocks ? 0 : 12; // blocks : style « blocs de couleur » (nom du tier sur un rectangle plein)
  const PW = O.poster ? O.poster[0] : 100, PH = O.poster ? O.poster[1] : 142;
  const W = O.cols ? PAD * 2 + LABEL + 12 + O.cols * (PW + GAP) : 1200;
  const perRow = Math.floor((W - PAD * 2 - LABEL - 12) / (PW + GAP));
  const nT = list.tiers.length;
  const sections = list.tiers.map((t, ti) => ({ tier: O.palette ? { ...t, color: gradColor(O.palette, nT > 1 ? ti / (nT - 1) : 0) } : O.calm ? { ...t, color: calmColor(t.color, O.calm) } : t, keys: t.items.filter((k) => list.items[k]) }));
  const CELL = PH;
  const rowH = (n) => Math.max(1, Math.ceil(n / perRow)) * (CELL + GAP) - GAP + ROWPAD * 2;
  const heights = sections.map((x) => rowH(x.keys.length));
  const isTab = !!O.title && O.title.style === 'tab';
  const subText = isTab && O.title.sub ? (list.type === 'char' ? 'TIER LIST · ' + Object.keys(list.items).length + ' PERSONNAGES' : 'TIER LIST · ' + Object.keys(list.items).length + ' ANIMÉS') : '';
  const TABH = subText ? 104 : 74;
  const HH = O.title && !isTab ? (O.title.style === 'pill' ? 44 : 108) : 0; // hauteur de l'en-tête (le bandeau « pill » déborde au-dessus du bloc)
  const TOP = isTab ? TABH : (O.title && O.title.style === 'pill' ? 40 : 0);
  const boxH = heights.reduce((s, h) => s + h, 0) + (sections.length - 1) * 2 + HH;
  const H = PAD * 2 + boxH + 5 + TOP;

  const urls = new Map();
  sections.flatMap((x) => x.keys).forEach((k) => { if (!urls.has(k)) urls.set(k, imgUrl(list.items[k].i)); });
  const imgs = new Map(await Promise.all([...urls].map(async ([k, u]) => [k, await loadImage(u)])));

  const cv = document.createElement('canvas');
  cv.width = Math.round(W * O.scale); cv.height = Math.round(H * O.scale);
  const ctx = cv.getContext('2d');
  ctx.scale(O.scale, O.scale); // on dessine toujours en unités « logiques » : la résolution ne change que la netteté
  ctx.fillStyle = '#23262f'; ctx.fillRect(0, 0, W, H); // fond de la page

  const x0 = PAD, y0 = PAD + TOP, w = W - PAD * 2;
  // onglet : largeur = largeur du titre ; forme unique (bloc + onglet) avec petits raccords arrondis, donc aucun trait entre l'onglet et le tier du haut
  let tabL = 0, tabR = 0, tabSize = 0;
  if (isTab) {
    tabSize = O.title.size || 44; ctx.font = '800 ' + tabSize + 'px "Baloo 2", sans-serif';
    while (ctx.measureText(O.title.text).width > w - 260 && tabSize > 24) { tabSize -= 2; ctx.font = '800 ' + tabSize + 'px "Baloo 2", sans-serif'; }
    let tw = ctx.measureText(O.title.text).width;
    if (subText) { ctx.font = '700 17px Inter, sans-serif'; if ('letterSpacing' in ctx) ctx.letterSpacing = '2px'; tw = Math.max(tw, ctx.measureText(subText).width); if ('letterSpacing' in ctx) ctx.letterSpacing = '0px'; }
    tw += Math.round(tabSize * 1.5) + ({ slant: 44, slant2: 110, folder: 70, peak: 60, dome: 50, cut: 20 }[O.title.shape] || 0);
    tabL = O.title.align === 'left' ? x0 + 40 : x0 + w / 2 - tw / 2; tabR = tabL + tw;
  }
  const boxPath = (dy = 0) => {
    if (!isTab) { rr(ctx, x0, y0 + dy, w, boxH, 16); return; }
    const R = 16, rt = 20, rj = 16, ty = y0 + dy, top = ty - TABH, xr = x0 + w, yb = ty + boxH;
    ctx.beginPath();
    ctx.moveTo(x0 + R, ty); ctx.lineTo(tabL - rj, ty);
    ctx.quadraticCurveTo(tabL, ty, tabL, ty - rj);
    const sh = O.title.shape, cxm = (tabL + tabR) / 2;
    if (sh === 'slant' || sh === 'slant2') { // côtés inclinés (onglet de classeur)
      const sl = sh === 'slant2' ? 64 : 30; ctx.lineTo(tabL + sl - 8, top + 4); ctx.arcTo(tabL + sl, top, tabL + sl + 12, top, 10);
      ctx.lineTo(tabR - sl - 12, top); ctx.arcTo(tabR - sl, top, tabR - sl + 8, top + 4, 10); ctx.lineTo(tabR, ty - rj);
    } else if (sh === 'invert') { // plus large en haut qu'en bas
      const sl = 34; ctx.lineTo(tabL - sl + 8, top + 6); ctx.arcTo(tabL - sl, top, tabL - sl + 14, top, 10);
      ctx.lineTo(tabR + sl - 14, top); ctx.arcTo(tabR + sl, top, tabR + sl - 8, top + 6, 10); ctx.lineTo(tabR, ty - rj);
    } else if (sh === 'cut') { // coins coupés à 45°
      const c = 26; ctx.lineTo(tabL, top + c); ctx.lineTo(tabL + c, top); ctx.lineTo(tabR - c, top); ctx.lineTo(tabR, top + c); ctx.lineTo(tabR, ty - rj);
    } else if (sh === 'dome') { // demi-ellipse
      const hh = 40; ctx.lineTo(tabL, top + hh); ctx.ellipse(cxm, top + hh, (tabR - tabL) / 2, hh, 0, Math.PI, 0); ctx.lineTo(tabR, ty - rj);
    } else if (sh === 'folder') { // onglet de dossier : côtés en courbe douce
      ctx.bezierCurveTo(tabL, ty - 40, tabL + 6, top, tabL + 46, top); ctx.lineTo(tabR - 46, top); ctx.bezierCurveTo(tabR - 6, top, tabR, ty - 40, tabR, ty - rj);
    } else if (sh === 'peak') { // pointe vers le haut
      ctx.lineTo(tabL, top + 36); ctx.lineTo(cxm, top); ctx.lineTo(tabR, top + 36); ctx.lineTo(tabR, ty - rj);
    } else {
      ctx.lineTo(tabL, top + rt); ctx.arcTo(tabL, top, tabL + rt, top, rt);
      ctx.lineTo(tabR - rt, top); ctx.arcTo(tabR, top, tabR, top + rt, rt);
    }
    ctx.lineTo(tabR, ty - rj); ctx.quadraticCurveTo(tabR, ty, tabR + rj, ty);
    ctx.lineTo(xr - R, ty); ctx.arcTo(xr, ty, xr, ty + R, R);
    ctx.lineTo(xr, yb - R); ctx.arcTo(xr, yb, xr - R, yb, R);
    ctx.lineTo(x0 + R, yb); ctx.arcTo(x0, yb, x0, yb - R, R);
    ctx.lineTo(x0, ty + R); ctx.arcTo(x0, ty, x0 + R, ty, R);
    ctx.closePath();
  };
  boxPath(5); ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.fill(); // relief du bloc
  ctx.save();
  boxPath(0); ctx.clip();
  ctx.fillStyle = '#1c1f27'; ctx.fillRect(x0, y0 - (isTab ? TABH : 0), w, boxH + (isTab ? TABH : 0));
  if (isTab) {
    const T = O.title, cxm = (tabL + tabR) / 2, tcols = list.tiers.map((t) => t.color);
    const dyShape = { peak: 12, dome: 6 }[T.shape] || 0;
    const ty = (subText ? y0 - TABH + 14 + tabSize * 0.82 : y0 - TABH / 2 + tabSize * 0.32) + dyShape;
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.font = '800 ' + tabSize + 'px "Baloo 2", sans-serif';
    const tw2 = ctx.measureText(T.text).width;
    if (T.gradient) { const g = ctx.createLinearGradient(cxm - tw2 / 2, 0, cxm + tw2 / 2, 0); tcols.forEach((c, i) => g.addColorStop(tcols.length > 1 ? i / (tcols.length - 1) : 0, c)); ctx.fillStyle = g; } else ctx.fillStyle = '#fff';
    ctx.fillText(T.text, cxm, ty);
    if (subText) { ctx.font = '700 17px Inter, sans-serif'; if ('letterSpacing' in ctx) ctx.letterSpacing = '2px'; ctx.fillStyle = '#8f98b8'; ctx.fillText(subText, cxm, y0 - 16); if ('letterSpacing' in ctx) ctx.letterSpacing = '0px'; }
    if (T.stripe) { const g = ctx.createLinearGradient(tabL, 0, tabR, 0); tcols.forEach((c, i) => g.addColorStop(tcols.length > 1 ? i / (tcols.length - 1) : 0, c)); ctx.fillStyle = g; ctx.fillRect(tabL, y0 - TABH, tabR - tabL, 7); }
  }

  if (O.title && !isTab) { // en-tête intégré au bloc
    const T = O.title, cxm = x0 + w / 2, tcols = list.tiers.map((t) => t.color);
    const grad = (xa, xb) => { const g = ctx.createLinearGradient(xa, 0, xb, 0); tcols.forEach((c, i) => g.addColorStop(tcols.length > 1 ? i / (tcols.length - 1) : 0, c)); return g; };
    const fit = (size) => { ctx.font = '800 ' + size + 'px "Baloo 2", sans-serif'; return ctx.measureText(T.text).width; };
    let size = T.style === 'pill' ? 40 : 58; while (fit(size) > w - 180 && size > 26) size -= 2;
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    if (T.style === 'band') { // bandeau : le dégradé des tiers en fond, titre centré
      ctx.globalAlpha = .38; ctx.fillStyle = grad(x0, x0 + w); ctx.fillRect(x0, y0, w, HH); ctx.globalAlpha = 1;
      const sh = ctx.createLinearGradient(0, y0, 0, y0 + HH); sh.addColorStop(0, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(0,0,0,.35)'); ctx.fillStyle = sh; ctx.fillRect(x0, y0, w, HH);
      ctx.font = '800 ' + size + 'px "Baloo 2", sans-serif'; ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowOffsetY = 3; ctx.shadowBlur = 6; ctx.fillStyle = '#fff'; ctx.fillText(T.text, cxm, y0 + HH / 2 + size * 0.33); ctx.restore();
    } else if (T.style === 'lines') { // « —— Titre —— » : deux traits dégradés de chaque côté
      ctx.font = '800 ' + size + 'px "Baloo 2", sans-serif'; const tw = ctx.measureText(T.text).width, ty = y0 + HH / 2 + size * 0.33;
      ctx.fillStyle = '#fff'; ctx.fillText(T.text, cxm, ty);
      const my = y0 + HH / 2, gap = 26, len = Math.min(240, (w - tw) / 2 - gap - 40);
      ctx.fillStyle = grad(cxm - tw / 2 - gap - len, cxm - tw / 2 - gap); ctx.fillRect(cxm - tw / 2 - gap - len, my - 2, len, 4);
      ctx.fillStyle = grad(cxm + tw / 2 + gap, cxm + tw / 2 + gap + len); ctx.fillRect(cxm + tw / 2 + gap, my - 2, len, 4);
    } else if (T.style === 'pill') { // pastille centrée à cheval sur le bord haut du bloc (dessinée après le bloc)
      /* voir plus bas */
    } else { // 'center' : titre centré, petit trait dégradé dessous
      ctx.font = '800 ' + size + 'px "Baloo 2", sans-serif'; ctx.fillStyle = '#fff'; ctx.fillText(T.text, cxm, y0 + HH / 2 + size * 0.28);
      const lw = Math.min(w * 0.35, 360); ctx.fillStyle = grad(cxm - lw / 2, cxm + lw / 2); rr(ctx, cxm - lw / 2, y0 + HH - 24, lw, 5, 2.5); ctx.fill();
    }
    if (T.style !== 'pill') { ctx.fillStyle = '#0f1117'; ctx.fillRect(x0, y0 + HH - 2, w, 2); }
  }
  let y = y0 + HH;
  const centers = [];
  sections.forEach(({ tier, keys }, idx) => {
    const h = heights[idx];
    if (idx) { ctx.fillStyle = '#0f1117'; ctx.fillRect(x0, y - 2, w, 2); } // trait sombre entre deux tiers
    if (O.blocks) { // blocs de couleur : plusieurs traitements de la couleur du tier
      const bs = O.blockStyle;
      if (bs === 'tint') { ctx.fillStyle = hexA(tier.color, .2); ctx.fillRect(x0, y, LABEL, h); ctx.fillStyle = tier.color; ctx.fillRect(x0, y, 9, h); }
      else if (bs === 'grad') { const g = ctx.createLinearGradient(x0, 0, x0 + LABEL, 0); g.addColorStop(0, hexA(tier.color, .78)); g.addColorStop(1, hexA(tier.color, .12)); ctx.fillStyle = g; ctx.fillRect(x0, y, LABEL, h); }
      else if (bs === 'deep') { ctx.fillStyle = shade(tier.color, -0.52); ctx.fillRect(x0, y, LABEL, h); }
      else if (bs === 'frame') { ctx.strokeStyle = tier.color; ctx.lineWidth = 4; ctx.strokeRect(x0 + 2, y + 2, LABEL - 4, h - 4); }
      else { ctx.fillStyle = tier.color; ctx.fillRect(x0, y, LABEL, h); }
    }
    if (O.tint) { const tg = ctx.createLinearGradient(x0 + BAR, 0, x0 + w, 0); const K = O.tint === true ? 1 : O.tint; tg.addColorStop(0, hexA(tier.color, Math.min(.5, .16 * K))); tg.addColorStop(.5, hexA(tier.color, Math.min(.4, .07 * K))); tg.addColorStop(1, hexA(tier.color, Math.min(.3, .03 * K))); ctx.fillStyle = tg; ctx.fillRect(x0 + BAR, y, w - BAR, h); } // voile léger de la couleur du tier

    // lettre : couleur du tier à plat, comme sur la page
    const long = tier.name.length > 3, size = long ? 34 : 64;
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.font = '800 ' + size + 'px "Baloo 2", sans-serif';
    const cx = x0 + BAR + (LABEL - BAR) / 2, base = y + h / 2 + (tier.desc ? 8 : size * 0.3);
    const ink = O.blocks ? ({ tint: tier.color, frame: tier.color, grad: '#fff', deep: '#fff' }[O.blockStyle] || textOn(tier.color)) : null;
    ctx.save(); if (!O.blocks) { ctx.shadowColor = 'rgba(0,0,0,.3)'; ctx.shadowOffsetY = 2; } ctx.fillStyle = ink || tier.color; ctx.fillText(tier.name.slice(0, 12), cx, base); ctx.restore();
    if (tier.desc) { // légende sur une ou deux lignes
      ctx.font = (O.blocks ? '700' : '600') + ' 14px Inter, sans-serif'; ctx.fillStyle = O.blocks ? ink : '#8f98b8'; ctx.globalAlpha = O.blocks ? .8 : 1;
      const words = tier.desc.split(' '); let line = '', ly = base + 24;
      for (const wd of words) { const t = line ? line + ' ' + wd : wd; if (ctx.measureText(t).width > LABEL - 24 && line) { ctx.fillText(line, cx, ly); line = wd; ly += 17; } else line = t; }
      ctx.fillText(line, cx, ly); ctx.globalAlpha = 1;
    }
    keys.forEach((k, i) => {
      const px = x0 + LABEL + 6 + (i % perRow) * (PW + GAP), py = y + ROWPAD + Math.floor(i / perRow) * (CELL + GAP);
      drawPoster(ctx, imgs.get(k), list.items[k].t, px, py, PW, PH, O.radius, O.flat);
      if (O.ring) { rr(ctx, px + 1, py + 1, PW - 2, PH - 2, 11); ctx.lineWidth = 2; ctx.strokeStyle = hexA(tier.color, .8); ctx.stroke(); }
      if (withNames) { // nom sur la jaquette : dégradé (style de la page) ou barre sombre centrée ; titre raccourci et taille adaptée en option
        const it = list.items[k], label = O.shortNames ? shortTitle(it.t) : it.t, barStyle = O.nameStyle === 'bar';
        const maxW = PW - (barStyle ? 10 : 14), maxLines = barStyle ? 2 : 3;
        const wrap = (sz) => { ctx.font = '700 ' + sz + 'px Inter, sans-serif'; const out = []; let line = ''; for (const wd of label.split(' ')) { const t = line ? line + ' ' + wd : wd; if (ctx.measureText(t).width > maxW && line) { out.push(line); line = wd; } else line = t; } out.push(line); return out; };
        const sizes = O.fitNames ? [16, 15, 14, 13, 12, 11, 10] : [O.nameSize];
        let size = sizes[sizes.length - 1], lines = wrap(size);
        for (const sz of sizes) { const l = wrap(sz); size = sz; lines = l; if (l.length <= maxLines && l.every((x) => ctx.measureText(x).width <= maxW)) break; }
        ctx.font = '700 ' + size + 'px Inter, sans-serif';
        if (lines.length > maxLines) { lines = lines.slice(0, maxLines); let last = lines[maxLines - 1]; while (last.length > 1 && ctx.measureText(last + '…').width > maxW) last = last.slice(0, -1); lines[maxLines - 1] = last + '…'; }
        lines = lines.map((x) => { let t = x; while (t.length > 1 && ctx.measureText(t).width > maxW) t = t.slice(0, -1); return t; });
        const LH = size + 2;
        ctx.save(); rr(ctx, px, py, PW, PH, O.radius); ctx.clip();
        if (barStyle) { const bh = lines.length * LH + 10; ctx.fillStyle = 'rgba(8,10,16,.84)'; ctx.fillRect(px, py + PH - bh, PW, bh); }
        else { const gh = 64, g = ctx.createLinearGradient(0, py + PH - gh, 0, py + PH); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.88)'); ctx.fillStyle = g; ctx.fillRect(px, py + PH - gh, PW, gh); }
        ctx.restore();
        ctx.textAlign = barStyle ? 'center' : 'left'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = '#fff'; ctx.lineJoin = 'round';
        lines.forEach((t, i2) => {
          const ty = py + PH - 7 - (lines.length - 1 - i2) * LH, tx = barStyle ? px + PW / 2 : px + 7;
          if (O.outline && !barStyle) { ctx.lineWidth = 3.2; ctx.strokeStyle = 'rgba(0,0,0,.9)'; ctx.strokeText(t, tx, ty); }
          ctx.fillText(t, tx, ty);
        });
      }
    });
    centers.push(y + h / 2);
    y += h + 2;
  });

  // trait coloré continu sur le bord gauche : un seul dégradé qui traverse tous les tiers
  const bar = ctx.createLinearGradient(0, y0 + HH, 0, y0 + boxH);
  sections.forEach(({ tier }, i) => bar.addColorStop(Math.min(1, (centers[i] - y0 - HH) / (boxH - HH)), tier.color));
  ctx.fillStyle = bar; ctx.fillRect(x0, y0 + HH, BAR, boxH - HH);
  ctx.restore();
  boxPath(0); ctx.lineWidth = 2; ctx.strokeStyle = '#12141b'; ctx.stroke();
  if (O.title && O.title.style === 'pill') { // pastille bleue centrée sur le bord haut, dans le style du post-it « Non classé »
    const T = O.title; let size = 40; ctx.font = '800 ' + size + 'px "Baloo 2", sans-serif';
    while (ctx.measureText(T.text).width > w - 200 && size > 24) { size -= 2; ctx.font = '800 ' + size + 'px "Baloo 2", sans-serif'; }
    const tw = ctx.measureText(T.text).width, pw = tw + 80, ph = 66, px2 = x0 + w / 2 - pw / 2, py2 = y0 - ph / 2;
    rr(ctx, px2, py2 + 5, pw, ph, ph / 2); ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fill();
    rr(ctx, px2, py2, pw, ph, ph / 2); const pg = ctx.createLinearGradient(0, py2, 0, py2 + ph); pg.addColorStop(0, '#6aa0ff'); pg.addColorStop(1, '#3f78e6'); ctx.fillStyle = pg; ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = '#12141b'; ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.fillText(T.text, x0 + w / 2, py2 + ph / 2 + size * 0.3);
  }
  return cv;
}

async function refreshShare() {
  const my = ++SH.busy, list = cur();
  const img = $('#shImg');
  $('#shState').textContent = 'Création de l’image…';
  $('#shState').hidden = false; img.hidden = true;
  ['shDl', 'shCopy', 'shShare'].forEach((id) => { $('#' + id).disabled = true; });
  const title = { text: list.name, style: 'tab', shape: 'slant', size: 44 }; // titre dans un onglet incliné incrusté
  const cv = await (list.slots ? buildTopImage(list, { title }) : buildShareImage(list, !!db.shareNames, { title }));
  const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
  if (my !== SH.busy) return; // une demande plus récente a pris le relais
  SH.blob = blob;
  if (img.dataset.url) URL.revokeObjectURL(img.dataset.url);
  img.dataset.url = URL.createObjectURL(blob);
  img.src = img.dataset.url;
  img.hidden = false; $('#shState').hidden = true;
  ['shDl', 'shCopy', 'shShare'].forEach((id) => { $('#' + id).disabled = false; });
}

const SH_OPTS = { shNames: 'shareNames' };
const syncShareOpts = () => { for (const [id, key] of Object.entries(SH_OPTS)) { $('#' + id).classList.toggle('on', !!db[key]); $('#' + id).setAttribute('aria-pressed', String(!!db[key])); } };
$('#shNamesRow').addEventListener('click', (e) => {
  const b = e.target.closest('.sh-opt');
  if (!b) return;
  db[SH_OPTS[b.id]] = !db[SH_OPTS[b.id]]; save(); syncShareOpts(); refreshShare();
});
function openShare() {
  syncShareOpts(); // tout est désactivé au départ : c'est à l'utilisateur de choisir
  $('#shNamesRow').hidden = !!cur().slots; // ces options ne concernent que les tier lists (un top affiche déjà les titres)
  if (cur().slots && !cur().slots.some(Boolean)) { toast('Ajoute d’abord quelques éléments à ton top'); return; }
  const file = new File([new Blob()], 'x.png', { type: 'image/png' });
  $('#shShare').hidden = !(navigator.canShare && navigator.canShare({ files: [file] }));
  $('#shCopy').hidden = !(window.ClipboardItem && navigator.clipboard?.write);
  if (!$('#dlgShare').open) $('#dlgShare').showModal();
  refreshShare();
}

const shareName = () => 'ranku-' + (cur().name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'tier-list') + '.png';

$('#shDl').onclick = () => {
  if (!SH.blob) return;
  const a = h('a', { href: URL.createObjectURL(SH.blob), download: shareName() });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast('Image téléchargée');
};
$('#shCopy').onclick = async () => {
  try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': SH.blob })]); toast('Image copiée : colle-la où tu veux'); }
  catch { toast('Copie impossible ici, utilise « Télécharger »'); }
};
$('#shShare').onclick = async () => {
  const file = new File([SH.blob], shareName(), { type: 'image/png' });
  try { await navigator.share({ files: [file], title: cur().name, text: `Ma tier list « ${cur().name} » faite avec Ranku` }); }
  catch (e) { if (e.name !== 'AbortError') toast('Partage impossible, utilise « Télécharger »'); }
};
$('#shClose').onclick = () => $('#dlgShare').close();
$('#dlgShare').addEventListener('click', (e) => { if (e.target === $('#dlgShare')) $('#dlgShare').close(); });
$('#dlgShare').addEventListener('close', () => { SH.busy++; });

// Trait de couleur de gauche : un seul dégradé qui passe d'un tier à l'autre, placé d'après la hauteur réelle de chaque ligne.
function updateBar() {
  const box = $('#board .tiers');
  if (!box || !box.offsetHeight) return;
  const H = box.offsetHeight;
  const stops = [...box.querySelectorAll('.tier')].map((r) => `${r.style.getPropertyValue('--c1')} ${Math.round(((r.offsetTop + r.offsetHeight / 2) / H) * 1000) / 10}%`);
  box.style.setProperty('--bar', `linear-gradient(180deg, ${stops.join(', ')})`);
}
window.addEventListener('resize', updateBar);

// ---------- Import de la liste AniList par pseudo (animés terminés) ----------
const IMPORT_ICON = '<svg viewBox="0 0 24 24"><path d="M12 3v12M7.5 10.5L12 15l4.5-4.5M5 19h14"/></svg>';
const ANI_COLLECTION_Q = 'query($u:String,$c:Int){MediaListCollection(userName:$u,type:ANIME,status:COMPLETED,chunk:$c,perChunk:500){hasNextChunk lists{entries{media{id idMal format seasonYear title{romaji english} coverImage{large}}}}}}';

async function aniCollection(user, chunk) {
  let res;
  try {
    res = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query: ANI_COLLECTION_Q, variables: { u: user, c: chunk } }),
    });
  } catch { throw new Error('network'); }
  if (res.status === 429) throw new Error('rate');
  const j = await res.json().catch(() => null);
  const err = j?.errors?.[0];
  if (err) throw new Error(/private/i.test(err.message) ? 'private' : err.status === 404 ? 'notfound' : 'other');
  if (!res.ok || !j?.data) throw new Error('network');
  return j.data.MediaListCollection;
}

// récupère tous les animés terminés (par paquets de 500, avec une pause pour respecter la limite d'AniList)
async function fetchCompleted(user, onProgress) {
  const medias = [], seen = new Set();
  for (let chunk = 1; chunk <= 20; chunk++) {
    const col = await aniCollection(user, chunk);
    for (const l of col.lists || []) for (const en of l.entries || []) {
      const m = en.media;
      if (m && !seen.has(m.id)) { seen.add(m.id); medias.push(m); }
    }
    onProgress?.(medias.length);
    if (!col.hasNextChunk) break;
    await new Promise((r) => setTimeout(r, 800));
  }
  return medias;
}

// Ajoute les animés AniList à une liste SANS toucher à ce qui y est déjà : seuls les nouveaux arrivent dans « Non classé ».
// Une licence déjà présente reçoit juste ses nouvelles saisons ; un animé déjà placé (même séparé) n'est jamais remis.
function importInto(list, medias) {
  const stats = { anime: medias.length, added: 0, present: 0, updated: 0, merged: 0, ignored: 0 };
  const fresh = new Set(); // cartes créées pendant cet import
  for (const m of medias) {
    const i = rowByAnilist.get(m.id) ?? (m.idMal ? rowByMal.get(m.idMal) : undefined);
    let key, item;
    if (i !== undefined) {
      const r = animeData.rows[i], gid = r[8];
      if (gid) {
        const g = groupRows(gid), keys = g.map(rowKey), have = groupItemKey(list, gid);
        if (have) {
          if (fresh.has(have)) { stats.merged++; continue; } // deux saisons de la même licence dans ta liste AniList
          const card = list.items[have], add = keys.filter((k) => !card.m.includes(k) && !list.items[k]);
          if (add.length) { card.m.push(...add); stats.updated++; } else stats.present++;
          continue;
        }
        if (keys.some((k) => list.items[k])) { stats.present++; continue; } // une saison est déjà dans la liste (carte séparée)
        key = 'g' + rowKey(g[0]); item = { t: g[0][0], i: g[0][3], m: keys };
      } else { key = rowKey(r); item = { t: r[0], i: r[3] }; }
    } else if (m.format === 'TV' || m.format === 'TV_SHORT') { // série absente de la base (très récente)
      key = 'a' + m.id; item = { t: m.title.english || m.title.romaji, i: m.coverImage.large };
    } else if ((m.format === 'OVA' || m.format === 'ONA') && m.id) { // OVA / ONA absent de la base : carte séparée (titre et affiche d'AniList)
      key = 'a' + m.id; item = { t: m.title.english || m.title.romaji, i: m.coverImage.large };
    } else { stats.ignored++; continue; } // films et spéciaux absents de la base : laissés de côté
    if (list.items[key]) { stats.present++; continue; }
    list.items[key] = item; list.pool.push(key); fresh.add(key); stats.added++;
  }
  return stats;
}

const IMP = { dest: 'current', src: 'ani', file: null };

function setImport(kind, text) {
  const s = $('#impState');
  s.hidden = !text;
  s.className = 'imp-state ' + kind;
  s.textContent = text || '';
}

function renderImportDest() {
  const opt = (dest, title, desc) => h('button', { class: 'imp-opt' + (IMP.dest === dest ? ' on' : ''), dataset: { dest }, type: 'button' },
    h('i', { class: 'rd' }), h('span', {}, h('b', {}, title), h('small', {}, desc)));
  $('#impDest').replaceChildren(
    h('div', { class: 'imp-q' }, 'Où ajouter tes animés ?'),
    opt('current', `Dans ma liste « ${cur().name} »`, 'Les nouveaux animés arrivent dans « Non classé ». Ce que tu as déjà rangé ne bouge pas.'),
    opt('new', 'Dans une nouvelle liste', 'Crée une liste séparée et laisse ta liste actuelle intacte.'));
}
$('#impDest').addEventListener('click', (e) => {
  const b = e.target.closest('[data-dest]');
  if (b) { IMP.dest = b.dataset.dest; renderImportDest(); }
});

// source : pseudo AniList ou fichier d'export MyAnimeList
function renderImportSrc() {
  const pill = (k, label) => h('button', { class: 'sw-pill' + (IMP.src === k ? ' on' : ''), dataset: { isrc: k }, type: 'button' }, label);
  $('#impSrc').replaceChildren(pill('ani', 'AniList (pseudo)'), pill('mal', 'MyAnimeList (fichier)'));
  const mal = IMP.src === 'mal';
  $('#impUserRow').classList.toggle('imp-hide', mal);
  $('#impFileRow').classList.toggle('imp-hide', !mal);
  $('#impNote').innerHTML = mal
    ? 'Exporte ta liste depuis la <a href="https://myanimelist.net/panel.php?go=export" target="_blank" rel="noopener">page d’export de MyAnimeList</a>, puis choisis ici le fichier téléchargé (<b>.xml</b> ou <b>.xml.gz</b>, pas besoin de le décompresser). Tes animés <b>terminés</b> arrivent dans « Non classé » ; ce qui est déjà dans ta liste ne bouge pas. Les saisons d’une même licence sont regroupées.'
    : 'Entre ton pseudo AniList : tes animés <b>terminés</b> arrivent dans « Non classé ». Ce qui est déjà dans ta liste ne bouge pas : seuls les <b>nouveaux</b> sont ajoutés, tu peux donc réimporter quand tu veux. Les saisons d’une même licence sont regroupées ; les OVA et ONA absents de la base arrivent en cartes séparées, les films sont laissés de côté. Ton profil doit être public.';
}
$('#impSrc').addEventListener('click', (e) => {
  const b = e.target.closest('[data-isrc]');
  if (b) { IMP.src = b.dataset.isrc; setImport('', ''); renderImportSrc(); }
});
$('#impPick').onclick = () => $('#impFile').click();
$('#impFile').addEventListener('change', (e) => {
  IMP.file = e.target.files[0] || null;
  $('#impFileName').textContent = IMP.file ? IMP.file.name : 'Aucun fichier choisi';
});

function openImport() {
  setImport('', '');
  IMP.dest = 'current'; IMP.src = 'ani'; IMP.file = null;
  $('#impFileName').textContent = 'Aucun fichier choisi';
  $('#impFile').value = '';
  renderImportSrc();
  renderImportDest();
  $('#impUser').value = cur().ani || db.ani || '';
  $('#impGo').disabled = false;
  $('#impGo').textContent = 'Importer';
  $('#impGo').onclick = runImport;
  $('#dlgImport').showModal();
  if (IMP.src === 'ani') $('#impUser').focus();
  loadData().catch(() => {});
}

// ---------- MyAnimeList : lecture du fichier d'export ----------
async function readTextFile(file) {
  const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  if (head[0] === 0x1f && head[1] === 0x8b) { // .gz
    if (typeof DecompressionStream === 'undefined') throw new Error('nogz');
    return new Response(file.stream().pipeThrough(new DecompressionStream('gzip'))).text();
  }
  return file.text();
}

function parseMalXml(text) {
  const doc = new DOMParser().parseFromString(text, 'text/xml');
  if (doc.querySelector('parsererror') || !doc.getElementsByTagName('myanimelist').length) throw new Error('badfile');
  const animes = [...doc.getElementsByTagName('anime')];
  if (!animes.length) throw new Error('badfile');
  const get = (el, tag) => el.getElementsByTagName(tag)[0]?.textContent.trim() || '';
  const entries = [];
  for (const a of animes) {
    if (!/^(completed|2)$/i.test(get(a, 'my_status'))) continue; // seulement les animés terminés
    const mal = Number(get(a, 'series_animedb_id'));
    if (mal) entries.push({ mal, title: get(a, 'series_title'), type: get(a, 'series_type') });
  }
  return { entries, user: get(doc.documentElement, 'user_name') };
}

// séries TV absentes de la base : on retrouve leur fiche AniList par l'identifiant MAL (affiche comprise)
async function aniByMal(mals) {
  const out = [];
  for (let i = 0; i < mals.length; i += 25) {
    let res;
    try {
      res = await fetch('https://graphql.anilist.co', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ query: 'query($mals:[Int]){Page(perPage:25){media(idMal_in:$mals,type:ANIME){id idMal format seasonYear title{romaji english} coverImage{large}}}}', variables: { mals: mals.slice(i, i + 25) } }),
      });
    } catch { throw new Error('network'); }
    if (res.status === 429) throw new Error('rate');
    const j = await res.json().catch(() => null);
    if (!res.ok || !j?.data) throw new Error('network');
    out.push(...j.data.Page.media);
    if (i + 25 < mals.length) await new Promise((r) => setTimeout(r, 1200));
  }
  return out;
}

async function loadMalFile() {
  if (!IMP.file) throw new Error('nofile');
  const { entries, user } = parseMalXml(await readTextFile(IMP.file));
  const medias = [], unmatched = [];
  let skipped = 0;
  for (const e of entries) {
    if (rowByMal.has(e.mal)) medias.push({ id: 0, idMal: e.mal, format: e.type === 'TV' ? 'TV' : e.type.toUpperCase(), title: { romaji: e.title }, coverImage: { large: '' } });
    else if (e.type === 'TV' || e.type === 'OVA' || e.type === 'ONA') unmatched.push(e.mal); // TV récente, OVA ou ONA : on les retrouve sur AniList
    else skipped++; // film / spécial absent de la base : laissé de côté
  }
  if (unmatched.length) {
    setImport('load', `${unmatched.length} série${unmatched.length > 1 ? 's' : ''} récente${unmatched.length > 1 ? 's' : ''} à retrouver sur AniList…`);
    const found = await aniByMal(unmatched);
    medias.push(...found);
    skipped += unmatched.length - found.length;
  }
  return { medias, label: user || 'import', skipped, total: entries.length };
}

const IMPORT_ERRORS = {
  notfound: 'Ce pseudo n’existe pas sur AniList. Vérifie l’orthographe.',
  private: 'Ce profil est privé : passe-le en public dans les réglages AniList pour l’importer.',
  rate: 'AniList limite le nombre de requêtes. Réessaie dans une minute.',
  network: 'Impossible de joindre AniList. Vérifie ta connexion et réessaie.',
  other: 'AniList a renvoyé une erreur. Réessaie un peu plus tard.',
  nofile: 'Choisis d’abord le fichier exporté depuis MyAnimeList.',
  badfile: 'Ce fichier n’est pas un export de liste d’animés MyAnimeList (.xml ou .xml.gz).',
  nogz: 'Ton navigateur ne sait pas ouvrir les fichiers .gz : décompresse le fichier, puis choisis le .xml.',
};

async function runImport() {
  const mal = IMP.src === 'mal';
  const user = $('#impUser').value.trim().replace(/^@/, '');
  if (!mal && !user) { $('#impUser').focus(); return; }
  $('#impGo').disabled = true;
  setImport('load', mal ? 'Lecture du fichier…' : 'Chargement de ta liste…');
  try {
    await loadData();
    let medias, label, skipped = 0;
    if (mal) ({ medias, label, skipped } = await loadMalFile());
    else { medias = await fetchCompleted(user, (n) => setImport('load', `${n} animés récupérés…`)); label = user; }
    if (!medias.length && !skipped) { setImport('err', mal ? 'Aucun animé terminé dans ce fichier.' : 'Aucun animé terminé trouvé pour ce pseudo.'); $('#impGo').disabled = false; return; }

    let list = cur();
    if (IMP.dest === 'new') { list = newList((mal ? 'MyAnimeList · ' : 'AniList · ') + label); db.lists.push(list); db.cur = list.id; }
    const stats = importInto(list, medias);
    stats.ignored += skipped;
    stats.anime += skipped;
    if (!mal) { list.ani = user; db.ani = user; } // on s'en souvient pour le prochain import
    save(); render();

    const s = (n) => (n > 1 ? 's' : '');
    const parts = [`${stats.anime} animés terminés ${mal ? 'dans ton fichier' : 'sur AniList'}.`];
    parts.push(stats.added ? `${stats.added} nouvelle${s(stats.added)} carte${s(stats.added)} dans « Non classé » de « ${list.name} ».` : 'Rien de nouveau à ajouter.');
    if (stats.present) parts.push(`${stats.present} déjà dans ta liste, laissé${s(stats.present)} tel${s(stats.present)} quel${s(stats.present)}.`);
    if (stats.updated) parts.push(`${stats.updated} licence${s(stats.updated)} ${stats.updated > 1 ? 'ont' : 'a'} reçu de nouvelles saisons.`);
    if (stats.merged) parts.push(`${stats.merged} saison${s(stats.merged)} regroupée${s(stats.merged)} avec leur licence.`);
    if (stats.ignored) parts.push(`${stats.ignored} film${s(stats.ignored)} ou spécial${stats.ignored > 1 ? 'aux' : ''} (ou animé introuvable) laissé${s(stats.ignored)} de côté.`);
    setImport('ok', parts.join(' '));
    $('#impGo').textContent = 'Terminé';
    $('#impGo').disabled = false;
    $('#impGo').onclick = () => { $('#dlgImport').close(); $('#impGo').onclick = runImport; };
  } catch (e) {
    setImport('err', IMPORT_ERRORS[e.message] || IMPORT_ERRORS.other);
    $('#impGo').disabled = false;
  }
}
$('#impGo').onclick = runImport;
$('#impUser').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#impGo').click(); } });
$('#impClose').onclick = () => { $('#dlgImport').close(); $('#impGo').onclick = runImport; };

// ---------- Tier lists de personnages ----------
const USER_ICON = '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/></svg>';
let listType = 'anime';

// choix « Animés / Personnages » à la création d'une liste
function renderListType() {
  const opt = (t, title, desc) => h('button', { class: 'imp-opt' + (listType === t ? ' on' : ''), dataset: { lt: t }, type: 'button' },
    h('i', { class: 'rd' }), h('span', {}, h('b', {}, title), h('small', {}, desc)));
  $('#listType').replaceChildren(
    opt('anime', 'Animés', 'Affiches des animés, saisons regroupées par licence.'),
    opt('char', 'Personnages', 'Portraits de personnages : cherche n’importe lequel, ou ajoute les principaux de tes animés.'));
}
$('#listType').addEventListener('click', (e) => {
  const b = e.target.closest('[data-lt]');
  if (b) { listType = b.dataset.lt; renderListType(); }
});

// recherche de personnages sur AniList (tous les personnages, y compris les méchants)
const CHAR_SEARCH_Q = 'query($s:String){a:Page(perPage:30){characters(search:$s,sort:SEARCH_MATCH){id name{full} image{large} media(perPage:1,sort:POPULARITY_DESC){nodes{title{romaji english}}}}} b:Page(perPage:4){media(search:$s,type:ANIME,sort:SEARCH_MATCH){id title{romaji english} seasonYear}}}';
const isPlaceholderImg = (u) => !u || /default\.(jpg|png)/.test(u);

async function doCharSearch(q) {
  $('#results').replaceChildren(h('div', { class: 'sw-hint' }, h('p', {}, 'Recherche sur AniList…')));
  $('#srCnt').textContent = '';
  let items = [], error = false;
  S.anime = [];
  try {
    const res = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query: CHAR_SEARCH_Q, variables: { s: q } }),
    });
    if (!res.ok) throw new Error(res.status);
    const j = await res.json();
    S.anime = (j.data.b.media || []).map((m) => ({ id: m.id, title: m.title.english || m.title.romaji, year: m.seasonYear || '' }));
    items = (j.data.a.characters || []).filter((c) => !isPlaceholderImg(c.image.large)).map((c) => {
      const t = c.media.nodes[0]?.title;
      return { key: 'c' + c.id, char: true, title: c.name.full, img: c.image.large, fmt: 'CHAR', sub: t ? (t.english || t.romaji) : '' };
    });
  } catch { error = true; }
  if ($('#q').value.trim() !== q) return; // une frappe plus récente a pris le relais
  S.items = items; S.ani = []; S.aniState = ''; S.mode = null;
  if (error) { $('#results').replaceChildren(h('div', { class: 'sw-hint' }, h('div', { class: 'big' }, '📡'), h('p', {}, 'AniList est indisponible pour le moment.'), h('small', {}, 'Vérifie ta connexion et réessaie.'))); return; }
  renderSearch(true);
}

// tous les personnages d'un animé (principaux d'abord), par pages de 25 ; 8 pages (200 personnages) par clic
const ANIME_CHARS_Q = 'query($id:Int,$p:Int){Media(id:$id){characters(page:$p,perPage:25,sort:[ROLE,RELEVANCE]){pageInfo{hasNextPage} edges{node{id name{full} image{large}}}}}}';
async function loadAnimeChars(media, more = false) {
  if (!more) S.mode = { id: media.id, title: media.title, page: 0, hasNext: true, loading: false };
  const m = S.mode;
  if (!m || m.loading) return;
  if (!more) S.items = [];
  m.loading = true; renderSearch(true);
  const t0 = m.page;
  while (m.hasNext && m.page - t0 < 8) {
    let j = null;
    for (let attempt = 0; attempt < 3 && !j; attempt++) {
      try {
        const res = await fetch('https://graphql.anilist.co', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ query: ANIME_CHARS_Q, variables: { id: m.id, p: m.page + 1 } }) });
        if (res.status === 429) { await new Promise((r) => setTimeout(r, 4000)); continue; }
        const d = await res.json();
        if (d?.data?.Media) j = d.data.Media.characters;
      } catch { await new Promise((r) => setTimeout(r, 1500)); }
    }
    if (S.mode !== m) return; // l'utilisateur a changé de recherche
    if (!j) { m.loading = false; m.hasNext = true; toast('AniList ne répond pas, réessaie avec « Charger plus »'); renderSearch(); return; }
    for (const e of j.edges) {
      const c = e.node;
      if (isPlaceholderImg(c.image.large) || S.items.some((x) => x.key === 'c' + c.id)) continue;
      S.items.push({ key: 'c' + c.id, char: true, title: c.name.full, img: c.image.large, fmt: 'CHAR', sub: m.title });
    }
    m.page++; m.hasNext = j.pageInfo.hasNextPage;
    renderSearch();
    if (m.hasNext && m.page - t0 < 8) await new Promise((r) => setTimeout(r, 700));
  }
  m.loading = false; renderSearch();
}

// ajoute d'un coup tous les résultats affichés (une seule sauvegarde)
function addAllVisible() {
  const list = cur();
  const todo = S.items.filter((it) => inPill(it, S.type) && !isAdded(it));
  let n = 0;
  for (const it of todo) {
    if (list.slots && !list.slots.includes(null)) break;
    list.items[it.key] = it.char ? { t: it.title, i: it.img, a: it.sub } : { t: it.title, i: it.img };
    if (list.slots) list.slots[list.slots.indexOf(null)] = it.key; else list.pool.push(it.key);
    S.session.add(it.key); n++;
  }
  if (n) { save(); render(); }
  renderSearch();
  toast(n < todo.length ? `${n} ajouté${n > 1 ? 's' : ''} : ton top est complet` : `${n} personnage${n > 1 ? 's' : ''} ajouté${n > 1 ? 's' : ''} dans Non classé`);
}

// ---------- Personnages principaux de mes animés ----------
const CH = { src: null };
// deux requêtes distinctes : AniList renvoie une erreur 500 si on mélange id_in et idMal_in
const CHAR_MAIN_FIELDS = 'id title{romaji english} characters(role:MAIN,perPage:8,sort:RELEVANCE){nodes{id name{full} image{large}}}';
const CHAR_MAIN_Q_ID = 'query($ids:[Int]){Page(perPage:25){media(id_in:$ids,type:ANIME){' + CHAR_MAIN_FIELDS + '}}}';
const CHAR_MAIN_Q_MAL = 'query($mals:[Int]){Page(perPage:25){media(idMal_in:$mals,type:ANIME){' + CHAR_MAIN_FIELDS + '}}}';

// animés d'une liste -> références AniList / MAL (pour une licence : sa jaquette et ses 3 premières saisons)
function mediaRefs(list) {
  const refs = [];
  for (const k of Object.keys(list.items)) {
    const it = list.items[k];
    for (const mk of it.m ? it.m.slice(0, 4) : [k]) {
      const r = rowOfKey(mk);
      let ani = 0, mal = 0;
      if (r) { ani = r[4]; mal = r[5]; } else if (mk[0] === 'a') ani = Number(mk.slice(1)); else if (mk[0] === 'm') mal = Number(mk.slice(1));
      if (ani || mal) refs.push({ ani, mal, title: it.t });
    }
  }
  return refs;
}

async function charBatch(ids, mals) {
  for (let attempt = 0; attempt < 2; attempt++) {
    let res;
    try {
      res = await fetch('https://graphql.anilist.co', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(ids.length ? { query: CHAR_MAIN_Q_ID, variables: { ids } } : { query: CHAR_MAIN_Q_MAL, variables: { mals } }),
      });
    } catch { throw new Error('network'); }
    if (res.status === 429 && attempt === 0) { await new Promise((r) => setTimeout(r, (Number(res.headers.get('Retry-After')) || 30) * 1000)); continue; }
    if (res.status === 429) throw new Error('rate');
    const j = await res.json().catch(() => null);
    if (!res.ok || !j?.data) throw new Error('network');
    return j.data.Page.media || [];
  }
  return [];
}

function setChars(kind, text) {
  const s = $('#chState');
  s.hidden = !text;
  s.className = 'imp-state ' + kind;
  s.textContent = text || '';
}

function renderCharSources() {
  const lists = db.lists.filter((l) => l.type !== 'char' && Object.keys(l.items).length);
  if (!lists.some((l) => l.id === CH.src)) CH.src = (lists.find((l) => l.ani) || lists[0])?.id || null;
  $('#chSrc').replaceChildren(
    h('div', { class: 'imp-q' }, 'À partir de quelle liste d’animés ?'),
    ...(lists.length
      ? lists.map((l) => h('button', { class: 'imp-opt' + (CH.src === l.id ? ' on' : ''), dataset: { src: l.id }, type: 'button' },
        h('i', { class: 'rd' }), h('span', {}, h('b', {}, l.name), h('small', {}, `${Object.keys(l.items).length} cartes`))))
      : [h('p', { class: 'imp-note' }, 'Tu n’as pas encore de liste d’animés avec des cartes : importe ou ajoute d’abord des animés dans une liste « Animés ».')]));
  $('#chGo').disabled = !lists.length;
}
$('#chSrc').addEventListener('click', (e) => {
  const b = e.target.closest('[data-src]');
  if (b) { CH.src = b.dataset.src; renderCharSources(); }
});

function openChars() {
  setChars('', '');
  renderCharSources();
  $('#chGo').textContent = 'Ajouter';
  $('#chGo').onclick = runChars;
  $('#dlgChars').showModal();
  loadData().catch(() => {});
}

async function runChars() {
  const src = db.lists.find((l) => l.id === CH.src), target = cur();
  if (!src) return;
  $('#chGo').disabled = true;
  setChars('load', 'Préparation…');
  try {
    await loadData();
    const refs = mediaRefs(src);
    const ids = [...new Set(refs.filter((r) => r.ani).map((r) => r.ani))];
    const mals = [...new Set(refs.filter((r) => !r.ani && r.mal).map((r) => r.mal))];
    const titleOf = new Map();
    refs.forEach((r) => { if (r.ani && !titleOf.has('a' + r.ani)) titleOf.set('a' + r.ani, r.title); if (r.mal && !titleOf.has('m' + r.mal)) titleOf.set('m' + r.mal, r.title); });
    const batches = [];
    for (let i = 0; i < ids.length; i += 25) batches.push([ids.slice(i, i + 25), []]);
    for (let i = 0; i < mals.length; i += 25) batches.push([[], mals.slice(i, i + 25)]);

    const found = new Map(); // clé personnage -> carte
    for (let b = 0; b < batches.length; b++) {
      setChars('load', `Lot ${b + 1} / ${batches.length} · ${found.size} personnages trouvés…`);
      for (const m of await charBatch(...batches[b])) {
        const title = titleOf.get('a' + m.id) || m.title.english || m.title.romaji;
        for (const c of m.characters.nodes) {
          const key = 'c' + c.id;
          if (!found.has(key) && !isPlaceholderImg(c.image.large)) found.set(key, { t: c.name.full, i: c.image.large, a: title });
        }
      }
      if (b < batches.length - 1) await new Promise((r) => setTimeout(r, 1200));
    }
    let added = 0, present = 0;
    for (const [key, item] of found) {
      if (target.items[key]) { present++; continue; }
      target.items[key] = item; target.pool.push(key); added++;
    }
    save(); render();
    const s = (n) => (n > 1 ? 's' : '');
    setChars('ok', [
      `${refs.length ? ids.length + mals.length : 0} animés analysés.`,
      added ? `${added} personnage${s(added)} principa${added > 1 ? 'ux' : 'l'} ajouté${s(added)} dans « Non classé ».` : 'Rien de nouveau à ajouter.',
      present ? `${present} déjà dans la liste, laissé${s(present)} tel${s(present)} quel${s(present)}.` : '',
    ].filter(Boolean).join(' '));
    $('#chGo').textContent = 'Terminé';
    $('#chGo').disabled = false;
    $('#chGo').onclick = () => { $('#dlgChars').close(); };
  } catch (e) {
    setChars('err', e.message === 'rate' ? 'AniList limite le nombre de requêtes. Réessaie dans une minute.' : 'Impossible de joindre AniList. Vérifie ta connexion et réessaie.');
    $('#chGo').disabled = false;
  }
}
$('#chClose').onclick = () => $('#dlgChars').close();

// ---------- Cartes personnalisées : un nom + une image à soi (pour ce qui n'est pas dans la base) ----------
const CU = { img: null };
function cuMsg(t) { const m = $('#cuMsg'); m.textContent = t || ''; m.hidden = !t; }
function cuShow() {
  const p = $('#cuPic');
  p.replaceChildren(CU.img ? h('img', { src: CU.img, alt: '' }) : h('span', {}, 'Pas d’image'));
}
function openCustom() {
  const chr = cur().type === 'char';
  CU.img = null; cuShow(); cuMsg('');
  $('#cuTitle').textContent = chr ? 'Personnage personnalisé' : 'Animé personnalisé';
  $('#cuSubWrap').hidden = !chr;
  $('#cuName').placeholder = chr ? 'Ex. Janemba' : 'Ex. Mon animé préféré';
  $('#cuName').value = $('#q').value.trim();
  $('#cuSub').value = ''; $('#cuUrl').value = ''; $('#cuLink').hidden = true;
  $('#dlgCustom').showModal();
  $('#cuName').focus();
}
$('#srCustom').onclick = openCustom;
$('#results').addEventListener('click', (e) => { if (e.target.closest('#srCustom2')) openCustom(); });
$('#cuCancel').onclick = () => $('#dlgCustom').close();
$('#cuPick').onclick = () => $('#cuFile').click();
$('#cuFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try { CU.img = await fileToDataUrl(file); cuShow(); cuMsg(''); } catch { cuMsg('Cette image n’a pas pu être lue.'); }
});
$('#cuLinkBtn').onclick = () => { $('#cuLink').hidden = !$('#cuLink').hidden; if (!$('#cuLink').hidden) $('#cuUrl').focus(); };
$('#cuUrlOk').onclick = async () => {
  const url = $('#cuUrl').value.trim();
  if (!/^https?:\/\//i.test(url)) { cuMsg('Colle l’adresse complète d’une image (https://…).'); return; }
  const ok = await new Promise((r) => { const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => r(true); im.onerror = () => r(false); im.src = url; });
  if (!ok) { cuMsg('Ce site n’autorise pas l’image : enregistre-la sur ton appareil puis choisis-la avec « Image de l’appareil ».'); return; }
  CU.img = url; cuShow(); cuMsg(''); $('#cuLink').hidden = true;
};
$('#cuOk').onclick = () => {
  const name = $('#cuName').value.trim(), chr = cur().type === 'char';
  if (!name) { cuMsg('Donne un nom à la carte.'); $('#cuName').focus(); return; }
  if (!CU.img) { cuMsg('Ajoute une image : depuis ton appareil ou avec un lien.'); return; }
  const key = 'x' + uid();
  if (!addItem(key, name, CU.img, undefined, chr ? { a: $('#cuSub').value.trim() } : undefined)) { cuMsg('Ton top est complet.'); return; }
  $('#dlgCustom').close();
  S.session.add(key);
  renderSearch(false);
  toast(`« ${name} » ajouté`);
  const t = cur();
  if (t.slots && !t.slots.includes(null)) $('#dlgSearch').close();
};

// ---------- Changer l'image d'une carte (depuis l'appareil ou une adresse), retour à l'image d'origine ----------
const MAX_SIDE = 450; // les images choisies sont réduites : elles sont enregistrées dans le navigateur

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => {
      const k = Math.min(1, MAX_SIDE / Math.max(im.width, im.height));
      const cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.round(im.width * k)); cv.height = Math.max(1, Math.round(im.height * k));
      cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(url);
      resolve(cv.toDataURL('image/jpeg', 0.86));
    };
    im.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image')); };
    im.src = url;
  });
}

function setCardImage(key, src) {
  const it = cur().items[key];
  if (!it) return;
  if (it.i0 === undefined) it.i0 = it.i; // on garde l'image d'origine
  it.i = src;
  save(); render(); renderFiche();
}

$('#fiPick').onclick = () => $('#fiFile').click();
$('#fiFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file || !ficheKey) return;
  try { setCardImage(ficheKey, await fileToDataUrl(file)); toast('Image changée'); }
  catch { toast('Cette image n’a pas pu être lue'); }
});

$('#fiLinkBtn').onclick = () => { $('#fiLink').hidden = !$('#fiLink').hidden; if (!$('#fiLink').hidden) $('#fiUrl').focus(); };
$('#fiUrlOk').onclick = async () => {
  const url = $('#fiUrl').value.trim();
  if (!/^https?:\/\//i.test(url) || !ficheKey) { toast('Colle l’adresse complète d’une image (https://…)'); return; }
  const ok = await new Promise((r) => { const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => r(true); im.onerror = () => r(false); im.src = url; });
  if (!ok) { toast('Ce site n’autorise pas l’image : télécharge-la puis choisis-la depuis ton appareil'); return; }
  setCardImage(ficheKey, url);
  $('#fiUrl').value = ''; $('#fiLink').hidden = true;
  toast('Image changée');
};
$('#fiReset').onclick = () => {
  const it = cur().items[ficheKey];
  if (!it || it.i0 === undefined) return;
  it.i = it.i0; delete it.i0;
  save(); render(); renderFiche();
  toast('Image d’origine remise');
};

// ---------- Confort de tri : taille des affiches, filtre et tri de « Non classé », sélection multiple, tri rapide ----------
const UI = { listId: null, selMode: false, sel: new Set(), filter: '' }; // état de l'écran, non enregistré
const SIZE_SMALL = '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="8" height="8" rx="2"/></svg>';
const SIZE_BIG = '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="3"/></svg>';

// --- taille des affiches (réglage global, gardé dans le navigateur)
function applyCardSize(w) {
  const root = document.documentElement.style;
  root.setProperty('--card-w', w + 'px');
  root.setProperty('--card-h', Math.round(w * 1.42) + 'px');
}
const currentCardW = () => db.cardW || parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--card-w')) || 86;
if (db.cardW) applyCardSize(db.cardW);

// --- compteur et filtre de « Non classé »
const poolTotal = (list) => list.pool.filter((k) => list.items[k]).length;
function updatePoolCount() {
  const cn = $('.cork .note .cnt-n');
  if (!cn) return;
  const total = poolTotal(cur()), shown = [...document.querySelectorAll('.cork .card')].filter((c) => !c.classList.contains('hide-f')).length;
  cn.textContent = UI.filter.trim() ? `${shown} / ${total}` : String(total);
}
const cardText = (it) => norm(it.t + ' ' + (it.a || ''));
function applyPoolFilter() {
  const q = norm(UI.filter), list = cur();
  document.querySelectorAll('.cork .card').forEach((c) => {
    const it = list.items[c.dataset.k];
    c.classList.toggle('hide-f', !!(q && it && !cardText(it).includes(q)));
  });
  updatePoolCount();
}

// --- tri de « Non classé » (réorganise vraiment la pile)
function sortPool(mode) {
  const list = cur();
  const year = (k) => { const it = list.items[k], r = rowOfKey(it.m ? it.m[0] : k); return r?.[2] || 0; };
  const title = (k) => list.items[k].t;
  const origin = (k) => list.items[k].a || '';
  const col = (a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' });
  const cmp = {
    title: (a, b) => col(title(a), title(b)),
    titleDesc: (a, b) => col(title(b), title(a)),
    anime: (a, b) => col(origin(a), origin(b)) || col(title(a), title(b)),
    yearAsc: (a, b) => (year(a) || 9999) - (year(b) || 9999) || col(title(a), title(b)),
    yearDesc: (a, b) => (year(b) || 0) - (year(a) || 0) || col(title(a), title(b)),
  }[mode];
  if (!cmp) return;
  list.pool = list.pool.filter((k) => list.items[k]).sort(cmp);
  save(); render();
}

// --- sélection multiple
function toggleSelMode() {
  UI.selMode = !UI.selMode;
  UI.sel.clear();
  render();
}
function toggleSel(cardEl) {
  const k = cardEl.dataset.k;
  if (UI.sel.has(k)) UI.sel.delete(k); else UI.sel.add(k);
  cardEl.classList.toggle('sel', UI.sel.has(k));
  renderSelBar();
}
let rmArmed = false, rmTimer;
function renderSelBar() {
  const bar = $('#selBar'), list = cur(), n = UI.sel.size;
  bar.hidden = !UI.selMode;
  if (!UI.selMode) return;
  const dis = n ? {} : { disabled: '' };
  bar.replaceChildren(
    h('div', { class: 'sb-top' },
      h('b', {}, n ? `${n} sélectionnée${n > 1 ? 's' : ''}` : 'Touche les cartes à déplacer'),
      h('span', { class: 'sb-links' },
        h('button', { class: 'ghost sm', id: 'sbAll', type: 'button' }, 'Tout le Non classé'),
        h('button', { class: 'ghost sm', id: 'sbNone', type: 'button', ...dis }, 'Aucune'),
        h('button', { class: 'primary sm', id: 'sbDone', type: 'button' }, 'Terminer'))),
    h('div', { class: 'sb-btns' },
      ...list.tiers.map((t) => h('button', { class: 'sb-t', dataset: { to: t.id }, style: `background:${t.color};color:${textOn(t.color)}`, type: 'button', ...dis }, t.name)),
      h('button', { class: 'sb-p', dataset: { to: 'pool' }, type: 'button', ...dis }, 'Non classé'),
      h('button', { class: 'sb-rm', id: 'sbRm', type: 'button', ...dis }, rmArmed ? 'Confirmer ?' : 'Retirer')));
}
function moveSelected(to) {
  const list = cur(), keys = [...UI.sel];
  for (const k of keys) {
    if (!list.items[k]) continue;
    detach(list, k);
    (to === 'pool' ? list.pool : list.tiers.find((t) => t.id === to).items).push(k);
  }
  UI.sel.clear();
  save(); render();
}
$('#selBar').addEventListener('click', (e) => {
  const to = e.target.closest('[data-to]');
  if (to && !to.disabled) { moveSelected(to.dataset.to); return; }
  if (e.target.closest('#sbAll')) { document.querySelectorAll('.cork .card:not(.hide-f)').forEach((c) => { UI.sel.add(c.dataset.k); c.classList.add('sel'); }); renderSelBar(); return; }
  if (e.target.closest('#sbNone')) { UI.sel.clear(); document.querySelectorAll('.card.sel').forEach((c) => c.classList.remove('sel')); renderSelBar(); return; }
  if (e.target.closest('#sbDone')) { toggleSelMode(); return; }
  if (e.target.closest('#sbRm')) {
    if (!rmArmed) { rmArmed = true; renderSelBar(); clearTimeout(rmTimer); rmTimer = setTimeout(() => { rmArmed = false; if (UI.selMode) renderSelBar(); }, 3000); return; }
    rmArmed = false;
    const list = cur();
    [...UI.sel].forEach((k) => { detach(list, k); delete list.items[k]; });
    UI.sel.clear(); save(); render();
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && UI.selMode && !document.querySelector('dialog[open]')) toggleSelMode();
});

// --- réglages dans le tableau (filtre, tri, taille)
$('#board').addEventListener('input', (e) => {
  if (e.target.id === 'poolFilter') { UI.filter = e.target.value; applyPoolFilter(); }
  if (e.target.id === 'sizeRange') applyCardSize(Number(e.target.value));
});
$('#board').addEventListener('change', (e) => {
  if (e.target.id === 'poolSort') sortPool(e.target.value);
  if (e.target.id === 'sizeRange') { db.cardW = Number(e.target.value); save(); }
});

// --- tri rapide : une carte à la fois, un toucher par tier
const QS = { queue: [], history: [], total: 0, counts: {} };

function openQuick() {
  const list = cur(), q = norm(UI.filter);
  QS.queue = list.pool.filter((k) => list.items[k] && (!q || cardText(list.items[k]).includes(q)));
  if (!QS.queue.length) { toast('Rien à ranger dans « Non classé »'); return; }
  QS.history = []; QS.counts = {}; QS.total = QS.queue.length;
  $('#dlgSort').showModal();
  renderQuick();
}

function renderQuick() {
  const list = cur(), key = QS.queue[0], it = key && list.items[key];
  const done = QS.total - QS.queue.length;
  $('#qsProg').textContent = key ? `${done + 1} / ${QS.total}` : `${QS.total} / ${QS.total}`;
  $('#qsFill').style.width = (QS.total ? (done / QS.total) * 100 : 100) + '%';
  $('#qsUndo').disabled = !QS.history.length;
  ['qsSkip', 'qsDel'].forEach((id) => { $('#' + id).disabled = !key; });

  if (!key) { // tout est rangé
    $('#qsBody').replaceChildren(h('div', { class: 'qs-done' },
      h('div', { class: 'big' }, '🎉'), h('p', {}, 'Tout est rangé !'),
      h('small', {}, list.tiers.map((t) => (QS.counts[t.id] ? `${t.name} : ${QS.counts[t.id]}` : '')).filter(Boolean).join(' · ') || 'Rien n’a été déplacé.')));
    $('#qsTiers').replaceChildren(h('button', { class: 'primary', id: 'qsFinish', type: 'button' }, 'Fermer'));
    return;
  }
  const sub = it.m && it.m.length > 1 ? `${it.m.length} saisons` : (it.a || '');
  $('#qsBody').replaceChildren(...[
    h('img', { class: 'qs-card', src: imgUrl(it.i), alt: it.t }),
    h('div', { class: 'qs-title' }, it.t),
    sub ? h('div', { class: 'qs-sub' }, sub) : null].filter(Boolean));
  $('#qsTiers').replaceChildren(...list.tiers.map((t, i) => h('button', {
    class: 'qs-t', dataset: { qt: t.id }, type: 'button',
    style: `--c1:${t.color};--c2:${shade(t.color, -0.2)};--ink:${textOn(t.color)}`,
  }, h('b', {}, t.name), t.desc ? h('small', {}, t.desc) : null, i < 9 ? h('kbd', {}, String(i + 1)) : null)));
}

function quickPlace(tierId) {
  const list = cur(), key = QS.queue.shift();
  if (!key || !list.items[key]) return renderQuick();
  const pos = list.pool.indexOf(key);
  detach(list, key);
  list.tiers.find((t) => t.id === tierId).items.push(key);
  QS.history.push({ key, tierId, pos });
  QS.counts[tierId] = (QS.counts[tierId] || 0) + 1;
  save(); renderQuick();
}
function quickSkip() { if (QS.queue.length > 1) QS.queue.push(QS.queue.shift()); renderQuick(); }
function quickDelete() {
  const list = cur(), key = QS.queue.shift();
  if (!key) return;
  const pos = list.pool.indexOf(key), item = list.items[key];
  detach(list, key); delete list.items[key];
  QS.history.push({ key, tierId: null, pos, item });
  save(); renderQuick();
}
function quickUndo() {
  const list = cur(), last = QS.history.pop();
  if (!last) return;
  if (last.item) list.items[last.key] = last.item; // carte retirée : on la remet
  else { const t = list.tiers.find((x) => x.id === last.tierId); t.items = t.items.filter((k) => k !== last.key); QS.counts[last.tierId]--; }
  list.pool.splice(Math.min(last.pos < 0 ? list.pool.length : last.pos, list.pool.length), 0, last.key);
  QS.queue.unshift(last.key);
  save(); renderQuick();
}
$('#qsTiers').addEventListener('click', (e) => {
  const t = e.target.closest('[data-qt]');
  if (t) { quickPlace(t.dataset.qt); return; }
  if (e.target.closest('#qsFinish')) $('#dlgSort').close();
});
$('#qsSkip').onclick = quickSkip;
$('#qsDel').onclick = quickDelete;
$('#qsDone').onclick = () => $('#dlgSort').close();
$('#qsUndo').onclick = quickUndo;
$('#qsClose').onclick = () => $('#dlgSort').close();
$('#dlgSort').addEventListener('close', () => { QS.queue = []; render(); });
$('#dlgSort').addEventListener('keydown', (e) => {
  if (!QS.queue.length) return;
  const n = Number(e.key);
  if (n >= 1 && n <= 9 && cur().tiers[n - 1]) { e.preventDefault(); quickPlace(cur().tiers[n - 1].id); }
  else if (e.key === ' ' || e.key === 'ArrowRight') { e.preventDefault(); quickSkip(); }
  else if (e.key === 'Backspace' || e.key === 'z') { e.preventDefault(); quickUndo(); }
});

// ---------- Navigation : accueil, tier lists, tops ----------
const VIEWS = { '#tier': 'tiers', '#top': 'top', '#start': 'welcome' };
const HASH = { tiers: '#tier', top: '#top', welcome: '#start' };
// une vue vide est remplacée : top sans top -> tier lists ; tier lists sans liste -> tops ou écran d'accueil
const fixView = (v) => { if (v === 'top' && !db.tops.length) v = 'tiers'; if (v === 'tiers' && !db.lists.length) v = db.tops.length ? 'top' : 'welcome'; if (v === 'welcome' && (db.lists.length || db.tops.length)) v = db.lists.length ? 'tiers' : 'top'; return v; };
const startView = () => fixView(VIEWS[location.hash] || (db.last === 'top' ? 'top' : 'tiers')); // on rouvre la dernière liste utilisée
UI.view = startView();

function go(view) {
  if (UI.view === view) { render(); return; }
  UI.view = view; UI.selMode = false; UI.sel.clear();
  history.pushState(null, '', HASH[view]); // le bouton « retour » du téléphone fonctionne
  window.scrollTo(0, 0);
  render();
}
window.addEventListener('popstate', () => { UI.view = startView(); render(); });
$('#welcomeView').addEventListener('click', (e) => {
  if (e.target.closest('#wlTier')) openList(null);
  else if (e.target.closest('#wlTop')) openTop(null);
});

// affiche seulement l'écran en cours
function showView() {
  document.body.dataset.view = UI.view;
  $('#board').hidden = UI.view !== 'tiers';
  $('#welcomeView').hidden = UI.view !== 'welcome';
  $('#topView').hidden = UI.view !== 'top';
  if (UI.view !== 'tiers') $('#selBar').hidden = true;
  if (db.last !== UI.view) { db.last = UI.view; save(); }
}

const ICON_TIERS = '<svg viewBox="0 0 24 24"><path d="M4 6h8M4 12h12M4 18h16"/></svg>';
const ICON_TOP = '<svg viewBox="0 0 24 24"><path d="M8 4h8v5a4 4 0 0 1-8 0V4zM8 6H5a2 2 0 0 0 0 3 3 3 0 0 0 3 2M16 6h3a2 2 0 0 1 0 3 3 3 0 0 1-3 2M12 13v4M8 21h8M10 17h4"/></svg>';

// ---------- Tops ----------
const curTop = () => db.tops.find((t) => t.id === db.curTop) || db.tops[0] || null;
const CROWN = '<svg viewBox="0 0 24 24"><path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5L3 8z"/></svg>';
let topSortable = null;

// les places se remplissent de gauche à droite, sans trou
function compactSlots(list) {
  const keys = list.slots.filter(Boolean);
  list.slots = keys.concat(Array(Math.max(0, list.size - keys.length)).fill(null));
}

const topSub = (it) => it.a || '';
function topSlot(top, i) {
  const k = top.slots[i], it = k && top.items[k], rank = i + 1;
  const cls = 'tp-row r' + Math.min(rank, 4);
  const num = h('span', { class: 'tp-num' }, String(rank));
  if (!it) {
    return h('div', { class: 'tp-slot ' + cls + ' empty', dataset: { k: '', i: String(i) } }, num,
      h('button', { class: 'tp-add', type: 'button', 'aria-label': 'Ajouter à la place ' + rank }, h('i', {}, '+'), h('small', {}, 'Ajouter')));
  }
  return h('div', { class: 'tp-slot ' + cls + ' filled', dataset: { k, i: String(i) } },
    h('span', { class: 'tp-bg', style: `background-image:url("${imgUrl(it.i)}")` }), num,
    h('div', { class: 'tp-card' }, h('img', { src: imgUrl(it.i), alt: '', loading: 'lazy', draggable: 'false' })),
    h('div', { class: 'tp-txt' }, h('b', { class: 'tp-name' }, it.t), topSub(it) ? h('small', {}, topSub(it)) : null));
}

function renderTop() {
  showView();
  renderTabs();
  const view = $('#topView'), top = curTop();
  if (!top) {
    view.replaceChildren(h('div', { class: 'tp-empty' },
      h('div', { class: 'big' }, '🏆'), h('p', {}, 'Aucun top pour l’instant'),
      h('small', {}, 'Crée ton top 5, 10 ou 15 : chaque place est numérotée, avec l’affiche et le titre.'),
      h('button', { class: 'primary', id: 'tpNew', type: 'button' }, 'Créer mon premier top')));
    return;
  }
  const filled = top.slots.filter(Boolean).length;
  topSortable?.destroy(); topSortable = null;
  const rows = top.slots.map((_, i) => topSlot(top, i));
  view.replaceChildren(...[
    ...pageHead(top, [
      h('button', { class: 'tb-btn p tb-add', type: 'button' }, svgEl(PLUS_ICON), 'Ajouter'),
      h('span', { class: 'tb-count' }, `${filled} / ${top.size} places`),
      h('span', { class: 'sp' }),
      h('button', { class: 'tb-btn tb-share', type: 'button' }, svgEl(SHARE_ICON), 'Partager')]),
    h('div', { class: 'tp-list' }, rows),
    filled > 1 ? h('p', { class: 'tp-hint' }, 'Glisse une carte pour changer son rang. Touche-la pour changer sa jaquette.') : null].filter(Boolean));
  // glisser-déposer : le classement est relu depuis l'ordre des lignes
  topSortable = new Sortable(view.querySelector('.tp-list'), {
    animation: 160, forceFallback: true, fallbackOnBody: true, fallbackTolerance: 3,
    delay: 160, delayOnTouchOnly: true, touchStartThreshold: 6, swapThreshold: 0.6,
    draggable: '.tp-row.filled', ghostClass: 'sortable-ghost', chosenClass: 'sortable-chosen',
    onEnd: () => { lastDrag = Date.now(); syncTop(); },
  });
}

// relit le classement depuis l'ordre des lignes après un glisser-déposer
function syncTop() {
  const top = curTop();
  top.slots = [...document.querySelectorAll('#topView .tp-row.filled')].map((r) => r.dataset.k);
  compactSlots(top);
  save(); renderTop();
}

$('#topView').addEventListener('click', (e) => {
  if (e.target.closest('#tpNew')) { openTop(null); return; }
  if (e.target.closest('.tb-share')) { openShare(); return; }
  if (e.target.closest('.tb-add') || e.target.closest('.tp-add')) { openSearch(); return; }
  const slot = e.target.closest('.tp-slot.filled');
  if (slot && Date.now() - lastDrag > 300) openFiche(slot.dataset.k);
});

// ----- créer / modifier un top
const TS = { size: 10, type: 'anime' };
let editTopId = null;

function renderTopDialog() {
  $('#topSize').replaceChildren(...[5, 10, 15].map((n) => h('button', { class: 'sw-pill' + (TS.size === n ? ' on' : ''), dataset: { tsz: String(n) }, type: 'button' }, 'Top ' + n)));
  const opt = (t, title, desc) => h('button', { class: 'imp-opt' + (TS.type === t ? ' on' : ''), dataset: { tty: t }, type: 'button' },
    h('i', { class: 'rd' }), h('span', {}, h('b', {}, title), h('small', {}, desc)));
  $('#topType').replaceChildren(opt('anime', 'Animés', 'Affiches d’animés, saisons regroupées par licence.'), opt('char', 'Personnages', 'Portraits de personnages, cherchés sur AniList.'));
}
$('#topSize').addEventListener('click', (e) => { const b = e.target.closest('[data-tsz]'); if (b) { TS.size = Number(b.dataset.tsz); renderTopDialog(); } });
$('#topType').addEventListener('click', (e) => { const b = e.target.closest('[data-tty]'); if (b) { TS.type = b.dataset.tty; renderTopDialog(); } });

let topDelArmed = false;
function openTop(id) {
  const dlg = $('#dlgTop');
  editTopId = id;
  topDelArmed = false;
  $('#topDel').textContent = 'Supprimer';
  const t = id && db.tops.find((x) => x.id === id);
  TS.size = t ? t.size : 10;
  TS.type = t ? t.type : 'anime';
  $('#topTitle').textContent = t ? 'Modifier le top' : 'Nouveau top';
  $('#topOk').textContent = t ? 'OK' : 'Créer';
  $('#topName').value = t ? t.name : '';
  dlg.classList.toggle('is-new', !t);
  dlg.returnValue = '';
  renderTopDialog();
  dlg.showModal();
  $('#topName').focus();
}
$('#dlgTop form').addEventListener('submit', (e) => {
  if (e.submitter?.value !== 'ok') return;
  const name = $('#topName').value.trim() || `Mon top ${TS.size}`;
  let created = false;
  if (editTopId) {
    const t = db.tops.find((x) => x.id === editTopId);
    t.name = name;
    if (TS.size !== t.size) { // réduire un top retire les dernières places
      t.slots.slice(TS.size).filter(Boolean).forEach((k) => delete t.items[k]);
      t.slots = t.slots.slice(0, TS.size);
      t.size = TS.size;
      compactSlots(t);
    }
  } else {
    const t = { id: uid(), name, type: TS.type, size: TS.size, items: {}, slots: Array(TS.size).fill(null), pool: [], tiers: [] };
    db.tops.push(t); db.curTop = t.id; created = true;
  }
  save(); if (created) go('top'); else render();
});
$('#topDel').onclick = () => {
  if (!topDelArmed) { topDelArmed = true; $('#topDel').textContent = 'Sûr ? Appuie pour supprimer'; return; }
  db.tops = db.tops.filter((t) => t.id !== editTopId);
  if (db.curTop === editTopId) db.curTop = db.tops[0]?.id || null;
  editTopId = null;
  $('#dlgTop').close('deleted');
  save(); if (UI.view === 'top' && !db.tops.length) go('tiers'); else render();
};

// ----- image du top : la liste numérotée, comme à l'écran
// bloc + onglet incliné centré sur le bord haut, d'une seule forme (aucun trait entre l'onglet et le contenu)
function tabSlantPath(ctx, x0, ty, w, boxH, R, tabL, tabR, TABH) {
  const rj = 16, sl = 30, top = ty - TABH, xr = x0 + w, yb = ty + boxH;
  ctx.beginPath();
  ctx.moveTo(x0 + R, ty); ctx.lineTo(tabL - rj, ty); ctx.quadraticCurveTo(tabL, ty, tabL, ty - rj);
  ctx.lineTo(tabL + sl - 8, top + 4); ctx.arcTo(tabL + sl, top, tabL + sl + 12, top, 10);
  ctx.lineTo(tabR - sl - 12, top); ctx.arcTo(tabR - sl, top, tabR - sl + 8, top + 4, 10); ctx.lineTo(tabR, ty - rj);
  ctx.quadraticCurveTo(tabR, ty, tabR + rj, ty); ctx.lineTo(xr - R, ty); ctx.arcTo(xr, ty, xr, ty + R, R);
  ctx.lineTo(xr, yb - R); ctx.arcTo(xr, yb, xr - R, yb, R); ctx.lineTo(x0 + R, yb); ctx.arcTo(x0, yb, x0, yb - R, R);
  ctx.lineTo(x0, ty + R); ctx.arcTo(x0, ty, x0 + R, ty, R); ctx.closePath();
}

async function buildTopImage(top, opts = {}) {
  try { await Promise.all([document.fonts.load('800 60px "Baloo 2"'), document.fonts.load('800 30px Inter'), document.fonts.load('600 20px Inter')]); } catch { /* polices système */ }
  const W = 900, PAD = 24, IN = 22, RH = 120, GAP = 12, NW = 96, PW = 78, PH = 108;
  const keys = top.slots.filter((k) => k && top.items[k]);
  const boxH = IN * 2 + keys.length * RH + (keys.length - 1) * GAP;
  const T = opts.title, TABH = T ? 74 : 0;
  const H = PAD * 2 + boxH + 5 + TABH;
  const imgs = new Map(await Promise.all(keys.map(async (k) => [k, await loadImage(imgUrl(top.items[k].i))])));
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#23262f'; ctx.fillRect(0, 0, W, H);
  const x0 = PAD, y0 = PAD + TABH, w = W - PAD * 2;
  let tabL = 0, tabR = 0, tabSize = 44;
  if (T) {
    ctx.font = '800 ' + tabSize + 'px "Baloo 2", sans-serif';
    while (ctx.measureText(T.text).width > w - 260 && tabSize > 24) { tabSize -= 2; ctx.font = '800 ' + tabSize + 'px "Baloo 2", sans-serif'; }
    const tw = ctx.measureText(T.text).width + Math.round(tabSize * 1.5) + 44;
    tabL = W / 2 - tw / 2; tabR = tabL + tw;
  }
  const bp = (dy = 0) => { if (T) tabSlantPath(ctx, x0, y0 + dy, w, boxH, 18, tabL, tabR, TABH); else rr(ctx, x0, y0 + dy, w, boxH, 18); };
  bp(5); ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.fill();
  bp(0); ctx.fillStyle = '#1c1f27'; ctx.fill();
  if (T) { ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.font = '800 ' + tabSize + 'px "Baloo 2", sans-serif'; ctx.fillText(T.text, W / 2, y0 - TABH / 2 + tabSize * 0.32); }
  const COL = ['#ffd24d', '#cfd6e4', '#e0a070'];
  const fit = (t, max, font) => { ctx.font = font; if (ctx.measureText(t).width <= max) return t; while (t.length > 1 && ctx.measureText(t + '…').width > max) t = t.slice(0, -1); return t + '…'; };
  keys.forEach((k, i) => {
    const it = top.items[k], y = y0 + IN + i * (RH + GAP), x = x0 + IN, rw = w - IN * 2, im = imgs.get(k);
    ctx.save(); rr(ctx, x, y, rw, RH, 14); ctx.clip();
    ctx.fillStyle = '#1c1f27'; ctx.fillRect(x, y, rw, RH);
    if (im && im.width) { // affiche agrandie et floutée en fond
      ctx.globalAlpha = .55;
      if ('filter' in ctx) ctx.filter = 'blur(14px) saturate(1.2)';
      const s = Math.max((rw + 60) / im.width, (RH + 60) / im.height), dw = im.width * s, dh = im.height * s;
      ctx.drawImage(im, x - 30, y - 30 - (dh - RH) * 0.2, dw, dh);
      ctx.filter = 'none'; ctx.globalAlpha = 1;
    }
    const g = ctx.createLinearGradient(x, 0, x + rw, 0);
    g.addColorStop(0, 'rgba(20,22,30,.92)'); g.addColorStop(.55, 'rgba(20,22,30,.55)'); g.addColorStop(1, 'rgba(20,22,30,.2)');
    ctx.fillStyle = g; ctx.fillRect(x, y, rw, RH);
    ctx.restore();
    rr(ctx, x, y, rw, RH, 14); ctx.lineWidth = 2; ctx.strokeStyle = '#12141b'; ctx.stroke();
    ctx.fillStyle = COL[i] || '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '800 ' + (i < 9 ? 54 : 44) + 'px "Baloo 2", sans-serif'; ctx.fillText(String(i + 1), x + NW / 2, y + RH / 2 + 4);
    drawPoster(ctx, im, it.t, x + NW, y + (RH - PH) / 2, PW, PH);
    const tx = x + NW + PW + 20, tw = x + rw - tx - 18, sub = topSub(it);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = '#f2f4fb';
    const f = '800 28px Inter, sans-serif';
    ctx.font = f; ctx.fillText(fit(it.t, tw, f), tx, y + (sub ? 58 : 70));
    if (sub) { const f2 = '600 20px Inter, sans-serif'; ctx.fillStyle = '#b4bbd6'; ctx.font = f2; ctx.fillText(fit(sub, tw, f2), tx, y + 90); }
  });
  bp(0); ctx.lineWidth = 2; ctx.strokeStyle = '#12141b'; ctx.stroke();
  return cv;
}

// ---------- Démarrage ----------
document.body.classList.add('boot'); // animation d'arrivée, retirée ensuite pour ne pas se rejouer
setTimeout(() => document.body.classList.remove('boot'), 1400);
render();
loadData().catch(() => {}); // précharge la base pour que les affiches et la recherche soient prêtes
