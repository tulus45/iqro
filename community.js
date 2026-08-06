const iqroSessionStorageKey = 'iqro_session_token';
const iqroAppStateCacheKey = 'iqro_cached_app_state_v1';
const iqroPlayStoreUrl = 'https://play.google.com/store/apps/details?id=com.example.iqro';
const quranDisplayStorageKey = 'iqro_quran_display_preferences';
const quranDisplayDefaults = Object.freeze({
  font: 'lpmq',
  size: 'normal',
  spacing: 'normal'
});
const quranDisplayAllowedValues = Object.freeze({
  font: ['lpmq', 'scheherazade', 'madinah'],
  size: ['small', 'normal', 'large'],
  spacing: ['normal', 'relaxed']
});
const quranSettingsPreviewText = 'وَاِذْ قَالَ رَبُّكَ لِلْمَلٰۤىِٕكَةِ اِنِّيْ جَاعِلٌ فِى الْاَرْضِ خَلِيْفَةً ۗ قَالُوْٓا اَتَجْعَلُ فِيْهَا مَنْ يُّفْسِدُ فِيْهَا وَيَسْفِكُ الدِّمَاۤءَۚ وَنَحْنُ نُسَبِّحُ بِحَمْدِكَ وَنُقَدِّسُ لَكَ ۗ قَالَ اِنِّيْٓ اَعْلَمُ مَا لَا تَعْلَمُوْنَ';
const quranMadinahSettingsPreviewText = 'وَإِذۡ قَالَ رَبُّكَ لِلۡمَلَٰٓئِكَةِ إِنِّي جَاعِلٞ فِي ٱلۡأَرۡضِ خَلِيفَةٗۖ قَالُوٓاْ أَتَجۡعَلُ فِيهَا مَن يُفۡسِدُ فِيهَا وَيَسۡفِكُ ٱلدِّمَآءَ وَنَحۡنُ نُسَبِّحُ بِحَمۡدِكَ وَنُقَدِّسُ لَكَۖ قَالَ إِنِّيٓ أَعۡلَمُ مَا لَا تَعۡلَمُونَ';
const kfgqpcHafsAssetUrl = 'assets/quran/kfgqpc-hafs-v2.0.json';
let kfgqpcHafsDataPromise = null;

function stripKfgqpcAyahMarker(value) {
  return String(value || '').replace(/[\u00A0 ]*[\uFC00-\uFD1D]$/u, '');
}

async function loadKfgqpcHafsData() {
  if (!kfgqpcHafsDataPromise) {
    kfgqpcHafsDataPromise = fetch(kfgqpcHafsAssetUrl)
      .then((response) => {
        if (!response.ok) throw new Error('kfgqpc-data-unavailable');
        return response.json();
      })
      .then((payload) => {
        if (
          payload?.metadata?.ayahCount !== 6236
          || payload?.metadata?.surahCount !== 114
          || !Array.isArray(payload?.surahs)
          || payload.surahs.length !== 114
        ) {
          throw new Error('kfgqpc-data-invalid');
        }
        return payload;
      })
      .catch((error) => {
        kfgqpcHafsDataPromise = null;
        throw error;
      });
  }
  return kfgqpcHafsDataPromise;
}

async function getKfgqpcHafsSurah(surahNumber) {
  const payload = await loadKfgqpcHafsData();
  const surah = payload.surahs[Number(surahNumber) - 1];
  if (!Array.isArray(surah) || !surah.length) throw new Error('kfgqpc-surah-invalid');
  return surah;
}

function sanitizeQuranDisplayPreferences(value) {
  const source = value && typeof value === 'object' ? value : {};
  return Object.fromEntries(
    Object.entries(quranDisplayDefaults).map(([key, fallback]) => {
      const candidate = String(source[key] || '');
      return [key, quranDisplayAllowedValues[key].includes(candidate) ? candidate : fallback];
    })
  );
}

function readQuranDisplayPreferences() {
  try {
    return sanitizeQuranDisplayPreferences(JSON.parse(window.localStorage.getItem(quranDisplayStorageKey) || '{}'));
  } catch (error) {
    return { ...quranDisplayDefaults };
  }
}

let quranDisplayPreferences = readQuranDisplayPreferences();

function applyQuranDisplayPreferences(preferences = quranDisplayPreferences) {
  const next = sanitizeQuranDisplayPreferences(preferences);
  const root = document.documentElement;
  root.dataset.quranFont = next.font;
  root.dataset.quranSize = next.size;
  root.dataset.quranSpacing = next.spacing;
  quranDisplayPreferences = next;
}

function saveQuranDisplayPreferences(next) {
  quranDisplayPreferences = sanitizeQuranDisplayPreferences(next);
  window.localStorage.setItem(quranDisplayStorageKey, JSON.stringify(quranDisplayPreferences));
  applyQuranDisplayPreferences();
}

function updateQuranDisplayPreference(key, value) {
  if (!Object.prototype.hasOwnProperty.call(quranDisplayDefaults, key)) return;
  saveQuranDisplayPreferences({ ...quranDisplayPreferences, [key]: value });
  renderSettingsPage();
}

function resetQuranDisplayPreferences() {
  saveQuranDisplayPreferences(quranDisplayDefaults);
  renderSettingsPage();
}

applyQuranDisplayPreferences();

const communityState = {
  token: window.localStorage.getItem(iqroSessionStorageKey) || '',
  me: null,
  friends: [],
  incomingFriendRequests: [],
  outgoingFriendRequests: [],
  groups: [],
  communityTab: 'contacts',
  communityAction: '',
  selectedGroupId: '',
  addingMemberGroupId: '',
  selectedGroupContactPhone: '',
  groupContactPickerOpen: false,
  removingGroupMemberId: '',
  groupMemberMenuId: '',
  deletingGroupId: '',
  installSuggestionPhone: '',
  memorialDraft: null,
  offlineDeleteConfirm: false,
  settingsSection: 'menu',
  authMode: 'login',
  offlineSession: false,
  loading: false,
  message: '',
  tone: 'info',
  messageTimer: null
};

const communityApiBaseUrl = resolveCommunityApiBaseUrl();

function resolveCommunityApiBaseUrl() {
  const explicit = String(window.IQRO_API_BASE_URL || '').trim();
  if (explicit) {
    return explicit.replace(/\/+$/, '');
  }

  const host = window.location.hostname;
  if (host === '127.0.0.1' || host === 'localhost') {
    return 'http://127.0.0.1:4720/api';
  }

  return `${window.location.origin.replace(/\/+$/, '')}/api`;
}

function formatPercentSafe(value) {
  return typeof formatPercent === 'function' ? formatPercent(value) : `${Number(value).toFixed(1)}%`;
}

function computeSnapshotSummary(snapshot) {
  if (!snapshot) return null;

  const counts = Array.isArray(surahAyatCounts) && surahAyatCounts.length === 114
    ? surahAyatCounts
    : new Array(114).fill(1);
  const surah = Math.max(1, Math.min(114, Number(snapshot.surah) || 1));
  const currentAyatCount = counts[surah - 1] || Math.max(1, Number(snapshot.totalAyat) || 1);
  const ayat = Math.max(1, Math.min(currentAyatCount, Number(snapshot.ayat) || 1));
  const totalAyat = counts.reduce((sum, value) => sum + value, 0);
  const readAyat = counts.slice(0, surah - 1).reduce((sum, value) => sum + value, 0) + ayat;
  const percent = totalAyat > 0 ? (readAyat / totalAyat) * 100 : 0;

  return {
    currentAyatCount,
    totalAyat,
    readAyat,
    percent
  };
}

function extractProgressSnapshot(progress) {
  if (!progress || typeof progress !== 'object') return null;
  const surah = Math.max(1, Math.min(114, Number(progress.surah) || 1));
  const totalAyat = Math.max(1, Number(progress.totalAyat) || surahAyatCounts[surah - 1] || 1);
  return {
    surah,
    ayat: Math.max(1, Math.min(totalAyat, Number(progress.ayat) || 1)),
    nama: String(progress.nama || surahList[surah - 1] || `Surah ${surah}`),
    totalAyat,
    updatedAt: progress.updatedAt || ''
  };
}

function getLocalProgressSnapshot() {
  try {
    const saved = window.localStorage.getItem(progressStorageKey);
    if (!saved) return null;

    const parsed = JSON.parse(saved);
    if (!parsed || typeof parsed !== 'object') return null;
    return extractProgressSnapshot(parsed);
  } catch (error) {
    return null;
  }
}

