/* Mon Garage — suivi d'entretien de véhicules (PWA, données stockées sur le téléphone). */
'use strict';
const C = window.Core;
const STORE = 'mongarage.v1';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

/* ---------- Données ---------- */
let data = load();
function load() {
  try {
    const d = JSON.parse(localStorage.getItem(STORE));
    if (d && d.voitures) return { reglages: {}, entretiens: [], ...d };
  } catch (e) {}
  return { voitures: [], entretiens: [], reglages: { seuilJours: 30, seuilKm: 1000 } };
}
function save() {
  localStorage.setItem(STORE, JSON.stringify(data));
  // Copie pour le service worker (vérification en arrière-plan quand le système le permet)
  if ('caches' in window) caches.open('mongarage-data').then(c => c.put('./__data.json', new Response(JSON.stringify(data)))).catch(() => {});
  updateBadge();
}
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const car = id => data.voitures.find(v => v.id === id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = d => { if (!d) return ''; if (typeof d === 'string') d = C.parse(d); return d ? d.toLocaleDateString('fr-FR') : ''; };
const fmtKm = n => (n === null || n === undefined || n === '') ? '' : Math.round(n).toLocaleString('fr-FR') + ' km';
const fmtEur = n => Number(n).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
const ICO = {
  chev: '<svg class="chev" viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 11v6M12 7.5v.5"/></svg>',
  engine: '<svg viewBox="0 0 24 24"><path d="M4 9h3l2-2h5v2h3l2 2h2v6h-2l-2 2H9l-2-2H4z"/><path d="M10 4h4"/></svg>',
  car: '<svg viewBox="0 0 24 24"><path d="M5 16l1.5-5h11L19 16"/><rect x="3" y="16" width="18" height="4" rx="1"/><circle cx="7.5" cy="20" r="1.5"/><circle cx="16.5" cy="20" r="1.5"/></svg>'
};

/* ---------- Photos (stockées dans IndexedDB, compressées) ---------- */
const Photos = {
  _db: null, _urls: {},
  db() {
    return this._db || (this._db = new Promise((res, rej) => {
      const r = indexedDB.open('mongarage-photos', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('p');
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    }));
  },
  async tx(mode, fn) {
    const db = await this.db();
    return new Promise((res, rej) => { const t = db.transaction('p', mode); const r = fn(t.objectStore('p')); t.oncomplete = () => res(r && r.result); t.onerror = () => rej(t.error); });
  },
  put(id, blob) { delete this._urls[id]; return this.tx('readwrite', s => s.put(blob, id)); },
  get(id) { return this.tx('readonly', s => s.get(id)); },
  del(id) { if (this._urls[id]) URL.revokeObjectURL(this._urls[id]); delete this._urls[id]; return this.tx('readwrite', s => s.delete(id)); },
  async url(id) {
    if (this._urls[id]) return this._urls[id];
    const b = await this.get(id); if (!b) return '';
    return this._urls[id] = URL.createObjectURL(b);
  }
};
// Réduit la photo (le CT reste lisible) avant stockage
function compress(file, max, quality) {
  return new Promise((res, rej) => {
    const img = new Image(), u = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const cv = document.createElement('canvas'); cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(u); cv.toBlob(b => b ? res(b) : rej(), 'image/jpeg', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(u); rej(); };
    img.src = u;
  });
}
function pickImages(multiple) {
  return new Promise(res => {
    const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*'; i.multiple = !!multiple;
    i.onchange = () => res([...i.files]); i.click();
  });
}
async function hydratePhotos(root = document) {
  for (const el of $$('[data-photo]', root)) { const u = await Photos.url(el.dataset.photo); if (u) el.src = u; }
}
function viewPhoto(id, onDelete) {
  const v = $('#viewer');
  v.innerHTML = `<img data-photo="${id}" alt=""><div class="viewer-bar"><button class="btn btn-ghost" id="vClose">Fermer</button>${onDelete ? '<button class="btn btn-danger" id="vDel">Supprimer</button>' : ''}</div>`;
  v.hidden = false; hydratePhotos(v);
  $('#vClose').onclick = () => v.hidden = true;
  if (onDelete) $('#vDel').onclick = () => { if (confirm('Supprimer cette photo ?')) { v.hidden = true; onDelete(); } };
}
function carVisual(c, cls = '') {
  return c.photoId ? `<img class="car-photo ${cls}" data-photo="${c.photoId}" alt="">` : silhouette(c.couleur);
}

function silhouette(couleur = '#9aa3b5') {
  return `<svg class="sil" viewBox="0 0 300 120" style="stroke:none">
    <path d="M18 86 Q16 70 30 66 L70 60 Q96 37 122 33 L196 31 Q216 32 236 50 L264 58 Q284 63 285 79 L285 88 Q285 93 279 93 L250 93 A26 26 0 0 0 198 93 L102 93 A26 26 0 0 0 50 93 L25 93 Q18 93 18 86Z" fill="${esc(couleur)}"/>
    <path d="M18 86 Q16 70 30 66 L70 60 Q96 37 122 33 L196 31 Q216 32 236 50 L264 58 Q284 63 285 79 L285 88 Q285 93 279 93 L250 93 A26 26 0 0 0 198 93 L102 93 A26 26 0 0 0 50 93 L25 93 Q18 93 18 86Z" fill="url(#sh)"/>
    <defs><linearGradient id="sh" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".35"/><stop offset=".55" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".25"/></linearGradient></defs>
    <path d="M98 59 Q113 42 128 38 L162 37 L162 59Z" fill="#2b2f36" opacity=".85"/>
    <path d="M168 37 L195 37 Q210 39 224 57 L168 59Z" fill="#2b2f36" opacity=".85"/>
    <path d="M165 37 L165 90" stroke="#000" stroke-opacity=".18" stroke-width="1.5"/>
    <circle cx="76" cy="93" r="21" fill="#1d1f24"/><circle cx="76" cy="93" r="12" fill="#c9ccd2"/><circle cx="76" cy="93" r="3" fill="#7d828c"/>
    <circle cx="224" cy="93" r="21" fill="#1d1f24"/><circle cx="224" cy="93" r="12" fill="#c9ccd2"/><circle cx="224" cy="93" r="3" fill="#7d828c"/>
    <rect x="270" y="66" width="12" height="7" rx="2" fill="#d33"/><rect x="20" y="70" width="12" height="6" rx="2" fill="#fff3c4"/>
  </svg>`;
}

/* ---------- Navigation ---------- */
let stack = [{ v: 'garage' }];
let tab = 'garage';
const view = $('#view');
function go(v, params = {}) { stack.push({ v, ...params }); render(); window.scrollTo(0, 0); }
function back() { if (stack.length > 1) { stack.pop(); render(); } }
function replace(v, params = {}) { stack[stack.length - 1] = { v, ...params }; render(); }
$('#btn-back').onclick = back;
$$('.tabbar button').forEach(b => b.onclick = () => {
  tab = b.dataset.tab;
  $$('.tabbar button').forEach(x => x.classList.toggle('active', x === b));
  stack = [{ v: tab }]; render(); window.scrollTo(0, 0);
});

function setTop(title, action) {
  $('#title').textContent = title;
  $('#btn-back').hidden = stack.length <= 1;
  const a = $('#btn-action');
  a.hidden = !action; a.onclick = action || null;
}
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 2600);
}

