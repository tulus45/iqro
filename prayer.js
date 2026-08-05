const prayerPreferenceStorageKey = 'iqro_prayer_city';
const prayerLocationModeStorageKey = 'iqro_prayer_location_mode';
const prayerCacheStoragePrefix = 'iqro_prayer_schedule';
const prayerLatestCacheStorageKey = `${prayerCacheStoragePrefix}:latest`;
const prayerPrimaryRows = [
  { key: 'Fajr', label: 'Subuh', note: 'Fajar' },
  { key: 'Dhuhr', label: 'Zuhur', note: 'Tengah hari' },
  { key: 'Asr', label: 'Asar', note: 'Menjelang petang' },
  { key: 'Maghrib', label: 'Magrib', note: 'Matahari terbenam' },
  { key: 'Isha', label: 'Isya', note: 'Malam' }
];
const prayerCityTimezones = {
  jakarta: 'Asia/Jakarta',
  bandung: 'Asia/Jakarta',
  semarang: 'Asia/Jakarta',
  yogyakarta: 'Asia/Jakarta',
  surabaya: 'Asia/Jakarta',
  medan: 'Asia/Jakarta',
  palembang: 'Asia/Jakarta',
  denpasar: 'Asia/Makassar',
  banjarmasin: 'Asia/Makassar',
  balikpapan: 'Asia/Makassar',
  makassar: 'Asia/Makassar',
  manado: 'Asia/Makassar',
  jayapura: 'Asia/Jayapura'
};
const prayerCityCoordinates = {
  jakarta: [-6.2088, 106.8456],
  bandung: [-6.9175, 107.6191],
  semarang: [-6.9667, 110.4167],
  yogyakarta: [-7.7956, 110.3695],
  surabaya: [-7.2575, 112.7521],
  medan: [3.5952, 98.6722],
  palembang: [-2.9909, 104.7566],
  denpasar: [-8.65, 115.2167],
  banjarmasin: [-3.3186, 114.5944],
  balikpapan: [-1.2379, 116.8529],
  makassar: [-5.1477, 119.4327],
  manado: [1.4748, 124.8421],
  jayapura: [-2.5916, 140.669]
};

const prayerState = {
  city: readPrayerCityPreference(),
  locationMode: readPrayerLocationMode(),
  coordinates: null,
  locating: false,
  locationAttempted: false,
  locationRequestId: 0,
  locationNotice: '',
  data: null,
  loading: false,
  error: '',
  notice: '',
  cachedFallback: false,
  requestId: 0,
  timer: null
};
const qiblaState = {
  heading: null,
  active: false,
  status: 'Arah perkiraan berdasarkan pusat kota yang dipilih.'
};

function degreesToRadians(value) {
  return value * (Math.PI / 180);
}

function radiansToDegrees(value) {
  return value * (180 / Math.PI);
}

function normalizeCompassDegree(value) {
  return (Number(value) + 360) % 360;
}

function activePrayerCoordinates() {
  if (prayerState.locationMode === 'auto' && prayerState.coordinates) {
    return [prayerState.coordinates.latitude, prayerState.coordinates.longitude];
  }
  return prayerCityCoordinates[prayerState.city] || prayerCityCoordinates.jakarta;
}

function calculateQiblaBearing() {
  const coordinates = activePrayerCoordinates();
  const latitude = degreesToRadians(coordinates[0]);
  const longitude = degreesToRadians(coordinates[1]);
  const kaabaLatitude = degreesToRadians(21.422487);
  const kaabaLongitude = degreesToRadians(39.826206);
  const longitudeDifference = kaabaLongitude - longitude;
  const y = Math.sin(longitudeDifference) * Math.cos(kaabaLatitude);
  const x = (Math.cos(latitude) * Math.sin(kaabaLatitude))
    - (Math.sin(latitude) * Math.cos(kaabaLatitude) * Math.cos(longitudeDifference));
  return normalizeCompassDegree(radiansToDegrees(Math.atan2(y, x)));
}

function getScreenOrientationAngle() {
  const screenAngle = Number(window.screen?.orientation?.angle);
  if (Number.isFinite(screenAngle)) return screenAngle;
  const legacyAngle = Number(window.orientation);
  return Number.isFinite(legacyAngle) ? legacyAngle : 0;
}

function getDeviceCompassHeading(event) {
  if (Number.isFinite(Number(event.webkitCompassHeading))) {
    return normalizeCompassDegree(Number(event.webkitCompassHeading));
  }
  if (event.absolute === true && Number.isFinite(Number(event.alpha))) {
    return normalizeCompassDegree(360 - Number(event.alpha) + getScreenOrientationAngle());
  }
  return null;
}

