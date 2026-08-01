const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

const root = path.resolve(__dirname, '..');
const webDir = path.join(root, 'www');
const assets = ['index.html', 'style.css', 'mobile.css', 'community.js', 'prayer.js', 'admin.js', 'favicon.svg', 'quran.png', 'mobile-runtime.js'];

fs.rmSync(webDir, { recursive: true, force: true });
fs.mkdirSync(webDir, { recursive: true });
assets.forEach((asset) => fs.copyFileSync(path.join(root, asset), path.join(webDir, asset)));

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
