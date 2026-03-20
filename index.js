require("dotenv").config();
const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const qrcodeImage = require("qrcode");
const { HfInference } = require("@huggingface/inference");
const express = require("express");
const mammoth = require("mammoth");
const pdfParse = require("pdf-parse");

// ==========================================
// 1. Keep-Alive Server (untuk UptimeRobot)
// ==========================================
const app = express();
// Standar port cloud Koyeb adalah 8000
const port = process.env.PORT || 8000;

let qrCodeHtml = "<h2>Sedang memuat sistem WhatsApp (biasanya butuh waktu sekitar 1-2 menit di Render)...</h2> <p>Jika layar masih ini terus, tunggu sebentar lalu coba <b>Refresh (F5)</b> halaman ini sampai gambarnya keluar.</p>";

app.get("/", (req, res) => {
  res.send("WhatsApp Bot is running! 🤖 Cek <b>/qr</b> untuk scan login.");
});

app.get("/qr", (req, res) => {
  res.send(qrCodeHtml);
});

app.listen(port, () => {
  console.log(`🌐 Keep-alive server is listening on port ${port}`);
});

// ==========================================
// 2. Setup AI (Hugging Face)
// ==========================================
// Ambil token dari file .env (wajib diisi nanti)
const hf = new HfInference(process.env.HF_TOKEN);

// Kita menggunakan model Llama-3-8B-Instruct karena cukup cerdas dan sangat baik dalam percakapan
const MODEL = "meta-llama/Meta-Llama-3-8B-Instruct";

// Anda bisa mengubah isi teks di bawah ini untuk mengajari AI tentang diri Anda
const SYSTEM_PROMPT = `Kamu adalah asisten virtual WhatsApp milik Arul (Amrully Arun Hadi).
Kamu ramah, sopan, dan pintar. Bicaralah seperti manusia biasa menggunakan bahasa Indonesia yang santai tapi sopan (gunakan kata 'aku' dan 'kamu').
Gunakan emoji secukupnya agar percakapan lebih hidup. Jawablah pertanyaan dengan singkat, padat, dan jelas.

Jika ada yang bertanya tentang Arul, ini adalah informasi tentangnya:
- Nama Panggilan: Arul
- Nama Lengkap: Amrully Arun Hadi
- Profesi: Software Developer / Programmer
- (Anda bisa menambahkan detail lain tentang Arul disini, contoh: status, hobi, asal, dll)

Jika ditanya sesuatu yang rahasia atau faktanya tidak ada di atas, katakan saja "Aku tidak tahu, coba chat langsung ke Arul ya".
Jangan pernah mengarang informasi (jangan berhalusinasi). Berikan jawaban yang relevan dengan pertanyaan.`;

// Penyimpanan sederhana riwayat percakapan per nomor agar bot bisa mengingat konteks percakapan
const userMemory = new Map();

// ==========================================
// 3. Setup WhatsApp Client
// ==========================================
const client = new Client({
  // Menyimpan session di folder lokal agar tidak perlu scan QR tiap kali restart
  authStrategy: new LocalAuth(),
  // Memberikan waktu ekstra 5 menit (300000ms) untuk proses scan di hp, mencegah bot pingsan mendadak
  authTimeoutMs: 300000, 
  qrMaxRetries: 3,       // Maksimal generasi ulang QR Code sebelum menyerah
  puppeteer: {
    headless: true,
    // Argumen tambahan untuk mencegah ERR_NAME_NOT_RESOLVED di cloud (Hugging Face / Docker)
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--no-first-run",
      "--no-zygote",
      "--disable-gpu",
      "--proxy-server='direct://'", // Bypass proxy bawaan network cloud yang sering jadi penyebab DNS error
      "--proxy-bypass-list=*",
    ],
  },
});

// Memicu pembuatan QR code di terminal saat pertama kali login
client.on("qr", (qr) => {
  console.log("\n📱 QR code telah berhasil digenerate! Silakan cek web /qr untuk menscan gambarnya.");
  qrcode.generate(qr, { small: true }); // Tetap print ke terminal jaga-jaga
  
  qrcodeImage.toDataURL(qr, (err, url) => {
    qrCodeHtml = `
      <div style="font-family: sans-serif; text-align: center; margin-top: 50px;">
        <h2>📱 Silakan Scan QR Code Ini di HP Anda!</h2>
        <img src="${url}" style="width: 300px; height: 300px; border: 2px solid #ccc; border-radius: 10px; padding: 10px;" />
        <p>Buka <b>WhatsApp > Perangkat Tertaut > Tautkan Perangkat</b>.</p>
        <p><i>(Jika barcode pudar atau masa waktu habis, coba Refresh / F5 halaman ini)</i></p>
      </div>
    `;
  });
});

