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

const sourceUrl = process.argv[2]
  || 'https://api.quran.com/api/v4/quran/verses/uthmani_tajweed';
const outputPath = path.resolve(
  process.argv[3] || path.join(__dirname, '..', 'assets', 'quran', 'uthmani-tajweed-v4.json')
);
const allowedRulePattern = /^[a-z][a-z0-9_]*$/;
const arabicGraphemeSegmenter = new Intl.Segmenter('ar', { granularity: 'grapheme' });
const expectedLegacyWavyAlefCount = 1561;
const expectedLegacyWavyAlefHamzaCount = 1;
const expectedLegacyDaggerTatweelRunCount = 6100;
const expectedLegacyDaggerTatweelCount = 6104;
const expectedCanonicalSuperscriptAlefCount = 9726;
const expectedSourceMaddaClusterCount = 28294;
const expectedMaddaPriorityResolutionCount = 910;
const knownSourceMarkupCorrections = Object.freeze({
  // The API payload currently omits the opening tag before the dagger alif.
  // The correction restores the madda_normal annotation; visible Quran text
  // remains identical to the source's Uthmani text.
  '32:3': [
    'فْتَرَ>ٮٰ</tajweed>هُ',
    'فْتَرَ<tajweed class=madda_normal>ٮٰ</tajweed>هُ'
  ]
});

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function applyKnownSourceCorrection(value, verseKey) {
  let source = String(value || '').trim();
  const correction = knownSourceMarkupCorrections[verseKey];
  if (!correction) return source;
  if (!source.includes(correction[0])) {
    throw new Error(`Expected known source anomaly was not found at ${verseKey}.`);
  }
  return source.replace(correction[0], correction[1]);
}

function countMatches(value, pattern) {
  return [...String(value || '').matchAll(pattern)].length;
}

function normalizeLegacyQuranCodePoints(value, verseKey, audit) {
  const source = String(value || '');
  const legacyWavyAlefCount = countMatches(source, /\u0672/gu);
  const legacyWavyAlefHamzaCount = countMatches(source, /\u0672\u0654/gu);
  audit.legacyWavyAlefConversions += legacyWavyAlefCount;
  audit.legacyWavyAlefHamzaConversions += legacyWavyAlefHamzaCount;

  // Quran Foundation's tajweed payload uses U+0672 as a legacy stand-in for
  // dagger alif. Our KFGQPC-compatible font maps that letter to a visible
  // symbol, so convert it to canonical U+0670. One occurrence at 2:72 also
  // carries a combining hamza; KFGQPC confirms that it represents a separate
  // hamza letter following the dagger alif.
  const canonicalizedAlef = source
    .replace(/\u0672\u0654/gu, '\u0670\u0621')
    .replace(/\u0672/gu, '\u0670');
  const legacyDaggerTatweelRuns = [...canonicalizedAlef.matchAll(/\u0640+(?=\u0670)/gu)];
  const legacyDaggerTatweelCount = legacyDaggerTatweelRuns.reduce(
    (total, match) => total + match[0].length,
    0
  );
  audit.legacyDaggerTatweelRuns += legacyDaggerTatweelRuns.length;
  audit.legacyDaggerTatweelRemovals += legacyDaggerTatweelCount;

  // U+0640 before dagger alif is another presentation-only convention in the
  // API payload. KFGQPC encodes the same orthography without tatweel, allowing
  // U+0670 to combine directly above its actual Arabic base letter.
  const normalized = canonicalizedAlef.replace(/\u0640+(?=\u0670)/gu, '');

  if (/\u0672/u.test(normalized)) {
    throw new Error(`Legacy wavy alef remains at ${verseKey}.`);
  }
  if (/\u0640\u0670/u.test(normalized)) {
    throw new Error(`Presentation tatweel remains before dagger alif at ${verseKey}.`);
  }
  audit.canonicalSuperscriptAlefCount += countMatches(normalized, /\u0670/gu);
  return normalized;
}

