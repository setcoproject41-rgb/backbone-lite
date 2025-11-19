// pages/api/telegram-handler.js

import { createClient } from '@supabase/supabase-js';
import { Telegraf } from 'telegraf';
import axios from 'axios';

// =================================================================
// 1. INISIALISASI KLIENT DAN BOT
// =================================================================

const supabase = createClient(
    process.env.SUPABASE_URL, 
    process.env.SUPABASE_SERVICE_KEY
);
const bot = new Telegraf(process.env.BOT_TOKEN);
const telegramApiUrl = `https://api.telegram.org/bot${process.env.BOT_TOKEN}`;

// Daftar Langkah Pelaporan
const STEPS = [
    'BEFORE_WORK', // Foto Sebelum
    'PROGRESS_WORK', // Foto Selama Progres
    'AFTER_WORK', // Foto Sesudah/Hasil Akhir
    'FINAL_VIDEO', // Video
    'DESCRIPTION' // Keterangan (Terakhir)
];

// =================================================================
// 2. MIDDLEWARE STATE MANAGEMENT KUSTOM
// =================================================================

const stateMiddleware = async (ctx, next) => {
    if (!ctx.from || !ctx.from.id) {
        return next();
    }
    
    const userId = ctx.from.id.toString();
    
    // 1. Ambil State Saat Ini dari DB
    const { data: sessionData } = await supabase
        .from('bot_sessions')
        .select('*')
        .eq('user_id', userId)
        .single();
    
    // Inisialisasi ctx.session
    ctx.session = sessionData || {
        user_id: userId,
        current_structure_id: null,
        current_report_log_id: null,
        selected_span_num: null,
        reporting_step: null, // NEW: Langkah pelaporan saat ini
        photo_count: 0, // NEW: Hitungan foto per langkah (untuk multi-foto)
    };
    
    await next();
    
    // 2. Simpan State Kembali ke DB setelah handler selesai
    const payload = {
        user_id: userId,
        current_structure_id: ctx.session.current_structure_id || null,
        current_report_log_id: ctx.session.current_report_log_id || null,
        selected_span_num: ctx.session.selected_span_num || null,
        reporting_step: ctx.session.reporting_step || null, // NEW
        photo_count: ctx.session.photo_count || 0, // NEW
        updated_at: new Date().toISOString()
    };

    await supabase
        .from('bot_sessions')
        .upsert(payload, { onConflict: 'user_id' });
};

bot.use(stateMiddleware);


// =================================================================
// 3. FUNGSI BANTUAN
// =================================================================

/** Mengambil step berikutnya dan memberikan prompt ke user */
const goToNextStep = async (ctx, currentStep) => {
    const currentIndex = STEPS.indexOf(currentStep);
    const nextIndex = currentIndex + 1;

    // Cek apakah sudah langkah terakhir (Deskripsi)
    if (nextIndex >= STEPS.length) {
        ctx.session.reporting_step = 'DESCRIPTION';
        return ctx.reply('✅ Selesai mengumpulkan eviden visual. Sekarang, kirimkan **Keterangan Progress, Job Desc, dan Volume Selesai** (teks) untuk menyelesaikan laporan.');
    }
    
    const nextStep = STEPS[nextIndex];
    ctx.session.reporting_step = nextStep;
    ctx.session.photo_count = 0; // Reset hitungan foto
    
    let message = '';
    let keyboard = null;

    switch (nextStep) {
        case 'PROGRESS_WORK':
            message = 'LANGKAH 2/5: Kirimkan **Foto Progres** yang sedang dikerjakan. Anda bisa mengirim beberapa foto.';
            break;
        case 'AFTER_WORK':
            message = 'LANGKAH 3/5: Kirimkan **Foto Sesudah/Hasil Akhir** pekerjaan.';
            break;
        case 'FINAL_VIDEO':
            message = 'LANGKAH 4/5: Kirimkan **Video singkat (maks 50 detik)** sebagai bukti pekerjaan.';
            break;
        default:
            return ctx.reply('Terjadi kesalahan alur.');
    }
    
    // Tombol 'Lanjut' untuk pindah ke step berikutnya
    keyboard = [[{ text: `Lanjut ke ${STEPS[nextIndex + 1] || 'Keterangan'}`, callback_data: `next_step_${nextStep}` }]];

    ctx.reply(message, {
        reply_markup: { inline_keyboard: keyboard }
    });
};

/** Membuat tombol untuk Lanjut ke Step Berikutnya */
const getNextStepKeyboard = (currentStep) => {
    const currentIndex = STEPS.indexOf(currentStep);
    const nextStep = STEPS[currentIndex + 1];
    
    if (nextStep) {
        return [[{ text: `Selesai Kirim. Lanjut ke langkah berikutnya.`, callback_data: `next_step_${currentStep}` }]];
    }
    return null; // Akan langsung ke DESCRIPTION
};


// =================================================================
// 4. LOGIKA UTAMA BOT
// =================================================================

// ... (bot.start dan bot.command('lapor') dan callback_query (select_span, select_designator) sama seperti script multi-step sebelumnya) ...

