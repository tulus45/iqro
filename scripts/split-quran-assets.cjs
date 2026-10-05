const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..', 'assets', 'quran');
const sources = ['kfgqpc-hafs-v2.0', 'uthmani-tajweed-v4'];
const verify = process.argv.includes('--verify');
for (const source of sources) {
  const payload = JSON.parse(fs.readFileSync(path.join(root, `${source}.json`), 'utf8'));
  assert.equal(payload.surahs.length, 114);
  const directory = path.join(root, source);
  if (!verify) fs.mkdirSync(directory, { recursive: true });
  payload.surahs.forEach((ayahs, index) => {
    const file = path.join(directory, `${index + 1}.json`);
    const data = { surah: index + 1, ayahs };
    if (verify) assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), data);
    else fs.writeFileSync(file, JSON.stringify(data));
  });
}
console.log(`${verify ? 'Verified' : 'Generated'} 228 per-surah assets against the complete sources.`);
