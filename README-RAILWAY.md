# Sistem Absensi Klub Renang — VPS Linux + Discord Bot

Sistem absensi berbasis QR Code untuk klub renang. Pelatih scan QR code atlet
via kamera HP, data masuk ke database PostgreSQL, bot Discord menampilkan log
real-time serta rekap lengkap, dan rekap otomatis ter-export ke Google Sheets.

---

## Fitur

| Fitur | Keterangan |
|---|---|
| QR Code per Atlet | Setiap atlet punya QR unik yang di-scan pelatih |
| `/qr <nama>` | Tampil QR code atlet langsung di Discord |
| `/qr-zip` | Download semua QR atlet dalam satu file ZIP |
| `/rekap` | Rekap absensi hari ini per coach & kelas |
| `/rekap-bulanan` | Ringkasan absensi per hari dalam satu bulan |
| `/rekap-coach <nama>` | Rekap satu coach hari ini |
| `/rekap-sheet` | Export rekap bulan berjalan (tgl 1 s/d hari ini) ke Google Sheets |
| `/rekap-sheet-bulan` | Export rekap bulan tertentu ke Google Sheets |
| `/hadir` | Ringkasan jumlah hadir per coach & kelas hari ini |
| `/hadir-bulan` | Ranking kehadiran atlet dalam satu bulan |
| `/riwayat <nama>` | 30 sesi terakhir satu atlet |
| `/atlet` | Daftar semua atlet terdaftar |
| `/bantuan` | Daftar semua perintah |
| Log Real-time | Setiap scan langsung muncul di channel Discord |
| Rekap Otomatis | Rekap harian Discord jam 19:00 WIB · rekap sheet harian jam 23:55 WIB · rekap sheet bulanan di akhir bulan |

---

## Deploy ke VPS Linux (Ubuntu / Debian)

### 1. Persiapan Server

Pastikan VPS sudah terinstall **Node.js 18+**, **PostgreSQL**, **Nginx**, dan **PM2**.

```bash
# Update sistem
sudo apt update && sudo apt upgrade -y

# Install Node.js 18
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# Install PostgreSQL
sudo apt install -y postgresql postgresql-contrib

# Install Nginx
sudo apt install -y nginx

# Install PM2 (process manager)
sudo npm install -g pm2
```

---

### 2. Siapkan Database PostgreSQL

```bash
# Masuk sebagai user postgres
sudo -u postgres psql

# Buat database dan user
CREATE DATABASE klubrenang;
CREATE USER renanguser WITH PASSWORD 'password_kuat_kamu';
GRANT ALL PRIVILEGES ON DATABASE klubrenang TO renanguser;
\q
```

Catat connection string-nya:
```
postgresql://renanguser:password_kuat_kamu@localhost:5432/klubrenang
```

> Tabel akan dibuat otomatis saat aplikasi pertama kali dijalankan — tidak perlu import SQL manual.

---

### 3. Clone & Install Aplikasi

```bash
# Clone repo (atau upload file ke VPS)
git clone https://github.com/username/repo-kamu.git /var/www/klubrenang
cd /var/www/klubrenang

# Install dependencies
npm install
```

---

### 4. Konfigurasi Environment Variables

Salin file contoh dan isi nilainya:

```bash
cp .env.example .env
nano .env
```

Isi file `.env`:

```env
# Discord Bot
DISCORD_TOKEN=token_bot_discord_kamu
DISCORD_CHANNEL_ID=id_channel_log_scan
DISCORD_CHANNEL_REKAP_HARIAN=id_channel_rekap_harian
DISCORD_CHANNEL_REKAP_BULANAN=id_channel_rekap_bulanan

# Database (sesuaikan dengan yang dibuat di langkah 2)
DATABASE_URL=postgresql://renanguser:password_kuat_kamu@localhost:5432/klubrenang

# URL publik VPS (digunakan untuk link QR code di Discord)
BASE_URL=https://domain-atau-ip-kamu.com

# Port aplikasi (Nginx akan forward ke sini)
PORT=3000

# Google Sheets (opsional, untuk fitur /rekap-sheet)
GOOGLE_SHEET_ID=id_spreadsheet_kamu
GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account","project_id":"..."}
```

---

### 5. Jalankan dengan PM2

PM2 memastikan aplikasi tetap berjalan setelah server reboot.

```bash
# Jalankan aplikasi
pm2 start src/server.js --name klubrenang

# Simpan konfigurasi PM2 agar auto-start saat reboot
pm2 save
pm2 startup
# Jalankan perintah yang muncul dari output pm2 startup

# Cek status
pm2 status
pm2 logs klubrenang
```

---

### 6. Konfigurasi Nginx (Reverse Proxy)

Buat file konfigurasi Nginx untuk domain kamu:

```bash
sudo nano /etc/nginx/sites-available/klubrenang
```

Isi dengan konfigurasi berikut:

```nginx
server {
    listen 80;
    server_name domain-atau-ip-kamu.com;

    # Batasi ukuran upload (untuk keamanan)
    client_max_body_size 10M;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Aktifkan konfigurasi:

```bash
sudo ln -s /etc/nginx/sites-available/klubrenang /etc/nginx/sites-enabled/
sudo nginx -t        # cek tidak ada error
sudo systemctl reload nginx
```

---

### 7. Pasang SSL dengan Certbot (HTTPS)

Agar QR code dan halaman scan bisa diakses dari HP pelatih via HTTPS:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d domain-kamu.com

# Renewal otomatis sudah dikonfigurasi oleh certbot
# Test renewal:
sudo certbot renew --dry-run
```

