require("dotenv").config();
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  downloadMediaMessage,
} = require("@whiskeysockets/baileys");
const pino = require("pino");
const qrcode = require("qrcode-terminal");
const qrcodeImage = require("qrcode");
const { HfInference } = require("@huggingface/inference");
const express = require("express");
const mammoth = require("mammoth");
const pdfParse = require("pdf-parse");

// ==========================================
// 1. Keep-Alive Server & Web QR Scanner
// ==========================================
const app = express();
const port = process.env.PORT || 8000;

let qrCodeHtml = "<h2>Sedang memuat sistem WhatsApp (menggunakan Baileys)...</h2> <p>Tunggu sebentar lalu coba <b>Refresh (F5)</b>.</p>";

app.get("/", (req, res) => {
  res.send("WhatsApp Bot (Baileys) is running! 🤖 Cek <b>/qr</b> untuk scan login.");
});

app.get("/qr", (req, res) => {
  res.send(qrCodeHtml);
});

app.listen(port, () => {
  console.log(`🌐 Web server is listening on port ${port}`);
});

// ==========================================
// 2. Setup Hugging Face AI
// ==========================================
const hf = new HfInference(process.env.HF_TOKEN);
const MODEL = "meta-llama/Meta-Llama-3-8B-Instruct";

const SYSTEM_PROMPT = `Kamu adalah asisten virtual WhatsApp milik Arul (Amrully Arun Hadi).
Kamu ramah, sopan, dan pintar. Bicaralah seperti manusia biasa menggunakan bahasa Indonesia yang santai tapi sopan (gunakan kata 'aku' dan 'kamu').
Gunakan emoji secukupnya agar percakapan lebih hidup. Jawablah pertanyaan dengan singkat, padat, dan jelas.

FAKTA TENTANG ARUL:
- Arul (Amrully Arun Hadi) adalah penciptamu.
- Arul adalah seorang programmer/developer yang handal.

INSTRUKSI PENTING:
1. Jika ada yang bertanya tentang Arul, jawablah berdasarkan fakta di atas dengan bangga.
2. Jika ditanya hal yang tidak kamu ketahui, jawablah dengan jujur bahwa kamu tidak tahu, tidak perlu ngarang.
3. Selalu posisikan dirimu sebagai asisten pribadi Arul yang setia.`;

const userMessageHistory = new Map();
const MAX_DOC_LENGTH = 10000;

