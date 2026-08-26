const fs = require('node:fs');
const path = require('node:path');

const apiBaseUrl = 'https://api.quran.com/api/v4';
const mushafId = 19;
const requestTimeoutMs = 20_000;
const requestAttempts = 3;
const concurrency = 6;
const expectedAyahCounts = [
  7, 286, 200, 176, 120, 165, 206, 75, 129, 109, 123, 111, 43, 52, 99,
  128, 111, 110, 98, 135, 112, 78, 118, 64, 77, 227, 93, 88, 69, 60, 34,
  30, 73, 54, 45, 83, 182, 88, 75, 85, 54, 53, 89, 59, 37, 35, 38, 29,
  18, 45, 60, 49, 62, 55, 78, 96, 29, 22, 24, 13, 14, 11, 11, 18, 12,
  12, 30, 52, 52, 44, 28, 28, 20, 56, 40, 31, 50, 40, 46, 42, 29, 19,
  36, 25, 22, 17, 19, 26, 30, 20, 15, 21, 11, 8, 8, 19, 5, 8, 8, 11,
  11, 8, 3, 9, 5, 4, 7, 3, 6, 3, 5, 4, 5, 6
];
const qcfGlyphPattern = /^[\u0020\uFC00-\uFDFF]+$/u;
const qpcAssetPath = path.join(__dirname, '..', 'assets', 'quran', 'kfgqpc-hafs-v2.0.json');

function fail(message) {
  throw new Error(message);
}

function stripLocalVerseMarker(text) {
  return String(text || '')
    .replace(/[\u00A0\s]*[\uFC00-\uFD1D][\u00A0\s]*$/u, '')
    .replace(/\u06DD[\u0660-\u0669\u06F0-\u06F9]*/gu, '')
    .replace(/[\uFD3E\uFD3F][\u0660-\u0669\u06F0-\u06F9]+[\uFD3E\uFD3F]/gu, '');
}

function normalizeQpcText(text) {
  return stripLocalVerseMarker(text).replace(/[\s\u00A0\u0640]/gu, '');
}

function parseArabicDigits(text) {
  const digits = String(text || '').replace(/[\u0660-\u0669\u06F0-\u06F9]/gu, (digit) => {
    const codePoint = digit.codePointAt(0);
    return String(codePoint <= 0x0669 ? codePoint - 0x0660 : codePoint - 0x06F0);
  });
  return /^\d+$/u.test(digits) ? Number(digits) : Number.NaN;
}

function formatCodePoints(text) {
  return Array.from(text)
    .slice(0, 12)
    .map((character) => `U+${character.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`)
    .join(' ');
}

function describeTextDifference(expected, actual) {
  const expectedCharacters = Array.from(expected);
  const actualCharacters = Array.from(actual);
  const sharedLength = Math.min(expectedCharacters.length, actualCharacters.length);
  let index = 0;
  while (index < sharedLength && expectedCharacters[index] === actualCharacters[index]) index += 1;

  const expectedContext = expectedCharacters.slice(Math.max(0, index - 4), index + 8).join('');
  const actualContext = actualCharacters.slice(Math.max(0, index - 4), index + 8).join('');
  return [
    `first difference at character ${index + 1}`,
    `local ${JSON.stringify(expectedContext)} (${formatCodePoints(expectedContext)})`,
    `QCF ${JSON.stringify(actualContext)} (${formatCodePoints(actualContext)})`
  ].join('; ');
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchJson(url) {
  let lastError;

  for (let attempt = 1; attempt <= requestAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        signal: controller.signal
      });
      if (!response.ok) fail(`HTTP ${response.status} ${response.statusText} for ${url}.`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < requestAttempts) await delay(attempt * 500);
    } finally {
      clearTimeout(timeout);
    }
  }

  fail(`Unable to fetch ${url}: ${lastError?.message || lastError}`);
}

