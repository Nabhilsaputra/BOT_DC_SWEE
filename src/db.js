/**
 * src/db.js
 * Semua interaksi dengan PostgreSQL.
 */

const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL
    ? { rejectUnauthorized: false }
    : false,
});

async function query(sql, params = []) {
  const client = await pool.connect();
  try {
    const result = await client.query(sql, params);
    return result;
  } finally {
    client.release();
  }
}

// ─── Inisialisasi tabel ───────────────────────────────────────────────────────

async function initDb() {
  await query(`
    CREATE TABLE IF NOT EXISTS athletes (
      id           SERIAL PRIMARY KEY,
      athlete_code TEXT    UNIQUE NOT NULL,
      name         TEXT    NOT NULL,
      qr_path      TEXT,
      created_at   TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS attendance (
      id           SERIAL PRIMARY KEY,
      athlete_code TEXT    NOT NULL,
      coach        TEXT    NOT NULL DEFAULT '',
      kelas        TEXT    NOT NULL DEFAULT '',
      scan_time    TIMESTAMPTZ DEFAULT NOW(),
      FOREIGN KEY (athlete_code) REFERENCES athletes(athlete_code)
    )
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_attendance_date
    ON attendance (scan_time)
  `);

  // Tambah kolom qr_path jika upgrade dari versi lama
  await query(`
    ALTER TABLE athletes ADD COLUMN IF NOT EXISTS qr_path TEXT
  `).catch(() => {});

  console.log("✅ Database PostgreSQL siap.");
}

// ─── Atlet ────────────────────────────────────────────────────────────────────

async function getAthleteByCode(code) {
  const res = await query(
    "SELECT * FROM athletes WHERE athlete_code = $1",
    [code]
  );
  return res.rows[0] || null;
}

async function getAthleteByName(name) {
  const res = await query(
    "SELECT * FROM athletes WHERE LOWER(name) LIKE LOWER($1)",
    [`%${name}%`]
  );
  return res.rows;
}

async function listAthletes() {
  const res = await query("SELECT * FROM athletes ORDER BY name ASC");
  return res.rows;
}

async function upsertAthleteQrPath(athleteCode, qrPath) {
  await query(
    "UPDATE athletes SET qr_path = $1 WHERE athlete_code = $2",
    [qrPath, athleteCode]
  );
}

// ─── Absensi ──────────────────────────────────────────────────────────────────

async function getTodayAttendanceForAthlete(athleteCode, coach, kelas) {
  const res = await query(
    `SELECT id FROM attendance
     WHERE athlete_code = $1
       AND coach = $2
       AND kelas = $3
       AND (scan_time AT TIME ZONE 'Asia/Jakarta')::date
           = (NOW() AT TIME ZONE 'Asia/Jakarta')::date`,
    [athleteCode, coach, kelas]
  );
  return res.rows[0] || null;
}

async function recordAttendance(athleteCode, coach, kelas) {
  const res = await query(
    "INSERT INTO attendance (athlete_code, coach, kelas) VALUES ($1, $2, $3) RETURNING id",
    [athleteCode, coach, kelas]
  );
  return { lastID: res.rows[0].id };
}

async function getTodayAttendance() {
  const res = await query(
    `SELECT a.athlete_code,
            t.name,
            a.scan_time,
            a.coach,
            a.kelas
     FROM   attendance a
     LEFT JOIN athletes t ON t.athlete_code = a.athlete_code
     WHERE  (a.scan_time AT TIME ZONE 'Asia/Jakarta')::date
            = (NOW() AT TIME ZONE 'Asia/Jakarta')::date
     ORDER  BY a.coach ASC, a.kelas ASC, a.scan_time ASC`
  );
  return res.rows;
}

async function getMonthlyAttendance(year, month) {
  const y  = year  || new Date().getFullYear();
  const m  = month || new Date().getMonth() + 1;
  const ym = `${y}-${String(m).padStart(2, "0")}`;

  const res = await query(
    `SELECT a.athlete_code,
            t.name,
            a.scan_time,
            a.coach,
            a.kelas,
            (a.scan_time AT TIME ZONE 'Asia/Jakarta')::date AS tanggal
     FROM   attendance a
     LEFT JOIN athletes t ON t.athlete_code = a.athlete_code
     WHERE  to_char(a.scan_time AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM') = $1
     ORDER  BY a.coach ASC, a.kelas ASC, a.scan_time ASC`,
    [ym]
  );
  return res.rows;
}

async function getTodayAttendanceByCoach(coach) {
  const res = await query(
    `SELECT a.athlete_code,
            t.name,
            a.scan_time,
            a.coach,
            a.kelas
     FROM   attendance a
     LEFT JOIN athletes t ON t.athlete_code = a.athlete_code
     WHERE  a.coach = $1
       AND  (a.scan_time AT TIME ZONE 'Asia/Jakarta')::date
            = (NOW() AT TIME ZONE 'Asia/Jakarta')::date
     ORDER  BY a.kelas ASC, a.scan_time ASC`,
    [coach]
  );
  return res.rows;
}

async function getAthleteAttendanceHistory(athleteCode, limit = 30) {
  const res = await query(
    `SELECT a.athlete_code,
            t.name,
            a.scan_time,
            a.coach,
            a.kelas,
            (a.scan_time AT TIME ZONE 'Asia/Jakarta')::date AS tanggal
     FROM   attendance a
     LEFT JOIN athletes t ON t.athlete_code = a.athlete_code
     WHERE  a.athlete_code = $1
     ORDER  BY a.scan_time DESC
     LIMIT  $2`,
    [athleteCode, limit]
  );
  return res.rows;
}

module.exports = {
  initDb,
  getAthleteByCode,
  getAthleteByName,
  listAthletes,
  upsertAthleteQrPath,
  getTodayAttendanceForAthlete,
  recordAttendance,
  getTodayAttendance,
  getMonthlyAttendance,
  getTodayAttendanceByCoach,
  getAthleteAttendanceHistory,
};