function render() {
  const s = stack[stack.length - 1];
  const views = { garage: vGarage, car: vCar, carEdit: vCarEdit, plan: vPlan, entretien: vEntretien, history: vHistory, agenda: vAgenda, settings: vSettings };
  (views[s.v] || vGarage)(s);
  hydratePhotos(view);
}

/* ---------- Garage ---------- */
function chipCT(c) {
  const d = C.prochainCT(c);
  if (!d) return '<span class="chip">CT non renseigné</span>';
  const j = C.daysBetween(C.today(), d);
  if (j < 0) return `<span class="chip late">CT dépassé</span>`;
  if (j <= 30) return `<span class="chip warn">CT dans ${j} j</span>`;
  return `<span class="chip ok">CT ${fmtDate(d)}</span>`;
}
function vGarage() {
  setTop('Mon Garage');
  const list = [...data.voitures].sort((a, b) => (b.principale ? 1 : 0) - (a.principale ? 1 : 0));
  if (!list.length) {
    view.innerHTML = `<div class="card empty">${ICO.car}<p><b>Votre garage est vide</b><br>Ajoutez votre premier véhicule pour suivre son entretien et son contrôle technique.</p></div>
      <button class="btn btn-primary fab-add" id="add">Ajouter un véhicule</button>`;
  } else {
    const al = C.alertes(data);
    view.innerHTML = list.map(c => {
      const n = al.filter(a => a.carId === c.id && a.kind === 'entretien' && a.statut !== 'ok');
      const late = n.some(a => a.statut === 'late');
      return `<div class="card car-tile" data-id="${c.id}">
        ${carVisual(c)}
        <div class="info">
          <div class="name">${esc(C.nomVoiture(c))}</div>
          <div class="sub">${esc([c.surnom ? [c.marque, c.modele].filter(Boolean).join(' ') : '', c.immat].filter(Boolean).join(' · ') || 'Profil à compléter')}</div>
          <div class="chips">${c.principale ? '<span class="chip main">Principale</span>' : ''}${chipCT(c)}${n.length ? `<span class="chip ${late ? 'late' : 'warn'}">${n.length} entretien${n.length > 1 ? 's' : ''}</span>` : ''}</div>
        </div>${ICO.chev}</div>`;
    }).join('') + `<button class="btn btn-outline fab-add" id="add">Ajouter un véhicule</button>`;
    $$('.car-tile').forEach(el => el.onclick = () => go('car', { id: el.dataset.id }));
  }
  $('#add').onclick = () => go('carEdit', {});
}