function getProgressTimestamp(snapshot) {
  const parsed = Date.parse(snapshot?.updatedAt || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function writeProgressSnapshot(snapshot) {
  if (!snapshot) return null;

  const nextSnapshot = {
    surah: Math.max(1, Math.min(114, Number(snapshot.surah) || 1)),
    ayat: Math.max(1, Number(snapshot.ayat) || 1),
    nama: String(snapshot.nama || 'Al-Fatihah'),
    totalAyat: Math.max(1, Number(snapshot.totalAyat) || 1),
    updatedAt: snapshot.updatedAt || new Date().toISOString()
  };

  hasSavedProgress = true;
  _0xData = { ...nextSnapshot };
  window.localStorage.setItem(progressStorageKey, JSON.stringify(nextSnapshot));
  return nextSnapshot;
}

function stampLocalProgressMetadata() {
  const existing = getLocalProgressSnapshot() || extractProgressSnapshot(_0xData);
  if (!existing) return null;
  return writeProgressSnapshot({
    ...existing,
    updatedAt: new Date().toISOString()
  });
}

function applyProgressSnapshot(snapshot) {
  const nextSnapshot = writeProgressSnapshot(snapshot);
  if (!nextSnapshot) return;
  _0xUpdateUI();
}

function storeSessionToken(token) {
  communityState.token = token || '';
  if (communityState.token) {
    window.localStorage.setItem(iqroSessionStorageKey, communityState.token);
  } else {
    window.localStorage.removeItem(iqroSessionStorageKey);
  }
  return Promise.resolve(window.IqroNative?.setSessionToken?.(communityState.token)).catch(() => undefined);
}

function clearSessionState(renderNow = true) {
  storeSessionToken('');
  window.localStorage.removeItem(iqroAppStateCacheKey);
  communityState.me = null;
  selectProgressAccount('');
  communityState.friends = [];
  communityState.incomingFriendRequests = [];
  communityState.outgoingFriendRequests = [];
  communityState.groups = [];
  communityState.communityTab = 'contacts';
  communityState.communityAction = '';
  communityState.selectedGroupId = '';
  communityState.addingMemberGroupId = '';
  communityState.selectedGroupContactPhone = '';
  communityState.groupContactPickerOpen = false;
  communityState.removingGroupMemberId = '';
  communityState.groupMemberMenuId = '';
  communityState.deletingGroupId = '';
  communityState.installSuggestionPhone = '';
  communityState.memorialDraft = null;
  communityState.settingsSection = 'menu';
  communityState.offlineSession = false;
  communityState.loading = false;
  window.syncUserManagementAccess?.();
  if (renderNow) {
    renderHomeCommunityBoard();
    renderCommunityPage();
  }
}

async function apiFetch(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set('Accept', 'application/json');

  if (options.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  if (communityState.token) {
    headers.set('Authorization', `Bearer ${communityState.token}`);
  }

  try {
    const response = await fetch(`${communityApiBaseUrl}${path}`, {
      method: options.method || 'GET',
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.message || `Request gagal (${response.status}).`);
      error.status = response.status;
      throw error;
    }

    return payload;
  } catch (error) {
    if (error instanceof Error && typeof error.status === 'number') {
      throw error;
    }

    const networkError = new Error('Koneksi internet atau server belum tersedia.');
    networkError.isNetworkError = true;
    throw networkError;
  }
}

function openWhatsAppDelivery(preopenedWindow, delivery) {
  const targetUrl = String(delivery?.appUrl || delivery?.url || '').trim();
  if (!targetUrl) {
    preopenedWindow?.close();
    return false;
  }

  if (preopenedWindow) {
    preopenedWindow.opener = null;
    preopenedWindow.location.href = targetUrl;
  } else {
    window.location.href = targetUrl;
  }
  return true;
}

function setCommunityMessage(message = '', tone = 'info', sticky = false) {
  if (communityState.messageTimer) {
    window.clearTimeout(communityState.messageTimer);
    communityState.messageTimer = null;
  }

  communityState.message = message;
  communityState.tone = tone;
  renderHomeCommunityBoard();
  renderCommunityPage();

  if (message && !sticky) {
    communityState.messageTimer = window.setTimeout(() => {
      communityState.message = '';
      renderHomeCommunityBoard();
      renderCommunityPage();
    }, 3200);
  }
}

function payloadRequiresPasswordChange(payload) {
  return payload?.requiresPasswordChange === true || payload?.user?.mustChangePassword === true;
}

function readCachedAppState() {
  try {
    const cached = JSON.parse(window.localStorage.getItem(iqroAppStateCacheKey) || 'null');
    if (!cached?.user?.id) return null;
    return cached;
  } catch (error) {
    return null;
  }
}

function cacheCurrentAppState() {
  if (!communityState.me?.id) return;
  try {
    window.localStorage.setItem(iqroAppStateCacheKey, JSON.stringify({
      user: communityState.me,
      friends: communityState.friends,
      incomingFriendRequests: communityState.incomingFriendRequests,
      outgoingFriendRequests: communityState.outgoingFriendRequests,
      groups: communityState.groups,
      cachedAt: new Date().toISOString()
    }));
  } catch (error) {
    // Kegagalan cache tidak boleh mengganggu sesi online.
  }
}

function applyAppState(payload, options = {}) {
  const nextUser = payload?.user ? { ...payload.user } : null;
  if (nextUser) {
    nextUser.mustChangePassword = payloadRequiresPasswordChange(payload);
  }
  communityState.me = nextUser;
  selectProgressAccount(communityState.me?.id || '');
  communityState.friends = Array.isArray(payload?.friends) ? payload.friends : [];
  communityState.incomingFriendRequests = Array.isArray(payload?.incomingFriendRequests) ? payload.incomingFriendRequests : [];
  communityState.outgoingFriendRequests = Array.isArray(payload?.outgoingFriendRequests) ? payload.outgoingFriendRequests : [];
  communityState.groups = Array.isArray(payload?.groups) ? payload.groups : [];
  communityState.offlineSession = options.offline === true;
  if (nextUser && options.persist !== false) cacheCurrentAppState();
  window.syncUserManagementAccess?.();
  renderHomeCommunityBoard();
  renderCommunityPage();
}

async function pushProgressToServer(snapshot, options = {}) {
  if (!communityState.token || !snapshot) return null;
  const payload = await apiFetch('/progress', {
    method: 'POST',
    body: {
      surah: snapshot.surah,
      ayat: snapshot.ayat,
      nama: snapshot.nama,
      totalAyat: snapshot.totalAyat,
      trackDaily: options.trackDaily === true
    }
  });
  applyAppState(payload);
  if (!options.quiet && payload.message) {
    setCommunityMessage(payload.message, 'success');
  }
  return payload;
}

async function reconcileProgressAfterAuth() {
  const localSnapshot = getLocalProgressSnapshot();
  const remoteSnapshot = extractProgressSnapshot(communityState.me?.progress);

  if (localSnapshot && (!remoteSnapshot || getProgressTimestamp(localSnapshot) > getProgressTimestamp(remoteSnapshot))) {
    await pushProgressToServer(localSnapshot, { quiet: true });
    return;
  }

  if (remoteSnapshot) {
    applyProgressSnapshot(remoteSnapshot);
    return;
  }

  if (localSnapshot) {
    applyProgressSnapshot(localSnapshot);
  }
}

function getSyncChipLabel() {
  if (communityState.loading) return 'Menyambungkan akun';
  if (communityState.offlineSession) return 'Mode offline';
  if (communityState.token && communityState.me) return 'Sinkron ke akun';
  return 'Masih lokal';
}

function getSyncChipTone() {
  if (communityState.offlineSession) return 'is-warning';
  if (communityState.token && communityState.me) return 'is-success';
  if (communityState.loading) return 'is-warning';
  return '';
}

function setHomeAuthMode(mode) {
  communityState.authMode = ['login', 'register', 'forgot'].includes(mode) ? mode : 'login';
  communityState.message = '';
  renderHomeCommunityBoard();
}

function toggleAuthPassword(button) {
  const control = button?.closest('.auth-password-control');
  const input = control?.querySelector('input');
  if (!input) return;

  const showPassword = input.type === 'password';
  input.type = showPassword ? 'text' : 'password';
  button.classList.toggle('is-visible', showPassword);
  button.setAttribute('aria-label', showPassword ? 'Sembunyikan password' : 'Tampilkan password');
  button.setAttribute('aria-pressed', String(showPassword));
  input.focus({ preventScroll: true });
}

function syncProtectedNavigation() {
  const authenticated = Boolean(communityState.token && communityState.me && !communityState.me.mustChangePassword);
  document.querySelectorAll('.site-nav .nav-chip').forEach((button) => {
    const isPublicHome = button.dataset.nav === 'home';
    if (!isPublicHome && button.dataset.nav !== 'manage-users') button.hidden = !authenticated;
  });

  const mobileTabBar = document.getElementById('mobileTabBar');
  if (mobileTabBar) mobileTabBar.hidden = !authenticated;
  if (!authenticated) closeMobileMenu();

  const dashboard = document.querySelector('.home-dashboard');
  if (dashboard) dashboard.hidden = !authenticated;

  if (!authenticated) {
    const activeProtectedPage = Object.entries(pages).some(([key, element]) => key !== 'home' && element?.classList.contains('is-active'));
    if (activeProtectedPage) setActivePage('home', 'home');
  }
}

function renderHomeCommunityBoard() {
  const gate = document.getElementById('homeAuthGate');
  const dailyCard = document.getElementById('homeDailyCard');
  const dailyReading = communityState.me?.dailyReading || {};
  const comparisonFallback = {
    current: Math.max(0, Number(dailyReading.ayatCount) || 0),
    previous: 0,
    difference: Math.max(0, Number(dailyReading.ayatCount) || 0)
  };
  const comparisonItems = [
    ['Day', dailyReading.comparisons?.day || comparisonFallback, 'hari ini', 'kemarin'],
    ['Week', dailyReading.comparisons?.week || { current: 0, previous: 0, difference: 0 }, 'minggu ini', 'minggu lalu'],
    ['Month', dailyReading.comparisons?.month || { current: 0, previous: 0, difference: 0 }, 'bulan ini', 'bulan lalu']
  ];
  comparisonItems.forEach(([key, comparison]) => {
    const row = document.getElementById(`home${key}Comparison`);
    const current = document.getElementById(`home${key}Current`);
    const previous = document.getElementById(`home${key}Previous`);
    const trend = document.getElementById(`home${key}Trend`);
    const currentValue = Math.max(0, Number(comparison?.current) || 0);
    const previousValue = Math.max(0, Number(comparison?.previous) || 0);
    const difference = currentValue - previousValue;
    if (current) current.textContent = formatNumberId(currentValue);
    if (previous) previous.textContent = formatNumberId(previousValue);
    if (trend) trend.textContent = difference > 0 ? `↑${formatNumberId(difference)}` : (difference < 0 ? `↓${formatNumberId(Math.abs(difference))}` : '—');
    if (row) {
      row.classList.toggle('is-up', difference > 0);
      row.classList.toggle('is-down', difference < 0);
      row.classList.toggle('is-even', difference === 0);
    }
  });
  if (dailyCard) {
    const ayatToday = Math.max(0, Number(dailyReading.ayatCount) || 0);
    dailyCard.classList.toggle('is-active', ayatToday > 0);
    dailyCard.setAttribute('aria-label', comparisonItems.map(([, comparison, currentLabel, previousLabel]) => (
      `${currentLabel} ${formatNumberId(Math.max(0, Number(comparison?.current) || 0))} ayat, ${previousLabel} ${formatNumberId(Math.max(0, Number(comparison?.previous) || 0))} ayat`
    )).join('. '));
  }
  syncProtectedNavigation();
  if (!gate) return;

  const hasSession = Boolean(communityState.token && communityState.me);
  const requiresPasswordChange = Boolean(hasSession && communityState.me.mustChangePassword);
  const authenticated = Boolean(hasSession && !requiresPasswordChange);
  const isLoginScreen = !authenticated && !requiresPasswordChange && communityState.authMode === 'login';
  const isRegisterScreen = !authenticated && !requiresPasswordChange && communityState.authMode === 'register';
  document.body.classList.toggle('is-login-screen', isLoginScreen);
  document.body.classList.toggle('is-register-screen', isRegisterScreen);
  document.body.classList.toggle('is-auth-entry-screen', isLoginScreen || isRegisterScreen);
  gate.hidden = authenticated;
  if (authenticated) return;

  const message = communityState.message
    ? `<div class="status-message auth-gate-message is-${escapeHtml(communityState.tone)}">${escapeHtml(communityState.message)}</div>`
    : '';

  if (requiresPasswordChange) {
    gate.innerHTML = `
      <div class="auth-gate-card auth-gate-card-password">
        <div class="auth-gate-intro">
          <div class="auth-gate-calligraphy" aria-hidden="true"><img src="quran.png" alt=""></div>
          <p class="section-kicker">Keamanan Akun</p>
          <h1 class="auth-gate-title">Buat password baru untuk melanjutkan.</h1>
          <p class="hero-copy">Anda masuk menggunakan password sementara dari WhatsApp. Seluruh fitur tetap terkunci sampai password baru dibuat.</p>
        </div>
        <div class="auth-gate-panel">
          <div>
            <p class="home-card-label">Password Wajib Diganti</p>
            <h2 class="community-section-title">Halo, ${escapeHtml(communityState.me.name)}</h2>
            <p class="home-card-copy">Gunakan password yang berbeda dari password sementara.</p>
          </div>
          ${message}
          <form class="community-form auth-gate-form" onsubmit="return submitRequiredPasswordChange(event)">
            <label class="community-field">
              <span>Password Baru</span>
              <input class="community-input" type="password" name="newPassword" placeholder="Minimal 6 karakter" autocomplete="new-password" minlength="6" required>
            </label>
            <label class="community-field">
              <span>Ulangi Password Baru</span>
              <input class="community-input" type="password" name="confirmPassword" placeholder="Ketik ulang password baru" autocomplete="new-password" minlength="6" required>
            </label>
            <button class="btn-compact btn-main auth-gate-submit" type="submit" ${communityState.loading ? 'disabled' : ''}>${communityState.loading ? 'Menyimpan...' : 'Simpan Password Baru'}</button>
          </form>
          <button class="auth-gate-logout" type="button" onclick="logoutCommunity()">Keluar dari akun</button>
        </div>
      </div>
    `;
    return;
  }

  const isRegister = communityState.authMode === 'register';
  const isForgot = communityState.authMode === 'forgot';
  const submitLabel = communityState.loading
    ? 'Mohon tunggu...'
    : (isRegister ? 'Kirim Permohonan' : (isForgot ? 'Kirim via WhatsApp' : 'Masuk'));
  const formHandler = isRegister ? 'submitPhoneRegister' : (isForgot ? 'submitForgotPassword' : 'submitPhoneLogin');
  const panelLabel = isRegister ? 'Buat Akun Baru' : (isForgot ? 'Pemulihan Akun' : 'Selamat Datang Kembali');
  const panelTitle = isRegister ? 'Buat Akun' : (isForgot ? 'Lupa password?' : 'Jejak Tilawah');

  gate.innerHTML = `
    <div class="auth-gate-card auth-gate-card-${isRegister ? 'register' : (isForgot ? 'forgot' : 'login')}">
      <div class="auth-gate-intro">
        <div class="auth-gate-calligraphy" aria-hidden="true"><img src="quran.png" alt=""></div>
        <p class="section-kicker">Ruang Tilawah Pribadi</p>
        <h1 class="auth-gate-title">Ayat demi Ayat,<br>Merajut Dekat.</h1>
        <p class="hero-copy">Progres tilawah Anda terukir sempurna di sini. Lanjutkan pencarian ridha-Nya kapan pun, di mana pun.</p>
        <p class="auth-gate-scope"><span>Al-Qur’an</span><span>Tahlil</span><span>Komunitas</span></p>
      </div>
      <div class="auth-gate-panel">
        <div class="auth-mode-tabs" role="tablist" aria-label="Pilih akses akun">
          <button class="auth-mode-button ${isRegister ? '' : 'is-active'}" type="button" onclick="setHomeAuthMode('login')">Masuk</button>
          <button class="auth-mode-button ${isRegister ? 'is-active' : ''}" type="button" onclick="setHomeAuthMode('register')">Buat akun</button>
        </div>
        <div class="auth-gate-panel-heading">
          <p class="home-card-label">${panelLabel}</p>
          <h2 class="community-section-title">${panelTitle}</h2>
          ${isRegister ? '' : `<p>${isForgot ? 'Masukkan nomor yang terdaftar, lalu kirim permintaan dari akun WhatsApp dengan nomor yang sama.' : 'Masukkan nomor HP dan password yang terdaftar.'}</p>`}
        </div>
        ${message}
        <form class="community-form auth-gate-form" onsubmit="return ${formHandler}(event)">
          ${isRegister ? `
            <label class="community-field">
              <span>Nama</span>
              <input class="community-input" type="text" name="name" placeholder="Nama tampilan Anda" autocomplete="name" required>
            </label>
          ` : ''}
          <label class="community-field">
            <span>Nomor HP</span>
            <input class="community-input" type="tel" name="phone" placeholder="08xxxxxxxxxx" autocomplete="tel" required>
          </label>
          ${isForgot ? '' : `
            <label class="community-field auth-password-field">
              <span>Password</span>
              <span class="auth-password-control">
                <input class="community-input" type="password" name="password" placeholder="${isRegister ? 'Minimal 6 karakter' : ''}" autocomplete="${isRegister ? 'new-password' : 'current-password'}" minlength="6" required>
                <button class="auth-password-toggle" type="button" onclick="toggleAuthPassword(this)" aria-label="Tampilkan password" aria-pressed="false">
                  <svg class="auth-password-icon auth-password-icon-hidden" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 4.3A10.7 10.7 0 0 1 12 4c5.4 0 9 5.2 9 5.2a15.2 15.2 0 0 1-2.2 2.7M6.6 6.6C4.4 8 3 10.2 3 10.2S6.6 16 12 16c1.2 0 2.3-.3 3.3-.7"/></svg>
                  <svg class="auth-password-icon auth-password-icon-visible" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12s3.6-6 9-6 9 6 9 6-3.6 6-9 6-9-6-9-6Z"/><circle cx="12" cy="12" r="2.6"/></svg>
                </button>
              </span>
            </label>
          `}
          ${!isRegister && !isForgot ? '<div class="auth-password-meta"><span>Kata sandi minimal 6 karakter</span><button class="auth-forgot-password" type="button" onclick="setHomeAuthMode(\'forgot\')">Lupa password?</button></div>' : ''}
          ${isRegister ? `
            <label class="auth-reward-consent">
              <input type="checkbox" name="rewardConsent" value="accepted" required>
              <span>
                <strong>Akad Kebaikan</strong>
                Dengan membuat akun, saya mengamini semoga setiap ayat yang saya baca melalui Iqro turut menjadi aliran pahala bagi pemilik aplikasi—tanpa mengurangi pahala saya sedikit pun. Aamiin.
              </span>
            </label>
          ` : ''}
          ${isForgot ? `
            <label class="auth-reward-consent auth-reset-consent">
              <input type="checkbox" name="senderPhoneConfirmed" value="confirmed" required>
              <span>
                <strong>Verifikasi Nomor WhatsApp</strong>
                Saya akan mengirim permintaan menggunakan akun WhatsApp dengan nomor yang sama seperti nomor akun yang ingin direset.
              </span>
            </label>
          ` : ''}
          <button class="btn-compact btn-main auth-gate-submit" type="submit" ${communityState.loading ? 'disabled' : ''}>${submitLabel}</button>
        </form>
        <p class="auth-gate-switch">${isForgot ? 'Sudah ingat password?' : (isRegister ? 'Sudah punya akun?' : 'Belum punya akun?')} <button type="button" onclick="setHomeAuthMode('${isForgot || isRegister ? 'login' : 'register'}')">${isForgot || isRegister ? 'Masuk' : 'Daftar di sini'}</button></p>
      </div>
    </div>
  `;
}

function renderCommunityFlash() {
  const flash = document.getElementById('communityFlash');
  if (!flash) return;

  if (!communityState.message) {
    flash.hidden = true;
    flash.textContent = '';
    flash.className = 'status-message community-flash';
    return;
  }

  flash.hidden = false;
  flash.textContent = communityState.message;
  flash.className = `status-message community-flash is-${communityState.tone}`;
}

function renderHeroStatus() {
  const heroStatus = document.getElementById('communityHeroStatus');
  const heroMeta = document.getElementById('communityHeroMeta');
  if (!heroStatus || !heroMeta) return;

  if (communityState.loading) {
    heroStatus.textContent = 'Menyambungkan akun';
    heroMeta.textContent = 'Menyiapkan data teman, group, dan sinkronisasi progress.';
    return;
  }

  if (!communityState.me) {
    heroStatus.textContent = 'Belum login';
    heroMeta.textContent = 'Masuk dengan nomor HP dan password untuk menyimpan progress ke akun dan membagikannya ke teman atau keluarga.';
    return;
  }

  const summary = communityState.me.progress?.summary;
  const metaParts = [communityState.me.phoneDisplay, `${communityState.friends.length} teman`, `${communityState.groups.length} group`];
  if (summary) {
    metaParts.push(`${formatPercentSafe(summary.percent)} progress`);
  }

  heroStatus.textContent = `Akun ${communityState.me.name}`;
  heroMeta.textContent = metaParts.join(' � ');
}

function renderAuthPanel() {
  const panel = document.getElementById('communityAuthPanel');
  if (!panel) return;

  const localSnapshot = getLocalProgressSnapshot();
  const localSummary = computeSnapshotSummary(localSnapshot);

  if (!communityState.me) {
    panel.innerHTML = `
      <section class="community-sidebar-card">
        <p class="home-card-label">Login Nomor HP &amp; Password</p>
        <h3 class="community-section-title">Masuk atau daftar cepat</h3>
        <p class="home-card-copy">Gunakan akun yang sudah aktif. Jika lupa password, kirim permintaan reset melalui WhatsApp agar dapat diverifikasi pemilik.</p>
        <form class="community-form" onsubmit="return submitPhoneLogin(event)">
          <label class="community-field">
            <span>Nomor HP</span>
            <input class="community-input" type="tel" name="phone" placeholder="08xxxxxxxxxx" required>
          </label>
          <label class="community-field">
            <span>Password</span>
            <input class="community-input" type="password" name="password" placeholder="Minimal 6 karakter" required>
          </label>
          <label class="community-field">
            <span>Nama Tampilan</span>
            <input class="community-input" type="text" name="name" placeholder="Contoh: Abi, Umi, Kakak Aisyah">
          </label>
          <button class="btn-compact btn-main" type="submit">Masuk / Buat Akun</button>
        </form>
      </section>
      <section class="community-sidebar-card community-sidebar-muted">
        <p class="home-card-label">Catatan</p>
        <p class="home-card-copy">Teman yang bisa ditambahkan adalah nomor HP yang sudah pernah login minimal satu kali di aplikasi ini.</p>
        ${localSnapshot && localSummary ? `<p class="community-inline-note">Progress lokal siap dibawa ke akun: ${escapeHtml(localSnapshot.nama)} ayat ${localSnapshot.ayat} � ${escapeHtml(formatPercentSafe(localSummary.percent))}</p>` : ''}
      </section>
    `;
    return;
  }

  panel.innerHTML = `
    <section class="community-sidebar-card">
      <p class="home-card-label">Tambah Teman</p>
      <form class="community-form" onsubmit="return submitAddFriend(event)">
        <label class="community-field">
          <span>Nomor HP Teman</span>
          <input class="community-input" type="tel" name="phone" placeholder="08xxxxxxxxxx" required>
        </label>
        <button class="btn-compact btn-main" type="submit">Tambah Teman</button>
      </form>
    </section>
    <section class="community-sidebar-card">
      <p class="home-card-label">Buat Group</p>
      <form class="community-form" onsubmit="return submitCreateGroup(event)">
        <label class="community-field">
          <span>Nama Group</span>
          <input class="community-input" type="text" name="name" placeholder="Contoh: Keluarga Besar H. Ahmad" required>
        </label>
        <button class="btn-compact btn-main" type="submit">Buat Group</button>
      </form>
    </section>
  `;
}

function getProgressCaption(progress) {
  if (progress?.summary && progress.nama && progress.ayat) {
    return `${progress.nama} ayat ${progress.ayat} dari ${progress.summary.currentAyatCount} (${formatPercentSafe(progress.summary.percent)})`;
  }
  if (progress?.summary) return `Progress tilawah ${formatPercentSafe(progress.summary.percent)}`;
  if (!progress?.summary) {
    return 'Belum ada progress tilawah tersimpan.';
  }

  return `${progress.nama} ayat ${progress.ayat} dari ${progress.summary.currentAyatCount} � ${formatPercentSafe(progress.summary.percent)}`;
}

function renderFriendsPanel() {
  const counter = document.getElementById('communityFriendCount');
  const panel = document.getElementById('communityFriendsPanel');
  if (!counter || !panel) return;

  counter.textContent = `${communityState.friends.length} orang`;

  if (!communityState.me) {
    panel.innerHTML = '<div class="community-empty">Login dulu supaya daftar teman dan progress mereka bisa tampil di sini.</div>';
    return;
  }

  if (!communityState.friends.length) {
    panel.innerHTML = '<div class="community-empty">Belum ada teman. Tambahkan nomor HP teman yang sudah pernah login di Iqro.</div>';
    return;
  }

  panel.innerHTML = `
    <div class="community-card-list">
      ${communityState.friends.map((friend) => `
        <article class="community-card">
          <div class="community-card-head">
            <div>
              <h3>${escapeHtml(friend.name)}</h3>
              <p>${escapeHtml(friend.phoneDisplay)}</p>
            </div>
            <span class="community-badge">${friend.progress?.summary ? escapeHtml(formatPercentSafe(friend.progress.summary.percent)) : 'Belum mulai'}</span>
          </div>
          <p class="community-card-copy">${escapeHtml(getProgressCaption(friend.progress))}</p>
        </article>
      `).join('')}
    </div>
  `;
}

function renderGroupsPanel() {
  const counter = document.getElementById('communityGroupCount');
  const panel = document.getElementById('communityGroupsPanel');
  if (!counter || !panel) return;

  counter.textContent = `${communityState.groups.length} group`;

  if (!communityState.me) {
    panel.innerHTML = '<div class="community-empty">Masuk dengan nomor HP untuk mulai membuat group keluarga.</div>';
    return;
  }

  if (!communityState.groups.length) {
    panel.innerHTML = '<div class="community-empty">Belum ada group. Buat satu group keluarga agar progress tilawah setiap anggota mudah dipantau.</div>';
    return;
  }

  panel.innerHTML = `
    <div class="community-card-list">
      ${communityState.groups.map((group) => `
        <article class="community-card community-group-card">
          <div class="community-card-head">
            <div>
              <h3>${escapeHtml(group.name)}</h3>
              <p>${group.memberCount} anggota</p>
            </div>
            <span class="community-badge">${group.averagePercent != null ? escapeHtml(formatPercentSafe(group.averagePercent)) : 'Menunggu'}</span>
          </div>
          <p class="community-card-copy">${group.averagePercent != null ? `Rata-rata progress group ${formatPercentSafe(group.averagePercent)}.` : 'Belum ada progress anggota yang tersimpan.'}</p>
          <div class="community-member-list">
            ${group.members.map((member) => `
              <div class="community-member-row">
                <div>
                  <strong>${escapeHtml(member.name)}</strong>
                  <p>${escapeHtml(member.phoneDisplay)}${member.isOwner ? ' � admin group' : ''}</p>
                </div>
                <span>${member.progress?.summary ? escapeHtml(formatPercentSafe(member.progress.summary.percent)) : 'Belum mulai'}</span>
              </div>
            `).join('')}
          </div>
          <form class="community-inline-form" onsubmit="return submitAddMember(event)">
            <input type="hidden" name="groupId" value="${escapeHtml(group.id)}">
            <label class="community-field community-inline-field">
              <span>Tambah anggota lewat nomor HP</span>
              <input class="community-input" type="tel" name="phone" placeholder="08xxxxxxxxxx" required>
            </label>
            <button class="btn-compact btn-main" type="submit">Masukkan ke Group</button>
          </form>
        </article>
      `).join('')}
    </div>
  `;
}

function getCommunityInitial(name) {
  return Array.from(String(name || '?').trim())[0]?.toUpperCase() || '?';
}

function setCommunityTab(tab) {
  communityState.communityTab = tab === 'groups' ? 'groups' : 'contacts';
  communityState.communityAction = '';
  communityState.selectedGroupId = '';
  communityState.addingMemberGroupId = '';
  communityState.selectedGroupContactPhone = '';
  communityState.groupContactPickerOpen = false;
  communityState.removingGroupMemberId = '';
  communityState.groupMemberMenuId = '';
  communityState.deletingGroupId = '';
  communityState.installSuggestionPhone = '';
  renderCommunityPage();
}

function toggleCommunityAction(action) {
  const expectedAction = action === 'group' ? 'group' : 'friend';
  communityState.communityAction = communityState.communityAction === expectedAction ? '' : expectedAction;
  if (communityState.communityAction) communityState.selectedGroupId = '';
  communityState.installSuggestionPhone = '';
  renderCommunityPage();
}

function closeCommunityAction() {
  communityState.communityAction = '';
  communityState.installSuggestionPhone = '';
  renderCommunityPage();
}

function openAddFriendAction() {
  communityState.communityTab = 'contacts';
  communityState.communityAction = 'friend';
  communityState.installSuggestionPhone = '';
  renderCommunityPage();
}

function openContactsTab() {
  setCommunityTab('contacts');
}

function openGroupsTab() {
  setCommunityTab('groups');
}

function togglePrimaryCommunityAction() {
  if (communityState.selectedGroupId) {
    if (communityState.addingMemberGroupId === communityState.selectedGroupId) {
      closeAddMemberForm();
    } else {
      openAddMemberForm(communityState.selectedGroupId);
    }
    return;
  }

  toggleCommunityAction(communityState.communityTab === 'groups' ? 'group' : 'friend');
}

function getInstallSuggestionWhatsappUrl(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  const whatsappPhone = digits.startsWith('0')
    ? `62${digits.slice(1)}`
    : (digits.startsWith('8') ? `62${digits}` : digits);
  const message = `Assalamu'alaikum. Yuk install aplikasi Iqro agar kita bisa saling memantau progress tilawah. Download di Play Store: ${iqroPlayStoreUrl}`;
  return `https://wa.me/${whatsappPhone}?text=${encodeURIComponent(message)}`;
}

function renderAddFriendIcon() {
  return `
    <svg viewBox='0 0 24 24' aria-hidden='true'>
      <path d='M15 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2'></path>
      <circle cx='8.5' cy='7' r='4'></circle>
      <path d='M19 8v6M16 11h6'></path>
    </svg>
  `;
}

function renderAddGroupIcon() {
  return `
    <svg viewBox='0 0 24 24' aria-hidden='true'>
      <circle cx='8' cy='8.5' r='3.25'></circle>
      <circle cx='16.5' cy='9.5' r='2.75'></circle>
      <path d='M2.5 19a5.5 5.5 0 0 1 11 0'></path>
      <path d='M13.5 15a4.8 4.8 0 0 1 8 4'></path>
    </svg>
  `;
}

function renderRemoveMemberIcon() {
  return `
    <svg viewBox='0 0 24 24' aria-hidden='true'>
      <circle cx='9' cy='7' r='3.5'></circle>
      <path d='M3 20a6 6 0 0 1 12 0'></path>
      <path d='M16.5 11.5h5'></path>
    </svg>
  `;
}

function renderCancelIcon() {
  return `
    <svg viewBox='0 0 24 24' aria-hidden='true'>
      <path d='m7 7 10 10M17 7 7 17'></path>
    </svg>
  `;
}

function renderWhatsappIcon() {
  return `
    <svg viewBox='0 0 24 24' aria-hidden='true'>
      <path d='M20.5 11.8a8.5 8.5 0 0 1-12.6 7.4L3 20.5l1.3-4.7a8.5 8.5 0 1 1 16.2-4z'></path>
      <path d='M8.1 7.8c.2-.4.4-.4.7-.4h.5c.2 0 .4.1.5.4l.8 1.9c.1.3 0 .5-.1.7l-.6.8c-.2.2-.1.4 0 .6.7 1.2 1.6 2.1 2.8 2.7.2.1.4.1.6-.1l.9-1.1c.2-.2.4-.3.7-.2l1.8.9c.3.1.5.2.5.4 0 .2-.1 1.2-.6 1.7-.5.6-1.3.9-2.1.9-.7 0-1.7-.2-3.4-.9-2.9-1.3-4.8-4.4-5-4.6-.1-.2-1.2-1.6-1.2-3.1 0-1.4.7-2.2 1.2-2.6z'></path>
    </svg>
  `;
}

function renderInstallSuggestion() {
  if (!communityState.installSuggestionPhone) return '';
  const whatsappUrl = getInstallSuggestionWhatsappUrl(communityState.installSuggestionPhone);
  return `
    <div class='community-install-suggestion' role='status'>
      <div class='community-install-suggestion-copy'>
        <strong>Kawanmu belum terdaftar. Ajak dia raih pahala tilawah bersama!</strong>
        <p>Rekomendasikan Iqra via whatsapps</p>
      </div>
      <div class='community-install-suggestion-actions'>
        <a class='community-whatsapp-invite' href='${escapeHtml(whatsappUrl)}' target='_blank' rel='noopener noreferrer' aria-label='Rekomendasikan Iqra via whatsapps' title='Rekomendasikan Iqra via whatsapps'>${renderWhatsappIcon()}</a>
      </div>
    </div>
  `;
}

function renderFriendComposer() {
  return `
    <section class='community-composer' aria-label='Tambah teman'>
      <div class='community-composer-head'>
        <div>
          <p class='section-kicker'>Kontak Baru</p>
          <h2>Kirim Permintaan</h2>
        </div>
        <button class='community-icon-button' type='button' onclick='closeCommunityAction()' aria-label='Tutup tambah teman'>&times;</button>
      </div>
      <form class='community-form community-friend-form' onsubmit='return submitAddFriend(event)'>
        <label class='community-field'>
          <span>Nomor HP Teman</span>
          <input class='community-input' type='tel' name='phone' value='${escapeHtml(communityState.installSuggestionPhone)}' placeholder='08xxxxxxxxxx' autocomplete='tel' required autofocus>
        </label>
        <button class='btn-compact btn-main' type='submit' ${communityState.loading ? 'disabled' : ''}>${communityState.loading ? 'Mengirim...' : 'Kirim Permintaan'}</button>
      </form>
      ${renderInstallSuggestion()}
    </section>
  `;
}

function renderEmptyGroupComposer() {
  return `
    <section class='community-composer community-composer-empty' aria-label='Buat group'>
      <div class='community-composer-head'>
        <div><p class='section-kicker'>Group Baru</p><h2>Pilih kontak lebih dulu</h2></div>
        <button class='community-icon-button' type='button' onclick='closeCommunityAction()' aria-label='Tutup buat group'>&times;</button>
      </div>
      <p>Tambahkan minimal satu teman sebelum membuat group.</p>
      <button class='btn-compact btn-main' type='button' onclick='openAddFriendAction()'>Tambah Teman</button>
    </section>
  `;
}

function renderGroupComposer() {
  if (!communityState.friends.length) return renderEmptyGroupComposer();
  return `
    <section class='community-composer' aria-label='Buat group'>
      <div class='community-composer-head'>
        <div><p class='section-kicker'>Group Baru</p><h2>Buat Group</h2></div>
        <button class='community-icon-button' type='button' onclick='closeCommunityAction()' aria-label='Tutup buat group'>&times;</button>
      </div>
      <form class='community-form' onsubmit='return submitCreateGroup(event)'>
        <label class='community-field'>
          <span>Nama Group</span>
          <input class='community-input' type='text' name='name' placeholder='Contoh: Keluarga Besar' maxlength='80' required autofocus>
        </label>
        <fieldset class='community-picker-fieldset'>
          <legend>Pilih Kontak</legend>
          <div class='community-contact-picker'>
            ${communityState.friends.map((friend) => `
              <label class='community-picker-row'>
                <span class='community-avatar'>${escapeHtml(getCommunityInitial(friend.name))}</span>
                <span class='community-picker-copy'><strong>${escapeHtml(friend.name)}</strong><small>${escapeHtml(friend.phoneDisplay)}</small></span>
                <input type='checkbox' name='memberIds' value='${escapeHtml(friend.id)}' aria-label='Pilih ${escapeHtml(friend.name)}'>
              </label>
            `).join('')}
          </div>
        </fieldset>
        <div class='community-composer-actions'>
          <button class='btn-compact home-secondary-btn' type='button' onclick='closeCommunityAction()'>Batal</button>
          <button class='btn-compact btn-main' type='submit' ${communityState.loading ? 'disabled' : ''}>${communityState.loading ? 'Membuat...' : 'Buat Group'}</button>
        </div>
      </form>
    </section>
  `;
}

function renderCommunityComposer() {
  if (communityState.communityAction === 'friend') return renderFriendComposer();
  if (communityState.communityAction === 'group') return renderGroupComposer();
  return '';
}

function renderFriendRequestPanels() {
  const incoming = communityState.incomingFriendRequests;
  const outgoing = communityState.outgoingFriendRequests;
  if (!incoming.length && !outgoing.length) return '';

  return `
    <div class='community-request-stack'>
      ${incoming.length ? `
        <section class='community-request-panel' aria-label='Permintaan pertemanan masuk'>
          <div class='community-request-heading'>
            <div><p class='section-kicker'>Permintaan Masuk</p><h3>${incoming.length} sahabat menunggu jawaban</h3></div>
          </div>
          ${incoming.map((request) => `
            <article class='community-request-row'>
              <span class='community-avatar'>${escapeHtml(getCommunityInitial(request.user?.name))}</span>
              <div class='community-request-copy'>
                <strong>${escapeHtml(request.user?.name || 'Sahabat Iqro')}</strong>
                <span>${escapeHtml(request.user?.phoneDisplay || '')}</span>
              </div>
              <div class='community-request-actions'>
                <button class='btn-compact community-button-secondary' type='button' onclick='respondFriendRequest("${escapeHtml(request.id)}", "decline")' ${communityState.loading ? 'disabled' : ''}>Tolak</button>
                <button class='btn-compact btn-main' type='button' onclick='respondFriendRequest("${escapeHtml(request.id)}", "accept")' ${communityState.loading ? 'disabled' : ''}>Terima</button>
              </div>
            </article>
          `).join('')}
        </section>
      ` : ''}
      ${outgoing.length ? `
        <section class='community-request-panel is-outgoing' aria-label='Permintaan pertemanan terkirim'>
          <div class='community-request-heading'>
            <div><p class='section-kicker'>Menunggu Persetujuan</p><h3>${outgoing.length} permintaan terkirim</h3></div>
          </div>
          ${outgoing.map((request) => `
            <article class='community-request-row'>
              <span class='community-avatar'>${escapeHtml(getCommunityInitial(request.user?.name))}</span>
              <div class='community-request-copy'>
                <strong>${escapeHtml(request.user?.name || 'Sahabat Iqro')}</strong>
                <span>${escapeHtml(request.user?.phoneDisplay || '')}</span>
              </div>
              <span class='community-request-status'>Menunggu</span>
            </article>
          `).join('')}
        </section>
      ` : ''}
    </div>
  `;
}

function renderCommunityPeriodStat(label, comparison) {
  const currentValue = Math.max(0, Number(comparison?.current) || 0);
  const previousValue = Math.max(0, Number(comparison?.previous) || 0);
  const difference = currentValue - previousValue;
  const trendClass = difference > 0 ? 'is-up' : (difference < 0 ? 'is-down' : 'is-even');
  const trendText = difference > 0
    ? `&uarr;${formatNumberId(difference)}`
    : (difference < 0 ? `&darr;${formatNumberId(Math.abs(difference))}` : '0');
  const trendDescription = difference > 0
    ? `${formatNumberId(difference)} ayat lebih banyak dari periode sebelumnya`
    : (difference < 0
      ? `${formatNumberId(Math.abs(difference))} ayat lebih sedikit dari periode sebelumnya`
      : 'Sama dengan periode sebelumnya');
  return `
    <span class='community-period-stat' aria-label='${label} ${formatNumberId(currentValue)} ayat. ${trendDescription}.'>
      <span class='community-period-label'>${label}</span>
      <strong>${formatNumberId(currentValue)}</strong>
      <span class='community-period-trend ${trendClass}' title='${trendDescription}'>${trendText}</span>
    </span>
  `;
}

function renderContactDirectory() {
  const requestPanels = renderFriendRequestPanels();
  if (!communityState.friends.length) {
    return `${requestPanels}<div class=community-empty>Belum ada teman yang disetujui. Kirim permintaan menggunakan nomor HP teman.</div>`;
  }

  const readingRank = (friend) => [
    Number(friend.dailyReading?.comparisons?.day?.current ?? friend.dailyReading?.totals?.today ?? 0),
    Number(friend.dailyReading?.comparisons?.week?.current ?? friend.dailyReading?.totals?.week ?? 0),
    Number(friend.dailyReading?.comparisons?.month?.current ?? friend.dailyReading?.totals?.currentMonth ?? 0)
  ];
  const sortedFriends = [...communityState.friends].sort((left, right) => {
    const leftRank = readingRank(left);
    const rightRank = readingRank(right);
    for (let index = 0; index < leftRank.length; index += 1) {
      const difference = rightRank[index] - leftRank[index];
      if (difference) return difference;
    }
    return String(left.name || '').localeCompare(String(right.name || ''), 'id-ID');
  });

  return `
    ${requestPanels}
    <div class='community-contact-list community-activity-list'>
      ${sortedFriends.map((friend) => {
        const totals = friend.dailyReading?.totals;
        const comparisons = friend.dailyReading?.comparisons;
        const dayComparison = comparisons?.day || { current: totals?.today || 0, previous: 0 };
        const weekComparison = comparisons?.week || { current: totals?.week || 0, previous: 0 };
        const monthComparison = comparisons?.month || { current: totals?.currentMonth || 0, previous: 0 };
        const ayatToday = Math.max(0, Number(dayComparison.current) || 0);
        const hasReadToday = ayatToday > 0;
        const progressPercent = Math.max(0, Math.min(100, Number(friend.progress?.summary?.percent) || 0));
        const progressLabel = formatPercentSafe(progressPercent);
        return `
        <article class='community-contact-row community-activity-row${hasReadToday ? ' is-active-today' : ''}'>
          <span class='community-avatar'>${escapeHtml(getCommunityInitial(friend.name))}</span>
          <div class='community-contact-body'>
            <div class='community-contact-heading'>
              <h3>${escapeHtml(friend.name)}</h3>
            </div>
            <div class='community-contact-meta'>
              <span>${escapeHtml(friend.phoneDisplay)}</span>
            </div>
          </div>
          <div class='community-khatam-progress' aria-label='Progres khatam ${escapeHtml(friend.name)} ${escapeHtml(progressLabel)}'>
            <span><small>Progres khatam</small><strong>${escapeHtml(progressLabel)}</strong></span>
            <span class='community-khatam-track' aria-hidden='true'><i style='width: ${progressPercent}%'></i></span>
          </div>
          ${totals ? `
            <div class='community-period-stats' aria-label='Statistik tilawah ${escapeHtml(friend.name)}'>
              ${renderCommunityPeriodStat('Hari ini', dayComparison)}
              ${renderCommunityPeriodStat('Minggu ini', weekComparison)}
              ${renderCommunityPeriodStat('Bulan ini', monthComparison)}
            </div>
          ` : `<div class='community-private-stat'><strong>Privat</strong><span>Belum dibagikan</span></div>`}
        </article>
      `;
      }).join('')}
    </div>
  `;
}

function renderGroupDirectory() {
  if (!communityState.groups.length) {
    return '<div class=community-empty>Belum ada group. Gunakan tombol Buat Group untuk memilih anggota dari kontak Anda.</div>';
  }

  const selectedGroup = communityState.groups.find((group) => group.id === communityState.selectedGroupId);
  if (selectedGroup) return renderGroupDetail(selectedGroup);

  return `
    <div class='community-contact-list'>
      ${communityState.groups.map((group) => {
        const memberNames = group.members.map((member) => member.name).join(', ');
        return `
          <article class='community-contact-row community-group-row'>
            <span class='community-avatar is-group'>${escapeHtml(getCommunityInitial(group.name))}</span>
            <div class='community-contact-body'>
              <div class='community-contact-heading'>
                <button class='community-group-name' type='button' onclick='openGroupDetail("${escapeHtml(group.id)}")'>${escapeHtml(group.name)}</button>
                <span>${group.averagePercent != null ? escapeHtml(formatPercentSafe(group.averagePercent)) : 'Menunggu'}</span>
              </div>
              <p>${group.memberCount} anggota · ${escapeHtml(memberNames)}</p>
            </div>
          </article>
        `;
      }).join('')}
    </div>
  `;
}

function getGroupAdminUserIds(group) {
  return new Set([
    group?.ownerUserId,
    ...(Array.isArray(group?.adminUserIds) ? group.adminUserIds : [])
  ].filter(Boolean));
}

function isCurrentUserGroupAdmin(group) {
  return getGroupAdminUserIds(group).has(communityState.me?.id);
}

function renderGroupDetail(group) {
  const memberIds = new Set(group.members.map((member) => member.id));
  const availableFriends = communityState.friends.filter((friend) => !memberIds.has(friend.id));
  const isAddingMember = communityState.addingMemberGroupId === group.id;
  const adminUserIds = getGroupAdminUserIds(group);
  const isGroupOwner = group.ownerUserId === communityState.me?.id;
  const isGroupAdmin = adminUserIds.has(communityState.me?.id);
  const isDeletingGroup = communityState.deletingGroupId === group.id;
  const selectedFriend = availableFriends.find((friend) => friend.phone === communityState.selectedGroupContactPhone);
  return `
    <section class='community-group-detail'>
      <header class='community-group-detail-head'>
        <button class='community-group-back' type='button' onclick='closeGroupDetail()' aria-label='Kembali ke daftar group'>&larr;</button>
        <div>
          <p class='section-kicker'>Detail Group</p>
          <h2>${escapeHtml(group.name)}</h2>
        </div>
        ${isGroupOwner ? (isDeletingGroup ? `
          <div class='community-group-delete-confirm'>
            <span>Hapus group?</span>
            <button class='btn-compact community-button-secondary' type='button' onclick='cancelDeleteGroup()'>Batal</button>
            <button class='btn-compact community-danger-button' type='button' onclick='deleteGroup("${escapeHtml(group.id)}")' ${communityState.loading ? 'disabled' : ''}>Hapus</button>
          </div>
        ` : `<button class='btn-compact community-group-delete-button' type='button' onclick='requestDeleteGroup("${escapeHtml(group.id)}")' aria-label='Hapus group ${escapeHtml(group.name)}' title='Hapus group'>
          <svg viewBox='0 0 24 24' aria-hidden='true'><path d='M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5'/></svg>
        </button>`) : ''}
      </header>
      <div class='community-group-summary'>
        <span><strong>${group.memberCount}</strong> anggota</span>
        <span>Rata-rata progress <strong>${group.averagePercent != null ? escapeHtml(formatPercentSafe(group.averagePercent)) : 'belum tersedia'}</strong></span>
      </div>
      ${isGroupAdmin && availableFriends.length && isAddingMember ? `
        <form class='community-inline-form community-group-add-member' onsubmit='return submitAddMember(event)'>
          <input type='hidden' name='groupId' value='${escapeHtml(group.id)}'>
          <div class='community-field community-inline-field'>
            <span>Pilih Kontak</span>
            <input type='hidden' name='phone' value='${escapeHtml(selectedFriend?.phone || '')}'>
            <div class='community-contact-select${communityState.groupContactPickerOpen ? ' is-open' : ''}'>
              <button class='community-contact-select-trigger' type='button' onclick='toggleGroupContactPicker()' aria-haspopup='listbox' aria-expanded='${communityState.groupContactPickerOpen}'>
                ${selectedFriend ? `
                  <span class='community-avatar'>${escapeHtml(getCommunityInitial(selectedFriend.name))}</span>
                  <span class='community-contact-select-copy'><strong>${escapeHtml(selectedFriend.name)}</strong><small>${escapeHtml(selectedFriend.phoneDisplay)}</small></span>
                ` : `<span class='community-contact-select-placeholder'>Pilih kontak yang akan ditambahkan</span>`}
                <svg viewBox='0 0 24 24' aria-hidden='true'><path d='m7 9 5 5 5-5'/></svg>
              </button>
              ${communityState.groupContactPickerOpen ? `
                <div class='community-contact-select-menu' role='listbox' aria-label='Pilih kontak group'>
                  ${availableFriends.map((friend) => `
                    <button class='community-contact-select-option${friend.phone === selectedFriend?.phone ? ' is-selected' : ''}' type='button' role='option' aria-selected='${friend.phone === selectedFriend?.phone}' onclick='selectGroupContact("${escapeHtml(friend.phone)}")'>
                      <span class='community-avatar'>${escapeHtml(getCommunityInitial(friend.name))}</span>
                      <span class='community-contact-select-copy'><strong>${escapeHtml(friend.name)}</strong><small>${escapeHtml(friend.phoneDisplay)}</small></span>
                      <span class='community-contact-select-check' aria-hidden='true'>✓</span>
                    </button>
                  `).join('')}
                </div>
              ` : ''}
            </div>
          </div>
          <div class='community-group-add-member-actions'>
            <button class='btn-compact community-button-secondary' type='button' onclick='closeAddMemberForm()' ${communityState.loading ? 'disabled' : ''}>Batal</button>
            <button class='btn-compact btn-main' type='submit' ${communityState.loading || !selectedFriend ? 'disabled' : ''}>Tambah</button>
          </div>
        </form>
      ` : ''}
      <div class='community-member-list community-group-member-list'>
        ${group.members.map((member) => {
          const totals = member.dailyReading?.totals;
          const comparisons = member.dailyReading?.comparisons;
          const dayComparison = comparisons?.day || { current: totals?.today || 0, previous: 0 };
          const weekComparison = comparisons?.week || { current: totals?.week || 0, previous: 0 };
          const monthComparison = comparisons?.month || { current: totals?.currentMonth || 0, previous: 0 };
          const ayatToday = Math.max(0, Number(dayComparison.current) || 0);
          const progressPercent = Math.max(0, Math.min(100, Number(member.progress?.summary?.percent) || 0));
          const progressLabel = formatPercentSafe(progressPercent);
          const memberIsOwner = member.id === group.ownerUserId;
          const memberIsAdmin = adminUserIds.has(member.id);
          const canPromoteMember = isGroupOwner && !memberIsAdmin;
          const canRemoveMember = isGroupAdmin && !memberIsOwner && (isGroupOwner || !memberIsAdmin);
          const canManageMember = canPromoteMember || canRemoveMember;
          const isMenuOpen = communityState.groupMemberMenuId === member.id;
          const isRemoving = communityState.removingGroupMemberId === member.id;
          return `
            <article class='community-contact-row community-activity-row community-group-activity-row${ayatToday > 0 ? ' is-active-today' : ''}${isMenuOpen ? ' is-menu-open' : ''}'>
              <span class='community-avatar'>${escapeHtml(getCommunityInitial(member.name))}</span>
              <div class='community-contact-body'>
                <div class='community-contact-heading'>
                  <h3>${escapeHtml(member.name)}</h3>
                  ${memberIsOwner ? `<span class='community-role-badge is-owner'>Pemilik</span>` : (memberIsAdmin ? `<span class='community-role-badge'>Admin</span>` : '')}
                </div>
                <div class='community-contact-meta'>
                  <span>${escapeHtml(member.phoneDisplay)}</span>
                </div>
              </div>
              <div class='community-khatam-progress' aria-label='Progres khatam ${escapeHtml(member.name)} ${escapeHtml(progressLabel)}'>
                <span><small>Progres khatam</small><strong>${escapeHtml(progressLabel)}</strong></span>
                <span class='community-khatam-track' aria-hidden='true'><i style='width: ${progressPercent}%'></i></span>
              </div>
              ${totals ? `
                <div class='community-period-stats' aria-label='Statistik tilawah ${escapeHtml(member.name)}'>
                  ${renderCommunityPeriodStat('Hari ini', dayComparison)}
                  ${renderCommunityPeriodStat('Minggu ini', weekComparison)}
                  ${renderCommunityPeriodStat('Bulan ini', monthComparison)}
                </div>
              ` : `<div class='community-private-stat'><strong>Belum ada data</strong><span>Aktivitas belum tersimpan</span></div>`}
              ${canManageMember ? `
                <div class='community-member-menu'>
                  <button class='community-member-menu-trigger' type='button' onclick='toggleGroupMemberMenu("${escapeHtml(member.id)}")' aria-label='Menu anggota ${escapeHtml(member.name)}' aria-expanded='${isMenuOpen}'>&#8942;</button>
                  ${isMenuOpen ? `
                    <div class='community-member-menu-panel'>
                      ${isRemoving ? `
                        <p>Keluarkan ${escapeHtml(member.name)}?</p>
                        <div class='community-member-menu-confirm'>
                          <button type='button' onclick='cancelRemoveGroupMember()'>Batal</button>
                          <button class='is-danger' type='button' onclick='removeGroupMember("${escapeHtml(group.id)}", "${escapeHtml(member.id)}")' ${communityState.loading ? 'disabled' : ''}>Keluarkan</button>
                        </div>
                      ` : `
                        ${canPromoteMember ? `<button type='button' onclick='promoteGroupMember("${escapeHtml(group.id)}", "${escapeHtml(member.id)}")'>Jadikan admin</button>` : ''}
                        ${canRemoveMember ? `<button class='is-danger' type='button' onclick='requestRemoveGroupMember("${escapeHtml(member.id)}")'>Keluarkan dari group</button>` : ''}
                      `}
                    </div>
                  ` : ''}
                </div>
              ` : `<span class='community-member-menu-spacer' aria-hidden='true'></span>`}
            </article>
          `;
        }).join('')}
      </div>
    </section>
  `;
}

function openGroupDetail(groupId) {
  if (!communityState.groups.some((group) => group.id === groupId)) return;
  communityState.selectedGroupId = groupId;
  communityState.addingMemberGroupId = '';
  communityState.selectedGroupContactPhone = '';
  communityState.groupContactPickerOpen = false;
  communityState.removingGroupMemberId = '';
  communityState.groupMemberMenuId = '';
  communityState.deletingGroupId = '';
  communityState.communityAction = '';
  renderCommunityPage();
}

function closeGroupDetail() {
  communityState.selectedGroupId = '';
  communityState.addingMemberGroupId = '';
  communityState.selectedGroupContactPhone = '';
  communityState.groupContactPickerOpen = false;
  communityState.removingGroupMemberId = '';
  communityState.groupMemberMenuId = '';
  communityState.deletingGroupId = '';
  renderCommunityPage();
}

function openAddMemberForm(groupId) {
  if (communityState.selectedGroupId !== groupId) return;
  const group = communityState.groups.find((item) => item.id === groupId);
  if (!group || !isCurrentUserGroupAdmin(group)) return;
  communityState.addingMemberGroupId = groupId;
  communityState.selectedGroupContactPhone = '';
  communityState.groupContactPickerOpen = false;
  communityState.removingGroupMemberId = '';
  renderCommunityPage();
}

function closeAddMemberForm() {
  communityState.addingMemberGroupId = '';
  communityState.selectedGroupContactPhone = '';
  communityState.groupContactPickerOpen = false;
  renderCommunityPage();
}

function toggleGroupContactPicker() {
  if (!communityState.addingMemberGroupId) return;
  communityState.groupContactPickerOpen = !communityState.groupContactPickerOpen;
  renderCommunityPage();
}

function selectGroupContact(phone) {
  const selectedGroup = communityState.groups.find((group) => group.id === communityState.selectedGroupId);
  if (!selectedGroup || !isCurrentUserGroupAdmin(selectedGroup)) return;
  const memberIds = new Set(selectedGroup.members.map((member) => member.id));
  const friend = communityState.friends.find((item) => item.phone === phone && !memberIds.has(item.id));
  if (!friend) return;
  communityState.selectedGroupContactPhone = friend.phone;
  communityState.groupContactPickerOpen = false;
  renderCommunityPage();
}

function requestRemoveGroupMember(memberId) {
  const selectedGroup = communityState.groups.find((group) => group.id === communityState.selectedGroupId);
  if (!selectedGroup || !isCurrentUserGroupAdmin(selectedGroup) || memberId === selectedGroup.ownerUserId) return;
  const adminUserIds = getGroupAdminUserIds(selectedGroup);
  const isGroupOwner = selectedGroup.ownerUserId === communityState.me?.id;
  if (!isGroupOwner && adminUserIds.has(memberId)) return;
  communityState.removingGroupMemberId = memberId;
  communityState.groupMemberMenuId = memberId;
  communityState.groupContactPickerOpen = false;
  renderCommunityPage();
}

function cancelRemoveGroupMember() {
  communityState.removingGroupMemberId = '';
  renderCommunityPage();
}

function toggleGroupMemberMenu(memberId) {
  communityState.groupMemberMenuId = communityState.groupMemberMenuId === memberId ? '' : memberId;
  communityState.removingGroupMemberId = '';
  communityState.groupContactPickerOpen = false;
  renderCommunityPage();
}

function requestDeleteGroup(groupId) {
  const group = communityState.groups.find((item) => item.id === groupId);
  if (!group || group.ownerUserId !== communityState.me?.id) return;
  communityState.deletingGroupId = groupId;
  communityState.groupMemberMenuId = '';
  communityState.removingGroupMemberId = '';
  renderCommunityPage();
}

function cancelDeleteGroup() {
  communityState.deletingGroupId = '';
  renderCommunityPage();
}

function renderCommunityDirectory() {
  const directory = document.getElementById('communityDirectory');
  if (!directory) return;
  if (!communityState.me) {
    directory.innerHTML = '<div class=community-empty>Masuk ke akun untuk membuka daftar kontak dan group.</div>';
    return;
  }

  const isContacts = communityState.communityTab !== 'groups';
  const selectedGroup = isContacts
    ? null
    : communityState.groups.find((group) => group.id === communityState.selectedGroupId);
  const selectedGroupMemberIds = new Set(selectedGroup?.members.map((member) => member.id) || []);
  const isSelectedGroupAdmin = selectedGroup ? isCurrentUserGroupAdmin(selectedGroup) : false;
  const canAddGroupMember = selectedGroup && isSelectedGroupAdmin
    ? communityState.friends.some((friend) => !selectedGroupMemberIds.has(friend.id))
    : false;
  const primaryActionLabel = selectedGroup
    ? (canAddGroupMember ? 'Tambah Anggota' : 'Semua kontak sudah menjadi anggota')
    : (isContacts ? 'Tambah Teman' : 'Buat Group');
  const primaryActionClass = ' is-icon-only';
  const primaryActionContent = selectedGroup
    ? renderAddFriendIcon()
    : (isContacts ? renderAddFriendIcon() : renderAddGroupIcon());
  const shouldShowPrimaryAction = !selectedGroup || (isSelectedGroupAdmin && canAddGroupMember);
  const directoryContent = communityState.communityAction === 'friend'
    ? ''
    : `<div class='community-directory-content' role='tabpanel'>${isContacts ? renderContactDirectory() : renderGroupDirectory()}</div>`;
  directory.innerHTML = `
    <div class='community-directory-toolbar'>
      <div class='community-tabs' role='tablist' aria-label='Daftar Ashabut Tilawah'>
        <button class='community-tab ${isContacts ? 'is-active' : ''}' type='button' role='tab' aria-selected='${isContacts}' onclick='openContactsTab()'>Kontak <span>${communityState.friends.length}</span></button>
        <button class='community-tab ${!isContacts ? 'is-active' : ''}' type='button' role='tab' aria-selected='${!isContacts}' onclick='openGroupsTab()'>Group <span>${communityState.groups.length}</span></button>
      </div>
      ${shouldShowPrimaryAction ? `<button class='btn-compact btn-main community-primary-action${primaryActionClass}' type='button' onclick='togglePrimaryCommunityAction()' aria-label='${primaryActionLabel}' title='${primaryActionLabel}'>${primaryActionContent}</button>` : ''}
    </div>
    ${renderCommunityComposer()}
    ${directoryContent}
  `;
}

function renderSettingsFlash() {
  const flash = document.getElementById('settingsFlash');
  if (!flash) return;

  if (!communityState.message) {
    flash.hidden = true;
    flash.textContent = '';
    flash.className = 'status-message community-flash';
    return;
  }

  flash.hidden = false;
  flash.textContent = communityState.message;
  flash.className = `status-message community-flash is-${communityState.tone}`;
}

const maxMemorialNames = 20;
const maxMemorialNameLength = 80;

function getMemorialNames() {
  return Array.isArray(communityState.me?.memorialNames)
    ? communityState.me.memorialNames.map((name) => String(name || '').trim()).filter(Boolean)
    : [];
}

function parseMemorialNames(value) {
  return String(value || '')
    .split(/\r?\n/)
    .map((name) => name.trim().replace(/\s+/g, ' '))
    .filter(Boolean);
}

function getMemorialDraftValue() {
  return communityState.memorialDraft ?? getMemorialNames().join('\n');
}

function renderQuranPreferenceButton(group, value, label) {
  const selected = quranDisplayPreferences[group] === value;
  return `
    <button
      class="quran-choice-button${selected ? ' is-selected' : ''}"
      type="button"
      aria-pressed="${selected}"
      onclick="updateQuranDisplayPreference('${group}', '${value}')"
    >${label}</button>
  `;
}

function renderQuranDisplaySettings() {
  const isMadinah = quranDisplayPreferences.font === 'madinah';
  const previewText = isMadinah ? quranMadinahSettingsPreviewText : quranSettingsPreviewText;
  const preview = isMadinah
    ? escapeHtml(previewText)
    : (typeof renderQuranArabic === 'function' ? renderQuranArabic(previewText) : escapeHtml(previewText));
  const fontLabel = {
    lpmq: 'Mushaf Indonesia',
    scheherazade: 'Naskhi Jelas',
    madinah: 'Mushaf Madinah'
  }[quranDisplayPreferences.font] || 'Mushaf Indonesia';

  return `
    <section class="community-sidebar-card settings-account-card settings-quran-card">
      <div class="settings-quran-heading">
        <div class="settings-quran-heading-copy">
          <p class="home-card-label">Tampilan Al-Qur'an</p>
          <h2 class="community-section-title">Pilih Gaya Mushaf</h2>
        </div>
        <button class="settings-reset-button" type="button" onclick="resetQuranDisplayPreferences()">Atur Ulang</button>
      </div>

      <div class="quran-font-options" role="radiogroup" aria-label="Gaya huruf Al-Qur'an">
        <label class="quran-font-option${quranDisplayPreferences.font === 'lpmq' ? ' is-selected' : ''}">
          <input type="radio" name="quranFont" value="lpmq" ${quranDisplayPreferences.font === 'lpmq' ? 'checked' : ''} onchange="updateQuranDisplayPreference('font', this.value)">
          <span class="quran-font-option-title">
            <span>Mushaf Indonesia</span>
            <span class="quran-font-option-check" aria-hidden="true">✓</span>
          </span>
          <span class="quran-font-option-meta">LPMQ Isep Misbah · standar Kemenag</span>
          <span class="quran-font-option-sample is-lpmq" lang="ar">قَالُوا جَاعِلٌ لِلْمَلَائِكَةِ</span>
        </label>
        <label class="quran-font-option${quranDisplayPreferences.font === 'scheherazade' ? ' is-selected' : ''}">
          <input type="radio" name="quranFont" value="scheherazade" ${quranDisplayPreferences.font === 'scheherazade' ? 'checked' : ''} onchange="updateQuranDisplayPreference('font', this.value)">
          <span class="quran-font-option-title">
            <span>Naskhi Jelas</span>
            <span class="quran-font-option-check" aria-hidden="true">✓</span>
          </span>
          <span class="quran-font-option-meta">Scheherazade New · bentuk lebih lapang</span>
          <span class="quran-font-option-sample is-scheherazade" lang="ar">قَالُوا جَاعِلٌ لِلْمَلَائِكَةِ</span>
        </label>
        <label class="quran-font-option${quranDisplayPreferences.font === 'madinah' ? ' is-selected' : ''}">
          <input type="radio" name="quranFont" value="madinah" ${quranDisplayPreferences.font === 'madinah' ? 'checked' : ''} onchange="updateQuranDisplayPreference('font', this.value)">
          <span class="quran-font-option-title">
            <span>Mushaf Madinah</span>
            <span class="quran-font-option-check" aria-hidden="true">✓</span>
          </span>
          <span class="quran-font-option-meta">KFGQPC Hafs V22 · teks Utsmani khusus</span>
          <span class="quran-font-option-sample is-madinah" lang="ar">قَالُوٓاْ جَاعِلٞ لِلۡمَلَٰٓئِكَةِ</span>
        </label>
      </div>

      <div class="quran-display-controls">
        <div class="quran-display-control">
          <span class="quran-display-control-label">Ukuran Huruf</span>
          <div class="quran-choice-group" role="group" aria-label="Ukuran huruf Al-Qur'an">
            ${renderQuranPreferenceButton('size', 'small', 'Kecil')}
            ${renderQuranPreferenceButton('size', 'normal', 'Normal')}
            ${renderQuranPreferenceButton('size', 'large', 'Besar')}
          </div>
        </div>
        <div class="quran-display-control">
          <span class="quran-display-control-label">Jarak Baris</span>
          <div class="quran-choice-group" role="group" aria-label="Jarak baris Al-Qur'an">
            ${renderQuranPreferenceButton('spacing', 'normal', 'Normal')}
            ${renderQuranPreferenceButton('spacing', 'relaxed', 'Lebih Lega')}
          </div>
        </div>
      </div>

      <div class="quran-preview" aria-live="polite">
        <div class="quran-preview-label">
          <span>Pratinjau Al-Baqarah ayat 30</span>
          <span>${fontLabel}</span>
        </div>
        <p class="ayah-arab" lang="ar">${preview}</p>
      </div>
      <p class="quran-display-note">Pilihan disimpan di perangkat ini. Mode Mushaf Madinah memakai pasangan font dan teks Utsmani KFGQPC khusus pada bacaan Al-Qur'an; bacaan Tahlil tetap memakai Mushaf Indonesia.</p>
    </section>
  `;
}

function formatOfflineQuranBytes(value) {
  const bytes = Math.max(0, Number(value) || 0);
  if (!bytes) return '-';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

function formatOfflineQuranDate(value) {
  const date = new Date(value || '');
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  }).format(date);
}

function getOfflineQuranState() {
  return window.IqroOfflineQuran?.getState?.() || {
    initialized: false,
    ready: false,
    downloading: false,
    completedSurahs: 0,
    totalSurahs: 114,
    error: '',
    metadata: null
  };
}

function renderOfflineQuranSettings() {
  const offlineState = getOfflineQuranState();
  const total = Math.max(114, Number(offlineState.totalSurahs) || 114);
  const completed = Math.max(0, Math.min(total, Number(offlineState.completedSurahs) || 0));
  const progress = Math.round((completed / total) * 100);
  const isReady = offlineState.ready;
  const isDownloading = offlineState.downloading;
  const metadata = offlineState.metadata || {};
  const statusLabel = isDownloading
    ? (isReady ? 'Memperbarui data' : 'Sedang mengunduh')
    : isReady ? 'Siap offline' : 'Belum diunduh';
  const title = isDownloading
    ? `Menyimpan ${completed} dari ${total} surah`
    : isReady ? 'Al-Qur&#39;an tersedia tanpa internet' : 'Simpan Al-Qur&#39;an di perangkat';
  const description = isReady
    ? 'Teks Arab, Latin, dan terjemahan Indonesia telah tersimpan dan akan dipakai lebih dahulu saat membaca.'
    : 'Unduh seluruh bacaan agar menu Al-Qur&#39;an tetap dapat digunakan saat tidak ada koneksi internet.';
  const errorHtml = offlineState.error
    ? `<div class='offline-quran-message is-danger' role='alert'>${escapeHtml(offlineState.error)}</div>`
    : '';
  const progressHtml = isDownloading
    ? `
      <div class='offline-quran-progress' role='progressbar' aria-valuemin='0' aria-valuemax='100' aria-valuenow='${progress}'>
        <span style='width: ${progress}%'></span>
      </div>
      <p class='offline-quran-progress-copy'>${progress}% selesai. Jangan tutup aplikasi sampai validasi selesai.</p>
    `
    : '';
  const deleteConfirmation = communityState.offlineDeleteConfirm && isReady
    ? `
      <div class='offline-quran-confirm' role='alert'>
        <p>Hapus data offline dari perangkat? Anda dapat mengunduhnya kembali kapan saja.</p>
        <div>
          <button class='btn-compact community-button-secondary' type='button' onclick='cancelRemoveOfflineQuranData()'>Batal</button>
          <button class='btn-compact offline-quran-delete-confirm' type='button' onclick='removeOfflineQuranData()'>Hapus Data</button>
        </div>
      </div>
    `
    : '';

  return `
    <section class='community-sidebar-card settings-account-card settings-detail-card offline-quran-card'>
      <div class='offline-quran-heading'>
        <span class='offline-quran-icon' aria-hidden='true'>
          <svg viewBox='0 0 24 24'><path d='M6 4.8c2.2 0 4.2.7 6 2.1 1.8-1.4 3.8-2.1 6-2.1v13.4c-2.2 0-4.2.7-6 2.1-1.8-1.4-3.8-2.1-6-2.1V4.8z'/><path d='M12 7v13.1'/></svg>
        </span>
        <div>
          <span class='offline-quran-status${isReady ? ' is-ready' : ''}${isDownloading ? ' is-downloading' : ''}'>${statusLabel}</span>
          <h2>${title}</h2>
          <p>${description}</p>
        </div>
      </div>

      ${progressHtml}
      ${errorHtml}

      <div class='offline-quran-stats'>
        <div><small>Surah</small><strong>${isReady ? metadata.surahCount || 114 : 114}</strong></div>
        <div><small>Ayat</small><strong>${isReady ? Number(metadata.ayahCount || 6236).toLocaleString('id-ID') : '6.236'}</strong></div>
        <div><small>Ukuran</small><strong>${isReady ? formatOfflineQuranBytes(metadata.bytes) : 'Dihitung setelah unduh'}</strong></div>
        <div><small>Diperbarui</small><strong>${isReady ? formatOfflineQuranDate(metadata.downloadedAt) : '-'}</strong></div>
      </div>

      <div class='offline-quran-actions'>
        <button class='btn-compact btn-main' type='button' onclick='downloadOfflineQuranData()' ${isDownloading ? 'disabled' : ''}>
          ${isDownloading ? 'Mengunduh...' : isReady ? 'Perbarui Data' : 'Unduh Semua Data'}
        </button>
        ${isReady && !isDownloading
          ? `<button class='btn-compact offline-quran-delete' type='button' onclick='requestRemoveOfflineQuranData()'>Hapus Data Offline</button>`
          : ''}
      </div>

      ${deleteConfirmation}
    </section>
  `;
}

async function downloadOfflineQuranData() {
  const offlineApi = window.IqroOfflineQuran;
  if (!offlineApi || getOfflineQuranState().downloading) return false;
  communityState.offlineDeleteConfirm = false;
  renderSettingsPage();
  try {
    await offlineApi.download();
  } catch (error) {
    // Pesan kegagalan disimpan dan ditampilkan oleh modul offline.
  }
  renderSettingsPage();
  return false;
}

function requestRemoveOfflineQuranData() {
  communityState.offlineDeleteConfirm = true;
  renderSettingsPage();
}

function cancelRemoveOfflineQuranData() {
  communityState.offlineDeleteConfirm = false;
  renderSettingsPage();
}

async function removeOfflineQuranData() {
  const offlineApi = window.IqroOfflineQuran;
  if (!offlineApi) return false;
  communityState.offlineDeleteConfirm = false;
  try {
    await offlineApi.remove();
  } catch (error) {
    // Status penyimpanan tetap dirender ulang untuk menampilkan kondisi terbaru.
  }
  renderSettingsPage();
  return false;
}

const settingsSections = ['quran', 'offline', 'profile', 'password', 'memorial'];

function openSettingsSection(section) {
  if (!settingsSections.includes(section)) return;
  communityState.settingsSection = section;
  renderSettingsPage();
}

function closeSettingsSection() {
  communityState.settingsSection = 'menu';
  renderSettingsPage();
}

function renderSettingsMenu() {
  const items = [
    {
      section: 'quran',
      kicker: 'Bacaan',
      title: "Tampilan Al-Qur'an",
      description: 'Gaya Mushaf, ukuran huruf, dan jarak baris.'
    },
    {
      section: 'offline',
      kicker: 'Penyimpanan',
      title: 'Al-Qur&#39;an Offline',
      description: window.IqroOfflineQuran?.getState?.().ready
        ? '114 surah siap dibaca tanpa internet.'
        : 'Simpan seluruh teks, Latin, dan terjemahan di perangkat.'
    },
    {
      section: 'profile',
      kicker: 'Akun',
      title: 'Nama Tampilan',
      description: 'Perbarui nama yang terlihat di aplikasi.'
    },
    {
      section: 'password',
      kicker: 'Keamanan',
      title: 'Ganti Password',
      description: 'Perbarui password akun Anda.'
    },
    {
      section: 'memorial',
      kicker: 'Tahlil',
      title: 'Nama Almarhum',
      description: 'Kelola nama yang disertakan dalam bacaan Tahlil.'
    }
  ];

  return `
    <section class="settings-menu-grid" aria-label="Daftar pengaturan">
      ${items.map((item) => `
        <button class="settings-menu-item" type="button" onclick="openSettingsSection('${item.section}')">
          <span class="settings-menu-copy">
            <span class="home-card-label">${item.kicker}</span>
            <strong>${item.title}</strong>
            <small>${item.description}</small>
          </span>
          <span class="settings-menu-arrow" aria-hidden="true">›</span>
        </button>
      `).join('')}
    </section>
  `;
}

function renderSettingsDetailHeader(title) {
  return `
    <div class="settings-detail-header">
      <button class="settings-detail-back" type="button" onclick="closeSettingsSection()" aria-label="Kembali ke daftar pengaturan">←</button>
      <div>
        <p class="home-card-label">Pengaturan</p>
        <h2>${title}</h2>
      </div>
    </div>
  `;
}

function renderSettingsPage() {
  const panel = document.getElementById('settingsAccountPanel');
  if (!panel) return;

  renderSettingsFlash();
  const section = settingsSections.includes(communityState.settingsSection)
    ? communityState.settingsSection
    : 'menu';

  if (section === 'menu') {
    panel.innerHTML = renderSettingsMenu();
    return;
  }

  if (!['quran', 'offline'].includes(section) && !communityState.me) {
    panel.innerHTML = `
      ${renderSettingsDetailHeader('Pengaturan Akun')}
      <div class="community-empty settings-detail-empty">Masuk ke akun untuk mengubah pengaturan ini.</div>
    `;
    return;
  }

  if (section === 'quran') {
    panel.innerHTML = `${renderSettingsDetailHeader("Tampilan Al-Qur'an")}${renderQuranDisplaySettings()}`;
    return;
  }

  if (section === 'offline') {
    panel.innerHTML = `${renderSettingsDetailHeader('Al-Qur&#39;an Offline')}${renderOfflineQuranSettings()}`;
    return;
  }

  if (section === 'profile') {
    panel.innerHTML = `
      ${renderSettingsDetailHeader('Nama Tampilan')}
      <section class="community-sidebar-card settings-account-card settings-detail-card">
        <form class="community-form" onsubmit="return submitProfileUpdate(event)">
          <label class="community-field">
            <span>Nama Tampilan</span>
            <input class="community-input" type="text" name="name" value="${escapeHtml(communityState.me.name)}" required>
          </label>
          <button class="btn-compact btn-main" type="submit" ${communityState.loading ? 'disabled' : ''}>Simpan Nama</button>
        </form>
      </section>
    `;
    return;
  }

  if (section === 'password') {
    panel.innerHTML = `
      ${renderSettingsDetailHeader('Ganti Password')}
      <section class="community-sidebar-card settings-account-card settings-detail-card">
        <form class="community-form" onsubmit="return submitPasswordUpdate(event)">
          <label class="community-field">
            <span>Password Lama</span>
            <input class="community-input" type="password" name="currentPassword" placeholder="Password saat ini" required>
          </label>
          <label class="community-field">
            <span>Password Baru</span>
            <input class="community-input" type="password" name="newPassword" placeholder="Minimal 6 karakter" required>
          </label>
          <button class="btn-compact btn-main" type="submit" ${communityState.loading ? 'disabled' : ''}>Perbarui Password</button>
        </form>
      </section>
    `;
    return;
  }

  panel.innerHTML = `
    ${renderSettingsDetailHeader('Nama untuk Tahlil')}
    <section class="community-sidebar-card settings-account-card settings-memorial-card settings-detail-card">
      <form class="settings-memorial-form" onsubmit="return submitMemorialNames(event)">
        <label class="community-field">
          <span>Daftar Nama <small>(satu nama per baris)</small></span>
          <textarea class="community-input settings-memorial-textarea" name="memorialNames" rows="7" placeholder="H. Ahmad bin Abdullah&#10;Siti Aminah binti Yusuf" oninput="updateMemorialNameCounter(this)" ${communityState.loading ? 'disabled' : ''}>${escapeHtml(getMemorialDraftValue())}</textarea>
        </label>
        <div class="settings-memorial-actions">
          <p id="settingsMemorialCount" class="settings-memorial-count">${parseMemorialNames(getMemorialDraftValue()).length} dari ${maxMemorialNames} nama</p>
          <button class="btn-compact btn-main" type="submit" ${communityState.loading ? 'disabled' : ''}>Simpan Daftar</button>
        </div>
      </form>
    </section>
  `;
}

function renderCommunityPage() {
  renderCommunityFlash();
  renderHeroStatus();
  renderCommunityDirectory();
  renderSettingsPage();
}

function injectCommunityUi() {
  const homePage = document.getElementById('homePage');
  if (homePage && !document.getElementById('homeAuthGate')) {
    const gate = document.createElement('section');
    gate.id = 'homeAuthGate';
    gate.className = 'home-auth-gate';
    gate.setAttribute('aria-label', 'Masuk atau daftar akun Iqro');
    homePage.insertBefore(gate, homePage.firstElementChild);
  }

  const nav = document.querySelector('.site-nav');
  if (nav && !nav.querySelector('[data-nav="community"]')) {
    const button = document.createElement('button');
    button.className = 'nav-chip';
    button.type = 'button';
    button.dataset.nav = 'community';
    button.textContent = 'Komunitas';
    button.addEventListener('click', openCommunity);
    nav.insertBefore(button, nav.lastElementChild);
  }
  if (nav && !nav.querySelector('[data-nav="settings"]')) {
    const button = document.createElement('button');
    button.className = 'nav-chip';
    button.type = 'button';
    button.dataset.nav = 'settings';
    button.textContent = 'Settings';
    button.addEventListener('click', openSettings);
    nav.appendChild(button);
  }
  if (nav && !nav.querySelector('[data-nav=logout]')) {
    const button = document.createElement('button');
    button.className = 'nav-chip nav-signout';
    button.type = 'button';
    button.dataset.nav = 'logout';
    button.textContent = 'Sign Out';
    button.setAttribute('aria-label', 'Keluar dari akun');
    button.addEventListener('click', logoutCommunity);
    nav.appendChild(button);
  }

  const main = document.querySelector('.site-main');
  if (main && !document.getElementById('communityPage')) {
    const section = document.createElement('section');
    section.id = 'communityPage';
    section.className = 'page page-community';
    section.setAttribute('aria-label', 'Komunitas tilawah');
    section.innerHTML = `
      <div class="community-shell">
        <div class="dashboard-hero community-hero">
          <div>
            <p class="section-kicker">Komunitas</p>
            <h1 class="main-title">
              <span class="title-logo">IQ</span>
              Ashabut Tilawah
            </h1>
          </div>
        </div>
        <div id="communityFlash" class="status-message community-flash" hidden></div>
        <div class="community-layout">
          <aside id="communityAuthPanel" class="community-sidebar"></aside>
          <div class="community-main-stack">
            <section class="community-panel">
              <div class="community-panel-header">
                <div>
                  <p class="section-kicker">Teman</p>
                  <h2 class="community-panel-title">Progress Sahabat</h2>
                </div>
                <span id="communityFriendCount" class="community-panel-count">0 orang</span>
              </div>
              <div id="communityFriendsPanel"></div>
            </section>
            <section class="community-panel">
              <div class="community-panel-header">
                <div>
                  <p class="section-kicker">Group</p>
                  <h2 class="community-panel-title">Group Keluarga</h2>
                </div>
                <span id="communityGroupCount" class="community-panel-count">0 group</span>
              </div>
              <div id="communityGroupsPanel"></div>
            </section>
          </div>
        </div>
        <section id='communityDirectory' class='community-panel community-directory'></section>
      </div>
    `;
    const mushafPage = document.getElementById('mushafPage');
    if (mushafPage) {
      main.insertBefore(section, mushafPage);
    } else {
      main.appendChild(section);
    }
    pages.community = section;
  }

  if (main && !document.getElementById('settingsPage')) {
    const section = document.createElement('section');
    section.id = 'settingsPage';
    section.className = 'page page-settings';
    section.setAttribute('aria-label', 'Settings akun');
    section.innerHTML = `
      <div class="community-shell settings-shell">
        <div class="dashboard-hero settings-hero">
          <div>
            <p class="section-kicker">Akun</p>
            <h1 class="main-title">
              <span class="title-logo">IQ</span>
              Pengaturan
            </h1>
          </div>
        </div>
        <div id="settingsFlash" class="status-message community-flash" hidden></div>
        <div id="settingsAccountPanel" class="settings-account-grid"></div>
      </div>
    `;
    const mushafPage = document.getElementById('mushafPage');
    if (mushafPage) {
      main.insertBefore(section, mushafPage);
    } else {
      main.appendChild(section);
    }
    pages.settings = section;
  }
}

function patchCoreIqroFunctions() {
  const originalSync = _0xSync;
  const originalUpdateUi = _0xUpdateUI;
  const originalSave = _0xSave;
  const originalSetActivePage = setActivePage;

  setActivePage = function protectedSetActivePage(pageKey, navKey = pageKey) {
    if ((!communityState.me || communityState.me.mustChangePassword) && pageKey !== 'home') {
      originalSetActivePage('home', 'home');
      renderHomeCommunityBoard();
      return;
    }
    originalSetActivePage(pageKey, navKey);
  };

  _0xSync = async function patchedIqroSync() {
    await originalSync();
    const snapshot = getLocalProgressSnapshot();
    if (snapshot?.updatedAt) {
      _0xData.updatedAt = snapshot.updatedAt;
    }
    renderHomeCommunityBoard();
    renderCommunityPage();
  };

  _0xUpdateUI = function patchedIqroUpdateUi() {
    originalUpdateUi();
    renderHomeCommunityBoard();
    renderCommunityPage();
  };

  _0xSave = async function patchedIqroSave(surah, ayat, nama, totalAyat) {
    await originalSave(surah, ayat, nama, totalAyat);
    const snapshot = stampLocalProgressMetadata();
    renderHomeCommunityBoard();
    renderCommunityPage();

    if (!communityState.token || communityState.me?.mustChangePassword || !snapshot) {
      return;
    }

    try {
      await pushProgressToServer(snapshot, { quiet: true, trackDaily: true });
      setCommunityMessage('Progress tilawah tersinkron ke akun dan komunitas.', 'success');
    } catch (error) {
      setCommunityMessage(error.message || 'Progress tetap tersimpan lokal, tetapi sinkronisasi akun belum berhasil.', 'warning', true);
    }
  };
}

async function restoreCommunitySession() {
  try {
    await window.iqroNativeReady;
    const nativeToken = await window.IqroNative?.getSessionToken?.();
    if (!communityState.token && nativeToken) {
      communityState.token = nativeToken;
      window.localStorage.setItem(iqroSessionStorageKey, nativeToken);
    }
  } catch (error) {
    // Penyimpanan native gagal tidak boleh menghalangi alur login web.
  }

  if (!communityState.token) {
    renderHomeCommunityBoard();
    renderCommunityPage();
    return;
  }

  const cachedState = readCachedAppState();
  if (cachedState) {
    applyAppState(cachedState, { persist: false, offline: true });
  }

  communityState.loading = true;
  renderHomeCommunityBoard();
  renderCommunityPage();

  try {
    const payload = await apiFetch('/me');
    applyAppState(payload);
    if (!communityState.me?.mustChangePassword) await reconcileProgressAfterAuth();
  } catch (error) {
    if (error.status === 401) {
      clearSessionState(false);
      setCommunityMessage('Sesi login sudah berakhir. Silakan masuk lagi dengan nomor HP dan password.', 'warning', true);
    } else if (communityState.me) {
      communityState.offlineSession = true;
      setCommunityMessage('Mode offline aktif. Bacaan dan progress lokal tetap dapat digunakan.', 'warning');
    } else {
      setCommunityMessage('Sambungkan internet sekali untuk memulihkan sesi akun di perangkat ini.', 'warning', true);
    }
  } finally {
    communityState.loading = false;
    renderHomeCommunityBoard();
    renderCommunityPage();
  }
}

function openCommunity() {
  setActivePage('community', 'community');
  renderCommunityPage();
}

function openSettings() {
  communityState.settingsSection = 'menu';
  setActivePage('settings', 'settings');
  renderSettingsPage();
}

async function completeUserAuthentication(form, endpoint, fallbackMessage) {
  const formData = new FormData(form);
  const body = {
    phone: String(formData.get('phone') || '').trim(),
    password: String(formData.get('password') || '').trim()
  };
  if (endpoint === '/auth/register') body.name = String(formData.get('name') || '').trim();

  communityState.loading = true;
  renderHomeCommunityBoard();
  try {
    const payload = await apiFetch(endpoint, { method: 'POST', body });
    const requiresPasswordChange = payloadRequiresPasswordChange(payload);
    await storeSessionToken(payload.token || '');
    applyAppState(payload);
    if (!requiresPasswordChange) await reconcileProgressAfterAuth();
    communityState.message = requiresPasswordChange
      ? 'Buat password baru terlebih dahulu untuk membuka seluruh fitur Iqro.'
      : '';
    form.reset();
    showHome();
  } catch (error) {
    setCommunityMessage(error.message || fallbackMessage, 'danger', true);
  } finally {
    communityState.loading = false;
    renderHomeCommunityBoard();
    renderCommunityPage();
  }
  return false;
}

async function submitPhoneLogin(event) {
  event.preventDefault();
  return completeUserAuthentication(event.currentTarget, '/auth/login', 'Login belum berhasil.');
}

async function submitForgotPassword(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  const senderPhoneConfirmed = formData.get('senderPhoneConfirmed') === 'confirmed';
  if (!senderPhoneConfirmed) {
    setCommunityMessage('Konfirmasi penggunaan nomor WhatsApp yang sama perlu dicentang.', 'warning', true);
    return false;
  }

  communityState.loading = true;
  renderHomeCommunityBoard();
  try {
    const payload = await apiFetch('/auth/forgot-password', {
      method: 'POST',
      body: {
        phone: String(formData.get('phone') || '').trim(),
        senderPhoneConfirmed
      }
    });
    form.reset();
    communityState.authMode = 'login';
    setCommunityMessage(payload.message || 'Permintaan reset sudah dikirim dan menunggu diproses pemilik.', 'success', true);
    openWhatsAppDelivery(null, payload.delivery);
  } catch (error) {
    setCommunityMessage(error.message || 'Permintaan reset password belum berhasil dikirim.', 'danger', true);
  } finally {
    communityState.loading = false;
    renderHomeCommunityBoard();
    renderCommunityPage();
  }
  return false;
}

async function submitPhoneRegister(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  const rewardConsent = formData.get('rewardConsent') === 'accepted';
  if (!rewardConsent) {
    setCommunityMessage('Centang Akad Kebaikan terlebih dahulu untuk mengirim permohonan.', 'warning', true);
    return false;
  }

  communityState.loading = true;
  renderHomeCommunityBoard();
  try {
    const payload = await apiFetch('/auth/register', {
      method: 'POST',
      body: {
        name: String(formData.get('name') || '').trim(),
        phone: String(formData.get('phone') || '').trim(),
        password: String(formData.get('password') || '').trim(),
        rewardConsent
      }
    });

    form.reset();
    communityState.authMode = 'login';
    setCommunityMessage(payload.message || 'Permohonan akun sudah dikirim dan menunggu persetujuan pemilik.', 'success', true);
    openWhatsAppDelivery(null, payload.delivery);
  } catch (error) {
    setCommunityMessage(error.message || 'Permohonan akun belum berhasil dikirim.', 'danger', true);
  } finally {
    communityState.loading = false;
    renderHomeCommunityBoard();
    renderCommunityPage();
  }
  return false;
}

async function submitRequiredPasswordChange(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  const newPassword = String(formData.get('newPassword') || '').trim();
  const confirmPassword = String(formData.get('confirmPassword') || '').trim();
  if (newPassword !== confirmPassword) {
    setCommunityMessage('Konfirmasi password baru belum cocok.', 'danger', true);
    return false;
  }

  communityState.loading = true;
  renderHomeCommunityBoard();
  try {
    const payload = await apiFetch('/me/complete-password-reset', {
      method: 'PUT',
      body: { newPassword }
    });
    applyAppState(payload);
    communityState.message = '';
    await reconcileProgressAfterAuth();
    form.reset();
    showHome();
  } catch (error) {
    setCommunityMessage(error.message || 'Password baru belum bisa disimpan.', 'danger', true);
  } finally {
    communityState.loading = false;
    renderHomeCommunityBoard();
    renderCommunityPage();
  }
  return false;
}

async function submitProfileUpdate(event) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  const name = String(formData.get('name') || '').trim();

  communityState.loading = true;
  renderCommunityPage();

  try {
    const payload = await apiFetch('/me', {
      method: 'PUT',
      body: { name }
    });
    applyAppState(payload);
    setCommunityMessage(payload.message || 'Nama tampilan berhasil diperbarui.', 'success');
  } catch (error) {
    setCommunityMessage(error.message || 'Nama tampilan belum bisa disimpan.', 'danger', true);
  } finally {
    communityState.loading = false;
    renderCommunityPage();
  }

  return false;
}

async function updateMemorialNames(names, successMessage) {
  communityState.loading = true;
  renderCommunityPage();

  try {
    const payload = await apiFetch('/me/memorial-names', {
      method: 'PUT',
      body: { names }
    });
    communityState.memorialDraft = null;
    applyAppState(payload);
    setCommunityMessage(successMessage || payload.message || 'Daftar nama Tahlil berhasil diperbarui.', 'success');
    return true;
  } catch (error) {
    setCommunityMessage(error.message || 'Daftar nama Tahlil belum bisa disimpan.', 'danger', true);
    return false;
  } finally {
    communityState.loading = false;
    renderCommunityPage();
  }
}

function updateMemorialNameCounter(textarea) {
  communityState.memorialDraft = textarea.value;
  const counter = document.getElementById('settingsMemorialCount');
  if (counter) counter.textContent = `${parseMemorialNames(textarea.value).length} dari ${maxMemorialNames} nama`;
}

async function submitMemorialNames(event) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  const rawNames = String(formData.get('memorialNames') || '');
  const names = parseMemorialNames(rawNames);
  communityState.memorialDraft = rawNames;

  if (names.length > maxMemorialNames) {
    setCommunityMessage(`Nama untuk Tahlil maksimal ${maxMemorialNames}.`, 'warning', true);
    return false;
  }
  if (names.some((name) => name.length > maxMemorialNameLength)) {
    setCommunityMessage(`Setiap nama maksimal ${maxMemorialNameLength} karakter.`, 'warning', true);
    return false;
  }
  const uniqueNames = new Set(names.map((name) => name.toLocaleLowerCase('id-ID')));
  if (uniqueNames.size !== names.length) {
    setCommunityMessage('Ada nama yang ditulis lebih dari satu kali.', 'warning', true);
    return false;
  }

  await updateMemorialNames(names, 'Daftar nama Tahlil berhasil disimpan.');
  return false;
}

