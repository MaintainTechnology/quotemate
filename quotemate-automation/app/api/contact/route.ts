// POST /api/contact: the public "contact us" form on the marketing site.
//
// Public, unauthenticated and it sends mail, so it is treated as a trust
// boundary: honeypot first, then strict validation, then the same per-IP
// throttle the QR lead route uses (bump_lead_throttle), and only then a
// Resend send. Every field the visitor typed is HTML-escaped before it goes
// anywhere near the email body.
//
// Destination inbox: CONTACT_INBOX_EMAIL, falling back to RESEND_FROM_EMAIL
// so the form still delivers on an install that has not set a dedicated
// support inbox yet. The visitor's address goes in reply_to, never in from,
// so Resend keeps signing as the verified sender.

import { createClient } from "@supabase/supabase-js"
import { sendEmail } from "@/lib/email/resend"

export const MESSAGE_MIN = 10
const MESSAGE_MAX = 4000
const NAME_MAX = 100
const EMAIL_MAX = 200
const PHONE_MAX = 40
const TOPIC_MAX = 60

// Deliberately loose. A stricter pattern rejects valid addresses far more
// often than it catches bad ones, and the real proof of an address is
// whether the reply lands.
const EMAIL_RE = /^[^\s@]+@[^\s@.]+\.[^\s@]{2,}$/

// Per-IP, fixed 1h window. Generous for a person who sends a follow-up,
// tight enough that the inbox cannot be flooded from one host.
// ponytail: IP-only. Add a per-email key too if a spammer ever rotates IPs.
const IP_LIMIT = 5
const WINDOW_SECONDS = 3600

export type ContactInput = {
  name: string
  email: string
  phone: string
  topic: string
  message: string
}

export type ParseResult =
  | { ok: true; value: ContactInput }
  | { ok: false; error: string; message: string }

/**
 * Validate and normalise a submitted enquiry. Pure, so the rules can be
 * tested without a network, a database or an email provider.
 */
export function parseContact(body: unknown): ParseResult {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "invalid_body", message: "Something went wrong. Please try again." }
  }
  const raw = body as Record<string, unknown>
  const str = (k: string) => (typeof raw[k] === "string" ? (raw[k] as string).trim() : "")

  const name = str("name")
  const email = str("email")
  const phone = str("phone")
  const topic = str("topic") || "General enquiry"
  const message = str("message")

  if (!name || name.length > NAME_MAX) {
    return { ok: false, error: "invalid_name", message: "Please add your name." }
  }
  if (!email || email.length > EMAIL_MAX || !EMAIL_RE.test(email)) {
    return { ok: false, error: "invalid_email", message: "Please enter an email we can reply to." }
  }
  if (phone.length > PHONE_MAX) {
    return { ok: false, error: "invalid_phone", message: "That mobile number looks too long." }
  }
  if (message.length < MESSAGE_MIN) {
    return {
      ok: false,
      error: "message_too_short",
      message: "Please add a bit more detail so we can point you at the right person.",
    }
  }
  if (message.length > MESSAGE_MAX) {
    return {
      ok: false,
      error: "message_too_long",
      message: `Please keep it under ${MESSAGE_MAX} characters.`,
    }
  }

  return {
    ok: true,
    value: { name, email, phone, topic: topic.slice(0, TOPIC_MAX), message },
  }
}

/** Escape the five characters that can break out of HTML text or an attribute. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

export function renderEnquiryHtml(input: ContactInput): string {
  const row = (label: string, value: string) =>
    `<tr><td style="padding:6px 16px 6px 0;color:#6E645C;font:600 12px/1.4 monospace;text-transform:uppercase;letter-spacing:.08em;vertical-align:top">${escapeHtml(
      label,
    )}</td><td style="padding:6px 0;color:#241E1B;font:400 15px/1.5 system-ui,sans-serif">${escapeHtml(
      value,
    )}</td></tr>`

  return [
    `<div style="font:400 15px/1.5 system-ui,sans-serif;color:#241E1B">`,
    `<h2 style="margin:0 0 16px;font:800 18px/1.2 system-ui,sans-serif">New enquiry from the QuoteMax website</h2>`,
    `<table style="border-collapse:collapse">`,
    row("Name", input.name),
    row("Email", input.email),
    input.phone ? row("Mobile", input.phone) : "",
    row("Topic", input.topic),
    `</table>`,
    `<p style="margin:20px 0 6px;color:#6E645C;font:600 12px/1.4 monospace;text-transform:uppercase;letter-spacing:.08em">Message</p>`,
    `<div style="white-space:pre-wrap;padding:14px 16px;border:1px solid #CFC2B0;border-radius:8px">${escapeHtml(
      input.message,
    )}</div>`,
    `</div>`,
  ].join("")
}

export function renderEnquiryText(input: ContactInput): string {
  return [
    "New enquiry from the QuoteMax website",
    "",
    `Name:   ${input.name}`,
    `Email:  ${input.email}`,
    input.phone ? `Mobile: ${input.phone}` : "",
    `Topic:  ${input.topic}`,
    "",
    "Message:",
    input.message,
  ]
    .filter(Boolean)
    .join("\n")
}

const GENERIC_FAILURE = "That did not send. Please try again in a moment."

export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json(
      { ok: false, error: "invalid_json", message: GENERIC_FAILURE },
      { status: 400 },
    )
  }

  // Honeypot. Accept and drop, so a bot gets no signal that it was caught.
  const honeypot = (body as Record<string, unknown> | null)?.company
  if (typeof honeypot === "string" && honeypot.trim()) {
    return Response.json({ ok: true })
  }

  const parsed = parseContact(body)
  if (!parsed.ok) {
    return Response.json(
      { ok: false, error: parsed.error, message: parsed.message },
      { status: 400 },
    )
  }
  const input = parsed.value

  const inbox = process.env.CONTACT_INBOX_EMAIL || process.env.RESEND_FROM_EMAIL
  if (!inbox) {
    console.error("[contact] no destination inbox (CONTACT_INBOX_EMAIL / RESEND_FROM_EMAIL)")
    return Response.json(
      { ok: false, error: "not_configured", message: GENERIC_FAILURE },
      { status: 500 },
    )
  }

  // Throttle before spending anything. A failure to reach the counter must
  // not take the form down, so an errored bump is treated as "under limit".
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown"
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
    const { data } = await supabase.rpc("bump_lead_throttle", {
      p_key: `contact:ip:${ip}`,
      p_window_seconds: WINDOW_SECONDS,
    })
    if ((data ?? 0) > IP_LIMIT) {
      return Response.json(
        {
          ok: false,
          error: "rate_limited",
          message: "That is a few messages in a short time. Please try again later.",
        },
        { status: 429 },
      )
    }
  } catch (err) {
    console.error("[contact] throttle check failed, allowing through", err)
  }

  const sent = await sendEmail({
    to: inbox,
    replyTo: input.email,
    subject: `Website enquiry: ${input.topic} (${input.name})`,
    html: renderEnquiryHtml(input),
    text: renderEnquiryText(input),
  })

  if (!sent.ok) {
    console.error("[contact] send failed", sent.code, sent.reason)
    return Response.json(
      { ok: false, error: "send_failed", message: GENERIC_FAILURE },
      { status: 502 },
    )
  }

  return Response.json({ ok: true })
}
