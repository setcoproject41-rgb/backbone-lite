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
  // ✅ Pastikan hanya method POST diterima
  if (req.method !== "POST") {
    return res.status(405).send("Method not allowed");
  }

  try {
    const body = req.body;
    console.log("📩 Incoming Telegram update:", JSON.stringify(body, null, 2));

    const msg = body.message || body.callback_query;
    if (!msg) return res.status(200).send("no message");

    const chatId = msg.message ? msg.message.chat.id : msg.chat.id;

    // === CALLBACK inline keyboard ===
    if (msg.data) {
      const category = msg.data;
      userStates[chatId] = { category };
      await sendMessage(
        chatId,
        `✅ Kategori dipilih: <b>${category}</b>\n\nSekarang kirim laporan dengan urutan berikut:\n\n1️⃣ Foto eviden sebelum\n2️⃣ Foto eviden sesudah\n3️⃣ Share lokasi (📍)\n4️⃣ Format laporan:\n\nNama pekerjaan :\nVolume pekerjaan (M) :\nMaterial :\nKeterangan :`
      );
      return res.status(200).send("category selected");
    }

    // === /start command ===
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
      await sendMessage(chatId, `👋 Selamat datang! Pilih kategori pekerjaan:`, keyboard);
      return res.status(200).send("start ok");
    }

    // === Lokasi ===
    if (msg.location) {
      const state = userStates[chatId] || {};
      state.location = msg.location;
      userStates[chatId] = state;
      await sendMessage(chatId, "✅ Lokasi diterima. Sekarang kirim format laporan teks.");
      return res.status(200).send("location ok");
    }

    // === Foto ===
    if (msg.photo) {
      const fileId = msg.photo.at(-1).file_id;
      const fileUrl = await uploadToSupabaseStorage(fileId, chatId);
      const state = userStates[chatId] || {};

      if (!state.photo_before_url) {
        state.photo_before_url = fileUrl;
        await sendMessage(chatId, "✅ Foto sebelum diterima. Sekarang kirim foto sesudah.");
      } else if (!state.photo_after_url) {
        state.photo_after_url = fileUrl;
        await sendMessage(chatId, "✅ Foto sesudah diterima. Sekarang kirim lokasi (📍).");
      }

      userStates[chatId] = state;
      return res.status(200).send("photo ok");
    }

    // === Teks laporan ===
    if (msg.text && msg.text.includes("Nama pekerjaan")) {
      const text = msg.text;
      const nama_pekerjaan = (text.match(/Nama pekerjaan\s*:\s*(.*)/i) || [])[1]?.trim() || null;
      const volume_pekerjaan = (text.match(/Volume pekerjaan.*?:\s*([\d.,]+)/i) || [])[1]?.trim() || null;
      const material = (text.match(/Material\s*:\s*(.*)/i) || [])[1]?.trim() || null;
      const keterangan = (text.match(/Keterangan\s*:\s*(.*)/i) || [])[1]?.trim() || null;

      const state = userStates[chatId] || {};
      const { category, location, photo_before_url, photo_after_url } = state;

      const user = msg.from;
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
    telegram_id: user.id,
    telegram_username: user.username,
    telegram_name: `${user.first_name || ""} ${user.last_name || ""}`.trim(),
    created_at: new Date(),
  },
]);

      if (error) {
        console.error("❌ Supabase error:", error);
        await sendMessage(chatId, "❌ Gagal menyimpan laporan ke database.");
      } else {
        await sendMessage(chatId, "✅ Laporan berhasil disimpan! Terima kasih 🙏");
      }

      delete userStates[chatId];
      return res.status(200).send("report saved");
    }

    // === Default fallback ===
    await sendMessage(chatId, "📋 Kirim /start untuk memulai pelaporan.");
    return res.status(200).send("no match");
  } catch (err) {
    console.error("❌ Handler error:", err);
    return res.status(500).send("internal error");
  }
}

// === Helper functions ===
async function sendMessage(chatId, text, keyboard) {
  const payload = { chat_id: chatId, text, parse_mode: "HTML" };
  if (keyboard) payload.reply_markup = keyboard;

  const res = await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const result = await res.text();
  console.log("📤 Telegram sendMessage:", result);
}

async function getFileUrl(fileId) {
  const res = await fetch(`${TELEGRAM_API}/getFile?file_id=${fileId}`);
  const data = await res.json();
  return `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${data.result.file_path}`;
}
// === Upload foto Telegram ke Supabase Storage ===
async function uploadToSupabaseStorage(fileId, chatId) {
  const fileRes = await fetch(`${TELEGRAM_API}/getFile?file_id=${fileId}`);
  const fileData = await fileRes.json();
  const filePath = fileData.result.file_path;

  const fileBuffer = await fetch(`https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${filePath}`)
    .then(res => res.arrayBuffer());

  const fileName = `${chatId}_${Date.now()}.jpg`;
  const { data, error } = await supabase.storage
    .from("reports") // ⬅️ pastikan bucket "reports" sudah dibuat di Supabase
    .upload(fileName, Buffer.from(fileBuffer), {
      contentType: "image/jpeg",
      upsert: false,
    });

  if (error) {
    console.error("❌ Upload error:", error);
    return null;
  }

  const { data: publicUrl } = supabase.storage.from("reports").getPublicUrl(fileName);
  return publicUrl.publicUrl;
}
