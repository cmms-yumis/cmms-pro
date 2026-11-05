'use strict';
/* ===== Pokretanje aplikacije ===== */

let pollTimer, pingTimer, lastSig = '';
const pendingHash = location.hash;

// ---------- status veze ----------
window.paintConn = () => {
  const el = $('#conn-status'); if (!el) return;
  put(el, App.online
    ? html`<span class="dot ok"></span><span class="ok-t">Server povezan</span>`
    : html`<span class="dot bad"></span><span class="bad-t">Nema veze</span>`);
};

// ---------- prijava ----------
window.showLogin = () => {
  clearInterval(pollTimer); clearInterval(pingTimer);
  $('#modals').innerHTML = '';
  $('#app').hidden = true; $('#login').hidden = false;
  $('#l-pass').value = ''; $('#l-err').hidden = true;
  setTimeout(() => $('#l-user').focus(), 50);
};

$('#login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = e.submitter, err = $('#l-err');
  err.hidden = true; busy(btn, true);
  try {
    const r = await api('POST', '/api/auth/login', { username: $('#l-user').value, password: $('#l-pass').value }, { quiet: true });
    App.user = r.user;
    await startApp(true);
  } catch (ex) { err.textContent = ex.status === 0 ? 'Nema veze sa serverom. Proverite da li je server pokrenut i da ste na istoj mreži.' : ex.message; err.hidden = false; }
  busy(btn, false);
});

// ---------- podaci ----------
async function loadAll(force) {
  if (!App.user) return;
  try {
    const [machines, workers, operators, inventory, workorders, preventive, tx, dash] = await Promise.all([
      GET('/api/machines'), GET('/api/workers'), GET('/api/operators'), GET('/api/inventory'),
      GET('/api/workorders?limit=1000'), GET('/api/preventive'), GET('/api/inventory/transactions' + txQuery()), GET('/api/dashboard')
    ]);
    const next = { machines, workers, operators, inventory, workorders, preventive, tx, dash };
    const sig = JSON.stringify(next);
    if (!force && sig === lastSig) return;
    const firstLoad = lastSig === '';
    const before = new Set(App.d.workorders.filter(isWaiting).map(w => w.id));
    lastSig = sig;
    Object.assign(App.d, next);
    renderAll();
    if (!firstLoad && can('wo.write')) {
      const fresh = next.workorders.filter(w => isWaiting(w) && !before.has(w.id));
      if (fresh.length) newFaultAlert(fresh);
    }
  } catch (e) { if (e.status !== 0 && e.status !== 401) fail(e); }
}
window.loadAll = loadAll;

// Obavestenje unutar otvorene stranice: poruka + zvuk kad stigne novi kvar koji niko nije prihvatio
function beep() {
  try {
    const C = window.AudioContext || window.webkitAudioContext; if (!C) return;
    const a = beep.ctx || (beep.ctx = new C()); if (a.state === 'suspended') a.resume();
    const o = a.createOscillator(), g = a.createGain();
    o.type = 'sine'; o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, a.currentTime);
    g.gain.exponentialRampToValueAtTime(0.25, a.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + 0.6);
    o.connect(g); g.connect(a.destination); o.start(); o.stop(a.currentTime + 0.65);
  } catch (_) {}
}
function newFaultAlert(list) {
  const w = list[0], d = String(w.description || '').replace(/\s+/g, ' ').slice(0, 70);
  toast(`Novi kvar: ${w.machine_code} - ${d}${list.length > 1 ? ` (+${list.length - 1})` : ''}`, 'err');
  if (App.user && App.user.alerts) beep();
}

function setTab(tab) {
  App.tab = tab;
  $$('.pane').forEach(p => p.classList.toggle('active', p.id === tab));
  $('#page-title').textContent = TITLES[tab];
  renderAll();
  if (tab === 'izvestaji') loadReport();
  $('.content').scrollTop = 0;
}

async function startApp(fromLogin) {
  const me = await GET('/api/auth/me', { quiet: true });
  App.user = me.user; App.perms = me.perms || [];
  $('#login').hidden = true; $('#app').hidden = false;
  if (!App.tab) App.tab = 'dashboard';
  lastSig = '';
  renderShell();
  $$('.pane').forEach(p => p.classList.toggle('active', p.id === App.tab));
  $('#page-title').textContent = TITLES[App.tab];
  await loadAll(true);
  try { App.info = await GET('/api/server-info'); } catch (_) {}
  flushQueue();
  // prozor za promenu lozinke samo odmah posle prijave (i moze se odloziti); pri osvezavanju stranice samo traka na vrhu
  if (App.user.must_change_password && fromLogin) pwModal(true);
  paintPwBanner();
  handleDeepLink(pendingHashConsumed ? '' : pendingHash);
  pendingHashConsumed = true;
  if (App.pendingWo) { const id = App.pendingWo; App.pendingWo = 0; window.openWo(id); }

  clearInterval(pollTimer); clearInterval(pingTimer);
  // "sinhronizacija": svakih 20 s povuci izmene koje su drugi uneli (ako korisnik trenutno ne unosi podatke)
  pollTimer = setInterval(() => { if (!document.hidden && !$('#modals').children.length && !isTyping()) loadAll(); }, 20000);
  pingTimer = setInterval(() => { fetch('/api/status', { cache: 'no-store' }).then(() => setOnline(true)).catch(() => setOnline(false)); }, 15000);
}
let pendingHashConsumed = false;
const isTyping = () => { const a = document.activeElement; return a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && !!a.closest('.pane'); };

