import express from "express";
import bodyParser from "body-parser";
import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";

const app = express();
app.use(bodyParser.json());

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

// State per user (sementara di memori)
const userStates = {};

// === Fungsi kirim pesan ke Telegram ===
async function sendMessage(chatId, text, keyboard) {
  const body = {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
  };
  if (keyboard) body.reply_markup = keyboard;

  await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// === Handler utama webhook ===
app.post("/webhook", async (req, res) => {
  const msg = req.body.message || req.body.callback_query;
  if (!msg) return res.sendStatus(200);

  // Jika callback dari inline keyboard kategori
  if (msg.data) {
    const chatId = msg.message.chat.id;
    const category = msg.data;

    if (!userStates[chatId]) userStates[chatId] = {};
    userStates[chatId].category = category;

    await sendMessage(chatId, `✅ Kategori dipilih: <b>${category}</b>\n\nSekarang kirim data dengan format:\n\nNama pekerjaan:\nVolume pekerjaan (M):\nMaterial:\nKeterangan:`);

    return res.sendStatus(200);
  }

  const chatId = msg.chat.id;

  // Handle /start
  if (msg.text === "/start") {
    const keyboard = {
      inline_keyboard: [
        [
          { text: "📍 Jalan", callback_data: "Jalan" },
          { text: "🌉 Jembatan", callback_data: "Jembatan" },
        ],
        [
          { text: "🪜 Tiang", callback_data: "Tiang" },
          { text: "⚡ Kabel", callback_data: "Kabel" },
        ],
        [{ text: "🧱 Lainnya", callback_data: "Lainnya" }],
      ],
    };

    await sendMessage(
      chatId,
      `👋 Selamat datang di sistem pelaporan.\n\nSilakan pilih kategori pekerjaan terlebih dahulu:`,
      keyboard
    );
    return res.sendStatus(200);
  }

  // Jika kirim lokasi
  if (msg.location) {
    userStates[chatId] = userStates[chatId] || {};
    userStates[chatId].location = msg.location;
    await sendMessage(chatId, "✅ Lokasi tersimpan. Sekarang kirim foto *eviden sebelum*.");
    return res.sendStatus(200);
  }

  // Jika kirim foto
  if (msg.photo) {
    const fileId = msg.photo[msg.photo.length - 1].file_id;
    const state = userStates[chatId] || {};

    if (!state.photo_before_url) {
      // Foto sebelum
      const fileUrl = await getFileUrl(fileId);
      state.photo_before_url = fileUrl;
      userStates[chatId] = state;
      await sendMessage(chatId, "✅ Foto sebelum tersimpan. Sekarang kirim foto *eviden sesudah*.");
    } else if (!state.photo_after_url) {
      // Foto sesudah
      const fileUrl = await getFileUrl(fileId);
      state.photo_after_url = fileUrl;
      userStates[chatId] = state;
      await sendMessage(chatId, "✅ Foto sesudah tersimpan. Kirim lokasi (share location).");
    }
    return res.sendStatus(200);
  }

  // Jika teks laporan
  if (msg.text && msg.text.includes("Nama pekerjaan")) {
    const lines = msg.text.split("\n").map((l) => l.split(":")[1]?.trim() || "");
    const [nama_pekerjaan, volume_pekerjaan, material, keterangan] = lines;

    const state = userStates[chatId] || {};

    const { category, location, photo_before_url, photo_after_url } = state;

    const { error } = await supabase.from("reports").insert([
      {
        category,
        nama_pekerjaan,
        volume_pekerjaan,
        material,
        keterangan,
        photo_before_url,
        photo_after_url,
        latitude: location?.latitude,
        longitude: location?.longitude,
        created_at: new Date(),
      },
    ]);

    if (error) {
      console.error(error);
      await sendMessage(chatId, "❌ Gagal menyimpan laporan.");
    } else {
      await sendMessage(chatId, "✅ Laporan berhasil disimpan!");
    }

    delete userStates[chatId];
  }

  res.sendStatus(200);
});

// === Fungsi dapatkan file URL dari Telegram ===
async function getFileUrl(fileId) {
  const res = await fetch(`${TELEGRAM_API}/getFile?file_id=${fileId}`);
  const data = await res.json();
  return `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${data.result.file_path}`;
}

app.listen(3000, () => console.log("✅ Webhook aktif di port 3000"));
