'use strict';
// Rucni backup baze (moze i dok server radi): node backup-db.js
const path = require('path');
const cfg = require('./src/config');
const { open } = require('./src/db');

(async () => {
  const db = await open(cfg.dbPath);
  const d = new Date(), z = n => String(n).padStart(2, '0');
  const name = `cmms-rucni-${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}_${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}.db`;
  await db.run('VACUUM INTO ?', [path.join(cfg.backupDir, name)]);
  await db.close();
  console.log('Backup napravljen: backup\\' + name);
})().catch(e => { console.error('Backup nije uspeo:', e.message); process.exit(1); });
