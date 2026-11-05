'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const multer = require('multer');
const QRCode = require('qrcode');

const A = require('./auth');
const S = require('./services');
const X = require('./exports');
const { ApiError } = S;

const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const str = (v, max = 500) => (v == null ? '' : String(v).trim().slice(0, max));
const reqStr = (v, label, max) => { const s = str(v, max); if (!s) throw new ApiError(400, `${label} je obavezno polje`); return s; };
const num = (v, d = 0) => { const n = Number(v); return isFinite(n) ? n : d; };
const int = v => (v === '' || v == null ? null : Math.trunc(Number(v)) || null);
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');

module.exports = function buildApi(db, cfg, hooks = {}) {
  const r = express.Router();
  const log = (req, ...a) => S.audit(db, req.user, ...a);
  const baseUrl = async req => {
    const row = await db.get("SELECT value FROM settings WHERE key='public_url'");
    return (row && row.value ? row.value.replace(/\/+$/, '') : `${req.protocol}://${req.get('host')}`);
  };

  // =============== AUTH ===============
  r.post('/auth/login', ah(async (req, res) => {
    const username = str(req.body.username, 60).toLowerCase();
    const key = req.ip + '|' + username;
    if (A.tooManyAttempts(key)) return res.status(429).json({ error: 'Previše pogrešnih pokušaja. Pokušajte ponovo za 15 minuta.' });
    const u = await db.get('SELECT * FROM users WHERE lower(username)=? AND active=1', [username]);
    const ok = u && await A.verifyPassword(String(req.body.password || ''), u.password);
    if (!ok) { A.failAttempt(key); await S.audit(db, null, 'login_neuspesan', 'user', null, username); return res.status(401).json({ error: 'Pogrešno korisničko ime ili lozinka' }); }
    A.clearAttempts(key);
    if (A.needsRehash(u.password)) await db.run('UPDATE users SET password=? WHERE id=?', [await A.hashPassword(req.body.password), u.id]);
    await db.run('UPDATE users SET last_login=? WHERE id=?', [S.nowIso(), u.id]);
    await A.createSession(db, req, res, u.id, cfg.sessionDays);
    await S.audit(db, u, 'login', 'user', u.id);
    res.json({ user: { id: u.id, username: u.username, fullname: u.fullname, role: u.role, must_change_password: !!u.must_change_password, worker_id: u.worker_id || null } });
  }));

  r.post('/auth/logout', ah(async (req, res) => {
    if (req.sessionHash) await db.run('DELETE FROM sessions WHERE token_hash=?', [req.sessionHash]);
    A.setCookie(req, res, '', 0);
    res.json({ ok: true });
  }));

  r.get('/auth/me', ah(async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Niste prijavljeni' });
    const w = req.user.worker_id ? await db.get('SELECT fullname FROM workers WHERE id=?', [req.user.worker_id]) : null;
    res.json({ user: { ...req.user, worker_name: w ? w.fullname : null, alerts: A.wantsAlerts(req.user) }, perms: A.PERMS[req.user.role] });
  }));

  r.post('/auth/change-password', A.requireLogin, ah(async (req, res) => {
    const u = await db.get('SELECT * FROM users WHERE id=?', [req.user.id]);
    if (!await A.verifyPassword(String(req.body.current || ''), u.password)) throw new ApiError(400, 'Trenutna lozinka nije tačna');
    const next = String(req.body.next || '');
    if (next.length < 8) throw new ApiError(400, 'Nova lozinka mora imati najmanje 8 znakova');
    if (next === 'admin123') throw new ApiError(400, 'Izaberite drugu lozinku');
    await db.run('UPDATE users SET password=?, must_change_password=0 WHERE id=?', [await A.hashPassword(next), u.id]);
    await db.run('DELETE FROM sessions WHERE user_id=? AND token_hash!=?', [u.id, req.sessionHash]);
    await log(req, 'promena_lozinke', 'user', u.id);
    res.json({ ok: true });
  }));

  // sve ispod zahteva prijavu
  r.use(A.requireLogin);

  // =============== DASHBOARD ===============
  r.get('/dashboard', ah(async (req, res) => {
    const today = S.localDate();
    const soon = S.localDate(new Date(Date.now() + 2 * 864e5));
    const one = async (sql, p) => (await db.get(sql, p)) || {};
    const c = await one(`SELECT
        (SELECT COUNT(*) FROM workorders WHERE status!='ZAVRSEN') wo_open,
        (SELECT COUNT(*) FROM workorders WHERE status!='ZAVRSEN' AND priority='VISOK') wo_urgent,
        (SELECT COUNT(*) FROM workorders WHERE status='OTVOREN' AND worker_id IS NULL) wo_unassigned,
        (SELECT COALESCE(SUM(downtime_min),0) FROM workorders WHERE status='ZAVRSEN') downtime_min,
        (SELECT COUNT(*) FROM preventive p JOIN machines m ON m.id=p.machine_id WHERE p.status='AKTIVNA' AND m.archived=0) pm_active,
        (SELECT COUNT(*) FROM inventory WHERE archived=0 AND quantity<=minimum) low_stock,
        (SELECT COUNT(*) FROM machines WHERE archived=0) machines,
        (SELECT COUNT(*) FROM workers WHERE status!='NEAKTIVAN') workers,
        (SELECT COUNT(*) FROM inventory WHERE archived=0) inventory`);
    const recent = await db.all(`SELECT w.id, w.number, w.status, w.priority, w.type, w.created_at, m.code machine_code, m.name machine_name
        FROM workorders w LEFT JOIN machines m ON m.id=w.machine_id ORDER BY w.id DESC LIMIT 6`);
    const alarms = await db.all(`SELECT p.id, p.title, p.next_date, p.period_type, m.id machine_id, m.code machine_code, m.name machine_name,
        (SELECT w.number FROM workorders w WHERE w.preventive_id=p.id AND w.status!='ZAVRSEN' LIMIT 1) open_wo
        FROM preventive p JOIN machines m ON m.id=p.machine_id
        WHERE p.status='AKTIVNA' AND m.archived=0 AND p.next_date<=? ORDER BY p.next_date LIMIT 20`, [soon]);
    let backup_warn = null;
    if (A.can(req.user.role, 'backup')) {
      const bs = await hooks.backup.status();
      if (bs.dir && bs.last && bs.last.ok === false) backup_warn = { dir: bs.dir, error: bs.last.error, at: bs.last.at };
    }
    res.json({ counts: c, recent, alarms, today, backup_warn });
  }));

  // =============== OBAVESTENJA I PRIHVATANJE NALOGA ===============
  // Android aplikacija (i web) pita ovu putanju na svakih ~10 s. Lista sadrzi naloge koji cekaju ovog majstora.
  r.get('/alerts', ah(async (req, res) => {
    const u = req.user;
    const rs = await db.get("SELECT value FROM settings WHERE key='remind_minutes'");
    const remind = rs && rs.value !== '' && rs.value != null ? Math.max(0, Number(rs.value) || 0) : 10;
    let items = [];
    if (A.wantsAlerts(u)) {
      items = await db.all(`SELECT w.id, w.number, w.priority, w.type, w.description, w.created_at,
          m.code machine_code, m.name machine_name, m.location machine_location,
          CASE WHEN w.worker_id IS NULL THEN 'open' ELSE 'mine' END kind
        FROM workorders w LEFT JOIN machines m ON m.id=w.machine_id
        WHERE w.status!='ZAVRSEN' AND ((w.worker_id IS NULL AND w.status='OTVOREN') OR (w.worker_id IS NOT NULL AND w.worker_id=? AND w.accepted_at IS NULL))
        ORDER BY CASE w.priority WHEN 'VISOK' THEN 0 WHEN 'SREDNJI' THEN 1 ELSE 2 END, w.id`, [u.worker_id || -1]);
    }
    res.json({ items, remind_minutes: remind, can_accept: !!u.worker_id, worker_id: u.worker_id || null, now: S.nowIso() });
  }));

  r.post('/workorders/:id/accept', A.need('wo.write'), ah(async (req, res) => {
    if (!req.user.worker_id) throw new ApiError(400, 'Vaš nalog nije povezan sa majstorom. Administrator to podešava u Baza Podataka → Korisnici Sistema.');
    const wk = await db.get('SELECT status FROM workers WHERE id=?', [req.user.worker_id]);
    if (!wk || wk.status === 'NEAKTIVAN') throw new ApiError(400, 'Majstor povezan sa vašim nalogom je neaktivan.');
    const id = int(req.params.id);
    const out = await db.tx(t => S.acceptWorkorder(t, id, req.user.worker_id));
    if (!out.already) await log(req, 'prihvacen_nalog', 'workorder', id, `prihvatio majstor #${req.user.worker_id}`);
    res.json({ ok: true, ...out });
  }));

  // =============== MASINE ===============
  const MACHINE_FIELDS = ['code', 'name', 'manufacturer', 'model', 'serial_number', 'location', 'notes'];
  const machineBody = (b, partial) => {
    const o = {};
    for (const k of MACHINE_FIELDS) if (!partial || k in b) o[k] = str(b[k], k === 'notes' ? 2000 : 200);
    if ('code' in b) o.code = reqStr(b.code, 'Šifra', 60);
    if (!partial || 'name' in b) o.name = reqStr(b.name, 'Naziv', 200);
    if ('status' in b) { if (!S.MACHINE_STATUSES.includes(b.status)) throw new ApiError(400, 'Nepoznat status mašine'); o.status = b.status; }
    return o;
  };

  r.get('/machines', ah(async (req, res) => {
    const q = `%${str(req.query.q, 80).toLowerCase()}%`;
    const archived = req.query.archived === '1' ? 1 : 0;
    res.json(await db.all(
      `SELECT m.*, (SELECT COUNT(*) FROM workorders w WHERE w.machine_id=m.id AND w.status!='ZAVRSEN') open_wo
         FROM machines m WHERE m.archived=? AND (lower(m.code) LIKE ? OR lower(m.name) LIKE ? OR lower(COALESCE(m.location,'')) LIKE ?)
         ORDER BY m.code`, [archived, q, q, q]));
  }));

  r.get('/machines/by-code/:code', ah(async (req, res) => {
    const m = await db.get('SELECT id FROM machines WHERE lower(code)=lower(?)', [req.params.code]);
    if (!m) throw new ApiError(404, 'Mašina sa tom šifrom ne postoji');
    res.json(m);
  }));

  r.get('/machines/:id', ah(async (req, res) => {
    const id = int(req.params.id);
    const machine = await db.get('SELECT * FROM machines WHERE id=?', [id]);
    if (!machine) throw new ApiError(404, 'Mašina ne postoji');
    const workorders = await db.all(`SELECT w.id, w.number, w.status, w.priority, w.type, w.description, w.created_at, w.closed_at
        FROM workorders w WHERE w.machine_id=? ORDER BY w.id DESC LIMIT 50`, [id]);
    const preventive = await db.all('SELECT * FROM preventive WHERE machine_id=? ORDER BY next_date', [id]);
    const downtime = await db.all('SELECT * FROM downtime WHERE machine_id=? ORDER BY id DESC LIMIT 50', [id]);
    const parts = await db.all(`SELECT i.name, i.unit, SUM(p.quantity) quantity, SUM(p.quantity*COALESCE(p.unit_price,i.unit_price,0)) cost
        FROM workorder_parts p JOIN workorders w ON w.id=p.workorder_id LEFT JOIN inventory i ON i.id=p.inventory_id
        WHERE w.machine_id=? GROUP BY p.inventory_id ORDER BY cost DESC`, [id]);
    const stats = await db.get(`SELECT
        (SELECT COUNT(*) FROM workorders WHERE machine_id=? AND type='KVAR') failures,
        (SELECT COALESCE(SUM(downtime_min),0) FROM workorders WHERE machine_id=? AND status='ZAVRSEN') downtime_min,
        (SELECT ROUND(AVG((julianday(closed_at)-julianday(created_at))*1440)) FROM workorders
           WHERE machine_id=? AND type='KVAR' AND status='ZAVRSEN' AND closed_at IS NOT NULL) mttr_min`, [id, id, id]);
    stats.parts_cost = parts.reduce((s, p) => s + (p.cost || 0), 0);
    res.json({ machine, workorders, preventive, downtime, parts, stats });
  }));

  r.post('/machines', A.need('machines.write'), ah(async (req, res) => {
    const o = machineBody(req.body, false);
    if (!o.code) {
      const n = (await db.get('SELECT COUNT(*) n FROM machines')).n + 1;
      let c = 'M-' + String(n).padStart(3, '0');
      while (await db.get('SELECT 1 x FROM machines WHERE code=?', [c])) c = 'M-' + String(Math.floor(Math.random() * 9000) + 1000);
      o.code = c;
    }
    if (await db.get('SELECT 1 x FROM machines WHERE lower(code)=lower(?)', [o.code])) throw new ApiError(409, 'Mašina sa tom šifrom već postoji');
    const ins = await db.run(
      'INSERT INTO machines(code,name,manufacturer,model,serial_number,location,notes,status,archived,created_at) VALUES (?,?,?,?,?,?,?,?,0,?)',
      [o.code, o.name, o.manufacturer, o.model, o.serial_number, o.location, o.notes, 'AKTIVNA', S.nowIso()]);
    await log(req, 'dodata_masina', 'machine', ins.lastID, o.code);
    res.status(201).json({ id: ins.lastID });
  }));

  r.put('/machines/:id', A.need('machines.write'), ah(async (req, res) => {
    const id = int(req.params.id);
    const o = machineBody(req.body, true);
    if ('archived' in req.body) o.archived = req.body.archived ? 1 : 0;
    const keys = Object.keys(o);
    if (!keys.length) throw new ApiError(400, 'Nema izmena');
    if (o.code && await db.get('SELECT 1 x FROM machines WHERE lower(code)=lower(?) AND id!=?', [o.code, id])) throw new ApiError(409, 'Šifra je već zauzeta');
    const up = await db.run(`UPDATE machines SET ${keys.map(k => k + '=?').join(', ')} WHERE id=?`, [...keys.map(k => o[k]), id]);
    if (!up.changes) throw new ApiError(404, 'Mašina ne postoji');
    await log(req, 'izmenjena_masina', 'machine', id, keys.join(','));
    res.json({ ok: true });
  }));

  r.delete('/machines/:id', A.need('machines.write'), ah(async (req, res) => {
    const id = int(req.params.id);
    await db.run('UPDATE machines SET archived=1 WHERE id=?', [id]); // arhiva, istorija ostaje
    await log(req, 'arhivirana_masina', 'machine', id);
    res.json({ ok: true });
  }));

  const upload = multer({
    dest: cfg.uploadDir, limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => cb(null, /^image\/(png|jpe?g|webp)$/.test(file.mimetype))
  });
  r.post('/machines/:id/image', A.need('machines.write'), upload.single('image'), ah(async (req, res) => {
    if (!req.file) throw new ApiError(400, 'Dozvoljene su slike PNG, JPG ili WebP do 5 MB');
    const ext = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/webp': '.webp' }[req.file.mimetype];
    const name = `m${int(req.params.id)}-${Date.now()}${ext}`;
    fs.renameSync(req.file.path, path.join(cfg.uploadDir, name));
    await db.run('UPDATE machines SET image=? WHERE id=?', [name, int(req.params.id)]);
    res.json({ image: name });
  }));

  r.get('/machines/:id/qr.png', ah(async (req, res) => {
    const m = await db.get('SELECT code FROM machines WHERE id=?', [int(req.params.id)]);
    if (!m) throw new ApiError(404, 'Mašina ne postoji');
    const url = `${await baseUrl(req)}/#/m/${encodeURIComponent(m.code)}`;
    res.type('png').set('Cache-Control', 'private, max-age=3600').send(await QRCode.toBuffer(url, { width: 360, margin: 1, errorCorrectionLevel: 'M' }));
  }));

  // =============== RADNI NALOZI ===============
  const WO_SELECT = `SELECT w.*, m.code machine_code, m.name machine_name, m.location machine_location, wk.fullname worker_name, op.name operator_name, u.fullname creator_name,
      (SELECT COALESCE(SUM(p.quantity*COALESCE(p.unit_price,i.unit_price,0)),0) FROM workorder_parts p
         LEFT JOIN inventory i ON i.id=p.inventory_id WHERE p.workorder_id=w.id) parts_cost
      FROM workorders w LEFT JOIN machines m ON m.id=w.machine_id LEFT JOIN workers wk ON wk.id=w.worker_id LEFT JOIN operators op ON op.id=w.operator_id LEFT JOIN users u ON u.id=w.created_by`;

  r.get('/workorders', ah(async (req, res) => {
    const where = [], p = [];
    const { status, priority, machine_id, worker_id, q } = req.query;
    if (status === 'OPEN') where.push("w.status!='ZAVRSEN'");
    else if (S.STATUSES.includes(status)) { where.push('w.status=?'); p.push(status); }
    if (S.PRIORITIES.includes(priority)) { where.push('w.priority=?'); p.push(priority); }
    if (int(machine_id)) { where.push('w.machine_id=?'); p.push(int(machine_id)); }
    if (int(worker_id)) { where.push('w.worker_id=?'); p.push(int(worker_id)); }
    if (str(q)) { const l = `%${str(q, 80).toLowerCase()}%`; where.push("(lower(w.number) LIKE ? OR lower(COALESCE(w.description,'')) LIKE ? OR lower(COALESCE(m.code,'')) LIKE ?)"); p.push(l, l, l); }
    const limit = Math.min(3000, int(req.query.limit) || 1000), offset = Math.max(0, int(req.query.offset) || 0);
    const rows = await db.all(`${WO_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY CASE w.status WHEN 'ZAVRSEN' THEN 1 ELSE 0 END,
               CASE w.priority WHEN 'HITAN' THEN 0 WHEN 'VISOK' THEN 1 WHEN 'SREDNJI' THEN 2 ELSE 3 END, w.id DESC LIMIT ? OFFSET ?`, [...p, limit, offset]);
    res.json(rows);
  }));

  async function loadWo(id) {
    const wo = await db.get(`${WO_SELECT} WHERE w.id=?`, [id]);
    if (!wo) throw new ApiError(404, 'Radni nalog ne postoji');
    wo.parts = await db.all(`SELECT p.id, p.inventory_id, p.quantity, COALESCE(p.unit_price,i.unit_price,0) price, i.code, i.name, i.unit
        FROM workorder_parts p LEFT JOIN inventory i ON i.id=p.inventory_id WHERE p.workorder_id=? ORDER BY p.id`, [id]);
    wo.history = await db.all("SELECT created_at, username, action, detail FROM audit_log WHERE entity='workorder' AND entity_id=? ORDER BY id", [id]);
    return wo;
  }

  r.get('/workorders/:id', ah(async (req, res) => res.json(await loadWo(int(req.params.id)))));

  r.get('/workorders/:id/pdf', A.need('export'), ah(async (req, res) => {
    const wo = await loadWo(int(req.params.id));
    const c = await db.get("SELECT value FROM settings WHERE key='company'");
    X.sendWorkorderPdf(res, wo, wo.parts, c && c.value);
  }));

  r.post('/workorders', A.need('wo.report'), ah(async (req, res) => {
    const b = req.body;
    const operater = req.user.role === 'OPERATER';
    const d = {
      machine_id: int(b.machine_id), description: reqStr(b.description, 'Opis', 2000),
      priority: S.PRIORITIES.includes(b.priority) ? b.priority : 'SREDNJI',
      type: operater ? 'KVAR' : (S.WO_TYPES.includes(b.type) ? b.type : 'KVAR'),
      worker_id: operater ? null : int(b.worker_id), operator_id: int(b.operator_id), machine_down: !!b.machine_down,
      opened_at: operater ? null : b.opened_at
    };
    if (!d.machine_id) throw new ApiError(400, 'Izaberite mašinu');
    const out = await db.tx(t => S.createWorkorder(t, d, req.user.id));
    await log(req, 'otvoren_nalog', 'workorder', out.id, out.number + (d.machine_down ? ' (mašina stoji)' : ''));
    res.status(201).json(out);
  }));

  r.put('/workorders/:id', A.need('wo.write'), ah(async (req, res) => {
    const id = int(req.params.id);
    const before = await db.get('SELECT status, priority FROM workorders WHERE id=?', [id]);
    await db.tx(t => S.updateWorkorder(t, id, req.body));
    if (req.user.worker_id && Number(req.body.worker_id) === req.user.worker_id) await db.run('UPDATE workorders SET accepted_at=COALESCE(accepted_at,?) WHERE id=?', [S.nowIso(), id]);
    const bits = [];
    if (req.body.status && before && req.body.status !== before.status) bits.push(`status ${before.status} → ${req.body.status}`);
    if (req.body.priority && before && req.body.priority !== before.priority) bits.push(`prioritet ${before.priority} → ${req.body.priority}`);
    if ('worker_id' in req.body) bits.push('dodeljen majstor');
    if ('downtime_min' in req.body) bits.push(`zastoj ${req.body.downtime_min} min`);
    if ('resolution' in req.body) bits.push('upisan izvršeni rad');
    if ('labor_minutes' in req.body) bits.push(`vreme rada ${req.body.labor_minutes} min`);
    await log(req, 'izmenjen_nalog', 'workorder', id, bits.join('; ') || 'izmena');
    res.json({ ok: true });
  }));

  r.delete('/workorders/:id', A.need('wo.delete'), ah(async (req, res) => {
    const id = int(req.params.id);
    await db.tx(async t => {
      const parts = await t.all('SELECT id FROM workorder_parts WHERE workorder_id=?', [id]);
      for (const p of parts) await S.removePart(t, id, p.id, req.user.id); // delovi se vracaju u magacin
      await t.run('DELETE FROM downtime WHERE workorder_id=?', [id]);
      await t.run('DELETE FROM workorders WHERE id=?', [id]);
    });
    await log(req, 'obrisan_nalog', 'workorder', id);
    res.json({ ok: true });
  }));

  r.post('/workorders/:id/parts', A.need('inventory.use'), ah(async (req, res) => {
    const id = int(req.params.id);
    const out = await db.tx(t => S.addPart(t, id, int(req.body.inventory_id), num(req.body.quantity), req.user.id));
    await log(req, 'dodat_deo', 'workorder', id, `artikal ${req.body.inventory_id} x ${req.body.quantity}`);
    res.status(201).json(out);
  }));

  r.delete('/workorders/:id/parts/:partId', A.need('inventory.use'), ah(async (req, res) => {
    await db.tx(t => S.removePart(t, int(req.params.id), int(req.params.partId), req.user.id));
    await log(req, 'uklonjen_deo', 'workorder', int(req.params.id));
    res.json({ ok: true });
  }));

  // =============== MAGACIN ===============
  r.get('/inventory', ah(async (req, res) => {
    const q = `%${str(req.query.q, 80).toLowerCase()}%`;
    const archived = req.query.archived === '1' ? 1 : 0;
    res.json(await db.all(
      `SELECT inventory.*, (SELECT wk.fullname FROM inventory_transactions t JOIN workers wk ON wk.id=t.worker_id
           WHERE t.inventory_id=inventory.id AND t.transaction_type='ULAZ' ORDER BY t.id DESC LIMIT 1) last_receiver FROM inventory WHERE archived=? AND (lower(COALESCE(code,'')) LIKE ? OR lower(COALESCE(name,'')) LIKE ? OR lower(COALESCE(location,'')) LIKE ?)
         ORDER BY CASE WHEN quantity<=minimum THEN 0 ELSE 1 END, name`, [archived, q, q, q]));
  }));

  const invBody = (b, partial) => {
    const o = {};
    if (partial && 'code' in b) o.code = reqStr(b.code, 'Šifra', 60);
    if (!partial) o.code = str(b.code, 60);          // prazno = automatska sifra po redu
    if (!partial || 'name' in b) o.name = reqStr(b.name, 'Naziv', 200);
    for (const k of ['supplier', 'location', 'unit']) if (!partial || k in b) o[k] = str(b[k], 100) || (k === 'unit' ? 'kom' : '');
    for (const k of ['minimum', 'unit_price']) if (!partial || k in b) { o[k] = num(b[k]); if (o[k] < 0) throw new ApiError(400, 'Vrednost ne može biti negativna'); }
    return o;
  };

  r.get('/inventory/next-code', ah(async (req, res) => res.json({ code: await db.tx(t => S.nextInventoryCode(t)) })));

  r.post('/inventory', A.need('inventory.write'), ah(async (req, res) => {
    const o = invBody(req.body, false);
    if (o.code && await db.get('SELECT 1 x FROM inventory WHERE archived=0 AND lower(code)=lower(?)', [o.code])) throw new ApiError(409, 'Artikal sa tom šifrom već postoji');
    const qty = Math.max(0, num(req.body.quantity));
    const out = await db.tx(async t => {
      if (!o.code) o.code = await S.nextInventoryCode(t);
      const ins = await t.run('INSERT INTO inventory(code,name,quantity,minimum,unit,unit_price,supplier,location,archived) VALUES (?,?,0,?,?,?,?,?,0)',
        [o.code, o.name, o.minimum, o.unit, o.unit_price, o.supplier, o.location]);
      if (qty > 0) await S.stockMove(t, { inventory_id: ins.lastID, type: 'ULAZ', quantity: qty, note: 'Početno stanje', userId: req.user.id, worker_id: int(req.body.worker_id) });
      return ins.lastID;
    });
    await log(req, 'dodat_artikal', 'inventory', out, o.code);
    res.status(201).json({ id: out });
  }));

  r.put('/inventory/:id', A.need('inventory.write'), ah(async (req, res) => {
    const id = int(req.params.id);
    const o = invBody(req.body, true);
    if ('archived' in req.body) o.archived = req.body.archived ? 1 : 0;
    const keys = Object.keys(o);
    if (!keys.length) throw new ApiError(400, 'Nema izmena');
    await db.run(`UPDATE inventory SET ${keys.map(k => k + '=?').join(', ')} WHERE id=?`, [...keys.map(k => o[k]), id]);
    await log(req, 'izmenjen_artikal', 'inventory', id, keys.join(','));
    res.json({ ok: true });
  }));

  r.delete('/inventory/:id', A.need('inventory.write'), ah(async (req, res) => {
    await db.run('UPDATE inventory SET archived=1 WHERE id=?', [int(req.params.id)]);
    await log(req, 'arhiviran_artikal', 'inventory', int(req.params.id));
    res.json({ ok: true });
  }));

  r.post('/inventory/:id/stock', A.need('inventory.use'), ah(async (req, res) => {
    const type = String(req.body.type || '');
    if (type !== 'IZLAZ' && !A.can(req.user.role, 'inventory.write')) throw new ApiError(403, 'Nemate dozvolu za ovu radnju');
    const out = await db.tx(t => S.stockMove(t, { inventory_id: int(req.params.id), type, quantity: req.body.quantity, note: str(req.body.note, 200), userId: req.user.id, worker_id: int(req.body.worker_id) }));
    res.json(out);
  }));

  // Dnevnik prometa magacina sa filterima: from/to (datum), q (artikal: naziv ili sifra), type (ULAZ/IZLAZ/KOREKCIJA),
  // who (ko je evidentirao, broj radnog naloga ili napomena), inventory_id, limit
  r.get('/inventory/transactions', ah(async (req, res) => {
    const where = [], p = [];
    const id = int(req.query.inventory_id);
    if (id) { where.push('t.inventory_id=?'); p.push(id); }
    if (isDate(req.query.from)) { where.push("date(t.created_at,'localtime')>=?"); p.push(req.query.from); }
    if (isDate(req.query.to)) { where.push("date(t.created_at,'localtime')<=?"); p.push(req.query.to); }
    if (['ULAZ', 'IZLAZ', 'KOREKCIJA'].includes(req.query.type)) { where.push('t.transaction_type=?'); p.push(req.query.type); }
    const words = v => str(v, 80).toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6);
    for (const w of words(req.query.q)) {          // svaka rec mora da se nalazi u nazivu ili sifri artikla
      where.push("(lower(COALESCE(i.name,'')) LIKE ? OR lower(COALESCE(i.code,'')) LIKE ?)"); p.push(`%${w}%`, `%${w}%`);
    }
    for (const w of words(req.query.who)) {        // majstor, korisnik, broj naloga ili napomena
      where.push("(lower(COALESCE(wk.fullname,'')) LIKE ? OR lower(COALESCE(u.fullname,'')) LIKE ? OR lower(COALESCE(w.number,'')) LIKE ? OR lower(COALESCE(t.note,'')) LIKE ?)");
      p.push(`%${w}%`, `%${w}%`, `%${w}%`, `%${w}%`);
    }
    const limit = Math.min(2000, int(req.query.limit) || 200);
    res.json(await db.all(`SELECT t.*, i.code, i.name, i.unit, u.fullname user_name, wk.fullname worker_name, w.number wo_number
        FROM inventory_transactions t LEFT JOIN inventory i ON i.id=t.inventory_id LEFT JOIN users u ON u.id=t.user_id
        LEFT JOIN workorders w ON w.id=t.workorder_id LEFT JOIN workers wk ON wk.id=t.worker_id
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY t.id DESC LIMIT ?`, [...p, limit]));
  }));

  // =============== PREVENTIVA ===============
  r.get('/preventive', ah(async (req, res) => {
    res.json(await db.all(`SELECT p.*, m.code machine_code_ref, m.name machine_name, wk.fullname worker_name,
        (SELECT w.number FROM workorders w WHERE w.preventive_id=p.id AND w.status!='ZAVRSEN' LIMIT 1) open_wo,
        (SELECT w.id FROM workorders w WHERE w.preventive_id=p.id AND w.status!='ZAVRSEN' LIMIT 1) open_wo_id
        FROM preventive p LEFT JOIN machines m ON m.id=p.machine_id LEFT JOIN workers wk ON wk.id=p.worker_id ORDER BY p.next_date`));
  }));

  const pmBody = b => {
    const period = S.periodKey(b.period_type);
    if (!S.PERIODS[period]) throw new ApiError(400, 'Nepoznata periodika');
    if (!isDate(b.next_date)) throw new ApiError(400, 'Unesite datum sledeće preventive');
    return { machine_id: int(b.machine_id), title: reqStr(b.title, 'Aktivnost', 200), description: str(b.description, 1000), period_type: period, next_date: b.next_date, worker_id: int(b.worker_id) };
  };

  r.post('/preventive', A.need('preventive.write'), ah(async (req, res) => {
    const o = pmBody(req.body);
    const m = await db.get('SELECT code FROM machines WHERE id=? AND archived=0', [o.machine_id]);
    if (!m) throw new ApiError(400, 'Izaberite mašinu');
    const ins = await db.run("INSERT INTO preventive(machine_id,machine_code,title,description,period_type,worker_id,next_date,status) VALUES (?,?,?,?,?,?,?,'AKTIVNA')",
      [o.machine_id, m.code, o.title, o.description, o.period_type, o.worker_id, o.next_date]);
    await log(req, 'dodata_preventiva', 'preventive', ins.lastID, o.title);
    hooks.runPreventive && hooks.runPreventive();
    res.status(201).json({ id: ins.lastID });
  }));

  r.put('/preventive/:id', A.need('preventive.write'), ah(async (req, res) => {
    const id = int(req.params.id);
    const o = pmBody({ ...(await db.get('SELECT * FROM preventive WHERE id=?', [id])), ...req.body });
    const status = req.body.status === 'PAUZIRANA' ? 'PAUZIRANA' : 'AKTIVNA';
    await db.run('UPDATE preventive SET machine_id=?, title=?, description=?, period_type=?, worker_id=?, next_date=?, status=? WHERE id=?',
      [o.machine_id, o.title, o.description, o.period_type, o.worker_id, o.next_date, status, id]);
    res.json({ ok: true });
  }));

  r.delete('/preventive/:id', A.need('preventive.write'), ah(async (req, res) => {
    await db.run('DELETE FROM preventive WHERE id=?', [int(req.params.id)]);
    await log(req, 'obrisana_preventiva', 'preventive', int(req.params.id));
    res.json({ ok: true });
  }));

  r.post('/preventive/:id/generate', A.need('wo.write'), ah(async (req, res) => {
    const p = await db.get('SELECT * FROM preventive WHERE id=?', [int(req.params.id)]);
    if (!p) throw new ApiError(404, 'Preventiva ne postoji');
    const out = await db.tx(async t => {
      if (await t.get("SELECT 1 x FROM workorders WHERE preventive_id=? AND status!='ZAVRSEN'", [p.id])) throw new ApiError(409, 'Za ovu preventivu već postoji otvoren nalog');
      return S.createWorkorder(t, { machine_id: p.machine_id, type: 'PREVENTIVA', preventive_id: p.id, description: `Preventiva: ${p.title}${p.description ? '\n' + p.description : ''}`, worker_id: p.worker_id }, req.user.id);
    });
    await log(req, 'otvoren_nalog', 'workorder', out.id, out.number + ' (preventiva)');
    res.status(201).json(out);
  }));

  // =============== ZASTOJI ===============
  r.get('/downtime', ah(async (req, res) => {
    res.json(await db.all(`SELECT d.*, m.code machine_code, m.name machine_name, w.number wo_number
        FROM downtime d LEFT JOIN machines m ON m.id=d.machine_id LEFT JOIN workorders w ON w.id=d.workorder_id
        ORDER BY (d.end_time IS NULL) DESC, d.id DESC LIMIT 300`));
  }));

  r.post('/downtime', A.need('downtime.write'), ah(async (req, res) => {
    const b = req.body, machine_id = int(b.machine_id);
    if (!machine_id) throw new ApiError(400, 'Izaberite mašinu');
    const start = b.start_time ? new Date(b.start_time) : new Date();
    const end = b.end_time ? new Date(b.end_time) : null;
    if (isNaN(start) || (end && isNaN(end))) throw new ApiError(400, 'Datum nije ispravan');
    if (end && end < start) throw new ApiError(400, 'Kraj zastoja ne može biti pre početka');
    const ins = await db.run('INSERT INTO downtime(machine_id,reason,start_time,end_time,minutes,created_at) VALUES (?,?,?,?,?,?)',
      [machine_id, reqStr(b.reason, 'Razlog', 500), start.toISOString(), end ? end.toISOString() : null, end ? S.minutesBetween(start.toISOString(), end.toISOString()) : 0, S.nowIso()]);
    if (!end) await db.run("UPDATE machines SET status='U KVARU' WHERE id=?", [machine_id]);
    await log(req, 'zastoj', 'downtime', ins.lastID, b.reason);
    res.status(201).json({ id: ins.lastID });
  }));

  r.post('/downtime/:id/close', A.need('downtime.write'), ah(async (req, res) => {
    await db.tx(async t => {
      const d = await t.get('SELECT * FROM downtime WHERE id=?', [int(req.params.id)]);
      if (!d) throw new ApiError(404, 'Zastoj ne postoji');
      if (d.end_time) throw new ApiError(409, 'Zastoj je već zatvoren');
      const ts = S.nowIso();
      await t.run('UPDATE downtime SET end_time=?, minutes=? WHERE id=?', [ts, S.minutesBetween(d.start_time, ts), d.id]);
      const still = await t.get('SELECT 1 x FROM downtime WHERE machine_id=? AND end_time IS NULL LIMIT 1', [d.machine_id]);
      if (!still) await t.run("UPDATE machines SET status='AKTIVNA' WHERE id=? AND status='U KVARU'", [d.machine_id]);
    });
    res.json({ ok: true });
  }));

  r.delete('/downtime/:id', A.need('wo.delete'), ah(async (req, res) => {
    await db.run('DELETE FROM downtime WHERE id=?', [int(req.params.id)]);
    res.json({ ok: true });
  }));

  // =============== RADNICI ===============
  r.get('/workers', ah(async (req, res) => res.json(await db.all('SELECT * FROM workers ORDER BY fullname'))));

  const workerBody = b => ({
    code: str(b.code, 40), fullname: reqStr(b.fullname, 'Ime i prezime', 120), phone: str(b.phone, 40), position: str(b.position, 80),
    status: b.status === 'NEAKTIVAN' ? 'NEAKTIVAN' : 'AKTIVAN'
  });
  r.post('/workers', A.need('workers.write'), ah(async (req, res) => {
    const o = workerBody(req.body);
    const ins = await db.run('INSERT INTO workers(code,fullname,phone,position,status) VALUES (?,?,?,?,?)', [o.code, o.fullname, o.phone, o.position, o.status]);
    res.status(201).json({ id: ins.lastID });
  }));
  r.put('/workers/:id', A.need('workers.write'), ah(async (req, res) => {
    const o = workerBody(req.body);
    await db.run('UPDATE workers SET code=?, fullname=?, phone=?, position=?, status=? WHERE id=?', [o.code, o.fullname, o.phone, o.position, o.status, int(req.params.id)]);
    res.json({ ok: true });
  }));
  r.delete('/workers/:id', A.need('workers.write'), ah(async (req, res) => {
    const used = await db.get('SELECT 1 x FROM workorders WHERE worker_id=? LIMIT 1', [int(req.params.id)]);
    if (used) await db.run("UPDATE workers SET status='NEAKTIVAN' WHERE id=?", [int(req.params.id)]);
    else await db.run('DELETE FROM workers WHERE id=?', [int(req.params.id)]);
    res.json({ ok: true, deactivated: !!used });
  }));

  // =============== OPERATERI PROIZVODNJE ===============
  r.get('/operators', ah(async (req, res) => res.json(await db.all('SELECT * FROM operators ORDER BY name'))));
  r.post('/operators', A.need('workers.write'), ah(async (req, res) => {
    const ins = await db.run('INSERT INTO operators(name) VALUES (?)', [reqStr(req.body.name, 'Ime', 120)]);
    res.status(201).json({ id: ins.lastID });
  }));
  r.put('/operators/:id', A.need('workers.write'), ah(async (req, res) => {
    await db.run('UPDATE operators SET name=? WHERE id=?', [reqStr(req.body.name, 'Ime', 120), int(req.params.id)]);
    res.json({ ok: true });
  }));
  r.delete('/operators/:id', A.need('workers.write'), ah(async (req, res) => {
    const used = await db.get('SELECT 1 x FROM workorders WHERE operator_id=? LIMIT 1', [int(req.params.id)]);
    if (used) throw new ApiError(409, 'Operater je naveden na radnim nalozima i ne može se obrisati');
    await db.run('DELETE FROM operators WHERE id=?', [int(req.params.id)]);
    res.json({ ok: true });
  }));

  // =============== KORISNICI (samo ADMIN) ===============
  r.get('/users', A.need('users.manage'), ah(async (req, res) =>
    res.json(await db.all('SELECT id, username, fullname, role, active, worker_id, notify, last_login, created_at FROM users ORDER BY username'))));

  const lastAdminGuard = async (id, becomesNonAdmin) => {
    if (!becomesNonAdmin) return;
    const left = await db.get("SELECT COUNT(*) n FROM users WHERE role='ADMIN' AND active=1 AND id!=?", [id]);
    if (!left.n) throw new ApiError(409, 'Mora ostati bar jedan aktivan administrator');
  };

  r.post('/users', A.need('users.manage'), ah(async (req, res) => {
    const username = reqStr(req.body.username, 'Korisničko ime', 40).toLowerCase();
    if (!/^[a-z0-9._-]{3,40}$/.test(username)) throw new ApiError(400, 'Korisničko ime: 3-40 znakova (slova, brojevi, tačka, crta)');
    const role = A.ROLES.includes(req.body.role) ? req.body.role : 'OPERATER';
    const pw = String(req.body.password || '');
    if (pw.length < 8) throw new ApiError(400, 'Lozinka mora imati najmanje 8 znakova');
    if (await db.get('SELECT 1 x FROM users WHERE lower(username)=?', [username])) throw new ApiError(409, 'Korisničko ime je zauzeto');
    const ins = await db.run('INSERT INTO users(username,password,fullname,role,active,must_change_password,worker_id,notify,created_at) VALUES (?,?,?,?,1,1,?,?,?)',
      [username, await A.hashPassword(pw), str(req.body.fullname, 100), role, int(req.body.worker_id), req.body.notify == null ? null : (req.body.notify ? 1 : 0), S.nowIso()]);
    await log(req, 'dodat_korisnik', 'user', ins.lastID, `${username} (${role})`);
    res.status(201).json({ id: ins.lastID });
  }));

  r.put('/users/:id', A.need('users.manage'), ah(async (req, res) => {
    const id = int(req.params.id);
    const role = A.ROLES.includes(req.body.role) ? req.body.role : null;
    const active = req.body.active === false || req.body.active === 0 ? 0 : 1;
    const cur = await db.get('SELECT role, worker_id, notify FROM users WHERE id=?', [id]);
    if (!cur) throw new ApiError(404, 'Korisnik ne postoji');
    await lastAdminGuard(id, cur.role === 'ADMIN' && ((role && role !== 'ADMIN') || !active));
    const b = req.body;
    const wid = 'worker_id' in b ? int(b.worker_id) : cur.worker_id;
    const notify = 'notify' in b ? (b.notify == null ? null : (b.notify ? 1 : 0)) : cur.notify;
    await db.run('UPDATE users SET fullname=?, role=?, active=?, worker_id=?, notify=? WHERE id=?', [str(b.fullname, 100), role || cur.role, active, wid, notify, id]);
    if (req.body.password) {
      if (String(req.body.password).length < 8) throw new ApiError(400, 'Lozinka mora imati najmanje 8 znakova');
      await db.run('UPDATE users SET password=?, must_change_password=1 WHERE id=?', [await A.hashPassword(String(req.body.password)), id]);
      await db.run('DELETE FROM sessions WHERE user_id=?', [id]);
    }
    if (!active) await db.run('DELETE FROM sessions WHERE user_id=?', [id]);
    await log(req, 'izmenjen_korisnik', 'user', id);
    res.json({ ok: true });
  }));

  r.delete('/users/:id', A.need('users.manage'), ah(async (req, res) => {
    const id = int(req.params.id);
    if (id === req.user.id) throw new ApiError(409, 'Ne možete obrisati sopstveni nalog');
    const cur = await db.get('SELECT role FROM users WHERE id=?', [id]);
    if (cur) await lastAdminGuard(id, cur.role === 'ADMIN');
    await db.run('UPDATE users SET active=0 WHERE id=?', [id]);
    await db.run('DELETE FROM sessions WHERE user_id=?', [id]);
    await log(req, 'deaktiviran_korisnik', 'user', id);
    res.json({ ok: true });
  }));

  // =============== IZVESTAJI ===============
  // Datumi se racunaju po lokalnom vremenu servera (date(x,'localtime')), ne po UTC.
  r.get('/reports/summary', A.need('reports.view'), ah(async (req, res) => {
    const to = isDate(req.query.to) ? req.query.to : S.localDate();
    const from = isDate(req.query.from) ? req.query.from : to.slice(0, 7) + '-01';
    if (from > to) throw new ApiError(400, 'Početni datum je posle krajnjeg');
    const D = c => `date(${c},'localtime')`;
    const rep = [from, to];
    const mttr = "ROUND(AVG((julianday(w.closed_at)-julianday(w.created_at))*1440))";

    const kpi = await db.get(`SELECT
        (SELECT COUNT(*) FROM workorders WHERE ${D('created_at')} BETWEEN ? AND ?) wo_created,
        (SELECT COUNT(*) FROM workorders WHERE type='KVAR' AND ${D('created_at')} BETWEEN ? AND ?) faults,
        (SELECT COUNT(*) FROM workorders WHERE status='ZAVRSEN' AND ${D('closed_at')} BETWEEN ? AND ?) wo_closed,
        (SELECT ROUND(AVG((julianday(closed_at)-julianday(created_at))*1440)) FROM workorders
           WHERE status='ZAVRSEN' AND type='KVAR' AND closed_at IS NOT NULL AND ${D('closed_at')} BETWEEN ? AND ?) mttr_min,
        (SELECT COALESCE(SUM(downtime_min),0) FROM workorders WHERE status='ZAVRSEN' AND ${D('closed_at')} BETWEEN ? AND ?) downtime_min,
        (SELECT COALESCE(SUM(p.quantity*COALESCE(p.unit_price,0)),0) FROM workorder_parts p WHERE ${D('p.created_at')} BETWEEN ? AND ?) parts_cost,
        (SELECT COUNT(*) FROM workorders WHERE status!='ZAVRSEN') open_now,
        (SELECT COALESCE(SUM(quantity*unit_price),0) FROM inventory WHERE archived=0) stock_value`,
      [...rep, ...rep, ...rep, ...rep, ...rep, ...rep]);

    const by_machine = await db.all(`SELECT * FROM (SELECT m.id, m.code, m.name,
        (SELECT COUNT(*) FROM workorders w WHERE w.machine_id=m.id AND ${D('w.created_at')} BETWEEN ? AND ?) wo_total,
        (SELECT COUNT(*) FROM workorders w WHERE w.machine_id=m.id AND w.type='KVAR' AND ${D('w.created_at')} BETWEEN ? AND ?) failures,
        (SELECT COALESCE(SUM(w.downtime_min),0) FROM workorders w WHERE w.machine_id=m.id AND w.status='ZAVRSEN' AND ${D('w.closed_at')} BETWEEN ? AND ?) downtime_min,
        (SELECT ${mttr} FROM workorders w WHERE w.machine_id=m.id AND w.type='KVAR' AND w.status='ZAVRSEN' AND w.closed_at IS NOT NULL AND ${D('w.closed_at')} BETWEEN ? AND ?) mttr_min,
        (SELECT COALESCE(SUM(p.quantity*COALESCE(p.unit_price,0)),0) FROM workorder_parts p JOIN workorders w ON w.id=p.workorder_id
           WHERE w.machine_id=m.id AND ${D('p.created_at')} BETWEEN ? AND ?) parts_cost
      FROM machines m) WHERE wo_total>0 OR downtime_min>0 OR parts_cost>0
      ORDER BY downtime_min DESC, failures DESC, parts_cost DESC LIMIT 25`, [...rep, ...rep, ...rep, ...rep, ...rep]);

    const top_parts = await db.all(`SELECT i.code, i.name, i.unit, SUM(p.quantity) qty,
        SUM(p.quantity*COALESCE(p.unit_price,i.unit_price,0)) cost
      FROM workorder_parts p LEFT JOIN inventory i ON i.id=p.inventory_id
      WHERE ${D('p.created_at')} BETWEEN ? AND ? GROUP BY p.inventory_id ORDER BY cost DESC, qty DESC LIMIT 10`, rep);

    const by_worker = await db.all(`SELECT wk.fullname name, COUNT(*) assigned,
        SUM(CASE WHEN w.status='ZAVRSEN' THEN 1 ELSE 0 END) closed,
        (SELECT ${mttr} FROM workorders w WHERE w.worker_id=wk.id AND w.type='KVAR' AND w.status='ZAVRSEN' AND w.closed_at IS NOT NULL AND ${D('w.closed_at')} BETWEEN ? AND ?) mttr_min
      FROM workorders w JOIN workers wk ON wk.id=w.worker_id WHERE ${D('w.created_at')} BETWEEN ? AND ?
      GROUP BY wk.id ORDER BY assigned DESC`, [...rep, ...rep]);

    const by_operator = await db.all(`SELECT op.name, COUNT(*) reports, SUM(CASE WHEN w.type='KVAR' THEN 1 ELSE 0 END) faults,
        COALESCE(SUM(w.downtime_min),0) downtime_min
      FROM workorders w JOIN operators op ON op.id=w.operator_id WHERE ${D('w.created_at')} BETWEEN ? AND ?
      GROUP BY op.id ORDER BY reports DESC`, rep);

    const by_type = await db.all(`SELECT type, COUNT(*) n FROM workorders WHERE ${D('created_at')} BETWEEN ? AND ? GROUP BY type`, rep);
    const by_priority = await db.all(`SELECT priority, COUNT(*) n FROM workorders WHERE ${D('created_at')} BETWEEN ? AND ? GROUP BY priority`, rep);

    // niz za grafikon: po danima (do 45 dana) ili po mesecima (najvise 36)
    const first = await db.get(`SELECT MIN(${D('created_at')}) d FROM workorders`);
    const start = first && first.d && first.d > from ? first.d : from;
    const days = Math.max(1, Math.round((Date.parse(to) - Date.parse(start)) / 864e5) + 1);
    const unit = days <= 45 ? 'day' : 'month';
    const fmtKey = unit === 'day' ? D('X') : `strftime('%Y-%m',X,'localtime')`;
    const cr = await db.all(`SELECT ${fmtKey.replace(/X/g, 'created_at')} k, COUNT(*) n FROM workorders WHERE ${D('created_at')} BETWEEN ? AND ? GROUP BY k`, rep);
    const cl = await db.all(`SELECT ${fmtKey.replace(/X/g, 'closed_at')} k, COUNT(*) n FROM workorders WHERE status='ZAVRSEN' AND closed_at IS NOT NULL AND ${D('closed_at')} BETWEEN ? AND ? GROUP BY k`, rep);
    const cm = Object.fromEntries(cr.map(x => [x.k, x.n])), clm = Object.fromEntries(cl.map(x => [x.k, x.n]));
    const keys = [];
    if (unit === 'day') {
      for (let t = Date.parse(start); t <= Date.parse(to); t += 864e5) keys.push(new Date(t).toISOString().slice(0, 10));
    } else {
      let y = Number(start.slice(0, 4)), m = Number(start.slice(5, 7));
      const ey = Number(to.slice(0, 4)), em = Number(to.slice(5, 7));
      while (y < ey || (y === ey && m <= em)) { keys.push(`${y}-${String(m).padStart(2, '0')}`); if (++m > 12) { m = 1; y++; } }
    }
    const series = keys.slice(-36).map(k => ({ key: k, created: cm[k] || 0, closed: clm[k] || 0 }));

    res.json({ from, to, unit, kpi, series, by_machine, by_worker, by_operator, top_parts, by_type, by_priority });
  }));

  // =============== IZVOZ U EXCEL ===============
  const dt = v => (v ? String(v).replace('T', ' ').slice(0, 16) : '');
  r.get('/export/:what.xlsx', A.need('export'), ah(async (req, res) => {
    const day = S.localDate();
    switch (req.params.what) {
      case 'machines': return X.sendExcel(res, `masine-${day}.xlsx`, 'Mašine', [
        { header: 'Šifra', key: 'code' }, { header: 'Naziv', key: 'name', width: 30 }, { header: 'Proizvođač', key: 'manufacturer' }, { header: 'Model', key: 'model' },
        { header: 'Serijski broj', key: 'serial_number' }, { header: 'Lokacija', key: 'location' }, { header: 'Status', key: 'status' }],
      await db.all('SELECT * FROM machines WHERE archived=0 ORDER BY code'));
      case 'workorders': return X.sendExcel(res, `radni-nalozi-${day}.xlsx`, 'Radni nalozi', [
        { header: 'Broj', key: 'number' }, { header: 'Mašina', key: 'machine_code' }, { header: 'Opis', key: 'description', width: 50 }, { header: 'Prioritet', key: 'priority' },
        { header: 'Status', key: 'status' }, { header: 'Majstor', key: 'worker_name', width: 22 }, { header: 'Otvoren', key: 'created_at', width: 18 }, { header: 'Zatvoren', key: 'closed_at', width: 18 },
        { header: 'Rad (min)', key: 'labor_minutes' }, { header: 'Delovi (din)', key: 'parts_cost' }],
      (await db.all(`${WO_SELECT} ORDER BY w.id DESC`)).map(w => ({ ...w, created_at: dt(w.created_at), closed_at: dt(w.closed_at) })));
      case 'inventory': return X.sendExcel(res, `magacin-${day}.xlsx`, 'Magacin', [
        { header: 'Šifra', key: 'code' }, { header: 'Naziv', key: 'name', width: 34 }, { header: 'Stanje', key: 'quantity' }, { header: 'Minimum', key: 'minimum' },
        { header: 'Jedinica', key: 'unit' }, { header: 'Cena', key: 'unit_price' }, { header: 'Vrednost', key: 'value' }, { header: 'Dobavljač', key: 'supplier', width: 24 }, { header: 'Lokacija', key: 'location' }],
      (await db.all('SELECT * FROM inventory WHERE archived=0 ORDER BY name')).map(i => ({ ...i, value: Math.round((i.quantity || 0) * (i.unit_price || 0) * 100) / 100 })));
      case 'downtime': return X.sendExcel(res, `zastoji-${day}.xlsx`, 'Zastoji', [
        { header: 'Mašina', key: 'machine_code' }, { header: 'Razlog', key: 'reason', width: 44 }, { header: 'Početak', key: 'start_time', width: 18 },
        { header: 'Kraj', key: 'end_time', width: 18 }, { header: 'Minuta', key: 'minutes' }, { header: 'Nalog', key: 'wo_number' }],
      (await db.all(`SELECT d.*, m.code machine_code, w.number wo_number FROM downtime d LEFT JOIN machines m ON m.id=d.machine_id
          LEFT JOIN workorders w ON w.id=d.workorder_id ORDER BY d.id DESC`)).map(d => ({ ...d, start_time: dt(d.start_time), end_time: dt(d.end_time) })));
      default: throw new ApiError(404, 'Nepoznat izvoz');
    }
  }));

  // =============== BACKUP (samo ADMIN) ===============
  r.get('/backups', A.need('backup'), ah(async (req, res) => res.json(hooks.backup.list())));
  r.post('/backups', A.need('backup'), ah(async (req, res) => {
    const out = await hooks.backup.create('rucni');
    await log(req, 'backup', 'system', null, out.name);
    res.status(201).json({ file: out.name, copy: out.copy });
  }));
  // dodatna kopija na USB disk / mreznu fasciklu
  r.get('/backups/external', A.need('backup'), ah(async (req, res) => res.json(await hooks.backup.status())));
  r.put('/backups/external', A.need('backup'), ah(async (req, res) => {
    const out = await hooks.backup.setExternal(req.body.dir);
    await log(req, 'backup_odrediste', 'system', null, out.dir || 'iskljuceno');
    res.json(out);
  }));
  r.post('/backups/external/sync', A.need('backup'), ah(async (req, res) => {
    const result = await hooks.backup.syncExternal();
    res.json({ ...(await hooks.backup.status()), result });
  }));
  r.get('/backups/:name', A.need('backup'), ah(async (req, res) => {
    if (!/^[\w.-]+\.db$/.test(req.params.name)) throw new ApiError(400, 'Neispravno ime fajla');
    const p = path.join(cfg.backupDir, req.params.name);
    if (!fs.existsSync(p)) throw new ApiError(404, 'Backup ne postoji');
    res.download(p);
  }));

  r.get('/qr.png', ah(async (req, res) => {
    const url = str(req.query.url, 300);
    if (!/^https?:\/\/[^\s]+$/i.test(url)) throw new ApiError(400, 'Neispravna adresa');
    res.type('png').set('Cache-Control', 'private, max-age=3600').send(await QRCode.toBuffer(url, { width: 320, margin: 1, errorCorrectionLevel: 'M' }));
  }));

  // =============== SISTEM ===============
  r.get('/server-info', ah(async (req, res) => {
    const urls = [];
    for (const [name, list] of Object.entries(os.networkInterfaces())) {
      for (const n of list || []) if (n.family === 'IPv4' && !n.internal) urls.push({ iface: name, url: `http://${n.address}:${cfg.port}` });
    }
    const settings = Object.fromEntries((await db.all('SELECT key, value FROM settings')).map(s => [s.key, s.value]));
    res.json({ version: cfg.version, driver: db.driver, node: process.version, uptime_s: Math.round(process.uptime()),
      urls, public_url: settings.public_url || '', company: settings.company || '', remind_minutes: settings.remind_minutes == null ? '10' : settings.remind_minutes, host: req.get('host') });
  }));

  r.put('/settings', A.need('settings.manage'), ah(async (req, res) => {
    for (const k of ['company', 'public_url', 'remind_minutes']) {
      if (!(k in req.body)) continue;
      let v = str(req.body[k], 200);
      if (k === 'remind_minutes') { const n = Number(v); if (v === '' || !isFinite(n) || n < 0 || n > 1440) throw new ApiError(400, 'Podsetnik: unesite broj minuta od 0 do 1440 (0 = isključeno)'); v = String(Math.round(n)); }
      if (k === 'public_url' && v && !/^https?:\/\/[^\s]+$/i.test(v)) throw new ApiError(400, 'Javna adresa mora početi sa http:// ili https://');
      await db.run('INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [k, v]);
    }
    await log(req, 'podesavanja', 'system', null);
    res.json({ ok: true });
  }));

  r.get('/audit', A.need('settings.manage'), ah(async (req, res) =>
    res.json(await db.all('SELECT * FROM audit_log ORDER BY id DESC LIMIT 200'))));

  return r;
};
