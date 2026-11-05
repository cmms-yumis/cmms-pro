'use strict';
const crypto = require('crypto');
const { promisify } = require('util');
const scrypt = promisify(crypto.scrypt);

const COOKIE = 'cmms_sid';
const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
const safeEq = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

// ---------- lozinke ----------
async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw, salt, 64);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

async function verifyPassword(pw, stored) {
  if (!stored || typeof pw !== 'string') return false;
  if (stored.startsWith('scrypt$')) {
    const [, s, k] = stored.split('$');
    const key = await scrypt(pw, Buffer.from(s, 'hex'), 64);
    const kb = Buffer.from(k, 'hex');
    return kb.length === key.length && crypto.timingSafeEqual(kb, key);
  }
  if (stored.startsWith('$2')) { // stari bcrypt hash, ako je neko takav upisao
    try { return require('bcrypt').compareSync(pw, stored); } catch (_) { return false; }
  }
  return safeEq(pw, stored); // stare V2 lozinke u cistom tekstu; posle prijave se upisuju kao hash
}

const needsRehash = stored => !String(stored || '').startsWith('scrypt$');

// ---------- uloge i dozvole ----------
const PERMS = {
  ADMIN: ['*'],
  MENADZER: ['machines.write', 'inventory.write', 'preventive.write', 'workers.write', 'wo.report', 'wo.write', 'wo.delete',
    'inventory.use', 'downtime.write', 'reports.view', 'export'],
  MAJSTOR: ['wo.report', 'wo.write', 'inventory.use', 'inventory.write', 'downtime.write', 'reports.view', 'export'],
  OPERATER: ['wo.report']
};
const ROLES = Object.keys(PERMS);
// da li korisnik dobija obavestenja o novim nalozima (podrazumevano samo majstori)
const wantsAlerts = u => can(u.role, 'wo.write') && (u.notify == null ? u.role === 'MAJSTOR' : !!u.notify);
const can = (role, perm) => { const p = PERMS[role] || []; return p.includes('*') || p.includes(perm); };

// ---------- sesije ----------
function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

function setCookie(req, res, token, days) {
  const age = token ? Math.round(days * 86400) : 0;
  res.append('Set-Cookie', `${COOKIE}=${token || ''}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${age}${req.secure ? '; Secure' : ''}`);
}

async function createSession(db, req, res, userId, days) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = new Date();
  await db.run('INSERT INTO sessions(token_hash,user_id,created_at,expires_at,ip,ua) VALUES (?,?,?,?,?,?)',
    [sha256(token), userId, now.toISOString(), new Date(now.getTime() + days * 864e5).toISOString(),
      req.ip, String(req.headers['user-agent'] || '').slice(0, 200)]);
  setCookie(req, res, token, days);
}

function sessionMiddleware(db, cfg) {
  return async (req, res, next) => {
    req.user = null;
    const token = readCookie(req, COOKIE);
    if (token) {
      try {
        const row = await db.get(
          `SELECT s.token_hash, s.expires_at, s.created_at, u.id, u.username, u.fullname, u.role, u.must_change_password, u.worker_id, u.notify
             FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND u.active=1`, [sha256(token)]);
        if (row && row.expires_at > new Date().toISOString()) {
          req.user = { id: row.id, username: row.username, fullname: row.fullname, role: row.role, must_change_password: !!row.must_change_password, worker_id: row.worker_id || null, notify: row.notify };
          req.sessionHash = row.token_hash;
          // klizni rok: ako je proslo vise od dan od otvaranja, produzi sesiju (telefon ostaje prijavljen)
          if (Date.now() - Date.parse(row.created_at) > 864e5) {
            const now = new Date();
            await db.run('UPDATE sessions SET created_at=?, expires_at=? WHERE token_hash=?',
              [now.toISOString(), new Date(now.getTime() + cfg.sessionDays * 864e5).toISOString(), row.token_hash]);
            setCookie(req, res, token, cfg.sessionDays);
          }
        }
      } catch (e) { console.error('[sesija]', e.message); }
    }
    next();
  };
}

const requireLogin = (req, res, next) => (req.user ? next() : res.status(401).json({ error: 'Niste prijavljeni' }));
const need = perm => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Niste prijavljeni' });
  if (!can(req.user.role, perm)) return res.status(403).json({ error: 'Nemate dozvolu za ovu radnju' });
  next();
};

// ---------- zastita od pogadjanja lozinke ----------
const attempts = new Map();
const WINDOW = 15 * 60 * 1000, MAX = 8;
function tooManyAttempts(key) {
  const a = attempts.get(key);
  if (!a) return false;
  if (Date.now() - a.first > WINDOW) { attempts.delete(key); return false; }
  return a.count >= MAX;
}
function failAttempt(key) {
  const a = attempts.get(key);
  if (!a || Date.now() - a.first > WINDOW) attempts.set(key, { count: 1, first: Date.now() });
  else a.count++;
}
const clearAttempts = key => attempts.delete(key);

module.exports = {
  hashPassword, verifyPassword, needsRehash, ROLES, can, PERMS, wantsAlerts,
  createSession, sessionMiddleware, requireLogin, need, setCookie, readCookie, COOKIE, sha256,
  tooManyAttempts, failAttempt, clearAttempts
};
