'use strict';
/* ===== Prikazi (ekrani) ===== */

const NAV = [
  ['dashboard', 'Kontrolna Tabla', 'dashboard'],
  ['radni-nalozi', 'Radni Nalozi', 'clipboard'],
  ['magacin', 'Magacin Zaliha', 'box'],
  ['preventiva', 'Preventiva & Alarmi', 'calcheck'],
  ['izvestaji', 'Izveštaji', 'activity', 'reports.view'],
  ['sifarnici', 'Baza Podataka', 'database']
];

function navCounts() {
  const open = App.d.workorders.filter(w => w.status !== 'ZAVRSEN').length;
  const late = App.d.preventive.filter(p => p.status === 'AKTIVNA' && daysFrom(p.next_date) < 0).length;
  const low = App.d.inventory.filter(i => i.quantity <= i.minimum).length;
  return { 'radni-nalozi': open, preventiva: late, magacin: low };
}

function navButtons(closeDrawer) {
  const c = navCounts();
  return NAV.filter(n => !n[3] || can(n[3])).map(([id, label, icn]) => html`<button class="nav-btn ${App.tab === id ? 'active' : ''}" data-act="nav" data-tab="${id}" ${closeDrawer ? raw('data-close="1"') : ''}>
    ${ic(icn)} <span>${label}</span>${c[id] ? html`<span class="cnt" ${id === 'radni-nalozi' ? raw('style="background:#3b82f6"') : ''}>${c[id]}</span>` : ''}</button>`);
}

function renderShell() {
  const u = App.user;
  const foot = html`<div class="side-foot"><div class="userbox"><div class="avatar">${(u.fullname || u.username || '?').trim().charAt(0).toUpperCase()}</div>
      <div><b>${u.fullname || u.username}</b><small>${ROLE[u.role] || u.role}</small></div></div>
    <div class="row"><button data-act="pw-modal">${ic('key')} Lozinka</button><button data-act="logout">${ic('logout')} Odjava</button></div>
    ${window.AndroidApp ? html`<div class="row"><button data-act="android-alerts">${ic('bell')} Obaveštenja</button><button data-act="android-server">${ic('server')} Server</button></div>` : ''}</div>`;
  put($('#sidebar'), html`
    <div class="brand"><div class="brand-logo">${ic('server')}</div><div><b>CMMS Pro</b><small>Sistem Održavanja v4.0</small></div></div>
    <div class="conn"><div class="row" id="conn-status"></div><button class="icon-btn" data-act="sync" title="Osveži">${ic('rotate')}</button></div>
    <nav class="nav" id="nav-main">${navButtons(false)}</nav>${foot}`);
  put($('#drawer-panel'), html`
    <div class="brand" style="justify-content:space-between"><div style="display:flex;gap:10px;align-items:center"><span style="color:#60a5fa;font-size:22px">${ic('server')}</span><b>CMMS Meni</b></div>
      <button class="icon-btn" data-act="drawer" aria-label="Zatvori">${ic('x', '')}</button></div>
    <nav class="nav" id="nav-drawer">${navButtons(true)}</nav>${foot}`);
  window.paintConn();
}

function refreshNav() {
  put($('#nav-main'), navButtons(false));
  put($('#nav-drawer'), navButtons(true));
}

// ---------------- KONTROLNA TABLA ----------------
function alarmItem(p) {
  const d = daysFrom(p.next_date);
  const when = d < 0 ? html`<b class="t-red">kasni ${-d} d</b>` : d === 0 ? html`<b class="t-amber">rok je danas</b>` : html`<b class="t-amber">za ${d} d</b>`;
  return html`<li>${ic('wrench')}<span><b>${p.machine_code}</b> - ${p.title}</span>${when}
    ${p.open_wo ? html`<span class="badge b-info">nalog ${p.open_wo} otvoren</span>` : ''}</li>`;
}

