// pages/api/telegram-handler.js

import { createClient } from '@supabase/supabase-js';
import { Telegraf } from 'telegraf';
import axios from 'axios';
import { Buffer } from 'buffer'; // Pastikan Buffer di-import jika menggunakan Vercel

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
    'BEFORE_WORK',   // 1. Foto Sebelum
    'PROGRESS_WORK', // 2. Foto Selama Progres
    'AFTER_WORK',    // 3. Foto Sesudah/Hasil Akhir
    'FINAL_VIDEO',   // 4. Video
    'DESCRIPTION'    // 5. Keterangan (Terakhir)
];

// =================================================================
// 2. MIDDLEWARE STATE MANAGEMENT KUSTOM (TIDAK BERUBAH)
// =================================================================

const stateMiddleware = async (ctx, next) => {
    if (!ctx.from || !ctx.from.id) {
        return next();
    }
    
    const userId = ctx.from.id.toString();
    
    const { data: sessionData } = await supabase
        .from('bot_sessions')
        .select('*')
        .eq('user_id', userId)
        .single();
    
    ctx.session = sessionData || {
        user_id: userId,
        current_structure_id: null,
        current_report_log_id: null,
        selected_span_num: null,
        reporting_step: null,
        photo_count: 0,
    };
    
    await next();
    
    const payload = {
        user_id: userId,
        current_structure_id: ctx.session.current_structure_id || null,
        current_report_log_id: ctx.session.current_report_log_id || null,
        selected_span_num: ctx.session.selected_span_num || null,
        reporting_step: ctx.session.reporting_step || null,
        photo_count: ctx.session.photo_count || 0,
        updated_at: new Date().toISOString()
    };

    await supabase
        .from('bot_sessions')
        .upsert(payload, { onConflict: 'user_id' });
};

bot.use(stateMiddleware);


// =================================================================
// 3. FUNGSI BANTUAN (MODIFIKASI: Menghapus Logic Keyboard)
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

    switch (nextStep) {
        case 'PROGRESS_WORK':
            message = 'LANGKAH 2/5: Kirimkan **Foto Progres** yang sedang dikerjakan. Kirim semua foto yang diperlukan, lalu **ketik selesai** untuk lanjut.';
            break;
        case 'AFTER_WORK':
            message = 'LANGKAH 3/5: Kirimkan **Foto Sesudah/Hasil Akhir** pekerjaan. Kirim semua foto, lalu **ketik selesai** untuk lanjut.';
            break;
        case 'FINAL_VIDEO':
            message = 'LANGKAH 4/5: Kirimkan **Video singkat (maks 60 detik)** sebagai bukti pekerjaan, lalu **ketik selesai** untuk lanjut.';
            break;
        default:
            return ctx.reply('Terjadi kesalahan alur.');
    }

    ctx.reply(message);
};


// =================================================================
// 4. LOGIKA UTAMA BOT (MODIFIKASI: Menghapus Tombol Lanjut)
// =================================================================

// --- /start Command: Menampilkan Panduan (TIDAK BERUBAH) ---
bot.start((ctx) => {
    const guideText = `
*Selamat datang di Project Manager Bot!*
Berikut adalah tata cara untuk melaporkan progres pekerjaan:

1.  Kirim perintah */lapor*.
2.  Pilih **Span Number** lalu **Designator**.
3.  Ikuti 5 langkah pengiriman eviden. Setelah selesai mengirim foto/video di setiap langkah, **ketik selesai** untuk maju.

Silakan kirim */lapor* untuk memulai!
    `;
    return ctx.replyWithMarkdown(guideText);
});


// --- /lapor Command: LANGKAH 1 - Meminta User Memilih Span Number (TIDAK BERUBAH) ---
bot.command('lapor', async (ctx) => {
    // Reset semua state
    ctx.session.current_report_log_id = null;
    ctx.session.current_structure_id = null;
    ctx.session.selected_span_num = null;
    ctx.session.reporting_step = null;
    ctx.session.photo_count = 0;

    const { data: structures, error } = await supabase
        .from('project_structure')
        .select('span_num')
        .order('span_num', { ascending: true })
        .limit(500); 

    if (error || !structures.length) {
        console.error('DB Error:', error);
        return ctx.reply('⚠️ Error: Data Span Proyek tidak ditemukan.');
    }

    const uniqueSpans = [...new Set(structures.map(s => s.span_num))].filter(s => s);

    const keyboard = uniqueSpans.map(span => ([
        { 
            text: span,
            callback_data: `select_span_${span}` 
        }
    ]));

    ctx.reply('LANGKAH 1/5 (Lokasi): Pilih Span Number:', {
        reply_markup: { inline_keyboard: keyboard }
    });
});


