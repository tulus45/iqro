# Deploy Iqro v1.8.4 ke VPS

Rilis ini menggunakan backend JSON dengan antrean transaksi **satu proses**. Jangan menjalankan instance kedua atau PM2 cluster terhadap database yang sama. APK lama tetap kompatibel dengan respons progress backend.

## Update aplikasi yang sudah berjalan

Jalankan dengan user VPS yang selama ini mengelola proses PM2 Iqro. Pastikan Node.js mendukung `fetch` dan `structuredClone`, Git working tree bersih, dan konfigurasi `server/.env` tetap tersedia.

```bash
cd /var/www/iqro
git status --short
git pull --ff-only origin main
git log -1 --oneline
npm test
npm run quran:split:verify
npm run quran:tajweed:verify
```

Lanjutkan hanya jika semua pemeriksaan lulus. Backend tidak memiliki dependency npm eksternal, sehingga update ini tidak memerlukan `npm install` di VPS.

Hentikan proses sebentar untuk membuat salinan database yang konsisten. Backup ditempatkan di luar document root:

```bash
pm2 stop iqro-api
umask 077
mkdir -p "$HOME/iqro-backups"
cp server/data/app-db.json "$HOME/iqro-backups/app-db-before-v1.8.4-$(date +%Y%m%d-%H%M%S).json"
```

Jika memakai `IQRO_DATA_FILE` khusus, gunakan lokasi tersebut pada perintah backup. Jangan lanjut jika backup gagal. Setelah backup berhasil:

```bash
cd /var/www/iqro/server
pm2 startOrRestart ecosystem.config.cjs --update-env
pm2 save
curl --fail http://127.0.0.1:4720/api/health
pm2 logs iqro-api --lines 30 --nostream
```

Pastikan PM2 menjalankan tepat satu instance dalam mode fork. Uji login, simpan progress, buka surat dengan tajwid, dan buka komunitas di `https://iqro.alus.my.id/`.

## Aset dan akses web

Kedua direktori `assets/quran/kfgqpc-hafs-v2.0/` dan `assets/quran/uthmani-tajweed-v4/` harus tersedia. Keduanya ikut repository dan sudah diverifikasi terhadap sumber lengkap. Jangan menghapus database atau `.env` saat deploy.

Web server harus menolak akses publik ke `/server/`, `/.git/`, dan `/android/`. Database, `.bak`, dan file sementara bukan aset publik. Pertahankan reverse proxy `/api/` ke port 4720 dan konfigurasi HTTPS yang sudah berjalan.

## Pemulihan

Jika API menolak database rusak, hentikan proses PM2 terlebih dahulu. Simpan salinan file yang rusak untuk investigasi, periksa backup sebelum rilis, lalu pulihkan backup valid ke lokasi database. Pastikan owner dan izin file sesuai user PM2 sebelum menjalankan backend lagi. Pemulihan backup dapat menghilangkan perubahan setelah waktu backup; jangan lakukan otomatis.

## APK

APK v1.8.4 memiliki versionCode `10804` dan ditandatangani dengan kunci rilis Iqro yang sama. Unduh dari GitHub Releases. File `SHA256SUMS.txt` menyertakan checksum APK. Kunci signing dan password tidak disertakan dalam repository atau rilis.
