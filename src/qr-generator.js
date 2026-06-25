/**
 * src/qr-generator.js
 * Generate QR code PNG untuk setiap atlet dan simpan ke folder /qr/.
 *
 * QR code berisi athlete_code (mis. "ATL001") yang di-scan oleh kamera
 * di halaman scan.html → dikirim ke POST /scan.
 */

const QRCode = require("qrcode");
const path   = require("path");
const fs     = require("fs");

const QR_DIR = path.join(__dirname, "..", "qr");

// Pastikan folder qr/ ada
if (!fs.existsSync(QR_DIR)) {
  fs.mkdirSync(QR_DIR, { recursive: true });
}

/**
 * Generate QR code PNG untuk satu atlet.
 * Nama file: qr/<athlete_code>.png
 *
 * @param {string} athleteCode  - misal "ATL001"
 * @param {string} athleteName  - untuk label di dalam QR card (opsional)
 * @returns {string} path relatif file QR, misal "qr/ATL001.png"
 */
async function generateQrForAthlete(athleteCode, athleteName = "") {
  const filename = `${athleteCode}.png`;
  const filepath = path.join(QR_DIR, filename);

  // QR code isinya adalah athlete_code saja — simple & cepat di-scan
  await QRCode.toFile(filepath, athleteCode, {
    errorCorrectionLevel: "H",
    type: "png",
    width: 400,
    margin: 2,
    color: {
      dark:  "#0a0f1e",
      light: "#ffffff",
    },
  });

  return `qr/${filename}`;  // path relatif untuk disimpan di DB & di-serve Express
}

/**
 * Generate QR code untuk semua atlet sekaligus.
 * @param {Array<{athlete_code: string, name: string}>} athletes
 * @returns {Array<{athlete_code, qrPath}>}
 */
async function generateQrForAll(athletes) {
  const results = [];
  for (const a of athletes) {
    const qrPath = await generateQrForAthlete(a.athlete_code, a.name);
    results.push({ athlete_code: a.athlete_code, name: a.name, qrPath });
  }
  return results;
}

/**
 * URL publik QR code — gunakan BASE_URL dari env (Railway public URL),
 * atau fallback ke localhost.
 */
function getQrUrl(athleteCode, req = null) {
  const base = process.env.BASE_URL
    || (req ? `${req.protocol}://${req.get("host")}` : "http://localhost:3000");
  return `${base}/qr/${athleteCode}.png`;
}

module.exports = { generateQrForAthlete, generateQrForAll, getQrUrl, QR_DIR };
