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

// =================================================================
// 2. MIDDLEWARE STATE MANAGEMENT KUSTOM
// =================================================================

/**
 * Middleware untuk mengambil dan menyimpan state sesi ke tabel bot_sessions di Supabase.
 * Ditambahkan: selected_span_num untuk alur multi-step.
 */
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
        selected_span_num: null, // NEW: Untuk menyimpan pilihan span sementara
    };
    
    await next();
    
    // 2. Simpan State Kembali ke DB setelah handler selesai
    const payload = {
        user_id: userId,
        current_structure_id: ctx.session.current_structure_id || null,
        current_report_log_id: ctx.session.current_report_log_id || null,
        selected_span_num: ctx.session.selected_span_num || null, // NEW: Simpan span sementara
        updated_at: new Date().toISOString()
    };

    await supabase
        .from('bot_sessions')
        .upsert(payload, { onConflict: 'user_id' });
};

bot.use(stateMiddleware);

// =================================================================
// 3. LOGIKA UTAMA BOT
// =================================================================

// --- /start Command: Menampilkan Panduan ---
bot.start((ctx) => {
    const guideText = `
*Selamat datang di Project Manager Bot!*
Berikut adalah tata cara untuk melaporkan progres pekerjaan:

1.  Kirim perintah */lapor*.
2.  Pilih **Span Number** yang dikerjakan.
3.  Pilih **Designator** yang sesuai dengan Span tersebut.
4.  Kirim **Foto Evidence** (bukti visual).
5.  Kirim **Keterangan Progress** (Job Desc dan Volume Selesai) sebagai teks terpisah.

Silakan kirim */lapor* untuk memulai!
    `;
    return ctx.replyWithMarkdown(guideText);
});


// --- /lapor Command: LANGKAH 1 - Meminta User Memilih Span Number ---
bot.command('lapor', async (ctx) => {
    // Reset semua state saat laporan baru dimulai
    ctx.session.current_report_log_id = null;
    ctx.session.current_structure_id = null;
    ctx.session.selected_span_num = null;

    // 1. Ambil semua Span yang unik dari Supabase
    const { data: structures, error } = await supabase
        .from('project_structure')
        .select('span_num')
        .order('span_num', { ascending: true })
        // Hapus limit jika data di bawah 1000 atau tambahkan limit jika terlalu banyak
        .limit(500); 

    if (error || !structures.length) {
        console.error('DB Error:', error);
        return ctx.reply('⚠️ Error: Data Span Proyek tidak ditemukan.');
    }

    // Filter untuk mendapatkan nilai span_num yang unik
    const uniqueSpans = [...new Set(structures.map(s => s.span_num))].filter(s => s); // Filter null/kosong

    // 2. Buat tombol inline keyboard untuk Span Number
    const keyboard = uniqueSpans.map(span => ([
        { 
            text: span,
            // Callback: Menandai ini adalah pemilihan span, value-nya adalah span_num
            callback_data: `select_span_${span}` 
        }
    ]));

    ctx.reply('LANGKAH 1/2: Pilih Span Number:', {
        reply_markup: { inline_keyboard: keyboard }
    });
});


