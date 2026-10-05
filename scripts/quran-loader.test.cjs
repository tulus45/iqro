const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('compact progress preserves community data and skips hidden panels', async () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'community.js'), 'utf8');
  const push = source.slice(source.indexOf('async function pushProgressToServer'), source.indexOf('async function reconcileProgressAfterAuth'));
  const render = source.slice(source.indexOf('function renderCommunityPage()'), source.indexOf('function injectCommunityUi()'));
  const friends = [{ id: 'friend' }];
  const groups = [{ id: 'group' }];
  const state = { token: 'session', me: { id: 'reader' }, friends, groups };
  let visible = '';
  let directories = 0;
  let settings = 0;
  const context = vm.createContext({
    communityState: state,
    apiFetch: async (_url, options) => {
      assert.equal(options.body.responseMode, 'progress');
      return { partial: 'progress', user: { id: 'reader', progress: { ayat: 3 } } };
    },
    cacheCurrentAppState() {}, renderHomeCommunityBoard() {}, renderCommunityFlash() {}, renderHeroStatus() {},
    renderCommunityDirectory() { directories++; },
    renderSettingsPage() { settings++; },
    document: { getElementById: (id) => ({ classList: { contains: () => id === visible } }) },
    applyAppState() { assert.fail('Compact responses must not replace community state'); }
  });
  vm.runInContext(`${push}\n${render}`, context);
  await context.pushProgressToServer({ surah: 1, ayat: 3 }, { quiet: true });
  assert.equal(state.me.progress.ayat, 3);
  assert.equal(state.friends, friends);
  assert.equal(state.groups, groups);
  context.renderCommunityPage();
  assert.equal(directories, 0);
  assert.equal(settings, 0);
  visible = 'communityPage';
  context.renderCommunityPage();
  assert.equal(directories, 1);
  assert.equal(settings, 0);
  visible = 'settingsPage';
  context.renderCommunityPage();
  assert.equal(settings, 1);
});

test('surah loader preserves all source text, deduplicates fetches and retries failures', async () => {
  const root = path.resolve(__dirname, '..');
  const source = fs.readFileSync(path.join(root, 'community.js'), 'utf8');
  const loader = source.slice(source.indexOf('const quranSurahRequests ='), source.indexOf('function escapeTajweedText'));
  const originals = Object.fromEntries(['uthmani-tajweed-v4', 'kfgqpc-hafs-v2.0'].map((name) => [
    name, JSON.parse(fs.readFileSync(path.join(root, 'assets/quran', `${name}.json`), 'utf8'))
  ]));
  let calls = 0;
  let fail = true;
  const context = vm.createContext({
    getAyatCountForSurah: (number) => originals['uthmani-tajweed-v4'].surahs[number - 1].length,
    fetch: async (url) => {
      calls++;
      if (fail) { fail = false; return { ok: false }; }
      return { ok: true, json: async () => JSON.parse(fs.readFileSync(path.join(root, url.split('?')[0]), 'utf8')) };
    }
  });
  vm.runInContext(loader, context);
  await assert.rejects(context.loadQuranSurahAsset('uthmani-tajweed-v4', 1), /unavailable/);
  const before = calls;
  const results = await Promise.all(Array.from({ length: 5 }, () => context.loadQuranSurahAsset('uthmani-tajweed-v4', 1)));
  assert.equal(calls - before, 1);
  assert.ok(results.every((value) => value === results[0]));
  for (const [name, original] of Object.entries(originals)) {
    for (let number = 1; number <= 114; number++) {
      assert.deepEqual(await context.loadQuranSurahAsset(name, number), original.surahs[number - 1]);
    }
  }
  await assert.rejects(context.loadQuranSurahAsset('uthmani-tajweed-v4', 0), /invalid/);
});
