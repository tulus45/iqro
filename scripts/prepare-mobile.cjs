const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

const root = path.resolve(__dirname, '..');
const webDir = path.join(root, 'www');
const assets = [
  'index.html',
  'quran-offline.js',
  'style.css',
  'mobile.css',
  'community.js',
  'prayer.js',
  'admin.js',
  'favicon.svg',
  'quran.png',
  'mobile-runtime.js',
  'assets/fonts/LPMQ-Isep-Misbah-1.00.otf',
  'assets/fonts/LPMQ-Isep-Misbah.SOURCE.md',
  'assets/fonts/ScheherazadeNew-Regular-4.500.woff2',
  'assets/fonts/ScheherazadeNew-OFL.txt',
  'assets/fonts/ScheherazadeNew.SOURCE.md',
  'assets/fonts/KFGQPC-Hafs-Uthmanic-V22.woff2',
  'assets/fonts/KFGQPC-Hafs.EULA.md',
  'assets/fonts/KFGQPC-Hafs.SOURCE.md',
  'assets/quran/kfgqpc-hafs-v2.0.json',
  'assets/quran/KFGQPC-Hafs.SOURCE.md'
];

fs.rmSync(webDir, { recursive: true, force: true });
fs.mkdirSync(webDir, { recursive: true });
assets.forEach((asset) => {
  const destination = path.join(webDir, asset);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(path.join(root, asset), destination);
});

esbuild.buildSync({
  entryPoints: [path.join(root, 'mobile-src', 'native-runtime.js')],
  outfile: path.join(webDir, 'mobile-runtime.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['chrome120'],
  minify: true
});

console.log('Mobile web assets prepared in www/');
