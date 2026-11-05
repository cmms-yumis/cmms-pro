'use strict';
/* ===== Stampa: otvara pregled u novom prozoru i poziva print ===== */

const PRINT_CSS = `
  @page{size:A4;margin:14mm}
  *{box-sizing:border-box}
  body{font-family:"Segoe UI",Arial,sans-serif;color:#0f172a;font-size:12px;margin:0}
  .head{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:3px solid #2563eb;padding-bottom:8px;margin-bottom:14px}
  .head h1{font-size:19px;margin:0}.head small{color:#64748b;display:block;margin-top:3px}
  h2{font-size:14px;margin:18px 0 6px;padding-bottom:4px;border-bottom:1px solid #cbd5e1}
  h3{font-size:12.5px;margin:12px 0 4px}
  table{width:100%;border-collapse:collapse;margin-bottom:6px}
  th,td{border:1px solid #cbd5e1;padding:5px 7px;text-align:left;vertical-align:top}
  th{background:#f1f5f9;font-size:10.5px;text-transform:uppercase}
  .kv{display:grid;grid-template-columns:150px 1fr;gap:4px 12px;margin-bottom:8px}.kv b{color:#475569}
  .box{border:1px solid #cbd5e1;border-radius:6px;padding:8px 10px;min-height:46px;white-space:pre-wrap}
  .sig{display:flex;gap:60px;margin-top:60px}.sig div{flex:1;border-top:1px solid #64748b;padding-top:4px;color:#475569;font-size:11px}
  .tag{display:inline-block;padding:1px 7px;border-radius:99px;background:#e2e8f0;font-weight:700;font-size:10.5px}
  .red{color:#b91c1c;font-weight:700}.sum{font-weight:700;background:#f8fafc}
  .brk{page-break-before:always}
  .noprint{margin:0 0 14px;padding:10px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px}
  @media print{.noprint{display:none}}
`;

function printDoc(title, bodyTpl) {
  const company = (App.info && App.info.company) || 'CMMS Pro';
  const body = bodyTpl.__raw !== undefined ? bodyTpl.__raw : bodyTpl;
  const page = bar => `<!DOCTYPE html><html lang="sr"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${PRINT_CSS}</style></head><body>
    ${bar ? '<div class="noprint">Pregled za štampu. <button id="pb-print">Štampaj</button> <button id="pb-close">Zatvori</button></div>' : ''}
    <div class="head"><div><h1>${esc(title)}</h1><small>${esc(company)}</small></div><small>Štampano: ${esc(fDT(new Date().toISOString()))}</small></div>
    ${body}</body></html>`;

  // Android aplikacija: koristi sistemski dijalog za stampu (moze i "Sacuvaj kao PDF")
  if (window.AndroidApp && window.AndroidApp.printHtml) { window.AndroidApp.printHtml(title, page(false)); return; }

  const w = window.open('', '_blank');
  if (!w) { toast('Pregledač je blokirao novi prozor - dozvolite iskačuće prozore za ovu stranicu.', 'err'); return; }
  w.document.write(page(true));
  w.document.close();
  const b1 = w.document.getElementById('pb-print'), b2 = w.document.getElementById('pb-close');
  if (b1) b1.addEventListener('click', () => w.print());
  if (b2) b2.addEventListener('click', () => w.close());
  w.focus();
  setTimeout(() => { try { w.print(); } catch (_) {} }, 350);
}

const woRow = w => html`<tr><td class="nw"><b>${w.number}</b><br>${fDT(w.created_at)}</td><td>${w.machine_code || ''} ${w.machine_name || ''}</td>
  <td>${TYPE[w.type] || w.type}<br><span class="tag">${PRIO[w.priority] || w.priority}</span></td>
  <td style="max-width:240px;white-space:pre-wrap">${w.description}${w.resolution ? html`<br><b>Izvršeno:</b> ${w.resolution}` : ''}</td>
  <td>${w.worker_name || '-'}</td><td>${STATUS[w.status] || w.status}${w.status === 'ZAVRSEN' ? html`<br>${fDT(w.closed_at)}` : ''}</td>
  <td class="nw">${w.downtime_min ? fMin(w.downtime_min) : '-'}</td></tr>`;