// QR kod masine otvara: /#/m/<sifra>  ->  prijava kvara za tu masinu
// Otvara radni nalog (poziva se iz obavestenja u Android aplikaciji i iz linka /#/wo/ID)
window.openWo = function (id) {
  id = Number(id);
  if (!id) return false;
  if (!App.user || $('#app').hidden) { App.pendingWo = id; return true; }   // posle prijave
  $$('#modals .modal').forEach(m => m.remove());
  setTab('radni-nalozi');
  woModal(id);
  return true;
};
const paintPwBanner = () => { const b = $('#pw-banner'); if (b) b.hidden = !(App.user && App.user.must_change_password); };

async function handleDeepLink(h) {
  const wm = /^#\/wo\/(\d+)$/.exec(h || '');
  if (wm) { history.replaceState(null, '', location.pathname); window.openWo(Number(wm[1])); return; }
  const m = /^#\/m\/(.+)$/.exec(h || '');
  if (!m) return;
  history.replaceState(null, '', location.pathname);
  try {
    const r = await GET('/api/machines/by-code/' + m[1]);
    woModal(null, { machine_id: r.id });
  } catch (e) { fail(e); }
}
window.addEventListener('hashchange', () => { if (App.user && /^#\/(m|wo)\//.test(location.hash)) handleDeepLink(location.hash); });

// ---------- dogadjaji ----------
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const fn = ACT[el.dataset.act];
  if (!fn) return;
  Promise.resolve(fn(el.dataset, el, e)).catch(fail);
});

document.addEventListener('submit', e => {
  const f = e.target.closest('form[data-form]');
  if (!f) return;
  e.preventDefault();
  const fn = FORMS[f.dataset.form];
  if (fn) Promise.resolve(fn(f, e.submitter)).catch(fail);
});

document.addEventListener('input', e => {
  const t = e.target;
  if (t.dataset && t.dataset.f === 'q') { App.filters.q = t.value; refreshNalogeBody(); }
  else if (t.dataset && t.dataset.f === 'stockQ') { App.filters.stockQ = t.value; refreshStockBody(); }
  else if (t.dataset && (t.dataset.f === 'txQ' || t.dataset.f === 'txWho')) { App.filters[t.dataset.f] = t.value; debounceTx(); }
  else if (t.dataset && t.dataset.f === 'itemSearch') filterItems($('#st-select'), t.value, App.d.inventory);
  else if (t.classList && t.classList.contains('part-search')) {
    const row = t.closest('.part-row'), m = t.closest('.modal');
    filterItems(row.querySelector('select'), t.value, m.stockOpts, 'Izaberite deo...');
  } else if (t.name === 'code' && t.closest('form[data-form="stock-in"]')) t.dataset.touched = '1';
});

document.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset && t.dataset.f) {
    const k = t.dataset.f; App.filters[k] = t.value;
    if (k === 'status' || k === 'priority') refreshNalogeBody();
    else if (k === 'machine') renderPreventiva();
    else if (k.startsWith('tx')) { clearTimeout(txTimer); loadTx(); }
    else if (k === 'rFrom' || k === 'rTo') { App.filters.rPreset = ''; if (App.filters.rFrom && App.filters.rTo) loadReport(); }
  }
  if (t.name === 'tip' && t.closest('form[data-form="stock-in"]')) {
    const novi = t.value === 'novi';
    $('#st-exist').hidden = novi; $('#st-new').hidden = !novi;
    if (novi) prefillCode();
  }
  const wf = t.closest && t.closest('#wo-form');
  if (wf) {
    const m = wf.closest('.modal');
    if (t.name === 'done') $('#wo-done-det', m).hidden = !t.checked;
    calcDowntime(m);
  }
});

// Enter u polju za pretragu ne sme da posalje formu (npr. proknjizi ulaz)
document.addEventListener('keydown', e => {
  const t = e.target;
  if (e.key === 'Enter' && t && ((t.dataset && t.dataset.f === 'itemSearch') || (t.classList && t.classList.contains('part-search')))) e.preventDefault();
});

// ---------- pokretanje ----------
(async function boot() {
  hydrate(document);
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
  try { await startApp(); }
  catch (e) { if (e.status === 0) { $('#login').hidden = false; const er = $('#l-err'); er.textContent = 'Nema veze sa serverom.'; er.hidden = false; } else window.showLogin(); }
})();
