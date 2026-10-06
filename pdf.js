/* Générateur PDF intégré (sans bibliothèque externe) + mise en page du dossier véhicule. */
'use strict';

class MiniPDF {
  constructor() {
    this.W = 595.28; this.H = 841.89; this.pages = []; this.images = [];
    this.ctx = document.createElement('canvas').getContext('2d');
    this.addPage();
  }
  addPage() { this.cur = []; this.pages.push(this.cur); }
  static clean(s) {
    return String(s ?? '').replace(/[   ]/g, ' ').replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
      .replace(/…/g, '...').replace(/[–—]/g, '-').replace(/œ/g, 'oe').replace(/Œ/g, 'OE')
      .replace(/[^\x20-\x7e\xa1-\xff€\n]/g, '');
  }
  static enc(s) { // WinAnsi + échappement PDF
    return MiniPDF.clean(s).replace(/€/g, '\x80').replace(/[\\()]/g, m => '\\' + m);
  }
  static rgb(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255].map(v => v.toFixed(3)).join(' '); }
  width(s, size, bold) {
    this.ctx.font = (bold ? 'bold ' : '') + '100px Helvetica, Arial, sans-serif';
    return this.ctx.measureText(MiniPDF.clean(s)).width * size / 100;
  }
  wrap(s, maxW, size, bold) {
    const out = [];
    for (const para of MiniPDF.clean(s).split('\n')) {
      let line = '';
      for (let word of para.split(' ')) {
        while (this.width(word, size, bold) > maxW && word.length > 1) { // mot trop long : on le coupe
          let i = word.length - 1; while (i > 1 && this.width(word.slice(0, i), size, bold) > maxW) i--;
          if (line) { out.push(line); line = ''; }
          out.push(word.slice(0, i)); word = word.slice(i);
        }
        const t = line ? line + ' ' + word : word;
        if (this.width(t, size, bold) > maxW && line) { out.push(line); line = word; } else line = t;
      }
      out.push(line);
    }
    return out;
  }
  text(s, x, y, o = {}) {
    const size = o.size || 10, bold = !!o.bold;
    if (o.align === 'right') x -= this.width(s, size, bold);
    if (o.align === 'center') x -= this.width(s, size, bold) / 2;
    this.cur.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${MiniPDF.rgb(o.color || '#16181d')} rg ${x.toFixed(2)} ${(this.H - y).toFixed(2)} Td (${MiniPDF.enc(s)}) Tj ET`);
  }
  rect(x, y, w, h, fill) { this.cur.push(`${MiniPDF.rgb(fill)} rg ${x.toFixed(2)} ${(this.H - y - h).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`); }
  line(x1, y1, x2, y2, color = '#d9d9de', lw = 0.6) { this.cur.push(`${MiniPDF.rgb(color)} RG ${lw} w ${x1.toFixed(2)} ${(this.H - y1).toFixed(2)} m ${x2.toFixed(2)} ${(this.H - y2).toFixed(2)} l S`); }
  image(i, x, y, w, h) { this.cur.push(`q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${x.toFixed(2)} ${(this.H - y - h).toFixed(2)} cm /Im${i} Do Q`); }
  async addImage(blob) {
    let buf = new Uint8Array(await blob.arrayBuffer());
    const url = URL.createObjectURL(blob);
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    if (!(buf[0] === 0xff && buf[1] === 0xd8)) { // pas un JPEG : conversion
      const cv = document.createElement('canvas'); cv.width = img.naturalWidth; cv.height = img.naturalHeight;
      const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(img, 0, 0);
      buf = new Uint8Array(await (await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.85))).arrayBuffer());
    }
    URL.revokeObjectURL(url);
    let bin = ''; for (let i = 0; i < buf.length; i += 8192) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 8192));
    this.images.push({ bin, w: img.naturalWidth, h: img.naturalHeight });
    return this.images.length - 1;
  }
  build() {
    const objs = [], base = 5 + this.images.length;
    const kids = this.pages.map((_, i) => `${base + 2 * i} 0 R`).join(' ');
    const xobj = this.images.map((_, i) => `/Im${i} ${5 + i} 0 R`).join(' ');
    objs.push('<< /Type /Catalog /Pages 2 0 R >>');
    objs.push(`<< /Type /Pages /Kids [${kids}] /Count ${this.pages.length} >>`);
    objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    for (const im of this.images) objs.push(`<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.bin.length} >>\nstream\n${im.bin}\nendstream`);
    this.pages.forEach((ops, i) => {
      const s = ops.join('\n');
      objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${this.W} ${this.H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> /XObject << ${xobj} >> >> /Contents ${base + 2 * i + 1} 0 R >>`);
      objs.push(`<< /Length ${s.length} >>\nstream\n${s}\nendstream`);
    });
    let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n'; const off = [];
    objs.forEach((o, i) => { off.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const xref = out.length;
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + off.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
    out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    const bytes = new Uint8Array(out.length);
    for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
    return new Blob([bytes], { type: 'application/pdf' });
  }
}

