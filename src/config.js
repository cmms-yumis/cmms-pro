'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const defaults = {
  port: 3000,
  host: '0.0.0.0',          // 0.0.0.0 = dostupno na svim mreznim karticama (sve podmreze)
  httpsPort: 3443,          // koristi se samo ako postoje certs/server.key i certs/server.crt
  trustProxy: false,        // true ako ide iza Cloudflare Tunnel / nginx / Caddy
  dbFile: 'database/cmms.db',
  backupHour: 2,            // automatski dnevni backup posle ovog sata
  keepBackups: 30,          // koliko automatskih backup-a se cuva
  sessionDays: 14
};

const file = path.join(ROOT, 'config.json');
let user = {};
if (fs.existsSync(file)) {
  try { user = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
  catch (e) { console.error('config.json nije ispravan JSON: ' + e.message); process.exit(1); }
} else {
  fs.writeFileSync(file, JSON.stringify(defaults, null, 2));
}

const cfg = { ...defaults, ...user };
if (process.env.PORT) cfg.port = Number(process.env.PORT);
if (process.env.CMMS_DB) cfg.dbFile = process.env.CMMS_DB;

cfg.root = ROOT;
cfg.dbPath = path.resolve(ROOT, cfg.dbFile);
cfg.backupDir = process.env.CMMS_BACKUP_DIR || path.join(ROOT, 'backup');
cfg.uploadDir = path.join(ROOT, 'uploads');
cfg.version = '4.0.0';
for (const d of [path.dirname(cfg.dbPath), cfg.backupDir, cfg.uploadDir]) fs.mkdirSync(d, { recursive: true });

module.exports = cfg;
