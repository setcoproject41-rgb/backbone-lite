// pages/api/submit-report.js

import { createClient } from '@supabase/supabase-js';
import formidable from 'formidable';
import fs from 'fs';

// Helper: Supabase Initialization
const supabase = createClient(
    process.env.SUPABASE_URL, 
    process.env.SUPABASE_SERVICE_KEY
);

// Helper: Telegram Notifikasi
const telegramApiUrl = `https://api.telegram.org/bot${process.env.BOT_TOKEN}`;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID; // Pastikan Anda set Environment Variable ini

// =================================================================
// 1. NONAKTIFKAN BODY PARSER BAWAAN NEXT.JS
// =================================================================
export const config = {
  api: {
    bodyParser: false,
  },
};

// =================================================================
// 2. FUNGSI UTAMA API
// =================================================================
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  const form = formidable({});
  
  try {
    const [fields, files] = await form.parse(req);

    const structureId = fields.structure_id?.[0];
    const progressDetail = fields.progress_detail?.[0];
    const volumeReported = parseFloat(fields.volume_reported?.[0]) || 0;
    const reporterId = fields.reporter_id?.[0] || 'WebUser';
    const uploadedFiles = files.files || [];
    
    // 1. Ambil info lokasi untuk nama file
    const { data: structure, error: structError } = await supabase
        .from('project_structure')
        .select('designator_name, span_num')
        .eq('id', structureId)
        .single();

    if (structError || !structure) {
        return res.status(400).json({ message: 'Lokasi (Structure ID) tidak valid.' });
    }

    // 2. Simpan Log Utama
    const { data: reportLog, error: logError } = await supabase
      .from('report_logs')
      .insert({
        structure_id: structureId,
        reporter_id: reporterId,
        progress_detail: progressDetail,
        volume_reported: volumeReported,
      })
      .select('id')
      .single();

    if (logError) throw new Error(logError.message);
    const reportLogId = reportLog.id;

    // 3. Upload Files dan Catat Evidence
    for (let i = 0; i < uploadedFiles.length; i++) {
        const file = uploadedFiles[i];
        const fileExtension = file.originalFilename.split('.').pop() || 'dat';
        const fileTypeTag = i === 0 ? 'BEFORE_WORK' : (i === 1 ? 'PROGRESS_WORK' : 'AFTER_WORK'); // Asumsi 3 foto pertama

        const uniqueId = Math.random().toString(36).substring(2, 7); 
        const fileName = `${structure.designator_name}_${structure.span_num}_${fileTypeTag}_${uniqueId}.${fileExtension}`;
        const storagePath = `eviden_laporan/${structure.designator_name}/${fileTypeTag}/${fileName}`;

        // Baca file dari temporary path dan upload
        const fileBuffer = fs.readFileSync(file.filepath);

        const { error: uploadError } = await supabase.storage
            .from('evidence-bucket') 
            .upload(storagePath, fileBuffer, { 
                contentType: file.mimetype,
                upsert: false
            });

        if (uploadError) throw new Error(`Upload Error: ${uploadError.message}`);

        const publicUrl = supabase.storage.from('evidence-bucket').getPublicUrl(storagePath).data.publicUrl;

        await supabase
            .from('report_evidence')
            .insert({
                report_log_id: reportLogId,
                file_name: fileName,
                storage_path: publicUrl,
                evidence_type: fileTypeTag 
            });

        // Cleanup temporary file
        fs.unlinkSync(file.filepath);
    }

    // 4. Kirim Notifikasi ke Telegram Admin
    if (ADMIN_CHAT_ID && telegramApiUrl) {
        const notificationText = `
        🔔 *LAPORAN BARU MASUK* 🔔
        Lokasi: *${structure.designator_name}-${structure.span_num}*
        Pelapor: ${reporterId}
        Keterangan: ${progressDetail}
        Volume: ${volumeReported}
        Status: Menunggu Validasi.
        `;
        
        await axios.post(`${telegramApiUrl}/sendMessage`, {
            chat_id: ADMIN_CHAT_ID,
            text: notificationText,
            parse_mode: 'Markdown'
        });
    }

    return res.status(200).json({ message: 'Laporan sukses dan notifikasi terkirim.' });

  } catch (error) {
    console.error('Submit Report Fatal Error:', error);
    return res.status(500).json({ message: `Terjadi kesalahan internal: ${error.message}` });
  }
}