function renderGraphemeSafeTajweedMarkup(fragments, verseKey, audit) {
  const text = fragments.map((fragment) => fragment.text).join('');
  const rulesByCodeUnit = new Array(text.length).fill(null);
  let offset = 0;

  fragments.forEach((fragment) => {
    for (let index = 0; index < fragment.text.length; index += 1) {
      rulesByCodeUnit[offset + index] = fragment.rule;
    }
    offset += fragment.text.length;
  });

  let output = '';
  let bufferedText = '';
  let bufferedRule;

  function flushBuffer() {
    if (!bufferedText) return;
    const escaped = escapeHtml(bufferedText);
    output += bufferedRule
      ? `<span class="tajweed tajweed-${bufferedRule}">${escaped}</span>`
      : escaped;
    bufferedText = '';
  }

  for (const { segment, index } of arabicGraphemeSegmenter.segment(text)) {
    const rulesInCluster = [];
    const ruleSignatures = new Set();
    let baseRule = null;
    let segmentOffset = 0;

    for (const character of segment) {
      const rule = rulesByCodeUnit[index + segmentOffset] || null;
      ruleSignatures.add(rule || 'plain');
      if (rule && !rulesInCluster.includes(rule)) rulesInCluster.push(rule);
      if (baseRule === null && /\p{L}/u.test(character) && rule) baseRule = rule;
      segmentOffset += character.length;
    }

    // A WebView must never receive an HTML boundary inside one Arabic
    // grapheme. When a source annotation colors only a combining mark, color
    // its complete base-letter cluster instead of rendering a dotted circle.
    const sourceMaddaRule = rulesInCluster.find((rule) => rule.startsWith('madda_')) || null;
    const clusterRule = sourceMaddaRule || baseRule || rulesInCluster[0] || null;
    if (sourceMaddaRule) {
      audit.sourceMaddaClusters += 1;
      if (rulesInCluster.some((rule) => !rule.startsWith('madda_'))) {
        audit.maddaPriorityResolutions += 1;
      }
    }
    if (ruleSignatures.size > 1) {
      audit.repairedClusters += 1;
      if (rulesInCluster.length > 1) audit.multiRuleClusters += 1;
    }

    if (bufferedRule !== clusterRule) {
      flushBuffer();
      bufferedRule = clusterRule;
    }
    bufferedText += segment;
  }
  flushBuffer();

  const renderedText = output.replace(/<span class="tajweed tajweed-[a-z0-9_]+">|<\/span>/gu, '');
  if (renderedText !== escapeHtml(text)) {
    throw new Error(`Grapheme-safe rendering changed Quran text at ${verseKey}.`);
  }
  return output;
}

function compileTajweedMarkup(value, verseKey, rules, audit) {
  const source = normalizeLegacyQuranCodePoints(
    applyKnownSourceCorrection(value, verseKey),
    verseKey,
    audit
  );
  const withoutMarker = source.replace(/\s*<span\s+class=(?:"end"|'end'|end)>[^<]*<\/span>\s*$/u, '');
  let cursor = 0;
  const fragments = [];
  const openRules = [];
  const tagPattern = /<tajweed\s+class=(?:"([a-z0-9_]+)"|'([a-z0-9_]+)'|([a-z0-9_]+))>|<\/tajweed>/gu;
  let match;

  while ((match = tagPattern.exec(withoutMarker)) !== null) {
    const plain = withoutMarker.slice(cursor, match.index);
    if (/[<>]/u.test(plain)) {
      throw new Error(`Unexpected markup at ${verseKey}: ${JSON.stringify(plain)} in ${JSON.stringify(withoutMarker)}`);
    }
    if (plain) fragments.push({ text: plain, rule: openRules.at(-1) || null });

    const rule = match[1] || match[2] || match[3] || '';
    if (rule) {
      if (!allowedRulePattern.test(rule)) throw new Error(`Invalid tajweed rule at ${verseKey}: ${rule}`);
      rules.add(rule);
      openRules.push(rule);
    } else {
      if (!openRules.length) throw new Error(`Unbalanced closing tajweed tag at ${verseKey}.`);
      openRules.pop();
    }
    cursor = tagPattern.lastIndex;
  }

  const tail = withoutMarker.slice(cursor);
  if (/[<>]/u.test(tail)) {
    throw new Error(`Unrecognized markup at ${verseKey}: ${JSON.stringify(tail)} in ${JSON.stringify(withoutMarker)}`);
  }
  if (tail) fragments.push({ text: tail, rule: openRules.at(-1) || null });
  if (openRules.length) throw new Error(`Unclosed tajweed tag at ${verseKey}: ${openRules.join(', ')}`);
  if (!fragments.length) throw new Error(`Empty tajweed text at ${verseKey}.`);
  return renderGraphemeSafeTajweedMarkup(fragments, verseKey, audit);
}