const woHead = html`<thead><tr><th>Nalog / Vreme</th><th>Mašina</th><th>Tip / Prioritet</th><th>Opis</th><th>Majstor</th><th>Status</th><th>Zastoj</th></tr></thead>`;

async function printJobCard(id) {
  try {
    const w = await GET('/api/workorders/' + id);
    const total = w.parts.reduce((s, p) => s + p.quantity * p.price, 0);
    printDoc('Radni nalog ' + w.number, html`
      <div class="kv"><b>Mašina</b><span>${w.machine_code} - ${w.machine_name}${w.machine_location ? ' (' + w.machine_location + ')' : ''}</span>
        <b>Tip održavanja</b><span>${TYPE[w.type] || w.type}</span><b>Prioritet</b><span>${PRIO[w.priority] || w.priority}</span>
        <b>Status</b><span>${STATUS[w.status] || w.status}</span><b>Otvoren</b><span>${fDT(w.created_at)}</span>
        <b>Prijavio</b><span>${w.operator_name || w.creator_name || '-'}</span><b>Zaduženi serviser</b><span>${w.worker_name || '-'}</span>
        ${w.status === 'ZAVRSEN' ? html`<b>Završeno</b><span>${fDT(w.closed_at)}</span><b>Zastoj mašine</b><span>${fMin(w.downtime_min)}</span>` : ''}</div>
      <h2>Opis problema / zadatka</h2><div class="box">${w.description}</div>
      <h2>Izvedeni radovi</h2><div class="box" style="min-height:90px">${w.resolution || ''}</div>
      <h2>Ugrađeni delovi</h2>
      <table><thead><tr><th>Šifra</th><th>Naziv</th><th>Količina</th><th>Cena</th><th>Iznos</th></tr></thead><tbody>
        ${w.parts.length ? w.parts.map(p => html`<tr><td>${p.code}</td><td>${p.name}</td><td>${fNum(p.quantity)} ${p.unit}</td><td>${fMoney(p.price)}</td><td>${fMoney(p.quantity * p.price)}</td></tr>`)
          : html`<tr><td colspan="5">Nema ugrađenih delova</td></tr>`}
        <tr class="sum"><td colspan="4">Ukupno delovi</td><td>${fMoney(total)}</td></tr></tbody></table>
      <div class="sig"><div>Izvršilac (serviser)</div><div>Odgovorno lice / primopredaja</div></div>`);
  } catch (e) { fail(e); }
}

function printMachineCard(machineId) {
  const m = byId(App.d.machines, machineId);
  if (!m) return toast('Izaberite mašinu', 'err');
  const all = App.d.workorders.filter(w => w.machine_id === m.id);
  const kv = all.filter(w => w.type === 'KVAR'), other = all.filter(w => w.type !== 'KVAR');
  const down = all.reduce((s, w) => s + (w.downtime_min || 0), 0);
  const plans = App.d.preventive.filter(p => p.machine_id === m.id);
  const sect = (t, list) => html`<h2>${t} (${list.length})</h2>${list.length ? html`<table>${woHead}<tbody>${list.map(woRow)}</tbody></table>` : html`<p>Nema evidentiranih naloga.</p>`}`;
  printDoc('Karta mašine: ' + m.code, html`
    <div class="kv"><b>Naziv</b><span>${m.name}</span><b>Proizvođač / model</b><span>${[m.manufacturer, m.model].filter(Boolean).join(' ') || '-'}</span>
      <b>Serijski broj</b><span>${m.serial_number || '-'}</span><b>Lokacija</b><span>${m.location || '-'}</span>
      <b>Ukupan zastoj</b><span class="red">${fMin(down)}</span><b>Broj kvarova</b><span>${kv.length}</span></div>
    ${sect('Kvarovi (korektivno održavanje)', kv)}${sect('Preventivno održavanje i inspekcije', other)}
    <h2>Planovi preventive (${plans.length})</h2>
    ${plans.length ? html`<table><thead><tr><th>Aktivnost</th><th>Period</th><th>Sledeći rok</th><th>Poslednje urađeno</th><th>Serviser</th></tr></thead><tbody>
      ${plans.map(p => html`<tr><td>${p.title}</td><td>${PERIOD[p.period_type] || p.period_type}</td><td>${fDate(p.next_date)}</td><td>${p.last_date ? fDate(p.last_date) : '-'}</td><td>${p.worker_name || '-'}</td></tr>`)}</tbody></table>` : html`<p>Nema planova.</p>`}`);
}

