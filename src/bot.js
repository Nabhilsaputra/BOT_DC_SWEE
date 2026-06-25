/**
 * src/bot.js
 * Discord bot: mengirim log real-time & melayani slash commands.
 *
 * Slash commands:
 *   /qr <nama_atlet>    — Tampilkan QR code atlet (bisa sebagian nama)
 *   /rekap              — Rekap absensi hari ini (per coach & kelas)
 *   /rekap-bulanan      — Rekap ringkasan bulan ini (opsional: bulan & tahun)
 *   /rekap-coach <nama> — Rekap hari ini untuk satu coach
 *   /hadir              — Ringkasan cepat jumlah hadir
 *   /riwayat <nama>     — Riwayat kehadiran atlet (30 sesi terakhir)
 *   /atlet              — Daftar semua atlet terdaftar
 *   /bantuan            — Daftar semua perintah
 */

require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  REST,
  Routes,
  SlashCommandBuilder,
  AttachmentBuilder,
} = require("discord.js");

const path = require("path");
const fs   = require("fs");
const db   = require("./db");
const { generateQrForAthlete, QR_DIR } = require("./qr-generator");

// ─── Inisialisasi client ──────────────────────────────────────────────────────

const client  = new Client({ intents: [GatewayIntentBits.Guilds] });
let botReady  = false;

// ─── Helpers format ───────────────────────────────────────────────────────────

const BULAN_ID = [
  "", "Januari","Februari","Maret","April","Mei","Juni",
  "Juli","Agustus","September","Oktober","November","Desember",
];

const HARI_ID = ["Minggu","Senin","Selasa","Rabu","Kamis","Jumat","Sabtu"];

function formatTanggal(d = new Date()) {
  return `${HARI_ID[d.getDay()]}, ${d.getDate()} ${BULAN_ID[d.getMonth() + 1]} ${d.getFullYear()}`;
}

function formatJam(isoString) {
  return new Date(isoString).toLocaleTimeString("id-ID", {
    hour: "2-digit", minute: "2-digit",
  });
}

function groupByCoachKelas(rows) {
  const out = {};
  for (const r of rows) {
    const c = r.coach || "—";
    const k = r.kelas || "—";
    (out[c] ??= {})[k] ??= [];
    out[c][k].push(r);
  }
  return out;
}

function buildRekapText(grouped) {
  const lines = [];
  for (const [coach, kelasList] of Object.entries(grouped)) {
    const totalCoach = Object.values(kelasList).reduce((n, a) => n + a.length, 0);
    lines.push(`\n**Coach ${coach}** — ${totalCoach} atlet`);
    for (const [kelas, atlets] of Object.entries(kelasList)) {
      lines.push(`┌ Kelas **${kelas}**`);
      atlets.forEach((r, i) => {
        const isLast = i === atlets.length - 1;
        const prefix = isLast ? "└" : "├";
        lines.push(`${prefix} ${i + 1}. ${r.name ?? "(tidak dikenal)"} · \`${r.athlete_code}\` · ${formatJam(r.scan_time)}`);
      });
    }
  }
  return lines.join("\n").trim() || "_Belum ada data._";
}

// ─── Registrasi slash commands ────────────────────────────────────────────────

async function registerCommands() {
  const commands = [
    // /qr
    new SlashCommandBuilder()
      .setName("qr")
      .setDescription("Tampilkan QR code atlet untuk absensi")
      .addStringOption(o =>
        o.setName("nama")
         .setDescription("Nama atlet atau kode atlet (mis. ATL001 atau Budi)")
         .setRequired(true)),

    // /rekap
    new SlashCommandBuilder()
      .setName("rekap")
      .setDescription("Rekap absensi hari ini, dikelompokkan per coach dan kelas"),

    // /rekap-bulanan
    new SlashCommandBuilder()
      .setName("rekap-bulanan")
      .setDescription("Rekap ringkasan absensi bulanan")
      .addIntegerOption(o =>
        o.setName("bulan")
         .setDescription("Nomor bulan 1–12 (default: bulan ini)")
         .setMinValue(1).setMaxValue(12).setRequired(false))
      .addIntegerOption(o =>
        o.setName("tahun")
         .setDescription("Tahun (default: tahun ini)")
         .setMinValue(2020).setMaxValue(2100).setRequired(false)),

    // /rekap-coach
    new SlashCommandBuilder()
      .setName("rekap-coach")
      .setDescription("Rekap absensi hari ini untuk coach tertentu")
      .addStringOption(o =>
        o.setName("nama")
         .setDescription("Nama coach")
         .setRequired(true)),

    // /hadir
    new SlashCommandBuilder()
      .setName("hadir")
      .setDescription("Ringkasan jumlah atlet hadir hari ini per coach & kelas"),

    // /riwayat
    new SlashCommandBuilder()
      .setName("riwayat")
      .setDescription("Lihat riwayat kehadiran atlet (30 sesi terakhir)")
      .addStringOption(o =>
        o.setName("nama")
         .setDescription("Nama atlet atau kode atlet")
         .setRequired(true)),

    // /atlet
    new SlashCommandBuilder()
      .setName("atlet")
      .setDescription("Daftar semua atlet yang terdaftar dalam sistem"),

    // /bantuan
    new SlashCommandBuilder()
      .setName("bantuan")
      .setDescription("Tampilkan daftar perintah yang tersedia"),

  ].map(c => c.toJSON());

  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
  await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
  console.log("✅ Slash commands terdaftar.");
}

