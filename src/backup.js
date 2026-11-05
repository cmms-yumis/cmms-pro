'use strict';
// Backup baze: lokalna kopija (folder backup) + dodatna kopija na drugo mesto (USB disk ili mrezna fascikla).
// Dodatna kopija se pokusava posle svakog backup-a i ponovo na svakih 10 minuta dok ne uspe,
// pa nista ne propada ako USB disk nije bio prikljucen u 02:00.
const fs = require('fs');
const path = require('path');

const FRIENDLY = {
  ENOENT: 'putanja ne postoji ili disk nije priključen',
  EACCES: 'nema dozvolu za upis u tu fasciklu',
  EPERM: 'nema dozvolu za upis u tu fasciklu',
  ENOSPC: 'nema slobodnog mesta na disku',
  EBUSY: 'disk je zauzet',
  ENOTDIR: 'putanja nije fascikla',
  EEXIST: 'na toj putanji već postoji fajl koji nije fascikla',
  EROFS: 'disk je samo za čitanje',
  EINVAL: 'putanja nije ispravna',
  ENETUNREACH: 'mrežna lokacija nije dostupna',
  ETIMEDOUT: 'mrežna lokacija ne odgovara'
};
const why = e => (e && FRIENDLY[e.code] ? `${FRIENDLY[e.code]} (${e.code})` : String((e && e.message) || e));

module.exports = function createBackupService(db, cfg, S) {
  const stamp = () => {
    const d = new Date(), z = n => String(n).padStart(2, '0');
    return `${S.localDate(d)}_${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`;
  };
  const getSetting = async k => { const r = await db.get('SELECT value FROM settings WHERE key=?', [k]); return r && r.value != null ? r.value : ''; };
  const putSetting = (k, v) => db.run('INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [k, v]);

  function list() {
    return fs.readdirSync(cfg.backupDir).filter(f => /\.db$/.test(f)).map(f => {
      const st = fs.statSync(path.join(cfg.backupDir, f));
      return { name: f, size: st.size, created_at: st.mtime.toISOString() };
    }).sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  // proba upisa u odredisnu fasciklu (pravi i brise mali fajl)
  function testDir(dir) {
    if (!path.isAbsolute(dir)) { const e = new Error('Upišite punu putanju, npr. E:\\CMMS-backup ili \\\\SERVER\\backup\\cmms'); e.friendly = true; throw e; }
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, `.cmms-test-${Date.now()}`);
    fs.writeFileSync(f, 'ok');
    fs.unlinkSync(f);
  }

  async function status() {
    let last = null;
    try { const raw = await getSetting('backup_copy_last'); last = raw ? JSON.parse(raw) : null; } catch (_) {}
    return { dir: await getSetting('backup_copy_dir'), last };
  }

  // kopira 5 najnovijih backup-a koji jos nisu u odredisnoj fascikli
  async function syncExternal() {
    const dir = await getSetting('backup_copy_dir');
    if (!dir) return { ok: true, skipped: true };
    const prev = (await status()).last;
    let result;
    try {
      testDir(dir);
      const have = new Set(fs.readdirSync(dir));
      const copied = [];
      for (const b of list().filter(x => /^cmms-/.test(x.name)).slice(0, 5)) {
        if (!have.has(b.name)) {
          fs.copyFileSync(path.join(cfg.backupDir, b.name), path.join(dir, b.name));
          copied.push(b.name);
        }
      }
      const ext = fs.readdirSync(dir).filter(f => /^cmms-.*\.db$/.test(f))
        .map(f => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t);
      for (const old of ext.slice(cfg.keepBackups)) fs.unlinkSync(path.join(dir, old.f));
      result = { ok: true, at: new Date().toISOString(), dir, copied, latest: ext[0] ? ext[0].f : null };
    } catch (e) {
      result = { ok: false, at: new Date().toISOString(), dir, error: why(e) };
    }
    // u bazu se upisuje samo kad se nesto promenilo (da se ne pise na svakih 10 minuta)
    const changed = !prev || prev.ok !== result.ok || (result.copied && result.copied.length) || (!result.ok && prev.error !== result.error);
    if (changed) await putSetting('backup_copy_last', JSON.stringify(result));
    if (!result.ok && changed) console.error('[backup] dodatna kopija nije uspela: ' + result.error);
    else if (result.copied && result.copied.length) console.log('[backup] kopirano na ' + dir + ': ' + result.copied.join(', '));
    return result;
  }

  async function create(label) {
    let name = `cmms-${label}-${stamp()}.db`;
    for (let n = 2; fs.existsSync(path.join(cfg.backupDir, name)); n++) name = `cmms-${label}-${stamp()}-${n}.db`;   // dva u istoj sekundi
    await db.run('VACUUM INTO ?', [path.join(cfg.backupDir, name)]);
    const copy = await syncExternal().catch(e => ({ ok: false, error: why(e) }));
    return { name, copy };
  }

  // jednom dnevno posle odredjenog sata
  async function auto() {
    try {
      if (new Date().getHours() < cfg.backupHour) return;
      const day = S.localDate();
      if (list().some(b => b.name.startsWith(`cmms-auto-${day}`))) return;
      const out = await create('auto');
      console.log('[backup] automatski backup: ' + out.name);
      for (const old of list().filter(b => b.name.startsWith('cmms-auto-')).slice(cfg.keepBackups)) fs.unlinkSync(path.join(cfg.backupDir, old.name));
    } catch (e) { console.error('[backup] greska:', e.message); }
  }

  // podesavanje odredisne fascikle (prazno = iskljuceno)
  async function setExternal(dir) {
    dir = String(dir || '').trim();
    if (!dir) {
      await putSetting('backup_copy_dir', '');
      await putSetting('backup_copy_last', '');
      return status();
    }
    try { testDir(dir); } catch (e) { throw new S.ApiError(400, e.friendly ? e.message : 'Fascikla nije dostupna: ' + why(e)); }
    await putSetting('backup_copy_dir', dir);
    await putSetting('backup_copy_last', '');       // novo odrediste: zapocni nov status
    await syncExternal();
    return status();
  }

  return { list, create, auto, syncExternal, setExternal, status };
};
