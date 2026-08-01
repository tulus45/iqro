import { Capacitor, SystemBars, SystemBarsStyle } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Geolocation } from '@capacitor/geolocation';
import { Preferences } from '@capacitor/preferences';

const SESSION_KEY = 'iqro_session_token';
const isNative = Capacitor.isNativePlatform();

if (isNative) {
  document.documentElement.classList.add('is-native-app');
  window.IQRO_API_BASE_URL = 'https://iqro.alus.my.id/api';
}

async function getSessionToken() {
  if (!isNative) return window.localStorage.getItem(SESSION_KEY) || '';
  const { value } = await Preferences.get({ key: SESSION_KEY });
  return value || '';
}

async function setSessionToken(token) {
  if (!isNative) return;
  if (token) {
    await Preferences.set({ key: SESSION_KEY, value: String(token) });
  } else {
    await Preferences.remove({ key: SESSION_KEY });
  }
}

async function getCurrentPosition(options = {}) {
  if (!isNative) {
    return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, options));
  }

  let permission = await Geolocation.checkPermissions();
  if (permission.location === 'prompt' || permission.location === 'prompt-with-rationale') {
    permission = await Geolocation.requestPermissions({ permissions: ['location'] });
  }
  if (permission.location !== 'granted' && permission.coarseLocation !== 'granted') {
    throw { code: 1, message: 'Izin lokasi belum diberikan.' };
  }
  return Geolocation.getCurrentPosition(options);
}

window.IqroNative = { isNative, getSessionToken, setSessionToken, getCurrentPosition };

if (isNative) {
  App.addListener('backButton', () => {
    const menu = document.getElementById('mobileMenuBackdrop');
    if (menu && !menu.hidden) {
      window.closeMobileMenu?.();
      return;
    }

    const popup = document.getElementById('customPopup');
    if (popup?.style.display === 'flex') {
      popup.style.display = 'none';
      return;
    }

    const mushafPage = document.getElementById('mushafPage');
    if (mushafPage?.classList.contains('is-active')) {
      window.closeMushaf?.();
      return;
    }

    const activePage = document.querySelector('.page.is-active');
    if (activePage && activePage.id !== 'homePage') {
      window.showHome?.();
      return;
    }

    void App.minimizeApp();
  });
}
window.iqroNativeReady = (async () => {
  if (!isNative) return;
  await SystemBars.show();
  await SystemBars.setStyle({ style: SystemBarsStyle.Light });
  const token = await getSessionToken();
  if (token) window.localStorage.setItem(SESSION_KEY, token);
})().catch(() => undefined);
