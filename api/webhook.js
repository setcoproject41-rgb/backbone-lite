// api/webhook.js
import fetch from 'node-fetch'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY // service role (server)
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN
const BUCKET = process.env.STORAGE_BUCKET || 'survey_photos'

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

export default async function handler(req, res) {
  try {
    const body = req.body
    const message = body.message || body.edited_message
    if (!message) return res.status(200).send('no message')

    const from = message.from || {}
    let progress = ''
    let latitude = null
    let longitude = null
    let photoUrl = null

    // If text present and uses semicolon format or plain text
    if (message.text) {
      progress = message.text
    }

    // If shared location
    if (message.location) {
      latitude = message.location.latitude
      longitude = message.location.longitude
    }

    // If photo present - get largest size
    if (message.photo && message.photo.length > 0) {
      const photo = message.photo[message.photo.length - 1]
      const fileId = photo.file_id
      // get file path
      const getFile = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`)
      const jf = await getFile.json()
      if (jf.ok) {
        const path = jf.result.file_path
        const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${path}`
        // download file as buffer
        const fileRes = await fetch(fileUrl)
        const arrayBuffer = await fileRes.arrayBuffer()
        const buffer = Buffer.from(arrayBuffer)
        const fname = `${Date.now()}-${fileId}.jpg`
        // upload to supabase storage
        const { data, error: upErr } = await supabase.storage.from(BUCKET).upload(fname, buffer, { contentType: 'image/jpeg' })
        if (upErr) {
          console.error('upload err', upErr)
        } else {
          const { publicURL } = supabase.storage.from(BUCKET).getPublicUrl(data.path)
          photoUrl = publicURL
        }
      }
    }

    // insert into supabase table
    const payload = {
      progress,
      latitude,
      longitude,
      photo_url: photoUrl,
      telegram_user: from.username || `${from.first_name || ''} ${from.last_name || ''}`
    }
    const { error } = await supabase.from('reports').insert([payload])
    if (error) console.error('insert err', error)

    // reply to user
    const chatId = message.chat.id
    const replyText = 'Laporan diterima. Terima kasih!'
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ chat_id: chatId, text: replyText })
    })

    return res.status(200).send('ok')
  } catch (err) {
    console.error(err)
    return res.status(500).send('error')
  }
}