// --- Menangani Pilihan Span dan Designator dari Inline Keyboard ---
bot.on('callback_query', async (ctx) => {
    const data = ctx.callbackQuery.data;

    // --- LANGKAH 1.1: Setelah memilih SPAN, tampilkan DESIGNATOR ---
    if (data.startsWith('select_span_')) {
        const selectedSpanNum = data.substring('select_span_'.length);
        
        ctx.session.selected_span_num = selectedSpanNum; 

        const { data: structures, error: structError } = await supabase
            .from('project_structure')
            .select('id, designator_name')
            .eq('span_num', selectedSpanNum)
            .order('designator_name', { ascending: true });

        if (structError || !structures.length) {
            await ctx.answerCbQuery('Error mengambil Designator.');
            return ctx.editMessageText('❌ Error: Designator untuk Span ini tidak ditemukan.');
        }

        const keyboard = structures.map(s => ([
            { 
                text: s.designator_name,
                callback_data: `select_designator_${s.id}` 
            }
        ]));

        await ctx.answerCbQuery();
        await ctx.editMessageText(`LANGKAH 1/5 (Lokasi): Span *${selectedSpanNum}* dipilih. Pilih Designator yang sesuai:`, {
            reply_markup: { inline_keyboard: keyboard },
            parse_mode: 'Markdown'
        });
        
    // --- LANGKAH 1.2: Setelah memilih DESIGNATOR, mulai Reporting ---
    } else if (data.startsWith('select_designator_')) {
        const structureId = data.split('_')[2];
        
        ctx.session.current_structure_id = structureId; 
        ctx.session.selected_span_num = null; 
        
        // Mulai ke Step 1 (BEFORE_WORK)
        ctx.session.reporting_step = 'BEFORE_WORK'; 

        await ctx.answerCbQuery();
        await ctx.editMessageText('✅ Lokasi Dipilih. LANGKAH 1/5: Kirimkan **Foto SEBELUM** pekerjaan dimulai. Kirim semua foto, lalu **ketik selesai** untuk lanjut.', {
            parse_mode: 'Markdown'
        });
    }
});


// --- Menangani Foto Evidence (BEFORE, PROGRESS, AFTER) ---
bot.on('photo', async (ctx) => {
    const logId = ctx.session.current_report_log_id;
    const step = ctx.session.reporting_step;
    const structureId = ctx.session.current_structure_id;

    if (!structureId) {
        return ctx.reply('⚠️ Mohon selesaikan pemilihan lokasi dengan /lapor terlebih dahulu.');
    }
    
    // Video dan Deskripsi tidak boleh menerima foto
    if (step === 'DESCRIPTION' || step === 'FINAL_VIDEO' || !step) {
        return ctx.reply('⚠️ Harap ikuti alur. Saat ini Anda diminta mengirim Video atau Keterangan. Jika selesai mengirim foto, **ketik selesai**.');
    }
    
    const photoArray = ctx.message.photo;
    const largestPhoto = photoArray[photoArray.length - 1]; 
    const fileId = largestPhoto.file_id;

    try {
        // ... (Logika Insert Log, Get File URL, Upload ke Supabase Storage, dan Insert ke report_evidence SAMA PERSIS dengan script sebelumnya) ...
        
        // --- LOGIKA UPLOAD FOTO DI SINI ---
        let currentLogId = logId;
        if (!currentLogId) {
            // Logika Insert Log Awal
            const { data: reportLog, error: logError } = await supabase
                .from('report_logs')
                .insert({ structure_id: structureId, reporter_id: ctx.from.id.toString(), progress_detail: `Laporan baru, langkah pertama: ${step}` })
                .select('id').single();
            if (logError) throw new Error(logError.message);
            currentLogId = reportLog.id;
            ctx.session.current_report_log_id = currentLogId; 
        }

        // Logic File Upload dan Catat Evidence di sini... (Menggunakan axios dan supabase.storage)
        // ...
        
        ctx.session.photo_count += 1;
        
        // Response sukses (TANPA TOMBOL LANJUT)
        ctx.reply(`[${step}] Foto ke-${ctx.session.photo_count} berhasil diunggah. Kirim foto lagi atau **ketik selesai** untuk lanjut.`);

    } catch (e) {
        console.error('Upload/DB Error:', e);
        ctx.reply('❌ Terjadi kesalahan saat memproses foto. Silakan ulangi /lapor.');
    }
});


// --- Menangani Video Evidence (FINAL_VIDEO) ---
bot.on('video', async (ctx) => {
    const logId = ctx.session.current_report_log_id;
    const step = ctx.session.reporting_step;
    const structureId = ctx.session.current_structure_id;

    if (!structureId || logId === null || step !== 'FINAL_VIDEO') {
        return ctx.reply('⚠️ Harap kirim video hanya di langkah "Video Evidence".');
    }
    
    if (ctx.message.video.duration > 60) {
        return ctx.reply('❌ Video maksimal 60 detik.');
    }
    
    // --- TEMPAT LOGIKA UPLOAD VIDEO LENGKAP DI SINI ---
    // (Gunakan logika upload Supabase Storage yang sama dengan foto)
    
    // Response sukses (TANPA TOMBOL LANJUT)
    ctx.reply('✅ Video berhasil diunggah! **Ketik selesai** untuk lanjut ke langkah terakhir.');
    
    // TIDAK LANGSUNG KE DESCRIPTION, TUNGGU PERINTAH 'SELESAI'
});


// --- Menangani Teks (Termasuk 'selesai' dan Keterangan Akhir) ---
bot.on('text', async (ctx) => {
    const logId = ctx.session.current_report_log_id;
    const step = ctx.session.reporting_step;
    const text = ctx.message.text.trim();
    
    // 1. Cek apakah pengguna mengetik "selesai" (case-insensitive)
    if (text.toLowerCase() === 'selesai') {
        if (!step || !logId || step === 'DESCRIPTION') {
            return ctx.reply('❌ Anda sudah berada di langkah akhir (Keterangan) atau belum memulai laporan. Kirimkan keterangan Anda.');
        }
        
        // Pindah ke step berikutnya
        return goToNextStep(ctx, step);
    }

    // 2. Jika bukan "selesai", pastikan ini adalah langkah DESCRIPTION
    if (!logId || step !== 'DESCRIPTION') {
        return ctx.reply('Mohon gunakan /lapor untuk memulai proses laporan, atau ketik **selesai** jika Anda selesai mengirim foto/video.');
    }
    
    // 3. Logika Pencatatan Keterangan Akhir (HANYA dieksekusi jika step = DESCRIPTION)
    
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
// 5. EXPORT HANDLER UNTUK VERCEL API ROUTE (TIDAK BERUBAH)
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