function renderDashboard() {
  const D = App.d.dash; if (!D) return;
  const c = D.counts;
  const late = D.alarms.filter(p => daysFrom(p.next_date) < 0);
  const soon = D.alarms.filter(p => daysFrom(p.next_date) >= 0);
  const alarmBlock = (list, cls, title, icn) => list.length ? html`<div class="alarm-banner ${cls}">${ic(icn)}<div><h4>${title}</h4>
      <ul>${list.slice(0, 5).map(alarmItem)}</ul>${list.length > 5 ? html`<small class="sub">i još ${list.length - 5}...</small>` : ''}</div>
      <button class="btn btn-soft btn-sm" style="margin-left:auto" data-act="nav" data-tab="preventiva">Otvori plan ${ic('arrow')}</button></div>` : '';

  put($('#dashboard'), html`
    <div class="banner"><div><h2><span class="dot"></span> ${c.wo_unassigned ? `Pažnja: ${c.wo_unassigned} ${c.wo_unassigned === 1 ? 'nalog čeka' : 'naloga čeka'} majstora` : c.wo_urgent ? `Pažnja: ${c.wo_urgent} hitnih naloga čeka` : 'Industrijsko Održavanje Operativno'}</h2>
        <p>Praćenje kvarova, preventivnih servisa po mašinama i utroška rezervnih delova u realnom vremenu.</p></div>
      <div class="btns"><button class="btn btn-primary" data-act="new-wo">${ic('pluscircle')} Prijavi Kvar</button>
        <button class="btn btn-amber" data-act="nav" data-tab="preventiva">${ic('bell')} Proveri Alarme</button></div></div>
    ${D.backup_warn ? html`<div class="alarm-banner">${ic('alert')}<div><h4>Kopija baze na drugo mesto nije uspela</h4>
      <p class="hint" style="margin:0">${D.backup_warn.error}. Odredište: ${D.backup_warn.dir}. Podaci su sačuvani samo na ovom računaru dok se to ne reši.</p></div>
      <button class="btn btn-soft btn-sm" data-act="nav" data-tab="sifarnici">Otvori podešavanje ${ic('arrow')}</button></div>` : ''}
    ${alarmBlock(late, '', `Preventivni servisi koji kasne (${late.length})`, 'alert')}
    ${alarmBlock(soon, 'warn', `Preventiva uskoro na redu (${soon.length})`, 'bell')}
    <div class="grid kpis">
      <div class="kpi"><div><small>Otvoreni Nalozi</small><h3>${c.wo_open}</h3><p class="t-red">${ic('clock')} Zahtevaju reakciju</p></div><div class="ico i-red">${ic('alert')}</div></div>
      <div class="kpi"><div><small>Ukupan Zastoj</small><h3>${fMin(c.downtime_min).replace(' min', 'min')}</h3><p class="t-amber">${ic('activity')} Izračunato iz radova</p></div><div class="ico i-amber">${ic('timer')}</div></div>
      <div class="kpi"><div><small>Preventivni Servisi</small><h3>${c.pm_active}</h3><p class="t-blue">${ic('calendar')} Aktivni planovi</p></div><div class="ico i-blue">${ic('calcheck')}</div></div>
      <div class="kpi"><div><small>Kritične Zalihe</small><h3>${c.low_stock}</h3><p class="t-slate">${ic('layers')} Ispod minimuma</p></div><div class="ico i-slate">${ic('box')}</div></div>
    </div>
    <div class="grid cols3">
      <div class="card"><div class="card-h"><h3>${ic('history')} Nedavno Prijavljeni Nalozi</h3>
          <button class="btn btn-sm" style="background:none;color:var(--blue)" data-act="nav" data-tab="radni-nalozi">Vidi sve naloge ${ic('arrow')}</button></div>
        <div class="tw"><table><thead><tr><th>ID / Datum</th><th>Mašina</th><th>Tip Rada</th><th>Status</th></tr></thead><tbody>
          ${D.recent.length ? D.recent.map(w => html`<tr style="cursor:pointer" data-act="open-wo" data-id="${w.id}"><td class="nw"><b>${w.number}</b><small>${fDT(w.created_at)}</small></td>
            <td>${w.machine_code}<small>${w.machine_name}</small></td><td>${TYPE[w.type] || w.type}<small>${PRIO[w.priority]}</small></td><td>${statusBadge(w.status)}</td></tr>`)
            : html`<tr><td colspan="4" class="empty">Još nema prijavljenih naloga.</td></tr>`}</tbody></table></div></div>
      <div class="card"><div class="card-b" style="display:flex;flex-direction:column;gap:18px">
        <div><h3 style="margin:0 0 14px;font-size:15px;display:flex;gap:8px;align-items:center">${ic('sliders', 't-blue')} Registrovani Resursi</h3>
          <div class="stat-row"><span>${ic('cpu')} Mašine &amp; Oprema:</span><b>${c.machines}</b></div>
          <div class="stat-row"><span>${ic('wrench')} Tim Majstora:</span><b>${c.workers}</b></div>
          <div class="stat-row"><span>${ic('box')} Artikala u Magacinu:</span><b>${c.inventory}</b></div></div>
        <div style="display:flex;flex-direction:column;gap:8px;border-top:1px solid var(--s100);padding-top:16px">
          <button class="btn btn-ind btn-block" data-act="print-worker">${ic('printer')} Zbirna Štampa po Serviseru</button>
          <button class="btn btn-dark btn-block" data-act="csv" data-what="nalozi">${ic('download')} Preuzmi CSV Bazu Naloga</button></div></div></div>
    </div>`);
}

// ---------------- RADNI NALOZI ----------------
function filteredWorkorders() {
  const f = App.filters, q = f.q.trim().toLowerCase();
  return App.d.workorders.filter(w =>
    (!f.status || w.status === f.status || (f.status === 'OPEN' && w.status !== 'ZAVRSEN')) && (!f.priority || w.priority === f.priority) &&
    (!q || [w.number, w.machine_code, w.machine_name, w.description, w.worker_name, w.operator_name].some(x => String(x || '').toLowerCase().includes(q))));
}

const isWaiting = w => w.status === 'OTVOREN' && !w.worker_id;
const canAccept = w => !!w && can('wo.write') && !!App.user.worker_id && w.status !== 'ZAVRSEN' &&
  ((!w.worker_id && w.status === 'OTVOREN') || (w.worker_id === App.user.worker_id && !w.accepted_at));

function woRows() {
  const list = filteredWorkorders();
  if (!list.length) return html`<tr><td colspan="7" class="empty">Nema naloga koji odgovaraju filteru.</td></tr>`;
  return list.slice(0, 300).map(w => html`<tr>
    <td class="nw" data-l="Nalog"><span><b>${w.number}</b><small>${fDT(w.created_at)}</small></span></td>
    <td data-l="Mašina"><span><b>${w.machine_code}</b><small>${w.machine_name}</small></span></td>
    <td class="nw" data-l="Tip / prioritet"><span>${TYPE[w.type] || w.type}<br>${prioBadge(w.priority)}</span></td>
    <td data-l="Prijavio">${w.operator_name || w.creator_name || '-'}</td>
    <td data-l="Majstor">${w.worker_name || html`<span class="t-slate">nije dodeljen</span>`}</td>
    <td class="nw" data-l="Status"><span>${statusBadge(w.status)}${w.status === 'ZAVRSEN' && w.downtime_min ? html`<small>zastoj ${fMin(w.downtime_min)}</small>` : ''}</span></td>
    <td class="r nw">${canAccept(w) ? html`<button class="btn btn-primary btn-sm" data-act="accept-wo" data-id="${w.id}">${ic('check')} ${w.worker_id ? 'Potvrdi' : 'Prihvati'}</button> ` : ''}<button class="ib" title="Štampaj nalog" data-act="print-wo" data-id="${w.id}">${ic('printer')}</button>
      <button class="ib" title="${can('wo.write') ? 'Uredi / zatvori' : 'Pregled'}" data-act="open-wo" data-id="${w.id}">${ic(can('wo.write') ? 'edit' : 'search')}</button>
      ${can('wo.delete') ? html`<button class="ib del" title="Obriši" data-act="del-wo" data-id="${w.id}">${ic('trash')}</button>` : ''}</td></tr>`);
}

