// pages/api/telegram-handler.js (DISIMPLIFIKASI)

import { Telegraf } from 'telegraf';

const bot = new Telegraf(process.env.BOT_TOKEN);

// Hapus Middleware State Management

// --- /start Command: Memberikan Tautan ke Web Form ---
bot.start((ctx) => {
    // Ganti URL ini dengan URL Vercel Anda
    const WEB_FORM_URL = 'https://backbone-lite.vercel.app/'; 
    
    const guideText = `
*Selamat datang di Project Manager Bot!*
Sistem pelaporan kini dipindahkan ke Web Form untuk stabilitas data.

Silakan klik tautan di bawah untuk mengisi dan mengirim laporan progress (Lokasi, Keterangan, Volume, dan Foto/Video):

🔗 [Buka Formulir Laporan](${WEB_FORM_URL})

Terima kasih.
    `;
    return ctx.replyWithMarkdown(guideText);
});

// --- Default Handler ---
bot.on('message', (ctx) => {
    return ctx.reply('Mohon gunakan /start untuk melihat panduan dan tautan ke Formulir Web Laporan.');
});


// =================================================================
// 4. EXPORT HANDLER UNTUK VERCEL API ROUTE
// =================================================================

export default async function handler(req, res) {
    if (req.method === 'POST') {
        try {
            await bot.handleUpdate(req.body, res);
            res.status(200).send('OK');
        } catch (error) {
            console.error('Error processing update:', error);
            res.status(200).send('Error Handled'); 
        }
    } else {
        res.status(200).send('Project Manager Bot is running. Use POST requests for webhooks.');
    }
}
