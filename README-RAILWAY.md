# Sistem Absensi Klub Renang — Railway + Discord Bot

Sistem absensi berbasis QR Code untuk klub renang. Pelatih scan QR code atlet
via kamera HP, data masuk ke database PostgreSQL, dan bot Discord menampilkan
log real-time serta rekap lengkap.

---

## Fitur

| Fitur | Keterangan |
|---|---|
| QR Code per Atlet | Setiap atlet punya QR unik yang di-scan pelatih |
| `/qr <nama>` | Tampil QR code atlet langsung di Discord |
| `/rekap` | Rekap absensi hari ini per coach & kelas |
| `/rekap-bulanan` | Rekap per hari dalam satu bulan |
| `/rekap-coach <nama>` | Rekap satu coach hari ini |
| `/hadir` | Ringkasan jumlah hadir |
| `/riwayat <nama>` | 30 sesi terakhir satu atlet |
| `/atlet` | Daftar semua atlet terdaftar |
| `/bantuan` | Daftar semua perintah |
| Log Real-time | Setiap scan langsung muncul di channel Discord |

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
| `DISCORD_CHANNEL_ID` | ID channel untuk log scan |
| `BASE_URL` | `https://nama-proyek.up.railway.app` (Railway public domain) |

### 4. Seed Data Atlet

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
/qr Budi
/qr ATL001
/qr Siti
```

Bot akan mengirim gambar QR code yang bisa dicetak atau ditampilkan di HP.

### Absensi Harian

```
/rekap                       → semua atlet hari ini
/rekap-coach Coach Ahmad     → rekap satu coach
/hadir                       → ringkasan cepat
```

### Rekap Bulanan

```
/rekap-bulanan               → bulan ini
/rekap-bulanan bulan:6 tahun:2025
```

### Data Atlet

```
/atlet                       → daftar semua atlet
/riwayat Budi                → riwayat kehadiran Budi
```

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

---

## API Endpoints

| Method | Path | Keterangan |
|---|---|---|
| `POST` | `/scan` | Proses scan QR |
| `GET` | `/athletes` | Daftar atlet + qr_url |
| `GET` | `/athletes/:code/qr` | Redirect ke gambar QR |
| `POST` | `/athletes/seed` | Seed dari athletes.json |
| `POST` | `/athletes/generate-qr` | Re-generate semua QR |
| `GET` | `/attendance/today` | Absensi hari ini (JSON) |
| `GET` | `/attendance/monthly` | Absensi bulanan (JSON) |
| `GET` | `/attendance/coach/:coach` | Absensi per coach (JSON) |

---

## Struktur Folder

```
klub-renang-railway/
├── src/
│   ├── server.js          # Express server & API
│   ├── bot.js             # Discord bot & slash commands
│   ├── db.js              # Query PostgreSQL
│   └── qr-generator.js   # Generate QR code PNG
├── public/
│   └── scan.html          # Halaman scan untuk HP pelatih
├── qr/                    # Folder QR code PNG (auto-generated)
├── data/
│   └── athletes.json      # Data atlet untuk seed
├── .env.example
└── package.json
```
