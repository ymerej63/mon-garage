/* Logique partagée entre l'appli et le service worker (calcul des échéances). */
(function (root) {
  const DAY = 86400000;

  // Travaux d'entretien : intervalle par défaut (km, mois). 0 = pas de critère.
  const TRAVAUX = [
    { id: 'vidange',        label: 'Vidange huile moteur',        km: 15000, mois: 12, actif: true },
    { id: 'filtre_huile',   label: 'Filtre à huile',              km: 15000, mois: 12, actif: true },
    { id: 'filtre_air',     label: 'Filtre à air',                km: 30000, mois: 24, actif: true },
    { id: 'filtre_habit',   label: 'Filtre d’habitacle',     km: 15000, mois: 12, actif: true },
    { id: 'filtre_carbu',   label: 'Filtre à carburant',          km: 60000, mois: 48, actif: false },
    { id: 'bougies',        label: 'Bougies d’allumage',      km: 60000, mois: 48, actif: true },
    { id: 'distribution',   label: 'Kit distribution + pompe à eau', km: 120000, mois: 60, actif: true },
    { id: 'accessoires',    label: 'Courroie d’accessoires',  km: 120000, mois: 60, actif: false },
    { id: 'liquide_frein',  label: 'Liquide de frein',            km: 0,     mois: 24, actif: true },
    { id: 'refroid',        label: 'Liquide de refroidissement',  km: 60000, mois: 48, actif: true },
    { id: 'huile_boite',    label: 'Huile de boîte',              km: 60000, mois: 48, actif: false },
    { id: 'plaq_av',        label: 'Plaquettes avant',            km: 30000, mois: 0,  actif: true },
    { id: 'disques_av',     label: 'Disques avant',               km: 60000, mois: 0,  actif: false },
    { id: 'plaq_ar',        label: 'Plaquettes / mâchoires arrière', km: 50000, mois: 0, actif: false },
    { id: 'pneus_av',       label: 'Pneus avant',                 km: 40000, mois: 60, actif: false },
    { id: 'pneus_ar',       label: 'Pneus arrière',               km: 50000, mois: 60, actif: false },
    { id: 'geometrie',      label: 'Géométrie / parallélisme',    km: 30000, mois: 24, actif: false },
    { id: 'amortisseurs',   label: 'Amortisseurs',                km: 80000, mois: 0,  actif: false },
    { id: 'batterie',       label: 'Batterie',                    km: 0,     mois: 60, actif: false },
    { id: 'clim',           label: 'Recharge climatisation',      km: 0,     mois: 24, actif: false },
    { id: 'essuie',         label: 'Balais d’essuie-glace',   km: 0,     mois: 12, actif: false },
    { id: 'revision',       label: 'Révision complète',           km: 30000, mois: 24, actif: false },
    { id: 'autre',          label: 'Autre intervention',          km: 0,     mois: 0,  actif: false }
  ];
  const TRAVAUX_BY_ID = Object.fromEntries(TRAVAUX.map(t => [t.id, t]));

  function today() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
  function parse(s) { if (!s) return null; const d = new Date(s + 'T00:00:00'); return isNaN(d) ? null : d; }
  function iso(d) { const z = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate()); }
  function addMonths(d, m) { const r = new Date(d); r.setMonth(r.getMonth() + m); return r; }
  function daysBetween(a, b) { return Math.round((b - a) / DAY); }

  // Kilométrage estimé aujourd'hui à partir du dernier relevé et de la moyenne mensuelle.
  function kmEstime(car) {
    const base = Number(car.km) || 0;
    const moy = Number(car.kmMois) || 0;
    const d = parse(car.kmDate);
    if (!d || !moy) return base;
    const mois = Math.max(0, daysBetween(d, today()) / 30.44);
    return Math.round(base + moy * mois);
  }

  function plan(car) {
    return TRAVAUX.filter(t => t.id !== 'autre').map(t => {
      const p = (car.plan && car.plan[t.id]) || {};
      return {
        ...t,
        km: p.km !== undefined ? Number(p.km) : t.km,
        mois: p.mois !== undefined ? Number(p.mois) : t.mois,
        actif: p.actif !== undefined ? !!p.actif : t.actif
      };
    });
  }

  // Prochain contrôle technique : date saisie, sinon dernier CT + 2 ans, sinon 1re mise en circulation + 4 ans.
  function prochainCT(car) {
    if (car.ctProchain) return parse(car.ctProchain);
    if (car.ctDernier) return addMonths(parse(car.ctDernier), 24);
    if (car.dateMiseCirc) return addMonths(parse(car.dateMiseCirc), 48);
    return null;
  }

  function statutDate(d, seuilJours) {
    if (!d) return 'none';
    const j = daysBetween(today(), d);
    if (j < 0) return 'late';
    if (j <= seuilJours) return 'warn';
    return 'ok';
  }

  // Échéance de chaque travail actif pour un véhicule.
  function echeances(car, entretiens, seuilJours = 30, seuilKm = 1000) {
    const km = kmEstime(car);
    const faits = entretiens.filter(e => e.carId === car.id && !estPrevu(e))
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    return plan(car).filter(t => t.actif && (t.km || t.mois)).map(t => {
      const dernier = faits.find(e => (e.travaux || []).includes(t.id));
      const res = { type: t, dernier, dueKm: null, dueDate: null, statut: 'none', restantKm: null, restantJours: null };
      if (!dernier) return res;
      if (t.km && dernier.km) { res.dueKm = Number(dernier.km) + t.km; res.restantKm = res.dueKm - km; }
      if (t.mois && dernier.date) { res.dueDate = addMonths(parse(dernier.date), t.mois); res.restantJours = daysBetween(today(), res.dueDate); }
      const late = (res.restantKm !== null && res.restantKm <= 0) || (res.restantJours !== null && res.restantJours < 0);
      const warn = (res.restantKm !== null && res.restantKm <= seuilKm) || (res.restantJours !== null && res.restantJours <= seuilJours);
      res.statut = late ? 'late' : warn ? 'warn' : (res.dueKm || res.dueDate) ? 'ok' : 'none';
      return res;
    });
  }

  function estPrevu(e) { const d = parse(e.date); return !!d && d > today(); }

  // Liste des alertes (pour badge, onglet « À venir » et notifications).
  function alertes(data) {
    const s = data.reglages || {};
    const seuilJ = Number(s.seuilJours) || 30, seuilKm = Number(s.seuilKm) || 1000;
    const out = [];
    for (const car of data.voitures || []) {
      const nom = nomVoiture(car);
      const ct = prochainCT(car);
      if (ct) {
        const st = statutDate(ct, Math.max(seuilJ, 30));
        out.push({ key: car.id + ':ct:' + iso(ct), carId: car.id, voiture: nom, titre: 'Contrôle technique', statut: st, date: ct, jours: daysBetween(today(), ct), kind: 'ct' });
      }
      for (const e of echeances(car, data.entretiens || [], seuilJ, seuilKm)) {
        if (e.statut === 'none') continue;
        out.push({ key: car.id + ':' + e.type.id + ':' + (e.dueKm || '') + ':' + (e.dueDate ? iso(e.dueDate) : ''), carId: car.id, voiture: nom, titre: e.type.label, statut: e.statut, date: e.dueDate, jours: e.restantJours, km: e.restantKm, dueKm: e.dueKm, kind: 'entretien' });
      }
      for (const p of (data.entretiens || []).filter(x => x.carId === car.id && estPrevu(x))) {
        const d = parse(p.date);
        out.push({ key: car.id + ':prevu:' + p.id, carId: car.id, entId: p.id, voiture: nom, titre: libelleTravaux(p) + ' (prévu)', statut: statutDate(d, 7) === 'warn' ? 'warn' : 'ok', date: d, jours: daysBetween(today(), d), kind: 'prevu' });
      }
    }
    const rang = { late: 0, warn: 1, ok: 2, none: 3 };
    return out.sort((a, b) => rang[a.statut] - rang[b.statut] || (a.jours ?? 99999) - (b.jours ?? 99999));
  }

  function nomVoiture(car) {
    return car.surnom || [car.marque, car.modele].filter(Boolean).join(' ') || 'Véhicule';
  }
  function libelleTravaux(e) {
    const l = (e.travaux || []).map(id => id === 'autre' && e.autre ? e.autre : (TRAVAUX_BY_ID[id] || {}).label).filter(Boolean);
    return l.length ? l.join(', ') : 'Entretien';
  }

  root.Core = { TRAVAUX, TRAVAUX_BY_ID, today, parse, iso, addMonths, daysBetween, kmEstime, plan, prochainCT, statutDate, echeances, estPrevu, alertes, nomVoiture, libelleTravaux };
})(typeof self !== 'undefined' ? self : window);
