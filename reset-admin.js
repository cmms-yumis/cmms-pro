'use strict';
// Reset lozinke administratora: node reset-admin.js NovaLozinka123   (server treba da bude zaustavljen)
const cfg = require('./src/config');
const { open } = require('./src/db');
const { migrate } = require('./src/schema');
const { hashPassword } = require('./src/auth');
const pw = process.argv[2];
if (!pw || pw.length < 8) { console.error('Upotreba: node reset-admin.js NovaLozinka (najmanje 8 znakova)'); process.exit(1); }
(async () => {
  const db = await open(cfg.dbPath);
  await migrate(db, cfg);
  const r = await db.run("UPDATE users SET password=?, active=1, must_change_password=1 WHERE username='admin'", [await hashPassword(pw)]);
  await db.run("DELETE FROM sessions");
  await db.close();
  console.log(r.changes ? 'Lozinka korisnika admin je promenjena. Pri prijavi ce traziti novu.' : 'Korisnik "admin" ne postoji.');
})().catch(e => { console.error(e.message); process.exit(1); });
