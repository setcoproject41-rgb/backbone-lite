import { supabaseServer } from '../../lib/supabaseServer.js';
import { downloadFileFromTelegram, uploadToSupabase } from '../../lib/uploadTelegramMedia.js';

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(200).send('ok');

    const body = req.body;
    const message = body.message || body.edited_message || body.channel_post;

    if (!message) return res.status(200).send('no message');

    const designator = 'DGT-001'; 
    const span = 1;
    const job_code = 'JT-XX';

    const { data: reportData, error: reportErr } = await supabaseServer
      .from('reports')
      .insert([
        {
          designator,
          job_code,
          span,
          latitude: message.location?.latitude ?? null,
          longitude: message.location?.longitude ?? null,
          notes: message.caption || message.text || null
        }
      ])
      .select()
      .limit(1);

    if (reportErr) {
      console.error('insert report error', reportErr);
      return res.status(200).send('report insert failed');
    }

    const reportId = reportData?.[0]?.id ?? null;

    // PHOTO
    if (message.photo) {
      const photo = message.photo.at(-1);
      const { buffer, ext } = await downloadFileFromTelegram(photo.file_id);
      const uploaded = await uploadToSupabase({ buffer, ext, designator, span, report_id: reportId });
      return res.status(200).json({ ok: true, url: uploaded.publicUrl });
    }

    // VIDEO
    if (message.video) {
      const video = message.video;
      const { buffer, ext } = await downloadFileFromTelegram(video.file_id);
      const uploaded = await uploadToSupabase({ buffer, ext, designator, span, report_id: reportId });
      return res.status(200).json({ ok: true, url: uploaded.publicUrl });
    }

    // DOCUMENT
    if (message.document) {
      const doc = message.document;
      const { buffer, ext } = await downloadFileFromTelegram(doc.file_id);
      const uploaded = await uploadToSupabase({ buffer, ext, designator, span, report_id: reportId });
      return res.status(200).json({ ok: true, url: uploaded.publicUrl });
    }

    return res.status(200).json({ ok: true, report_id: reportId });
  } catch (err) {
    console.error('webhook error', err);
    return res.status(500).json({ error: err.message });
  }
}
