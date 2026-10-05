const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createJsonStore } = require('./json-store');

test('transactions serialize, roll back, retain backups and reject damaged stores', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'iqro-store-'));
  const file = path.join(directory, 'db.json');
  const store = createJsonStore(file, { empty: () => ({ users: [], sessions: [] }), normalize: (db) => db });
  try {
    await Promise.all(Array.from({ length: 20 }, (_, id) => store.transaction(async (db, dirty) => {
      await new Promise((resolve) => setTimeout(resolve, 2));
      db.users.push({ id });
      dirty();
    })));
    assert.equal(JSON.parse(await fs.readFile(file)).users.length, 20);
    assert.equal(JSON.parse(await fs.readFile(`${file}.bak`)).users.length, 19);
    await assert.rejects(store.transaction((db, dirty) => {
      db.users = [];
      dirty();
      throw new Error('rollback');
    }), /rollback/);
    assert.equal(await store.transaction((db) => db.users.length), 20);
    const backup = await fs.readFile(`${file}.bak`, 'utf8');
    await fs.writeFile(file, '{damaged');
    await assert.rejects(store.transaction((db, dirty) => dirty()));
    assert.equal(await fs.readFile(file, 'utf8'), '{damaged');
    assert.equal(await fs.readFile(`${file}.bak`, 'utf8'), backup);
    await fs.rm(file);
    const restarted = createJsonStore(file, { empty: () => ({ users: [], sessions: [] }), normalize: (db) => db });
    await assert.rejects(restarted.transaction(() => {}), /Database missing/);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('API keeps concurrent registrations, throttles session writes and supports compact progress', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'iqro-api-'));
  process.env.IQRO_DATA_FILE = path.join(directory, 'db.json');
  process.env.NODE_ENV = 'production';
  process.env.IQRO_OWNER_PHONE = '081998887777';
  process.env.IQRO_OWNER_PASSWORD = 'test-password-123';
  const { createServer } = require('./index');
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  async function request(route, body, token) {
    const response = await fetch(`${base}${route}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    return { status: response.status, data: await response.json() };
  }
  try {
    const registrations = await Promise.all(Array.from({ length: 8 }, (_, id) => request('/auth/register', {
      phone: `0812345600${id}`, name: `User ${id}`, password: 'test-password', rewardConsent: true
    })));
    assert.ok(registrations.every((response) => response.status === 201));
    const db = JSON.parse(await fs.readFile(process.env.IQRO_DATA_FILE));
    assert.equal(db.users.length, 9);
    const login = await request('/auth/login', { phone: '081998887777', password: 'test-password-123' });
    assert.equal(login.status, 200);
    const token = login.data.token;
    const before = await fs.stat(process.env.IQRO_DATA_FILE);
    await Promise.all(Array.from({ length: 5 }, () => request('/me', null, token)));
    assert.equal((await fs.stat(process.env.IQRO_DATA_FILE)).mtimeMs, before.mtimeMs);
    const progress = await request('/progress', { surah: 1, ayat: 3, nama: 'Al-Fatihah', totalAyat: 7, trackDaily: true, responseMode: 'progress' }, token);
    assert.equal(progress.status, 200);
    assert.equal(progress.data.partial, 'progress');
    assert.equal(progress.data.user.progress.ayat, 3);
    assert.equal(progress.data.friends, undefined);
    const legacy = await request('/progress', { surah: 1, ayat: 4, totalAyat: 7 }, token);
    assert.ok(Array.isArray(legacy.data.friends));
    const failedLogin = await request('/auth/login', { phone: '081998887777', password: 'wrong-password' });
    assert.equal(failedLogin.status, 401);
    // An upstream request must not hold the transaction queue or overwrite a
    // progress change committed while that upstream request is in flight.
    const originalFetch = global.fetch;
    let upstreamStarted;
    let releaseUpstream;
    const started = new Promise((resolve) => { upstreamStarted = resolve; });
    const gate = new Promise((resolve) => { releaseUpstream = resolve; });
    global.fetch = async (url, options) => {
      if (String(url).startsWith('https://api.aladhan.com/')) {
        upstreamStarted();
        await gate;
        return { ok: false, status: 503 };
      }
      return originalFetch(url, options);
    };
    try {
      const prayer = request('/prayer-times?city=jakarta', null, token);
      await started;
      const next = await request('/progress', { surah: 1, ayat: 5, totalAyat: 7 }, token);
      assert.equal(next.status, 200);
      releaseUpstream();
      assert.equal((await prayer).status, 502);
      assert.equal((await request('/me', null, token)).data.user.progress.ayat, 5);
    } finally {
      releaseUpstream();
      global.fetch = originalFetch;
    }
    const invalid = await fetch(`${base}/progress`, { method: 'POST', body: '{broken' });
    assert.equal(invalid.status, 400);
    assert.equal((await request('/health')).status, 200);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  }
});