function renderQiblaCompass() {
  const bearing = calculateQiblaBearing();
  const relativeDirection = qiblaState.heading === null
    ? bearing
    : normalizeCompassDegree(bearing - qiblaState.heading);
  const alignmentDifference = Math.min(relativeDirection, 360 - relativeDirection);
  const isAligned = qiblaState.heading !== null && alignmentDifference <= 5;
  const pointer = document.getElementById('qiblaPointer');
  const face = document.getElementById('qiblaCompassFace');
  const bearingValue = document.getElementById('qiblaBearingValue');
  const bearingCopy = document.getElementById('qiblaBearingCopy');
  const status = document.getElementById('qiblaCompassStatus');
  const alignment = document.getElementById('qiblaAlignmentLabel');
  const button = document.getElementById('qiblaCompassButton');
  if (pointer) pointer.style.transform = `translateX(-50%) rotate(${relativeDirection}deg)`;
  if (bearingValue) bearingValue.textContent = `${Math.round(bearing)}°`;
  if (bearingCopy) {
    bearingCopy.textContent = prayerState.locationMode === 'auto' && prayerState.coordinates
      ? 'Berdasarkan lokasi Anda saat ini'
      : `dari utara · pusat ${prayerCityLabel()}`;
  }
  if (status) status.textContent = isAligned ? 'Arah kiblat sudah sejajar.' : qiblaState.status;
  if (alignment) alignment.textContent = isAligned ? 'Sudah sejajar' : 'Arah kiblat';
  if (button) {
    button.textContent = qiblaState.active ? 'Perbarui arah' : 'Aktifkan Kompas';
    button.classList.toggle('is-active', qiblaState.active);
    button.setAttribute('aria-label', qiblaState.active
      ? 'Perbarui pembacaan sensor arah kiblat'
      : 'Aktifkan kompas perangkat untuk menentukan arah kiblat');
  }
  if (face) {
    face.classList.toggle('is-aligned', isAligned);
    face.setAttribute('aria-label', `Arah kiblat ${Math.round(bearing)} derajat dari utara${isAligned ? ', sudah sejajar' : ''}`);
  }
}

function handleQiblaOrientation(event) {
  const heading = getDeviceCompassHeading(event);
  if (heading === null) return;
  qiblaState.heading = heading;
  qiblaState.status = 'Putar perangkat hingga penunjuk hijau mengarah lurus ke atas.';
  renderQiblaCompass();
}

async function activateQiblaCompass() {
  if (typeof window.DeviceOrientationEvent === 'undefined') {
    qiblaState.status = 'Sensor kompas tidak tersedia. Gunakan angka derajat sebagai panduan.';
    renderQiblaCompass();
    return;
  }

  try {
    if (typeof window.DeviceOrientationEvent.requestPermission === 'function') {
      const permission = await window.DeviceOrientationEvent.requestPermission();
      if (permission !== 'granted') {
        qiblaState.status = 'Izin kompas belum diberikan. Gunakan angka derajat sebagai panduan.';
        renderQiblaCompass();
        return;
      }
    }
    window.removeEventListener('deviceorientationabsolute', handleQiblaOrientation, true);
    window.removeEventListener('deviceorientation', handleQiblaOrientation, true);
    window.addEventListener('deviceorientationabsolute', handleQiblaOrientation, true);
    window.addEventListener('deviceorientation', handleQiblaOrientation, true);
    qiblaState.active = true;
    qiblaState.status = 'Menunggu pembacaan sensor kompas...';
    renderQiblaCompass();
    window.setTimeout(() => {
      if (qiblaState.active && qiblaState.heading === null) {
        qiblaState.status = 'Sensor belum memberikan arah. Gerakkan perangkat membentuk angka delapan untuk kalibrasi.';
        renderQiblaCompass();
      }
    }, 1800);
  } catch (error) {
    qiblaState.status = 'Kompas belum dapat diaktifkan. Gunakan angka derajat sebagai panduan.';
    renderQiblaCompass();
  }
}

function readPrayerCityPreference() {
  const saved = String(window.localStorage.getItem(prayerPreferenceStorageKey) || '').toLowerCase();
  return Object.hasOwn(prayerCityTimezones, saved) ? saved : 'jakarta';
}

function readPrayerLocationMode() {
  return window.localStorage.getItem(prayerLocationModeStorageKey) === 'city' ? 'city' : 'auto';
}

