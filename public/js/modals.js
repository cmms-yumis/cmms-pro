'use strict';
/* ===== Modali, forme i akcije ===== */

const busy = (btn, on) => { if (btn) { btn.disabled = on; } };

// ---------------- RADNI NALOG ----------------
async function woModal(id, preset = {}) {
  let wo = null;
  if (id) { try { wo = await GET('/api/workorders/' + id); } catch (e) { return fail(e); } }
  const full = can('wo.write');
  if (wo && !full) return woView(wo);
  if (!App.d.machines.length) return toast('Prvo dodajte mašinu u „Bazi Podataka“.', 'err');

  const isNew = !wo, closed = wo && wo.status === 'ZAVRSEN';
  const now = new Date();
  const machineId = wo ? wo.machine_id : preset.machine_id || '';
  const dStart = wo ? wo.created_at : now.toISOString();
  const dEnd = wo && wo.closed_at ? wo.closed_at : now.toISOString();
  // novi nalog: ako se ime prijavljenog korisnika poklapa sa operaterom, on je vec izabran kao "Prijavio"
  const defOp = isNew && App.user ? App.d.operators.find(o => o.name.trim().toLowerCase() === String(App.user.fullname || '').trim().toLowerCase()) : null;
  const title = isNew ? (full ? 'Novi Radni Nalog' : 'Prijava Kvara') : 'Radni Nalog ' + wo.number;

  const stockOpts = App.d.inventory.filter(i => i.quantity > 0);
  const m = openModal(html`
    ${dlgHead('clipcheck', title)}
    <div class="dlg-b"><form id="wo-form" class="form" data-form="wo" data-id="${wo ? wo.id : ''}" novalidate>
      ${canAccept(wo) ? html`<div class="notice" style="align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;background:var(--amber-50);border-color:#fde68a;color:#92400e"><span>${ic('bell')} ${wo.worker_id ? 'Nalog vam je dodeljen. Potvrdite prijem.' : 'Ovaj nalog još niko nije prihvatio.'}</span>
        <button type="button" class="btn btn-primary" data-act="accept-wo" data-id="${wo.id}">${ic('check')} ${wo.worker_id ? 'Potvrdi prijem' : 'Prihvati nalog'}</button></div>`
        : wo && !wo.worker_id && wo.status === 'OTVOREN' && can('wo.write') && !App.user.worker_id ? html`<div class="notice">${ic('info')}<span>Da biste mogli da prihvatate naloge, administrator mora da poveže vaš nalog sa majstorom (Baza Podataka → Korisnici Sistema).</span></div>` : ''}
      ${wo && wo.preventive_id ? html`<div class="notice">${ic('info')}<span>Ovaj radni nalog je otvoren iz Preventivnog plana. Po označavanju kao <b>ZAVRŠENO</b> i čuvanju, rok preventivnog servisa biće automatski pomeren u krug.</span></div>` : ''}
      ${!full ? html`<div class="notice">${ic('bell')}<span>Po slanju prijave, majstori održavanja odmah dobijaju obaveštenje.</span></div>` : ''}
      <div class="row2"><div class="f"><label>Mašina / Industrijsko Postrojenje</label><select name="machine_id" required>${opts(App.d.machines, machineId, mLabel, isNew && !machineId ? 'Izaberite mašinu...' : '')}</select></div>
        ${full ? html`<div class="f"><label>Datum i Vreme Otvaranja</label><div class="row2" style="gap:8px"><input type="date" name="d1" value="${inDate(dStart)}" required><input type="time" name="t1" value="${inTime(dStart)}" required></div></div>` : ''}</div>
      <div class="row2">${full ? html`<div class="f"><label>Tip Održavanja</label><select name="type">
          ${['KVAR', 'PREVENTIVA', 'INSPEKCIJA'].map(t => html`<option value="${t}" ${(wo ? wo.type : preset.type || 'KVAR') === t ? raw('selected') : ''}>${{ KVAR: 'Korektivno (Vanredni Kvar)', PREVENTIVA: 'Preventivno (Redovni Servis)', INSPEKCIJA: 'Vizuelna Inspekcija & Dijagnostika' }[t]}</option>`)}</select></div>` : ''}
        <div class="f"><label>Prioritet Sanacije</label><select name="priority">
          ${[['NIZAK', 'Nizak (Ne ometa rad)'], ['SREDNJI', 'Srednji (Smanjen kapacitet)'], ['VISOK', 'Visok (HITNO - Zastoj linije)']].map(([v, l]) => html`<option value="${v}" ${(wo ? wo.priority : 'SREDNJI') === v ? raw('selected') : ''}>${l}</option>`)}</select></div></div>
      <div class="row2"><div class="f"><label>Prijavio / Pokrenuo</label><select name="operator_id">${opts(App.d.operators, wo ? wo.operator_id : defOp ? defOp.id : '', o => o.name, '- nije navedeno -')}</select></div>
        ${full ? html`<div class="f"><label>Zaduženi Serviser (Majstor)</label><select name="worker_id">${opts(activeWorkers(), wo ? wo.worker_id : '', w => w.fullname, '- nije dodeljen -')}</select></div>` : ''}</div>
      <div class="f"><label>Opis Servisnog Zadatka / Problem</label><textarea name="description" rows="2" placeholder="Opišite šta se desilo..." required maxlength="2000">${wo ? wo.description : ''}</textarea></div>

      ${full ? html`<div class="box green" id="wo-done-box">
        <div class="f"><label>Opis Izvedenih Servisnih Radova</label><textarea name="resolution" rows="2" placeholder="Detaljno opišite šta je popravljeno, zamenjeno ili podešeno..." maxlength="2000">${wo && wo.resolution ? wo.resolution : ''}</textarea></div>
        <div class="f"><div style="display:flex;justify-content:space-between;align-items:center"><label>Ugrađeni Delovi (automatsko skidanje sa magacina)</label>
            <button type="button" class="btn btn-soft btn-sm" data-act="add-part-row" ${stockOpts.length ? '' : raw('disabled')}>${ic('plus')} Dodaj deo</button></div>
          <div id="wo-parts" style="display:flex;flex-direction:column;gap:8px">
            ${wo && wo.parts.map(p => html`<div class="part-row ex"><span><b>${p.name}</b> <span class="mono">${p.code}</span></span><span class="nw">${fNum(p.quantity)} ${p.unit}</span>
              <button type="button" class="ib del" title="Vrati u magacin" data-act="rm-part" data-wo="${wo.id}" data-part="${p.id}">${ic('trash')}</button></div>`)}
            <div id="wo-new-parts" style="display:flex;flex-direction:column;gap:8px"></div></div>
          ${stockOpts.length ? '' : html`<p class="hint">Nema artikala na stanju u magacinu.</p>`}</div>
        <label class="chk"><input type="checkbox" name="done" ${closed ? raw('checked') : ''}> Označi kao ZAVRŠENO (Izvrši i zatvori radni nalog)</label>
        <div id="wo-done-det" class="row2" ${closed ? '' : raw('hidden')}>
          <div class="f"><label>Vreme Završetka</label><div class="row2" style="gap:8px"><input type="date" name="d2" value="${inDate(dEnd)}"><input type="time" name="t2" value="${inTime(dEnd)}"></div></div>
          <div class="f"><label>Ukupan Zastoj Mašine</label><div id="wo-down" class="badge b-u_toku" style="padding:10px 12px;font-size:13px;justify-content:center">-</div></div></div>
      </div>` : ''}
    </form></div>
    <div class="dlg-f">${wo ? html`<button type="button" class="btn btn-ind" data-act="print-wo" data-id="${wo.id}">${ic('printer')} Štampaj Nalog</button>` : html`<span></span>`}
      <div class="r"><button type="button" class="btn btn-line" data-act="close-modal">Odustani</button><button type="submit" form="wo-form" class="btn btn-primary" id="wo-save">${ic('check')} ${full ? 'Sačuvaj Nalog' : 'Pošalji Prijavu'}</button></div></div>`, { size: 'lg' });

  m.stockOpts = stockOpts;
  m.wo = wo;
  if (full) calcDowntime(m);
}