// Event saat bot berhasil terhubung
client.on("ready", () => {
  console.log("✅ Bot sudah siap dan terhubung ke WhatsApp!");
  qrCodeHtml = "<h2>✅ Bot Anda telah sukses terkoneksi! Selamat online 24 Jam!</h2> <p>Bot kini sedang online dan tidak butuh scan QR lagi.</p>";
});

// Event saat bot menerima pesan baru
client.on("message", async (message) => {
  // Abaikan status update atau pesan broadcast (hanya balas chat langsung)
  if (message.isStatus || message.isForwarded) return;

  const sender = message.from;
  let userMessage = message.body.trim();

  // Pastikan ada pesan teks
  if (!userMessage) return;

  // Hanya membalas jika pesan mengandung kata kunci "boti" ATAU "sayang"
  if (
    !userMessage.toLowerCase().includes("boti") &&
    !userMessage.toLowerCase().includes("sayang")
  )
    return;

  console.log(`\n💬 Menerima pesan dari ${sender}: "${userMessage}"`);

  // Membaca file jika ada lampiran
  if (message.hasMedia) {
    try {
      const media = await message.downloadMedia();
      if (media && media.data) {
        const buffer = Buffer.from(media.data, "base64");

        let extractedText = "";
        if (media.mimetype === "text/plain") {
          extractedText = buffer.toString("utf-8");
        } else if (media.mimetype === "application/pdf") {
          const pdfData = await pdfParse(buffer);
          extractedText = pdfData.text;
        } else if (
          media.mimetype ===
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        ) {
          const result = await mammoth.extractRawText({ buffer });
          extractedText = result.value;
        }

        if (extractedText) {
          // Limit teks agar tidak melebihi konteks Hugging Face (diset maksimal ~10000 karakter)
          const MAX_DOC_LENGTH = 10000;
          if (extractedText.length > MAX_DOC_LENGTH) {
            extractedText =
              extractedText.substring(0, MAX_DOC_LENGTH) +
              "\n...[Teks terpotong karena file terlalu panjang]";
          }
          userMessage += `\n\n[Sistem WhatsApp mendeteksi ada file terlampir. Isi file:]\n"${extractedText.trim()}"\n[Akhir Dokumen]`;
          console.log(`📄 Berhasil membaca dokumen (${media.mimetype})`);
        }
      }
    } catch (err) {
      console.log("⚠️ Gagal membaca media lampiran:", err.message);
    }
  }

  // Struktur awal (prompt) jika nomor user belum ada di memori map
  if (!userMemory.has(sender)) {
    userMemory.set(sender, [{ role: "system", content: SYSTEM_PROMPT }]);
  }

  const history = userMemory.get(sender);

  // Tambahkan pesan user ke memori
  history.push({ role: "user", content: userMessage });

  // Batasi memori hingga 11 pesan terakhir (1 system + 5 user + 5 asisten)
  // agar token API tidak kepenuhan (Context Window Llama 3)
  if (history.length > 11) {
    // Hapus indeks 1 dan 2 (membiarkan indeks 0 = system prompt tetap aman)
    history.splice(1, 2);
  }

  try {
    console.log(`⚙️  Minta jawaban ke AI Hugging Face...`);

    // Memanggil API Hugging Face
    const response = await hf.chatCompletion({
      model: MODEL,
      messages: history,
      max_tokens: 3000, // Panjang jawaban maksimal (ditingkatkan agar tidak terpotong)
      temperature: 0.7, // Kreativitas (0 = kaku, 1 = sangat variatif)
    });

    const reply = response.choices[0].message.content;

    // Simpan balasan AI ke memori
    history.push({ role: "assistant", content: reply });

    // Kirim balasan ke nomor WhatsApp pengguna
    await client.sendMessage(sender, reply);
    console.log(`🤖 Bot membalas: "${reply}"`);
  } catch (error) {
    console.error("❌ Error dari Hugging Face API:", error.message);

    // Cek jika errornya karena Token belum diset
    if (
      error.message.includes("401") ||
      error.message.includes("Unauthorized")
    ) {
      console.log(
        "⚠️ HARAP CEK: Sepertinya HF_TOKEN di file .env belum diisi atau salah.",
      );
      await client.sendMessage(
        sender,
        "Maaf, konfigurasiku belum selesai. API Key Hugging Face belum dimasukkan.",
      );
    } else {
      await client.sendMessage(sender, "Maaf, mager nih nanya besok lagi aja");
    }
  }
});

// Jalan bosku
client.initialize();