function prayerActiveTimezone() {
  if (prayerState.data?.timezone) return prayerState.data.timezone;
  if (prayerState.locationMode === 'auto') {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Jakarta';
  }
  return prayerCityTimezones[prayerState.city] || 'Asia/Jakarta';
}

function prayerDateKey(timezone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).formatToParts(new Date()).reduce((output, part) => {
    if (part.type !== 'literal') output[part.type] = part.value;
    return output;
  }, {});
  return `${parts.day}-${parts.month}-${parts.year}`;
}

function prayerTimezoneShortLabel(timezone) {
  if (timezone === 'Asia/Jakarta') return 'WIB';
  if (timezone === 'Asia/Makassar') return 'WITA';
  if (timezone === 'Asia/Jayapura') return 'WIT';
  try {
    const timezoneName = new Intl.DateTimeFormat('id-ID', {
      timeZone: timezone,
      timeZoneName: 'short'
    }).formatToParts(new Date()).find((part) => part.type === 'timeZoneName')?.value;
    return timezoneName || 'Lokal';
  } catch (error) {
    return 'Lokal';
  }
}

function prayerNowSeconds(timezone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date()).reduce((output, part) => {
    if (part.type !== 'literal') output[part.type] = Number(part.value);
    return output;
  }, {});
  return (parts.hour * 3600) + (parts.minute * 60) + parts.second;
}

function prayerTimeSeconds(value) {
  const match = String(value || '').match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  return match ? (Number(match[1]) * 3600) + (Number(match[2]) * 60) : null;
}

function prayerEscape(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[character]));
}

function prayerCityLabel() {
  const select = document.getElementById('prayerCitySelect');
  const option = select?.querySelector(`option[value="${prayerState.city}"]`);
  return option?.textContent || prayerState.data?.location?.label || 'Jakarta';
}

function syncPrayerCityControl() {
  const select = document.getElementById('prayerCitySelect');
  const display = document.getElementById('prayerCityDisplay');
  const modeLabel = document.getElementById('prayerLocationModeLabel');
  const control = document.getElementById('prayerCityControl');
  const autoOption = document.getElementById('prayerGpsOption');
  const autoNote = document.getElementById('prayerGpsOptionNote');
  const usingAuto = prayerState.locationMode === 'auto';
  if (select && select.value !== prayerState.city) select.value = prayerState.city;
  if (modeLabel) {
    modeLabel.textContent = prayerState.locating
      ? 'Mendeteksi GPS'
      : usingAuto ? 'Lokasi' : 'Kota acuan';
  }
  if (display) {
    display.textContent = prayerState.locating
      ? 'Mencari lokasi...'
      : usingAuto && prayerState.coordinates ? 'Lokasi saat ini' : prayerCityLabel();
  }
  control?.classList.toggle('is-locating', prayerState.locating);
  if (autoOption) {
    autoOption.classList.toggle('is-active', usingAuto);
    autoOption.setAttribute('aria-selected', String(usingAuto));
  }
  if (autoNote) {
    autoNote.textContent = prayerState.locating
      ? 'Sedang meminta lokasi perangkat'
      : 'Jadwal area dan kiblat lebih akurat';
  }
  document.querySelectorAll('.prayer-city-option').forEach((option) => {
    const isActive = !usingAuto && option.dataset.city === prayerState.city;
    option.classList.toggle('is-active', isActive);
    option.setAttribute('aria-selected', String(isActive));
  });
}

function positionPrayerCityMenu() {
  const control = document.getElementById('prayerCityControl');
  const menu = document.getElementById('prayerCityMenu');
  if (!control || !menu || menu.hidden) return;
  const rect = control.getBoundingClientRect();
  const edge = 12;
  const width = Math.min(Math.max(rect.width, 300), window.innerWidth - (edge * 2));
  const maxHeight = Math.max(180, Math.min(410, window.innerHeight - (edge * 2)));
  menu.style.width = `${width}px`;
  menu.style.maxHeight = `${maxHeight}px`;
  const menuHeight = Math.min(menu.scrollHeight, maxHeight);
  const roomBelow = window.innerHeight - rect.bottom - edge;
  const top = roomBelow >= Math.min(menuHeight, 240)
    ? rect.bottom + 8
    : Math.max(edge, rect.top - menuHeight - 8);
  const left = Math.min(Math.max(edge, rect.left), window.innerWidth - width - edge);
  menu.style.top = `${Math.round(top)}px`;
  menu.style.left = `${Math.round(left)}px`;
}