async function submitPasswordUpdate(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  const currentPassword = String(formData.get('currentPassword') || '').trim();
  const newPassword = String(formData.get('newPassword') || '').trim();

  communityState.loading = true;
  renderCommunityPage();

  try {
    const payload = await apiFetch('/me/password', {
      method: 'PUT',
      body: { currentPassword, newPassword }
    });
    applyAppState(payload);
    setCommunityMessage(payload.message || 'Password akun berhasil diperbarui.', 'success');
    form.reset();
  } catch (error) {
    setCommunityMessage(error.message || 'Password akun belum bisa diperbarui.', 'danger', true);
  } finally {
    communityState.loading = false;
    renderCommunityPage();
  }

  return false;
}

async function submitAddFriend(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  const phone = String(formData.get('phone') || '').trim();

  communityState.installSuggestionPhone = '';
  communityState.loading = true;
  renderCommunityPage();

  try {
    const payload = await apiFetch('/friends', {
      method: 'POST',
      body: { phone }
    });
    communityState.communityAction = '';
    communityState.installSuggestionPhone = '';
    applyAppState(payload);
    setCommunityMessage(payload.message || 'Permintaan pertemanan berhasil dikirim.', 'success');
    form.reset();
  } catch (error) {
    if (error.status === 404) {
      communityState.installSuggestionPhone = phone;
      setCommunityMessage('Nomor tersebut belum terdaftar. Anda dapat menyarankan instalasi Iqro melalui WhatsApp.', 'warning');
    } else {
      communityState.installSuggestionPhone = '';
      setCommunityMessage(error.message || 'Teman belum bisa ditambahkan.', 'danger', true);
    }
  } finally {
    communityState.loading = false;
    renderCommunityPage();
  }

  return false;
}

