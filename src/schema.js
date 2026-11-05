'use strict';
// Sema baze + migracije. Sve je idempotentno: nova baza se kreira od nule, a postojeca
// (V2/V3) se dopunjuje kolonama koje fale. Podaci se nikad ne brisu.
const fs = require('fs');
const path = require('path');
const { hashPassword } = require('./auth');

const SCHEMA_VERSION = 5;

const TABLES = {
  users: {
    username: 'TEXT UNIQUE', password: 'TEXT', fullname: 'TEXT', role: "TEXT DEFAULT 'OPERATER'",
    active: 'INTEGER DEFAULT 1', must_change_password: 'INTEGER DEFAULT 0', worker_id: 'INTEGER', notify: 'INTEGER', created_at: 'TEXT', last_login: 'TEXT'
  },
  sessions: {
    token_hash: 'TEXT', user_id: 'INTEGER', created_at: 'TEXT', expires_at: 'TEXT', ip: 'TEXT', ua: 'TEXT'
  },
  workers: {
    code: 'TEXT', fullname: 'TEXT', phone: 'TEXT', position: 'TEXT', status: "TEXT DEFAULT 'AKTIVAN'"
  },
  operators: { name: 'TEXT' },
  machines: {
    code: 'TEXT UNIQUE', name: 'TEXT', manufacturer: 'TEXT', model: 'TEXT', serial_number: 'TEXT', location: 'TEXT',
    status: "TEXT DEFAULT 'AKTIVNA'", image: 'TEXT', notes: 'TEXT', archived: 'INTEGER DEFAULT 0', created_at: 'TEXT'
  },
  workorders: {
    number: 'TEXT', machine_id: 'INTEGER', worker_id: 'INTEGER', description: 'TEXT', priority: "TEXT DEFAULT 'SREDNJI'",
    status: "TEXT DEFAULT 'OTVOREN'", type: "TEXT DEFAULT 'KVAR'", resolution: 'TEXT', labor_minutes: 'INTEGER DEFAULT 0',
    created_by: 'INTEGER', accepted_at: 'TEXT', operator_id: 'INTEGER', downtime_min: 'INTEGER DEFAULT 0', preventive_id: 'INTEGER', created_at: 'TEXT', started_at: 'TEXT', closed_at: 'TEXT'
  },
  workorder_parts: {
    workorder_id: 'INTEGER', inventory_id: 'INTEGER', quantity: 'REAL', unit_price: 'REAL', created_at: 'TEXT'
  },
  inventory: {
    code: 'TEXT', name: 'TEXT', quantity: 'REAL DEFAULT 0', minimum: 'REAL DEFAULT 0', unit: "TEXT DEFAULT 'kom'",
    unit_price: 'REAL DEFAULT 0', supplier: 'TEXT', location: 'TEXT', archived: 'INTEGER DEFAULT 0'
  },
  inventory_transactions: {
    inventory_id: 'INTEGER', transaction_type: 'TEXT', quantity: 'REAL', workorder_id: 'INTEGER',
    worker_id: 'INTEGER', user_id: 'INTEGER', note: 'TEXT', created_at: 'TEXT'
  },
  preventive: {
    machine_id: 'INTEGER', machine_code: 'TEXT', title: 'TEXT', description: 'TEXT', period_type: "TEXT DEFAULT 'MESECNA'",
    worker_id: 'INTEGER', next_date: 'TEXT', last_date: 'TEXT', status: "TEXT DEFAULT 'AKTIVNA'"
  },
  downtime: {
    machine_id: 'INTEGER', reason: 'TEXT', start_time: 'TEXT', end_time: 'TEXT', minutes: 'INTEGER DEFAULT 0',
    workorder_id: 'INTEGER', created_at: 'TEXT'
  },
  audit_log: {
    created_at: 'TEXT', user_id: 'INTEGER', username: 'TEXT', action: 'TEXT', entity: 'TEXT', entity_id: 'INTEGER', detail: 'TEXT'
  },
  settings: null // posebna tabela (kljuc/vrednost)
};

const INDEXES = [
  'CREATE INDEX IF NOT EXISTS ix_wo_machine ON workorders(machine_id)',
  'CREATE INDEX IF NOT EXISTS ix_wo_status ON workorders(status)',
  'CREATE INDEX IF NOT EXISTS ix_wo_pm ON workorders(preventive_id)',
  'CREATE INDEX IF NOT EXISTS ix_wop_wo ON workorder_parts(workorder_id)',
  'CREATE INDEX IF NOT EXISTS ix_tx_inv ON inventory_transactions(inventory_id)',
  'CREATE INDEX IF NOT EXISTS ix_pm_machine ON preventive(machine_id)',
  'CREATE INDEX IF NOT EXISTS ix_dt_machine ON downtime(machine_id)',
  'CREATE INDEX IF NOT EXISTS ix_dt_wo ON downtime(workorder_id)',
  'CREATE UNIQUE INDEX IF NOT EXISTS ux_sessions_token ON sessions(token_hash)',
  'CREATE INDEX IF NOT EXISTS ix_audit_created ON audit_log(created_at)'
];

