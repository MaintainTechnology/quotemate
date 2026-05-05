import twilio from 'twilio'

// Single shared client. Reads creds from env at module load.
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN,
)

// SMS — used for the customer-facing dialog and the tradie SMS notification.
export async function sendSms(args: {
  to: string   // E.164, e.g. '+61400111222'
  from: string // our number, e.g. '+61481613464'
  body: string // <= 1600 chars; ideally <= 320 (2 SMS segments)
}) {
  const msg = await twilioClient.messages.create({
    to: args.to,
    from: args.from,
    body: args.body,
  })
  return { sid: msg.sid, status: msg.status }
}

// WhatsApp — used for the tradie WhatsApp notification (Twilio Sandbox in dev).
// Both `to` and `from` MUST be in `whatsapp:+...` format; this helper accepts
// either form and normalises.
export async function sendWhatsApp(args: {
  to: string   // 'whatsapp:+639...' or '+639...'
  from: string // 'whatsapp:+14155238886' or '+14155238886'
  body: string
}) {
  const to = args.to.startsWith('whatsapp:') ? args.to : `whatsapp:${args.to}`
  const from = args.from.startsWith('whatsapp:') ? args.from : `whatsapp:${args.from}`
  const msg = await twilioClient.messages.create({ to, from, body: args.body })
  return { sid: msg.sid, status: msg.status }
}
