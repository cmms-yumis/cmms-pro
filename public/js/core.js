'use strict';
/* ===== Jezgro: pomocne funkcije, API, modali ===== */

// ---------- sigurno ubacivanje teksta u HTML ----------
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const raw = s => ({ __raw: String(s) });
const val = v => (v == null || v === false ? '' : Array.isArray(v) ? v.map(val).join('') : typeof v === 'object' && '__raw' in v ? v.__raw : esc(v));
// html`...` automatski escape-uje svaku vrednost; ugnjezdeni html`` ostaje netaknut
const html = (s, ...v) => raw(s.reduce((o, x, i) => o + x + (i < v.length ? val(v[i]) : ''), ''));
const put = (el, tpl) => { el.innerHTML = tpl !== null && typeof tpl === 'object' ? val(tpl) : String(tpl); hydrate(el); };
const hydrate = (root = document) => $$('[data-ic]', root).forEach(e => { if (!e.firstChild) e.innerHTML = icon(e.dataset.ic); });

// ---------- stanje ----------
const App = {
  user: null, perms: [], tab: 'dashboard', online: true,
  d: { machines: [], workers: [], operators: [], inventory: [], workorders: [], preventive: [], tx: [], dash: null },
  filters: { q: '', status: '', priority: '', machine: '', stockQ: '', ws: '', txFrom: '', txTo: '', txQ: '', txType: '', txWho: '' }
};
const can = p => App.perms.includes('*') || App.perms.includes(p);

// ---------- formatiranje ----------
const STATUS = { OTVOREN: 'Otvoreno', U_TOKU: 'U toku', CEKA_DEO: 'Čeka deo', ZAVRSEN: 'Završeno' };
const PRIO = { NIZAK: 'Nizak', SREDNJI: 'Srednji', VISOK: 'Visok' };
const TYPE = { KVAR: 'Korektivno (Kvar)', PREVENTIVA: 'Preventivno', INSPEKCIJA: 'Inspekcija' };
const PERIOD = { DNEVNA: 'Dnevno', NEDELJNA: 'Nedeljno', MESECNA: 'Mesečno', KVARTALNA: 'Kvartalno', POLUGODISNJA: 'Polugodišnje', GODISNJA: 'Godišnje' };
const ROLE = { ADMIN: 'Administrator', MENADZER: 'Menadžer', MAJSTOR: 'Majstor', OPERATER: 'Operater' };

const toDate = s => {
  if (!s) return null;
  const t = String(s);
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(t) ? t + 'T00:00:00' : /[zZ]$|[+-]\d\d:?\d\d$|T/.test(t) ? t : t.replace(' ', 'T') + 'Z');
  return isNaN(d) ? null : d;
};
const pad = n => String(n).padStart(2, '0');
const fDate = s => { const d = toDate(s); return d ? `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}.` : '-'; };
const fTime = s => { const d = toDate(s); return d ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : ''; };
const fDT = s => (toDate(s) ? `${fDate(s)} ${fTime(s)}` : '-');
const inDate = s => { const d = toDate(s) || new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const inTime = s => { const d = toDate(s) || new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const iso = (date, time) => { const d = new Date(`${date}T${time || '00:00'}`); return isNaN(d) ? null : d.toISOString(); };
const todayStr = () => inDate();
const fMin = m => { m = Math.round(Number(m) || 0); if (m < 60) return `${m} min`; const h = Math.floor(m / 60); return `${h}h ${m % 60 ? pad(m % 60) + 'min' : ''}`.trim(); };
const fNum = n => (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('sr-RS');
const fMoney = n => (Number(n) || 0).toLocaleString('sr-RS', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const daysFrom = d => Math.round((new Date(d + 'T00:00:00') - new Date(todayStr() + 'T00:00:00')) / 864e5);

const ic = (n, c) => raw(icon(n, c));

// Pretraga unutar liste artikala: svaka upisana rec mora da se nalazi u nazivu, sifri ili lokaciji
const itemLabel = i => `${i.name} (${i.code}) · ${fNum(i.quantity)} ${i.unit}`;
function filterItems(sel, query, items, placeholder) {
  if (!sel) return;
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  const keep = sel.value;
  const list = items.filter(i => words.every(w => `${i.name} ${i.code} ${i.location || ''}`.toLowerCase().includes(w)));
  const head = !words.length && placeholder ? `<option value="">${esc(placeholder)}</option>` : '';
  sel.innerHTML = head + (list.length ? list.map(i => `<option value="${i.id}">${esc(itemLabel(i))}</option>`).join('') : '<option value="">Nema rezultata</option>');
  if (list.some(i => String(i.id) === keep)) sel.value = keep; else sel.selectedIndex = 0;
  const cnt = sel.id === 'st-select' ? $('#st-count') : null;
  if (cnt) cnt.textContent = words.length ? `Pronađeno: ${list.length} od ${items.length}` : `Ukupno artikala: ${items.length}`;
}
const badge = (kind, text) => html`<span class="badge b-${kind.toLowerCase()}">${text}</span>`;
const statusBadge = s => badge(s, STATUS[s] || s);
const prioBadge = p => badge(p, PRIO[p] || p);
const opts = (list, sel, label = x => x.name, empty) => html`${empty ? html`<option value="">${empty}</option>` : ''}${list.map(x => html`<option value="${x.id}" ${String(x.id) === String(sel) ? raw('selected') : ''}>${label(x)}</option>`)}`;
const byId = (list, id) => list.find(x => String(x.id) === String(id));
const mLabel = m => (m ? `${m.code} - ${m.name}` : '-');

// ---------- API ----------
const QUEUE_KEY = 'cmms_offline_queue';
const queue = () => { try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); } catch (_) { return []; } };
const saveQueue = q => { try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); } catch (_) {} };