/* ---------- Fiche véhicule ---------- */
function vCar({ id }) {
  const c = car(id); if (!c) return back();
  setTop([c.marque, c.modele].filter(Boolean).join(' ') || C.nomVoiture(c));
  const ct = C.prochainCT(c);
  const ctJ = ct ? C.daysBetween(C.today(), ct) : null;
  const ctColor = ctJ === null ? 'var(--muted)' : ctJ < 0 ? 'var(--danger)' : ctJ <= 30 ? 'var(--warn)' : 'var(--ok)';
  const ech = C.echeances(c, data.entretiens, data.reglages.seuilJours, data.reglages.seuilKm);
  const known = ech.filter(e => e.statut !== 'none');
  const rang = { late: 0, warn: 1, ok: 2, none: 3 };
  ech.sort((a, b) => rang[a.statut] - rang[b.statut]);
  const hist = data.entretiens.filter(e => e.carId === id).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const est = C.kmEstime(c);
  const incomplet = !c.immat || !c.km || (!c.ctDernier && !c.ctProchain && !c.dateMiseCirc);

  view.innerHTML = `
    <div class="card hero">
      <div class="hero-visual" id="carPic">${carVisual(c)}
        <button class="photo-btn" id="chgPhoto" aria-label="Changer la photo"><svg viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg></button>
      </div>
      <div class="photo-links"><a id="chgPhoto2">${c.photoId ? 'Changer la photo' : 'Ajouter une photo'}</a>${c.photoId ? ' · <a id="rmPhoto">Retirer</a>' : ''}</div>
      ${c.surnom ? `<div class="nick">${esc(c.surnom)}</div>` : ''}
      ${c.immat ? `<div class="plate">${esc(c.immat)}</div>` : ''}
      <button class="btn btn-outline" id="details">Voir les détails de la voiture</button>
    </div>
    ${incomplet ? `<div class="card notice" id="complete" style="margin-top:12px">${ICO.info}<div><b>Complétez le profil de votre voiture</b><span>Plaque, kilométrage et contrôle technique pour des rappels précis.</span></div></div>` : ''}

    <div class="section-title">Contrôle technique</div>
    <div class="card">
      <div class="ct-big"><div class="days" style="color:${ctColor}">${ctJ === null ? '—' : ctJ < 0 ? 'Dépassé' : ctJ + ' j'}<small>${ct ? (ctJ < 0 ? 'depuis le ' : 'avant le ') + fmtDate(ct) : 'Renseignez la date du dernier CT'}</small></div></div>
      <div class="row"><label for="ctD">Dernier contrôle</label><input type="date" id="ctD" value="${esc(c.ctDernier || '')}"></div>
      <div class="row"><label for="ctP">Prochain contrôle</label><input type="date" id="ctP" value="${esc(c.ctProchain || '')}"></div>
      <div class="ct-photos">
        <div class="lbl">Procès-verbal du contrôle</div>
        <div class="thumbs">${(c.ctPhotos || []).map(p => `<img class="thumb" data-photo="${p}" data-id="${p}" alt="">`).join('')}
          <button class="thumb add" id="addCtPhoto" aria-label="Ajouter une photo du CT"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg><span>Photo</span></button>
        </div>
      </div>
    </div>
    <div class="hint">Sans date saisie, le prochain CT est calculé : dernier CT + 2 ans, ou 1<sup>re</sup> mise en circulation + 4 ans.</div>

    <div class="section-title">Entretiens de voiture <a id="seeHist">Historique ›</a></div>
    <div class="card">
      <div class="engine-head"><div class="ico">${ICO.engine}</div><div><b>Gardez votre voiture en forme</b><span>On vous prévient quand un entretien approche.</span></div></div>
      <div class="row"><label for="km">Kilométrage actuel</label><input type="number" inputmode="numeric" id="km" placeholder="Kilométrage" value="${esc(c.km || '')}"></div>
      <div class="row"><span class="lbl">Moyenne par mois</span><span class="val" id="moyV">${fmtKm(c.kmMois || 0)}</span></div>
      <div class="slider-wrap"><input type="range" id="moy" min="0" max="5000" step="50" value="${Number(c.kmMois) || 0}"><div class="slider-scale"><span>0</span><span>2500</span><span>5000</span></div></div>
      <div class="pad" style="padding-top:8px">
        ${c.kmDate && est !== Number(c.km) ? `<div class="hint" style="padding:0 0 10px">Relevé du ${fmtDate(c.kmDate)} · estimé aujourd'hui : <b>${fmtKm(est)}</b></div>` : ''}
        <button class="btn btn-primary" id="majKm" disabled>Mise à jour du kilométrage</button>
      </div>
    </div>

    ${known.length === 0 ? `<div class="card notice" id="unlock" style="margin-top:12px">${ICO.info}<div><b>Débloquer votre programme d'entretien</b><span>Enregistrez vos derniers entretiens pour obtenir des échéances précises.</span></div></div>` : ''}

    <div class="section-title">Prochaines échéances <a id="editPlan">Plan ›</a></div>
    <div class="card">${ech.length ? ech.map(e => {
      let right = 'Jamais renseigné', sub = 'Tous les ' + [e.type.km ? fmtKm(e.type.km) : '', e.type.mois ? e.type.mois + ' mois' : ''].filter(Boolean).join(' ou ');
      if (e.statut !== 'none') {
        const parts = [];
        if (e.restantKm !== null) parts.push(e.restantKm <= 0 ? 'dépassé de ' + fmtKm(-e.restantKm) : 'dans ' + fmtKm(e.restantKm));
        if (e.restantJours !== null) parts.push(e.restantJours < 0 ? 'depuis le ' + fmtDate(e.dueDate) : 'le ' + fmtDate(e.dueDate));
        right = parts.join('<br>');
        sub = 'Fait le ' + fmtDate(e.dernier.date) + (e.dernier.km ? ' à ' + fmtKm(e.dernier.km) : '');
      }
      return `<div class="due" data-type="${e.type.id}"><i class="dot ${e.statut}"></i><div class="t"><b>${esc(e.type.label)}</b><span>${sub}</span></div><div class="r">${right}</div></div>`;
    }).join('') : '<div class="pad hint">Aucun travail suivi. Activez-en dans le plan d’entretien.</div>'}</div>

    <button class="btn btn-primary" id="addEnt" style="margin-top:16px">Ajouter un entretien</button>

    ${hist.length ? `<div class="section-title">Derniers entretiens ${hist.length > 4 ? '<a id="seeHist2">Tout voir ›</a>' : ''}</div>
      <div class="card">${hist.slice(0, 4).map(histRow).join('')}</div>` : ''}

    <div class="section-title">Rappels</div>
    <button class="btn btn-ghost" id="ics">Ajouter les rappels à mon calendrier</button>
    <div class="hint">Crée des événements avec alerte (30 j, 7 j et la veille) pour le CT et les entretiens datés.</div>
  `;
  $('#details').onclick = () => go('carEdit', { id });
  if ($('#complete')) $('#complete').onclick = () => go('carEdit', { id });
  if ($('#unlock')) $('#unlock').onclick = () => go('entretien', { carId: id });
  $('#seeHist').onclick = () => go('history', { carId: id });
  if ($('#seeHist2')) $('#seeHist2').onclick = () => go('history', { carId: id });
  $('#editPlan').onclick = () => go('plan', { id });
  $('#addEnt').onclick = () => go('entretien', { carId: id });
  $('#ics').onclick = () => exportICS([c]);
  $$('.due').forEach(el => el.onclick = () => go('entretien', { carId: id, preset: el.dataset.type }));
  $$('.hist').forEach(el => el.onclick = () => go('entretien', { carId: id, entId: el.dataset.id }));

  const changePhoto = async () => {
    const [f] = await pickImages(false); if (!f) return;
    try {
      const blob = await compress(f, 1200, 0.82), pid = 'car-' + uid();
      await Photos.put(pid, blob);
      if (c.photoId) Photos.del(c.photoId);
      c.photoId = pid; save(); render(); toast('Photo mise à jour');
    } catch (e) { toast('Impossible de lire cette image'); }
  };
  $('#chgPhoto').onclick = changePhoto;
  $('#chgPhoto2').onclick = changePhoto;
  if ($('#rmPhoto')) $('#rmPhoto').onclick = () => { if (!confirm('Retirer la photo du véhicule ?')) return; Photos.del(c.photoId); c.photoId = ''; save(); render(); };
  $('#addCtPhoto').onclick = async () => {
    const files = await pickImages(true); if (!files.length) return;
    c.ctPhotos = c.ctPhotos || [];
    for (const f of files) {
      try { const pid = 'ct-' + uid(); await Photos.put(pid, await compress(f, 2000, 0.85)); c.ctPhotos.push(pid); } catch (e) { toast('Une image n’a pas pu être lue'); }
    }
    save(); render();
  };
  $$('.thumb[data-id]').forEach(t => t.onclick = () => viewPhoto(t.dataset.id, () => {
    Photos.del(t.dataset.id); c.ctPhotos = c.ctPhotos.filter(p => p !== t.dataset.id); save(); render();
  }));

  $('#ctD').onchange = e => { c.ctDernier = e.target.value; save(); render(); };
  $('#ctP').onchange = e => { c.ctProchain = e.target.value; save(); render(); };

  const km = $('#km'), moy = $('#moy'), btn = $('#majKm');
  const dirty = () => btn.disabled = !(km.value && (Number(km.value) !== Number(c.km) || Number(moy.value) !== Number(c.kmMois || 0)));
  km.oninput = dirty;
  moy.oninput = () => { $('#moyV').textContent = fmtKm(moy.value); dirty(); };
  btn.onclick = () => {
    const nv = Number(km.value);
    if (c.km && nv < Number(c.km) && !confirm('Le nouveau kilométrage est inférieur au précédent. Continuer ?')) return;
    c.km = nv; c.kmMois = Number(moy.value); c.kmDate = C.iso(C.today());
    save(); toast('Kilométrage mis à jour'); render(); checkNotifs();
  };
}
function histRow(e) {
  const prevu = C.estPrevu(e);
  return `<div class="hist" data-id="${e.id}"><div class="top"><b>${esc(C.libelleTravaux(e))}${prevu ? '<span class="tag">PRÉVU</span>' : ''}</b><span class="val">${e.cout ? fmtEur(e.cout) : ''}</span></div>
    <div class="meta">${fmtDate(e.date)}${e.km ? ' · ' + fmtKm(e.km) : ''}${e.lieu ? ' · ' + esc(e.lieu) : ''}</div></div>`;
}

/* ---------- Détails / création véhicule ---------- */
const SELECTS = {
  carrosserie: ['Citadine', '3 portes', '5 portes', '3/5 portes', 'Berline', 'Break', 'Coupé', 'Cabriolet', 'SUV', 'Monospace', 'Utilitaire', 'Voiture de course'],
  carburant: ['Essence', 'Diesel', 'Hybride', 'Hybride rechargeable', 'Électrique', 'GPL', 'E85'],
  transmission: ['Traction avant', 'Propulsion', 'Intégrale / 4x4'],
  boite: ['Manuelle', 'Automatique', 'Séquentielle'],
  usage: ['Route', 'Compétition', 'Mixte route / piste', 'Collection']
};
function sel(name, val) {
  return `<select name="${name}" id="f-${name}"><option value="">Choisir</option>${SELECTS[name].map(o => `<option${o === val ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
}
function inp(label, name, val, opts = {}) {
  return `<div class="row"><label for="f-${name}">${label}</label><input id="f-${name}" name="${name}" type="${opts.type || 'text'}" ${opts.mode ? `inputmode="${opts.mode}"` : ''} placeholder="${esc(opts.ph ?? 'facultatif')}" value="${esc(val ?? '')}" ${opts.attrs || ''}></div>`;
}
function vCarEdit({ id }) {
  const c = id ? car(id) : { couleur: '#9aa3b5', principale: data.voitures.length === 0 };
  setTop(id ? (C.nomVoiture(c)) : 'Nouveau véhicule', saveCar);
  view.innerHTML = `<form id="f" onsubmit="return false">
    <div class="section-title">Informations générales</div>
    <div class="card"><div class="row"><span class="lbl">Configurer comme voiture principale</span><label class="switch"><input type="checkbox" name="principale" ${c.principale ? 'checked' : ''}><span></span></label></div></div>
    <div class="card">
      ${inp('Plaque d’immatriculation', 'immat', c.immat, { ph: 'AB-123-CD', attrs: 'autocapitalize="characters"' })}
      ${inp('VIN', 'vin', c.vin, { ph: '17 caractères', attrs: 'autocapitalize="characters" maxlength="17"' })}
      ${inp('Surnom de la voiture', 'surnom', c.surnom)}
      ${inp('Date d’achat', 'dateAchat', c.dateAchat, { type: 'date' })}
      ${inp('1<sup>re</sup> mise en circulation', 'dateMiseCirc', c.dateMiseCirc, { type: 'date' })}
    </div>
    <div class="section-title">Spécifications techniques</div>
    <div class="card">
      ${inp('Marque', 'marque', c.marque, { ph: 'Peugeot' })}
      ${inp('Modèle', 'modele', c.modele, { ph: '306' })}
      ${inp('Année', 'annee', c.annee, { type: 'number', mode: 'numeric', ph: '1997' })}
      <div class="row"><label for="f-carrosserie">Carrosserie</label>${sel('carrosserie', c.carrosserie)}</div>
      <div class="row"><label for="f-carburant">Carburant</label>${sel('carburant', c.carburant)}</div>
      <div class="row"><label for="f-transmission">Transmission</label>${sel('transmission', c.transmission)}</div>
      <div class="row"><label for="f-boite">Boîte de vitesses</label>${sel('boite', c.boite)}</div>
      ${inp('Puissance (ch)', 'puissance', c.puissance, { type: 'number', mode: 'numeric', ph: '75' })}
      ${inp('Cylindrée (cm³)', 'cylindree', c.cylindree, { type: 'number', mode: 'numeric', ph: '1360' })}
      ${inp('Code moteur', 'codeMoteur', c.codeMoteur, { ph: 'KFX (TU3JP)' })}
      ${inp('Cylindres', 'cylindres', c.cylindres, { type: 'number', mode: 'numeric', ph: '4' })}
      <div class="row"><label for="f-usage">Usage</label>${sel('usage', c.usage)}</div>
      <div class="row"><label for="f-couleur">Couleur</label><input type="color" id="f-couleur" name="couleur" value="${esc(c.couleur || '#9aa3b5')}" style="flex:none;width:44px;height:30px;border-radius:8px;padding:0"></div>
    </div>
    ${id ? '' : `<div class="section-title">Kilométrage et contrôle technique</div><div class="card">
      ${inp('Kilométrage actuel', 'km', '', { type: 'number', mode: 'numeric', ph: 'Kilométrage' })}
      ${inp('Dernier contrôle technique', 'ctDernier', '', { type: 'date' })}
    </div>`}
    <button class="btn btn-primary" style="margin-top:22px" id="save">Enregistrer</button>
    ${id ? '<button class="link-danger" id="del" type="button">Supprimer voiture</button>' : ''}
  </form>`;
  $('#save').onclick = saveCar;
  if ($('#del')) $('#del').onclick = () => {
    if (!confirm('Supprimer ce véhicule et tout son historique d’entretien ?')) return;
    [c.photoId, ...(c.ctPhotos || [])].filter(Boolean).forEach(p => Photos.del(p));
    data.voitures = data.voitures.filter(v => v.id !== id);
    data.entretiens = data.entretiens.filter(e => e.carId !== id);
    save(); stack = [{ v: 'garage' }]; render(); toast('Véhicule supprimé');
  };
  function saveCar() {
    const fd = new FormData($('#f'));
    const o = Object.fromEntries(fd.entries());
    o.principale = fd.has('principale');
    if (!o.marque && !o.modele && !o.surnom) { toast('Indiquez au moins la marque, le modèle ou un surnom'); return; }
    if (o.immat) o.immat = o.immat.toUpperCase();
    if (o.vin) o.vin = o.vin.toUpperCase();
    if (o.principale) data.voitures.forEach(v => v.principale = false);
    if (id) { Object.assign(c, o); save(); toast('Enregistré'); back(); }
    else {
      const nv = { id: uid(), ...o, kmDate: o.km ? C.iso(C.today()) : '', kmMois: 0, plan: {} };
      data.voitures.push(nv); save(); replace('car', { id: nv.id }); toast('Véhicule ajouté');
    }
  }
}

/* ---------- Plan d'entretien ---------- */
function vPlan({ id }) {
  const c = car(id);
  setTop('Plan d’entretien', savePlan);
  const p = C.plan(c);
  view.innerHTML = `<div class="hint" style="padding-top:0">Choisissez les travaux à suivre et leurs intervalles (le premier atteint déclenche le rappel). Adaptez-les aux préconisations constructeur ou à votre usage piste.</div>
    <form id="f" onsubmit="return false">${p.map(t => `<div class="card" style="margin-top:12px">
      <div class="row"><span class="lbl" style="max-width:75%"><b>${esc(t.label)}</b></span><label class="switch"><input type="checkbox" name="${t.id}.actif" ${t.actif ? 'checked' : ''}><span></span></label></div>
      <div class="row"><label>Tous les (km)</label><input type="number" inputmode="numeric" name="${t.id}.km" value="${t.km || ''}" placeholder="—"></div>
      <div class="row"><label>Tous les (mois)</label><input type="number" inputmode="numeric" name="${t.id}.mois" value="${t.mois || ''}" placeholder="—"></div>
    </div>`).join('')}
    <button class="btn btn-primary" style="margin-top:20px" id="save">Enregistrer</button>
    <button class="btn btn-ghost" id="reset" type="button">Revenir aux valeurs par défaut</button></form>`;
  $('#save').onclick = savePlan;
  $('#reset').onclick = () => { if (confirm('Réinitialiser le plan ?')) { c.plan = {}; save(); render(); } };
  function savePlan() {
    const fd = new FormData($('#f')); c.plan = {};
    for (const t of p) c.plan[t.id] = { actif: fd.has(t.id + '.actif'), km: Number(fd.get(t.id + '.km')) || 0, mois: Number(fd.get(t.id + '.mois')) || 0 };
    save(); toast('Plan enregistré'); back(); checkNotifs();
  }
}

/* ---------- Ajouter / modifier un entretien ---------- */
function vEntretien(s) {
  const c = car(s.carId);
  const ex = s.entId ? data.entretiens.find(e => e.id === s.entId) : null;
  if (!s.draft) s.draft = ex ? JSON.parse(JSON.stringify(ex)) : { travaux: s.preset ? [s.preset] : [], date: C.iso(C.today()), km: c.km || '' };
  const d = s.draft;
  setTop(ex ? 'Modifier l’entretien' : 'Ajouter un entretien', saveEnt);
  const tip = !data.reglages.tipVu;
  view.innerHTML = `
    ${tip ? `<div class="card tip"><b>Astuce rapide</b><p>Vous pouvez enregistrer un entretien passé ou planifier un entretien futur. Indiquez simplement la date, nous nous occupons du reste.</p><button class="x" id="tipX" aria-label="Fermer">${ICO.x}</button></div>` : ''}
    <div class="card" style="margin-top:12px">
      <div class="pad" style="padding-bottom:0"><b>Sélectionner les travaux d'entretien</b></div>
      <div class="row clickable" id="pick"><span class="${d.travaux.length ? '' : 'val'}" style="flex:1">${d.travaux.length ? esc(C.libelleTravaux({ travaux: d.travaux })) : 'Sélectionner les travaux'}</span>${ICO.chev}</div>
      ${d.travaux.includes('autre') ? `<div class="row"><label>Précisez</label><input id="autre" placeholder="ex. embrayage" value="${esc(d.autre || '')}"></div>` : ''}
    </div>
    <div class="card" style="margin-top:12px">
      <div class="row"><label for="date">Date</label><input type="date" id="date" value="${esc(d.date || '')}"></div>
      <div class="row"><label for="kmE">Kilométrage</label><input type="number" inputmode="numeric" id="kmE" placeholder="Saisir le kilométrage" value="${esc(d.km || '')}"></div>
      <div class="row"><label for="cout">Coût (€)</label><input type="number" inputmode="decimal" step="0.01" id="cout" placeholder="facultatif" value="${esc(d.cout || '')}"></div>
      <div class="row"><label for="lieu">Garage / lieu</label><input id="lieu" placeholder="facultatif" value="${esc(d.lieu || '')}"></div>
    </div>
    <div class="card" style="margin-top:12px"><textarea class="comments" id="com" placeholder="Vos commentaires (références pièces, huile utilisée…)">${esc(d.commentaire || '')}</textarea></div>
    <button class="btn btn-primary" style="margin-top:20px" id="save">Enregistrer</button>
    ${ex ? '<button class="link-danger" id="del">Supprimer l’entretien</button>' : ''}`;
  const sync = () => {
    d.date = $('#date').value; d.km = $('#kmE').value; d.cout = $('#cout').value; d.lieu = $('#lieu').value; d.commentaire = $('#com').value;
    if ($('#autre')) d.autre = $('#autre').value;
  };
  ['#date', '#kmE', '#cout', '#lieu', '#com', '#autre'].forEach(q => { if ($(q)) $(q).oninput = sync; });
  if ($('#tipX')) $('#tipX').onclick = () => { data.reglages.tipVu = true; save(); sync(); render(); };
  $('#pick').onclick = () => { sync(); pickTravaux(d.travaux, sel => { d.travaux = sel; render(); }); };
  $('#save').onclick = saveEnt;
  if ($('#del')) $('#del').onclick = () => {
    if (!confirm('Supprimer cet entretien ?')) return;
    data.entretiens = data.entretiens.filter(e => e.id !== ex.id); save(); back(); toast('Entretien supprimé');
  };
  function saveEnt() {
    sync();
    if (!d.travaux.length) return toast('Sélectionnez au moins un travail');
    if (!d.date) return toast('Indiquez une date');
    const e = { ...d, id: ex ? ex.id : uid(), carId: c.id, km: d.km ? Number(d.km) : '', cout: d.cout ? Number(d.cout) : '' };
    if (ex) Object.assign(ex, e); else data.entretiens.push(e);
    // Un entretien passé avec un kilométrage plus élevé met à jour le compteur du véhicule
    if (e.km && !C.estPrevu(e) && e.km > (Number(c.km) || 0)) { c.km = e.km; c.kmDate = e.date; }
    save(); back(); toast(C.estPrevu(e) ? 'Entretien planifié' : 'Entretien enregistré'); checkNotifs();
  }
}
function pickTravaux(current, done) {
  const selected = new Set(current);
  const sheet = $('#sheet'), bd = $('#sheet-backdrop');
  const draw = () => {
    sheet.innerHTML = `<div class="grab"></div><h2>Travaux d'entretien</h2><div class="card">${C.TRAVAUX.map(t =>
      `<div class="check-row ${selected.has(t.id) ? 'on' : ''}" data-id="${t.id}"><span class="box">${selected.has(t.id) ? ICO.check : ''}</span><span class="t">${esc(t.label)}</span></div>`).join('')}</div>
      <button class="btn btn-primary" style="margin-top:16px" id="ok">Valider (${selected.size})</button>`;
    $$('.check-row', sheet).forEach(r => r.onclick = () => { const id = r.dataset.id; selected.has(id) ? selected.delete(id) : selected.add(id); draw(); });
    $('#ok', sheet).onclick = close;
  };
  const close = () => { sheet.hidden = bd.hidden = true; done(C.TRAVAUX.map(t => t.id).filter(id => selected.has(id))); };
  bd.onclick = close;
  draw(); sheet.hidden = bd.hidden = false;
}

/* ---------- Historique ---------- */
function vHistory({ carId }) {
  const c = car(carId);
  setTop('Historique · ' + C.nomVoiture(c));
  const h = data.entretiens.filter(e => e.carId === carId).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const total = h.filter(e => !C.estPrevu(e)).reduce((s, e) => s + (Number(e.cout) || 0), 0);
  const years = [...new Set(h.map(e => (e.date || '').slice(0, 4)))];
  view.innerHTML = h.length ? `<div class="card"><div class="row"><span class="lbl">Entretiens enregistrés</span><span class="val">${h.length}</span></div><div class="row"><span class="lbl">Dépenses totales</span><span class="val">${fmtEur(total)}</span></div></div>` +
    years.map(y => `<div class="section-title">${esc(y || 'Sans date')}</div><div class="card">${h.filter(e => (e.date || '').slice(0, 4) === y).map(histRow).join('')}</div>`).join('') +
    `<button class="btn btn-primary" style="margin-top:20px" id="addEnt">Ajouter un entretien</button>`
    : `<div class="card empty"><p>Aucun entretien enregistré pour l'instant.</p></div><button class="btn btn-primary fab-add" id="addEnt">Ajouter un entretien</button>`;
  $('#addEnt').onclick = () => go('entretien', { carId });
  $$('.hist').forEach(el => el.onclick = () => go('entretien', { carId, entId: el.dataset.id }));
}

