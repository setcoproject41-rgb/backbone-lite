// pages/api/telegram-handler.js

import { createClient } from '@supabase/supabase-js';
import { Telegraf } from 'telegraf';
import axios from 'axios';

// =================================================================
// 1. INISIALISASI KLIENT DAN BOT
// =================================================================

// Klien Supabase
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
 */
const stateMiddleware = async (ctx, next) => {
    const userId = ctx.from.id.toString();
    
    // 1. Ambil State Saat Ini dari DB
    const { data: sessionData } = await supabase
        .from('bot_sessions')
        .select('*')
        .eq('user_id', userId)
        .single();
    
    // Inisialisasi ctx.session
    ctx.session = sessionData || {};
    
    // Lanjutkan ke handler Bot
    await next();
    
    // 2. Simpan State Kembali ke DB setelah handler selesai (jika ada perubahan)
    if (ctx.session) {
        const payload = {
            user_id: userId,
            current_structure_id: ctx.session.current_structure_id || null,
            current_report_log_id: ctx.session.current_report_log_id || null,
            updated_at: new Date().toISOString()
        };

        // Upsert (Insert atau Update) data sesi
        await supabase
            .from('bot_sessions')
            .upsert(payload, { onConflict: 'user_id' });
    }
};

bot.use(stateMiddleware); // Terapkan middleware kustom

// =================================================================
// 3. LOGIKA UTAMA BOT
// =================================================================

// --- /start Command ---
bot.start((ctx) => ctx.reply('Selamat datang di Project Manager Bot! Silakan gunakan /lapor untuk memulai.'));


// --- /lapor Command: Meminta User Memilih Lokasi ---
bot.command('lapor', async (ctx) => {
    // Kosongkan state log ID lama jika ada laporan baru dimulai
    ctx.session.current_report_log_id = null; 

    // 1. Ambil data Designator/Span dari Supabase
    const { data: structures, error } = await supabase
        .from('project_structure')
        .select('id, designator_name, span_num')
        .order('designator_name', { ascending: true })
        .limit(50); 

    if (error || !structures.length) {
        console.error('DB Error:', error);
        return ctx.reply('⚠️ Error: Data struktur proyek tidak ditemukan.');
    }

    // 2. Buat tombol inline keyboard
    const keyboard = structures.map(s => ([
        { 
            text: `${s.designator_name} | ${s.span_num}`,
            callback_data: `select_span_${s.id}` 
        }
    ]));

    ctx.reply('Pilih Lokasi (Designator/Span) untuk laporan ini:', {
        reply_markup: { inline_keyboard: keyboard }
    });
});


// --- Menangani Pilihan Span dari Inline Keyboard ---
bot.on('callback_query', async (ctx) => {
    const data = ctx.callbackQuery.data;
    
    if (data.startsWith('select_span_')) {
        const structureId = data.split('_')[2];
        
        // Simpan structure_id ke dalam sesi kustom
        ctx.session.current_structure_id = structureId; 

        await ctx.answerCbQuery();
        await ctx.editMessageText('✅ Lokasi dipilih. Sekarang, mohon kirimkan **Foto Evidence** dan **Keterangan Progress** (Job Desc & Volume Selesai) secara terpisah.\n\nContoh Keterangan: *Pemasangan Tiang 1 buah*.');
    }
});


