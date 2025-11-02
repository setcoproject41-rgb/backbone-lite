import { createClient } from "@supabase/supabase-js";
import { v4 as uuidv4 } from "uuid";

// === ENV ===
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;
const FILE_API = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}`;
const userStates = {};

export default async function handler(req, res) {
  try {
    console.log("📩 Incoming request:", req.method, req.url);

    if (req.method !== "POST") {
      return res.status(405).send("Method not allowed");
    }

    // Parse body manual
    let body;
    try {
      body = typeof req.body === "object" ? req.body : JSON.parse(req.body);
    } catch (e) {
      console.error("❌ JSON parse error:", e);
      return res.status(400).send("Invalid JSON");
    }

    const msg = body.message || body.callback_query;
    if (!msg) return res.status(200).send("no message");

    const chatId = msg.chat?.id || msg.message?.chat?.id;
    const user = msg.from || msg.message?.from;

    // Simpan info user
    if (chatId && user) {
      userStates[chatId] = {
        ...userStates[chatId],
        telegram_id: user.id,
        telegram_username: user.username,
        telegram_name: `${user.first_name || ""} ${user.last_name || ""}`.trim(),
      };
    }

    // === COMMAND /START ===
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

      const helpText = `
👋 <b>Selamat datang di Sistem Pelaporan Lapangan!</b>

📋 <b>Tata cara pelaporan:</b>
1️⃣ Ketik /start untuk memulai  
2️⃣ Pilih kategori pekerjaan  
3️⃣ Kirim foto <b>sebelum</b> pekerjaan  
4️⃣ Kirim foto <b>sesudah</b> pekerjaan  
5️⃣ Kirim lokasi (📍)  
6️⃣ Kirim format laporan:

<pre>
Nama pekerjaan :
Volume pekerjaan (M) :
Material :
Keterangan :
</pre>
`;

      await sendMessage(chatId, helpText, keyboard);
      return res.status(200).send("start ok");
    }

    // === CALLBACK kategori ===
    if (msg.data) {
      const category = msg.data;
      userStates[chatId] = { ...userStates[chatId], category };
      await sendMessage(chatId, `✅ Kategori dipilih: <b>${category}</b>`);
      return res.status(200).send("category ok");
    }

    // === FOTO ===
    if (msg.photo) {
      const fileId = msg.photo[msg.photo.length - 1].file_id;
      const state = userStates[chatId] || {};

      try {
        const fileUrl = await getFileUrl(fileId);
        const uploadedUrl = await uploadToSupabase(fileUrl, chatId);

        if (!state.photo_before_url) {
          state.photo_before_url = uploadedUrl;
          await sendMessage(chatId, "✅ Foto *sebelum* diterima. Kirim foto *sesudah*.");
        } else {
          state.photo_after_url = uploadedUrl;
          await sendMessage(chatId, "✅ Foto *sesudah* diterima. Kirim lokasi (📍).");
        }

        userStates[chatId] = state;
      } catch (e) {
        console.error("❌ Error upload foto:", e);
        await sendMessage(chatId, "❌ Gagal upload foto. Coba lagi.");
      }

      return res.status(200).send("photo ok");
    }

    // === LOKASI ===
    if (msg.location) {
      userStates[chatId] = { ...userStates[chatId], location: msg.location };
      await sendMessage(chatId, "✅ Lokasi diterima. Sekarang kirim format laporan teks.");
      return res.status(200).send("location ok");
    }

    // === LAPORAN ===
    if (msg.text && msg.text.includes("Nama pekerjaan")) {
      const text = msg.text;
      const nama_pekerjaan = (text.match(/Nama pekerjaan\s*:\s*(.*)/i) || [])[1]?.trim() || null;
      const volume_pekerjaan = (text.match(/Volume.*:\s*([\d.,]+)/i) || [])[1]?.trim() || null;
      const material = (text.match(/Material\s*:\s*(.*)/i) || [])[1]?.trim() || null;
      const keterangan = (text.match(/Keterangan\s*:\s*(.*)/i) || [])[1]?.trim() || null;

      const state = userStates[chatId] || {};
      const { category, location, photo_before_url, photo_after_url, telegram_id, telegram_username, telegram_name } = state;

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
          telegram_id,
          telegram_username,
          telegram_name,
          created_at: new Date(),
        },
      ]);

      if (error) {
        console.error("❌ Supabase insert error:", error);
        await sendMessage(chatId, "❌ Gagal menyimpan laporan.");
      } else {
        await sendMessage(chatId, "✅ Laporan berhasil disimpan!");
      }

      delete userStates[chatId];
      return res.status(200).send("report ok");
    }

    return res.status(200).send("ok");
  } catch (err) {
    console.error("❌ Handler error:", err);
    return res.status(500).send("internal error");
  }
}

// === Kirim pesan Telegram ===
async function sendMessage(chatId, text, keyboard) {
  const payload = { chat_id: chatId, text, parse_mode: "HTML" };
  if (keyboard) payload.reply_markup = keyboard;

  await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

// === Ambil file Telegram dan upload ke Supabase Storage ===
async function uploadToSupabase(fileUrl, chatId) {
  const response = await fetch(fileUrl);
  const buffer = await response.arrayBuffer();

  const fileName = `${chatId}/${uuidv4()}.jpg`;
  const { error } = await supabase.storage.from("survey_photos").upload(fileName, Buffer.from(buffer), {
    contentType: "image/jpeg",
    upsert: true,
  });

  if (error) throw error;

  return `${SUPABASE_URL}/storage/v1/object/public/survey_photos/${fileName}`;
}

// === Ambil file URL dari Telegram ===
async function getFileUrl(fileId) {
  const res = await fetch(`${TELEGRAM_API}/getFile?file_id=${fileId}`);
  const data = await res.json();
  if (!data.ok) throw new Error(JSON.stringify(data));
  return `${FILE_API}/${data.result.file_path}`;
}