function renderNaloge() {
  const f = App.filters;
  const sel = (v, cur) => (v === cur ? raw('selected') : '');
  put($('#radni-nalozi'), html`
    <div class="toolbar"><div class="filters">
        <div class="search">${ic('search')}<input type="search" data-f="q" value="${f.q}" placeholder="Pretraži nalog, mašinu ili opis..."></div>
        <select data-f="status"><option value="">Svi Statusi Naloga</option><option value="OPEN" ${sel('OPEN', f.status)}>Samo otvoreni</option>
          <option value="OTVOREN" ${sel('OTVOREN', f.status)}>Otvoreno (Novi Kvar)</option><option value="U_TOKU" ${sel('U_TOKU', f.status)}>U toku (Dodeljeno)</option>
          <option value="CEKA_DEO" ${sel('CEKA_DEO', f.status)}>Čeka deo</option><option value="ZAVRSEN" ${sel('ZAVRSEN', f.status)}>Završeno (Popravljeno)</option></select>
        <select data-f="priority"><option value="">Svi Prioriteti</option><option value="VISOK" ${sel('VISOK', f.priority)}>Visok Prioritet (Zastoj)</option>
          <option value="SREDNJI" ${sel('SREDNJI', f.priority)}>Srednji Prioritet</option><option value="NIZAK" ${sel('NIZAK', f.priority)}>Nizak Prioritet</option></select></div>
      <div class="btns"><button class="btn btn-ind" data-act="print-worker">${ic('printer')} Po Majstoru</button>
        <button class="btn btn-ind" data-act="print-operator">${ic('printer')} Po Operateru</button>
        <button class="btn btn-soft" data-act="csv" data-what="nalozi">${ic('download')} CSV</button>
        <button class="btn btn-primary" data-act="new-wo">${ic('plus')} Novi Nalog</button></div></div>
    <div class="card"><div class="tw"><table class="cardy wide"><thead><tr><th>Nalog # / Vreme</th><th>Mašina / Oprema</th><th>Tip &amp; Prioritet</th><th>Prijavio (Operater)</th>
      <th>Zadužen (Majstor)</th><th>Status</th><th class="r">Akcija</th></tr></thead><tbody id="wo-body">${woRows()}</tbody></table></div></div>`);
}
const refreshNalogeBody = () => { const b = $('#wo-body'); if (b) put(b, woRows()); };

// ---------------- MAGACIN ----------------
function stockBadge(i) {
  if (i.quantity <= 0) return badge('otvoren', 'Nema na stanju');
  if (i.quantity <= i.minimum) return badge('u_toku', 'Kritično');
  return badge('zavrsen', 'Dostupno');
}

function stockRows() {
  const q = App.filters.stockQ.trim().toLowerCase();
  const list = App.d.inventory.filter(i => !q || [i.name, i.code, i.location].some(x => String(x || '').toLowerCase().includes(q)));
  if (!list.length) return html`<tr><td colspan="6" class="empty">Nema artikala.</td></tr>`;
  return list.map(i => html`<tr><td data-l="Naziv"><b>${i.name}</b></td><td data-l="SKU"><span class="mono">${i.code}</span></td><td data-l="Lokacija">${i.location || '-'}</td>
    <td class="nw" data-l="Stanje"><b class="${i.quantity <= i.minimum ? 't-red' : ''}">${fNum(i.quantity)}</b> <span class="t-slate">/ min ${fNum(i.minimum)} ${i.unit}</span></td>
    <td data-l="Zadnji primio">${i.last_receiver || '-'}</td>
    <td class="nw r">${stockBadge(i)} ${can('inventory.write') ? html`<button class="ib" title="Uredi / korekcija" data-act="edit-item" data-id="${i.id}">${ic('edit')}</button>
      <button class="ib del" title="Arhiviraj" data-act="del-item" data-id="${i.id}">${ic('trash')}</button>` : ''}</td></tr>`);
}

// ---------------- DNEVNIK PROMETA MAGACINA (sa filterima) ----------------
const TX_LIMIT = 300;
const txActive = () => { const f = App.filters; return !!(f.txFrom || f.txTo || f.txQ.trim() || f.txType || f.txWho.trim()); };
function txQuery() {
  const f = App.filters, p = new URLSearchParams();
  if (f.txFrom) p.set('from', f.txFrom);
  if (f.txTo) p.set('to', f.txTo);
  if (f.txQ.trim()) p.set('q', f.txQ.trim());
  if (f.txType) p.set('type', f.txType);
  if (f.txWho.trim()) p.set('who', f.txWho.trim());
  p.set('limit', TX_LIMIT);
  return '?' + p.toString();
}
function txRows() {
  const list = App.d.tx;
  if (!list.length) return html`<tr><td colspan="4" class="empty">${txActive() ? 'Nema zapisa za izabrane filtere.' : 'Još nema kretanja robe.'}</td></tr>`;
  return list.map(t => {
    const q = Number(t.quantity);
    const out = t.transaction_type === 'IZLAZ' || (t.transaction_type === 'KOREKCIJA' && q < 0);
    return html`<tr><td class="nw" data-l="Datum i vreme">${fDT(t.created_at)}</td><td data-l="Artikal">${t.name || '?'} - <span class="mono">${t.code || ''}</span></td>
      <td class="nw" data-l="Količina"><span><b class="${out ? 't-red' : 't-green'}">${out ? '-' : '+'}${fNum(Math.abs(q))} ${t.unit || ''}</b><small>${t.transaction_type === 'KOREKCIJA' ? 'korekcija popisa' : t.transaction_type === 'IZLAZ' ? 'izlaz' : 'ulaz'}</small></span></td>
      <td data-l="Evidentirao / nalog"><span>${t.wo_number ? html`<span class="badge b-info">${t.wo_number}</span> ` : ''}${t.worker_name || t.user_name || '-'}${t.note && !t.wo_number ? html`<small>${t.note}</small>` : ''}</span></td></tr>`;
  });
}
const txCountText = () => { const n = App.d.tx.length; return (txActive() ? 'Filtrirano: ' : 'Prikazano: ') + n + (n >= TX_LIMIT ? ` (prvih ${TX_LIMIT} - suzite filter za starije)` : ' zapisa'); };
function refreshTxBody() {
  const b = $('#tx-body'); if (b) put(b, txRows());
  const c = $('#tx-count'); if (c) c.textContent = txCountText();
  const r = $('[data-act="tx-reset"]'); if (r) r.disabled = !txActive();
}
async function loadTx() { try { App.d.tx = await GET('/api/inventory/transactions' + txQuery()); refreshTxBody(); } catch (e) { fail(e); } }
let txTimer;
const debounceTx = () => { clearTimeout(txTimer); txTimer = setTimeout(loadTx, 300); };

