# Sistem Absensi Klub Renang — Railway + Discord Bot

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
| Rekap Otomatis | Rekap harian dikirim jam 19:00 WIB; rekap sheet harian jam 23:55 WIB; rekap sheet bulanan di akhir bulan jam 19:00 WIB |

---

## Deploy ke Railway

### 1. Siapkan Repository

```bash
git init
git add .
git commit -m "init"
```

Push ke GitHub, lalu connect di [railway.app](https://railway.app).

### 2. Tambah Plugin PostgreSQL

Di Railway dashboard → **New** → **Database** → **PostgreSQL**.

`DATABASE_URL` otomatis ter-inject.

### 3. Set Environment Variables

| Variabel | Nilai |
|---|---|
| `DISCORD_TOKEN` | Token bot dari Discord Developer Portal |
| `DISCORD_CHANNEL_ID` | ID channel untuk log scan real-time |
| `DISCORD_CHANNEL_REKAP_HARIAN` | ID channel untuk rekap sheet harian otomatis |
| `DISCORD_CHANNEL_REKAP_BULANAN` | ID channel untuk rekap sheet bulanan otomatis |
| `BASE_URL` | `https://nama-proyek.up.railway.app` (Railway public domain) |
| `GOOGLE_SHEET_ID` | ID Google Spreadsheet untuk export rekap |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Isi JSON service account Google (satu baris) |

> **Catatan:** `DISCORD_CHANNEL_REKAP_HARIAN` dan `DISCORD_CHANNEL_REKAP_BULANAN`
> opsional. Jika tidak diset, bot akan menggunakan ID channel default yang sudah
> dikonfigurasi di dalam kode.

### 4. Siapkan Google Sheets (untuk fitur rekap sheet)

1. Buat project di [Google Cloud Console](https://console.cloud.google.com) dan aktifkan **Google Sheets API** serta **Google Drive API**.
2. Buat **Service Account**, lalu download kunci JSON-nya.
3. Buat Google Spreadsheet, lalu **share** ke email service account dengan akses **Editor**.
4. Salin Spreadsheet ID dari URL (`https://docs.google.com/spreadsheets/d/**ID_DI_SINI**/edit`).
5. Isi `GOOGLE_SHEET_ID` dan `GOOGLE_SERVICE_ACCOUNT_JSON` di Railway environment variables.

### 5. Seed Data Atlet

Edit `data/athletes.json` dengan data atlet nyata:

```json
[
  { "code": "ATL001", "name": "Nama Atlet 1" },
  { "code": "ATL002", "name": "Nama Atlet 2" }
]
```

Lalu panggil endpoint seed **setelah deploy**:

```bash
curl -X POST https://nama-proyek.up.railway.app/athletes/seed
```

QR code otomatis ter-generate untuk semua atlet.

---

## Penggunaan Bot Discord

### Melihat QR Code Atlet

```
/qr Budi           → QR code by nama (partial match)
/qr ATL001         → QR code by kode atlet
/qr-zip            → Download semua QR dalam file ZIP
```

Bot mengirim gambar QR code yang bisa dicetak atau ditampilkan di HP.
Jika nama cocok dengan lebih dari satu atlet, semua QR yang cocok ditampilkan (maks 5).

### Absensi Harian

```
/rekap                       → semua atlet hari ini per coach & kelas
/rekap-coach Coach Ahmad     → rekap satu coach
/hadir                       → ringkasan cepat per coach & kelas
```

### Rekap Bulanan

```
/rekap-bulanan               → bulan ini (ringkasan per hari)
/rekap-bulanan bulan:6 tahun:2025

/hadir-bulan                 → ranking kehadiran bulan ini
/hadir-bulan bulan:6 tahun:2025
```

### Export ke Google Sheets

```
/rekap-sheet                         → export bulan ini (tgl 1 s/d hari ini)
/rekap-sheet-bulan                   → export bulan ini (penuh)
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
Pelatih buka scan.html di HP
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
klub-renang-railway/
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