async function respondFriendRequest(requestId, action) {
  if (!['accept', 'decline'].includes(action)) return false;
  communityState.loading = true;
  renderCommunityPage();
  try {
    const payload = await apiFetch(`/friend-requests/${encodeURIComponent(requestId)}/${action}`, { method: 'POST' });
    applyAppState(payload);
    setCommunityMessage(payload.message || 'Permintaan pertemanan diperbarui.', 'success');
  } catch (error) {
    setCommunityMessage(error.message || 'Permintaan pertemanan belum bisa diperbarui.', 'danger', true);
  } finally {
    communityState.loading = false;
    renderCommunityPage();
  }
  return false;
}

async function submitCreateGroup(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  const name = String(formData.get('name') || '').trim();
  const memberIds = formData.getAll('memberIds').map((value) => String(value || '').trim()).filter(Boolean);

  if (!memberIds.length) {
    setCommunityMessage('Pilih minimal satu kontak untuk dimasukkan ke group.', 'warning', true);
    return false;
  }

  communityState.loading = true;
  renderCommunityPage();

  try {
    const payload = await apiFetch('/groups', {
      method: 'POST',
      body: { name, memberIds }
    });
    communityState.communityTab = 'groups';
    communityState.communityAction = '';
    applyAppState(payload);
    setCommunityMessage(payload.message || 'Group berhasil dibuat.', 'success');
    form.reset();
  } catch (error) {
    setCommunityMessage(error.message || 'Group belum bisa dibuat.', 'danger', true);
  } finally {
    communityState.loading = false;
    renderCommunityPage();
  }

  return false;
}

