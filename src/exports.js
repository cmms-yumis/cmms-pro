'use strict';
const fs = require('fs');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

// ---------- Excel ----------
async function sendExcel(res, filename, sheetName, columns, rows) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'CMMS PRO';
  wb.created = new Date();
  const ws = wb.addWorksheet(sheetName);
  ws.columns = columns.map(c => ({ header: c.header, key: c.key, width: c.width || 18 }));
  rows.forEach(r => ws.addRow(r));
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: 'FF15191E' } };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC400' } };
  head.alignment = { vertical: 'middle' };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  if (rows.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  await wb.xlsx.write(res);
  res.end();
}

// ---------- PDF ----------
// Standardni PDF fontovi ne sadrze c, c, dj, s, z pravilno, pa trazimo TTF font na racunaru.
const FONT_CANDIDATES = [
  ['C:\\Windows\\Fonts\\segoeui.ttf', 'C:\\Windows\\Fonts\\segoeuib.ttf'],
  ['C:\\Windows\\Fonts\\arial.ttf', 'C:\\Windows\\Fonts\\arialbd.ttf'],
  ['C:\\Windows\\Fonts\\calibri.ttf', 'C:\\Windows\\Fonts\\calibrib.ttf'],
  ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'],
  ['/System/Library/Fonts/Supplemental/Arial.ttf', '/System/Library/Fonts/Supplemental/Arial Bold.ttf']
];
let fonts;
function pickFonts() {
  if (fonts !== undefined) return fonts;
  fonts = null;
  for (const [r, b] of FONT_CANDIDATES) if (fs.existsSync(r) && fs.existsSync(b)) { fonts = { regular: r, bold: b }; break; }
  return fonts;
}
const MAP = { 'č': 'c', 'ć': 'c', 'š': 's', 'ž': 'z', 'đ': 'dj', 'Č': 'C', 'Ć': 'C', 'Š': 'S', 'Ž': 'Z', 'Đ': 'Dj' };
const plain = s => String(s == null ? '' : s).replace(/[čćšžđČĆŠŽĐ]/g, c => MAP[c]);

const STATUS_LABEL = { OTVOREN: 'Otvoren', U_TOKU: 'U toku', CEKA_DEO: 'Čeka deo', ZAVRSEN: 'Završen' };
const fmt = iso => {
  if (!iso) return '-';
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) || iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  return isNaN(d) ? String(iso) : d.toLocaleString('sr-RS', { dateStyle: 'short', timeStyle: 'short' });
};

function sendWorkorderPdf(res, wo, parts, company) {
  const f = pickFonts();
  const T = s => (f ? String(s == null ? '' : s) : plain(s));
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${wo.number}.pdf"`);
  doc.pipe(res);
  if (f) { doc.registerFont('R', f.regular); doc.registerFont('B', f.bold); } else { doc.registerFont('R', 'Helvetica'); doc.registerFont('B', 'Helvetica-Bold'); }

  doc.rect(40, 40, 515, 8).fill('#FFC400');
  doc.fillColor('#15191E').font('B').fontSize(20).text(T('Radni nalog ' + wo.number), 40, 62);
  doc.font('R').fontSize(10).fillColor('#555').text(T(company || 'CMMS PRO'), 40, 88);
  doc.moveDown(1.2);

  const rows = [
    ['Mašina', `${wo.machine_code || '-'}  ${wo.machine_name || ''}`], ['Lokacija', wo.machine_location || '-'],
    ['Status', STATUS_LABEL[wo.status] || wo.status], ['Prioritet', wo.priority],
    ['Vrsta', wo.type], ['Zaduženi majstor', wo.worker_name || '-'],
    ['Otvoren', fmt(wo.created_at)], ['Početak rada', fmt(wo.started_at)], ['Zatvoren', fmt(wo.closed_at)],
    ['Utrošeno vreme', (wo.labor_minutes || 0) + ' min']
  ];
  let y = doc.y;
  rows.forEach(([k, v]) => {
    doc.font('B').fontSize(10).fillColor('#15191E').text(T(k), 40, y, { width: 130 });
    doc.font('R').text(T(v), 175, y, { width: 380 });
    y += 17;
  });

  y += 8;
  doc.font('B').fontSize(12).text(T('Opis kvara / posla'), 40, y);
  doc.font('R').fontSize(10).text(T(wo.description || '-'), 40, doc.y + 3, { width: 515 });
  if (wo.resolution) {
    doc.moveDown(0.8).font('B').fontSize(12).text(T('Izvršeni rad'), 40);
    doc.font('R').fontSize(10).text(T(wo.resolution), 40, doc.y + 3, { width: 515 });
  }

  doc.moveDown(1).font('B').fontSize(12).text(T('Utrošeni delovi'), 40);
  let total = 0;
  y = doc.y + 4;
  doc.font('B').fontSize(9).text(T('Šifra'), 40, y).text(T('Naziv'), 110, y).text(T('Količina'), 330, y).text(T('Cena'), 400, y).text(T('Iznos'), 480, y);
  y += 15;
  doc.font('R');
  parts.forEach(p => {
    const sum = (p.quantity || 0) * (p.price || 0);
    total += sum;
    doc.text(T(p.code || ''), 40, y, { width: 65 }).text(T(p.name || ''), 110, y, { width: 215 })
      .text(`${p.quantity} ${T(p.unit || '')}`, 330, y).text((p.price || 0).toFixed(2), 400, y).text(sum.toFixed(2), 480, y);
    y += 15;
  });
  if (!parts.length) { doc.text(T('Nema utrošenih delova'), 40, y); y += 15; }
  doc.font('B').text(T('Ukupno delovi: ') + total.toFixed(2) + ' din', 40, y + 6);

  const sy = Math.max(doc.y + 50, 690);
  doc.moveTo(40, sy).lineTo(230, sy).moveTo(325, sy).lineTo(555, sy).strokeColor('#999').stroke();
  doc.font('R').fontSize(9).fillColor('#555').text(T('Izvršilac'), 40, sy + 4).text(T('Odgovorno lice'), 325, sy + 4);
  doc.end();
}

module.exports = { sendExcel, sendWorkorderPdf, STATUS_LABEL, fmt };