/* ---------- Dossier du véhicule ---------- */
async function buildPDF(c) {
  const C = window.Core, pdf = new MiniPDF();
  const M = 40, W = pdf.W - 2 * M, ORANGE = '#ec5f2a', GREY = '#6b6f78', LIGHT = '#f4f4f5';
  const nom = [c.marque, c.modele].filter(Boolean).join(' ') || C.nomVoiture(c);
  let y = 0;
  const ensure = h => { if (y + h > pdf.H - 55) { pdf.addPage(); y = 50; } };
  const section = t => { ensure(60); y += 26; pdf.text(t, M, y, { size: 14, bold: true }); pdf.rect(M, y + 6, 36, 2.5, ORANGE); y += 22; };
  // Encart « libellé : valeur » sur deux colonnes
  const pairs = list => {
    list = list.filter(p => p[1] !== '' && p[1] !== undefined && p[1] !== null);
    if (!list.length) return;
    const rows = Math.ceil(list.length / 2), h = rows * 20 + 14;
    ensure(h); pdf.rect(M, y, W, h, LIGHT);
    list.forEach((p, i) => {
      const col = i < rows ? 0 : 1, r = col ? i - rows : i, x = M + 14 + col * (W / 2), yy = y + 21 + r * 20;
      pdf.text(p[0], x, yy, { size: 9, color: GREY });
      pdf.text(pdf.wrap(String(p[1]), W / 2 - 130, 10, true)[0], x + 108, yy, { size: 10, bold: true });
    });
    y += h;
  };
  // Tableau avec retour à la ligne, zébrures et en-tête répété
  const table = (cols, rows, opts = {}) => {
    const xs = []; let x = M; cols.forEach(col => { xs.push(x); x += col.w; });
    const head = () => {
      pdf.rect(M, y, W, 20, '#16181d');
      cols.forEach((col, i) => pdf.text(col.t, col.right ? xs[i] + col.w - 6 : xs[i] + 6, y + 13.5, { size: 8.5, bold: true, color: '#ffffff', align: col.right ? 'right' : 'left' }));
      y += 20;
    };
    ensure(50); head();
    rows.forEach((row, ri) => {
      const bold = opts.lastBold && ri === rows.length - 1;
      const cells = row.map((v, i) => pdf.wrap(v, cols[i].w - 12, 9, bold));
      const h = Math.max(...cells.map(l => l.length)) * 12 + 10;
      if (y + h > pdf.H - 55) { pdf.addPage(); y = 50; head(); }
      if (bold) pdf.rect(M, y, W, h, '#fde5da'); else if (ri % 2) pdf.rect(M, y, W, h, LIGHT);
      cells.forEach((lines, i) => lines.forEach((l, li) => pdf.text(l, cols[i].right ? xs[i] + cols[i].w - 6 : xs[i] + 6, y + 14 + li * 12, { size: 9, bold, align: cols[i].right ? 'right' : 'left' })));
      y += h; pdf.line(M, y, M + W, y);
    });
  };

  /* En-tête */
  pdf.rect(0, 0, pdf.W, 78, ORANGE);
  pdf.text("DOSSIER D'ENTRETIEN", M, 30, { size: 10, bold: true, color: '#ffffff' });
  pdf.text(nom, M, 58, { size: 24, bold: true, color: '#ffffff' });
  pdf.text('Édité le ' + fmtDate(C.today()), pdf.W - M, 30, { size: 10, color: '#ffffff', align: 'right' });
  if (c.surnom) pdf.text('« ' + c.surnom + ' »', pdf.W - M, 58, { size: 12, color: '#ffffff', align: 'right' });
  y = 98;

  /* Photo + identité */
  const photo = c.photoId && await Photos.get(c.photoId);
  let ix = M;
  if (photo) { try { const i = await pdf.addImage(photo); pdf.image(i, M, y, 200, 125); ix = M + 220; } catch (e) {} }
  const ident = [['Immatriculation', c.immat], ['VIN', c.vin], ['Kilométrage', c.km ? fmtKm(C.kmEstime(c)) + (C.kmEstime(c) !== Number(c.km) ? ' (estimé)' : '') : ''],
    ['1re mise en circulation', fmtDate(c.dateMiseCirc)], ["Date d'achat", fmtDate(c.dateAchat)]].filter(p => p[1]);
  let iy = y + 14;
  ident.forEach(p => { pdf.text(p[0], ix, iy, { size: 9, color: GREY }); pdf.text(String(p[1]), ix, iy + 14, { size: 12, bold: true }); iy += 34; });
  y = Math.max(photo ? y + 125 : y, iy - 14);

  /* Caractéristiques */
  section('Caractéristiques');
  pairs([['Marque', c.marque], ['Modèle', c.modele], ['Année', c.annee], ['Carrosserie', c.carrosserie], ['Carburant', c.carburant], ['Usage', c.usage],
    ['Transmission', c.transmission], ['Boîte de vitesses', c.boite], ['Puissance', c.puissance ? c.puissance + ' ch' : ''], ['Cylindrée', c.cylindree ? c.cylindree + ' cm3' : ''],
    ['Code moteur', c.codeMoteur], ['Cylindres', c.cylindres]]);

  /* Contrôle technique */
  section('Contrôle technique');
  const ct = C.prochainCT(c), j = ct ? C.daysBetween(C.today(), ct) : null, nPV = (c.ctPhotos || []).length;
  const ctList = [['Dernier contrôle', fmtDate(c.ctDernier)], ['Prochain contrôle', ct ? fmtDate(ct) + (c.ctProchain ? '' : ' (calculé)') : ''],
    ['Échéance', j === null ? '' : j < 0 ? 'Dépassé depuis ' + (-j) + ' jours' : 'Dans ' + j + ' jours'], ['Procès-verbal', nPV ? nPV + ' photo' + (nPV > 1 ? 's' : '') + ' en annexe' : '']];
  if (ctList.some(p => p[1])) pairs(ctList); else { pdf.text('Aucune date de contrôle technique renseignée.', M, y + 4, { size: 10, color: GREY }); y += 10; }

  /* Entretiens */
  const all = data.entretiens.filter(e => e.carId === c.id).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const faits = all.filter(e => !C.estPrevu(e)), prevus = all.filter(e => C.estPrevu(e)).reverse();
  const cols = [{ t: 'DATE', w: 62 }, { t: 'KILOMÉTRAGE', w: 78, right: true }, { t: 'TRAVAUX RÉALISÉS', w: W - 62 - 78 - 105 - 70 }, { t: 'GARAGE / LIEU', w: 105 }, { t: 'COÛT', w: 70, right: true }];
  const ligne = e => [fmtDate(e.date), e.km ? fmtKm(e.km) : '-', C.libelleTravaux(e) + (e.commentaire ? '\nNote : ' + e.commentaire : ''), e.lieu || '-', e.cout ? fmtEur(e.cout) : '-'];
  section('Entretiens réalisés (' + faits.length + ')');
  if (faits.length) {
    const total = faits.reduce((s, e) => s + (Number(e.cout) || 0), 0);
    const rows = faits.map(ligne); if (total) rows.push(['', '', 'Total des dépenses', '', fmtEur(total)]);
    table(cols, rows, { lastBold: !!total });
  } else { pdf.text('Aucun entretien enregistré.', M, y + 4, { size: 10, color: GREY }); y += 10; }
  if (prevus.length) { section('Entretiens planifiés (' + prevus.length + ')'); cols[2].t = 'TRAVAUX PRÉVUS'; table(cols, prevus.map(ligne)); }

  /* Prochaines échéances */
  const ech = C.echeances(c, data.entretiens, data.reglages.seuilJours, data.reglages.seuilKm).filter(e => e.statut !== 'none');
  if (ech.length) {
    const rang = { late: 0, warn: 1, ok: 2 }; ech.sort((a, b) => rang[a.statut] - rang[b.statut]);
    section('Prochaines échéances');
    table([{ t: 'TRAVAIL', w: 170 }, { t: 'DERNIER FAIT', w: 130 }, { t: 'PROCHAINE ÉCHÉANCE', w: W - 170 - 130 - 70 }, { t: 'ÉTAT', w: 70 }],
      ech.map(e => [e.type.label, fmtDate(e.dernier.date) + (e.dernier.km ? ' - ' + fmtKm(e.dernier.km) : ''),
        [e.dueKm ? 'à ' + fmtKm(e.dueKm) : '', e.dueDate ? 'le ' + fmtDate(e.dueDate) : ''].filter(Boolean).join(' ou '),
        { late: 'En retard', warn: 'Bientôt', ok: 'OK' }[e.statut]]));
  }

  /* Annexes : photos du procès-verbal */
  let n = 0;
  for (const pid of c.ctPhotos || []) {
    const b = await Photos.get(pid); if (!b) continue;
    try {
      const i = await pdf.addImage(b), im = pdf.images[i]; n++;
      pdf.addPage();
      pdf.text('Annexe - Procès-verbal du contrôle technique (' + n + '/' + nPV + ')', M, 50, { size: 13, bold: true });
      const maxW = W, maxH = pdf.H - 70 - 60, k = Math.min(maxW / im.w, maxH / im.h);
      pdf.image(i, M + (maxW - im.w * k) / 2, 70, im.w * k, im.h * k);
    } catch (e) {}
  }

  /* Pied de page */
  const pages = pdf.pages;
  pages.forEach((p, i) => {
    pdf.cur = p;
    pdf.line(M, pdf.H - 38, pdf.W - M, pdf.H - 38);
    pdf.text('Mon Garage - ' + [nom, c.immat].filter(Boolean).join(' - '), M, pdf.H - 24, { size: 8, color: GREY });
    pdf.text('Page ' + (i + 1) + ' / ' + pages.length, pdf.W - M, pdf.H - 24, { size: 8, color: GREY, align: 'right' });
  });
  return pdf.build();
}
