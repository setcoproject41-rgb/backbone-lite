// api/webhook.js
import fetch from 'node-fetch'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN
const BUCKET = process.env.STORAGE_BUCKET || 'survey_photos'

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

// simpan progress sementara (hanya aktif selama server hidup)
const userSteps = {}

export default async function handler(req, res) {
  try {
    const body = req.body
    const message = body.message || body.edited_message
    if (!message) return res.status(200).send('no message')

    const chatId = message.chat.id
    const from = message.from || {}
    const username = from.username || `${from.first_name || ''} ${from.last_name || ''}`.trim()

    // pastikan user ada di cache
    if (!userSteps[chatId]) {
      userSteps[chatId] = { step: 'photo', photoUrl: null, location: null, progress: null }
    }

    const current = userSteps[chatId]

    // === STEP 1: FOTO ===
if (message.photo) {
  const photo = message.photo[message.photo.length - 1]
  const fileId = photo.file_id

  // ambil file path dari Telegram
  const getFile = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`)
  const jf = await getFile.json()
  if (!jf.ok) throw new Error('Gagal ambil file path Telegram')

  const path = jf.result.file_path
  const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${path}`

  // download buffer file dari Telegram
  const fileRes = await fetch(fileUrl)
  const arrayBuffer = await fileRes.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)
  const fileName = `${Date.now()}_${fileId}.jpg`

  // upload ke Supabase
  const { data: uploadData, error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(fileName, buffer, { contentType: 'image/jpeg', upsert: false })

  if (uploadError) {
    console.error('❌ Upload error:', uploadError)
    await sendMessage(chatId, '⚠️ Gagal upload foto ke server.')
    return res.status(200).send('upload error')
  }

  // ambil public URL
  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(fileName)
  const publicUrl = pub?.publicUrl

  if (!publicUrl) {
    console.error('❌ Public URL not found for file:', fileName)
    await sendMessage(chatId, '⚠️ Gagal buat link foto.')
    return res.status(200).send('no url')
  }

  current.photoUrl = publicUrl
  current.step = 'location'

  await sendMessage(chatId, '✅ Foto diterima. Sekarang kirim lokasi kamu (share location).')
  return res.status(200).send('photo ok')
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
      await sendMessage(chatId, '📍 Lokasi diterima. Sekarang kirim keterangan (teks).')
      return res.status(200).send('location ok')
    }

    // === STEP 3: KETERANGAN ===
    if (message.text && !message.text.startsWith('/')) {
      if (current.step !== 'text') {
        await sendMessage(chatId, '❌ Kirim foto dan lokasi terlebih dahulu sebelum menulis keterangan.')
        return res.status(200).send('wrong order text')
      }

      current.progress = message.text

      // pastikan semua lengkap
      if (current.photoUrl && current.location && current.progress) {
        const payload = {
          telegram_user: username,
          photo_url: current.photoUrl,
          latitude: current.location.lat,
          longitude: current.location.lon,
          progress: current.progress,
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
    }

    // Kalau belum ada format yang dikenali
    await sendMessage(chatId, '📸 Kirim foto dulu untuk memulai laporan.')
    return res.status(200).send('waiting start')

  } catch (err) {
    console.error('ERR', err)
    return res.status(500).send('error')
  }
}

// Helper untuk kirim pesan balasan ke Telegram
async function sendMessage(chatId, text) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  })
}