async function main() {
  const requestOptions = {
    headers: {
      accept: 'application/json',
      'user-agent': 'Iqro-Tajweed-Pack-Builder/1.0'
    }
  };
  const response = await fetch(sourceUrl, requestOptions);
  if (!response.ok) throw new Error(`Quran Foundation tajweed endpoint returned HTTP ${response.status}.`);

  const sourceBytes = Buffer.from(await response.arrayBuffer());
  const sourceSha256 = crypto.createHash('sha256').update(sourceBytes).digest('hex');
  const payload = JSON.parse(sourceBytes.toString('utf8'));
  const verses = Array.isArray(payload?.verses) ? payload.verses : [];
  const expectedAyahCount = expectedAyahCounts.reduce((sum, count) => sum + count, 0);
  if (verses.length !== expectedAyahCount) {
    throw new Error(`Expected ${expectedAyahCount} verses, received ${verses.length}.`);
  }
  const surahs = expectedAyahCounts.map(() => []);
  const rules = new Set();
  const verseKeys = new Set();
  const graphemeAudit = {
    repairedClusters: 0,
    multiRuleClusters: 0,
    legacyWavyAlefConversions: 0,
    legacyWavyAlefHamzaConversions: 0,
    legacyDaggerTatweelRuns: 0,
    legacyDaggerTatweelRemovals: 0,
    canonicalSuperscriptAlefCount: 0,
    sourceMaddaClusters: 0,
    maddaPriorityResolutions: 0
  };

  verses.forEach((verse) => {
    const verseKey = String(verse?.verse_key || '');
    const keyMatch = /^(\d+):(\d+)$/u.exec(verseKey);
    if (!keyMatch || verseKeys.has(verseKey)) throw new Error(`Invalid or duplicate verse key: ${verseKey}`);

    const surah = Number(keyMatch[1]);
    const ayah = Number(keyMatch[2]);
    if (surah < 1 || surah > 114 || ayah < 1 || ayah > expectedAyahCounts[surah - 1]) {
      throw new Error(`Verse key is outside the Quran range: ${verseKey}`);
    }
    if (surahs[surah - 1][ayah - 1]) throw new Error(`Duplicate verse: ${verseKey}`);
    verseKeys.add(verseKey);
    surahs[surah - 1][ayah - 1] = compileTajweedMarkup(
      verse?.text_uthmani_tajweed,
      verseKey,
      rules,
      graphemeAudit
    );
  });

  surahs.forEach((ayahs, index) => {
    if (ayahs.length !== expectedAyahCounts[index] || ayahs.some((text) => !text)) {
      throw new Error(`Surah ${index + 1} is incomplete.`);
    }
  });
  if (
    graphemeAudit.legacyWavyAlefConversions !== expectedLegacyWavyAlefCount
    || graphemeAudit.legacyWavyAlefHamzaConversions !== expectedLegacyWavyAlefHamzaCount
    || graphemeAudit.legacyDaggerTatweelRuns !== expectedLegacyDaggerTatweelRunCount
    || graphemeAudit.legacyDaggerTatweelRemovals !== expectedLegacyDaggerTatweelCount
    || graphemeAudit.canonicalSuperscriptAlefCount !== expectedCanonicalSuperscriptAlefCount
    || graphemeAudit.sourceMaddaClusters !== expectedSourceMaddaClusterCount
    || graphemeAudit.maddaPriorityResolutions !== expectedMaddaPriorityResolutionCount
  ) {
    throw new Error(
      'Legacy Quran code-point audit failed: '
      + JSON.stringify({
        legacyWavyAlefConversions: graphemeAudit.legacyWavyAlefConversions,
        legacyWavyAlefHamzaConversions: graphemeAudit.legacyWavyAlefHamzaConversions,
        legacyDaggerTatweelRuns: graphemeAudit.legacyDaggerTatweelRuns,
        legacyDaggerTatweelRemovals: graphemeAudit.legacyDaggerTatweelRemovals,
        canonicalSuperscriptAlefCount: graphemeAudit.canonicalSuperscriptAlefCount,
        sourceMaddaClusters: graphemeAudit.sourceMaddaClusters,
        maddaPriorityResolutions: graphemeAudit.maddaPriorityResolutions
      })
    );
  }

  const output = {
    metadata: {
      source: 'Quran Foundation Content API v4',
      sourceUrl,
      sourceSha256,
      field: 'text_uthmani_tajweed',
      narration: 'Hafs an Asim',
      ayahCount: expectedAyahCount,
      surahCount: expectedAyahCounts.length,
      rules: [...rules].sort(),
      sourceMarkupCorrections: Object.keys(knownSourceMarkupCorrections),
      graphemeBoundaryRepairs: graphemeAudit.repairedClusters,
      multiRuleGraphemeResolutions: graphemeAudit.multiRuleClusters,
      legacyWavyAlefConversions: graphemeAudit.legacyWavyAlefConversions,
      legacyWavyAlefHamzaConversions: graphemeAudit.legacyWavyAlefHamzaConversions,
      legacyDaggerTatweelRuns: graphemeAudit.legacyDaggerTatweelRuns,
      legacyDaggerTatweelRemovals: graphemeAudit.legacyDaggerTatweelRemovals,
      canonicalSuperscriptAlefCount: graphemeAudit.canonicalSuperscriptAlefCount,
      sourceMaddaClusters: graphemeAudit.sourceMaddaClusters,
      maddaPriorityResolutions: graphemeAudit.maddaPriorityResolutions,
      generatedAt: new Date().toISOString().slice(0, 10)
    },
    surahs
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(output));
  const outputBytes = fs.readFileSync(outputPath);
  console.log(`Validated ${expectedAyahCount} ayat across 114 surahs.`);
  console.log(`Rules: ${output.metadata.rules.join(', ')}`);
  console.log(`Grapheme-boundary repairs: ${graphemeAudit.repairedClusters}`);
  console.log(`Multi-rule grapheme resolutions: ${graphemeAudit.multiRuleClusters}`);
  console.log(`Legacy wavy-alef conversions: ${graphemeAudit.legacyWavyAlefConversions}`);
  console.log(
    `Dagger-alif tatweel removals: ${graphemeAudit.legacyDaggerTatweelRemovals} `
    + `across ${graphemeAudit.legacyDaggerTatweelRuns} positions`
  );
  console.log(`Canonical superscript alef count: ${graphemeAudit.canonicalSuperscriptAlefCount}`);
  console.log(`Source-annotated mad clusters: ${graphemeAudit.sourceMaddaClusters}`);
  console.log(`Mad-priority conflict resolutions: ${graphemeAudit.maddaPriorityResolutions}`);
  console.log(`Source SHA-256: ${sourceSha256}`);
  console.log(`Output SHA-256: ${crypto.createHash('sha256').update(outputBytes).digest('hex')}`);
  console.log(`Wrote ${outputPath} (${outputBytes.length} bytes)`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