function printPerWorker(workerId) {
  const workers = workerId ? App.d.workers.filter(w => String(w.id) === String(workerId)) : App.d.workers;
  const groups = workers.map(wk => ({ wk, list: App.d.workorders.filter(w => w.worker_id === wk.id) })).filter(g => g.list.length);
  const un = workerId ? [] : App.d.workorders.filter(w => !w.worker_id);
  if (!groups.length && !un.length) return toast('Nema naloga za štampu', 'err');
  printDoc('Zbirni radni nalozi po serviseru', html`
    ${groups.map((g, i) => html`<div class="${i ? 'brk' : ''}"><h2>${g.wk.fullname} <small>(${g.list.filter(w => w.status !== 'ZAVRSEN').length} otvorenih / ${g.list.length} ukupno)</small></h2>
      <table>${woHead}<tbody>${g.list.map(woRow)}</tbody></table></div>`)}
    ${un.length ? html`<div class="brk"><h2>Bez zaduženog servisera</h2><table>${woHead}<tbody>${un.map(woRow)}</tbody></table></div>` : ''}`);
}

function printPerOperator(operatorId) {
  const ops = operatorId ? App.d.operators.filter(o => String(o.id) === String(operatorId)) : App.d.operators;
  const groups = ops.map(o => ({ name: o.name, list: App.d.workorders.filter(w => w.operator_id === o.id) })).filter(g => g.list.length);
  const none = operatorId ? [] : App.d.workorders.filter(w => !w.operator_id);
  if (!groups.length && !none.length) return toast('Nema prijavljenih kvarova za štampu', 'err');
  const down = l => l.reduce((s, w) => s + (w.downtime_min || 0), 0);
  const kv = l => l.filter(w => w.type === 'KVAR').length;
  const all = none.length ? [...groups, { name: 'Operater nije naveden', list: none }] : groups;
  const sect = (g, i) => html`<div class="${i ? 'brk' : ''}"><h2>${g.name} <small>(prijava: ${g.list.length}, kvarova: ${kv(g.list)}, otvorenih: ${g.list.filter(w => w.status !== 'ZAVRSEN').length}, zastoj: ${fMin(down(g.list))})</small></h2>
    <table>${woHead}<tbody>${g.list.map(woRow)}</tbody></table></div>`;
  printDoc('Kvarovi po operaterima proizvodnje', html`
    ${!operatorId ? html`<h2>Pregled po operaterima</h2><table><thead><tr><th>Operater</th><th>Ukupno prijava</th><th>Kvarova</th><th>Otvorenih</th><th>Ukupan zastoj</th></tr></thead><tbody>
      ${all.map(g => html`<tr><td><b>${g.name}</b></td><td>${g.list.length}</td><td>${kv(g.list)}</td><td>${g.list.filter(w => w.status !== 'ZAVRSEN').length}</td><td>${fMin(down(g.list))}</td></tr>`)}</tbody></table>` : ''}
    ${all.map((g, i) => sect(g, operatorId ? 0 : i + 1))}`);
}

function printPreventive() {
  const ms = App.d.machines.filter(m => App.d.preventive.some(p => p.machine_id === m.id));
  if (!ms.length) return toast('Nema preventivnih planova', 'err');
  printDoc('Planovi preventivnog održavanja po mašinama', html`${ms.map(m => html`<h2>${m.code} - ${m.name}</h2>
    <table><thead><tr><th>Aktivnost</th><th>Period</th><th>Sledeći rok</th><th>Poslednje urađeno</th><th>Serviser</th><th>Status</th></tr></thead><tbody>
    ${App.d.preventive.filter(p => p.machine_id === m.id).map(p => { const d = daysFrom(p.next_date); return html`<tr><td>${p.title}</td><td>${PERIOD[p.period_type] || p.period_type}</td>
      <td>${fDate(p.next_date)}</td><td>${p.last_date ? fDate(p.last_date) : '-'}</td><td>${p.worker_name || '-'}</td><td class="${d < 0 ? 'red' : ''}">${d < 0 ? `Kasni ${-d} d` : d === 0 ? 'Danas' : `Za ${d} d`}</td></tr>`; })}</tbody></table>`)}`);
}

