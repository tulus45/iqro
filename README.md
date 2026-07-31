# Iqro Morning Pray

Aplikasi Iqro terdiri dari frontend statis di root project dan backend API ringan di `server/`.

## Target Deploy

- Domain: `iqro.alus.my.id`
- Repo: `https://github.com/tulus45/iqro`
- Folder aplikasi VPS: `/var/www/iqro`
- Folder backend VPS: `/var/www/iqro/server`
- Port API: `4720`
- Nama proses PM2: `iqro-api`

## Struktur Penting

- `index.html`: halaman utama, Al-Quran, dan Tahlil
- `style.css`: styling aplikasi
- `community.js`: login/daftar, penguncian navigasi, komunitas, dan sinkronisasi progress
- `admin.js`: menu privat `Kelola User` yang memakai sesi user yang sama
- `server/index.js`: API auth, komunitas, progress, dan pengelolaan user
- `server/ecosystem.config.cjs`: konfigurasi PM2
- `server/data/app-db.json`: data runtime aplikasi

## Alur Akses

1. Pengunjung hanya melihat Home dengan pilihan `Masuk` atau `Daftar`.
2. Al-Quran, Tahlil, dan Komunitas baru muncul setelah login berhasil.
3. User biasa mendapat seluruh fitur membaca dan komunitas.
4. Akun dengan role `owner` mendapat satu menu tambahan: `Kelola User`.
5. Tidak ada login atau halaman Admin terpisah.

## Fitur User

- Mengajukan akun dengan nama, nomor HP, password, dan persetujuan Akad Kebaikan
- Akun baru berstatus menunggu persetujuan dan baru dapat login setelah diaktifkan pemilik
- Login menggunakan nomor HP dan password
- Mengajukan lupa password melalui WhatsApp dengan nomor pengirim yang harus sama dengan nomor akun
- Ganti password sendiri dari halaman Komunitas
- Menyimpan daftar nama almarhum/almarhumah per akun untuk ditampilkan otomatis pada bacaan Tahlil
- Menyimpan progress tilawah ke akun
- Melihat aktivitas kontak berupa jumlah ayat unik yang ditandai hari ini dan bacaan terakhir
- Menambah teman berdasarkan nomor HP terdaftar
- Membuat group keluarga dan menambah anggota
- Melihat ringkasan progress teman dan group

## Fitur Pemilik Aplikasi

Menu `Kelola User` hanya terlihat untuk akun dengan role `owner`.

- Melihat seluruh user aplikasi dalam tabel ringkas
- Mencari user berdasarkan nama atau nomor HP
- Menampilkan daftar user maksimal 25 akun per halaman
- Daftar user tidak menampilkan data teman, group, atau riwayat baca
- Mengaktifkan permohonan akun baru atau menangguhkan akun aktif
- Membuka WhatsApp untuk mengabarkan bahwa akun user sudah aktif
- Mengirim password sementara acak ke nomor WhatsApp user
- Melihat permintaan reset password yang disorot, lengkap dengan kode dan waktu permintaan
- Mewajibkan user membuat password baru saat login dengan password sementara
- Memutus sesi lama user setelah password direset
- Menghapus akun user beserta sesi, progress, dan relasinya
- Memindahkan kepemilikan group saat pemilik group dihapus

## Jalankan Lokal

### Frontend

```powershell
cd "D:\The Alus\Iqro"
py -3 -m http.server 8080
```

Buka `http://127.0.0.1:8080/`.

### Backend

Buka terminal baru:

```powershell
cd "D:\The Alus\Iqro\server"
npm.cmd start
```

Health check: `http://127.0.0.1:4720/api/health`.

### Akun Pemilik Lokal

Dalam mode lokal/non-production, backend menyiapkan akun berikut:

- Nomor HP: `085111344717`
- Password: `Admin#Iqro2026`

Akun ini login dari form yang sama di Home. Setelah login, menu `Kelola User` akan muncul.

## Setup Pemilik Production

Di production, tentukan akun pemilik aplikasi melalui environment variable sebelum backend dijalankan:

- `IQRO_OWNER_PHONE`
- `IQRO_OWNER_PASSWORD`
- `IQRO_OWNER_NAME` opsional

Nomor HP tersebut akan dibuat sebagai akun pemilik jika belum ada. Jika sudah terdaftar, role akun akan dinaikkan menjadi `owner` tanpa menghapus data, group, teman, atau progress.

```bash
export IQRO_OWNER_PHONE='08xxxxxxxxxx'
export IQRO_OWNER_PASSWORD='password-yang-kuat'
export IQRO_OWNER_NAME='Pemilik Iqro'
cd /var/www/iqro/server
pm2 start ecosystem.config.cjs --update-env
pm2 save
```

Jika proses PM2 sudah ada:

```bash
cd /var/www/iqro/server
pm2 restart iqro-api --update-env
```

## Reset Password via WhatsApp

Reset password tidak menggunakan WhatsApp Cloud API, access token, atau template Meta. Pemilik aplikasi menekan `Reset` atau `Proses Reset`, lalu aplikasi membuka WhatsApp ke nomor user dengan pesan password sementara yang sudah terisi.

User dapat membuat permintaan dari tautan `Lupa password?` pada halaman login. Backend menyimpan kode `RST-xxxxxx`, memprioritaskan akun tersebut di halaman `Kelola User`, dan membuka pesan WhatsApp ke pemilik. Pemilik wajib mencocokkan nomor pengirim chat dengan nomor akun serta kode permintaan sebelum menekan `Proses Reset`.

1. Backend membuat password sementara, mengganti password user, dan memutus sesi lamanya.
2. WhatsApp dibuka pada perangkat pemilik dengan nomor user dan isi pesan yang sudah disiapkan.
3. Pemilik memeriksa pesan lalu menekan tombol `Kirim` di WhatsApp.
4. User login memakai password sementara dan wajib membuat password baru.

Nomor pengirim mengikuti akun WhatsApp yang sedang aktif pada perangkat pemilik. Agar pesan berasal dari `+6285111344717`, nomor tersebut harus menjadi akun yang sedang login di aplikasi WhatsApp atau WhatsApp Web. Karena tidak memakai API, sistem tidak dapat memastikan apakah pemilik sudah menekan tombol `Kirim`.

## Persetujuan Akun via WhatsApp

Pendaftaran membuat akun secara otomatis dengan status `pending`, tanpa membuat sesi login. Aplikasi memprioritaskan deep link `whatsapp://` agar WhatsApp yang terpasang terbuka langsung ke nomor pemilik dengan pesan yang sudah terisi. Tautan `wa.me` tetap disediakan oleh backend sebagai fallback. Calon user tetap perlu menekan tombol `Kirim` di WhatsApp.

Pemilik mengaktifkan permohonan dari menu `Kelola User`. Setelah aktivasi, aplikasi membuka pesan WhatsApp pemberitahuan untuk user dan akun dapat digunakan untuk login. Pemilik juga dapat menangguhkan kembali akun aktif; tindakan ini langsung memutus seluruh sesi user tersebut.
## Deploy ke VPS

```bash
cd /var/www/iqro
git pull origin main
cd /var/www/iqro/server
pm2 restart iqro-api --update-env
```

Jangan menghapus `server/data/app-db.json` saat deploy agar akun dan progress tetap aman.

## Reverse Proxy

Web server perlu mengarahkan trafik berikut:

- `https://iqro.alus.my.id/` ke frontend statis `/var/www/iqro`
- `https://iqro.alus.my.id/api/...` ke `127.0.0.1:4720`
