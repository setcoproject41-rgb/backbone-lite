// telegram-handler.js

import { createClient } from '@supabase/supabase-js';
import { Telegraf } from 'telegraf';
// import axios, dll.

// Inisialisasi Klien (Dilakukan sekali)
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const bot = new Telegraf(process.env.BOT_TOKEN);

// --- LOGIKA UTAMA BOT (Command, on('photo'), dll.) ada di sini ---
// ... (Logika yang kita buat sebelumnya)

// Export Handler untuk Vercel API Route
export default async function handler(req, res) {
    if (req.method === 'POST') {
        try {
            // Memberi tahu Telegraf untuk memproses body JSON dari Telegram
            await bot.handleUpdate(req.body, res);
            
            // Mengirim respons sukses ke Telegram agar tidak mencoba mengirim ulang
            res.status(200).send('OK'); 
        } catch (error) {
            console.error('Error processing update:', error);
            res.status(500).send('Internal Server Error');
        }
    } else {
        // Mengirim respons 405 untuk metode selain POST (seperti GET)
        res.status(405).send('Method Not Allowed'); 
    }
}