/* ---------- À venir ---------- */
function vAgenda() {
  setTop('À venir');
  const al = C.alertes(data);
  const groups = [['late', 'En retard'], ['warn', 'Bientôt'], ['ok', 'Plus tard']];
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  view.innerHTML = (perm !== 'granted' ? `<div class="card notice" id="enable">${ICO.info}<div><b>Activer les notifications</b><span>Pour être prévenu des entretiens et du contrôle technique.</span></div></div>` : '') +
    (al.length ? groups.map(([k, l]) => {
      const g = al.filter(a => a.statut === k); if (!g.length) return '';
      return `<div class="section-title">${l}</div><div class="card">${g.map(a => `<div class="due" data-car="${a.carId}"><i class="dot ${a.statut}"></i><div class="t"><b>${esc(a.titre)}</b><span>${esc(a.voiture)}</span></div><div class="r">${describe(a)}</div></div>`).join('')}</div>`;
    }).join('') : `<div class="card empty" style="margin-top:12px"><p>Rien à signaler. Ajoutez vos véhicules, la date du dernier CT et vos derniers entretiens pour voir les échéances ici.</p></div>`);
  $$('.due').forEach(el => el.onclick = () => { tab = 'garage'; $$('.tabbar button').forEach(x => x.classList.toggle('active', x.dataset.tab === 'garage')); stack = [{ v: 'garage' }, { v: 'car', id: el.dataset.car }]; render(); });
  if ($('#enable')) $('#enable').onclick = enableNotifs;
}
function describe(a) {
  const p = [];
  if (a.km !== undefined && a.km !== null) p.push(a.km <= 0 ? 'dépassé de ' + fmtKm(-a.km) : 'dans ' + fmtKm(a.km));
  if (a.date) p.push(a.jours < 0 ? 'depuis le ' + fmtDate(a.date) : a.jours === 0 ? "aujourd'hui" : 'le ' + fmtDate(a.date));
  return p.join('<br>');
}