class ApiErr extends Error { constructor(m, status) { super(m); this.status = status; } }

async function api(method, url, body, opt = {}) {
  let res;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opt.timeout || 25000);   // zahtev bez odgovora se prekida posle 25 s
  try {
    res = await fetch(url, {
      method, credentials: 'same-origin', signal: ctl.signal,
      headers: body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {},
      body: body ? (body instanceof FormData ? body : JSON.stringify(body)) : undefined
    });
  } catch (e) {
    clearTimeout(timer);
    // istek vremena nije prekid veze: server je mozda ipak primio zahtev, pa se prijava kvara NE stavlja u red za ponovno slanje
    if (e && e.name === 'AbortError') throw new ApiErr('Server ne odgovara (vreme je isteklo). Proverite vezu i pokušajte ponovo.', 0);
    setOnline(false);
    // prijava kvara bez veze: sacuvaj na telefonu i posalji kasnije
    if (method === 'POST' && url === '/api/workorders' && !opt.noQueue) {
      const q = queue(); q.push({ url, body, at: new Date().toISOString() }); saveQueue(q);
      toast('Nema veze - prijava je sačuvana na uređaju i biće poslata automatski.', 'ok');
      return { queued: true };
    }
    throw new ApiErr('Nema veze sa serverom', 0);
  }
  clearTimeout(timer);
  setOnline(true);
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json().catch(() => ({})) : null;
  if (res.status === 401 && !opt.quiet) { App.user = null; if (window.showLogin) window.showLogin(); throw new ApiErr('Sesija je istekla - prijavite se ponovo', 401); }
  if (!res.ok) throw new ApiErr((data && data.error) || `Greška ${res.status}`, res.status);
  return data;
}
const GET = (u, o) => api('GET', u, null, o), POST = (u, b, o) => api('POST', u, b || {}, o), PUT = (u, b) => api('PUT', u, b || {}), DEL = u => api('DELETE', u);

async function flushQueue() {
  const q = queue();
  if (!q.length || !App.user) return;
  const left = [];
  let sent = 0;
  for (const it of q) {
    try { await api('POST', it.url, it.body, { noQueue: true }); sent++; }
    catch (e) { if (e.status === 0 || e.status === 401) left.push(it); } // 4xx (npr. obrisana masina) se odbacuje
  }
  saveQueue(left);
  if (sent) { toast(`Poslato ${sent} prijava koje su čekale na vezu`, 'ok'); if (window.loadAll) window.loadAll(); }
}