// --- Menangani Pilihan Designator (LANGKAH 0: Mulai Reporting) ---
bot.on('callback_query', async (ctx) => {
    const data = ctx.callbackQuery.data;

    if (data.startsWith('select_designator_')) {
        const structureId = data.split('_')[2];
        
        ctx.session.current_structure_id = structureId; 
        ctx.session.selected_span_num = null;
        
        // Mulai ke Step 1
        ctx.session.reporting_step = 'BEFORE_WORK'; 

        await ctx.answerCbQuery();
        await ctx.editMessageText('✅ Lokasi Dipilih. LANGKAH 1/5: Kirimkan **Foto SEBELUM** pekerjaan dimulai. Anda bisa mengirim beberapa foto.', {
             reply_markup: { inline_keyboard: getNextStepKeyboard('BEFORE_WORK') }
        });

    } else if (data.startsWith('next_step_')) {
        const currentStep = data.substring('next_step_'.length);
        await ctx.answerCbQuery();
        
        // Pindah ke langkah berikutnya
        await goToNextStep(ctx, currentStep);
    }
});


// --- Menangani Foto Evidence (BEFORE, PROGRESS, AFTER) ---
bot.on('photo', async (ctx) => {
    const logId = ctx.session.current_report_log_id;
    const step = ctx.session.reporting_step;
    const structureId = ctx.session.current_structure_id;

    if (!structureId || !step || step === 'DESCRIPTION' || step === 'FINAL_VIDEO') {
        return ctx.reply('⚠️ Harap ikuti alur. Gunakan tombol "Lanjut" atau kirim Keterangan.');
    }
    
    const photoArray = ctx.message.photo;
    const fileId = photoArray[photoArray.length - 1].file_id;
    
    // --- AMBIL/BUAT REPORT LOG ID ---
    // (Anda harus mengganti logic ini dengan kode insert ke report_logs yang asli)
    if (!logId) {
        // Logika insert awal ke report_logs dan set ctx.session.current_report_log_id = reportLog.id
        // ...
        ctx.session.current_report_log_id = Math.floor(Math.random() * 1000); // Placeholder
    }

    // --- LOGIKA UPLOAD DAN CATAT EVIDENCE ---
    // (Logika ini harus dimasukkan di sini, menggunakan fileId dan step sebagai tag)
    // uploadFileToSupabase(fileId, step, logId);
    
    ctx.session.photo_count += 1; // Hitung foto yang masuk
    
    ctx.reply(`[${step}] Foto ke-${ctx.session.photo_count} berhasil diunggah. Kirim foto lagi atau tekan "Lanjut".`, {
         reply_markup: { inline_keyboard: getNextStepKeyboard(step) }
    });
});


// --- Menangani Video Evidence (FINAL_VIDEO) ---
bot.on('video', async (ctx) => {
    const logId = ctx.session.current_report_log_id;
    const step = ctx.session.reporting_step;
    const structureId = ctx.session.current_structure_id;

    if (!structureId || step !== 'FINAL_VIDEO') {
        return ctx.reply('⚠️ Harap kirim video hanya di langkah "Video Evidence".');
    }
    
    // Cek apakah video terlalu besar
    if (ctx.message.video.duration > 60) {
        return ctx.reply('❌ Video maksimal 60 detik.');
    }
    
    const fileId = ctx.message.video.file_id;

    // --- LOGIKA UPLOAD VIDEO DAN CATAT EVIDENCE ---
    // uploadFileToSupabase(fileId, step, logId);
    
    await goToNextStep(ctx, 'FINAL_VIDEO');

    ctx.reply('✅ Video berhasil diunggah! Lanjut ke langkah terakhir.', {
         reply_markup: { inline_keyboard: getNextStepKeyboard('FINAL_VIDEO') }
    });
});


// --- Menangani Teks Keterangan (DESCRIPTION) ---
bot.on('text', async (ctx) => {
    const logId = ctx.session.current_report_log_id;
    const step = ctx.session.reporting_step;

    // HANYA terima TEXT jika step-nya adalah DESCRIPTION
    if (!logId || step !== 'DESCRIPTION') {
        return ctx.reply('Mohon gunakan /lapor untuk memulai proses laporan.');
    }
    
    const text = ctx.message.text;

    // Parsing Volume dan Update report_logs
    const volumeMatch = text.match(/[\d\.]+/g);
    const volume = volumeMatch ? parseFloat(volumeMatch.pop()) : 0;
    
    const { error: updateError } = await supabase
        .from('report_logs')
        .update({
            progress_detail: text,
            volume_reported: volume || 0 
        })
        .eq('id', logId);

    if (updateError) {
        console.error('Update Log Error:', updateError);
        return ctx.reply('Gagal mencatat detail laporan. Mohon coba lagi.');
    }

    // --- KONFIRMASI AKHIR DAN RESET ---
    const finalMessage = `
    🎉 *LAPORAN SELESAI!*
    Detail progress telah dicatat dan menunggu validasi di dashboard.

    *Job Desc:* ${text}
    *Volume Lapor:* ${volume}

    Terima kasih telah melapor!
    `;
    
    // Reset state sesi
    ctx.session.current_report_log_id = null;
    ctx.session.current_structure_id = null;
    ctx.session.reporting_step = null;
    ctx.session.photo_count = 0;

    ctx.replyWithMarkdown(finalMessage);
});


// =================================================================
// 5. EXPORT HANDLER UNTUK VERCEL API ROUTE
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
        res.status(200).send('Project Manager Bot is running. Set webhook to this endpoint.');
    }
}
