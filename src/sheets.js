/**
 * src/sheets.js
 * Integrasi Google Sheets — generate rekap absensi per coach per bulan.
 *
 * Format sheet:
 *   - Satu file Sheets, tiap coach = satu tab (sheet)
 *   - Kolom: Tanggal | Pemula | Lanjutan | Prestasi
 *   - Baris: per tanggal dalam bulan, angka = jumlah atlet hadir
 */

const { google } = require("googleapis");

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const KELAS_LIST     = ["Pemula", "Lanjutan", "Prestasi"];

const BULAN_ID = [
  "", "Januari","Februari","Maret","April","Mei","Juni",
  "Juli","Agustus","September","Oktober","November","Desember",
];

// ─── Auth ─────────────────────────────────────────────────────────────────────

function getAuth() {
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  return new google.auth.GoogleAuth({
    credentials: creds,
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive",
    ],
  });
}

// ─── Helper: jumlah hari dalam bulan ─────────────────────────────────────────

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function getDayName(year, month, day) {
  const HARI = ["Min","Sen","Sel","Rab","Kam","Jum","Sab"];
  return HARI[new Date(year, month - 1, day).getDay()];
}

function isSunday(year, month, day) {
  return new Date(year, month - 1, day).getDay() === 0;
}

// ─── Ambil atau buat sheet tab untuk coach ───────────────────────────────────

async function getOrCreateSheet(sheets, coachName, year, month) {
  const tabName = `${coachName} - ${BULAN_ID[month]} ${year}`;

  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const existing = meta.data.sheets.find(
    s => s.properties.title === tabName
  );

  if (existing) {
    return { sheetId: existing.properties.sheetId, tabName, isNew: false };
  }

  // Buat sheet baru
  const res = await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      requests: [{
        addSheet: {
          properties: { title: tabName },
        },
      }],
    },
  });

  const sheetId = res.data.replies[0].addSheet.properties.sheetId;
  return { sheetId, tabName, isNew: true };
}

// ─── Tulis data rekap ke sheet ────────────────────────────────────────────────