async function mapWithConcurrency(values, limit, task) {
  const results = new Array(values.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await task(values[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, () => worker()));
  return results;
}

function validateLocalAsset(data) {
  if (!Array.isArray(data?.surahs) || data.surahs.length !== 114) {
    fail('Local KFGQPC asset must contain 114 surahs.');
  }

  data.surahs.forEach((surah, index) => {
    if (!Array.isArray(surah) || surah.length !== expectedAyahCounts[index]) {
      fail(`Unexpected local KFGQPC ayah count for surah ${index + 1}.`);
    }
  });
}

function validatePagination(payload, surahNumber, expectedCount) {
  const pagination = payload?.pagination;
  if (
    pagination?.current_page !== 1
    || pagination?.total_pages !== 1
    || pagination?.next_page !== null
    || pagination?.total_records !== expectedCount
  ) {
    fail(`Unexpected API pagination for surah ${surahNumber}.`);
  }
}

function validateVerse(verse, surahNumber, ayahNumber, localText, state) {
  const verseKey = `${surahNumber}:${ayahNumber}`;
  if (verse?.verse_key !== verseKey || Number(verse?.verse_number) !== ayahNumber) {
    fail(`Unexpected verse identity at ${verseKey}.`);
  }
  if (!Number.isInteger(verse.id) || state.verseIds.has(verse.id)) {
    fail(`Invalid or duplicate verse id at ${verseKey}.`);
  }
  state.verseIds.add(verse.id);

  if (!Array.isArray(verse.words) || verse.words.length < 2) {
    fail(`Missing word data at ${verseKey}.`);
  }

  const endTokens = verse.words.filter((word) => word?.char_type_name === 'end');
  if (endTokens.length !== 1 || verse.words.at(-1) !== endTokens[0]) {
    fail(`Verse ${verseKey} must have exactly one final end token.`);
  }
  if (parseArabicDigits(endTokens[0].text_qpc_hafs) !== ayahNumber) {
    fail(`End token does not contain ayah number ${ayahNumber} at ${verseKey}.`);
  }

  const qpcWords = [];
  verse.words.forEach((word, wordIndex) => {
    const tokenKey = `${verseKey} token ${wordIndex + 1}`;
    const expectedType = wordIndex === verse.words.length - 1 ? 'end' : 'word';
    if (word?.char_type_name !== expectedType) {
      fail(`Unexpected ${word?.char_type_name || 'missing'} token type at ${tokenKey}.`);
    }
    if (Number(word?.position) !== wordIndex + 1) {
      fail(`Non-sequential token position at ${tokenKey}.`);
    }
    if (!Number.isInteger(word?.id) || state.wordIds.has(word.id)) {
      fail(`Invalid or duplicate token id at ${tokenKey}.`);
    }
    state.wordIds.add(word.id);

    if (!Number.isInteger(word?.page_number) || word.page_number < 1 || word.page_number > 604) {
      fail(`Invalid page number at ${tokenKey}.`);
    }
    state.pages.add(word.page_number);
    if (typeof word.code_v2 !== 'string' || !qcfGlyphPattern.test(word.code_v2)) {
      fail(`Invalid QCF V4 glyph code at ${tokenKey}.`);
    }

    if (expectedType === 'word') {
      if (typeof word.text_qpc_hafs !== 'string' || !word.text_qpc_hafs.trim()) {
        fail(`Missing text_qpc_hafs at ${tokenKey}.`);
      }
      qpcWords.push(word.text_qpc_hafs);
      state.wordCount += 1;
    } else {
      state.endCount += 1;
    }
  });

  const expectedText = normalizeQpcText(localText);
  const actualText = normalizeQpcText(qpcWords.join(' '));
  if (actualText !== expectedText) {
    fail(`QPC text mismatch at ${verseKey}: ${describeTextDifference(expectedText, actualText)}.`);
  }

  state.ayahCount += 1;
}

async function verifySurah(surahNumber, localSurah, state) {
  const expectedCount = expectedAyahCounts[surahNumber - 1];
  const url = new URL(`${apiBaseUrl}/verses/by_chapter/${surahNumber}`);
  url.searchParams.set('words', 'true');
  url.searchParams.set('word_fields', 'code_v2,text_qpc_hafs');
  url.searchParams.set('per_page', '300');
  url.searchParams.set('mushaf', String(mushafId));

  const payload = await fetchJson(url);
  validatePagination(payload, surahNumber, expectedCount);
  if (!Array.isArray(payload?.verses) || payload.verses.length !== expectedCount) {
    fail(`Unexpected API ayah count for surah ${surahNumber}.`);
  }

  payload.verses.forEach((verse, index) => {
    validateVerse(verse, surahNumber, index + 1, localSurah[index], state);
  });

  process.stdout.write(`Verified surah ${surahNumber}/114\r`);
}

async function main() {
  if (typeof fetch !== 'function') fail('This verifier requires Node.js 18 or newer.');

  const localData = JSON.parse(fs.readFileSync(qpcAssetPath, 'utf8'));
  validateLocalAsset(localData);

  const state = {
    ayahCount: 0,
    wordCount: 0,
    endCount: 0,
    verseIds: new Set(),
    wordIds: new Set(),
    pages: new Set()
  };

  await mapWithConcurrency(
    Array.from({ length: 114 }, (_, index) => index + 1),
    concurrency,
    (surahNumber) => verifySurah(surahNumber, localData.surahs[surahNumber - 1], state)
  );

  if (state.ayahCount !== 6236 || state.verseIds.size !== 6236 || state.endCount !== 6236) {
    fail('QCF V4 verse or end-token totals are invalid.');
  }
  if (state.wordCount !== 77429 || state.wordIds.size !== state.wordCount + state.endCount) {
    fail(`QCF V4 word totals are invalid: ${state.wordCount} content words.`);
  }
  if (state.pages.size !== 604) fail(`Expected glyph data for 604 pages, found ${state.pages.size}.`);
  for (let page = 1; page <= 604; page += 1) {
    if (!state.pages.has(page)) fail(`QCF V4 glyph data does not cover page ${page}.`);
  }

  process.stdout.write(' '.repeat(40) + '\r');
  console.log('Verified QCF Tajweed V4 (mushaf 19) against the local KFGQPC Hafs source.');
  console.log(`Verified ${state.ayahCount} ayat, ${state.wordCount} words, and ${state.endCount} end markers.`);
  console.log('Verified all glyph codes, token positions, and page coverage from 1 through 604.');
  console.log('Every QPC ayah matches locally after ignoring whitespace, U+0640, and verse markers.');
}

main().catch((error) => {
  console.error(`QCF Tajweed V4 verification failed: ${error.message}`);
  process.exitCode = 1;
});