function woView(wo) {
  openModal(html`${dlgHead('clipcheck', 'Radni Nalog ' + wo.number)}
    <div class="dlg-b"><div class="row2"><div><span class="lbl">Mašina</span><p style="margin:2px 0"><b>${wo.machine_code}</b> - ${wo.machine_name}</p></div>
      <div><span class="lbl">Status</span><p style="margin:2px 0">${statusBadge(wo.status)} ${prioBadge(wo.priority)}</p></div>
      <div><span class="lbl">Otvoren</span><p style="margin:2px 0">${fDT(wo.created_at)}</p></div><div><span class="lbl">Serviser</span><p style="margin:2px 0">${wo.worker_name || '-'}</p></div></div>
      <div><span class="lbl">Opis</span><p style="margin:2px 0;white-space:pre-wrap">${wo.description}</p></div>
      ${wo.resolution ? html`<div><span class="lbl">Izvedeni radovi</span><p style="margin:2px 0;white-space:pre-wrap">${wo.resolution}</p></div>` : ''}</div>
    <div class="dlg-f"><button class="btn btn-ind" data-act="print-wo" data-id="${wo.id}">${ic('printer')} Štampaj</button><div class="r"><button class="btn btn-line" data-act="close-modal">Zatvori</button></div></div>`);
}

function calcDowntime(m) {
  const f = $('#wo-form', m); if (!f || !f.elements.d2) return;
  const out = $('#wo-down', m);
  const isKvar = f.type.value === 'KVAR';
  const a = iso(f.d1.value, f.t1.value), b = iso(f.d2.value, f.t2.value);
  if (!isKvar) { out.textContent = 'Nije kvar - zastoj se ne računa'; out.dataset.min = '0'; return; }
  if (!a || !b) { out.textContent = '-'; return; }
  const min = Math.round((new Date(b) - new Date(a)) / 60000);
  out.dataset.min = String(Math.max(0, min));
  out.textContent = min < 0 ? 'Završetak je pre otvaranja!' : fMin(min);
}

async function saveWo(form, btn) {
  if (form.dataset.busy === '1') return;            // zastita od dvostrukog klika
  const m = form.closest('.modal');
  const full = can('wo.write');
  const el = n => form.elements[n];
  const v = n => (el(n) ? el(n).value : '');
  let id = form.dataset.id ? Number(form.dataset.id) : null;
  if (!v('machine_id')) return toast('Izaberite mašinu', 'err');
  if (!v('description').trim()) return toast('Unesite opis problema', 'err');
  const done = full && !!el('done') && el('done').checked;
  if (done && !v('resolution').trim() && !await confirmBox('Nalog bez opisa radova', 'Niste upisali šta je urađeno. Želite li ipak da zatvorite nalog?', 'Zatvori nalog', false)) return;

  const body = {
    machine_id: Number(v('machine_id')), priority: v('priority'), description: v('description').trim(),
    operator_id: v('operator_id') ? Number(v('operator_id')) : null
  };
  if (full) Object.assign(body, { type: v('type'), worker_id: v('worker_id') ? Number(v('worker_id')) : null, opened_at: iso(v('d1'), v('t1')) });

  form.dataset.busy = '1'; busy(btn, true);
  try {
    if (!id) {
      const r = await POST('/api/workorders', body);
      if (r.queued) { closeModal(m); return; }
      id = r.id; form.dataset.id = String(id);      // ako nesto dalje pukne, ponovni klik menja ovaj nalog, ne pravi novi
      if (!full) {                                   // operater: prijava je gotova
        closeModal(m);
        toast(`Kvar je prijavljen (${r.number}). Majstori su obavešteni.`);
        return;
      }
    } else {
      await PUT('/api/workorders/' + id, body);
    }

    for (const row of $$('.part-row.new', m)) {
      const inv = row.querySelector('select').value, q = Number(row.querySelector('input[type=number]').value);
      if (inv && q > 0) { await POST(`/api/workorders/${id}/parts`, { inventory_id: Number(inv), quantity: q }); }
      row.remove();                                  // uneto: da ponovni pokusaj ne skine deo dvaput
    }
    const patch = { resolution: v('resolution').trim() };
    if (done) {
      patch.status = 'ZAVRSEN';
      patch.closed_at = iso(v('d2'), v('t2'));
      if (body.type === 'KVAR') patch.downtime_min = Number($('#wo-down', m).dataset.min || 0);
    } else if (m.wo && m.wo.status === 'ZAVRSEN') patch.status = body.worker_id ? 'U_TOKU' : 'OTVOREN';
    await PUT('/api/workorders/' + id, patch);
    closeModal(m);
    toast(done ? 'Nalog je zatvoren.' : form.dataset.id && m.wo ? 'Nalog je sačuvan.' : 'Nalog je otvoren.');
  } catch (e) { fail(e); }
  finally { form.dataset.busy = ''; busy(btn, false); loadAll(); }
}

