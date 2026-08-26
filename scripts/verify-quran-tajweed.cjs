const fs = require('node:fs');
const path = require('node:path');

const expectedAyahCounts = [
  7, 286, 200, 176, 120, 165, 206, 75, 129, 109, 123, 111, 43, 52, 99,
  128, 111, 110, 98, 135, 112, 78, 118, 64, 77, 227, 93, 88, 69, 60, 34,
  30, 73, 54, 45, 83, 182, 88, 75, 85, 54, 53, 89, 59, 37, 35, 38, 29,
  18, 45, 60, 49, 62, 55, 78, 96, 29, 22, 24, 13, 14, 11, 11, 18, 12,
  12, 30, 52, 52, 44, 28, 28, 20, 56, 40, 31, 50, 40, 46, 42, 29, 19,
  36, 25, 22, 17, 19, 26, 30, 20, 15, 21, 11, 8, 8, 19, 5, 8, 8, 11,
  11, 8, 3, 9, 5, 4, 7, 3, 6, 3, 5, 4, 5, 6
];
const expectedRules = new Set([
  'ghunnah', 'ham_wasl', 'idgham_ghunnah', 'idgham_mutajanisayn',
  'idgham_mutaqaribayn', 'idgham_shafawi', 'idgham_wo_ghunnah', 'ikhafa',
  'ikhafa_shafawi', 'iqlab', 'laam_shamsiyah', 'madda_necessary',
  'madda_normal', 'madda_obligatory', 'madda_permissible', 'qalaqah', 'slnt'
]);
const assetPath = path.join(__dirname, '..', 'assets', 'quran', 'uthmani-tajweed-v4.json');
const stylePath = path.join(__dirname, '..', 'style.css');
const runtimePath = path.join(__dirname, '..', 'community.js');
const data = JSON.parse(fs.readFileSync(assetPath, 'utf8'));
const styles = fs.readFileSync(stylePath, 'utf8');
const runtimeSource = fs.readFileSync(runtimePath, 'utf8');
const segmenter = new Intl.Segmenter('ar', { granularity: 'grapheme' });
const seenRules = new Set();
let ayahCount = 0;
let graphemeCount = 0;
let superscriptAlefCount = 0;
let renderedMaddaClusters = 0;

function fail(message) {
  throw new Error(message);
}

function verifyMarkup(markup, verseKey) {
  if (!markup || markup.includes('\u25CC')) fail(`Literal dotted circle found at ${verseKey}.`);
  if (markup.includes('\u0672')) fail(`Legacy wavy alef found at ${verseKey}.`);
  if (markup.includes('\u0640\u0670')) {
    fail(`Presentation tatweel remains before dagger alif at ${verseKey}.`);
  }
  superscriptAlefCount += [...markup.matchAll(/\u0670/gu)].length;

  const fragments = [];
  const tagPattern = /<span class="tajweed tajweed-([a-z0-9_]+)">|<\/span>/gu;
  let activeRule = null;
  let cursor = 0;
  let match;

  while ((match = tagPattern.exec(markup)) !== null) {
    const text = markup.slice(cursor, match.index);
    if (/[<>]/u.test(text)) fail(`Unexpected markup at ${verseKey}.`);
    if (text) fragments.push({ text, rule: activeRule });

    if (match[1]) {
      if (activeRule) fail(`Nested tajweed span at ${verseKey}.`);
      if (!expectedRules.has(match[1])) fail(`Unknown tajweed rule ${match[1]} at ${verseKey}.`);
      activeRule = match[1];
      seenRules.add(activeRule);
    } else {
      if (!activeRule) fail(`Unmatched tajweed closing span at ${verseKey}.`);
      activeRule = null;
    }
    cursor = tagPattern.lastIndex;
  }

  const tail = markup.slice(cursor);
  if (/[<>]/u.test(tail) || activeRule) fail(`Unbalanced tajweed markup at ${verseKey}.`);
  if (tail) fragments.push({ text: tail, rule: null });

  const text = fragments.map((fragment) => fragment.text).join('');
  const runs = [];
  let offset = 0;
  fragments.forEach((fragment) => {
    runs.push({ start: offset, end: offset + fragment.text.length, rule: fragment.rule || 'plain' });
    offset += fragment.text.length;
  });

  for (const { segment, index } of segmenter.segment(text)) {
    graphemeCount += 1;
    const end = index + segment.length;
    const rules = new Set(
      runs.filter((run) => run.start < end && run.end > index).map((run) => run.rule)
    );
    if (rules.size > 1) {
      fail(`Tajweed boundary splits grapheme ${JSON.stringify(segment)} at ${verseKey}.`);
    }
    const activeGraphemeRule = [...rules][0];
    if (activeGraphemeRule?.startsWith('madda_')) {
      renderedMaddaClusters += 1;
    }
  }
}