async function submitAddMember(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  const phone = String(formData.get('phone') || '').trim();
  const groupId = String(formData.get('groupId') || '').trim();

  if (!phone) {
    setCommunityMessage('Pilih satu kontak yang akan ditambahkan.', 'warning', true);
    return false;
  }

  communityState.loading = true;
  renderCommunityPage();

  try {
    const payload = await apiFetch(`/groups/${encodeURIComponent(groupId)}/members`, {
      method: 'POST',
      body: { phone }
    });
    applyAppState(payload);
    communityState.addingMemberGroupId = '';
    communityState.selectedGroupContactPhone = '';
    communityState.groupContactPickerOpen = false;
    setCommunityMessage(payload.message || 'Anggota berhasil dimasukkan ke group.', 'success');
    form.reset();
  } catch (error) {
    setCommunityMessage(error.message || 'Anggota belum bisa dimasukkan ke group.', 'danger', true);
  } finally {
    communityState.loading = false;
    renderCommunityPage();
  }

  return false;
}

async function removeGroupMember(groupId, memberId) {
  const group = communityState.groups.find((item) => item.id === groupId);
  if (!group || !isCurrentUserGroupAdmin(group) || memberId === group.ownerUserId) return false;
  const adminUserIds = getGroupAdminUserIds(group);
  const isGroupOwner = group.ownerUserId === communityState.me?.id;
  if (!isGroupOwner && adminUserIds.has(memberId)) return false;

  communityState.loading = true;
  renderCommunityPage();
  try {
    const payload = await apiFetch(`/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(memberId)}`, {
      method: 'DELETE'
    });
    applyAppState(payload);
    communityState.removingGroupMemberId = '';
    communityState.groupMemberMenuId = '';
    setCommunityMessage(payload.message || 'Anggota berhasil dikeluarkan dari group.', 'success');
  } catch (error) {
    setCommunityMessage(error.message || 'Anggota belum bisa dikeluarkan dari group.', 'danger', true);
  } finally {
    communityState.loading = false;
    renderCommunityPage();
  }
  return false;
}