function closePrayerCityMenu(restoreFocus = false) {
  const control = document.getElementById('prayerCityControl');
  const trigger = document.getElementById('prayerCityTrigger');
  const menu = document.getElementById('prayerCityMenu');
  if (!menu || menu.hidden) return;
  menu.hidden = true;
  control?.classList.remove('is-open');
  trigger?.setAttribute('aria-expanded', 'false');
  if (restoreFocus) trigger?.focus();
}

function focusPrayerCityOption(direction) {
  const menu = document.getElementById('prayerCityMenu');
  if (!menu || menu.hidden) return;
  const options = [...menu.querySelectorAll('button[role="option"]')];
  if (!options.length) return;
  const currentIndex = options.indexOf(document.activeElement);
  let nextIndex = currentIndex;
  if (direction === 'first') nextIndex = 0;
  if (direction === 'last') nextIndex = options.length - 1;
  if (direction === 'next') nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % options.length;
  if (direction === 'previous') nextIndex = currentIndex < 0 ? options.length - 1 : (currentIndex - 1 + options.length) % options.length;
  options[nextIndex]?.focus();
}

function openPrayerCityMenu() {
  const control = document.getElementById('prayerCityControl');
  const trigger = document.getElementById('prayerCityTrigger');
  const menu = document.getElementById('prayerCityMenu');
  if (!control || !trigger || !menu) return;
  menu.hidden = false;
  control.classList.add('is-open');
  trigger.setAttribute('aria-expanded', 'true');
  positionPrayerCityMenu();
  window.requestAnimationFrame(() => {
    menu.querySelector('button[aria-selected="true"]')?.focus();
  });
}

function togglePrayerCityMenu(event) {
  event?.stopPropagation();
  const menu = document.getElementById('prayerCityMenu');
  if (!menu) return;
  if (menu.hidden) openPrayerCityMenu();
  else closePrayerCityMenu(true);
}

function choosePrayerCity(city) {
  closePrayerCityMenu();
  if (prayerState.locationMode === 'city' && city === prayerState.city) {
    syncPrayerCityControl();
    document.getElementById('prayerCityTrigger')?.focus();
    return;
  }
  changePrayerCity(city);
  document.getElementById('prayerCityTrigger')?.focus();
}

function buildPrayerCityMenu() {
  const select = document.getElementById('prayerCitySelect');
  const menu = document.getElementById('prayerCityMenu');
  const control = document.getElementById('prayerCityControl');
  if (!select || !menu || !control || menu.dataset.ready === 'true') return;

  const autoOption = document.createElement('button');
  autoOption.id = 'prayerGpsOption';
  autoOption.className = 'prayer-city-auto-option';
  autoOption.type = 'button';
  autoOption.setAttribute('role', 'option');
  const autoMark = document.createElement('span');
  autoMark.className = 'prayer-city-auto-mark';
  autoMark.setAttribute('aria-hidden', 'true');
  const autoCopy = document.createElement('span');
  autoCopy.className = 'prayer-city-auto-copy';
  const autoTitle = document.createElement('strong');
  autoTitle.textContent = 'Gunakan lokasi saat ini';
  const autoNote = document.createElement('small');
  autoNote.id = 'prayerGpsOptionNote';
  autoNote.textContent = 'Jadwal area dan kiblat lebih akurat';
  const autoCheck = document.createElement('span');
  autoCheck.className = 'prayer-city-auto-check';
  autoCheck.setAttribute('aria-hidden', 'true');
  autoCheck.textContent = '✓';
  autoCopy.append(autoTitle, autoNote);
  autoOption.append(autoMark, autoCopy, autoCheck);
  autoOption.addEventListener('click', requestPrayerDeviceLocation);
  menu.appendChild(autoOption);

  [...select.children].forEach((groupSource) => {
    if (groupSource.tagName !== 'OPTGROUP') return;
    const group = document.createElement('section');
    group.className = 'prayer-city-group';
    const label = document.createElement('p');
    label.className = 'prayer-city-group-label';
    label.textContent = groupSource.label;
    const options = document.createElement('div');
    options.className = 'prayer-city-options';
    [...groupSource.children].forEach((optionSource) => {
      const option = document.createElement('button');
      option.className = 'prayer-city-option';
      option.type = 'button';
      option.role = 'option';
      option.dataset.city = optionSource.value;
      const optionLabel = document.createElement('span');
      optionLabel.textContent = optionSource.textContent;
      option.appendChild(optionLabel);
      option.addEventListener('click', () => choosePrayerCity(optionSource.value));
      options.appendChild(option);
    });
    group.append(label, options);
    menu.appendChild(group);
  });

  menu.dataset.ready = 'true';
  document.body.appendChild(menu);
  menu.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusPrayerCityOption('next');
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusPrayerCityOption('previous');
    } else if (event.key === 'Home') {
      event.preventDefault();
      focusPrayerCityOption('first');
    } else if (event.key === 'End') {
      event.preventDefault();
      focusPrayerCityOption('last');
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closePrayerCityMenu(true);
    }
  });
  document.addEventListener('pointerdown', (event) => {
    if (!control.contains(event.target) && !menu.contains(event.target)) closePrayerCityMenu();
  });
  window.addEventListener('resize', () => closePrayerCityMenu());
  window.addEventListener('scroll', () => closePrayerCityMenu());
  syncPrayerCityControl();
}

