'use strict';
// Poslovna logika. Sve funkcije dobijaju "t" (transakcioni rukovalac iz db.tx).

class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const STATUSES = ['OTVOREN', 'U_TOKU', 'CEKA_DEO', 'ZAVRSEN'];
const validIso = v => { const d = new Date(v); return v && !isNaN(d) ? d.toISOString() : null; };
const PRIORITIES = ['NIZAK', 'SREDNJI', 'VISOK'];
const WO_TYPES = ['KVAR', 'PREVENTIVA', 'INSPEKCIJA'];
const MACHINE_STATUSES = ['AKTIVNA', 'U KVARU', 'VAN FUNKCIJE'];
const PERIODS = { DNEVNA: 'Dnevna', NEDELJNA: 'Nedeljna', MESECNA: 'Mesečna', KVARTALNA: 'Kvartalna', POLUGODISNJA: 'Polugodišnja', GODISNJA: 'Godišnja' };

const nowIso = () => new Date().toISOString();
const localDate = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

// "Mesečna" / "Mesecna" / "MESECNA" -> MESECNA
const periodKey = p => String(p || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();

function addPeriod(dateStr, period) {
  const d = new Date(dateStr + 'T00:00:00Z');
  const k = periodKey(period);
  const months = { MESECNA: 1, KVARTALNA: 3, POLUGODISNJA: 6, GODISNJA: 12 }[k];
  if (months) {
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + months);
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, last));
  } else {
    d.setUTCDate(d.getUTCDate() + ({ DNEVNA: 1, NEDELJNA: 7 }[k] || 30));
  }
  return d.toISOString().slice(0, 10);
}

function minutesBetween(startIso, endIso) {
  const a = Date.parse(startIso), b = Date.parse(endIso);
  if (isNaN(a) || isNaN(b)) return 0;
  return Math.max(0, Math.round((b - a) / 60000));
}

async function audit(db, user, action, entity, entityId, detail) {
  try {
    await db.run('INSERT INTO audit_log(created_at,user_id,username,action,entity,entity_id,detail) VALUES (?,?,?,?,?,?,?)',
      [nowIso(), user ? user.id : null, user ? user.username : 'sistem', action, entity, entityId || null, detail ? String(detail).slice(0, 500) : null]);
  } catch (e) { console.error('[audit]', e.message); }
}

// ---------- radni nalozi ----------
async function nextWoNumber(t) {
  const y = new Date().getFullYear();
  const r = await t.get('SELECT MAX(number) n FROM workorders WHERE number LIKE ?', [`RN-${y}-%`]);
  const n = r && r.n ? parseInt(String(r.n).split('-')[2], 10) || 0 : 0;
  return `RN-${y}-${String(n + 1).padStart(4, '0')}`;
}