// ---------------- PREVENTIVNI PLAN ----------------
function pmModal(id) {
  const p = id ? byId(App.d.preventive, id) : null;
  if (!App.d.machines.length) return toast('Prvo dodajte mašinu.', 'err');
  openModal(html`${dlgHead('calendar', p ? 'Izmena Preventivnog Plana' : 'Novi Preventivni Plan Po Mašini')}
    <form data-form="pm" data-id="${p ? p.id : ''}"><div class="dlg-b">
      <div class="f"><label>Mašina / Oprema</label><select name="machine_id" required>${opts(App.d.machines, p ? p.machine_id : '', mLabel, 'Izaberite mašinu...')}</select></div>
      <div class="f"><label>Naziv Planiranog Servisa</label><input type="text" name="title" required maxlength="200" value="${p ? p.title : ''}" placeholder="npr. Podmazivanje ležajeva i provera nivoa ulja"></div>
      <div class="f"><label>Opis / Kontrolna lista (opciono)</label><textarea name="description" rows="2" maxlength="1000">${p ? p.description || '' : ''}</textarea></div>
      <div class="row2"><div class="f"><label>Period Ponavljanja</label><select name="period_type">
          ${Object.entries(PERIOD).map(([k, l]) => html`<option value="${k}" ${(p ? p.period_type : 'MESECNA') === k ? raw('selected') : ''}>${l}</option>`)}</select></div>
        <div class="f"><label>Prvi / Sledeći Rok</label><input type="date" name="next_date" required value="${p ? p.next_date : todayStr()}"></div></div>
      <div class="f"><label>Zaduženi Majstor (Održavanje)</label><select name="worker_id">${opts(activeWorkers(), p ? p.worker_id : '', w => w.fullname, '- nije dodeljen -')}</select></div>
      ${p ? html`<label class="chk"><input type="checkbox" name="paused" ${p.status !== 'AKTIVNA' ? raw('checked') : ''}> Pauziraj plan (ne otvara naloge)</label>` : ''}
    </div><div class="dlg-f"><span></span><div class="r"><button type="button" class="btn btn-line" data-act="close-modal">Odustani</button><button type="submit" class="btn btn-primary">Sačuvaj Plan</button></div></div></form>`);
}

// ---------------- MASINA ----------------
function machineModal(id) {
  const m = byId(App.d.machines, id); if (!m) return;
  openModal(html`${dlgHead('cpu', 'Mašina ' + m.code)}
    <form data-form="machine" data-id="${m.id}"><div class="dlg-b">
      <div class="row2"><div class="f"><label>Šifra / Oznaka</label><input type="text" name="code" required maxlength="60" value="${m.code}"></div><div class="f"><label>Naziv</label><input type="text" name="name" required maxlength="200" value="${m.name}"></div></div>
      <div class="row2"><div class="f"><label>Proizvođač</label><input type="text" name="manufacturer" value="${m.manufacturer || ''}"></div><div class="f"><label>Model</label><input type="text" name="model" value="${m.model || ''}"></div></div>
      <div class="row2"><div class="f"><label>Serijski broj</label><input type="text" name="serial_number" value="${m.serial_number || ''}"></div><div class="f"><label>Lokacija</label><input type="text" name="location" value="${m.location || ''}"></div></div>
      <div class="f"><label>Napomena</label><textarea name="notes" rows="2">${m.notes || ''}</textarea></div>
      <div class="qrbox"><img src="/api/machines/${m.id}/qr.png" alt="QR kod"><div><b>QR kod mašine</b><p class="hint">Nalepite ga na mašinu. Skeniranjem telefon otvara aplikaciju i odmah nudi prijavu kvara.</p>
        <button type="button" class="btn btn-soft btn-sm" data-act="qr-machine" data-id="${m.id}">${ic('printer')} Štampaj nalepnicu</button></div></div>
    </div><div class="dlg-f"><span></span><div class="r"><button type="button" class="btn btn-line" data-act="close-modal">Odustani</button><button type="submit" class="btn btn-primary">Sačuvaj</button></div></div></form>`);
}

