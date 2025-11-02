import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";

// === Ambil environment variables ===
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!TELEGRAM_TOKEN || !SUPABASE_URL || !SUPABASE_KEY) {
  console.error("❌ Missing environment variables:", {
    TELEGRAM_BOT_TOKEN: !!TELEGRAM_TOKEN,
    SUPABASE_URL: !!SUPABASE_URL,
    SUPABASE_SERVICE_KEY: !!SUPABASE_KEY,
  });
}

const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const userStates = {}; // state user sementara di memory

export default async function handler(req, res) {
  console.log("📩 Incoming request:", req.method, req.url);

  if (req.method !== "POST") {
    return res.status(405).send("Method not allowed");
  }

  try {
    const body = req.body;
    console.log("📦 Body received:", JSON.stringify(body, null, 2));

    const msg = body.message || body.callback_query;
    if (!msg) return res.status(200).send("no message");

    // === CALLBACK dari inline keyboard ===
    if (msg.data) {
      const chatId = msg.message.chat.id;
      const category = msg.data;
      if (!userStates[chatId]) userStates[chatId] = {};
      userStates[chatId].category = category;

      await sendMessage(
        chatId,
        `✅ Kategori dipilih: <b>${category}</b>\n\nSekarang kirim laporan dengan urutan berikut:\n\n1️⃣ Foto eviden sebelum\n2️⃣ Foto eviden sesudah\n3️⃣ Share lokasi (📍)\n4️⃣ Format laporan:\n\nNama pekerjaan :\nVolume pekerjaan (M) :\nMaterial :\nKeterangan :`
      );
      return res.status(200).send("category selected");
    }

    const chatId = msg.chat.id;

    // === /START ===
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
        `👋 Selamat datang di sistem pelaporan lapangan.\n\nSilakan pilih kategori pekerjaan terlebih dahulu:`,
        keyboard
      );
      return res.status(200).send("start sent");
    }

    // === LOKASI ===
    if (msg.location) {
      const state = userStates[chatId] || {};
      state.location = msg.location;
      userStates[chatId] = state;
      await sendMessage(chatId, "✅ Lokasi tersimpan. Sekarang kirim format laporan teks.");
      return res.status(200).send("location ok");
    }

    // === FOTO ===
    if (msg.photo) {
      const fileId = msg.photo[msg.photo.length - 1].file_id;
      const fileUrl = await getFileUrl(fileId);
      const state = userStates[chatId] || {};

      if (!state.photo_before_url) {
        state.photo_before_url = fileUrl;
        await sendMessage(chatId, "✅ Foto eviden *sebelum* diterima. Sekarang kirim *foto sesudah*.");
      } else if (!state.photo_after_url) {
        state.photo_after_url = fileUrl;
        await sendMessage(chatId, "✅ Foto eviden *sesudah* diterima. Sekarang kirim *lokasi pekerjaan (📍)*.");
      }

      userStates[chatId] = state;
      return res.status(200).send("photo ok");
    }

    // === TEKS REPORT ===
    if (msg.text && msg.text.includes("Nama pekerjaan")) {
      const text = msg.text;
      const nama_pekerjaan = (text.match(/Nama pekerjaan\s*:\s*(.*)/i) || [])[1]?.trim() || null;
      const volume_pekerjaan = (text.match(/Volume pekerjaan.*?:\s*([\d.,]+)/i) || [])[1]?.trim() || null;
      const material = (text.match(/Material\s*:\s*(.*)/i) || [])[1]?.trim() || null;
      const keterangan = (text.match(/Keterangan\s*:\s*(.*)/i) || [])[1]?.trim() || null;

      console.log("🧾 Parsed report:", { nama_pekerjaan, volume_pekerjaan, material, keterangan });

      if (!nama_pekerjaan || !volume_pekerjaan || !material) {
        await sendMessage(chatId, "⚠️ Format tidak sesuai.\nPastikan isi semua kolom:\nNama pekerjaan, Volume, Material, dan Keterangan.");
        return res.status(200).send("invalid format");
      }

      const state = userStates[chatId] || {};
      const { category, location, photo_before_url, photo_after_url } = state;

      console.log("🗃 Saving to Supabase:", {
        category,
        nama_pekerjaan,
        volume_pekerjaan,
        material,
        keterangan,
        location,
      });

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
        console.error("❌ Supabase insert error:", error);
        await sendMessage(chatId, "❌ Gagal menyimpan laporan ke database.");
      } else {
        await sendMessage(chatId, "✅ Laporan berhasil disimpan! Terima kasih 🙏");
      }

      delete userStates[chatId];
      return res.status(200).send("saved ok");
    }

    // === FALLBACK ===
    await sendMessage(chatId, "📋 Kirim /start untuk memulai pelaporan.");
    return res.status(200).send("no match");
  } catch (err) {
    console.error("❌ Webhook error:", err);
    return res.status(500).send("internal error");
  }
}

// === Helper: kirim pesan Telegram ===
async function sendMessage(chatId, text, keyboard) {
  const payload = {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
  };
  if (keyboard) payload.reply_markup = keyboard;

  const res = await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const result = await res.text();
  console.log("📤 Telegram sendMessage result:", result);
}

// === Helper: dapatkan URL file Telegram ===
async function getFileUrl(fileId) {
  console.log("🔍 Getting file URL for", fileId);
  const res = await fetch(`${TELEGRAM_API}/getFile?file_id=${fileId}`);
  const data = await res.json();
  console.log("📸 File data:", data);
  return `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${data.result.file_path}`;
}
