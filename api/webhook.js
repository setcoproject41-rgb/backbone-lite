import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";

// === Konfigurasi ===
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// State sementara untuk simpan proses user
const userState = {}; // { userId: { step, category, before, after, ... } }

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method not allowed");

  try {
    const body = req.body;
    const msg = body.message || body.callback_query;
    if (!msg) return res.status(200).send("no message");

    const chatId = msg.message?.chat?.id || msg.chat.id;
    const from = msg.from;
    const userId = from.id.toString();
    const username = from.username || "unknown";
    const fullname = `${from.first_name || ""} ${from.last_name || ""}`.trim();

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

      const guide = `
👷‍♂️ *Tata Cara Pelaporan Lapangan:*

1️⃣ Pilih kategori pekerjaan  
2️⃣ Kirim *foto sebelum pekerjaan*  
3️⃣ Kirim *foto sesudah pekerjaan*  
4️⃣ Kirim *lokasi (📍)*  
5️⃣ Kirim format laporan berikut:

\`\`\`
Nama pekerjaan : 
Volume pekerjaan (M) : 
Material : 
Keterangan :
\`\`\`

Tekan salah satu kategori di bawah ini untuk memulai.
      `;

      await sendMessage(chatId, guide, keyboard);
      return res.status(200).send("start sent");
    }

    // === Handle kategori (callback_data) ===
    if (msg.data) {
      const category = msg.data;
      if (!userState[userId]) userState[userId] = {};
      userState[userId].category = category;
      userState[userId].step = "before";

      await sendMessage(
        chatId,
        `✅ Kategori *${category}* dipilih.\n\nSilakan kirim *foto sebelum pekerjaan dimulai* 📸`
      );
      return res.status(200).send("category selected");
    }

    // === Handle foto ===
    if (msg.photo) {
      const fileId = msg.photo[msg.photo.length - 1].file_id;
      const step = userState[userId]?.step || "before";
      const category = userState[userId]?.category || "Tidak diketahui";

      const fileUrl = await getFileUrl(fileId);
      const fileBuffer = await fetch(fileUrl).then((r) => r.arrayBuffer());
      const fileName = `${Date.now()}_${step}_${userId}.jpg`;

      const { data, error } = await supabase.storage
        .from("survey_photos")
        .upload(fileName, Buffer.from(fileBuffer), {
          contentType: "image/jpeg",
          upsert: true,
        });

      if (error) {
        console.error("Upload error:", error);
        await sendMessage(chatId, "❌ Gagal mengunggah foto ke Supabase.");
        return res.status(200).send("upload fail");
      }

      const { data: public } = supabase.storage
        .from("survey_photos")
        .getPublicUrl(fileName);

      if (!userState[userId]) userState[userId] = {};
      if (step === "before") {
        userState[userId].photo_before_url = public.publicUrl;
        userState[userId].step = "after";
        await sendMessage(chatId, "✅ Foto *sebelum* diterima.\nSekarang kirim *foto sesudah pekerjaan*.");
      } else if (step === "after") {
        userState[userId].photo_after_url = public.publicUrl;
        userState[userId].step = "location";
        await sendMessage(chatId, "✅ Foto *sesudah* diterima.\nSekarang kirim *lokasi pekerjaan (📍)*.");
      }

      return res.status(200).send("photo ok");
    }

    // === Handle lokasi ===
    if (msg.location) {
      if (!userState[userId]) userState[userId] = {};
      userState[userId].latitude = msg.location.latitude;
      userState[userId].longitude = msg.location.longitude;
      userState[userId].step = "report";

      await sendMessage(chatId, "✅ Lokasi tersimpan.\nSekarang kirim format laporan teks sesuai panduan.");
      return res.status(200).send("location ok");
    }

    // === Handle teks laporan ===
    if (msg.text && msg.text.includes("Nama pekerjaan")) {
      const state = userState[userId] || {};

      const nama_pekerjaan = (msg.text.match(/Nama pekerjaan\s*:\s*(.*)/i) || [])[1]?.trim();
      const volume_pekerjaan = (msg.text.match(/Volume.*?:\s*(.*)/i) || [])[1]?.trim();
      const material = (msg.text.match(/Material\s*:\s*(.*)/i) || [])[1]?.trim();
      const keterangan = (msg.text.match(/Keterangan\s*:\s*(.*)/i) || [])[1]?.trim();

      const dataInsert = {
        category: state.category,
        nama_pekerjaan,
        volume_pekerjaan,
        material,
        keterangan,
        photo_before_url: state.photo_before_url,
        photo_after_url: state.photo_after_url,
        latitude: state.latitude,
        longitude: state.longitude,
        telegram_id: userId,
        telegram_username: username,
        telegram_name: fullname,
        created_at: new Date(),
      };

      const { error } = await supabase.from("reports").insert([dataInsert]);
      if (error) {
        console.error("Insert error:", error);
        await sendMessage(chatId, "❌ Gagal menyimpan laporan ke database.");
      } else {
        await sendMessage(chatId, "✅ Laporan berhasil disimpan! Terima kasih 🙏");
      }

      delete userState[userId];
      return res.status(200).send("report ok");
    }

    // === Default ===
    await sendMessage(chatId, "📋 Ketik /start untuk memulai pelaporan baru.");
    return res.status(200).send("done");
  } catch (err) {
    console.error("❌ Webhook error:", err);
    return res.status(500).send("internal error");
  }
}

// === Helper: kirim pesan ke Telegram ===
async function sendMessage(chatId, text, keyboard) {
  const payload = {
    chat_id: chatId,
    text,
    parse_mode: "Markdown",
  };
  if (keyboard) payload.reply_markup = keyboard;

  await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

// === Helper: ambil file URL Telegram ===
async function getFileUrl(fileId) {
  const res = await fetch(`${TELEGRAM_API}/getFile?file_id=${fileId}`);
  const data = await res.json();
  return `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${data.result.file_path}`;
    }