// ---------------- ARTIKAL ----------------
function itemModal(id) {
  const i = byId(App.d.inventory, id); if (!i) return;
  openModal(html`${dlgHead('box', 'Artikal ' + i.code)}
    <form data-form="item" data-id="${i.id}"><div class="dlg-b">
      <div class="row2"><div class="f"><label>SKU Šifra</label><input type="text" name="code" required value="${i.code}"></div><div class="f"><label>Naziv</label><input type="text" name="name" required value="${i.name}"></div></div>
      <div class="row2"><div class="f"><label>Lokacija</label><input type="text" name="location" value="${i.location || ''}"></div><div class="f"><label>Dobavljač</label><input type="text" name="supplier" value="${i.supplier || ''}"></div></div>
      <div class="row2"><div class="f"><label>Min. zaliha</label><input type="number" step="any" min="0" name="minimum" value="${i.minimum}"></div><div class="f"><label>Jedinica</label><input type="text" name="unit" value="${i.unit || 'kom'}"></div></div>
      <div class="row2"><div class="f"><label>Jed. cena (RSD)</label><input type="number" step="any" min="0" name="unit_price" value="${i.unit_price || 0}"></div>
        <div class="f"><label>Stanje (korekcija popisa)</label><input type="number" step="any" min="0" name="quantity" value="${i.quantity}"></div></div>
      <p class="hint">Promena stanja upisuje se u dnevnik prometa kao „korekcija popisa“.</p>
    </div><div class="dlg-f"><span></span><div class="r"><button type="button" class="btn btn-line" data-act="close-modal">Odustani</button><button type="submit" class="btn btn-primary">Sačuvaj</button></div></div></form>`);
}

// ---------------- KORISNIK / RADNIK ----------------
function userModal(id) {
  const u = id ? (App.users || []).find(x => x.id === Number(id)) : null;
  openModal(html`${dlgHead('key', u ? 'Izmena korisnika' : 'Novi korisnik')}
    <form data-form="user" data-id="${u ? u.id : ''}"><div class="dlg-b">
      <div class="row2"><div class="f"><label>Korisničko ime</label><input type="text" name="username" ${u ? raw('disabled') : raw('required')} value="${u ? u.username : ''}" autocapitalize="none" placeholder="npr. marko"></div>
        <div class="f"><label>Ime i prezime</label><input type="text" name="fullname" value="${u ? u.fullname || '' : ''}"></div></div>
      <div class="row2"><div class="f"><label>Uloga</label><select name="role">${Object.entries(ROLE).map(([k, l]) => html`<option value="${k}" ${(u ? u.role : 'MAJSTOR') === k ? raw('selected') : ''}>${l}</option>`)}</select></div>
        <div class="f"><label>${u ? 'Nova lozinka (ostavite prazno)' : 'Lozinka (min. 8 znakova)'}</label><input type="password" name="password" autocomplete="new-password" ${u ? '' : raw('required')} minlength="8"></div></div>
      <div class="row2"><div class="f"><label>Povezani majstor (za prihvatanje naloga)</label><select name="worker_id">${opts(App.d.workers, u ? u.worker_id : '', w => w.fullname, '- nije povezan -')}</select></div>
        <div class="f"><label>Obaveštenja o novim nalozima</label><select name="notify">${[['', 'Podrazumevano (samo majstori)'], ['1', 'Uvek'], ['0', 'Nikad']].map(([k, l]) => html`<option value="${k}" ${String(u && u.notify != null ? u.notify : '') === k ? raw('selected') : ''}>${l}</option>`)}</select></div></div>
      ${u ? html`<label class="chk"><input type="checkbox" name="active" ${u.active ? raw('checked') : ''}> Aktivan nalog</label>` : ''}
      <p class="hint"><b>Operater</b> samo prijavljuje kvarove · <b>Majstor</b> radi naloge i magacin · <b>Menadžer</b> i planove/mašine · <b>Administrator</b> sve, uključujući korisnike i backup. Korisnik pri prvoj prijavi menja lozinku.</p>
    </div><div class="dlg-f"><span></span><div class="r"><button type="button" class="btn btn-line" data-act="close-modal">Odustani</button><button type="submit" class="btn btn-primary">Sačuvaj</button></div></div></form>`);
}

function renameModal(kind, id) {
  const list = kind === 'worker' ? App.d.workers : App.d.operators;
  const it = byId(list, id); if (!it) return;
  openModal(html`${dlgHead(kind === 'worker' ? 'wrench' : 'users', 'Izmena')}
    <form data-form="rename-${kind}" data-id="${it.id}"><div class="dlg-b"><div class="f"><label>${kind === 'worker' ? 'Ime i specijalnost' : 'Ime / Sektor'}</label><input type="text" name="name" required value="${kind === 'worker' ? it.fullname : it.name}"></div>
      ${kind === 'worker' ? html`<div class="f"><label>Telefon</label><input type="text" name="phone" value="${it.phone || ''}"></div><label class="chk"><input type="checkbox" name="active" ${it.status !== 'NEAKTIVAN' ? raw('checked') : ''}> Aktivan</label>` : ''}</div>
      <div class="dlg-f"><span></span><div class="r"><button type="button" class="btn btn-line" data-act="close-modal">Odustani</button><button type="submit" class="btn btn-primary">Sačuvaj</button></div></div></form>`, { size: 'sm' });
}

// ---------------- LOZINKA ----------------
function pwModal(forced) {
  openModal(html`${dlgHead('key', forced ? 'Postavite novu lozinku' : 'Promena lozinke')}
    <form data-form="pw"><div class="dlg-b">${forced ? html`<div class="notice">${ic('info')}<span>Trenutna lozinka je privremena. Preporučujemo da je odmah promenite. Ako sada ne želite, izaberite „Kasnije“ - na vrhu ekrana ostaje traka sa dugmetom za promenu.</span></div>` : ''}
      <div class="f"><label>Trenutna lozinka</label><input type="password" name="current" autocomplete="current-password" required></div>
      <div class="f"><label>Nova lozinka (min. 8 znakova)</label><input type="password" name="next" autocomplete="new-password" required minlength="8"></div>
      <div class="f"><label>Ponovite novu lozinku</label><input type="password" name="again" autocomplete="new-password" required minlength="8"></div></div>
      <div class="dlg-f"><span></span><div class="r"><button type="button" class="btn btn-line" data-act="close-modal">${forced ? 'Kasnije' : 'Odustani'}</button><button type="submit" class="btn btn-primary">Sačuvaj lozinku</button></div></div></form>`, { size: 'sm' });
}

