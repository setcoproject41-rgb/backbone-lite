import { supabaseServer } from '../../lib/supabaseServer.js';
import { downloadFileFromTelegram, uploadToSupabase } from '../../lib/uploadTelegramMedia.js';

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(200).send('ok');

    const body = req.body;

    // Telegram update structure: check for message
    const message = body.message || body.edited_message || body.channel_post;
    if (!message) return res.status(200).send('no message');

    const chatId = message.chat?.id;
    const from = message.from;

    // create minimal report row first (you can expand fields)
    // ideally you parse a previously saved "state" for designator/span/jobcode per user.
    const designator = 'DGT-001'; // placeholder, replace with logic to map user->designator
    const span = 1;
    const job_code = 'JT-?';
    const volume = null;

    // create report
    const { data: reportData, error: reportErr } = await supabaseServer
      .from('reports')
      .insert([{
        user_id: null,
        designator,
        job_code,
        span,
        volume,
        latitude: message.location?.latitude || null,
        longitude: message.location?.longitude || null,
        notes: message.caption  message.text  null
      }])
      .select()
      .limit(1);

    if (reportErr) {
      console.error('insert report error', reportErr);
    }

    const reportId = reportData?.[0]?.id ?? null;

    // Handle photo
    if (message.photo) {
      const photo = message.photo[message.photo.length - 1];
      const { buffer, ext } = await downloadFileFromTelegram(photo.file_id);
      const uploaded = await uploadToSupabase({ buffer, ext: 'jpg', designator, span, report_id: reportId });
      return res.status(200).json({ ok: true, url: uploaded.publicUrl });
    }

    // Handle video
    if (message.video) {
      const video = message.video;
      const { buffer, ext } = await downloadFileFromTelegram(video.file_id);
      const uploaded = await uploadToSupabase({ buffer, ext, designator, span, report_id: reportId });
      return res.status(200).json({ ok: true, url: uploaded.publicUrl });
    }

    // Handle document (file)
    if (message.document) {
      const doc = message.document;
      const { buffer, ext } = await downloadFileFromTelegram(doc.file_id);
      const uploaded = await uploadToSupabase({ buffer, ext, designator, span, report_id: reportId });
      return res.status(200).json({ ok: true, url: uploaded.publicUrl });
    }

    // Location-only or text-only – report created already
    return res.status(200).json({ ok: true, report_id: reportId });

  } catch (err) {
    console.error('webhook error', err);
    return res.status(500).json({ error: err.message });
  }
}