async function writeRekapToSheet(sheets, tabName, sheetId, coachName, year, month, attendanceRows, upToDay = null) {
  const totalDays = upToDay || daysInMonth(year, month);
  const label     = `${BULAN_ID[month]} ${year}`;

  // ── Bangun data kehadiran per tanggal per kelas ──
  // attendanceRows: array dari db.getMonthlyAttendance filtered by coach
  const dataPerTgl = {}; // { "1": { Pemula: 3, Lanjutan: 2, Prestasi: 0 }, ... }
  for (let d = 1; d <= totalDays; d++) {
    dataPerTgl[d] = { Pemula: 0, Lanjutan: 0, Prestasi: 0 };
  }
  console.log("=== ATTENDANCE ROWS ===");
  
  for (const r of attendanceRows) {
    const tgl =
      r.tanggal instanceof Date
        ? r.tanggal.getDate()
        : new Date(r.tanggal).getDate();
  
    console.log("tgl:", tgl, "kelas:", r.kelas);
  
    if (dataPerTgl[tgl] && KELAS_LIST.includes(r.kelas)) {
      dataPerTgl[tgl][r.kelas]++;
    }
  }
  
  console.log(dataPerTgl);

  // ── Hitung total per kelas ──
  const totalPerKelas = { Pemula: 0, Lanjutan: 0, Prestasi: 0 };
  for (const d of Object.values(dataPerTgl)) {
    totalPerKelas.Pemula    += d.Pemula;
    totalPerKelas.Lanjutan  += d.Lanjutan;
    totalPerKelas.Prestasi  += d.Prestasi;
  }

  // ── Susun baris data ──
  // Row 1: Judul
  // Row 2: Sub-judul kelas
  // Row 3: Header kolom
  // Row 4+: Per tanggal
  // Row akhir: Total

  const headerRows = [
    // Row 1 — Judul
    [`ABSENSI PERTEMUAN COACH`, "", "", "", ""],
    [`TIRTAMULYA SWIMMING CLUB`, "", "", "", ""],
    [label.toUpperCase(), "", "", "", ""],
    ["", "", "", "", ""],
    // Row 5 — Info coach
    [`NAMA COACH`, `: ${coachName.toUpperCase()}`, "", "", ""],
    ["", "", "", "", ""],
    // Row 7 — Header tabel
    ["Tanggal", "Hari", "Pemula", "Lanjutan", "Prestasi"],
  ];

  const dataRows = [];
  for (let d = 1; d <= totalDays; d++) {
    const hari   = getDayName(year, month, d);
    const sunday = isSunday(year, month, d);
    const row    = [
      `${d}/${month}/${year}`,
      hari,
      sunday ? "MINGGU" : (dataPerTgl[d].Pemula   || ""),
      sunday ? ""        : (dataPerTgl[d].Lanjutan || ""),
      sunday ? ""        : (dataPerTgl[d].Prestasi || ""),
    ];
    dataRows.push(row);
  }

  // Row total
  const totalRow = [
    "TOTAL",
    "",
    totalPerKelas.Pemula   || "",
    totalPerKelas.Lanjutan || "",
    totalPerKelas.Prestasi || "",
  ];

  const allRows = [...headerRows, ...dataRows, totalRow];

  // ── Clear sheet dulu lalu tulis ulang ──
  await sheets.spreadsheets.values.clear({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${tabName}'!A1:Z200`,
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${tabName}'!A1`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: allRows },
  });

  // ── Format: bold header, warna baris Minggu, freeze row 7 ──
  const headerRowCount = headerRows.length;
  const requests = [
    // Bold judul (baris 1-3)
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 3, startColumnIndex: 0, endColumnIndex: 5 },
        cell: { userEnteredFormat: { textFormat: { bold: true }, horizontalAlignment: "CENTER" } },
        fields: "userEnteredFormat(textFormat,horizontalAlignment)",
      },
    },
    // Bold header tabel (baris 7)
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 6, endRowIndex: 7, startColumnIndex: 0, endColumnIndex: 5 },
        cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.8, green: 0.9, blue: 1 } } },
        fields: "userEnteredFormat(textFormat,backgroundColor)",
      },
    },
    // Bold + background baris TOTAL
    {
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: headerRowCount + totalDays,
          endRowIndex:   headerRowCount + totalDays + 1,
          startColumnIndex: 0, endColumnIndex: 5,
        },
        cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.9, green: 0.9, blue: 0.9 } } },
        fields: "userEnteredFormat(textFormat,backgroundColor)",
      },
    },
    // Freeze 7 baris pertama
    {
      updateSheetProperties: {
        properties: { sheetId, gridProperties: { frozenRowCount: 7 } },
        fields: "gridProperties.frozenRowCount",
      },
    },
    // Auto resize kolom
    {
      autoResizeDimensions: {
        dimensions: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: 5 },
      },
    },
  ];

  // Warnai baris Minggu dengan oranye muda
  for (let d = 1; d <= totalDays; d++) {
    if (isSunday(year, month, d)) {
      const rowIdx = headerRowCount + d - 1;
      requests.push({
        repeatCell: {
          range: { sheetId, startRowIndex: rowIdx, endRowIndex: rowIdx + 1, startColumnIndex: 0, endColumnIndex: 5 },
          cell: { userEnteredFormat: { backgroundColor: { red: 1, green: 0.85, blue: 0.6 } } },
          fields: "userEnteredFormat(backgroundColor)",
        },
      });
    }
  }

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { requests },
  });

  return tabName;
}

// ─── Main: generate rekap bulan ───────────────────────────────────────────────

/**
 * Generate rekap untuk semua coach dalam satu bulan.
 * @param {Array} rows   - hasil db.getMonthlyAttendance
 * @param {number} year
 * @param {number} month
 * @param {number} upToDay - opsional, batas hari (untuk /rekap-sheet mid-month)
 * @returns {string} URL spreadsheet
 */
async function generateRekapSheet(rows, year, month, upToDay = null) {
  if (!SPREADSHEET_ID) throw new Error("GOOGLE_SHEET_ID belum diset di environment.");

  const auth   = getAuth();
  const sheets = google.sheets({ version: "v4", auth });

  // Kelompokkan rows per coach
  const perCoach = {};
  for (const r of rows) {
    const c = r.coach || "Tidak Diketahui";
    (perCoach[c] ??= []).push(r);
  }

  const tabNames = [];
  for (const [coach, coachRows] of Object.entries(perCoach)) {
    const { sheetId, tabName } = await getOrCreateSheet(sheets, coach, year, month);
    await writeRekapToSheet(sheets, tabName, sheetId, coach, year, month, coachRows, upToDay);
    tabNames.push(tabName);
  }

  return {
    url: `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}`,
    tabs: tabNames,
  };
}

module.exports = { generateRekapSheet };
