const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

// One application process owns this store. All requests share this queue.
function createJsonStore(file, { empty, normalize }) {
  let queue = Promise.resolve();
  let cached;
  let source;
  let signature;

  async function atomicWrite(target, contents) {
    const temporary = `${target}.${crypto.randomUUID()}.tmp`;
    let handle;
    try {
      handle = await fs.open(temporary, 'wx', 0o600);
      await handle.writeFile(contents, 'utf8');
      await handle.sync();
      await handle.close();
      handle = null;
      await fs.rename(temporary, target);
    } finally {
      await handle?.close();
      await fs.rm(temporary, { force: true });
    }
  }

  async function read() {
    await fs.mkdir(path.dirname(file), { recursive: true });
    let stat;
    try {
      stat = await fs.stat(file);
    } catch (error) {
      // Never recreate a store that disappeared while this process was running,
      // or a missing primary for which a backup already exists.
      if (error.code !== 'ENOENT' || cached) throw error;
      try {
        await fs.access(`${file}.bak`);
      } catch (backupError) {
        if (backupError.code !== 'ENOENT') throw backupError;
        await fs.writeFile(file, JSON.stringify(empty()), { flag: 'wx', mode: 0o600 });
        stat = await fs.stat(file);
      }
      if (!stat) throw new Error('Database missing; restore the verified backup before starting.');
    }
    const nextSignature = `${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}:${stat.ino}`;
    if (!cached || signature !== nextSignature) {
      const contents = await fs.readFile(file, 'utf8');
      const parsed = JSON.parse(contents);
      if (!parsed || !Array.isArray(parsed.users) || !Array.isArray(parsed.sessions)) {
        throw new Error('Invalid database structure; refusing to overwrite it.');
      }
      cached = normalize(parsed);
      source = contents;
      signature = nextSignature;
    }
    return structuredClone(cached);
  }

  function transaction(work) {
    const pending = queue.then(async () => {
      const db = await read();
      let dirty = false;
      const result = await work(db, () => { dirty = true; });
      if (dirty) {
        const normalized = normalize(db);
        const contents = JSON.stringify(normalized);
        await atomicWrite(`${file}.bak`, source);
        await atomicWrite(file, contents);
        cached = normalized;
        source = contents;
        const stat = await fs.stat(file);
        signature = `${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}:${stat.ino}`;
      }
      return result;
    });
    queue = pending.catch(() => {});
    return pending;
  }

  return { transaction };
}

module.exports = { createJsonStore };