function printWorkorders() {
  const list = App.d.workorders;
  if (!list.length) return toast('Nema radnih naloga', 'err');
  const down = list.reduce((s, w) => s + (w.downtime_min || 0), 0);
  printDoc('Zbirni izveštaj radnih naloga', html`<p>Ukupno naloga: <b>${list.length}</b> &middot; otvorenih: <b>${list.filter(w => w.status !== 'ZAVRSEN').length}</b> &middot; ukupan zastoj: <b>${fMin(down)}</b></p>
    <table>${woHead}<tbody>${list.map(woRow)}</tbody></table>`);
}

function printStock() {
  const list = App.d.inventory;
  if (!list.length) return toast('Magacin je prazan', 'err');
  const val = list.reduce((s, i) => s + i.quantity * (i.unit_price || 0), 0);
  printDoc('Izveštaj magacinskih zaliha', html`<table><thead><tr><th>Šifra</th><th>Naziv</th><th>Lokacija</th><th>Stanje</th><th>Minimum</th><th>Cena</th><th>Vrednost</th></tr></thead><tbody>
    ${list.map(i => html`<tr><td>${i.code}</td><td>${i.name}</td><td>${i.location || ''}</td><td class="${i.quantity <= i.minimum ? 'red' : ''}">${fNum(i.quantity)} ${i.unit}</td><td>${fNum(i.minimum)}</td><td>${fMoney(i.unit_price)}</td><td>${fMoney(i.quantity * (i.unit_price || 0))}</td></tr>`)}
    <tr class="sum"><td colspan="6">Ukupna vrednost zaliha</td><td>${fMoney(val)}</td></tr></tbody></table>`);
}

function printQrLabel(m) {
  const url = `/api/machines/${m.id}/qr.png`;
  printDoc('QR nalepnica: ' + m.code, html`<div style="text-align:center;margin-top:40px"><img src="${location.origin}${url}" style="width:260px;height:260px">
    <div style="font-size:30px;font-weight:800;margin-top:10px">${m.code}</div><div style="font-size:18px">${m.name}</div><div style="color:#64748b;margin-top:6px">Skeniraj telefonom za prijavu kvara</div></div>`);
}

function printReport() {
  const R = App.report;
  if (!R || !R.kpi) return toast('Izveštaj još nije učitan', 'err');
  const k = R.kpi;
  const T = (head, rows) => html`<table><thead><tr>${head.map(h => html`<th>${h}</th>`)}</tr></thead><tbody>${rows}</tbody></table>`;
  printDoc('Izveštaj o održavanju', html`
    <p>Period: <b>${fDate(R.from)} - ${fDate(R.to)}</b></p>
    <h2>Pokazatelji</h2>
    <table><tbody>
      <tr><td>Prijavljeno naloga</td><td><b>${k.wo_created}</b> (od toga kvarova: ${k.faults})</td><td>Završeno naloga</td><td><b>${k.wo_closed}</b> (trenutno otvorenih: ${k.open_now})</td></tr>
      <tr><td>Prosečno vreme popravke (kvarovi)</td><td><b>${k.mttr_min == null ? '-' : fMin(k.mttr_min)}</b></td><td>Ukupan zastoj</td><td><b>${fMin(k.downtime_min)}</b></td></tr>
      <tr><td>Trošak utrošenih delova</td><td><b>${fMoney(k.parts_cost)} RSD</b></td><td>Vrednost zaliha</td><td><b>${fMoney(k.stock_value)} RSD</b></td></tr>
    </tbody></table>
    <h2>Mašine: kvarovi, zastoj i trošak delova</h2>
    ${T(['Mašina', 'Naloga', 'Kvarova', 'Zastoj', 'Prosečna popravka', 'Trošak delova'], R.by_machine.length
      ? R.by_machine.map(m => html`<tr><td><b>${m.code}</b> ${m.name}</td><td>${m.wo_total}</td><td>${m.failures}</td><td>${fMin(m.downtime_min)}</td><td>${m.mttr_min == null ? '-' : fMin(m.mttr_min)}</td><td>${fMoney(m.parts_cost)}</td></tr>`)
      : html`<tr><td colspan="6">Nema podataka.</td></tr>`)}
    <h2>Nalozi po ${R.unit === 'day' ? 'danima' : 'mesecima'}</h2>
    ${T([R.unit === 'day' ? 'Dan' : 'Mesec', 'Otvoreno', 'Završeno'], R.series.filter(x => x.created || x.closed).map(x => html`<tr><td>${R.unit === 'day' ? fDate(x.key) : x.key.slice(5, 7) + '/' + x.key.slice(0, 4)}</td><td>${x.created}</td><td>${x.closed}</td></tr>`))}
    <h2>Najviše utrošeni delovi</h2>
    ${T(['Šifra', 'Deo', 'Količina', 'Vrednost'], R.top_parts.length ? R.top_parts.map(p => html`<tr><td>${p.code}</td><td>${p.name}</td><td>${fNum(p.qty)} ${p.unit || ''}</td><td>${fMoney(p.cost)}</td></tr>`) : html`<tr><td colspan="4">Nema utrošenih delova.</td></tr>`)}
    <h2>Majstori</h2>
    ${T(['Majstor', 'Zaduženo', 'Završeno', 'Prosečna popravka'], R.by_worker.length ? R.by_worker.map(w => html`<tr><td>${w.name}</td><td>${w.assigned}</td><td>${w.closed}</td><td>${w.mttr_min == null ? '-' : fMin(w.mttr_min)}</td></tr>`) : html`<tr><td colspan="4">Nema podataka.</td></tr>`)}
    <h2>Operateri proizvodnje</h2>
    ${T(['Operater', 'Prijava', 'Kvarova', 'Zastoj'], R.by_operator.length ? R.by_operator.map(o => html`<tr><td>${o.name}</td><td>${o.reports}</td><td>${o.faults}</td><td>${fMin(o.downtime_min)}</td></tr>`) : html`<tr><td colspan="4">Nema podataka.</td></tr>`)}`);
}