async function tableExists(db, name) {
  return !!(await db.get("SELECT 1 x FROM sqlite_master WHERE type='table' AND name=?", [name]));
}

async function ensureTable(db, name, cols) {
  if (cols === null) {
    await db.exec('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)');
    return;
  }
  const defs = Object.entries(cols).map(([c, d]) => `${c} ${d}`).join(', ');
  await db.exec(`CREATE TABLE IF NOT EXISTS ${name} (id INTEGER PRIMARY KEY AUTOINCREMENT, ${defs})`);
  const have = (await db.all(`PRAGMA table_info(${name})`)).map(r => r.name);
  for (const [c, d] of Object.entries(cols)) {
    if (!have.includes(c)) await db.exec(`ALTER TABLE ${name} ADD COLUMN ${c} ${d.replace(/\bUNIQUE\b/g, '').trim()}`);
  }
}

async function migrate(db, cfg) {
  const ver = (await db.get('PRAGMA user_version')).user_version;
  const legacy = ver < SCHEMA_VERSION && (await tableExists(db, 'machines') || await tableExists(db, 'users'));

  if (legacy) {
    const target = path.join(cfg.backupDir, `pre-v${SCHEMA_VERSION}-upgrade-${new Date().toISOString().slice(0, 10)}.db`);
    if (!fs.existsSync(target)) {
      await db.run('VACUUM INTO ?', [target]);
      console.log('[migracija] sigurnosna kopija stare baze: ' + path.relative(cfg.root, target));
    }
  }

  // naloge koji vec imaju majstora smatraju se prihvacenim (da stari nalozi ne salju obavestenja)
  const woColsBefore = (await tableExists(db, 'workorders')) ? (await db.all('PRAGMA table_info(workorders)')).map(r => r.name) : null;
  const needAcceptBackfill = !!woColsBefore && !woColsBefore.includes('accepted_at');

  for (const [name, cols] of Object.entries(TABLES)) await ensureTable(db, name, cols);
  if (needAcceptBackfill) await db.exec('UPDATE workorders SET accepted_at=COALESCE(started_at,created_at) WHERE worker_id IS NOT NULL AND accepted_at IS NULL');
  for (const sql of INDEXES) await db.exec(sql);

  // --- ispravke podataka iz starijih verzija ---
  const now = new Date().toISOString();
  await db.exec(`
    UPDATE workorders SET status='U_TOKU'   WHERE status='U TOKU';
    UPDATE workorders SET status='CEKA_DEO' WHERE status='CEKA DEO';
    UPDATE workorders SET status='ZAVRSEN'  WHERE status LIKE 'ZAVR%';
    UPDATE workorders SET status='OTVOREN'  WHERE status IS NULL OR status='';
    UPDATE workorders SET priority='SREDNJI' WHERE priority IS NULL OR priority='';
    UPDATE workorders SET type='KVAR' WHERE type IS NULL OR type='';
    UPDATE workorders SET type='INSPEKCIJA' WHERE type='OSTALO';
    UPDATE workorders SET priority='VISOK' WHERE priority='HITAN';
    UPDATE workorders SET downtime_min=CAST(ROUND((julianday(closed_at)-julianday(created_at))*1440) AS INTEGER)
      WHERE status='ZAVRSEN' AND type='KVAR' AND closed_at IS NOT NULL AND (downtime_min IS NULL OR downtime_min=0);
    UPDATE workorders SET downtime_min=0 WHERE downtime_min IS NULL;
    UPDATE machines SET archived=0 WHERE archived IS NULL;
    UPDATE inventory SET archived=0 WHERE archived IS NULL;
    UPDATE users SET active=1 WHERE active IS NULL;
    UPDATE users SET role='ADMIN' WHERE role IS NULL OR role='';
    UPDATE preventive SET status='AKTIVNA' WHERE status IS NULL OR status='';
    UPDATE preventive SET machine_id=(SELECT id FROM machines WHERE machines.code=preventive.machine_code)
      WHERE machine_id IS NULL AND machine_code IS NOT NULL;
  `);
  const invCols = (await db.all('PRAGMA table_info(inventory)')).map(r => r.name);
  if (invCols.includes('price')) await db.exec('UPDATE inventory SET unit_price=price WHERE (unit_price IS NULL OR unit_price=0) AND price IS NOT NULL');
  await db.run("UPDATE users SET created_at=? WHERE created_at IS NULL", [now]);
  await db.run("UPDATE machines SET created_at=? WHERE created_at IS NULL", [now]);

  // --- prvi administrator ---
  const admin = await db.get("SELECT id, password FROM users WHERE username='admin'");
  if (!admin) {
    await db.run('INSERT INTO users(username,password,fullname,role,active,must_change_password,created_at) VALUES (?,?,?,?,1,1,?)',
      ['admin', await hashPassword('admin123'), 'Administrator', 'ADMIN', now]);
    console.log('[migracija] napravljen korisnik admin / admin123 (promena lozinke se trazi pri prvoj prijavi)');
  } else if (admin.password === 'admin123') {
    await db.run('UPDATE users SET must_change_password=1 WHERE id=?', [admin.id]);
  }

  await db.exec(`PRAGMA user_version=${SCHEMA_VERSION}`);
}

module.exports = { migrate };