function renderMagacin() {
  const wr = can('inventory.write');
  const form = wr ? html`<div class="card"><div class="card-h" style="display:block"><h3>${ic('box')} Evidencija Ulaza Zaliha</h3><p class="hint" style="margin-top:4px">Samo ovlašćeno osoblje iz Održavanja</p></div>
    <form class="card-b form" data-form="stock-in">
      <div class="radios"><label><input type="radio" name="tip" value="postojeci" checked><span>Dopuna postojeće</span></label><label><input type="radio" name="tip" value="novi"><span>Novi artikal</span></label></div>
      <div class="f" id="st-exist"><label>Odaberi artikal iz magacina</label>
        <div class="search">${ic('search')}<input type="search" data-f="itemSearch" placeholder="Pretraži deo po nazivu, šifri ili lokaciji..." autocomplete="off"></div>
        <select name="inventory_id" id="st-select" size="6" style="padding:6px">${opts(App.d.inventory, '', itemLabel, App.d.inventory.length ? '' : 'Magacin je prazan')}</select>
        <p class="hint" id="st-count">Ukupno artikala: ${App.d.inventory.length}</p></div>
      <div id="st-new" hidden class="form">
        <div class="f"><label>SKU Šifra (automatski po redu, može se izmeniti)</label><input type="text" name="code" placeholder="automatski (0000-9999)" maxlength="60"></div>
        <div class="f"><label>Naziv i Opis Dela</label><input type="text" name="name" placeholder="npr. Kuglični ležaj 25x52x15"></div>
        <div class="row2"><div class="f"><label>Lokacija</label><input type="text" name="location" placeholder="Polica B-4"></div><div class="f"><label>Min. Zaliha</label><input type="number" name="minimum" min="0" step="any" value="2"></div></div>
        <div class="row2"><div class="f"><label>Jedinica</label><input type="text" name="unit" value="kom"></div><div class="f"><label>Jed. cena (RSD)</label><input type="number" name="unit_price" min="0" step="any" value="0"></div></div></div>
      <div class="row2"><div class="f"><label>Količina (Ulaz)</label><input type="number" name="quantity" required min="0.01" step="any" value="1"></div>
        <div class="f"><label>Zaprimio (Održavanje)</label><select name="worker_id">${opts(activeWorkers(), '', w => w.fullname, '-')}</select></div></div>
      <button class="btn btn-green btn-block" style="padding:12px" type="submit">${ic('check')} Proknjiži Ulaz</button></form></div>` : '';
  put($('#magacin'), html`
    <div class="grid ${wr ? 'cols-m' : ''}">${form}
      <div class="card"><div class="card-h"><h3>Registar Rezervnih Delova</h3><div class="btns">
          <div class="search" style="min-width:200px">${ic('search')}<input type="search" data-f="stockQ" value="${App.filters.stockQ}" placeholder="Pretraži naziv ili SKU šifru..."></div>
          <button class="btn btn-soft" data-act="csv" data-what="magacin">${ic('download')} CSV</button></div></div>
        <div class="tw"><table class="cardy"><thead><tr><th>Naziv Dela</th><th>SKU Šifra</th><th>Lokacija</th><th>Stanje (Min)</th><th>Zadnji Primio</th><th>Status &amp; Akcija</th></tr></thead><tbody id="stock-body">${stockRows()}</tbody></table></div></div></div>
    <div class="card"><div class="card-h"><h3>${ic('history')} Dnevnik Prometa Magacina</h3>
        <div class="btns" style="align-items:center"><span class="hint" id="tx-count">${txCountText()}</span><button class="btn btn-soft btn-sm" data-act="csv" data-what="promet">${ic('download')} CSV</button></div></div>
      <div class="txf">
        <div class="f"><label>Datum i vreme: od</label><input type="date" data-f="txFrom" value="${App.filters.txFrom}"></div>
        <div class="f"><label>do</label><input type="date" data-f="txTo" value="${App.filters.txTo}"></div>
        <div class="f"><label>Artikal (naziv ili SKU)</label><div class="search">${ic('search')}<input type="search" data-f="txQ" value="${App.filters.txQ}" placeholder="npr. ležaj ili 0003" autocomplete="off"></div></div>
        <div class="f"><label>Količina</label><select data-f="txType">
          ${[['', 'Sve (ulaz, izlaz, korekcija)'], ['ULAZ', 'Samo ulaz (+)'], ['IZLAZ', 'Samo izlaz (-)'], ['KOREKCIJA', 'Korekcija popisa']].map(([v, l]) => html`<option value="${v}" ${App.filters.txType === v ? raw('selected') : ''}>${l}</option>`)}</select></div>
        <div class="f"><label>Evidentirao / Radni nalog</label><div class="search">${ic('search')}<input type="search" data-f="txWho" value="${App.filters.txWho}" placeholder="ime, RN-2026-0001 ili napomena" autocomplete="off"></div></div>
        <div class="f"><button class="btn btn-line" data-act="tx-reset" ${txActive() ? '' : raw('disabled')}>${ic('x')} Poništi filtere</button></div>
      </div>
      <div class="tw"><table class="cardy"><thead><tr><th>Datum i Vreme</th><th>Artikal (Naziv - SKU)</th><th>Količina</th><th>Evidentirao / Radni Nalog</th></tr></thead><tbody id="tx-body">${txRows()}</tbody></table></div></div>`);
  if (wr) prefillCode();
}
// upisuje sledecu slobodnu sifru artikla (0000, 0001, ...) u formu za novi artikal
async function prefillCode() {
  const f = $('form[data-form="stock-in"] [name="code"]');
  if (!f || f.dataset.touched) return;
  try { const r = await GET('/api/inventory/next-code'); if (!f.dataset.touched) f.value = r.code; } catch (_) {}
}
const refreshStockBody = () => { const b = $('#stock-body'); if (b) put(b, stockRows()); };
const activeWorkers = () => App.d.workers.filter(w => w.status !== 'NEAKTIVAN');