// ---------------- IZVOZ / STAMPA ----------------
function exportModal() {
  const withPm = App.d.machines;
  openModal(html`${dlgHead('printer', 'Izvještaji i Štampa')}
    <div class="dlg-b">
      <div class="box"><b style="display:flex;gap:8px;align-items:center">${ic('cpu', 't-blue')} Karta Kvarova i Održavanja Po Mašini</b><p class="hint">Razdvaja kvarove i preventivno održavanje uz prikaz zastoja.</p>
        <div class="btns" style="flex-wrap:nowrap"><select id="exp-machine">${opts(withPm, '', mLabel, 'Izaberite mašinu...')}</select><button class="btn btn-dark" data-act="print-machine">${ic('printer')} Štampaj</button></div></div>
      <div class="box"><b style="display:flex;gap:8px;align-items:center">${ic('users', 't-blue')} Zbirna Štampa Po Serviseru / Majstoru</b><p class="hint">Štampanje radnih naloga grupisanih po imenu servisera na koga su zaduženi.</p>
        <div class="btns" style="flex-wrap:nowrap"><select id="exp-worker">${opts(App.d.workers, '', w => w.fullname, 'Svi serviseri')}</select><button class="btn btn-dark" data-act="print-worker-sel">${ic('printer')} Štampaj</button></div></div>
      <div class="box"><b style="display:flex;gap:8px;align-items:center">${ic('users', 't-blue')} Kvarovi Po Operateru Proizvodnje</b><p class="hint">Koji kvarovi su prijavljeni od kog operatera, uz broj prijava i zastoj.</p>
        <div class="btns" style="flex-wrap:nowrap"><select id="exp-operator">${opts(App.d.operators, '', o => o.name, 'Svi operateri')}</select><button class="btn btn-dark" data-act="print-operator-sel">${ic('printer')} Štampaj</button></div></div>
      <button class="exp-item" data-act="print-pm"><div><b>Planovi Preventivnog Održavanja Po Mašinama</b><span>Kompletan pregled zadataka i rokova po mašinama</span></div>${ic('printer')}</button>
      <button class="exp-item" data-act="print-wos"><div><b>Zbirni Izvještaj Radnih Naloga</b><span>Štampa svih evidentiranih kvarova i servisa</span></div>${ic('printer')}</button>
      <button class="exp-item" data-act="print-stock"><div><b>Izvještaj Magacinskih Zaliha</b><span>Kompletan inventar rezervnih delova sa stanjima</span></div>${ic('printer')}</button>
      ${can('export') ? html`<div class="box"><b style="display:flex;gap:8px;align-items:center">${ic('download', 't-blue')} Izvoz u Excel</b><div class="btns">
        ${[['workorders', 'Radni nalozi'], ['inventory', 'Magacin'], ['machines', 'Mašine'], ['downtime', 'Zastoji']].map(([k, l]) => html`<a class="btn btn-soft btn-sm" href="/api/export/${k}.xlsx" download>${ic('download')} ${l}</a>`)}</div></div>` : ''}
    </div>`);
}

// ---------------- MOBILNI PRISTUP ----------------
async function mobileModal() {
  let info;
  try { info = await GET('/api/server-info'); App.info = info; } catch (e) { return fail(e); }
  const cur = location.origin;
  const urls = [...(info.public_url ? [{ iface: 'Javna adresa', url: info.public_url }] : []), ...info.urls];
  if (!urls.some(u => u.url === cur) && !/localhost|127\.0\.0\.1/.test(cur)) urls.unshift({ iface: 'Ova adresa', url: cur });
  const main = urls[0] ? urls[0].url : cur;
  openModal(html`${dlgHead('wifi', 'Mobilni Pristup')}
    <div class="dlg-b">
      <div class="notice">${ic('info')}<span>Telefon, tablet i računar otvaraju istu aplikaciju u pregledaču. Podaci su na ovom serveru, pa svaki unos odmah vide svi korisnici.</span></div>
      <div class="qrbox"><img id="mob-qr" src="/api/qr.png?url=${encodeURIComponent(main)}" alt="QR kod adrese"><div style="flex:1;min-width:200px"><b>Skeniraj telefonom</b><p class="hint">Telefon mora biti na istoj (Wi-Fi) mreži kao server.</p></div></div>
      <div class="lbl">Adrese servera (dodirni za kopiranje, klik na ikonu za QR)</div>
      ${urls.length ? urls.map(u => html`<div class="url" data-act="copy" data-text="${u.url}"><span>${u.url} <small class="sub" style="display:inline">${u.iface}</small></span><span data-act="mob-qr" data-url="${u.url}" title="Prikaži QR">${ic('qr')}</span></div>`) : html`<p class="hint">Server nema aktivnu mrežnu karticu.</p>`}
      <div class="box"><b>Kako na početni ekran telefona</b><ol class="steps"><li><b>Android (Chrome):</b> meni ⋮ → „Dodaj na početni ekran“ / „Instaliraj aplikaciju“.</li><li><b>iPhone (Safari):</b> dugme Podeli → „Dodaj na početni ekran“.</li><li>Prijava kvara: jedan dodir na „Prijavi Kvar“. Bez veze se prijava čuva na telefonu i šalje sama.</li></ol></div>
      <div class="box"><b>Druge mreže i internet</b><p class="hint" style="margin:0">Uređaji iz drugih podmreža (npr. 192.168.0.x do 192.168.3.x) koriste istu adresu ako su mreže međusobno povezane; ako ne rade, na serveru pokrenite <b>firewall.bat</b> kao administrator. Za pristup van firme koristite Tailscale ili Cloudflare Tunnel (vidi <b>PROCITAJ-ME.txt</b>), a dobijenu https adresu upišite u „Baza Podataka → Podešavanja“.</p></div>
    </div><div class="dlg-f"><span></span><div class="r"><button class="btn btn-primary" data-act="close-modal">U redu</button></div></div>`, { size: 'lg' });
}

