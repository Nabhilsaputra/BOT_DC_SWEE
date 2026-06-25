/**
 * src/server.js
 * Express server — melayani halaman scan dan REST API absensi.
 *
 * Endpoints:
 *   POST /scan                            — proses scan QR
 *   GET  /attendance/today                — rekap absensi hari ini (JSON)
 *   GET  /attendance/monthly?year=&month= — rekap bulanan (JSON)
 *   GET  /attendance/coach/:coach         — rekap per coach hari ini (JSON)
 *   GET  /athletes                        — daftar semua atlet (JSON)
 *   GET  /athletes/:code/qr               — redirect ke gambar QR atlet
 *   POST /athletes/seed                   — isi data atlet dari athletes.json
 *   POST /athletes/generate-qr            — (re)generate semua QR code
 */

require("dotenv").config();

const path    = require("path");
const fs      = require("fs");
const express = require("express");
const cors    = require("cors");
const db      = require("./db");
const { startBot, sendAttendanceLog } = require("./bot");
const { generateQrForAthlete, generateQrForAll, getQrUrl, QR_DIR } = require("./qr-generator");

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));
app.use("/qr", express.static(QR_DIR));

// ─── Endpoints ────────────────────────────────────────────────────────────────

/**
 * POST /scan
 * Body: { code: string, coach: string, kelas: string }
 */
app.post("/scan", async (req, res) => {
  try {
    const code  = (req.body.code  || "").trim();
    const coach = (req.body.coach || "").trim();
    const kelas = (req.body.kelas || "").trim();

    if (!code)            return res.status(400).json({ success: false, message: "Kode QR tidak boleh kosong." });
    if (!coach || !kelas) return res.status(400).json({ success: false, message: "Coach dan kelas harus dipilih." });

    const athlete = await db.getAthleteByCode(code);
    if (!athlete) {
      return res.status(404).json({ success: false, message: `Kode "${code}" tidak terdaftar.` });
    }

    const sudahAbsen = await db.getTodayAttendanceForAthlete(code, coach, kelas);
    if (sudahAbsen) {
      sendAttendanceLog({ name: athlete.name, code, coach, kelas, isDuplicate: true });
      return res.json({ success: true, duplicate: true, name: athlete.name,
        message: `${athlete.name} sudah absen di sesi ini.` });
    }

    await db.recordAttendance(code, coach, kelas);
    sendAttendanceLog({ name: athlete.name, code, coach, kelas, isDuplicate: false });

    return res.json({ success: true, duplicate: false, name: athlete.name,
      message: `${athlete.name} berhasil absen.` });

  } catch (err) {
    console.error("[/scan]", err);
    res.status(500).json({ success: false, message: "Terjadi kesalahan server." });
  }
});

/** GET /attendance/today */
app.get("/attendance/today", async (req, res) => {
  try { res.json(await db.getTodayAttendance()); }
  catch (err) { res.status(500).json({ message: "Gagal mengambil data." }); }
});

/** GET /attendance/monthly?year=2025&month=6 */
app.get("/attendance/monthly", async (req, res) => {
  try {
    const year  = parseInt(req.query.year)  || null;
    const month = parseInt(req.query.month) || null;
    res.json(await db.getMonthlyAttendance(year, month));
  } catch (err) { res.status(500).json({ message: "Gagal mengambil data bulanan." }); }
});

/** GET /attendance/coach/:coach */
app.get("/attendance/coach/:coach", async (req, res) => {
  try { res.json(await db.getTodayAttendanceByCoach(req.params.coach)); }
  catch (err) { res.status(500).json({ message: "Gagal mengambil data." }); }
});

/** GET /athletes */
app.get("/athletes", async (req, res) => {
  try {
    const athletes = await db.listAthletes();
    // Tambahkan qr_url untuk tiap atlet
    const withQr = athletes.map(a => ({
      ...a,
      qr_url: getQrUrl(a.athlete_code, req),
    }));
    res.json(withQr);
  }
  catch (err) { res.status(500).json({ message: "Gagal mengambil data." }); }
});

