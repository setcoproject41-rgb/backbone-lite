// api/webhook.js
import fetch from 'node-fetch'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN
const BUCKET = process.env.STORAGE_BUCKET || 'survey_photos'

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

// cache user progress (step)
const userSteps = {}

export default async function handler(req, res) {
  try {
    const body = req.body
    const message = body.message || body.edited_message
    if (!message) return res.status(200).send('no message')

    const chatId = message.chat.id
    const from = message.from || {}
    const username = from.username || `${from.first_name || ''} ${from.last_name || ''}`.trim()

    // initialize user step
    if (!userSteps[chatId]) {
      userSteps[chatId] = { step: 'start', photoUrl: null, location: null, reportData: {} }
    }

    const current = userSteps[chatId]

    // === STEP 0: /start command ===
    if (message.text && message.text.startsWith('/start')) {
      await sendMessage(
        chatId,
        `👋 *Selamat datang di Sistem Laporan Lapangan!*\n\n` +
        `Silakan ikuti urutan pengisian berikut:\n` +
        `1️⃣ Kirim *foto pekerjaan*\n` +
        `2️⃣ Kirim *lokasi (share location)*\n` +
        `3️⃣ Kirim format laporan seperti berikut:\n\n` +
        `📋 *FORMAT REPORT:*\n` +
        `Nama pekerjaan : [isi nama pekerjaan]\n` +
        `Volume pekerjaan (M) : [isi angka meter]\n` +
        `Material : [jenis material (/pcs)]\n` +
        `Keterangan : [catatan tambahan]\n\n` +
        `Contoh:\n` +
        `Nama pekerjaan : Tarik kabel\n` +
        `Volume pekerjaan (M) : 120\n` +
        `Material : KU48 | DE 2pcs | \n` +
        `Keterangan : Lancar tidak ada kendala.`
      )
      current.step = 'photo'
      return res.status(200).send('welcome sent')
    }

    // === STEP 1: FOTO ===
    if (message.photo) {
      const photo = message.photo[message.photo.length - 1]
      const fileId = photo.file_id

      const getFile = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`)
      const jf = await getFile.json()

      if (jf.ok) {
        const path = jf.result.file_path
        const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${path}`

        // download file
        const fileRes = await fetch(fileUrl)
        const arrayBuffer = await fileRes.arrayBuffer()
        const buffer = Buffer.from(arrayBuffer)
        const fname = `${Date.now()}-${fileId}.jpg`

        // upload ke Supabase Storage
        const { data, error: upErr } = await supabase.storage
          .from(BUCKET)
          .upload(fname, buffer, { contentType: 'image/jpeg' })

        if (upErr) {
          console.error('❌ Upload error:', upErr)
          await sendMessage(chatId, '⚠️ Gagal upload foto ke server.')
          return res.status(200).send('upload fail')
        }

        const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(fname)
        current.photoUrl = pub.publicUrl
        current.step = 'location'

        await sendMessage(chatId, '✅ Foto diterima. Sekarang kirim lokasi kamu (share location).')
        return res.status(200).send('photo ok')
      }
    }

    // === STEP 2: LOKASI ===
    if (message.location) {
      if (current.step !== 'location') {
        await sendMessage(chatId, '❌ Kirim foto dulu sebelum kirim lokasi.')
        return res.status(200).send('wrong order')
      }

      current.location = {
        lat: message.location.latitude,
        lon: message.location.longitude,
      }
      current.step = 'text'
      await sendMessage(chatId, '📍 Lokasi diterima.\nSekarang kirim *format laporan* sesuai contoh.')
      return res.status(200).send('location ok')
    }

    // === STEP 3: FORMAT REPORT ===
    if (message.text && !message.text.startsWith('/')) {
      if (current.step !== 'text') {
        await sendMessage(chatId, '❌ Kirim foto dan lokasi terlebih dahulu sebelum menulis keterangan.')
        return res.status(200).send('wrong order text')
      }

      // parsing teks laporan
      const text = message.text
      const namaPekerjaan = (text.match(/Nama pekerjaan\s*:\s*(.*)/i) || [])[1] || null
      const volumePekerjaan = (text.match(/Volume pekerjaan.*?:\s*([\d.,]+)/i) || [])[1] || null
      const material = (text.match(/Material\s*:\s*(.*)/i) || [])[1] || null
      const keterangan = (text.match(/Keterangan\s*:\s*(.*)/i) || [])[1] || null

      if (!namaPekerjaan || !volumePekerjaan || !material) {
        await sendMessage(chatId, '⚠️ Format tidak sesuai. Pastikan semua kolom diisi:\nNama pekerjaan, Volume, Material, Keterangan.')
        return res.status(200).send('invalid format')
      }

      // siap kirim ke Supabase
      const payload = {
        telegram_user: username,
        photo_url: current.photoUrl,
        latitude: current.location.lat,
        longitude: current.location.lon,
        nama_pekerjaan: namaPekerjaan,
        volume_pekerjaan: parseFloat(volumePekerjaan.replace(',', '.')),
        material,
        keterangan,
      }

      const { error } = await supabase.from('reports').insert([payload])
      if (error) {
        console.error('insert err', error)
        await sendMessage(chatId, '⚠️ Gagal menyimpan ke database.')
        return res.status(200).send('insert error')
      }

      await sendMessage(chatId, '✅ Data berhasil disimpan ke sistem. Terima kasih!')
      delete userSteps[chatId] // reset session
      return res.status(200).send('saved ok')
    }

    // fallback
    await sendMessage(chatId, '📸 Kirim foto dulu untuk memulai laporan.')
    return res.status(200).send('waiting start')

  } catch (err) {
    console.error('ERR', err)
    return res.status(500).send('error')
  }
}

// Helper
async function sendMessage(chatId, text) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'Markdown',
    }),
  })
        }
