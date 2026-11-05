'use strict';
// Vracanje baze iz backup-a. SERVER MORA BITI ZAUSTAVLJEN.
//   node restore-db.js                -> prikaze spisak i pita koji backup
//   node restore-db.js cmms-xxx.db    -> vraca navedeni backup iz foldera backup
//   node restore-db.js "E:\\CMMS-backup\\cmms-xxx.db"   -> vraca backup sa USB diska / mreze (puna putanja)
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const http = require('http');
const cfg = require('./src/config');

const files = fs.readdirSync(cfg.backupDir).filter(f => f.endsWith('.db'))
  .map(f => ({ f, t: fs.statSync(path.join(cfg.backupDir, f)).mtimeMs })).sort((a, b) => b.t - a.t).map(x => x.f);

function serverRunning() {
  return new Promise(res => {
    const r = http.get({ host: '127.0.0.1', port: cfg.port, path: '/api/status', timeout: 1500 }, () => { r.destroy(); res(true); });
    r.on('error', () => res(false)); r.on('timeout', () => { r.destroy(); res(false); });
  });
}
const ask = q => new Promise(res => { const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); rl.question(q, a => { rl.close(); res(a.trim()); }); });

(async () => {
  if (await serverRunning()) { console.error('\nServer je pokrenut. Zatvorite prozor servera (Ctrl+C), pa ponovo pokrenite vracanje.\n'); process.exit(1); }
  if (!files.length) { console.error('U folderu backup nema nijednog backup-a.'); process.exit(1); }
  let pick = process.argv[2];
  if (!pick) {
    console.log('\nDostupni backup-i (najnoviji prvi):\n');
    files.slice(0, 25).forEach((f, i) => console.log(`  ${String(i + 1).padStart(2)}. ${f}`));
    const a = await ask('\nUnesite broj backup-a koji vracate (prazno = odustani): ');
    if (!a) { console.log('Odustali ste.'); return; }
    pick = files[Number(a) - 1];
  }
  const external = pick && path.isAbsolute(pick) && fs.existsSync(pick);
  if (!external && (!pick || !files.includes(path.basename(pick)))) { console.error('Taj backup ne postoji.'); process.exit(1); }
  const src = external ? pick : path.join(cfg.backupDir, path.basename(pick));
  if ((await ask(`\nVraca se ${pick}. Trenutna baza se prvo sacuva kao "before-restore". Nastaviti? (d/n): `)).toLowerCase() !== 'd') { console.log('Odustali ste.'); return; }
  if (fs.existsSync(cfg.dbPath)) fs.copyFileSync(cfg.dbPath, path.join(cfg.backupDir, `before-restore-${Date.now()}.db`));
  for (const ext of ['-wal', '-shm']) { try { fs.unlinkSync(cfg.dbPath + ext); } catch (_) {} }
  fs.copyFileSync(src, cfg.dbPath);
  console.log('\nGotovo. Baza je vracena. Pokrenite server (POKRENI.bat).\n');
})();
