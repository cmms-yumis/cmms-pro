'use strict';
// Tanak sloj nad SQLite bazom. Koristi paket "sqlite3" ako postoji, a ako ne moze da se ucita
// (npr. nema prebuild binarni fajl) automatski prelazi na ugradjeni "node:sqlite" (Node 22.5+).
// Svi upiti idu kroz jedan red cekanja, a transakcije su izolovane, pa se zahtevi ne mesaju.

const norm = p => (p || []).map(v => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v));

async function openSqlite3(file) {
  const sqlite3 = require('sqlite3');
  const raw = await new Promise((res, rej) => { const d = new sqlite3.Database(file, e => (e ? rej(e) : res(d))); });
  return {
    name: 'sqlite3',
    run: (sql, p) => new Promise((res, rej) => raw.run(sql, norm(p), function (e) { e ? rej(e) : res({ changes: this.changes, lastID: this.lastID }); })),
    get: (sql, p) => new Promise((res, rej) => raw.get(sql, norm(p), (e, r) => (e ? rej(e) : res(r)))),
    all: (sql, p) => new Promise((res, rej) => raw.all(sql, norm(p), (e, r) => (e ? rej(e) : res(r)))),
    exec: sql => new Promise((res, rej) => raw.exec(sql, e => (e ? rej(e) : res()))),
    close: () => new Promise(res => raw.close(() => res()))
  };
}

async function openNode(file) {
  const { DatabaseSync } = require('node:sqlite');
  const raw = new DatabaseSync(file);
  return {
    name: 'node:sqlite',
    run: async (sql, p) => { const r = raw.prepare(sql).run(...norm(p)); return { changes: Number(r.changes), lastID: Number(r.lastInsertRowid) }; },
    get: async (sql, p) => { const r = raw.prepare(sql).get(...norm(p)); return r ? { ...r } : undefined; },
    all: async (sql, p) => raw.prepare(sql).all(...norm(p)).map(r => ({ ...r })),
    exec: async sql => raw.exec(sql),
    close: async () => raw.close()
  };
}

async function open(file) {
  const want = process.env.CMMS_DRIVER;
  let raw;
  if (want !== 'node') {
    try { raw = await openSqlite3(file); }
    catch (e) {
      if (want === 'sqlite3') throw e;
      console.warn('[db] paket "sqlite3" nije dostupan (' + String(e.message).split('\n')[0] + ') - koristim ugradjeni node:sqlite');
    }
  }
  if (!raw) raw = await openNode(file);

  await raw.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;');

  let chain = Promise.resolve();
  const locked = fn => { const p = chain.then(fn); chain = p.catch(() => {}); return p; };

  return {
    driver: raw.name,
    get: (s, p) => locked(() => raw.get(s, p)),
    all: (s, p) => locked(() => raw.all(s, p)),
    run: (s, p) => locked(() => raw.run(s, p)),
    exec: s => locked(() => raw.exec(s)),
    // Unutar tx koristiti iskljucivo prosledjeni "t" (ne db.*), inace nastaje zastoj.
    tx: fn => locked(async () => {
      await raw.exec('BEGIN IMMEDIATE');
      try { const r = await fn(raw); await raw.exec('COMMIT'); return r; }
      catch (e) { try { await raw.exec('ROLLBACK'); } catch (_) {} throw e; }
    }),
    close: () => locked(() => raw.close())
  };
}

module.exports = { open };