function prayerLocationErrorMessage(error) {
  if (error?.code === 1) return 'Izin lokasi belum diberikan.';
  if (error?.code === 2) return 'Lokasi perangkat belum dapat ditemukan.';
  if (error?.code === 3) return 'Pencarian lokasi memerlukan waktu terlalu lama.';
  return 'GPS belum dapat digunakan pada perangkat ini.';
}

function usePrayerCityFallback(message, locationRequestId) {
  if (locationRequestId !== prayerState.locationRequestId) return;
  prayerState.locationMode = 'city';
  prayerState.coordinates = null;
  prayerState.locating = false;
  prayerState.loading = false;
  prayerState.locationNotice = `${message} Jadwal menggunakan kota acuan ${prayerCityLabel()}.`;
  window.localStorage.setItem(prayerLocationModeStorageKey, 'city');
  qiblaState.status = 'Arah perkiraan berdasarkan pusat kota yang dipilih.';
  renderPrayerPage();
  void loadPrayerSchedule(true);
}

function applyPrayerDevicePosition(position, locationRequestId) {
  if (locationRequestId !== prayerState.locationRequestId) return;
  const latitude = Number(position.coords?.latitude);
  const longitude = Number(position.coords?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    usePrayerCityFallback('Koordinat dari perangkat tidak valid.', locationRequestId);
    return;
  }
  prayerState.coordinates = {
    latitude,
    longitude,
    accuracy: Number(position.coords?.accuracy) || null
  };
  prayerState.locating = false;
  prayerState.locationNotice = '';
  qiblaState.status = 'Arah kiblat dihitung dari lokasi perangkat.';
  renderPrayerPage();
  void loadPrayerSchedule(true);
}

function requestPrayerDeviceLocation() {
  closePrayerCityMenu();
  const locationRequestId = ++prayerState.locationRequestId;
  prayerState.requestId += 1;
  prayerState.locationMode = 'auto';
  prayerState.coordinates = null;
  prayerState.locating = true;
  prayerState.locationAttempted = true;
  prayerState.locationNotice = '';
  prayerState.data = null;
  prayerState.loading = false;
  prayerState.error = '';
  prayerState.notice = '';
  prayerState.cachedFallback = false;
  window.localStorage.setItem(prayerLocationModeStorageKey, 'auto');
  renderPrayerPage();

  if (window.IqroNative?.isNative) {
    window.IqroNative.getCurrentPosition({
      enableHighAccuracy: true,
      timeout: 12000,
      maximumAge: 300000
    }).then((position) => {
      applyPrayerDevicePosition(position, locationRequestId);
    }).catch((error) => {
      usePrayerCityFallback(prayerLocationErrorMessage(error), locationRequestId);
    });
    return;
  }

  if (!window.isSecureContext) {
    usePrayerCityFallback('GPS browser hanya tersedia melalui HTTPS atau localhost.', locationRequestId);
    return;
  }
  if (!navigator.geolocation) {
    usePrayerCityFallback('Perangkat ini tidak menyediakan layanan lokasi.', locationRequestId);
    return;
  }

  navigator.geolocation.getCurrentPosition((position) => {
    applyPrayerDevicePosition(position, locationRequestId);
  }, (error) => {
    usePrayerCityFallback(prayerLocationErrorMessage(error), locationRequestId);
  }, {
    enableHighAccuracy: true,
    timeout: 12000,
    maximumAge: 300000
  });
}

function formatPrayerGregorianDate(value) {
  const match = String(value || '').match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!match) return 'Hari ini';
  const date = new Date(Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1])));
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  }).format(date);
}