// --- Menangani Foto Evidence ---
bot.on('photo', async (ctx) => {
    const structureId = ctx.session.current_structure_id; 

    if (!structureId) {
        return ctx.reply('⚠️ Mohon pilih lokasi terlebih dahulu dengan /lapor.');
    }
    
    // --- Ambil File Info dari Telegram ---
    const photoArray = ctx.message.photo;
    const largestPhoto = photoArray[photoArray.length - 1]; 
    const fileId = largestPhoto.file_id;

    // ... Logika Upload Foto (sama seperti sebelumnya) ...
    
    // --- Dapatkan Structure Name dan Metadata ---
    const { data: structure } = await supabase
        .from('project_structure')
        .select('designator_name, span_num')
        .eq('id', structureId)
        .single();
    
    // Lanjutkan dengan proses unduh, upload, dan insert log...

    try {
        // [Kode Unduh File dari Telegram, Proses Buffer, dan Upload ke Supabase Storage]
        // ... (Kode yang sama dari penjelasan sebelumnya) ...
        const fileInfoResponse = await axios.get(`${telegramApiUrl}/getFile?file_id=${fileId}`);
        const filePath = fileInfoResponse.data.result.file_path;
        const fileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${filePath}`;
        const fileExtension = filePath.split('.').pop();
        
        const gpsCoord = '000.0'; 
        const jobCode = 'PGRS'; 
        const uniqueId = Math.random().toString(36).substring(2, 7); 

        const fileName = `${gpsCoord}|${structure.designator_name}|${jobCode}_${uniqueId}.${fileExtension}`;
        const storagePath = `eviden_laporan/${structure.designator_name}/${structure.span_num}/${fileName}`;

        const imageResponse = await axios.get(fileUrl, { responseType: 'arraybuffer' });
        const imageBuffer = Buffer.from(imageResponse.data);

        const { error: uploadError } = await supabase.storage
            .from('evidence-bucket') 
            .upload(storagePath, imageBuffer, {
                contentType: `image/${fileExtension}`,
                upsert: false
            });

        if (uploadError) throw new Error(uploadError.message);

        // --- Catat Log Utama (report_logs) ---
        const { data: reportLog, error: logError } = await supabase
            .from('report_logs')
            .insert({
                structure_id: structureId,
                reporter_id: ctx.from.id.toString(),
                progress_detail: 'Foto terkirim. Menunggu deskripsi...'
            })
            .select('id')
            .single();

        if (logError) throw new Error(logError.message);

        // Catat Bukti Foto (report_evidence)
        const publicUrl = supabase.storage.from('evidence-bucket').getPublicUrl(storagePath).data.publicUrl;

        await supabase
            .from('report_evidence')
            .insert({
                report_log_id: reportLog.id,
                file_name: fileName,
                storage_path: publicUrl
            });

        // Simpan log ID untuk update deskripsi berikutnya (disimpan di state kustom)
        ctx.session.current_report_log_id = reportLog.id;
        
        ctx.reply(`✅ Foto Evidence berhasil diunggah! Sekarang, mohon kirimkan **deskripsi pekerjaan dan volume** (misal: "Pemasangan Tiang 1.0").`);
    } catch (e) {
        console.error('Upload/DB Error:', e);
        ctx.reply('❌ Terjadi kesalahan saat memproses foto. Pastikan Bucket "evidence-bucket" sudah dibuat.');
    }
});


// --- Menangani Teks Progress setelah Foto ---
bot.on('text', async (ctx) => {
    const logId = ctx.session.current_report_log_id;

    // Cek apakah ada log yang sedang menunggu update deskripsi
    if (!logId) {
        return ctx.reply('Terima kasih. Jika Anda ingin melapor, gunakan /lapor.');
    }
    
    const text = ctx.message.text;

    // Parsing Volume (Mencari angka floating/integer di akhir teks)
    const volumeMatch = text.match(/[\d\.]+/g);
    const volume = volumeMatch ? parseFloat(volumeMatch.pop()) : 0;
    
    // Update log dengan detail progress dan volume
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

    // Hapus kedua state sesi setelah selesai
    ctx.session.current_report_log_id = null;
    ctx.session.current_structure_id = null;

    ctx.reply('🎉 Detail progress berhasil dicatat! Data menunggu validasi di dashboard.');
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
            res.status(500).send('Internal Server Error');
        }
    } else {
        // Respons untuk GET request
        res.status(200).send('Project Manager Bot is running. Set webhook to this endpoint.');
    }
}