// ---------------- OBAVESTENJA (samo Android aplikacija) ----------------
function alertsModal() {
  const A = window.AndroidApp;
  if (!A || !A.alertsStatus) return toast('Obaveštenja su dostupna u Android aplikaciji.', 'err');
  let st = {};
  try { st = JSON.parse(A.alertsStatus()); } catch (_) {}
  const row = (ok, title, desc, btnLabel, attrs) => html`<div class="box" style="flex-direction:row;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
    <div style="flex:1;min-width:180px"><b style="display:flex;gap:8px;align-items:center">${ic(ok ? 'checkcircle' : 'alert', ok ? 't-green' : 't-amber')} ${title}</b><p class="hint" style="margin-top:3px">${desc}</p></div>
    ${btnLabel ? html`<button class="btn ${ok ? 'btn-soft' : 'btn-primary'} btn-sm" data-act="android-set" ${raw(attrs)}>${btnLabel}</button>` : ''}</div>`;
  const m = openModal(html`${dlgHead('bell', 'Obaveštenja o novim nalozima')}
    <div class="dlg-b" id="alerts-dlg-b">
      <div class="notice">${ic('info')}<span>Kad se prijavi novi kvar, telefon zvoni čak i kad je aplikacija zatvorena. Dodir na obaveštenje otvara nalog, a dugme <b>Prihvati</b> ga odmah preuzima.</span></div>
      ${row(!!st.enabled, st.enabled ? 'Obaveštenja su uključena' : 'Obaveštenja su isključena', 'Aplikacija na svakih desetak sekundi proverava server i radi u pozadini (stalna ikona u traci).', st.enabled ? 'Isključi' : 'Uključi', `data-do="toggle" data-val="${st.enabled ? '0' : '1'}"`)}
      ${row(!!st.notifications, st.notifications ? 'Dozvola za obaveštenja je data' : 'Android blokira obaveštenja', 'Bez dozvole telefon neće prikazati ni zvuk ni poruku.', st.notifications ? '' : 'Dozvoli', 'data-do="perm"')}
      ${row(!!st.battery, st.battery ? 'Rad u pozadini je dozvoljen' : 'Štednja baterije može da zaustavi proveru', 'Dozvolite aplikaciji da radi u pozadini, inače Android ume da je uspava kad je ekran ugašen.', st.battery ? '' : 'Dozvoli', 'data-do="battery"')}
      ${row(!!App.user.worker_id, App.user.worker_id ? `Nalog je povezan sa majstorom: ${App.user.worker_name || ''}` : 'Nalog nije povezan sa majstorom', App.user.worker_id ? 'Možete da prihvatate naloge.' : 'Administrator mora da vas poveže u Baza Podataka → Korisnici Sistema, inače ne možete da prihvatite nalog.', '', '')}
      <button class="btn btn-ind" data-act="android-set" data-do="test">${ic('bell')} Pošalji probno obaveštenje</button>
    </div><div class="dlg-f"><span></span><div class="r"><button class="btn btn-primary" data-act="close-modal">U redu</button></div></div>`);
  m.id = 'alerts-dlg';
}