// ---------------- PREVENTIVA ----------------
function pmCard(m) {
  const plans = App.d.preventive.filter(p => p.machine_id === m.id);
  return html`<div class="card"><div class="mcard-h"><div><b>${m.code}</b><small class="sub">${m.name}${m.location ? ' · ' + m.location : ''}</small></div>
      <span class="badge b-info">${plans.length} ${plans.length === 1 ? 'plan' : 'planova'}</span></div>
    ${plans.map(p => { const d = daysFrom(p.next_date); const paused = p.status !== 'AKTIVNA';
      const st = paused ? badge('nizak', 'Pauzirano') : d < 0 ? badge('otvoren', `Kasni ${-d} d`) : d <= 2 ? badge('u_toku', d === 0 ? 'Rok je danas' : `Za ${d} d`) : badge('zavrsen', `Za ${d} d`);
      return html`<div class="plan"><div><div class="t">${p.title}</div>${p.description ? html`<small class="sub">${p.description}</small>` : ''}</div>
        <div class="meta">${st}<span class="badge b-nizak">${PERIOD[p.period_type] || p.period_type}</span><span class="sub" style="margin:0">Rok: <b>${fDate(p.next_date)}</b>${p.worker_name ? ' · ' + p.worker_name : ''}</span></div>
        <div class="act">${p.open_wo_id ? html`<button class="btn btn-amber btn-sm" data-act="open-wo" data-id="${p.open_wo_id}">${ic('clipcheck')} Otvori nalog ${p.open_wo}</button>`
            : can('wo.write') && !paused ? html`<button class="btn btn-primary btn-sm" data-act="run-pm" data-id="${p.id}">${ic('play')} Pokreni ciklus</button>` : ''}
          ${can('preventive.write') ? html`<button class="ib" title="Uredi" data-act="edit-pm" data-id="${p.id}">${ic('edit')}</button><button class="ib del" title="Obriši" data-act="del-pm" data-id="${p.id}">${ic('trash')}</button>` : ''}</div></div>`; })}</div>`;
}

function renderPreventiva() {
  const f = App.filters.machine;
  const ms = App.d.machines.filter(m => App.d.preventive.some(p => p.machine_id === m.id) && (!f || String(m.id) === f));
  const late = App.d.preventive.filter(p => p.status === 'AKTIVNA' && daysFrom(p.next_date) < 0);
  put($('#preventiva'), html`
    <div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:14px">
      <div><h2 style="margin:0;font-size:19px;display:flex;gap:10px;align-items:center">${ic('shield', 't-blue')} Preventivno Održavanje - Kartice po Mašinama</h2>
        <p class="hint" style="margin-top:4px">Pokretanjem ciklusa otvara se Radni Nalog radi dodavanja delova i zatvaranja naloga. Plan koji dospe otvara nalog automatski 2 dana ranije.</p></div>
      <div class="btns"><button class="btn btn-ind" data-act="print-pm">${ic('printer')} Štampaj Planove</button>
        ${can('preventive.write') ? html`<button class="btn btn-primary" data-act="new-pm">${ic('plus')} Novi Plan Servisa</button>` : ''}</div></div>
    ${late.length ? html`<div class="alarm-banner">${ic('alert')}<div><h4>${late.length} ${late.length === 1 ? 'preventivni servis kasni' : 'preventivnih servisa kasni'}</h4>
      <p class="hint">${late.slice(0, 4).map(p => p.machine_code + ': ' + p.title).join(' · ')}</p></div></div>` : ''}
    <div class="toolbar" style="justify-content:flex-start"><span class="lbl" style="display:flex;gap:6px;align-items:center">${ic('filter')} Filtriraj Mašinu:</span>
      <select data-f="machine" style="max-width:320px"><option value="">Sve Mašine / Postrojenja</option>${opts(App.d.machines.filter(m => App.d.preventive.some(p => p.machine_id === m.id)), f, m => mLabel(m))}</select></div>
    <div class="grid cards3">${ms.length ? ms.map(pmCard) : html`<div class="card" style="grid-column:1/-1"><div class="empty">Nema preventivnih planova. ${can('preventive.write') ? 'Dodajte prvi dugmetom „Novi Plan Servisa“.' : ''}</div></div>`}</div>`);
}