/**
 * GET /athletes/:code/qr
 * Redirect ke gambar QR code atlet. Generate kalau belum ada.
 */
app.get("/athletes/:code/qr", async (req, res) => {
  try {
    const code    = req.params.code.toUpperCase();
    const athlete = await db.getAthleteByCode(code);
    if (!athlete) {
      return res.status(404).json({ message: `Atlet dengan kode "${code}" tidak ditemukan.` });
    }

    const qrFile = path.join(QR_DIR, `${code}.png`);
    if (!fs.existsSync(qrFile)) {
      await generateQrForAthlete(code, athlete.name);
    }

    res.redirect(`/qr/${code}.png`);
  } catch (err) {
    console.error("[/athletes/:code/qr]", err);
    res.status(500).json({ message: "Gagal mengambil QR code." });
  }
});

/**
 * POST /athletes/seed
 * Isi data atlet dari data/athletes.json ke database + generate QR code.
 */
app.post("/athletes/seed", async (req, res) => {
  try {
    const jsonPath = path.join(__dirname, "..", "data", "athletes.json");
    if (!fs.existsSync(jsonPath)) {
      return res.status(404).json({ message: "File data/athletes.json tidak ditemukan." });
    }
    const athletes = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
    const { Pool } = require("pg");
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
    });

    let inserted = 0;
    for (const a of athletes) {
      const { rowCount } = await pool.query(
        `INSERT INTO athletes (athlete_code, name)
         VALUES ($1, $2)
         ON CONFLICT (athlete_code) DO NOTHING`,
        [a.code, a.name]
      );
      if (rowCount > 0) inserted++;

      // Generate QR code untuk setiap atlet
      await generateQrForAthlete(a.code, a.name);
      await pool.query(
        "UPDATE athletes SET qr_path = $1 WHERE athlete_code = $2",
        [`qr/${a.code}.png`, a.code]
      );
    }
    await pool.end();

    res.json({
      message: `Seed selesai. ${inserted} atlet baru ditambahkan. QR code ter-generate untuk semua ${athletes.length} atlet.`,
      total: athletes.length,
      inserted,
    });
  } catch (err) {
    console.error("[/athletes/seed]", err);
    res.status(500).json({ message: "Gagal seed data atlet.", error: err.message });
  }
});

/**
 * POST /athletes/generate-qr
 * (Re)generate QR code untuk semua atlet yang ada di database.
 */
app.post("/athletes/generate-qr", async (req, res) => {
  try {
    const athletes = await db.listAthletes();
    if (!athletes.length) {
      return res.json({ message: "Tidak ada atlet di database.", generated: 0 });
    }

    let generated = 0;
    for (const a of athletes) {
      await generateQrForAthlete(a.athlete_code, a.name);
      await db.upsertAthleteQrPath(a.athlete_code, `qr/${a.athlete_code}.png`);
      generated++;
    }

    res.json({
      message: `QR code berhasil di-generate untuk ${generated} atlet.`,
      generated,
    });
  } catch (err) {
    console.error("[/athletes/generate-qr]", err);
    res.status(500).json({ message: "Gagal generate QR code.", error: err.message });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────

async function main() {
  await db.initDb();
  await startBot();
  app.listen(PORT, () => {
    console.log(`\n🚀 Server berjalan di port ${PORT}`);
    console.log(`   → Dashboard      : http://localhost:${PORT}`);
    console.log(`   → Scan (HP)      : http://localhost:${PORT}/scan.html`);
    console.log(`   → API hari ini   : http://localhost:${PORT}/attendance/today`);
    console.log(`   → Daftar Atlet   : http://localhost:${PORT}/athletes`);
    console.log(`   → QR Atlet       : http://localhost:${PORT}/athletes/ATL001/qr\n`);
  });
}

main().catch(err => {
  console.error("Gagal start server:", err);
  process.exit(1);
});
