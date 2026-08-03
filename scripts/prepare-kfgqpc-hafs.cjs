const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const expectedAyahCounts = [
  7, 286, 200, 176, 120, 165, 206, 75, 129, 109, 123, 111, 43, 52, 99,
  128, 111, 110, 98, 135, 112, 78, 118, 64, 77, 227, 93, 88, 69, 60, 34,
  30, 73, 54, 45, 83, 182, 88, 75, 85, 54, 53, 89, 59, 37, 35, 38, 29,
  18, 45, 60, 49, 62, 55, 78, 96, 29, 22, 24, 13, 14, 11, 11, 18, 12,
  12, 30, 52, 52, 44, 28, 28, 20, 56, 40, 31, 50, 40, 46, 42, 29, 19,
  36, 25, 22, 17, 19, 26, 30, 20, 15, 21, 11, 8, 8, 19, 5, 8, 8, 11,
  11, 8, 3, 9, 5, 4, 7, 3, 6, 3, 5, 4, 5, 6
];

const sourcePath = path.resolve(process.argv[2] || '');
const outputPath = path.resolve(
  process.argv[3] || path.join(__dirname, '..', 'assets', 'quran', 'kfgqpc-hafs-v2.0.json')
);

if (!process.argv[2] || !fs.existsSync(sourcePath)) {
  throw new Error('Usage: node scripts/prepare-kfgqpc-hafs.cjs <hafsData_v2-0.json> [output.json]');
}

const sourceBytes = fs.readFileSync(sourcePath);
const sourceHash = crypto.createHash('sha256').update(sourceBytes).digest('hex');
const rows = JSON.parse(sourceBytes.toString('utf8'));

if (!Array.isArray(rows) || rows.length !== 6236) {
  throw new Error(`Expected 6,236 ayat, received ${Array.isArray(rows) ? rows.length : 'non-array data'}.`);
}

const surahs = expectedAyahCounts.map(() => []);
const ids = new Set();

for (const row of rows) {
  const id = Number(row.id);
  const surah = Number(row.sura_no);
  const ayah = Number(row.aya_no);
  const text = String(row.aya_text || '');

  if (!Number.isInteger(id) || id < 1 || id > 6236 || ids.has(id)) {
    throw new Error(`Invalid or duplicate row id: ${row.id}`);
  }
  if (!Number.isInteger(surah) || surah < 1 || surah > 114) {
    throw new Error(`Invalid surah number at row ${id}: ${row.sura_no}`);
  }
  if (!Number.isInteger(ayah) || ayah < 1 || ayah > expectedAyahCounts[surah - 1]) {
    throw new Error(`Invalid ayah number at row ${id}: ${surah}:${row.aya_no}`);
  }
  if (!text || !/[\u00A0 ][\uFC00-\uFD1D]$/u.test(text)) {
    throw new Error(`Missing KFGQPC ayah marker at ${surah}:${ayah}`);
  }
  if (surahs[surah - 1][ayah - 1]) {
    throw new Error(`Duplicate ayah: ${surah}:${ayah}`);
  }

  ids.add(id);
  surahs[surah - 1][ayah - 1] = text;
}

surahs.forEach((ayahs, index) => {
  if (ayahs.length !== expectedAyahCounts[index] || ayahs.some((text) => !text)) {
    throw new Error(`Surah ${index + 1} is incomplete.`);
  }
});

const output = {
  metadata: {
    source: 'KFGQPC Uthmanic Hafs Unicode dataset',
    sourceFile: 'hafsData_v2-0.json',
    sourceSha256: sourceHash,
    narration: 'Hafs an Asim',
    ayahCount: 6236,
    surahCount: 114,
    generatedAt: '2026-08-03'
  },
  surahs
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(output));

const outputHash = crypto.createHash('sha256').update(fs.readFileSync(outputPath)).digest('hex');
console.log(`Validated ${rows.length} ayat across ${surahs.length} surahs.`);
console.log(`Source SHA-256: ${sourceHash}`);
console.log(`Output SHA-256: ${outputHash}`);
console.log(`Wrote ${outputPath}`);