function formatPrayerHijriDate(hijri) {
  if (!hijri?.day || !hijri?.month || !hijri?.year) return 'Kalender Hijriah';
  const monthMap = {
    Muharram: 'Muharam',
    Safar: 'Safar',
    'Rabi al-Awwal': 'Rabiulawal',
    'Rabi al-Thani': 'Rabiulakhir',
    'Jumada al-Awwal': 'Jumadilawal',
    'Jumada al-Thani': 'Jumadilakhir',
    Rajab: 'Rajab',
    Shaban: 'Syakban',
    Ramadan: 'Ramadan',
    Shawwal: 'Syawal',
    'Dhul Qadah': 'Zulkaidah',
    'Dhul Hijjah': 'Zulhijah'
  };
  const month = monthMap[hijri.month] || hijri.month;
  return `${hijri.day} ${month} ${hijri.year} H`;
}

function getNextPrayerMeta() {
  if (!prayerState.data?.timings) return null;
  const timezone = prayerActiveTimezone();
  const nowSeconds = prayerNowSeconds(timezone);
  const rows = prayerPrimaryRows.map((row, index) => ({
    ...row,
    index,
    seconds: prayerTimeSeconds(prayerState.data.timings[row.key])
  })).filter((row) => row.seconds !== null);
  if (!rows.length) return null;

  let next = rows.find((row) => row.seconds > nowSeconds);
  let nextAbsolute;
  let previousAbsolute;
  if (next) {
    nextAbsolute = next.seconds;
    const previousIndex = next.index === 0 ? rows.length - 1 : next.index - 1;
    previousAbsolute = rows[previousIndex].seconds;
    if (next.index === 0) previousAbsolute -= 86400;
  } else {
    next = rows[0];
    nextAbsolute = next.seconds + 86400;
    previousAbsolute = rows.at(-1).seconds;
  }

  const duration = Math.max(1, nextAbsolute - previousAbsolute);
  const remaining = Math.max(0, nextAbsolute - nowSeconds);
  const elapsed = Math.max(0, nowSeconds - previousAbsolute);
  return {
    ...next,
    nowSeconds,
    remaining,
    progress: Math.max(0, Math.min(100, (elapsed / duration) * 100))
  };
}

function formatPrayerCountdown(seconds) {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainder = safeSeconds % 60;
  return [hours, minutes, remainder].map((value) => String(value).padStart(2, '0')).join(':');
}

function renderPrayerLoading() {
  const grid = document.getElementById('prayerScheduleGrid');
  if (grid) {
    grid.innerHTML = prayerPrimaryRows.map(() => `
      <article class="prayer-time-card is-loading" aria-hidden="true">
        <span></span><strong></strong><small></small>
      </article>
    `).join('');
  }
}

function renderPrayerStatus() {
  const status = document.getElementById('prayerStatus');
  if (!status) return;
  const message = prayerState.error || prayerState.notice || prayerState.locationNotice;
  status.hidden = !message;
  status.className = `prayer-status${prayerState.error ? ' is-error' : ' is-notice'}`;
  status.innerHTML = prayerState.error
    ? `<span>${prayerEscape(prayerState.error)}</span><button type="button" onclick="loadPrayerSchedule(true)">Coba lagi</button>`
    : prayerEscape(message);
}

function renderPrayerSchedule() {
  const data = prayerState.data;
  const grid = document.getElementById('prayerScheduleGrid');
  if (!data || !grid) return;
  const next = getNextPrayerMeta();

  grid.innerHTML = prayerPrimaryRows.map((row, index) => {
    const isNext = next?.index === index;
    const isSubuh = row.key === 'Fajr';
    const time = data.timings[row.key] || '--:--';
    const subuhDetails = isSubuh ? `
        <div class="prayer-time-details" aria-label="Waktu pendamping Subuh">
          <div><span>Imsak</span><strong>${prayerEscape(data.timings.Imsak || '--:--')}</strong></div>
          <div><span>Terbit</span><strong>${prayerEscape(data.timings.Sunrise || '--:--')}</strong></div>
        </div>
    ` : '';
    return `
      <article class="prayer-time-card${isSubuh ? ' has-supporting-times' : ''}${isNext ? ' is-next' : ''}" data-prayer-key="${row.key}">
        <div class="prayer-time-card-top">
          <span class="prayer-sequence">${String(index + 1).padStart(2, '0')}</span>
          ${isNext ? '<span class="prayer-next-badge">Berikutnya</span>' : ''}
        </div>
        <p>${prayerEscape(row.note)}</p>
        <h2>${prayerEscape(row.label)}</h2>
        <time datetime="${prayerEscape(time)}">${prayerEscape(time)}</time>
        ${subuhDetails}
      </article>
    `;
  }).join('');
}