// ---------------- BAZA PODATAKA (sifarnici) ----------------
function renderSifarnici() {
  const wm = can('machines.write'), ww = can('workers.write'), admin = can('users.manage');
  const list = (id, items, row, empty) => html`<ul class="list" id="${id}">${items.length ? items.map(row) : html`<li class="t-slate">${empty}</li>`}</ul>`;
  const addBar = (act, ph, enabled) => enabled ? html`<form class="addbar" data-form="${act}"><input type="text" name="name" placeholder="${ph}" required maxlength="120"><button class="btn btn-primary" type="submit" aria-label="Dodaj">${ic('plus')}</button></form>` : '';
  put($('#sifarnici'), html`
    <div class="grid cards3">
      <div class="card"><div class="card-h"><h3>${ic('cpu')} Mašine &amp; Oprema</h3><span class="badge b-nizak">${App.d.machines.length}</span></div>
        ${addBar('add-machine', 'Naziv / Oznaka mašine...', wm)}
        ${list('lista-oprema', App.d.machines, m => html`<li><span class="grow"><b>${m.name}</b><small>${m.code}${m.location ? ' · ' + m.location : ''}</small></span>
          <button class="ib" title="QR nalepnica" data-act="qr-machine" data-id="${m.id}">${ic('qr')}</button>
          ${wm ? html`<button class="ib" title="Uredi" data-act="edit-machine" data-id="${m.id}">${ic('edit')}</button><button class="ib del" title="Arhiviraj" data-act="del-machine" data-id="${m.id}">${ic('trash')}</button>` : ''}</li>`, 'Nema mašina.')}</div>
      <div class="card"><div class="card-h"><h3>${ic('users')} Operateri Proizvodnje</h3><span class="badge b-nizak">${App.d.operators.length}</span></div>
        ${addBar('add-operator', 'Ime radnika / Sektor...', ww)}
        ${list('lista-operateri', App.d.operators, o => html`<li><span class="grow">${o.name}</span>${ww ? html`<button class="ib" data-act="edit-operator" data-id="${o.id}" title="Preimenuj">${ic('edit')}</button><button class="ib del" data-act="del-operator" data-id="${o.id}" title="Obriši">${ic('trash')}</button>` : ''}</li>`, 'Nema operatera.')}</div>
      <div class="card"><div class="card-h"><h3>${ic('wrench')} Majstori &amp; Serviseri (Održavanje)</h3><span class="badge b-nizak">${App.d.workers.length}</span></div>
        ${addBar('add-worker', 'Ime i specijalnost majstora...', ww)}
        ${list('lista-majstori', App.d.workers, w => html`<li><span class="grow ${w.status === 'NEAKTIVAN' ? 't-slate' : ''}">${w.fullname}${w.status === 'NEAKTIVAN' ? html`<small>neaktivan</small>` : ''}</span>${ww ? html`<button class="ib" data-act="edit-worker" data-id="${w.id}" title="Izmeni">${ic('edit')}</button><button class="ib del" data-act="del-worker" data-id="${w.id}" title="Ukloni">${ic('trash')}</button>` : ''}</li>`, 'Nema majstora.')}</div>
      ${admin ? html`<div class="card"><div class="card-h"><h3>${ic('key')} Korisnici Sistema</h3><button class="btn btn-primary btn-sm" data-act="new-user">${ic('plus')} Novi</button></div>
        <ul class="list" id="lista-korisnici"><li class="t-slate">Učitavanje...</li></ul></div>
      <div class="card"><div class="card-h"><h3>${ic('drive')} Sigurnosne Kopije</h3><button class="btn btn-green btn-sm" data-act="backup-now">${ic('save')} Napravi sada</button></div>
        <ul class="list" id="lista-backup"><li class="t-slate">Učitavanje...</li></ul>
        <div class="card-b" style="border-top:1px solid var(--s100)"><p class="hint">Automatski backup se pravi jednom dnevno u folder <b>backup</b> pored programa. Vraćanje: <b>restore.bat</b> (zaustavite server pre vraćanja).</p>
          <form class="form" data-form="backup-copy" style="margin-top:14px;padding-top:14px;border-top:1px dashed var(--s200)">
            <div class="f"><label>Dodatna kopija na drugo mesto (USB disk ili mrežna fascikla)</label>
              <input type="text" name="dir" id="bk-dir" placeholder="npr. E:\CMMS-backup   ili   \\SERVER\backup\cmms" autocomplete="off"></div>
            <div class="btns"><button class="btn btn-dark btn-sm" type="submit">${ic('save')} Sačuvaj i proveri</button><button type="button" class="btn btn-soft btn-sm" data-act="backup-ext-now">${ic('refresh')} Kopiraj sada</button></div>
            <p class="hint" id="bk-status">Učitavanje...</p></form></div></div>
      <div class="card"><div class="card-h"><h3>${ic('settings')} Podešavanja</h3></div>
        <form class="card-b form" data-form="settings"><div class="f"><label>Naziv firme (za štampu)</label><input type="text" name="company" id="set-company" maxlength="120"></div>
          <div class="f"><label>Podsetnik za neprihvaćen nalog (minuta, 0 = isključeno)</label><input type="number" name="remind_minutes" id="set-remind" min="0" max="1440" value="10"><p class="hint">Majstorima se obaveštenje o nalogu koji niko nije prihvatio ponavlja na toliko minuta.</p></div>
          <div class="f"><label>Javna internet adresa (opciono)</label><input type="url" name="public_url" id="set-url" placeholder="https://cmms.mojafirma.rs"><p class="hint">Ako je podešena, QR nalepnice mašina vode na ovu adresu umesto na lokalnu.</p></div>
          <button class="btn btn-dark" type="submit">${ic('save')} Sačuvaj</button></form></div>` : ''}
    </div>`);
  if (admin) loadAdminLists();
}

function bkStatusHtml(st) {
  if (!st.dir) return html`<span class="t-amber"><b>Dodatna kopija nije podešena.</b></span> Backup samo na ovom računaru ne štiti od kvara diska - preporučujemo USB ili mrežni disk.`;
  const l = st.last;
  if (!l) return html`Odredište: ${st.dir}. Još nije kopirano.`;
  return l.ok ? html`<span class="t-green"><b>✓ Kopiranje radi.</b></span> Poslednje kopiranje: ${fDT(l.at)}${l.latest ? ' · najnovija: ' + l.latest : ''}`
    : html`<span class="t-red"><b>✗ Kopiranje nije uspelo:</b> ${l.error}</span> (${fDT(l.at)}). Program pokušava ponovo na svakih 10 minuta.`;
}

async function loadAdminLists() {
  try {
    const [users, backups, info, ext] = await Promise.all([GET('/api/users'), GET('/api/backups'), GET('/api/server-info'), GET('/api/backups/external')]);
    App.info = info;
    const ul = $('#lista-korisnici');
    if (ul) put(ul, users.map(u => html`<li><span class="grow ${u.active ? '' : 't-slate'}"><b>${u.fullname || u.username}</b><small>${u.username} · ${ROLE[u.role] || u.role}${u.worker_id && byId(App.d.workers, u.worker_id) ? ' · majstor: ' + byId(App.d.workers, u.worker_id).fullname : ''}${u.active ? '' : ' · deaktiviran'}${u.last_login ? ' · prijava ' + fDT(u.last_login) : ''}</small></span>
      <button class="ib" title="Izmeni / nova lozinka" data-act="edit-user" data-id="${u.id}">${ic('edit')}</button>
      ${u.id !== App.user.id ? html`<button class="ib del" title="Deaktiviraj" data-act="del-user" data-id="${u.id}">${ic('trash')}</button>` : ''}</li>`));
    App.users = users;
    const bl = $('#lista-backup');
    if (bl) put(bl, backups.length ? backups.slice(0, 12).map(b => html`<li><span class="grow"><b>${b.name}</b><small>${fDT(b.created_at)} · ${(b.size / 1024 / 1024).toFixed(2)} MB</small></span>
      <a class="ib" href="/api/backups/${encodeURIComponent(b.name)}" title="Preuzmi" download>${ic('download')}</a></li>`) : html`<li class="t-slate">Još nema kopija.</li>`);
    const bd = $('#bk-dir'), bs = $('#bk-status'); if (bd && document.activeElement !== bd) bd.value = ext.dir || ''; if (bs) put(bs, bkStatusHtml(ext));
    const c = $('#set-company'), u = $('#set-url'), rm = $('#set-remind'); if (c) c.value = info.company || ''; if (u) u.value = info.public_url || ''; if (rm) rm.value = info.remind_minutes == null ? 10 : info.remind_minutes;
  } catch (e) { fail(e); }
}

