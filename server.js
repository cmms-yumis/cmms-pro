'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const express = require('express');

const cfg = require('./src/config');
const dbLayer = require('./src/db');
const { migrate } = require('./src/schema');
const A = require('./src/auth');
const S = require('./src/services');
const buildApi = require('./src/api');

async function main() {
  const db = await dbLayer.open(cfg.dbPath);
  await migrate(db, cfg);

  // ---------- backup (lokalno + dodatna kopija na USB / mrezu) ----------
  const backup = require('./src/backup')(db, cfg, S);

  async function runPreventive() {
    try {
      const n = await S.generatePreventiveOrders(db, 2);
      if (n) console.log(`[preventiva] otvoreno naloga: ${n}`);
    } catch (e) { console.error('[preventiva] greska:', e.message); }
  }

  // ---------- express ----------
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', cfg.trustProxy ? 1 : false);

  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'same-origin',
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'"
    });
    next();
  });

  app.use(express.json({ limit: '1mb' }));
  app.use('/api', (req, res, next) => {
    // dodatna zastita od zahteva sa tudjih sajtova
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin) {
      let same = false;
      try { same = new URL(req.headers.origin).host === req.headers.host; } catch (_) {}
      if (!same) return res.status(403).json({ error: 'Zahtev odbijen (nepoznato poreklo)' });
    }
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use(A.sessionMiddleware(db, cfg));

  app.get('/api/status', (req, res) => res.json({ status: 'OK', version: cfg.version }));
  app.use('/api', buildApi(db, cfg, { backup, runPreventive }));

  // slike masina - samo za prijavljene
  app.get('/uploads/:name', (req, res) => {
    if (!req.user) return res.status(401).end();
    if (!/^[\w.-]+$/.test(req.params.name)) return res.status(400).end();
    const p = path.join(cfg.uploadDir, req.params.name);
    fs.existsSync(p) ? res.sendFile(p, { maxAge: '1d' }) : res.status(404).end();
  });

  app.use(express.static(path.join(__dirname, 'public'), {
    index: 'index.html',
    setHeaders: (res, p) => { if (/sw\.js$|index\.html$/.test(p)) res.set('Cache-Control', 'no-cache'); }
  }));
  app.use('/api', (req, res) => res.status(404).json({ error: 'Nepoznata adresa' }));

  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    if (err instanceof S.ApiError) return res.status(err.status).json({ error: err.message });
    if (err && err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'Slika je prevelika (najviše 5 MB)' });
    if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Neispravan zahtev' });
    if (err && /UNIQUE constraint/.test(err.message || '')) return res.status(409).json({ error: 'Vrednost već postoji' });
    console.error('[greska]', req.method, req.originalUrl, err && err.stack || err);
    res.status(500).json({ error: 'Greška na serveru' });
  });

  // ---------- pokretanje ----------
  const servers = [];
  const httpServer = http.createServer(app);
  await new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(cfg.port, cfg.host, resolve);
  });
  servers.push(httpServer);

  const keyFile = path.join(cfg.root, 'certs', 'server.key'), crtFile = path.join(cfg.root, 'certs', 'server.crt');
  if (fs.existsSync(keyFile) && fs.existsSync(crtFile)) {
    const https = require('https');
    const s = https.createServer({ key: fs.readFileSync(keyFile), cert: fs.readFileSync(crtFile) }, app);
    s.listen(cfg.httpsPort, cfg.host);
    servers.push(s);
  }

  console.log(`\n  CMMS PRO ${cfg.version}  |  baza: ${cfg.dbPath.startsWith(cfg.root) ? path.relative(cfg.root, cfg.dbPath) : cfg.dbPath} (${db.driver})\n`);
  console.log('  Otvorite u pregledaču ili na telefonu (isti WiFi / LAN):');
  console.log(`    http://localhost:${cfg.port}`);
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const n of list || []) if (n.family === 'IPv4' && !n.internal) console.log(`    http://${n.address}:${cfg.port}   (${name})`);
  }
  if (servers.length > 1) console.log(`    https://<adresa>:${cfg.httpsPort}   (HTTPS je uključen)`);
  console.log('\n  Zaustavljanje: Ctrl+C\n');

  // ---------- pozadinski poslovi ----------
  runPreventive(); backup.auto();
  const timers = [
    setInterval(runPreventive, 60 * 60 * 1000),
    setInterval(() => { backup.auto().then(() => backup.syncExternal()).catch(() => {}); }, 10 * 60 * 1000),
    setInterval(() => db.run('DELETE FROM sessions WHERE expires_at<?', [S.nowIso()]).catch(() => {}), 60 * 60 * 1000)
  ];
  timers.forEach(t => t.unref());

  let closing = false;
  const shutdown = async () => {
    if (closing) return; closing = true;
    console.log('\nZaustavljam server...');
    servers.forEach(s => s.close());
    try { await db.close(); } catch (_) {}
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(e => {
  if (e && e.code === 'EADDRINUSE') console.error(`\nPort ${cfg.port} je već zauzet. Verovatno je CMMS server već pokrenut (zatvorite stari prozor) ili promenite "port" u config.json.\n`);
  else console.error('Server nije mogao da se pokrene:', e);
  process.exit(1);
});
