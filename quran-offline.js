(() => {
  'use strict';

  const databaseName = 'iqro-quran-offline';
  const databaseVersion = 1;
  const surahStoreName = 'surahs';
  const metadataStoreName = 'metadata';
  const activeMetadataKey = 'active-pack';
  const packVersion = 'equran-id-v2-2026-08';
  const apiBaseUrl = 'https://equran.id/api/v2/surat';
  const expectedAyahCounts = Object.freeze([
    7, 286, 200, 176, 120, 165, 206, 75, 129, 109, 123, 111, 43, 52, 99, 128, 111, 110,
    98, 135, 112, 78, 118, 64, 77, 227, 93, 88, 69, 60, 34, 30, 73, 54, 45, 83, 182, 88,
    75, 85, 54, 53, 89, 59, 37, 35, 38, 29, 18, 45, 60, 49, 62, 55, 78, 96, 29, 22,
    24, 13, 14, 11, 11, 18, 12, 12, 30, 52, 52, 44, 28, 28, 20, 56, 40, 31, 50, 40,
    46, 42, 29, 19, 36, 25, 22, 17, 19, 26, 30, 20, 15, 21, 11, 8, 8, 19, 5, 8, 8,
    11, 11, 8, 3, 9, 5, 4, 7, 3, 6, 3, 5, 4, 5, 6
  ]);
  const expectedSurahCount = expectedAyahCounts.length;
  const expectedAyahCount = expectedAyahCounts.reduce((sum, count) => sum + count, 0);

  const state = {
    initialized: false,
    ready: false,
    downloading: false,
    completedSurahs: 0,
    totalSurahs: expectedSurahCount,
    error: '',
    metadata: null
  };

  let databasePromise = null;
  let initializationPromise = null;

  function publicState() {
    return {
      ...state,
      metadata: state.metadata ? { ...state.metadata } : null
    };
  }

  function emitState() {
    window.dispatchEvent(new CustomEvent('iqro:quran-offline-status', {
      detail: publicState()
    }));
  }

  function updateState(patch) {
    Object.assign(state, patch);
    emitState();
  }

  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Penyimpanan offline tidak dapat dibaca.'));
    });
  }

  function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error('Penyimpanan offline gagal diperbarui.'));
      transaction.onabort = () => reject(transaction.error || new Error('Penyimpanan offline dibatalkan.'));
    });
  }

  function openDatabase() {
    if (!('indexedDB' in window)) {
      return Promise.reject(new Error('Perangkat ini tidak mendukung penyimpanan Al-Quran offline.'));
    }

    if (!databasePromise) {
      databasePromise = new Promise((resolve, reject) => {
        const request = window.indexedDB.open(databaseName, databaseVersion);
        request.onupgradeneeded = () => {
          const database = request.result;
          if (!database.objectStoreNames.contains(surahStoreName)) {
            database.createObjectStore(surahStoreName, { keyPath: 'nomor' });
          }
          if (!database.objectStoreNames.contains(metadataStoreName)) {
            database.createObjectStore(metadataStoreName, { keyPath: 'key' });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => {
          databasePromise = null;
          reject(request.error || new Error('Penyimpanan Al-Quran offline tidak dapat dibuka.'));
        };
        request.onblocked = () => {
          databasePromise = null;
          reject(new Error('Penyimpanan offline sedang digunakan. Tutup lalu buka kembali aplikasi.'));
        };
      });
    }

    return databasePromise;
  }

  function cleanText(value) {
    return String(value || '').trim();
  }

  function normalizeSurahData(value, requestedNumber) {
    const nomor = Number(value?.nomor);
    const expectedNumber = Number(requestedNumber);
    if (nomor !== expectedNumber || nomor < 1 || nomor > expectedSurahCount) {
      throw new Error(`Data surah ${expectedNumber} tidak sesuai.`);
    }

    const expectedCount = expectedAyahCounts[nomor - 1];
    const ayahs = Array.isArray(value?.ayat) ? value.ayat : [];
    if (Number(value?.jumlahAyat) !== expectedCount || ayahs.length !== expectedCount) {
      throw new Error(`Jumlah ayat surah ${nomor} tidak sesuai.`);
    }

    const normalizedAyahs = ayahs.map((ayah, index) => {
      const nomorAyat = Number(ayah?.nomorAyat);
      const teksArab = cleanText(ayah?.teksArab);
      const teksLatin = cleanText(ayah?.teksLatin);
      const teksIndonesia = cleanText(ayah?.teksIndonesia);
      if (nomorAyat !== index + 1 || !teksArab || !teksLatin || !teksIndonesia) {
        throw new Error(`Isi surah ${nomor} ayat ${index + 1} tidak lengkap.`);
      }
      return { nomorAyat, teksArab, teksLatin, teksIndonesia };
    });

    return {
      nomor,
      nama: cleanText(value?.nama),
      namaLatin: cleanText(value?.namaLatin),
      jumlahAyat: expectedCount,
      tempatTurun: cleanText(value?.tempatTurun),
      arti: cleanText(value?.arti),
      deskripsi: cleanText(value?.deskripsi),
      ayat: normalizedAyahs
    };
  }

  function validatePack(records) {
    if (!Array.isArray(records) || records.length !== expectedSurahCount) {
      throw new Error('Paket offline harus berisi 114 surah.');
    }

    const normalized = records.map((record, index) => normalizeSurahData(record, index + 1));
    const ayahCount = normalized.reduce((sum, record) => sum + record.ayat.length, 0);
    if (ayahCount !== expectedAyahCount) {
      throw new Error('Paket offline harus berisi tepat 6.236 ayat.');
    }
    return normalized;
  }

  async function checksumText(value) {
    if (!window.crypto?.subtle || typeof TextEncoder !== 'function') return '';
    const bytes = new TextEncoder().encode(value);
    const digest = await window.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  }

  async function readStoredPack() {
    const database = await openDatabase();
    const transaction = database.transaction([surahStoreName, metadataStoreName], 'readonly');
    const done = transactionDone(transaction);
    const recordsPromise = requestResult(transaction.objectStore(surahStoreName).getAll());
    const metadataPromise = requestResult(transaction.objectStore(metadataStoreName).get(activeMetadataKey));
    const [records, metadata] = await Promise.all([recordsPromise, metadataPromise]);
    await done;
    return { records, metadata };
  }

  async function verifyStoredPack() {
    const { records, metadata } = await readStoredPack();
    if (!metadata || metadata.version !== packVersion) return null;

    const normalized = validatePack(records);
    const serialized = JSON.stringify(normalized);
    const checksum = await checksumText(serialized);
    if (metadata.checksum && checksum && metadata.checksum !== checksum) {
      throw new Error('Pemeriksaan integritas data offline gagal. Silakan unduh ulang.');
    }

    return {
      ...metadata,
      checksum: metadata.checksum || checksum,
      surahCount: expectedSurahCount,
      ayahCount: expectedAyahCount
    };
  }

  async function initialize() {
    try {
      const metadata = await verifyStoredPack();
      updateState({
        initialized: true,
        ready: Boolean(metadata),
        completedSurahs: metadata ? expectedSurahCount : 0,
        metadata,
        error: ''
      });
    } catch (error) {
      updateState({
        initialized: true,
        ready: false,
        completedSurahs: 0,
        metadata: null,
        error: error.message || 'Data offline belum dapat digunakan.'
      });
    }
    return publicState();
  }

  function ensureInitialized() {
    if (!initializationPromise) initializationPromise = initialize();
    return initializationPromise;
  }

  async function fetchSurah(number) {
    const response = await fetch(`${apiBaseUrl}/${number}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Surah ${number} gagal diunduh.`);
    const payload = await response.json();
    return normalizeSurahData(payload?.data, number);
  }

  async function storePack(records, metadata) {
    const database = await openDatabase();
    const transaction = database.transaction([surahStoreName, metadataStoreName], 'readwrite');
    const done = transactionDone(transaction);
    const surahStore = transaction.objectStore(surahStoreName);
    const metadataStore = transaction.objectStore(metadataStoreName);
    surahStore.clear();
    metadataStore.clear();
    records.forEach((record) => surahStore.put(record));
    metadataStore.put({ key: activeMetadataKey, ...metadata });
    await done;
  }

  async function download() {
    await ensureInitialized();
    if (state.downloading) return publicState();

    updateState({
      downloading: true,
      completedSurahs: 0,
      error: ''
    });

    try {
      const records = new Array(expectedSurahCount);
      let cursor = 0;
      let completed = 0;
      const workerCount = 4;

      async function worker() {
        while (cursor < expectedSurahCount) {
          const index = cursor;
          cursor += 1;
          records[index] = await fetchSurah(index + 1);
          completed += 1;
          updateState({ completedSurahs: completed });
        }
      }

      await Promise.all(Array.from({ length: workerCount }, () => worker()));
      const normalized = validatePack(records);
      const serialized = JSON.stringify(normalized);
      const checksum = await checksumText(serialized);
      const metadata = {
        version: packVersion,
        downloadedAt: new Date().toISOString(),
        bytes: typeof TextEncoder === 'function'
          ? new TextEncoder().encode(serialized).byteLength
          : serialized.length,
        checksum,
        surahCount: expectedSurahCount,
        ayahCount: expectedAyahCount,
        source: 'equran.id API v2'
      };

      await storePack(normalized, metadata);
      updateState({
        initialized: true,
        ready: true,
        downloading: false,
        completedSurahs: expectedSurahCount,
        metadata,
        error: ''
      });
      return publicState();
    } catch (error) {
      updateState({
        downloading: false,
        completedSurahs: state.ready ? expectedSurahCount : 0,
        error: error.message || 'Data Al-Quran offline gagal diunduh.'
      });
      throw error;
    }
  }

  async function remove() {
    await ensureInitialized();
    const database = await openDatabase();
    const transaction = database.transaction([surahStoreName, metadataStoreName], 'readwrite');
    const done = transactionDone(transaction);
    transaction.objectStore(surahStoreName).clear();
    transaction.objectStore(metadataStoreName).clear();
    await done;
    updateState({
      initialized: true,
      ready: false,
      downloading: false,
      completedSurahs: 0,
      metadata: null,
      error: ''
    });
    return publicState();
  }

  async function getSurah(number) {
    await ensureInitialized();
    if (!state.ready) return null;

    const safeNumber = Math.max(1, Math.min(expectedSurahCount, Number(number) || 1));
    const database = await openDatabase();
    const transaction = database.transaction(surahStoreName, 'readonly');
    const done = transactionDone(transaction);
    const record = await requestResult(transaction.objectStore(surahStoreName).get(safeNumber));
    await done;
    return record ? normalizeSurahData(record, safeNumber) : null;
  }

  async function getCatalog() {
    await ensureInitialized();
    if (!state.ready) return null;

    const database = await openDatabase();
    const transaction = database.transaction(surahStoreName, 'readonly');
    const done = transactionDone(transaction);
    const records = await requestResult(transaction.objectStore(surahStoreName).getAll());
    await done;
    const normalized = validatePack(records);
    return normalized.map((record) => ({
      nomor: record.nomor,
      nama: record.nama,
      namaLatin: record.namaLatin,
      jumlahAyat: record.jumlahAyat,
      tempatTurun: record.tempatTurun,
      arti: record.arti
    }));
  }

  window.IqroOfflineQuran = Object.freeze({
    getState: publicState,
    initialize: ensureInitialized,
    download,
    remove,
    getSurah,
    getCatalog,
    expectedSurahCount,
    expectedAyahCount
  });

  void ensureInitialized();
})();