function renderPrayerNext() {
  const data = prayerState.data;
  if (!data) return;
  const next = getNextPrayerMeta();
  if (!next) return;
  const name = document.getElementById('prayerNextName');
  const time = document.getElementById('prayerNextTime');
  const index = document.getElementById('prayerNextIndex');
  const countdown = document.getElementById('prayerCountdown');
  const progress = document.getElementById('prayerCountdownProgress');
  if (name) name.textContent = next.label;
  if (time) time.textContent = data.timings[next.key] || '--:--';
  if (index) index.textContent = String(next.index + 1).padStart(2, '0');
  if (countdown) countdown.textContent = `${formatPrayerCountdown(next.remaining)} lagi`;
  if (progress) progress.style.width = `${next.progress}%`;

  document.querySelectorAll('.prayer-time-card[data-prayer-key]').forEach((card) => {
    card.classList.toggle('is-next', card.dataset.prayerKey === next.key);
    const badge = card.querySelector('.prayer-next-badge');
    if (card.dataset.prayerKey === next.key && !badge) {
      card.querySelector('.prayer-time-card-top')?.insertAdjacentHTML('beforeend', '<span class="prayer-next-badge">Berikutnya</span>');
    } else if (card.dataset.prayerKey !== next.key) {
      badge?.remove();
    }
  });
}

function renderPrayerMeta() {
  const data = prayerState.data;
  if (!data) return;
  const timezone = prayerActiveTimezone();
  const timezoneLabel = document.getElementById('prayerTimezoneLabel');
  const gregorian = document.getElementById('prayerGregorianDate');
  const hijri = document.getElementById('prayerHijriDate');
  const location = document.getElementById('prayerLocationBadge');
  if (timezoneLabel) timezoneLabel.textContent = prayerTimezoneShortLabel(timezone);
  if (gregorian) gregorian.textContent = formatPrayerGregorianDate(data.date?.gregorian);
  if (hijri) hijri.textContent = formatPrayerHijriDate(data.date?.hijri);
  if (location) {
    location.textContent = prayerState.locationMode === 'auto'
      ? 'Lokasi saat ini'
      : data.location?.label || prayerCityLabel();
  }
}

function renderPrayerPage() {
  const select = document.getElementById('prayerCitySelect');
  if (select && select.value !== prayerState.city) select.value = prayerState.city;
  syncPrayerCityControl();
  renderQiblaCompass();
  renderPrayerStatus();
  if (prayerState.loading && !prayerState.data) {
    renderPrayerLoading();
    return;
  }
  if (!prayerState.data) return;
  renderPrayerMeta();
  renderPrayerSchedule();
  renderPrayerNext();
}

function prayerCacheLocationKey() {
  if (prayerState.locationMode === 'auto' && prayerState.coordinates) {
    return `gps:${prayerState.coordinates.latitude.toFixed(1)}:${prayerState.coordinates.longitude.toFixed(1)}`;
  }
  return prayerState.city;
}

function readCachedPrayerSchedule(date) {
  try {
    const raw = window.localStorage.getItem(`${prayerCacheStoragePrefix}:${prayerCacheLocationKey()}:${date}`);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed?.timings ? parsed : null;
  } catch (error) {
    return null;
  }
}

function readLatestCachedPrayerSchedule() {
  try {
    const raw = window.localStorage.getItem(prayerLatestCacheStorageKey);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed?.payload?.timings ? parsed : null;
  } catch (error) {
    return null;
  }
}

function writeCachedPrayerSchedule(date, payload) {
  try {
    const locationKey = prayerCacheLocationKey();
    window.localStorage.setItem(`${prayerCacheStoragePrefix}:${locationKey}:${date}`, JSON.stringify(payload));
    window.localStorage.setItem(prayerLatestCacheStorageKey, JSON.stringify({
      payload,
      date,
      locationKey,
      savedAt: new Date().toISOString()
    }));
  } catch (error) {}
}

function getCachedPrayerFallback(date) {
  const exact = readCachedPrayerSchedule(date);
  if (exact) return { payload: exact, exact: true, date };
  const latest = readLatestCachedPrayerSchedule();
  return latest ? { ...latest, exact: false } : null;
}

function cachedPrayerNotice(cache) {
  const offlineLabel = navigator.onLine === false ? 'Mode offline.' : 'Koneksi jadwal sedang terputus.';
  if (cache.exact) return `${offlineLabel} Menampilkan jadwal yang tersimpan untuk hari ini.`;
  const cachedDate = formatPrayerGregorianDate(cache.payload?.date?.gregorian || cache.date);
  const cachedLocation = cache.payload?.location?.label || 'lokasi terakhir';
  return `${offlineLabel} Menampilkan jadwal terakhir yang tersimpan: ${cachedDate}, ${cachedLocation}.`;
}