async function promoteGroupMember(groupId, memberId) {
  const group = communityState.groups.find((item) => item.id === groupId);
  if (!group || group.ownerUserId !== communityState.me?.id || !group.members.some((member) => member.id === memberId)) return false;

  communityState.loading = true;
  renderCommunityPage();
  try {
    const payload = await apiFetch(`/groups/${encodeURIComponent(groupId)}/admins/${encodeURIComponent(memberId)}`, {
      method: 'POST'
    });
    applyAppState(payload);
    communityState.groupMemberMenuId = '';
    communityState.removingGroupMemberId = '';
    setCommunityMessage(payload.message || 'Anggota berhasil dijadikan admin group.', 'success');
  } catch (error) {
    setCommunityMessage(error.message || 'Anggota belum bisa dijadikan admin group.', 'danger', true);
  } finally {
    communityState.loading = false;
    renderCommunityPage();
  }
  return false;
}

async function deleteGroup(groupId) {
  const group = communityState.groups.find((item) => item.id === groupId);
  if (!group || group.ownerUserId !== communityState.me?.id) return false;

  communityState.loading = true;
  renderCommunityPage();
  try {
    const payload = await apiFetch(`/groups/${encodeURIComponent(groupId)}`, { method: 'DELETE' });
    communityState.selectedGroupId = '';
    communityState.deletingGroupId = '';
    communityState.groupMemberMenuId = '';
    applyAppState(payload);
    setCommunityMessage(payload.message || 'Group berhasil dihapus.', 'success');
  } catch (error) {
    setCommunityMessage(error.message || 'Group belum bisa dihapus.', 'danger', true);
  } finally {
    communityState.loading = false;
    renderCommunityPage();
  }
  return false;
}

