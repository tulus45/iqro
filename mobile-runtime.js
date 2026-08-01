window.IqroNative = window.IqroNative || {
  isNative: false,
  getSessionToken: async () => window.localStorage.getItem('iqro_session_token') || '',
  setSessionToken: async () => {},
  getCurrentPosition: (options) => new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject({ code: 2 });
    navigator.geolocation.getCurrentPosition(resolve, reject, options);
  })
};
window.iqroNativeReady = window.iqroNativeReady || Promise.resolve();