// ---------------- AKCIJE (klik) ----------------
const ACT = {
  nav: (d, el) => { if (el.dataset.close) $('#drawer').hidden = true; setTab(d.tab); },
  drawer: () => { const dr = $('#drawer'); dr.hidden = !dr.hidden; },
  'close-modal': (d, el) => closeModal(el),
  sync: async () => { await loadAll(true); toast('Podaci su osveženi sa servera.'); },
  logout: async () => { try { await POST('/api/auth/logout'); } catch (_) {} App.user = null; showLogin(); },
  'new-wo': (d) => woModal(null, d.machine ? { machine_id: Number(d.machine) } : {}),
  'open-wo': d => woModal(Number(d.id)),
  'print-wo': d => printJobCard(Number(d.id)),
  'del-wo': async d => { const w = byId(App.d.workorders, d.id); if (await confirmBox('Brisanje naloga', `Obrisati nalog ${w ? w.number : ''}? Ugrađeni delovi se vraćaju u magacin.`, 'Obriši')) { try { await DEL('/api/workorders/' + d.id); toast('Nalog je obrisan.'); loadAll(); } catch (e) { fail(e); } } },
  'add-part-row': (d, el) => {
    const m = el.closest('.modal'); const box = $('#wo-new-parts', m); const row = document.createElement('div'); row.className = 'part-row new';
    put(row, html`<input type="search" class="part-search" placeholder="Traži deo po nazivu ili šifri..." style="grid-column:1/-1" autocomplete="off">
      <select>${opts(m.stockOpts, '', itemLabel, 'Izaberite deo...')}</select><input type="number" min="0.01" step="any" value="1" aria-label="Količina"><button type="button" class="ib del" data-act="rm-row" aria-label="Ukloni">${ic('x')}</button>`);
    box.appendChild(row);
    $('.part-search', row).focus();
  },
  'rm-row': (d, el) => el.closest('.part-row').remove(),
  'rm-part': async (d, el) => {
    if (!await confirmBox('Vraćanje dela', 'Deo se uklanja sa naloga i vraća u magacin. Nastaviti?', 'Vrati u magacin', false)) return;
    try { await DEL(`/api/workorders/${d.wo}/parts/${d.part}`); toast('Deo je vraćen u magacin.'); const m = el.closest('.modal'); closeModal(m); loadAll(); woModal(Number(d.wo)); } catch (e) { fail(e); }
  },
  'run-pm': async d => { try { const r = await POST(`/api/preventive/${d.id}/generate`); toast('Otvoren nalog ' + r.number); await loadAll(); woModal(r.id); } catch (e) { fail(e); } },
  'new-pm': () => pmModal(null),
  'edit-pm': d => pmModal(Number(d.id)),
  'del-pm': async d => { if (await confirmBox('Brisanje plana', 'Obrisati ovaj preventivni plan? Otvoreni nalozi ostaju.', 'Obriši')) { try { await DEL('/api/preventive/' + d.id); loadAll(); } catch (e) { fail(e); } } },
  'edit-machine': d => machineModal(Number(d.id)),
  'del-machine': async d => { const m = byId(App.d.machines, d.id); if (await confirmBox('Arhiviranje mašine', `Arhivirati „${m ? m.name : ''}“? Istorija naloga ostaje sačuvana.`, 'Arhiviraj')) { try { await DEL('/api/machines/' + d.id); loadAll(); } catch (e) { fail(e); } } },
  'qr-machine': d => { const m = byId(App.d.machines, d.id); if (m) printQrLabel(m); },
  'edit-item': d => itemModal(Number(d.id)),
  'del-item': async d => { const i = byId(App.d.inventory, d.id); if (await confirmBox('Arhiviranje artikla', `Arhivirati „${i ? i.name : ''}“?`, 'Arhiviraj')) { try { await DEL('/api/inventory/' + d.id); loadAll(); } catch (e) { fail(e); } } },
  'edit-worker': d => renameModal('worker', Number(d.id)),
  'del-worker': async d => { const w = byId(App.d.workers, d.id); if (await confirmBox('Uklanjanje majstora', `Ukloniti „${w ? w.fullname : ''}“? Ako ima naloga, biće samo deaktiviran.`, 'Ukloni')) { try { const r = await DEL('/api/workers/' + d.id); toast(r.deactivated ? 'Majstor je deaktiviran (ima naloge).' : 'Majstor je uklonjen.'); loadAll(); } catch (e) { fail(e); } } },
  'edit-operator': d => renameModal('operator', Number(d.id)),
  'del-operator': async d => { if (await confirmBox('Brisanje operatera', 'Obrisati ovog operatera?', 'Obriši')) { try { await DEL('/api/operators/' + d.id); loadAll(); } catch (e) { fail(e); } } },
  'new-user': () => userModal(null),
  'edit-user': d => userModal(Number(d.id)),
  'del-user': async d => { if (await confirmBox('Deaktiviranje korisnika', 'Korisnik se više neće moći prijaviti.', 'Deaktiviraj')) { try { await DEL('/api/users/' + d.id); loadAdminLists(); } catch (e) { fail(e); } } },
  'backup-now': async (d, el) => {
    busy(el, true);
    try {
      const r = await POST('/api/backups');
      if (r.copy && !r.copy.skipped && !r.copy.ok) toast(`Backup je napravljen, ali kopiranje na drugo mesto nije uspelo: ${r.copy.error}`, 'err');
      else toast('Backup napravljen: ' + r.file + (r.copy && r.copy.ok && !r.copy.skipped ? ' i kopiran na drugo mesto.' : ''));
      loadAdminLists();
    } catch (e) { fail(e); }
    busy(el, false);
  },
  'backup-ext-now': async (d, el) => {
    busy(el, true);
    try {
      const r = await POST('/api/backups/external/sync');
      if (!r.dir) toast('Prvo upišite odredište i sačuvajte.', 'err');
      else if (r.result && r.result.ok) toast(r.result.copied && r.result.copied.length ? `Kopirano: ${r.result.copied.length} fajl(ova).` : 'Sve kopije su već na odredištu.');
      else toast('Kopiranje nije uspelo: ' + (r.result && r.result.error), 'err');
      loadAdminLists();
    } catch (e) { fail(e); }
    busy(el, false);
  },
  'tx-reset': () => { Object.assign(App.filters, { txFrom: '', txTo: '', txQ: '', txType: '', txWho: '' }); renderMagacin(); loadTx(); },
  'rep-preset': d => { applyPreset(d.p); loadReport(); },
  'rep-print': () => printReport(),
  'rep-csv': () => izvoziUCSV('izvestaj'),
  'pw-modal': () => pwModal(false),
  'export-modal': exportModal,
  'mobile-modal': mobileModal,
  'mob-qr': (d, el, e) => { e.stopPropagation(); const img = $('#mob-qr'); if (img) img.src = '/api/qr.png?url=' + encodeURIComponent(d.url); },
  copy: d => copyText(d.text),
  'android-server': () => { if (window.AndroidApp) window.AndroidApp.changeAddress(); },
  'android-alerts': () => alertsModal(),
  'android-set': (d) => { const A = window.AndroidApp; if (!A) return; if (d.do === 'toggle') A.setAlerts(d.val === '1'); else if (d.do === 'perm') A.requestNotifPermission(); else if (d.do === 'battery') A.requestBatteryExemption(); else if (d.do === 'test') A.testAlert(); setTimeout(() => { closeModal($('#alerts-dlg')); alertsModal(); }, 900); },
  'accept-wo': async (d, el) => {
    try {
      const r = await POST(`/api/workorders/${d.id}/accept`);
      toast(r.already ? 'Prijem je potvrđen.' : `Nalog ${r.number} je prihvaćen. Zaduženi ste vi.`);
      const m = el.closest('.modal'); if (m) closeModal(m);
    } catch (e) { fail(e); }
    loadAll();
  },
  csv: d => izvoziUCSV(d.what),
  'print-worker': () => printPerWorker(null),
  'print-operator': () => printPerOperator(null),
  'print-operator-sel': () => printPerOperator($('#exp-operator').value || null),
  'print-worker-sel': () => printPerWorker($('#exp-worker').value || null),
  'print-machine': () => { const v = $('#exp-machine').value; v ? printMachineCard(Number(v)) : toast('Izaberite mašinu', 'err'); },
  'print-pm': printPreventive, 'print-wos': printWorkorders, 'print-stock': printStock
};