// ---------------- IZVESTAJI ----------------
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const PRESETS = [['month', 'Ovaj mesec'], ['lastmonth', 'Prošli mesec'], ['30', 'Poslednjih 30 dana'], ['year', 'Ova godina'], ['all', 'Sve']];
function applyPreset(p) {
  const t = new Date(), y = t.getFullYear(), m = t.getMonth();
  let from, to = ymd(t);
  if (p === 'lastmonth') { from = ymd(new Date(y, m - 1, 1)); to = ymd(new Date(y, m, 0)); }
  else if (p === '30') from = ymd(new Date(y, m, t.getDate() - 29));
  else if (p === 'year') from = `${y}-01-01`;
  else if (p === 'all') from = '2000-01-01';
  else { p = 'month'; from = ymd(new Date(y, m, 1)); }
  Object.assign(App.filters, { rFrom: from, rTo: to, rPreset: p });
}

async function loadReport() {
  const f = App.filters;
  if (!f.rFrom) applyPreset('month');
  App.report = null;
  if (App.tab === 'izvestaji') renderIzvestaji();
  try { App.report = await GET(`/api/reports/summary?from=${f.rFrom}&to=${f.rTo}`); }
  catch (e) { App.report = { error: e.message }; }
  if (App.tab === 'izvestaji') renderIzvestaji();
}

// stubicasti grafikon (SVG): otvoreno (plavo) i zavrseno (zeleno) po danu ili mesecu
function reportChart(R) {
  const s = R.series, n = s.length;
  if (!n || !s.some(x => x.created || x.closed)) return '';
  const W = 760, H = 230, pl = 34, pr = 8, pt = 12, pb = 30;
  const max = Math.max(1, ...s.flatMap(x => [x.created, x.closed]));
  const top = max <= 4 ? max : Math.ceil(max / 4) * 4;
  const gw = (W - pl - pr) / n, bw = Math.max(3, Math.min(20, gw / 2.8));
  const y = v => pt + (H - pt - pb) * (1 - v / top);
  const ticks = top <= 4 ? Array.from({ length: top + 1 }, (_, i) => i) : [0, top / 4, top / 2, top * 3 / 4, top];
  let g = '';
  ticks.forEach(t => { g += `<line x1="${pl}" x2="${W - pr}" y1="${y(t)}" y2="${y(t)}" stroke="#e2e8f0"/><text x="${pl - 6}" y="${y(t) + 4}" text-anchor="end" font-size="11" fill="#64748b">${t}</text>`; });
  const step = Math.ceil(n / 14);
  s.forEach((x, i) => {
    const cx = pl + gw * i + gw / 2;
    if (x.created) g += `<rect x="${(cx - bw - 1).toFixed(1)}" y="${y(x.created).toFixed(1)}" width="${bw.toFixed(1)}" height="${(H - pb - y(x.created)).toFixed(1)}" rx="2" fill="#2563eb"/>`;
    if (x.closed) g += `<rect x="${(cx + 1).toFixed(1)}" y="${y(x.closed).toFixed(1)}" width="${bw.toFixed(1)}" height="${(H - pb - y(x.closed)).toFixed(1)}" rx="2" fill="#16a34a"/>`;
    if (i % step === 0) {
      const lab = R.unit === 'day' ? `${x.key.slice(8, 10)}.${x.key.slice(5, 7)}.` : `${x.key.slice(5, 7)}/${x.key.slice(2, 4)}`;
      g += `<text x="${cx.toFixed(1)}" y="${H - 10}" text-anchor="middle" font-size="11" fill="#64748b">${lab}</text>`;
    }
  });
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Nalozi po ${R.unit === 'day' ? 'danima' : 'mesecima'}" style="width:100%;height:auto">${g}</svg>`;
}