// ==========================================
// 3. Konfigurasi Baileys (Tanpa Google Chrome)
// ==========================================
async function connectToWhatsApp() {
  // Folder khusus Baileys untuk menyimpan sesi login
  const { state, saveCreds } = await useMultiFileAuthState("auth_info_baileys");

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false, // Dimatikan agar kita bisa modifikasi QR nya ke terminal dan Web sekaligus
    logger: pino({ level: "silent" }), // Supaya log terminal tidak dibanjiri kode debug Baileys
    browser: ["Boti AI", "Chrome", "1.0.0"],
  });

  // Simpan login ke file secara berkala
  sock.ev.on("creds.update", saveCreds);

  // Memantau status koneksi & mengeluarkan QR
  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("\n📱 QR code telah berhasil digenerate! Silakan cek web /qr untuk menscan gambarnya.");
      qrcode.generate(qr, { small: true });

      qrcodeImage.toDataURL(qr, (err, url) => {
        qrCodeHtml = `
          <div style="font-family: sans-serif; text-align: center; margin-top: 50px;">
            <h2>📱 Silakan Scan QR Code Ini di HP Anda!</h2>
            <img src="${url}" style="width: 300px; height: 300px; border: 2px solid #ccc; border-radius: 10px; padding: 10px;" />
            <p>Buka <b>WhatsApp > Perangkat Tertaut > Tautkan Perangkat</b>.</p>
            <p><i>(Jika barcode pudar, coba Refresh / F5 halaman ini)</i></p>
          </div>
        `;
      });
    }

    if (connection === "close") {
      const shouldReconnect =
        lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log("❌ Koneksi tertutup. Alasan:", lastDisconnect.error?.message, "| Reconnecting:", shouldReconnect);
      
      qrCodeHtml = "<h2>Koneksi terputus. Sedang mencoba auto-reconnect... Coba refresh sesaat lagi.</h2>";
      
      if (shouldReconnect) {
        connectToWhatsApp(); // Restart bot otomatis jika error kecil
      }
    } else if (connection === "open") {
      console.log("✅ Bot sudah siap dan terhubung ke WhatsApp lewat Baileys (Tanpa Chrome)!");
      qrCodeHtml = "<h2>✅ Bot Anda telah sukses terkoneksi! Selamat online 24 Jam!</h2> <p>Bot Baileys kini sedang online dan memakan RAM super kecil.</p>";
    }
  });

  // Membaca pesan masuk
  sock.ev.on("messages.upsert", async (m) => {
    const msg = m.messages[0];
    // Abaikan jika pesan dari bot sendiri atau jika pesan sistem tanpa teks
    if (!msg.message || msg.key.fromMe) return;

    const from = msg.key.remoteJid;
    // Mendeteksi jenis isi pesannya (teks biasa, teks balasan, atau file)
    const messageType = Object.keys(msg.message)[0];
    
    let textBody = "";
    if (messageType === "conversation") {
      textBody = msg.message.conversation;
    } else if (messageType === "extendedTextMessage") {
      textBody = msg.message.extendedTextMessage.text;
    } else if (messageType === "documentMessage") {
      textBody = msg.message.documentMessage.caption || "";
    }

    // Filter Trigger Kata Kunci (hanya merespons yg mengandung kata boti/sayang/rovi cantik)
    const lowerCaseBody = textBody.toLowerCase();
    const hasKeyword =
      lowerCaseBody.includes("boti") ||
      lowerCaseBody.includes("sayang") ||
      lowerCaseBody.includes("rovi cantik");

    if (!hasKeyword) return;

    if (!process.env.HF_TOKEN) {
      await sock.sendMessage(from, { text: "Maaf, konfigurasiku belum selesai. API Key Hugging Face belum dimasukkan di .env atau server." });
      return;
    }

    console.log(`💬 Menerima pesan dari ${from.split("@")[0]}: "${textBody}"`);
    await sock.sendMessage(from, { text: "⏳ Boti sedang memikirkan jawaban..." });

    // Tangkap Lampiran Dokumen jika Ada
    let documentText = "";
    try {
      if (messageType === "documentMessage") {
        const docMsg = msg.message.documentMessage;
        const mimetype = docMsg.mimetype;
        const filename = docMsg.fileName || "Dokumen Tidak Bernama";

        if (
          mimetype === "text/plain" ||
          mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
          mimetype === "application/pdf"
        ) {
          // Sistem unduh gambar milik Baileys
          const buffer = await downloadMediaMessage(msg, "buffer", {}, { logger: pino({ level: "silent" }) });

          if (mimetype === "text/plain") {
            documentText = buffer.toString("utf-8");
          } else if (mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
            const result = await mammoth.extractRawText({ buffer });
            documentText = result.value;
          } else if (mimetype === "application/pdf") {
            const pdfData = await pdfParse(buffer);
            documentText = pdfData.text;
          }

          // Cek batas teks (Jangan paksakan AI membaca lebih dari 10.000 karakter)
          if (documentText.length > MAX_DOC_LENGTH) {
            documentText = documentText.substring(0, MAX_DOC_LENGTH) + "\n...[TEKS DIPOTONG KARENA TERLALU PANJANG]";
          }
          console.log(`📄 Berhasil membaca dokumen: ${filename}`);
        }
      }
    } catch (err) {
      console.error(`❌ Gagal membaca dokumen secara Baileys:`, err.message);
    }

    // Susun Prompt Akhir AI
    let finalPrompt = textBody;
    if (documentText) {
      finalPrompt = `Berikut adalah isi dokumen yang saya lampirkan bersamanya:\n\`\`\`\n${documentText}\n\`\`\`\n\nPertanyaanku terkait dokumen di atas: ${textBody}`;
    }

    // Manajemen histori chat
    if (!userMessageHistory.has(from)) {
      userMessageHistory.set(from, []);
    }
    const history = userMessageHistory.get(from);
    history.push({ role: "user", content: finalPrompt });

    // Batasi histori percakapan maks 10 message
    if (history.length > 10) {
      history.shift();
    }

    // Hubungi API Hugging Face
    let aiReply = "";
    try {
      console.log("⚙️  Minta jawaban ke mesian AI Hugging Face...");
      const response = await hf.chatCompletion({
        model: MODEL,
        messages: [{ role: "system", content: SYSTEM_PROMPT }, ...history],
        max_tokens: 3000,
        temperature: 0.7,
      });

      aiReply = response.choices[0].message.content.trim();
      history.push({ role: "assistant", content: aiReply });
      console.log(`🤖 Bot membalas: "${aiReply.substring(0, 30).replace(/\n/g, "")}..."`);
    } catch (error) {
      console.error("❌ Error Hugging Face API:", error.message);
      aiReply = "Maaf, aku sedang pusing (ada gangguan dengan koneksi AI utama). Coba tanya lagi nanti ya! 😢";
    }

    // Kirim Balasan Akhir
    await sock.sendMessage(from, { text: aiReply });
  });
}

// Memulai sistem
connectToWhatsApp();
