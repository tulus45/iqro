const expectedCounts = [
  7, 286, 200, 176, 120, 165, 206, 75, 129, 109, 123, 111, 43, 52, 99, 128, 111, 110,
  98, 135, 112, 78, 118, 64, 77, 227, 93, 88, 69, 60, 34, 30, 73, 54, 45, 83, 182, 88,
  75, 85, 54, 53, 89, 59, 37, 35, 38, 29, 18, 45, 60, 49, 62, 55, 78, 96, 29, 22,
  24, 13, 14, 11, 11, 18, 12, 12, 30, 52, 52, 44, 28, 28, 20, 56, 40, 31, 50, 40,
  46, 42, 29, 19, 36, 25, 22, 17, 19, 26, 30, 20, 15, 21, 11, 8, 8, 19, 5, 8, 8,
  11, 11, 8, 3, 9, 5, 4, 7, 3, 6, 3, 5, 4, 5, 6
];

async function main() {
  const records = new Array(expectedCounts.length);
  let cursor = 0;

  async function worker() {
    while (cursor < expectedCounts.length) {
      const index = cursor;
      cursor += 1;
      const number = index + 1;
      const response = await fetch(`https://equran.id/api/v2/surat/${number}`);
      if (!response.ok) throw new Error(`HTTP ${response.status} untuk surah ${number}`);
      const data = (await response.json()).data;
      if (
        Number(data?.nomor) !== number
        || Number(data?.jumlahAyat) !== expectedCounts[index]
        || !Array.isArray(data?.ayat)
        || data.ayat.length !== expectedCounts[index]
      ) {
        throw new Error(`Jumlah ayat surah ${number} tidak sesuai.`);
      }
      data.ayat.forEach((ayah, ayahIndex) => {
        if (
          Number(ayah?.nomorAyat) !== ayahIndex + 1
          || !String(ayah?.teksArab || '').trim()
          || !String(ayah?.teksLatin || '').trim()
          || !String(ayah?.teksIndonesia || '').trim()
        ) {
          throw new Error(`Isi surah ${number} ayat ${ayahIndex + 1} tidak lengkap.`);
        }
      });
      records[index] = data;
    }
  }

  await Promise.all(Array.from({ length: 4 }, () => worker()));
  const ayahCount = records.reduce((sum, record) => sum + record.ayat.length, 0);
  const bytes = Buffer.byteLength(JSON.stringify(records), 'utf8');
  if (records.length !== 114 || ayahCount !== 6236) {
    throw new Error(`Paket tidak valid: ${records.length} surah dan ${ayahCount} ayat.`);
  }
  console.log(JSON.stringify({
    surahs: records.length,
    ayahs: ayahCount,
    bytes,
    megabytes: Number((bytes / (1024 * 1024)).toFixed(2))
  }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