async function loadPrayerSchedule(force = false) {
  if (prayerState.locating) return;
  if (prayerState.loading && !force) return;
  const usingAuto = prayerState.locationMode === 'auto' && Boolean(prayerState.coordinates);
  const targetLocationKey = usingAuto ? 'gps' : prayerState.city;
  const timezone = prayerActiveTimezone();
  const date = prayerDateKey(timezone);
  if (!force && !prayerState.cachedFallback && prayerState.data?.date?.gregorian === date && prayerState.data?.location?.key === targetLocationKey) {
    renderPrayerPage();
    return;
  }

  const cachedFallback = getCachedPrayerFallback(date);
  if (navigator.onLine === false && cachedFallback) {
    prayerState.data = cachedFallback.payload;
    prayerState.cachedFallback = true;
    prayerState.error = '';
    prayerState.notice = cachedPrayerNotice(cachedFallback);
    prayerState.loading = false;
    renderPrayerPage();
    return;
  }

  const requestId = ++prayerState.requestId;
  prayerState.loading = true;
  prayerState.error = '';
  prayerState.notice = '';
  prayerState.data = null;
  renderPrayerPage();

  try {
    const params = new URLSearchParams({ date });
    if (usingAuto) {
      params.set('latitude', prayerState.coordinates.latitude.toFixed(1));
      params.set('longitude', prayerState.coordinates.longitude.toFixed(1));
    } else {
      params.set('city', prayerState.city);
    }
    const payload = await apiFetch(`/prayer-times?${params.toString()}`);
    if (requestId !== prayerState.requestId) return;
    prayerState.data = payload;
    prayerState.cachedFallback = false;
    writeCachedPrayerSchedule(date, payload);
  } catch (error) {
    if (requestId !== prayerState.requestId) return;
    const cached = cachedFallback || getCachedPrayerFallback(date);
    if (cached) {
      prayerState.data = cached.payload;
      prayerState.cachedFallback = true;
      prayerState.notice = cachedPrayerNotice(cached);
    } else {
      prayerState.cachedFallback = false;
      prayerState.error = error.message || 'Jadwal salat belum dapat dimuat.';
    }
  } finally {
    if (requestId === prayerState.requestId) {
      prayerState.loading = false;
      renderPrayerPage();
    }
  }
}

function changePrayerCity(city) {
  if (!Object.hasOwn(prayerCityTimezones, city)) return;
  prayerState.locationRequestId += 1;
  prayerState.city = city;
  prayerState.locationMode = 'city';
  prayerState.coordinates = null;
  prayerState.locating = false;
  prayerState.data = null;
  prayerState.error = '';
  prayerState.notice = '';
  prayerState.cachedFallback = false;
  prayerState.locationNotice = '';
  window.localStorage.setItem(prayerPreferenceStorageKey, city);
  window.localStorage.setItem(prayerLocationModeStorageKey, 'city');
  qiblaState.status = 'Arah perkiraan berdasarkan pusat kota yang dipilih.';
  renderQiblaCompass();
  void loadPrayerSchedule(true);
}

function openPrayerSchedule() {
  setActivePage('prayer', 'prayer');
  renderPrayerPage();
  if (prayerState.locationMode === 'auto' && !prayerState.coordinates && !prayerState.locating) {
    requestPrayerDeviceLocation();
  } else {
    void loadPrayerSchedule();
  }
  if (!prayerState.timer) {
    prayerState.timer = window.setInterval(() => {
      if (!prayerState.data) return;
      const timezone = prayerActiveTimezone();
      const currentDate = prayerDateKey(timezone);
      if (!prayerState.cachedFallback && currentDate !== prayerState.data.date?.gregorian) {
        void loadPrayerSchedule(true);
        return;
      }
      renderPrayerNext();
    }, 1000);
  }
}

window.openPrayerSchedule = openPrayerSchedule;
window.changePrayerCity = changePrayerCity;
window.activateQiblaCompass = activateQiblaCompass;
window.togglePrayerCityMenu = togglePrayerCityMenu;
window.addEventListener('online', () => {
  if (prayerState.cachedFallback && document.getElementById('prayerPage')?.classList.contains('is-active')) {
    void loadPrayerSchedule(true);
  }
});
buildPrayerCityMenu();
renderPrayerPage();
