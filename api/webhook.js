import TelegramBot from "node-telegram-bot-api";
import { supabase } from "../lib/supabaseServer.js";

const bot = new TelegramBot(process.env.BOT_TOKEN);

// Handler untuk Vercel
export default async function handler(req, res) {
  if (req.method === "GET") {
    return res.status(200).json({ ok: true, message: "Webhook GET OK" });
  }

  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  try {
    const body = req.body;

    // --- Telegram Message ---
    if (body.message) {
      const chatId = body.message.chat.id;
      const text = body.message.text || "";

      await bot.sendMessage(chatId, `Pesan diterima: ${text}`);
    }

    // --- Callback Query ---
    if (body.callback_query) {
      const cb = body.callback_query;
      await bot.answerCallbackQuery(cb.id);
      await bot.sendMessage(cb.message.chat.id, `Callback: ${cb.data}`);
    }

    res.status(200).send("OK");
  } catch (error) {
    console.error("Error webhook:", error);
    res.status(500).send("Error");
  }
}
