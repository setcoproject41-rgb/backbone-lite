import axios from 'axios';
import crypto from 'crypto';
import { supabaseServer } from './supabaseServer.js';

export async function downloadFileFromTelegram(fileId) {
  const BOT = process.env.BOT_TOKEN;
  const resFile = await axios.get(https://api.telegram.org/bot${BOT}/getFile?file_id=${fileId});
  if (!resFile.data.ok) throw new Error('getFile failed');
  const filePath = resFile.data.result.file_path;
  const fileUrl = https://api.telegram.org/file/bot${BOT}/${filePath};
  const resp = await axios.get(fileUrl, { responseType: 'arraybuffer' });
  const ext = filePath.split('.').pop().toLowerCase();
  return { buffer: Buffer.from(resp.data), ext, filePath };
}

export async function uploadToSupabase({ buffer, ext, designator='UNKNOWN', span='0', report_id=null }) {
  const rand = crypto.randomBytes(4).toString('hex');
  const ts = Date.now();
  const fileName = ${ts}_${rand}.${ext};
  const path = eviden_laporan/${designator}/${span}/${fileName};

  const contentType = ext === 'mp4' ? 'video/mp4' : (['jpg','jpeg'].includes(ext) ? 'image/jpeg' : (ext==='png'?'image/png':'application/octet-stream'));

  const { error: uploadErr } = await supabaseServer
    .storage
    .from('eviden_laporan')
    .upload(path, buffer, { contentType, upsert: false });

  if (uploadErr) throw uploadErr;

  const { data: urlData } = await supabaseServer
    .storage
    .from('eviden_laporan')
    .getPublicUrl(path);

  // insert metadata ke tabel report_media jika report_id disediakan
  if (report_id) {
    const { error: insertErr } = await supabaseServer
      .from('report_media')
      .insert([{
        report_id,
        media_type: ['mp4','mov','avi'].includes(ext) ? 'video' : 'photo',
        file_path: path,
        file_url: urlData.publicUrl,
        file_ext: ext
      }]);
    if (insertErr) console.error('insert report_media error', insertErr);
  }

  return { path, publicUrl: urlData.publicUrl };
}