if (!Array.isArray(data.surahs) || data.surahs.length !== expectedAyahCounts.length) {
  fail('Tajweed asset must contain 114 surahs.');
}

data.surahs.forEach((surah, surahIndex) => {
  if (!Array.isArray(surah) || surah.length !== expectedAyahCounts[surahIndex]) {
    fail(`Unexpected ayah count for surah ${surahIndex + 1}.`);
  }
  surah.forEach((markup, ayahIndex) => {
    ayahCount += 1;
    verifyMarkup(markup, `${surahIndex + 1}:${ayahIndex + 1}`);
  });
});

for (const rule of expectedRules) {
  if (!seenRules.has(rule)) fail(`Tajweed rule is unused: ${rule}.`);
  if (!styles.includes(`.tajweed-${rule}`)) fail(`Missing CSS color for tajweed rule: ${rule}.`);
}

if (ayahCount !== 6236 || data.metadata?.ayahCount !== 6236 || data.metadata?.surahCount !== 114) {
  fail('Tajweed metadata or total ayah count is invalid.');
}
if (superscriptAlefCount !== 9726 || data.metadata?.canonicalSuperscriptAlefCount !== 9726) {
  fail(`Canonical superscript alef count is invalid: ${superscriptAlefCount}.`);
}
if (renderedMaddaClusters !== data.metadata?.sourceMaddaClusters) {
  fail(
    `Rendered mad coverage ${renderedMaddaClusters} does not match `
    + `the ${data.metadata?.sourceMaddaClusters} source-annotated graphemes.`
  );
}
const alBaqarahTwo = data.surahs[1][1].replace(/<span class="tajweed tajweed-[a-z0-9_]+">|<\/span>/gu, '');
if (!alBaqarahTwo.includes('\u062A\u064E\u0670\u0628\u064F')) {
  fail('Al-Baqarah 2:2 does not contain canonical ta + fathah + dagger alif + ba + dammah.');
}
const alAnam151 = data.surahs[5][150]
  .replace(/<span class="tajweed tajweed-[a-z0-9_]+">|<\/span>/gu, '');
if (
  (alAnam151.match(/\u064B/gu) || []).length < 2
  || !alAnam151.includes('\u0642\u0651\u0650\u200C\u06DA')
  || !alAnam151.includes('\u200C\u06D6')
) {
  fail('Al-Anam 6:151 must retain conventional fathatan, qaf kasra, and waqf signs.');
}
if (!/const qcfTajweedColorGlyphsEnabled = false;/u.test(runtimeSource)) {
  fail('The clean Unicode tajweed renderer must remain enabled for production.');
}

console.log(`Verified ${ayahCount} ayat, ${graphemeCount} grapheme clusters, and ${seenRules.size} tajweed rules.`);
console.log(`Verified ${superscriptAlefCount} canonical superscript alef characters and no legacy U+0672.`);
console.log(`Verified blue coverage for all ${renderedMaddaClusters} source-annotated mad graphemes.`);
console.log('Verified dagger alif attaches directly to its Arabic base, including Al-Baqarah 2:2.');
console.log('No dotted-circle character or split grapheme boundary found.');
console.log('Verified clean harakat rendering for Al-Anam 6:151 without removing its waqf signs.');