function setOnline(v) {
  if (App.online === v) return;
  App.online = v;
  const bar = $('#offline-bar'); if (bar) bar.hidden = v;
  if (window.paintConn) window.paintConn();
  if (v) flushQueue();
}

// ---------- obavestenja ----------
let toastTimer;
function toast(msg, kind = 'ok') {
  const t = $('#toast');
  t.className = 'toast ' + kind;
  put(t, html`${raw(icon(kind === 'err' ? 'alert' : 'checkcircle'))}<span>${msg}</span>`);
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, kind === 'err' ? 6000 : 3500);
}
const fail = e => { if (e.status !== 401) toast(e.message || 'Greška', 'err'); };

// ---------- modali ----------
let modalSeq = 0;
function openModal(tpl, { size = '', onOpen } = {}) {
  const id = 'mdl' + (++modalSeq);
  const wrap = document.createElement('div');
  wrap.className = 'modal'; wrap.id = id;
  wrap.innerHTML = `<div class="dlg ${size}" role="dialog" aria-modal="true">${tpl.__raw !== undefined ? tpl.__raw : tpl}</div>`;
  $('#modals').appendChild(wrap);
  hydrate(wrap);
  wrap.addEventListener('mousedown', e => { if (e.target === wrap && !wrap.dataset.sticky) closeModal(wrap); });
  const first = $('input:not([type=hidden]),select,textarea', wrap); if (first && window.innerWidth > 700) first.focus();
  if (onOpen) onOpen(wrap);
  return wrap;
}
function closeModal(el) {
  const w = el && el.closest ? el.closest('.modal') : el;
  if (w) w.remove();
}
const topModal = () => { const m = $$('#modals .modal'); return m[m.length - 1]; };
document.addEventListener('keydown', e => { if (e.key === 'Escape') { const m = topModal(); if (m && !m.dataset.sticky) closeModal(m); } });

const dlgHead = (icn, title) => html`<div class="dlg-h"><h3>${raw(icon(icn))} ${title}</h3><button class="ib" data-act="close-modal" aria-label="Zatvori">${raw(icon('x'))}</button></div>`;

function confirmBox(title, message, label = 'Potvrdi', danger = true) {
  return new Promise(resolve => {
    const m = openModal(html`
      <div class="dlg-b" style="align-items:center;text-align:center;padding:28px 24px 8px">
        <div class="${danger ? 'i-red' : 'i-blue'}" style="width:56px;height:56px;border-radius:50%;display:grid;place-items:center;font-size:26px">${raw(icon('alert'))}</div>
        <h3 style="margin:6px 0 0;font-size:17px;color:var(--s900)">${title}</h3>
        <p style="margin:0;color:var(--s600);font-size:13.5px">${message}</p>
      </div>
      <div class="dlg-f" style="justify-content:center;background:none;border:0"><button class="btn btn-line" data-r="0">Odustani</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-r="1">${label}</button></div>`, { size: 'sm' });
    m.dataset.sticky = '1';
    m.addEventListener('click', e => { const b = e.target.closest('[data-r]'); if (b) { closeModal(m); resolve(b.dataset.r === '1'); } });
  });
}

function copyText(t) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(t).then(() => toast('Adresa kopirana'));
  const a = document.createElement('textarea'); a.value = t; document.body.appendChild(a); a.select();
  try { document.execCommand('copy'); toast('Adresa kopirana'); } catch (_) {}
  a.remove();
}

// ---------- CSV (UTF-8 sa BOM, ; separator za Excel) ----------
function downloadCsv(name, header, rows, stamp = true) {
  const cell = v => { const s = String(v == null ? '' : v).replace(/\r?\n/g, ' '); return /[";]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const text = '\uFEFF' + [header, ...rows].map(r => r.map(cell).join(';')).join('\r\n');
  if (window.AndroidApp && window.AndroidApp.saveText) { window.AndroidApp.saveText(`${name}-${todayStr()}.csv`, text); return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  a.download = `${name}${stamp ? '-' + todayStr() : ''}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

window.addEventListener('online', () => { setOnline(true); flushQueue(); });
window.addEventListener('offline', () => setOnline(false));