async function createWorkorder(t, d, userId) {
  const m = await t.get('SELECT id FROM machines WHERE id=? AND archived=0', [d.machine_id]);
  if (!m) throw new ApiError(400, 'Mašina ne postoji');
  const number = await nextWoNumber(t);
  const ts = validIso(d.opened_at) || nowIso();
  const status = d.worker_id ? 'U_TOKU' : 'OTVOREN';
  const r = await t.run(
    `INSERT INTO workorders(number,machine_id,worker_id,operator_id,description,priority,status,type,created_by,preventive_id,created_at,started_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [number, m.id, d.worker_id || null, d.operator_id || null, d.description || '', d.priority || 'SREDNJI', status, d.type || 'KVAR',
      userId || null, d.preventive_id || null, ts, status === 'U_TOKU' ? ts : null]);
  if (d.machine_down) {
    await t.run('INSERT INTO downtime(machine_id,reason,start_time,workorder_id,created_at) VALUES (?,?,?,?,?)', [m.id, d.description, ts, r.lastID, ts]);
    await t.run("UPDATE machines SET status='U KVARU' WHERE id=?", [m.id]);
  }
  return { id: r.lastID, number };
}

async function closeWorkorderDowntime(t, wo) {
  const open = await t.all('SELECT * FROM downtime WHERE workorder_id=? AND end_time IS NULL', [wo.id]);
  const ts = nowIso();
  for (const d of open) {
    await t.run('UPDATE downtime SET end_time=?, minutes=? WHERE id=?', [ts, minutesBetween(d.start_time, ts), d.id]);
  }
  const still = await t.get('SELECT 1 x FROM downtime WHERE machine_id=? AND end_time IS NULL LIMIT 1', [wo.machine_id]);
  if (!still) await t.run("UPDATE machines SET status='AKTIVNA' WHERE id=? AND status='U KVARU'", [wo.machine_id]);
}

async function completePreventive(t, wo, closedIso) {
  if (!wo.preventive_id) return;
  const p = await t.get('SELECT * FROM preventive WHERE id=?', [wo.preventive_id]);
  if (!p) return;
  const base = localDate(new Date(closedIso));
  await t.run('UPDATE preventive SET last_date=?, next_date=? WHERE id=?', [base, addPeriod(base, p.period_type), p.id]);
}

async function updateWorkorder(t, id, patch) {
  const wo = await t.get('SELECT * FROM workorders WHERE id=?', [id]);
  if (!wo) throw new ApiError(404, 'Radni nalog ne postoji');
  const sets = [], vals = [];
  const set = (c, v) => { sets.push(`${c}=?`); vals.push(v); };

  for (const k of ['description', 'resolution']) if (k in patch) set(k, String(patch[k] == null ? '' : patch[k]).slice(0, 2000));
  if ('priority' in patch) { if (!PRIORITIES.includes(patch.priority)) throw new ApiError(400, 'Nepoznat prioritet'); set('priority', patch.priority); }
  if ('type' in patch) { if (!WO_TYPES.includes(patch.type)) throw new ApiError(400, 'Nepoznata vrsta naloga'); set('type', patch.type); }
  if ('machine_id' in patch && patch.machine_id && Number(patch.machine_id) !== wo.machine_id) {
    if (!await t.get('SELECT 1 x FROM machines WHERE id=?', [patch.machine_id])) throw new ApiError(400, 'Mašina ne postoji');
    set('machine_id', Number(patch.machine_id));
  }
  if ('operator_id' in patch) set('operator_id', patch.operator_id || null);
  if ('labor_minutes' in patch) set('labor_minutes', Math.max(0, Math.round(Number(patch.labor_minutes) || 0)));
  if (validIso(patch.opened_at)) set('created_at', validIso(patch.opened_at));

  let status = patch.status && patch.status !== wo.status ? patch.status : null;
  if ('worker_id' in patch) {
    set('worker_id', patch.worker_id || null);
    // dodeljen majstor => nalog je "U toku"
    if (patch.worker_id && !status && wo.status === 'OTVOREN') status = 'U_TOKU';
  }
  let closing = false, closedIso = wo.closed_at;
  if (status) {
    if (!STATUSES.includes(status)) throw new ApiError(400, 'Nepoznat status');
    set('status', status);
    if (status === 'U_TOKU' && !wo.started_at) set('started_at', nowIso());
    if (status === 'ZAVRSEN') {
      closedIso = validIso(patch.closed_at) || nowIso();
      set('closed_at', closedIso); closing = true;
    } else if (wo.status === 'ZAVRSEN') { sets.push('closed_at=NULL'); set('downtime_min', 0); }
  } else if (wo.status === 'ZAVRSEN' && validIso(patch.closed_at)) {
    closedIso = validIso(patch.closed_at); set('closed_at', closedIso);
  }
  if (closing || (wo.status === 'ZAVRSEN' && !status && ('downtime_min' in patch || validIso(patch.closed_at) || validIso(patch.opened_at) || 'type' in patch))) {
    const startIso = validIso(patch.opened_at) || wo.created_at;
    const type = patch.type || wo.type;
    const auto = type === 'KVAR' ? minutesBetween(startIso, closedIso) : 0;
    set('downtime_min', 'downtime_min' in patch ? Math.max(0, Math.round(Number(patch.downtime_min) || 0)) : auto);
  }
  if (!sets.length) return wo;
  await t.run(`UPDATE workorders SET ${sets.join(', ')} WHERE id=?`, [...vals, id]);
  if (closing) { await closeWorkorderDowntime(t, wo); await completePreventive(t, wo, closedIso); }
  return { ...wo, status: status || wo.status };
}

async function acceptWorkorder(t, id, workerId) {
  const wo = await t.get('SELECT id, number, status, worker_id FROM workorders WHERE id=?', [id]);
  if (!wo) throw new ApiError(404, 'Radni nalog ne postoji');
  if (wo.status === 'ZAVRSEN') throw new ApiError(409, 'Nalog je već zatvoren');
  const ts = nowIso();
  if (wo.worker_id === workerId) { // vec zaduzen: potvrda prijema
    await t.run('UPDATE workorders SET accepted_at=COALESCE(accepted_at,?) WHERE id=?', [ts, id]);
    return { number: wo.number, already: true };
  }
  if (wo.worker_id) throw new ApiError(409, 'Nalog je već prihvatio drugi majstor');
  const r = await t.run("UPDATE workorders SET worker_id=?, status='U_TOKU', started_at=COALESCE(started_at,?), accepted_at=? WHERE id=? AND worker_id IS NULL",
    [workerId, ts, ts, id]);
  if (!r.changes) throw new ApiError(409, 'Nalog je već prihvatio drugi majstor');
  return { number: wo.number };
}

// Sledeca slobodna sifra artikla po redu: 0000, 0001, ... 9999 (sifre arhiviranih artikala se ne koriste ponovo)
async function nextInventoryCode(t) {
  const rows = await t.all('SELECT code FROM inventory');
  const used = new Set();
  let max = -1;
  for (const r of rows) {
    if (/^\d{4}$/.test(String(r.code || ''))) { const n = Number(r.code); used.add(n); if (n > max) max = n; }
  }
  let n = max + 1;
  if (n > 9999) { n = 0; while (n <= 9999 && used.has(n)) n++; }
  if (n > 9999) throw new ApiError(409, 'Sve šifre od 0000 do 9999 su iskorišćene');
  return String(n).padStart(4, '0');
}

// ---------- magacin ----------
async function stockMove(t, { inventory_id, type, quantity, note, userId, workorder_id, worker_id }) {
  const item = await t.get('SELECT * FROM inventory WHERE id=?', [inventory_id]);
  if (!item) throw new ApiError(404, 'Artikal ne postoji');
  let q = Number(quantity);
  if (!isFinite(q) || q < 0 || (type !== 'KOREKCIJA' && q <= 0)) throw new ApiError(400, 'Količina nije ispravna');
  let delta;
  if (type === 'ULAZ') delta = q;
  else if (type === 'IZLAZ') {
    if (q > item.quantity) throw new ApiError(409, `Nema dovoljno na stanju (stanje: ${item.quantity} ${item.unit || ''})`.trim());
    delta = -q;
  } else if (type === 'KOREKCIJA') delta = q - item.quantity; // q je prebrojano stanje
  else throw new ApiError(400, 'Nepoznata vrsta promene');
  await t.run('UPDATE inventory SET quantity=quantity+? WHERE id=?', [delta, inventory_id]);
  await t.run('INSERT INTO inventory_transactions(inventory_id,transaction_type,quantity,workorder_id,worker_id,user_id,note,created_at) VALUES (?,?,?,?,?,?,?,?)',
    [inventory_id, type, type === 'KOREKCIJA' ? delta : q, workorder_id || null, worker_id || null, userId || null, note || null, nowIso()]);
  return { quantity: item.quantity + delta };
}

async function addPart(t, workorder_id, inventory_id, quantity, userId) {
  const wo = await t.get('SELECT id, number FROM workorders WHERE id=?', [workorder_id]);
  if (!wo) throw new ApiError(404, 'Radni nalog ne postoji');
  const item = await t.get('SELECT * FROM inventory WHERE id=? AND archived=0', [inventory_id]);
  if (!item) throw new ApiError(404, 'Artikal ne postoji');
  await stockMove(t, { inventory_id, type: 'IZLAZ', quantity, note: `Nalog ${wo.number}`, userId, workorder_id });
  const r = await t.run('INSERT INTO workorder_parts(workorder_id,inventory_id,quantity,unit_price,created_at) VALUES (?,?,?,?,?)',
    [workorder_id, inventory_id, Number(quantity), item.unit_price || 0, nowIso()]);
  return { id: r.lastID };
}

async function removePart(t, workorder_id, partId, userId) {
  const p = await t.get('SELECT * FROM workorder_parts WHERE id=? AND workorder_id=?', [partId, workorder_id]);
  if (!p) throw new ApiError(404, 'Stavka ne postoji');
  await stockMove(t, { inventory_id: p.inventory_id, type: 'ULAZ', quantity: p.quantity, note: 'Povrat sa radnog naloga', userId, workorder_id });
  await t.run('DELETE FROM workorder_parts WHERE id=?', [partId]);
}

// ---------- preventiva: automatsko pravljenje naloga ----------
async function generatePreventiveOrders(db, leadDays = 2) {
  const limit = localDate(new Date(Date.now() + leadDays * 864e5));
  const due = await db.all(
    `SELECT p.* FROM preventive p JOIN machines m ON m.id=p.machine_id
      WHERE p.status='AKTIVNA' AND m.archived=0 AND p.next_date IS NOT NULL AND p.next_date<=?
        AND NOT EXISTS (SELECT 1 FROM workorders w WHERE w.preventive_id=p.id AND w.status!='ZAVRSEN')`, [limit]);
  let created = 0;
  for (const p of due) {
    await db.tx(async t => {
      const again = await t.get("SELECT 1 x FROM workorders WHERE preventive_id=? AND status!='ZAVRSEN'", [p.id]);
      if (again) return;
      await createWorkorder(t, {
        machine_id: p.machine_id, type: 'PREVENTIVA', preventive_id: p.id, priority: 'SREDNJI', worker_id: p.worker_id,
        description: `Preventiva: ${p.title}${p.description ? '\n' + p.description : ''}\nPlanirano za: ${p.next_date}`
      }, null);
      created++;
    });
  }
  return created;
}

module.exports = {
  ApiError, STATUSES, PRIORITIES, WO_TYPES, MACHINE_STATUSES, PERIODS,
  nowIso, localDate, periodKey, addPeriod, minutesBetween, audit,
  createWorkorder, updateWorkorder, acceptWorkorder, nextInventoryCode, stockMove, addPart, removePart, generatePreventiveOrders
};