// --- Menangani Pilihan Span dan Designator dari Inline Keyboard ---
bot.on('callback_query', async (ctx) => {
    const data = ctx.callbackQuery.data;

    // --- LANGKAH 2: Setelah memilih SPAN, tampilkan DESIGNATOR ---
    if (data.startsWith('select_span_')) {
        const selectedSpanNum = data.substring('select_span_'.length);
        
        // Simpan Span yang dipilih ke sesi sementara
        ctx.session.selected_span_num = selectedSpanNum; 

        // 1. Ambil semua Designator yang terkait dengan Span yang dipilih
        const { data: structures, error: structError } = await supabase
            .from('project_structure')
            .select('id, designator_name')
            .eq('span_num', selectedSpanNum)
            .order('designator_name', { ascending: true });

        if (structError || !structures.length) {
            await ctx.answerCbQuery('Error mengambil Designator.');
            return ctx.editMessageText('❌ Error: Designator untuk Span ini tidak ditemukan.');
        }

        // 2. Buat tombol untuk Designator
        const keyboard = structures.map(s => ([
            { 
                text: s.designator_name,
                // Callback: Menyimpan ID penuh (final) untuk proses reporting
                callback_data: `select_designator_${s.id}` 
            }
        ]));

        await ctx.answerCbQuery();
        await ctx.editMessageText(`LANGKAH 2/2: Span *${selectedSpanNum}* dipilih. Pilih Designator yang sesuai:`, {
            reply_markup: { inline_keyboard: keyboard },
            parse_mode: 'Markdown'
        });
        
    // --- LANGKAH 3: Setelah memilih DESIGNATOR, mulai Reporting ---
    } else if (data.startsWith('select_designator_')) {
        const structureId = data.split('_')[2];
        
        // Simpan ID lokasi penuh (final) ke sesi
        ctx.session.current_structure_id = structureId; 
        
        // Bersihkan state sementara
        ctx.session.selected_span_num = null; 

        await ctx.answerCbQuery();
        await ctx.editMessageText('✅ Lokasi Lengkap Dipilih.\n\nSekarang, mohon kirimkan **Foto Evidence** dan **Keterangan Progress** (Job Desc & Volume Selesai) secara terpisah.');
    }
});


// --- Menangani Foto Evidence ---
bot.on('photo', async (ctx) => {
    const structureId = ctx.session.current_structure_id; 

    if (!structureId) {
        return ctx.reply('⚠️ Mohon selesaikan pemilihan lokasi dengan /lapor terlebih dahulu.');
    }
    
    // ... (Logika Foto Evidence: Ambil file, upload ke storage, catat log_id, dan simpan di ctx.session.current_report_log_id) ...
    // ... (Logika ini tetap sama dengan script sebelumnya) ...
    
    // --- TEMPORARY PHOTO LOGIC (GANTIKAN DENGAN LOGIKA UPLOAD SUPABASE LENGKAP) ---
    const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
    
    // Placeholder untuk reportLog.id
    const placeholderLogId = Math.floor(Math.random() * 100000); 
    
    // Simpan log ID untuk update deskripsi berikutnya (disimpan di state kustom)
    ctx.session.current_report_log_id = placeholderLogId; // Ganti dengan ID Supabase asli setelah insert

    // ... (AKHIR LOGIKA TEMPORARY) ...

    ctx.reply(`✅ Foto Evidence berhasil diunggah! (File ID: ${fileId}). Sekarang, mohon kirimkan **deskripsi pekerjaan dan volume** (misal: "Pemasangan Tiang 1.0").`);

});


// --- Menangani Teks Progress setelah Foto ---
bot.on('text', async (ctx) => {
    const logId = ctx.session.current_report_log_id;

    if (!logId) {
        return ctx.reply('Terima kasih. Jika Anda ingin melapor, gunakan /lapor.');
    }
    
    const text = ctx.message.text;

    // ... (Logika Parsing Volume dan Update Supabase report_logs) ...
    // ... (Logika ini tetap sama dengan script sebelumnya) ...

    // Hapus kedua state sesi setelah selesai (reset untuk sesi berikutnya)
    ctx.session.current_report_log_id = null;
    ctx.session.current_structure_id = null;

    ctx.reply('🎉 Detail progress berhasil dicatat dan menunggu validasi di dashboard!');
});


// --- Default Handler jika tidak ada command/media yang ditangani ---
bot.on('message', (ctx) => {
    // Hanya merespons jika user belum dalam alur reporting
    if (!ctx.session.current_structure_id) {
        return ctx.reply('Mohon gunakan /lapor untuk memulai proses laporan.');
    }
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
        res.status(200).send('Project Manager Bot is running. Set webhook to this endpoint.');
    }
}
