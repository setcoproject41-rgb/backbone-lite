// pages/api/telegram-handler.js

import { createClient } from '@supabase/supabase-js';
import { Telegraf } from 'telegraf';
import { supabaseSession } from '@telegraf/session-supabase';
import axios from 'axios';

// =================================================================
// 1. INISIALISASI KLIENT DAN BOT
// =================================================================

// Pastikan menggunakan Service Role Key untuk izin penuh (terutama Storage)
const supabase = createClient(
    process.env.SUPABASE_URL, 
    process.env.SUPABASE_SERVICE_KEY
);
const bot = new Telegraf(process.env.BOT_TOKEN);
const telegramApiUrl = `https://api.telegram.org/bot${process.env.BOT_TOKEN}`;

// Middleware untuk Session Management
// Membutuhkan tabel 'sessions' di Supabase (Anda perlu membuatnya manual)
bot.use(supabaseSession({ supabase }));


// =================================================================
// 2. LOGIKA UTAMA BOT
// =================================================================

// --- /start Command ---
bot.start((ctx) => ctx.reply('Selamat datang di Project Manager Bot! Silakan gunakan /lapor untuk memulai.'));


// --- /lapor Command: Meminta User Memilih Lokasi ---
bot.command('lapor', async (ctx) => {
    // 1. Ambil data Designator/Span dari Supabase
    const { data: structures, error } = await supabase
        .from('project_structure')
        .select('id, designator_name, span_num')
        .order('designator_name', { ascending: true })
        .limit(50); // Batasi hasil untuk menghindari keyboard yang terlalu panjang

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
        
        // Simpan structure_id ke dalam sesi pengguna
        ctx.session.current_structure_id = structureId; 

        await ctx.answerCbQuery();
        await ctx.editMessageText('✅ Lokasi dipilih. Sekarang, mohon kirimkan **Foto Evidence** dan **Keterangan Progress** (Job Desc & Volume Selesai) secara terpisah.\n\nContoh Keterangan: *Pemasangan Tiang 1 buah*.');
    }
});


// --- Menangani Foto Evidence ---
bot.on('photo', async (ctx) => {
    // 1. Cek Sesi: Pastikan user sudah memilih lokasi
    if (!ctx.session || !ctx.session.current_structure_id) {
        return ctx.reply('Mohon pilih lokasi terlebih dahulu dengan /lapor.');
    }
    const structureId = ctx.session.current_structure_id; 

    // --- Ambil File Info dari Telegram ---
    const photoArray = ctx.message.photo;
    const largestPhoto = photoArray[photoArray.length - 1]; 
    const fileId = largestPhoto.file_id;

    const fileInfoResponse = await axios.get(`${telegramApiUrl}/getFile?file_id=${fileId}`);
    const filePath = fileInfoResponse.data.result.file_path;
    const fileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${filePath}`;
    const fileExtension = filePath.split('.').pop();
    
    // --- Dapatkan Structure Name dan Metadata ---
    const { data: structure, error: structureError } = await supabase
        .from('project_structure')
        .select('designator_name, span_num')
        .eq('id', structureId)
        .single();
    
    if (structureError) return ctx.reply('Gagal mengambil data lokasi.');

    // Metadata untuk Nama File Unik:
    const gpsCoord = '000.0'; // TODO: Ambil koordinat jika tersedia atau dari structure
    const jobCode = 'PGRS'; // Kode Progress
    const uniqueId = Math.random().toString(36).substring(2, 7); 

    const fileName = `${gpsCoord}|${structure.designator_name}|${jobCode}_${uniqueId}.${fileExtension}`;
    const storagePath = `eviden_laporan/${structure.designator_name}/${structure.span_num}/${fileName}`;
    
    // --- Unduh dan Upload ---
    try {
        const imageResponse = await axios.get(fileUrl, { responseType: 'arraybuffer' });
        const imageBuffer = Buffer.from(imageResponse.data);

        // Upload ke Supabase Storage (Pastikan Bucket 'evidence-bucket' sudah dibuat)
        const { error: uploadError } = await supabase.storage
            .from('evidence-bucket') 
            .upload(storagePath, imageBuffer, {
                contentType: `image/${fileExtension}`,
                upsert: false
            });

        if (uploadError) throw new Error(uploadError.message);
        
        // Dapatkan URL Publik
        const publicUrl = supabase.storage.from('evidence-bucket').getPublicUrl(storagePath).data.publicUrl;

        // --- Catat Log (sementara, butuh input Job Desc & Volume) ---
        // Karena foto dikirim terpisah dari deskripsi, kita akan mencatat log
        // dan menunggu teks. Untuk saat ini, kita hanya catat fotonya dulu.
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

        // Catat Bukti Foto
        await supabase
            .from('report_evidence')
            .insert({
                report_log_id: reportLog.id,
                file_name: fileName,
                storage_path: publicUrl
            });

        // Simpan log ID untuk update deskripsi berikutnya
        ctx.session.current_report_log_id = reportLog.id;
        
        ctx.reply(`✅ Foto Evidence berhasil diunggah! Sekarang, mohon kirimkan **deskripsi pekerjaan dan volume** (misal: "Pemasangan Tiang 1.0").`);
    } catch (e) {
        console.error('Upload/DB Error:', e);
        ctx.reply('❌ Terjadi kesalahan saat memproses foto.');
    }
});


// --- Menangani Teks Progress setelah Foto ---
bot.on('text', async (ctx) => {
    // Cek apakah ada log yang sedang menunggu update deskripsi
    if (!ctx.session || !ctx.session.current_report_log_id) {
        return ctx.reply('Terima kasih. Jika Anda ingin melapor, gunakan /lapor.');
    }
    
    const logId = ctx.session.current_report_log_id;
    const text = ctx.message.text;

    // TODO: Implementasi Parsing yang Lebih Robust untuk Volume (misal: "Pemasangan Tiang 1.0")
    // Untuk Sederhana: Asumsikan volume ada di akhir teks.
    const volumeMatch = text.match(/[\d\.]+/g); // Cari angka
    const volume = volumeMatch ? parseFloat(volumeMatch.pop()) : 0;
    
    // Update log dengan detail progress dan volume
    const { error: updateError } = await supabase
        .from('report_logs')
        .update({
            progress_detail: text,
            volume_reported: volume || 0 // Tambahkan kolom ini ke tabel report_logs jika belum ada!
        })
        .eq('id', logId);

    if (updateError) {
        console.error('Update Log Error:', updateError);
        return ctx.reply('Gagal mencatat detail laporan. Mohon coba lagi.');
    }

    // Hapus sesi setelah selesai
    ctx.session = null;

    ctx.reply('🎉 Detail progress berhasil dicatat! Data menunggu validasi di dashboard.');
});


// =================================================================
// 3. EXPORT HANDLER UNTUK VERCEL API ROUTE
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
        // Ini diperlukan untuk verifikasi webhook
        res.status(200).send('Project Manager Bot is running. Set webhook to this endpoint.');
    }
}