/* ---------- Réglages ---------- */
function vSettings() {
  setTop('Réglages');
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const r = data.reglages;
  view.innerHTML = `
    <div class="section-title">Apparence</div>
    <div class="card pad"><div class="seg" id="theme">${[['auto', 'Automatique'], ['light', 'Clair'], ['dark', 'Sombre']].map(([k, l]) => `<button data-t="${k}" class="${(r.theme || 'auto') === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
    <div class="hint">« Automatique » suit le réglage clair/sombre de l'iPhone.</div>

    <div class="section-title">Notifications</div>
    <div class="card">
      <div class="row"><span class="lbl">État</span><span class="val">${perm === 'granted' ? 'Activées' : perm === 'denied' ? 'Refusées' : perm === 'unsupported' ? 'Non disponibles' : 'Désactivées'}</span></div>
      <div class="row"><label for="sj">Prévenir avant (jours)</label><select id="sj">${[7, 15, 30, 60, 90].map(n => `<option ${Number(r.seuilJours || 30) === n ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
      <div class="row"><label for="sk">Prévenir avant (km)</label><select id="sk">${[500, 1000, 2000, 3000].map(n => `<option ${Number(r.seuilKm || 1000) === n ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
    </div>
    ${perm !== 'granted' && perm !== 'unsupported' ? '<button class="btn btn-primary" style="margin-top:12px" id="en">Activer les notifications</button>' : ''}
    ${perm === 'granted' ? '<button class="btn btn-ghost" style="margin-top:12px" id="test">Envoyer une notification de test</button>' : ''}
    ${!standalone ? '<div class="hint">Sur iPhone, les notifications ne fonctionnent qu’une fois l’appli ajoutée à l’écran d’accueil (Safari › Partager › Sur l’écran d’accueil), puis ouverte depuis son icône.</div>' : ''}
    <div class="hint">Les rappels sont vérifiés à chaque ouverture de l'appli. Pour une alerte garantie même sans l'ouvrir, ajoutez aussi les rappels au calendrier.</div>

    <div class="section-title">Calendrier</div>
    <button class="btn btn-ghost" id="icsAll">Exporter tous les rappels (.ics)</button>

    <div class="section-title">Sauvegarde</div>
    <div class="hint" style="padding-top:0">Les données sont stockées uniquement sur ce téléphone. Exportez-les régulièrement.</div>
    <button class="btn btn-ghost" style="margin-top:10px" id="exp">Exporter mes données</button>
    <button class="btn btn-ghost" id="imp">Importer une sauvegarde</button>
    <input type="file" id="file" accept="application/json,.json" hidden>
    <div class="hint" style="text-align:center;margin-top:24px">Mon Garage · v1.2</div>`;
  $$('#theme button').forEach(b => b.onclick = () => { r.theme = b.dataset.t; save(); applyTheme(); render(); });
  $('#sj').onchange = e => { r.seuilJours = Number(e.target.value); save(); };
  $('#sk').onchange = e => { r.seuilKm = Number(e.target.value); save(); };
  if ($('#en')) $('#en').onclick = enableNotifs;
  if ($('#test')) $('#test').onclick = () => notify('Mon Garage', 'Les notifications fonctionnent 👍', 'test');
  $('#icsAll').onclick = () => exportICS(data.voitures);
  $('#exp').onclick = async () => {
    const ids = data.voitures.flatMap(v => [v.photoId, ...(v.ctPhotos || [])]).filter(Boolean);
    const photos = {};
    for (const id of ids) {
      const b = await Photos.get(id);
      if (b) photos[id] = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); });
    }
    shareOrDownload('mon-garage-' + C.iso(C.today()) + '.json', JSON.stringify({ ...data, photos }), 'application/json');
  };
  $('#imp').onclick = () => $('#file').click();
  $('#file').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      if (!Array.isArray(d.voitures)) throw 0;
      if (!confirm('Remplacer les données actuelles par cette sauvegarde ?')) return;
      const photos = d.photos || {}; delete d.photos;
      for (const [id, url] of Object.entries(photos)) await Photos.put(id, await (await fetch(url)).blob());
      data = { reglages: {}, entretiens: [], ...d }; save(); toast('Sauvegarde importée'); render();
    } catch (err) { toast('Fichier invalide'); }
  };
}

/* ---------- Notifications ---------- */
async function enableNotifs() {
  if (!('Notification' in window)) return toast('Ajoutez d’abord l’appli à l’écran d’accueil, puis ouvrez-la depuis son icône.');
  const p = await Notification.requestPermission();
  if (p === 'granted') { toast('Notifications activées'); registerPeriodic(); checkNotifs(true); }
  else toast('Notifications refusées — modifiable dans les réglages du téléphone');
  render();
}
async function notify(title, body, tag, carId) {
  try {
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification(title, { body, tag, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', data: { carId } });
  } catch (e) { try { new Notification(title, { body, tag }); } catch (_) {} }
}
async function getNotified() {
  try { const c = await caches.open('mongarage-data'); const r = await c.match('./__notified.json'); return r ? await r.json() : {}; } catch (e) { return {}; }
}
async function setNotified(n) {
  try { const c = await caches.open('mongarage-data'); await c.put('./__notified.json', new Response(JSON.stringify(n))); } catch (e) {}
}
// Prévient une fois par alerte, puis relance tous les 3 jours si l'échéance est dépassée.
async function checkNotifs(force) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const al = C.alertes(data).filter(a => a.statut === 'late' || a.statut === 'warn');
  const notified = await getNotified(); const now = Date.now();
  const todo = al.filter(a => { const t = notified[a.key]; return force || !t || (a.statut === 'late' && now - t > 3 * 86400000); });
  if (!todo.length) return;
  if (todo.length > 2) await notify('Mon Garage — ' + todo.length + ' rappels', todo.slice(0, 4).map(a => a.voiture + ' : ' + a.titre).join('\n'), 'resume');
  else for (const a of todo) await notify(a.voiture + ' — ' + a.titre, a.statut === 'late' ? 'Échéance dépassée' + (a.date ? ' (' + fmtDate(a.date) + ')' : '') : 'À prévoir ' + describe(a).replace('<br>', ' · '), a.key, a.carId);
  todo.forEach(a => notified[a.key] = now); setNotified(notified);
}
async function registerPeriodic() {
  try {
    const reg = await navigator.serviceWorker.ready;
    if ('periodicSync' in reg) await reg.periodicSync.register('check-entretiens', { minInterval: 12 * 3600 * 1000 });
  } catch (e) {}
}
function updateBadge() {
  const n = C.alertes(data).filter(a => a.statut === 'late' || a.statut === 'warn').length;
  const b = $('#badge'); b.hidden = !n; b.textContent = n;
  if ('setAppBadge' in navigator) (n ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => {});
}

/* ---------- Export calendrier (.ics) ---------- */
function exportICS(cars) {
  const ymd = d => C.iso(d).replace(/-/g, '');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const escI = s => String(s).replace(/[\\;,]/g, m => '\\' + m).replace(/\n/g, '\\n');
  const ev = [];
  const add = (key, date, titre, desc) => {
    const end = new Date(date); end.setDate(end.getDate() + 1);
    ev.push(['BEGIN:VEVENT', 'UID:' + key.replace(/[^a-zA-Z0-9]/g, '-') + '@mon-garage', 'DTSTAMP:' + stamp,
      'DTSTART;VALUE=DATE:' + ymd(date), 'DTEND;VALUE=DATE:' + ymd(end), 'SUMMARY:' + escI(titre), 'DESCRIPTION:' + escI(desc),
      ...[30, 7, 1].flatMap(j => ['BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + escI(titre), 'TRIGGER:-P' + j + 'DT-9H', 'END:VALARM']),
      'END:VEVENT'].join('\r\n'));
  };
  for (const c of cars) {
    const nom = C.nomVoiture(c);
    const ct = C.prochainCT(c);
    if (ct && ct >= C.today()) add(c.id + '-ct', ct, 'Contrôle technique — ' + nom, 'Prochain contrôle technique' + (c.immat ? ' (' + c.immat + ')' : ''));
    for (const e of C.echeances(c, data.entretiens, data.reglages.seuilJours, data.reglages.seuilKm)) {
      let d = e.dueDate, note = '';
      // Échéance au kilométrage : date estimée d'après la moyenne mensuelle
      if (e.restantKm !== null && Number(c.kmMois) > 0) {
        const dk = C.addMonths(C.today(), Math.max(0, Math.floor(e.restantKm / Number(c.kmMois))));
        if (!d || dk < d) { d = dk; note = ' (date estimée pour ' + fmtKm(e.dueKm) + ')'; }
      }
      if (d && d >= C.today()) add(c.id + '-' + e.type.id, d, e.type.label + ' — ' + nom, 'Entretien à prévoir' + note);
    }
    for (const p of data.entretiens.filter(x => x.carId === c.id && C.estPrevu(x))) add(p.id, C.parse(p.date), C.libelleTravaux(p) + ' — ' + nom, p.commentaire || 'Entretien planifié');
  }
  if (!ev.length) return toast('Aucune échéance datée à exporter pour l’instant');
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Mon Garage//FR', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Mon Garage', ...ev, 'END:VCALENDAR'].join('\r\n');
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'rappels-mon-garage.ics';
  document.body.appendChild(a); a.click(); a.remove();
  toast(ev.length + ' rappel' + (ev.length > 1 ? 's' : '') + ' exporté' + (ev.length > 1 ? 's' : ''));
}
async function shareOrDownload(name, content, type) {
  const file = new File([content], name, { type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = name; document.body.appendChild(a); a.click(); a.remove();
}

/* ---------- Thème clair / sombre ---------- */
function applyTheme() {
  const t = data.reglages.theme;
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
  const dark = t === 'dark' || (t !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name=theme-color]').content = dark ? '#0f1115' : '#f4f4f5';
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
applyTheme();

/* ---------- Démarrage ---------- */
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').then(() => { registerPeriodic(); checkNotifs(); }).catch(() => {});
navigator.serviceWorker && navigator.serviceWorker.addEventListener('message', e => {
  if (e.data && e.data.openCar && car(e.data.openCar)) { stack = [{ v: 'garage' }, { v: 'car', id: e.data.openCar }]; render(); }
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) { updateBadge(); checkNotifs(); } });
const q = new URLSearchParams(location.search).get('car');
if (q && car(q)) stack.push({ v: 'car', id: q });
save();
render();
