'use strict';
// Pokretanje: node test/smoke.js [putanja-do-stare-baze.db]
// Podize server na privremenoj bazi i proverava glavne tokove (prijava, nalozi, magacin, preventiva).
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = 3900 + Math.floor(Math.random() * 90);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cmms-'));
const dbFile = path.join(tmp, 'test.db');
if (process.argv[2]) fs.copyFileSync(process.argv[2], dbFile);

let cookie = '';
let fails = 0, passes = 0;
const ok = (cond, msg) => { cond ? passes++ : fails++; console.log((cond ? '  OK   ' : '  FAIL ') + msg); };

async function call(method, url, body, opts = {}) {
  const res = await fetch(`http://127.0.0.1:${PORT}${url}`, {
    method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined, redirect: 'manual'
  });
  const sc = res.headers.get('set-cookie');
  if (sc && /cmms_sid=[^;]/.test(sc)) cookie = sc.split(';')[0];
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : opts.raw ? Buffer.from(await res.arrayBuffer()) : await res.text();
  return { status: res.status, data, headers: res.headers };
}

async function run() {
  let r = await call('GET', '/api/machines');
  ok(r.status === 401, 'bez prijave API vraca 401');

  r = await call('POST', '/api/auth/login', { username: 'admin', password: 'pogresna' });
  ok(r.status === 401, 'pogresna lozinka odbijena');

  r = await call('POST', '/api/auth/login', { username: 'admin', password: 'admin123' });
  ok(r.status === 200 && r.data.user.must_change_password, 'prijava admin/admin123 uspesna, trazi promenu lozinke');

  r = await call('POST', '/api/auth/change-password', { current: 'admin123', next: 'novaLozinka1' });
  ok(r.status === 200, 'promena lozinke');
  r = await call('GET', '/api/auth/me');
  ok(r.status === 200 && !r.data.user.must_change_password, 'sesija vazi posle promene lozinke');

  r = await call('POST', '/api/machines', { name: 'Strug CNC 1', location: 'Hala A' });
  ok(r.status === 201, 'nova masina (sifra se sama generise)');
  const mid = r.data.id;
  r = await call('POST', '/api/machines', { code: 'PRES-1', name: 'Presa 1' });
  const mid2 = r.data.id;
  r = await call('POST', '/api/machines', { code: 'PRES-1', name: 'Dupla' });
  ok(r.status === 409, 'dupla sifra masine odbijena');

  r = await call('POST', '/api/workers', { fullname: 'Marko Majstor - mehanicar' });
  const wid = r.data.id;
  r = await call('POST', '/api/operators', { name: 'Jovan Operater' });
  const oid = r.data.id;
  ok(r.status === 201, 'operater dodat');

  r = await call('POST', '/api/inventory', { code: 'SKF-6205', name: 'Lezaj 6205', quantity: 5, minimum: 2, unit_price: 350, location: 'B-4', worker_id: wid });
  ok(r.status === 201, 'artikal sa pocetnim stanjem');
  const iid = r.data.id;

  r = await call('POST', '/api/workorders', { machine_id: mid, description: 'Cuje se buka na vretenu', priority: 'VISOK', operator_id: oid });
  ok(r.status === 201 && /^RN-\d{4}-0001$/.test(r.data.number), 'otvoren radni nalog ' + (r.data && r.data.number));
  const woid = r.data.id;
  r = await call('PUT', `/api/workorders/${woid}`, { worker_id: wid });
  r = await call('GET', `/api/workorders/${woid}`);
  ok(r.data.status === 'U_TOKU' && r.data.worker_name && r.data.operator_name, 'dodela majstora prebacuje nalog u "U toku"');

  r = await call('POST', `/api/workorders/${woid}/parts`, { inventory_id: iid, quantity: 2 });
  ok(r.status === 201, 'deo ugradjen na nalog');
  r = await call('POST', `/api/workorders/${woid}/parts`, { inventory_id: iid, quantity: 99 });
  ok(r.status === 409, 'ne moze se uzeti vise nego sto ima na stanju: ' + (r.data && r.data.error));
  r = await call('GET', '/api/inventory');
  const item = r.data.find(i => i.id === iid);
  ok(item.quantity === 3 && item.last_receiver === 'Marko Majstor - mehanicar', 'stanje magacina smanjeno na 3, poslednji primalac upisan');

  r = await call('PUT', `/api/workorders/${woid}`, { status: 'ZAVRSEN', resolution: 'Zamenjen lezaj', closed_at: new Date(Date.now() + 90 * 60000).toISOString() });
  r = await call('GET', `/api/workorders/${woid}`);
  ok(r.data.status === 'ZAVRSEN' && r.data.downtime_min >= 89 && r.data.downtime_min <= 91, `zatvaranje racuna zastoj (${r.data.downtime_min} min)`);
  ok(r.data.parts_cost === 700, 'trosak delova 700');

  r = await call('POST', '/api/preventive', { machine_id: mid2, title: 'Podmazivanje', period_type: 'MESECNA', next_date: new Date().toISOString().slice(0, 10), worker_id: wid });
  ok(r.status === 201, 'preventivni plan dodat');
  const pid = r.data.id;
  r = await call('GET', '/api/preventive');
  const pwo = r.data.find(p => p.id === pid).open_wo_id;
  ok(!!pwo, 'plan koji je dospeo odmah dobija radni nalog (automatski)');
  r = await call('POST', `/api/preventive/${pid}/generate`);
  ok(r.status === 409, 'dupli nalog za istu preventivu blokiran');
  r = await call('PUT', `/api/workorders/${pwo}`, { status: 'ZAVRSEN', resolution: 'Uradjeno' });
  r = await call('GET', '/api/preventive');
  const pm = r.data.find(p => p.id === pid);
  ok(pm.next_date > new Date().toISOString().slice(0, 10) && pm.last_date, 'zavrsetkom naloga rok preventive pomeren na ' + pm.next_date);

  r = await call('GET', '/api/dashboard');
  ok(r.status === 200 && r.data.counts.machines >= 2 && Array.isArray(r.data.recent), 'dashboard radi');
  r = await call('GET', `/api/machines/${mid}/qr.png`, null, { raw: true });
  ok(r.status === 200 && r.data.slice(1, 4).toString() === 'PNG', 'QR kod masine (PNG)');
  r = await call('GET', `/api/workorders/${woid}/pdf`, null, { raw: true });
  ok(r.status === 200 && r.data.slice(0, 4).toString() === '%PDF', 'PDF radnog naloga');
  r = await call('GET', '/api/export/workorders.xlsx', null, { raw: true });
  ok(r.status === 200 && r.data.slice(0, 2).toString() === 'PK', 'Excel izvoz');
  r = await call('POST', '/api/backups');
  ok(r.status === 201, 'rucni backup: ' + (r.data && r.data.file));
  const today = new Date(); const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  r = await call('GET', `/api/reports/summary?from=${ymd(new Date(today.getFullYear(), today.getMonth(), 1))}&to=${ymd(today)}`);
  ok(r.status === 200 && r.data.kpi.wo_created >= 2 && r.data.kpi.wo_closed >= 1, 'izvestaj: nalozi su prebrojani (' + r.data.kpi.wo_created + ' otvoreno, ' + r.data.kpi.wo_closed + ' zavrseno)');
  ok(r.data.kpi.downtime_min >= 89 && r.data.kpi.mttr_min >= 0, 'izvestaj: zastoj ' + r.data.kpi.downtime_min + ' min, prosecna popravka ' + r.data.kpi.mttr_min + ' min');
  ok(r.data.kpi.parts_cost === 700, 'izvestaj: trosak delova 700');
  ok(r.data.by_machine.some(m => m.code && m.downtime_min >= 89 && m.parts_cost === 700), 'izvestaj: masina sa najvecim zastojem i troskom delova');
  ok(r.data.top_parts.length >= 1 && r.data.top_parts[0].qty === 2, 'izvestaj: najvise utroseni delovi');
  ok(r.data.by_operator.length >= 1 && r.data.by_worker.length >= 1, 'izvestaj: po operaterima i majstorima');
  ok(r.data.unit === 'day' && r.data.series.reduce((a, x) => a + x.created, 0) === r.data.kpi.wo_created, 'izvestaj: grafikon po danima, zbir se slaze');
  r = await call('GET', '/api/reports/summary?from=2020-01-01&to=2026-12-31');
  ok(r.data.unit === 'month' && r.data.series.reduce((a, x) => a + x.created, 0) === r.data.kpi.wo_created, 'izvestaj: duzi period po mesecima, zbir se slaze');
  r = await call('GET', '/api/reports/summary?from=2026-12-31&to=2026-01-01');
  ok(r.status === 400, 'izvestaj: obrnut period se odbija');

  // ---- filteri dnevnika prometa magacina ----
  const tx = async qs => (await call('GET', '/api/inventory/transactions' + qs)).data;
  const allTx = await tx('');
  ok(allTx.length >= 2, 'dnevnik prometa ima zapise: ' + allTx.length);
  const izlaz = await tx('?type=IZLAZ');
  ok(izlaz.length >= 1 && izlaz.every(x => x.transaction_type === 'IZLAZ') && izlaz.length < allTx.length, 'filter: samo izlazi (' + izlaz.length + ' od ' + allTx.length + ')');
  const ulaz = await tx('?type=ULAZ');
  ok(ulaz.length >= 1 && ulaz.every(x => x.transaction_type === 'ULAZ'), 'filter: samo ulazi');
  const byName = await tx('?q=lezaj');
  ok(byName.length >= 1 && byName.every(x => /lezaj|6205/i.test(x.name + x.code)), 'filter: artikal po nazivu');
  const bySku = await tx('?q=skf-6205');
  ok(bySku.length >= 1 && bySku.every(x => x.code === 'SKF-6205'), 'filter: artikal po sifri');
  ok((await tx('?q=xyzxyz')).length === 0, 'filter: artikal bez pogodaka');
  const byWo = await tx('?who=RN-');
  ok(byWo.length >= 1 && byWo.every(x => x.wo_number), 'filter: po radnom nalogu (RN-...)');
  const byWorker = await tx('?who=marko');
  ok(byWorker.length >= 1 && byWorker.every(x => /marko/i.test(x.worker_name || x.user_name || x.note || '')), 'filter: po osobi koja je evidentirala');
  const dt = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const nowD = new Date(), tomorrow = new Date(nowD.getTime() + 864e5), yesterday = new Date(nowD.getTime() - 864e5);
  ok((await tx(`?from=${dt(nowD)}&to=${dt(nowD)}`)).length === allTx.length, 'filter: danasnji datum obuhvata sve danasnje zapise');
  ok((await tx(`?from=${dt(tomorrow)}`)).length === 0, 'filter: od sutra - nema zapisa');
  ok((await tx(`?to=${dt(yesterday)}`)).length === 0, 'filter: do juce - nema zapisa');
  ok((await tx('?from=nije-datum&to=ni-ovo')).length === allTx.length, 'neispravan datum se ignorise');
  const combo = await tx('?type=IZLAZ&q=lezaj&who=RN-');
  ok(combo.length >= 1 && combo.every(x => x.transaction_type === 'IZLAZ' && x.wo_number), 'filteri se kombinuju');
  ok((await tx('?limit=1')).length === 1, 'ogranicenje broja zapisa (limit)');

  // ---- dodatna kopija backup-a (USB / mreza) ----
  const usb = path.join(tmp, 'usb-disk', 'CMMS-backup');
  r = await call('GET', '/api/backups/external');
  ok(r.status === 200 && r.data.dir === '', 'dodatna kopija je na pocetku iskljucena');
  r = await call('PUT', '/api/backups/external', { dir: 'relativna/putanja' });
  ok(r.status === 400, 'nepotpuna putanja se odbija: ' + r.data.error);
  r = await call('PUT', '/api/backups/external', { dir: path.join(dbFile, 'ne-moze') });
  ok(r.status === 400, 'nedostupna putanja se odbija pri podesavanju');
  r = await call('POST', '/api/backups');
  ok(r.status === 201 && r.data.copy.skipped === true, 'bez odredista backup radi kao i pre');
  r = await call('PUT', '/api/backups/external', { dir: usb });
  ok(r.status === 200 && r.data.last && r.data.last.ok === true, 'odrediste podeseno, odmah se kopiraju postojeci backup-i');
  ok(fs.readdirSync(usb).filter(f => /^cmms-.*\.db$/.test(f)).length >= 1, 'fajlovi su na odredistu: ' + fs.readdirSync(usb).length);
  r = await call('POST', '/api/backups');
  ok(r.data.copy.ok === true && fs.existsSync(path.join(usb, r.data.file)), 'novi backup se odmah kopira na odrediste');
  fs.rmSync(usb, { recursive: true, force: true }); fs.writeFileSync(usb, 'disk nije prikljucen');   // simulacija: odrediste nije dostupno
  r = await call('POST', '/api/backups');
  ok(r.status === 201 && r.data.copy.ok === false, 'lokalni backup uspeva i kad odrediste nije dostupno: ' + r.data.copy.error);
  r = await call('GET', '/api/dashboard');
  ok(r.data.backup_warn && r.data.backup_warn.error, 'tabla upozorava administratora da kopija nije uspela');
  fs.rmSync(usb, { force: true });                                                                 // disk je ponovo tu
  r = await call('POST', '/api/backups/external/sync');
  ok(r.data.last.ok === true, 'kad odrediste ponovo postane dostupno, kopiranje uspeva');
  r = await call('GET', '/api/dashboard');
  ok(!r.data.backup_warn, 'upozorenje nestaje');
  ok(fs.readdirSync(usb).filter(f => /^cmms-.*\.db$/.test(f)).length >= 3, 'propusteni backup-i su naknadno kopirani');
  r = await call('PUT', '/api/backups/external', { dir: '' });
  ok(r.data.dir === '', 'dodatna kopija se moze iskljuciti');

  // ---- automatska sifra artikla ----
  r = await call('GET', '/api/inventory/next-code');
  ok(r.status === 200 && r.data.code === '0000', 'prva automatska sifra artikla je 0000: ' + r.data.code);
  r = await call('POST', '/api/inventory', { name: 'Remen A-45', quantity: 3, minimum: 1 });
  ok(r.status === 201, 'artikal bez sifre se pravi sa automatskom sifrom');
  r = await call('POST', '/api/inventory', { name: 'Filter ulja', quantity: 2 });
  r = await call('GET', '/api/inventory');
  const codes = r.data.map(i => i.code).filter(c => /^\d{4}$/.test(c)).sort();
  ok(codes.join(',') === '0000,0001', 'sifre idu po redu 0000, 0001: ' + codes.join(','));
  r = await call('POST', '/api/inventory', { code: '0007', name: 'Rucna sifra' });
  r = await call('GET', '/api/inventory/next-code');
  ok(r.data.code === '0008', 'posle rucne sifre 0007 sledeca je 0008: ' + r.data.code);
  r = await call('POST', '/api/inventory', { code: '0007', name: 'Dupla sifra' });
  ok(r.status === 409, 'duplirana sifra se odbija');

  // ---- obavestenja i prihvatanje naloga ----
  const adminCookie0 = cookie;
  r = await call('POST', '/api/workers', { fullname: 'Pera Majstor - bravar' }); const w1 = r.data.id;
  r = await call('POST', '/api/workers', { fullname: 'Zika Majstor - elektricar' }); const w2 = r.data.id;
  await call('POST', '/api/users', { username: 'maj1', password: 'lozinka123', role: 'MAJSTOR', fullname: 'Pera', worker_id: w1 });
  await call('POST', '/api/users', { username: 'maj2', password: 'lozinka123', role: 'MAJSTOR', fullname: 'Zika', worker_id: w2 });
  await call('POST', '/api/users', { username: 'maj3', password: 'lozinka123', role: 'MAJSTOR', fullname: 'Bez veze' });
  const loginAs = async u => { cookie = ''; return call('POST', '/api/auth/login', { username: u, password: 'lozinka123' }); };

  await loginAs('maj1');
  r = await call('POST', '/api/workorders', { machine_id: mid, description: 'Stao transporter na liniji 2', priority: 'VISOK' });
  const nid = r.data.id;
  r = await call('GET', '/api/alerts');
  ok(r.data.items.some(i => i.id === nid && i.kind === 'open' && i.priority === 'VISOK' && i.machine_code), 'majstor vidi novi neprihvaceni kvar u obavestenjima');
  ok(r.data.can_accept === true && r.data.remind_minutes === 10, 'majstor je povezan sa radnikom, podsetnik 10 min');

  cookie = adminCookie0;
  r = await call('GET', '/api/alerts');
  ok(r.data.items.length === 0, 'admin po podrazumevanom ne dobija obavestenja');
  r = await call('GET', '/api/dashboard');
  ok(r.data.counts.wo_unassigned >= 1, 'tabla broji naloge koji cekaju majstora');

  await loginAs('maj3');
  r = await call('POST', `/api/workorders/${nid}/accept`);
  ok(r.status === 400 && /povezan/.test(r.data.error), 'majstor bez veze sa radnikom ne moze da prihvati: ' + r.data.error);

  await loginAs('maj1');
  r = await call('POST', `/api/workorders/${nid}/accept`);
  ok(r.status === 200 && !r.data.already, 'majstor 1 prihvata nalog ' + r.data.number);
  r = await call('GET', `/api/workorders/${nid}`);
  ok(r.data.status === 'U_TOKU' && r.data.worker_id === w1 && r.data.accepted_at, 'nalog je U toku i zaduzen majstoru 1');
  r = await call('GET', '/api/alerts');
  ok(r.data.items.length === 0, 'prihvaceni nalog nestaje iz obavestenja majstora 1');

  await loginAs('maj2');
  r = await call('POST', `/api/workorders/${nid}/accept`);
  ok(r.status === 409, 'majstor 2 ne moze da prihvati vec prihvacen nalog: ' + r.data.error);
  r = await call('GET', '/api/alerts');
  ok(!r.data.items.some(i => i.id === nid), 'nalog nestaje iz obavestenja drugih majstora');

  cookie = adminCookie0;
  r = await call('POST', '/api/workorders', { machine_id: mid, description: 'Dodeljen rucno' });
  const aid = r.data.id;
  await call('PUT', `/api/workorders/${aid}`, { worker_id: w2 });
  await loginAs('maj2');
  r = await call('GET', '/api/alerts');
  ok(r.data.items.some(i => i.id === aid && i.kind === 'mine'), 'rucno dodeljen nalog stize majstoru kao "mine"');
  r = await call('POST', `/api/workorders/${aid}/accept`);
  ok(r.status === 200 && r.data.already === true, 'potvrda prijema vec dodeljenog naloga');
  r = await call('GET', '/api/alerts');
  ok(!r.data.items.some(i => i.id === aid), 'potvrdjen nalog nestaje iz obavestenja');

  cookie = adminCookie0;
  r = await call('PUT', '/api/settings', { remind_minutes: 5 });
  ok(r.status === 200, 'podesen podsetnik 5 min');
  r = await call('PUT', '/api/settings', { remind_minutes: 'abc' });
  ok(r.status === 400, 'neispravan podsetnik odbijen');
  await loginAs('maj1');
  r = await call('GET', '/api/alerts');
  ok(r.data.remind_minutes === 5, 'podsetnik 5 min stize klijentu');
  cookie = adminCookie0;

  r = await call('POST', '/api/users', { username: 'operater1', password: 'lozinka123', role: 'OPERATER', fullname: 'Operater Jedan' });
  ok(r.status === 201, 'novi korisnik (operater)');
  const adminCookie = cookie;
  cookie = '';
  r = await call('POST', '/api/auth/login', { username: 'operater1', password: 'lozinka123' });
  r = await call('POST', '/api/machines', { name: 'x' });
  ok(r.status === 403, 'operater ne moze da dodaje masine');
  r = await call('POST', '/api/workorders', { machine_id: mid, description: 'Prijava sa telefona' });
  ok(r.status === 201, 'operater moze da prijavi kvar');
  r = await call('GET', '/api/users');
  ok(r.status === 403, 'operater ne vidi korisnike');
  cookie = adminCookie;
  r = await call('GET', '/api/machines');
  ok(r.status === 200, 'admin sesija i dalje vazi');
  r = await call('POST', '/api/auth/logout');
  r = await call('GET', '/api/machines');
  ok(r.status === 401, 'odjava prekida sesiju');
  r = await call('GET', '/index.html');
  ok(r.status === 200, 'staticki fajlovi se serviraju');
}

const srv = spawn(process.execPath, ['server.js'], {
  cwd: path.join(__dirname, '..'),
  env: { ...process.env, PORT: String(PORT), CMMS_DB: dbFile, CMMS_BACKUP_DIR: path.join(tmp, 'backup') }, stdio: ['ignore', 'pipe', 'pipe']
});
let log = '';
srv.stdout.on('data', d => { log += d; });
srv.stderr.on('data', d => { log += d; });

(async () => {
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/api/status`); if (r.ok) break; } catch (_) {}
    await new Promise(r => setTimeout(r, 200));
  }
  try { await run(); } catch (e) { fails++; console.log('  FAIL izuzetak: ' + e.stack); }
  srv.kill();
  console.log(`\n${passes} proslo, ${fails} palo`);
  if (fails) console.log('--- log servera ---\n' + log);
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(fails ? 1 : 0);
})();