function izvoziUCSV(what) {
  if (what === 'promet') {
    const f = App.filters;
    const label = { ULAZ: 'Ulaz', IZLAZ: 'Izlaz', KOREKCIJA: 'Korekcija popisa' };
    downloadCsv('dnevnik-prometa-magacina', ['Datum i vreme', 'Sifra', 'Artikal', 'Vrsta', 'Kolicina', 'Jedinica', 'Evidentirao', 'Radni nalog', 'Napomena'],
      App.d.tx.map(t => [fDT(t.created_at), t.code || '', t.name || '', label[t.transaction_type] || t.transaction_type, t.quantity, t.unit || '', t.worker_name || t.user_name || '', t.wo_number || '', t.note || '']));
    return;
  }
  if (what === 'izvestaj') {
    const R = App.report; if (!R || !R.kpi) return;
    downloadCsv(`izvestaj-masine-${R.from}-do-${R.to}`, ['Sifra', 'Masina', 'Naloga', 'Kvarova', 'Zastoj (min)', 'Prosecna popravka (min)', 'Trosak delova (RSD)'],
      R.by_machine.map(m => [m.code, m.name, m.wo_total, m.failures, m.downtime_min, m.mttr_min == null ? '' : m.mttr_min, m.parts_cost]), false);
    return;
  }
  if (what === 'nalozi') {
    downloadCsv('radni-nalozi', ['Broj', 'Otvoren', 'Masina', 'Tip', 'Prioritet', 'Prijavio', 'Majstor', 'Status', 'Opis', 'Izvrseni radovi', 'Zatvoren', 'Zastoj (min)', 'Delovi (RSD)'],
      App.d.workorders.map(w => [w.number, fDT(w.created_at), mLabel({ code: w.machine_code, name: w.machine_name }), TYPE[w.type] || w.type, PRIO[w.priority] || w.priority,
        w.operator_name || w.creator_name || '', w.worker_name || '', STATUS[w.status] || w.status, w.description, w.resolution || '', w.closed_at ? fDT(w.closed_at) : '', w.downtime_min || 0, w.parts_cost || 0]));
  } else if (what === 'magacin') {
    downloadCsv('magacin', ['Sifra', 'Naziv', 'Lokacija', 'Stanje', 'Minimum', 'Jedinica', 'Cena', 'Dobavljac', 'Zadnji primio'],
      App.d.inventory.map(i => [i.code, i.name, i.location || '', i.quantity, i.minimum, i.unit, i.unit_price || 0, i.supplier || '', i.last_receiver || '']));
  }
}