Setelah ini, `BASE_URL` di `.env` ubah ke `https://domain-kamu.com` dan restart:

```bash
pm2 restart klubrenang
```

---

### 8. Seed Data Atlet

Edit `data/athletes.json` dengan data atlet nyata:

```json
[
  { "code": "ATL001", "name": "Nama Atlet 1" },
  { "code": "ATL002", "name": "Nama Atlet 2" }
]
```

Lalu panggil endpoint seed:

```bash
curl -X POST https://domain-kamu.com/athletes/seed
```

QR code otomatis ter-generate untuk semua atlet.

---

### 9. Siapkan Google Sheets (Opsional)

Diperlukan untuk fitur `/rekap-sheet` dan `/rekap-sheet-bulan`.

1. Buat project di [Google Cloud Console](https://console.cloud.google.com) dan aktifkan **Google Sheets API** serta **Google Drive API**.
2. Buat **Service Account**, lalu download kunci JSON-nya.
3. Buat Google Spreadsheet, lalu **share** ke email service account dengan akses **Editor**.
4. Salin Spreadsheet ID dari URL: `https://docs.google.com/spreadsheets/d/**ID_DI_SINI**/edit`
5. Isi `GOOGLE_SHEET_ID` dan `GOOGLE_SERVICE_ACCOUNT_JSON` di file `.env`, lalu:

```bash
pm2 restart klubrenang
```

---

## Penggunaan Bot Discord

### Melihat QR Code Atlet

```
/qr Budi           → QR code by nama (partial match)
/qr ATL001         → QR code by kode atlet
/qr-zip            → Download semua QR dalam file ZIP
```

Bot mengirim gambar QR code yang bisa dicetak atau ditampilkan di HP.
Jika nama cocok lebih dari satu atlet, semua QR yang cocok ditampilkan (maks 5).

### Absensi Harian

```
/rekap                       → semua atlet hari ini per coach & kelas
/rekap-coach Coach Ahmad     → rekap satu coach
/hadir                       → ringkasan cepat per coach & kelas
```

### Rekap Bulanan

```
/rekap-bulanan                         → bulan ini (ringkasan per hari)
/rekap-bulanan bulan:6 tahun:2025

/hadir-bulan                           → ranking kehadiran bulan ini
/hadir-bulan bulan:6 tahun:2025
```

### Export ke Google Sheets

```
/rekap-sheet                           → export bulan ini (tgl 1 s/d hari ini)
/rekap-sheet-bulan                     → export bulan ini (penuh)
/rekap-sheet-bulan bulan:5 tahun:2025
```

Sheet dibuat per coach dalam tab terpisah. Kolom: Tanggal | Pemula | Lanjutan | Prestasi.

### Data Atlet

```
/atlet                → daftar semua atlet
/riwayat Budi         → riwayat kehadiran Budi (30 sesi terakhir)
/bantuan              → daftar semua perintah
```

---

## Rekap Otomatis (Cron)

Bot menjalankan tiga jadwal otomatis tanpa interaksi manual:

| Jadwal | Waktu | Keterangan |
|---|---|---|
| Rekap harian Discord | Setiap hari jam **19:00 WIB** | Embed rekap absensi hari ini dikirim ke channel |
| Rekap sheet harian | Setiap hari jam **23:55 WIB** | Data 1 s/d hari ini di-update ke Google Sheets |
| Rekap sheet bulanan | **Hari terakhir** setiap bulan jam **19:00 WIB** | Sheet bulanan final ter-generate ke Google Sheets |

---

## Alur Absensi

```
Pelatih buka https://domain-kamu.com/scan.html di HP
       ↓
Pilih Coach & Kelas
       ↓
Scan QR code atlet
       ↓
Server catat ke PostgreSQL
       ↓
Bot kirim notifikasi ke Discord channel
```

Jika atlet sudah scan di sesi yang sama, sistem memberi notifikasi duplikat (tidak dicatat ulang).

---

## Perintah PM2 yang Berguna

```bash
pm2 status                  # cek status semua proses
pm2 logs klubrenang         # lihat log real-time
pm2 logs klubrenang --lines 100   # 100 baris log terakhir
pm2 restart klubrenang      # restart aplikasi
pm2 stop klubrenang         # hentikan sementara
pm2 delete klubrenang       # hapus dari PM2
```

---

## API Endpoints

| Method | Path | Keterangan |
|---|---|---|
| `POST` | `/scan` | Proses scan QR (body: `code`, `coach`, `kelas`) |
| `GET` | `/athletes` | Daftar atlet + `qr_url` |
| `GET` | `/athletes/:code/qr` | Redirect ke gambar QR atlet |
| `POST` | `/athletes/seed` | Seed dari `athletes.json` + generate QR |
| `POST` | `/athletes/generate-qr` | Re-generate semua QR code |
| `GET` | `/attendance/today` | Absensi hari ini (JSON) |
| `GET` | `/attendance/monthly?year=&month=` | Absensi bulanan (JSON) |
| `GET` | `/attendance/coach/:coach` | Absensi per coach hari ini (JSON) |

---

## Struktur Folder

```
klubrenang/
├── src/
│   ├── server.js          # Express server & API
│   ├── bot.js             # Discord bot, slash commands & cron
│   ├── db.js              # Query PostgreSQL
│   ├── qr-generator.js    # Generate QR code PNG
│   └── sheets.js          # Integrasi Google Sheets
├── public/
│   └── scan.html          # Halaman scan untuk HP pelatih
├── qr/                    # Folder QR code PNG (auto-generated)
├── data/
│   └── athletes.json      # Data atlet untuk seed
├── .env.example
└── package.json
```
