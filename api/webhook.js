import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const userStates = {};

export default async function handler(req, res) {
  try {
    console.log("📩 Request:", req.method, req.url);

    // Body parser manual (karena Vercel runtime tidak auto-parse JSON)
    let body;
    try {
      body = typeof req.body === "object" ? req.body : JSON.parse(req.body);
    } catch (e) {
      console.error("❌ JSON parse error:", e);
      return res.status(400).send("invalid json");
    }

    console.log("📦 Body:", JSON.stringify(body, null, 2));

    if (req.method !== "POST") {
      return res.status(405).send("Method not allowed");
    }

    const msg = body.message || body.callback_query;
    if (!msg) {
      console.log("⚠️ No message found in update");
      return res.status(200).send("no message");
    }

    const chatId = msg.chat?.id || msg.message?.chat?.id;
    const user = msg.from || msg.message?.from;

    // Simpan info user di state
    if (chatId && user) {
      userStates[chatId] = {
        ...userStates[chatId],
        telegram_id: user.id,
        telegram_username: user.username,
        telegram_name: `${user.first_name || ""} ${user.last_name || ""}`.trim(),
      };
    }

    // === Handle /start ===
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
1️⃣ Kirim /start untuk memulai.  
2️⃣ Pilih kategori pekerjaan.  
3️⃣ Kirim foto <b>sebelum</b> pekerjaan.  
4️⃣ Kirim foto <b>sesudah</b> pekerjaan.  
5️⃣ Kirim lokasi (📍).  
6️⃣ Terakhir, kirim format laporan teks:

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

    // === CALLBACK ===
    if (msg.data) {
      const category = msg.data;
      userStates[chatId] = { ...userStates[chatId], category };
      await sendMessage(chatId, `✅ Kategori dipilih: <b>${category}</b>`);
      return res.status(200).send("category ok");
    }

    // === FOTO ===
    if (msg.photo) {
      const fileId = msg.photo[msg.photo.length - 1].file_id;
      try {
        const fileUrl = await getFileUrl(fileId);
        const state = userStates[chatId] || {};
        if (!state.photo_before_url) {
          state.photo_before_url = fileUrl;
          await sendMessage(chatId, "✅ Foto *sebelum* diterima. Kirim foto *sesudah*.");
        } else {
          state.photo_after_url = fileUrl;
          await sendMessage(chatId, "✅ Foto *sesudah* diterima. Kirim lokasi (📍).");
        }
        userStates[chatId] = state;
      } catch (e) {
        console.error("❌ Error ambil foto:", e);
      }
      return res.status(200).send("photo ok");
    }

    // === LOKASI ===
    if (msg.location) {
      userStates[chatId] = { ...userStates[chatId], location: msg.location };
      await sendMessage(chatId, "✅ Lokasi diterima. Sekarang kirim format laporan teks.");
      return res.status(200).send("location ok");
    }

    // === TEKS REPORT ===
    if (msg.text && msg.text.includes("Nama pekerjaan")) {
      const text = msg.text;
      const nama_pekerjaan = (text.match(/Nama pekerjaan\s*:\s*(.*)/i) || [])[1]?.trim() || null;
      const volume_pekerjaan = (text.match(/Volume.*:\s*([\d.,]+)/i) || [])[1]?.trim() || null;
      const material = (text.match(/Material\s*:\s*(.*)/i) || [])[1]?.trim() || null;
      const keterangan = (text.match(/Keterangan\s*:\s*(.*)/i) || [])[1]?.trim() || null;

      const state = userStates[chatId] || {};
      const { category, location, photo_before_url, photo_after_url, telegram_id, telegram_username, telegram_name } = state;

      console.log("🧾 Insert to Supabase:", {
        category,
        nama_pekerjaan,
        volume_pekerjaan,
        material,
        keterangan,
        latitude: location?.latitude,
        longitude: location?.longitude,
        telegram_id,
        telegram_username,
        telegram_name,
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
          telegram_id,
          telegram_username,
          telegram_name,
          created_at: new Date(),
        },
      ]);

      if (error) {
        console.error("❌ Supabase error:", error);
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

async function sendMessage(chatId, text, keyboard) {
  const payload = { chat_id: chatId, text, parse_mode: "HTML" };
  if (keyboard) payload.reply_markup = keyboard;
  const res = await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const result = await res.text();
  console.log("📤 Telegram sendMessage result:", result);
}

async function getFileUrl(fileId) {
  const res = await fetch(`${TELEGRAM_API}/getFile?file_id=${fileId}`);
  const data = await res.json();
  if (!data.ok) throw new Error(JSON.stringify(data));
  return `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${data.result.file_path}`;
}
