// api/webhook.js
import fetch from 'node-fetch'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN
const BUCKET = process.env.STORAGE_BUCKET || 'survey_photos'

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

// Simpan progress user sementara
const userSteps = {}

export default async function handler(req, res) {
  try {
    const body = req.body
    const message = body.message || body.edited_message
    if (!message) return res.status(200).send('no message')

    const chatId = message.chat.id
    const from = message.from || {}
    const username = from.username || `${from.first_name || ''} ${from.last_name || ''}`.trim()

    // Inisialisasi step
    if (!userSteps[chatId]) {
      userSteps[chatId] = { 
        step: 'start',
        photoBeforeUrl: null,
        photoAfterUrl: null,
        location: null,
        reportData: {}
      }
    }
    const current = userSteps[chatId]

    // === /START ===
    if (message.text && message.text.startsWith('/start')) {
      await sendMessage(chatId,
        `👋 *Selamat datang di Sistem Laporan Lapangan!*\n\n` +
        `Ikuti langkah-langkah berikut:\n` +
        `1️⃣ Kirim *foto eviden sebelum pekerjaan* 📸\n` +
        `2️⃣ Kirim *foto eviden sesudah pekerjaan* 📸\n` +
        `3️⃣ Kirim *lokasi (share location)* 📍\n` +
        `4️⃣ Kirim laporan dengan format berikut:\n\n` +
        `📋 *FORMAT REPORT:*\n` +
        `Nama pekerjaan : [isi nama pekerjaan]\n` +
        `Volume pekerjaan (M) : [isi angka]\n` +
        `Material : [isi material]\n` +
        `Keterangan : [catatan tambahan]\n\n` +
        `Contoh:\n` +
        `Nama pekerjaan : Tarik kabel\n` +
        `Volume pekerjaan (M) : 120\n` +
        `Material : KU48 | DE 2pcs\n` +
        `Keterangan : Lancar tidak ada kendala.`
      )
      current.step = 'photo_before'
      return res.status(200).send('welcome sent')
    }

    // === STEP 1: FOTO SEBELUM ===
    if (message.photo && current.step === 'photo_before') {
      const photoUrl = await uploadTelegramPhoto(message.photo)
      if (!photoUrl) {
        await sendMessage(chatId, '⚠️ Gagal upload foto eviden sebelum.')
        return res.status(200).send('upload before fail')
      }
      current.photoBeforeUrl = photoUrl
      current.step = 'photo_after'
      await sendMessage(chatId, '✅ Foto eviden *sebelum* diterima.\nSekarang kirim *foto eviden sesudah* pekerjaan.')
      return res.status(200).send('photo before ok')
    }

    // === STEP 2: FOTO SESUDAH ===
    if (message.photo && current.step === 'photo_after') {
      const photoUrl = await uploadTelegramPhoto(message.photo)
      if (!photoUrl) {
        await sendMessage(chatId, '⚠️ Gagal upload foto eviden sesudah.')
        return res.status(200).send('upload after fail')
      }
      current.photoAfterUrl = photoUrl
      current.step = 'location'
      await sendMessage(chatId, '✅ Foto eviden *sesudah* diterima.\nSekarang kirim *lokasi pekerjaan (share location)* 📍')
      return res.status(200).send('photo after ok')
    }

    // === STEP 3: LOKASI ===
    if (message.location && current.step === 'location') {
      current.location = {
        lat: message.location.latitude,
        lon: message.location.longitude,
      }
      current.step = 'text'
      await sendMessage(chatId, '📍 Lokasi diterima.\nSekarang kirim *format laporan* sesuai contoh.')
      return res.status(200).send('location ok')
    }

    // === STEP 4: FORMAT REPORT ===
    if (message.text && !message.text.startsWith('/')) {
      if (current.step !== 'text') {
        await sendMessage(chatId, '⚠️ Kirim foto dan lokasi terlebih dahulu sebelum menulis laporan.')
        return res.status(200).send('wrong order')
      }

      // Parsing teks
      const text = message.text
      const nama_pekerjaan = (text.match(/Nama pekerjaan\s*:\s*(.*)/i) || [])[1]?.trim() || null
      const volume_pekerjaan = (text.match(/Volume pekerjaan.*?:\s*([\d.,]+)/i) || [])[1]?.trim() || null
      const material = (text.match(/Material\s*:\s*(.*)/i) || [])[1]?.trim() || null
      const keterangan = (text.match(/Keterangan\s*:\s*(.*)/i) || [])[1]?.trim() || null

      if (!nama_pekerjaan || !volume_pekerjaan || !material) {
        await sendMessage(chatId, '⚠️ Format tidak sesuai.\nPastikan isi semua kolom:\nNama pekerjaan, Volume, Material, dan Keterangan.')
        return res.status(200).send('invalid format')
      }

      // Kirim ke Supabase
      const payload = {
        telegram_user: username,
        photo_before_url: current.photoBeforeUrl,
        photo_after_url: current.photoAfterUrl,
        latitude: current.location?.lat,
        longitude: current.location?.lon,
        nama_pekerjaan,
        volume_pekerjaan: parseFloat(volume_pekerjaan.replace(',', '.')),
        material,
        keterangan,
      }

      const { error } = await supabase.from('reports').insert([payload])
      if (error) {
        console.error('❌ Insert error:', error)
        await sendMessage(chatId, '⚠️ Gagal menyimpan ke database.')
        return res.status(200).send('insert fail')
      }

      await sendMessage(chatId, '✅ Laporan berhasil disimpan!\nTerima kasih atas input datanya 🙏')
      delete userSteps[chatId]
      return res.status(200).send('saved ok')
    }

    // fallback
    await sendMessage(chatId, '📸 Kirim foto eviden *sebelum pekerjaan* untuk memulai.')
    return res.status(200).send('waiting start')

  } catch (err) {
    console.error('❌ ERROR:', err)
    return res.status(500).send('error')
  }
}

// === HELPER: Kirim pesan ke Telegram ===
async function sendMessage(chatId, text) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
  })
}

// === HELPER: Upload foto Telegram ke Supabase Storage ===
async function uploadTelegramPhoto(photoArray) {
  try {
    const photo = photoArray[photoArray.length - 1]
    const getFile = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getFile?file_id=${photo.file_id}`)
    const jf = await getFile.json()
    if (!jf.ok) return null

    const path = jf.result.file_path
    const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${path}`
    const fileRes = await fetch(fileUrl)
    const buffer = Buffer.from(await fileRes.arrayBuffer())
    const fname = `${Date.now()}-${photo.file_id}.jpg`

    const { error: upErr } = await supabase.storage.from(BUCKET).upload(fname, buffer, { contentType: 'image/jpeg' })
    if (upErr) {
      console.error('Upload error:', upErr)
      return null
    }
    const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(fname)
    return pub.publicUrl
  } catch (err) {
    console.error('Upload fail:', err)
    return null
  }
}
