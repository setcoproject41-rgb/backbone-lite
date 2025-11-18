export default function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).json({ ok: true, message: "Webhook GET OK" });
  }

  console.log("Telegram update =", req.body);
  return res.status(200).json({ ok: true });
}