async function logoutCommunity() {
  communityState.loading = true;
  renderCommunityPage();

  try {
    if (communityState.token) {
      await apiFetch('/auth/logout', { method: 'POST' });
    }
  } catch (error) {
    // Sesi lokal tetap dibersihkan meskipun request logout gagal.
  }

  clearSessionState(false);
  communityState.loading = false;
  renderHomeCommunityBoard();
  renderCommunityPage();
  communityState.authMode = 'login';
  setCommunityMessage('Anda sudah keluar. Silakan masuk kembali untuk mengakses Iqro.', 'success', true);
  showHome();
}

window.openCommunity = openCommunity;
window.openSettings = openSettings;
window.setHomeAuthMode = setHomeAuthMode;
window.submitPhoneLogin = submitPhoneLogin;
window.submitPhoneRegister = submitPhoneRegister;
window.submitForgotPassword = submitForgotPassword;
window.submitRequiredPasswordChange = submitRequiredPasswordChange;
window.submitProfileUpdate = submitProfileUpdate;
window.openSettingsSection = openSettingsSection;
window.closeSettingsSection = closeSettingsSection;
window.submitMemorialNames = submitMemorialNames;
window.updateMemorialNameCounter = updateMemorialNameCounter;
window.getTahlilMemorialNames = () => [...getMemorialNames()];
window.submitAddFriend = submitAddFriend;
window.respondFriendRequest = respondFriendRequest;
window.submitCreateGroup = submitCreateGroup;
window.submitAddMember = submitAddMember;
window.logoutCommunity = logoutCommunity;
window.setCommunityTab = setCommunityTab;
window.toggleCommunityAction = toggleCommunityAction;
window.closeCommunityAction = closeCommunityAction;
window.openAddFriendAction = openAddFriendAction;
window.openContactsTab = openContactsTab;
window.openGroupsTab = openGroupsTab;
window.openGroupDetail = openGroupDetail;
window.closeGroupDetail = closeGroupDetail;
window.openAddMemberForm = openAddMemberForm;
window.closeAddMemberForm = closeAddMemberForm;
window.toggleGroupContactPicker = toggleGroupContactPicker;
window.selectGroupContact = selectGroupContact;
window.requestRemoveGroupMember = requestRemoveGroupMember;
window.cancelRemoveGroupMember = cancelRemoveGroupMember;
window.removeGroupMember = removeGroupMember;
window.togglePrimaryCommunityAction = togglePrimaryCommunityAction;
window.updateQuranDisplayPreference = updateQuranDisplayPreference;
window.resetQuranDisplayPreferences = resetQuranDisplayPreferences;
window.downloadOfflineQuranData = downloadOfflineQuranData;
window.requestRemoveOfflineQuranData = requestRemoveOfflineQuranData;
window.cancelRemoveOfflineQuranData = cancelRemoveOfflineQuranData;
window.removeOfflineQuranData = removeOfflineQuranData;
window.getKfgqpcHafsSurah = getKfgqpcHafsSurah;
window.stripKfgqpcAyahMarker = stripKfgqpcAyahMarker;

window.addEventListener('iqro:quran-offline-status', () => {
  if (communityState.settingsSection === 'offline') renderSettingsPage();
});

injectCommunityUi();
patchCoreIqroFunctions();
renderHomeCommunityBoard();
renderCommunityPage();
restoreCommunitySession();