// ─── Event: ready ─────────────────────────────────────────────────────────────

client.once("ready", async () => {
  botReady = true;
  console.log(`🤖 Bot aktif sebagai ${client.user.tag}`);
  await registerCommands().catch(e =>
    console.error("Gagal daftarkan commands:", e.message)
  );
});

// ─── Event: interactionCreate ─────────────────────────────────────────────────

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const { commandName } = interaction;

  // ══════════════════════════════════════════════════════════════════════════
  // /qr <nama>
  // Mencari atlet berdasarkan nama atau kode, lalu kirim QR code sebagai
  // attachment Discord. Jika lebih dari satu atlet cocok, tampilkan pilihan.
  // ══════════════════════════════════════════════════════════════════════════
  if (commandName === "qr") {
    await interaction.deferReply();
    const input = interaction.options.getString("nama").trim();

    // Coba cari by exact code dulu
    let athlete = await db.getAthleteByCode(input.toUpperCase());
    let matches = athlete ? [athlete] : [];

    // Kalau tidak ketemu by code, cari by nama (partial match)
    if (!matches.length) {
      matches = await db.getAthleteByName(input);
    }

    if (!matches.length) {
      return interaction.editReply(
        `❌ Tidak ada atlet dengan nama atau kode **"${input}"**.\nGunakan \`/atlet\` untuk melihat daftar atlet.`
      );
    }

    // Jika lebih dari satu hasil, tampilkan semua QR (maks 5)
    const targets = matches.slice(0, 5);

    for (const a of targets) {
      const qrFile = path.join(QR_DIR, `${a.athlete_code}.png`);

      // Generate QR jika file belum ada
      if (!fs.existsSync(qrFile)) {
        await generateQrForAthlete(a.athlete_code, a.name);
      }

      const attachment = new AttachmentBuilder(qrFile, {
        name: `QR_${a.athlete_code}.png`,
      });

      const embed = new EmbedBuilder()
        .setColor(0x0ea5e9)
        .setTitle(`🏊 QR Code — ${a.name}`)
        .setDescription(
          `**Kode Atlet:** \`${a.athlete_code}\`\n\n` +
          `Tunjukkan atau cetak QR code ini.\n` +
          `Pelatih scan QR di halaman absensi untuk mencatat kehadiran.`
        )
        .setImage(`attachment://QR_${a.athlete_code}.png`)
        .setFooter({ text: "Sistem Absensi Klub Renang 🏊" })
        .setTimestamp();

      await interaction.followUp({ embeds: [embed], files: [attachment] });
    }

    // Edit reply awal menjadi pesan sukses
    const names = targets.map(a => `**${a.name}** (\`${a.athlete_code}\`)`).join(", ");
    return interaction.editReply(`✅ QR code untuk: ${names}`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // /rekap
  // ══════════════════════════════════════════════════════════════════════════
  if (commandName === "rekap") {
    await interaction.deferReply();
    const rows    = await db.getTodayAttendance();
    const tanggal = formatTanggal();

    if (!rows.length) {
      return interaction.editReply(`📋 Belum ada atlet yang absen hari ini (${tanggal}).`);
    }

    const grouped   = groupByCoachKelas(rows);
    const desc      = buildRekapText(grouped);
    const coaches   = Object.keys(grouped).length;
    const truncated = desc.length > 3900 ? desc.slice(0, 3900) + "\n…_(dipotong)_" : desc;

    const embed = new EmbedBuilder()
      .setColor(0x0ea5e9)
      .setTitle(`📋 Rekap Absen Latihan`)
      .setDescription(truncated)
      .addFields(
        { name: "📅 Tanggal",     value: tanggal,            inline: true },
        { name: "👥 Total Hadir", value: `${rows.length} atlet`, inline: true },
        { name: "🧑‍🏫 Coach",      value: `${coaches} coach`,  inline: true },
      )
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // /rekap-bulanan
  // ══════════════════════════════════════════════════════════════════════════
  if (commandName === "rekap-bulanan") {
    await interaction.deferReply();
    const bulan = interaction.options.getInteger("bulan") || new Date().getMonth() + 1;
    const tahun = interaction.options.getInteger("tahun") || new Date().getFullYear();
    const rows  = await db.getMonthlyAttendance(tahun, bulan);
    const label = `${BULAN_ID[bulan]} ${tahun}`;

    if (!rows.length) {
      return interaction.editReply(`📅 Tidak ada data absensi untuk ${label}.`);
    }

    const perTanggal = {};
    for (const r of rows) {
      (perTanggal[r.tanggal] ??= []).push(r);
    }

    const lines = [];
    for (const [tgl, tglRows] of Object.entries(perTanggal)) {
      const d        = new Date(tgl + "T00:00:00");
      const tglLabel = `${HARI_ID[d.getDay()]} ${d.getDate()} ${BULAN_ID[d.getMonth() + 1]}`;
      const grouped  = groupByCoachKelas(tglRows);
      const coaches  = Object.keys(grouped)
        .map(c => {
          const sesi = Object.entries(grouped[c])
            .map(([k, a]) => `${k}: ${a.length}`)
            .join(", ");
          return `  • **${c}** — ${sesi}`;
        })
        .join("\n");
      lines.push(`📅 **${tglLabel}** — ${tglRows.length} absen\n${coaches}`);
    }

    const totalUnik = new Set(rows.map(r => r.athlete_code)).size;
    const desc      = lines.join("\n\n");
    const truncated = desc.length > 3900 ? desc.slice(0, 3900) + "\n…_(dipotong)_" : desc;

    const embed = new EmbedBuilder()
      .setColor(0x7c3aed)
      .setTitle(`📅 Rekap Bulanan — ${label}`)
      .setDescription(truncated)
      .addFields(
        { name: "Total Scan",  value: `${rows.length}`,                       inline: true },
        { name: "Atlet Unik",  value: `${totalUnik}`,                          inline: true },
        { name: "Hari Aktif",  value: `${Object.keys(perTanggal).length} hari`, inline: true },
      )
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // /rekap-coach
  // ══════════════════════════════════════════════════════════════════════════
  if (commandName === "rekap-coach") {
    await interaction.deferReply();
    const namaCoach = interaction.options.getString("nama");
    const rows      = await db.getTodayAttendanceByCoach(namaCoach);
    const tanggal   = formatTanggal();

    if (!rows.length) {
      return interaction.editReply(
        `📋 Tidak ada atlet yang absen dengan Coach **${namaCoach}** hari ini (${tanggal}).`
      );
    }

    const grouped = groupByCoachKelas(rows);
    const desc    = buildRekapText(grouped);

    const embed = new EmbedBuilder()
      .setColor(0x10b981)
      .setTitle(`📋 Rekap Coach ${namaCoach}`)
      .setDescription(desc)
      .addFields(
        { name: "📅 Tanggal",     value: tanggal,                 inline: true },
        { name: "👥 Total Hadir", value: `${rows.length} atlet`,  inline: true },
      )
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // /hadir
  // ══════════════════════════════════════════════════════════════════════════
  if (commandName === "hadir") {
    await interaction.deferReply();
    const rows    = await db.getTodayAttendance();
    const tanggal = formatTanggal();

    if (!rows.length) {
      return interaction.editReply(`Belum ada kehadiran hari ini (${tanggal}).`);
    }

    const grouped = groupByCoachKelas(rows);
    const lines   = [`**${rows.length} atlet hadir — ${tanggal}**\n`];

    for (const [coach, kelasList] of Object.entries(grouped)) {
      const totalC = Object.values(kelasList).reduce((n, a) => n + a.length, 0);
      lines.push(`🧑‍🏫 **Coach ${coach}** — ${totalC} atlet`);
      for (const [kelas, atlets] of Object.entries(kelasList)) {
        lines.push(`   └ ${kelas}: **${atlets.length}** atlet`);
      }
    }

    const embed = new EmbedBuilder()
      .setColor(0xf59e0b)
      .setTitle("🏊 Kehadiran Hari Ini")
      .setDescription(lines.join("\n"))
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // /riwayat <nama>
  // ══════════════════════════════════════════════════════════════════════════
  if (commandName === "riwayat") {
    await interaction.deferReply();
    const input = interaction.options.getString("nama").trim();

    let athlete = await db.getAthleteByCode(input.toUpperCase());
    if (!athlete) {
      const matches = await db.getAthleteByName(input);
      if (!matches.length) {
        return interaction.editReply(`❌ Atlet **"${input}"** tidak ditemukan.`);
      }
      athlete = matches[0];
    }

    const rows = await db.getAthleteAttendanceHistory(athlete.athlete_code, 30);

    if (!rows.length) {
      return interaction.editReply(
        `📋 **${athlete.name}** belum memiliki riwayat absensi.`
      );
    }

    const lines = rows.map((r, i) => {
      const d = new Date(r.scan_time);
      const tgl = `${d.getDate()} ${BULAN_ID[d.getMonth() + 1]}`;
      return `${i + 1}. **${tgl}** — Coach ${r.coach || "—"} · ${r.kelas || "—"} · ${formatJam(r.scan_time)}`;
    });

    const embed = new EmbedBuilder()
      .setColor(0x6366f1)
      .setTitle(`📋 Riwayat Kehadiran — ${athlete.name}`)
      .setDescription(lines.join("\n"))
      .addFields(
        { name: "Kode Atlet",        value: `\`${athlete.athlete_code}\``, inline: true },
        { name: "Total (30 terakhir)", value: `${rows.length} sesi`,       inline: true },
      )
      .setFooter({ text: "Menampilkan 30 sesi terakhir" })
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // /atlet
  // ══════════════════════════════════════════════════════════════════════════
  if (commandName === "atlet") {
    await interaction.deferReply();
    const athletes = await db.listAthletes();

    if (!athletes.length) {
      return interaction.editReply("❌ Belum ada atlet terdaftar.");
    }

    const lines = athletes.map((a, i) =>
      `${i + 1}. **${a.name}** — \`${a.athlete_code}\``
    );
    const desc = lines.join("\n");
    const truncated = desc.length > 3900 ? desc.slice(0, 3900) + "\n…_(dipotong)_" : desc;

    const embed = new EmbedBuilder()
      .setColor(0x0ea5e9)
      .setTitle("🏊 Daftar Atlet Terdaftar")
      .setDescription(truncated)
      .addFields({ name: "Total", value: `${athletes.length} atlet`, inline: true })
      .setFooter({ text: "Gunakan /qr <nama> untuk melihat QR code atlet" })
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // /bantuan
  // ══════════════════════════════════════════════════════════════════════════
  if (commandName === "bantuan") {
    const embed = new EmbedBuilder()
      .setColor(0x0ea5e9)
      .setTitle("📖 Daftar Perintah Bot Absensi")
      .setDescription(
        [
          "**QR Code Atlet**",
          "`/qr <nama>`",
          "Tampilkan QR code atlet. Bisa pakai nama lengkap, sebagian nama, atau kode atlet (mis. ATL001).",
          "",
          "**Rekap Harian**",
          "`/rekap`",
          "Rekap absensi hari ini, dikelompokkan per coach & kelas.",
          "",
          "`/rekap-coach <nama>`",
          "Rekap hari ini untuk satu coach tertentu.",
          "",
          "`/hadir`",
          "Ringkasan cepat: berapa atlet hadir per coach/kelas.",
          "",
          "**Rekap Bulanan**",
          "`/rekap-bulanan [bulan] [tahun]`",
          "Ringkasan absensi per hari dalam satu bulan.",
          "",
          "**Data Atlet**",
          "`/atlet`",
          "Daftar semua atlet beserta kode mereka.",
          "",
          "`/riwayat <nama>`",
          "Riwayat kehadiran satu atlet (30 sesi terakhir).",
          "",
          "`/bantuan`",
          "Tampilkan pesan ini.",
        ].join("\n")
      )
      .setFooter({ text: "Sistem Absensi Klub Renang 🏊" });

    return interaction.reply({ embeds: [embed] });
  }
});

// ─── Kirim log per-scan ke channel Discord ────────────────────────────────────

async function sendAttendanceLog({ name, code, coach, kelas, isDuplicate }) {
  if (!botReady || !process.env.DISCORD_CHANNEL_ID) return;

  try {
    const channel = await client.channels.fetch(process.env.DISCORD_CHANNEL_ID);
    if (!channel) return;

    const jam = new Date().toLocaleTimeString("id-ID", {
      hour: "2-digit", minute: "2-digit",
    });

    const embed = new EmbedBuilder()
      .setColor(isDuplicate ? 0xf59e0b : 0x10b981)
      .setTitle(isDuplicate ? "⚠️ Sudah Absen Sebelumnya" : "✅ Atlet Hadir")
      .addFields(
        { name: "Nama",  value: name  || "(tidak dikenal)", inline: true },
        { name: "ID",    value: code,                       inline: true },
        { name: "Jam",   value: jam,                        inline: true },
        { name: "Coach", value: coach || "—",               inline: true },
        { name: "Kelas", value: kelas || "—",               inline: true },
      );

    await channel.send({ embeds: [embed] });
  } catch (err) {
    console.error("Gagal kirim log Discord:", err.message);
  }
}

// ─── Start ────────────────────────────────────────────────────────────────────

function startBot() {
  if (!process.env.DISCORD_TOKEN) {
    console.log("⚠️  DISCORD_TOKEN tidak ditemukan — bot Discord dinonaktifkan.");
    return Promise.resolve();
  }
  return client.login(process.env.DISCORD_TOKEN);
}

module.exports = { startBot, sendAttendanceLog };