function renderIzvestaji() {
  const f = App.filters;
  if (!f.rFrom) applyPreset('month');
  const R = App.report, ok = R && R.kpi;
  const head = html`<div class="toolbar"><div class="btns">${PRESETS.map(([k, l]) => html`<button class="btn btn-sm ${f.rPreset === k ? 'btn-primary' : 'btn-soft'}" data-act="rep-preset" data-p="${k}">${l}</button>`)}</div>
    <div class="btns" style="align-items:center"><input type="date" data-f="rFrom" value="${f.rFrom}" style="width:auto" aria-label="Od"><span class="t-slate">do</span><input type="date" data-f="rTo" value="${f.rTo}" style="width:auto" aria-label="Do">
      <button class="btn btn-ind" data-act="rep-print" ${ok ? '' : raw('disabled')}>${ic('printer')} Štampaj</button>
      <button class="btn btn-soft" data-act="rep-csv" ${ok ? '' : raw('disabled')}>${ic('download')} CSV</button></div></div>`;
  if (!R) return put($('#izvestaji'), html`${head}<div class="card"><div class="empty">Učitavanje izveštaja...</div></div>`);
  if (R.error) return put($('#izvestaji'), html`${head}<div class="card"><div class="empty t-red">${R.error}</div></div>`);

  const k = R.kpi, ms = R.by_machine;
  const maxDown = Math.max(1, ...ms.map(m => m.downtime_min));
  const worstDown = ms.slice().sort((a, b) => b.downtime_min - a.downtime_min)[0];
  const mostFaults = ms.slice().sort((a, b) => b.failures - a.failures)[0];
  const card = (title, icn, cls, value, sub, small) => html`<div class="kpi"><div><small>${title}</small><h3 class="${small ? 'sm' : ''}">${value}</h3><p class="t-slate">${sub}</p></div><div class="ico ${cls}">${ic(icn)}</div></div>`;
  const empty = '-';
  const cols = unit => html`<th>${unit}</th>`;
  const none = !k.wo_created && !k.wo_closed;

  put($('#izvestaji'), html`${head}
    ${none ? html`<div class="card"><div class="empty">Nema naloga u izabranom periodu (${fDate(R.from)} - ${fDate(R.to)}).</div></div>` : ''}
    <div class="grid kpis">
      ${card('Prijavljeno naloga', 'clipboard', 'i-blue', k.wo_created, `od toga kvarova: ${k.faults}`)}
      ${card('Završeno naloga', 'checkcircle', 'i-green', k.wo_closed, `trenutno otvorenih: ${k.open_now}`)}
      ${card('Prosečno vreme popravke', 'timer', 'i-amber', k.mttr_min == null ? empty : fMin(k.mttr_min), 'kvarovi: od prijave do zatvaranja', true)}
      ${card('Ukupan zastoj', 'activity', 'i-red', fMin(k.downtime_min), 'iz zatvorenih naloga', true)}
      ${card('Trošak delova', 'box', 'i-slate', fMoney(k.parts_cost), 'RSD, utrošeno u periodu', true)}
      ${card('Vrednost zaliha', 'layers', 'i-slate', fMoney(k.stock_value), 'RSD, trenutno u magacinu', true)}
      ${card('Najviše kvarova', 'alert', 'i-red', mostFaults && mostFaults.failures ? mostFaults.code : empty, mostFaults && mostFaults.failures ? `${mostFaults.failures} kvarova · ${mostFaults.name}` : 'nema kvarova', true)}
      ${card('Najveći zastoj', 'clock', 'i-amber', worstDown && worstDown.downtime_min ? worstDown.code : empty, worstDown && worstDown.downtime_min ? `${fMin(worstDown.downtime_min)} · ${worstDown.name}` : 'nema zastoja', true)}
    </div>
    ${R.series.some(x => x.created || x.closed) ? html`<div class="card"><div class="card-h"><h3>${ic('activity')} Nalozi po ${R.unit === 'day' ? 'danima' : 'mesecima'}</h3>
        <div class="legend"><span style="--c:#2563eb">Otvoreno</span><span style="--c:#16a34a">Završeno</span></div></div><div class="card-b">${raw(reportChart(R))}</div></div>` : ''}
    <div class="card"><div class="card-h"><h3>${ic('cpu')} Mašine: kvarovi, zastoj i trošak delova</h3></div><div class="tw"><table><thead><tr><th>Mašina</th><th>Naloga</th><th>Kvarova</th><th>Zastoj</th><th>Prosečna popravka</th><th class="r">Trošak delova</th></tr></thead><tbody>
      ${ms.length ? ms.map(m => html`<tr><td><b>${m.code}</b><small>${m.name}</small></td><td>${m.wo_total}</td><td>${m.failures}</td>
        <td style="min-width:150px"><b>${fMin(m.downtime_min)}</b><div class="bar" style="margin-top:4px"><i style="width:${Math.round(m.downtime_min / maxDown * 100)}%"></i></div></td>
        <td>${m.mttr_min == null ? '-' : fMin(m.mttr_min)}</td><td class="r nw">${fMoney(m.parts_cost)}</td></tr>`) : html`<tr><td colspan="6" class="empty">Nema podataka.</td></tr>`}</tbody></table></div></div>
    <div class="grid cols2">
      <div class="card"><div class="card-h"><h3>${ic('box')} Najviše utrošeni delovi</h3></div><div class="tw"><table><thead><tr><th>Deo</th><th>Količina</th><th class="r">Vrednost</th></tr></thead><tbody>
        ${R.top_parts.length ? R.top_parts.map(p => html`<tr><td><b>${p.name || '?'}</b><small>${p.code || ''}</small></td><td class="nw">${fNum(p.qty)} ${p.unit || ''}</td><td class="r nw">${fMoney(p.cost)}</td></tr>`) : html`<tr><td colspan="3" class="empty">Nema utrošenih delova.</td></tr>`}</tbody></table></div></div>
      <div class="card"><div class="card-h"><h3>${ic('wrench')} Opterećenje majstora</h3></div><div class="tw"><table><thead><tr><th>Majstor</th><th>Zaduženo</th><th>Završeno</th><th>Prosečna popravka</th></tr></thead><tbody>
        ${R.by_worker.length ? R.by_worker.map(w => html`<tr><td><b>${w.name}</b></td><td>${w.assigned}</td><td>${w.closed}</td><td>${w.mttr_min == null ? '-' : fMin(w.mttr_min)}</td></tr>`) : html`<tr><td colspan="4" class="empty">Nema zaduženih naloga.</td></tr>`}</tbody></table></div></div>
      <div class="card"><div class="card-h"><h3>${ic('users')} Prijave po operaterima</h3></div><div class="tw"><table><thead><tr><th>Operater</th><th>Prijava</th><th>Kvarova</th><th>Zastoj</th></tr></thead><tbody>
        ${R.by_operator.length ? R.by_operator.map(o => html`<tr><td><b>${o.name}</b></td><td>${o.reports}</td><td>${o.faults}</td><td>${fMin(o.downtime_min)}</td></tr>`) : html`<tr><td colspan="4" class="empty">Nema prijava sa navedenim operaterom.</td></tr>`}</tbody></table></div></div>
      <div class="card"><div class="card-h"><h3>${ic('layers')} Struktura naloga</h3></div><div class="card-b">
        ${['KVAR', 'PREVENTIVA', 'INSPEKCIJA'].map(t => html`<div class="stat-row"><span>${TYPE[t]}</span><b>${(R.by_type.find(x => x.type === t) || { n: 0 }).n}</b></div>`)}
        ${['VISOK', 'SREDNJI', 'NIZAK'].map(p => html`<div class="stat-row"><span>Prioritet: ${PRIO[p]}</span><b>${(R.by_priority.find(x => x.priority === p) || { n: 0 }).n}</b></div>`)}</div></div>
    </div>`);
}

const RENDER = { dashboard: renderDashboard, 'radni-nalozi': renderNaloge, magacin: renderMagacin, preventiva: renderPreventiva, izvestaji: renderIzvestaji, sifarnici: renderSifarnici };
const TITLES = { dashboard: 'Kontrolna Tabla', 'radni-nalozi': 'Radni Nalozi', magacin: 'Magacin Zaliha', preventiva: 'Preventiva & Alarmi', izvestaji: 'Izveštaji', sifarnici: 'Baza Podataka' };

function renderAll() {
  refreshNav();
  RENDER[App.tab]();
}