// ---------------- FORME (submit) ----------------
const FORMS = {
  wo: (f, btn) => saveWo(f, btn),
  pm: async (f) => {
    const v = n => f.elements[n].value, id = f.dataset.id;
    const body = { machine_id: Number(v('machine_id')), title: v('title'), description: v('description'), period_type: v('period_type'), next_date: v('next_date'), worker_id: v('worker_id') ? Number(v('worker_id')) : null };
    if (id) body.status = f.elements.paused && f.elements.paused.checked ? 'PAUZIRANA' : 'AKTIVNA';
    try { id ? await PUT('/api/preventive/' + id, body) : await POST('/api/preventive', body); closeModal(f); toast('Plan je sačuvan.'); loadAll(); } catch (e) { fail(e); }
  },
  machine: async f => {
    const body = Object.fromEntries(['code', 'name', 'manufacturer', 'model', 'serial_number', 'location', 'notes'].map(k => [k, f.elements[k].value]));
    try { await PUT('/api/machines/' + f.dataset.id, body); closeModal(f); toast('Mašina je sačuvana.'); loadAll(); } catch (e) { fail(e); }
  },
  item: async f => {
    const v = n => f.elements[n].value, id = f.dataset.id, old = byId(App.d.inventory, id);
    try {
      await PUT('/api/inventory/' + id, { code: v('code'), name: v('name'), location: v('location'), supplier: v('supplier'), minimum: v('minimum'), unit: v('unit'), unit_price: v('unit_price') });
      if (old && Number(v('quantity')) !== old.quantity) await POST(`/api/inventory/${id}/stock`, { type: 'KOREKCIJA', quantity: Number(v('quantity')), note: 'Korekcija popisa' });
      closeModal(f); toast('Artikal je sačuvan.'); loadAll();
    } catch (e) { fail(e); }
  },
  'stock-in': async (f) => {
    const v = n => f.elements[n] ? f.elements[n].value : '';
    const novi = f.elements.tip.value === 'novi';
    try {
      if (novi) {
        if (!v('code').trim() || !v('name').trim()) return toast('Unesite šifru i naziv artikla', 'err');
        await POST('/api/inventory', { code: v('code'), name: v('name'), location: v('location'), minimum: v('minimum'), unit: v('unit'), unit_price: v('unit_price'), quantity: Number(v('quantity')), worker_id: v('worker_id') || null });
      } else {
        if (!v('inventory_id')) return toast('Izaberite artikal', 'err');
        await POST(`/api/inventory/${v('inventory_id')}/stock`, { type: 'ULAZ', quantity: Number(v('quantity')), worker_id: v('worker_id') || null, note: 'Prijem robe' });
      }
      toast('Ulaz je proknjižen.'); loadAll();
    } catch (e) { fail(e); }
  },
  'add-machine': async f => { try { await POST('/api/machines', { name: f.elements.name.value }); toast('Mašina je dodata. Šifra je dodeljena automatski, izmenite je olovkom.'); loadAll(); } catch (e) { fail(e); } },
  'add-operator': async f => { try { await POST('/api/operators', { name: f.elements.name.value }); loadAll(); } catch (e) { fail(e); } },
  'add-worker': async f => { try { await POST('/api/workers', { fullname: f.elements.name.value }); loadAll(); } catch (e) { fail(e); } },
  'rename-worker': async f => { try { await PUT('/api/workers/' + f.dataset.id, { fullname: f.elements.name.value, phone: f.elements.phone.value, status: f.elements.active.checked ? 'AKTIVAN' : 'NEAKTIVAN' }); closeModal(f); loadAll(); } catch (e) { fail(e); } },
  'rename-operator': async f => { try { await PUT('/api/operators/' + f.dataset.id, { name: f.elements.name.value }); closeModal(f); loadAll(); } catch (e) { fail(e); } },
  user: async f => {
    const id = f.dataset.id, v = n => (f.elements[n] ? f.elements[n].value : '');
    try {
      const link = { worker_id: v('worker_id') ? Number(v('worker_id')) : null, notify: v('notify') === '' ? null : v('notify') === '1' };
      if (id) await PUT('/api/users/' + id, { fullname: v('fullname'), role: v('role'), active: f.elements.active.checked, password: v('password') || undefined, ...link });
      else await POST('/api/users', { username: v('username'), fullname: v('fullname'), role: v('role'), password: v('password'), ...link });
      closeModal(f); toast('Korisnik je sačuvan.'); loadAdminLists();
    } catch (e) { fail(e); }
  },
  pw: async f => {
    if (f.elements.next.value !== f.elements.again.value) return toast('Nove lozinke se ne poklapaju', 'err');
    try { await POST('/api/auth/change-password', { current: f.elements.current.value, next: f.elements.next.value }); const m = f.closest('.modal'); closeModal(m); App.user.must_change_password = false; paintPwBanner(); toast('Lozinka je promenjena.'); } catch (e) { fail(e); }
  },
  'backup-copy': async f => {
    try {
      const r = await PUT('/api/backups/external', { dir: f.elements.dir.value });
      toast(!r.dir ? 'Dodatna kopija je isključena.' : r.last && r.last.ok ? 'Odredište je u redu. Backup-i se kopiraju automatski.' : 'Odredište je sačuvano.');
    } catch (e) { fail(e); }
    loadAdminLists();
  },
  settings: async f => { try { await PUT('/api/settings', { company: f.elements.company.value, public_url: f.elements.public_url.value, remind_minutes: f.elements.remind_minutes.value }); toast('Podešavanja su sačuvana.'); loadAdminLists(); } catch (e) { fail(e); } }
};
