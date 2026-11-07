// TAG intake through Resend (TKO-24, DEC-031). Resend receives the mail at the
// intake address and calls the service with a signed webhook that carries
// only the email's id and metadata. The service checks the signature, then
// fetches the email's text and its PDF attachments through Resend's API, and
// the intake takes it from there (intake.ts).
//
// Resend's REST API is called directly, as lib/email/resend.ts calls it, and
// the signature is checked with node:crypto, so neither needs a dependency.

import { createHmac, timingSafeEqual } from 'node:crypto'
import type { IntakeMessage, IntakeOutcome } from './intake'

const API = 'https://api.resend.com'
/** Svix, which signs Resend's webhooks, allows five minutes either way. */
const TOLERANCE_S = 5 * 60
/** A Svix secret is 24 random bytes. One far shorter is a slip, and an empty
 *  one would let anyone sign. */
const MIN_KEY_BYTES = 16
/** The most one message's PDFs may come to, as the email route's body limit
 *  holds them: the files are held in memory until they are uploaded. */
export const MAX_MESSAGE_BYTES = 40 * 1_048_576
/** How long a delivery's fetches from Resend, the email and its files, may
 *  take in all, besides each request's own limit (DEC-046). 40 MB in three
 *  minutes asks for under 0.25 MB a second, so a delivery past it is Resend's
 *  trouble, answered as its 5xx are, and the webhook comes again. */
export const DELIVERY_MS = 180_000

/** Whether a webhook carries Resend's signature over its raw body: an
 *  HMAC-SHA256 of `id.timestamp.body`, keyed with the base64 after `whsec_`,
 *  sent as one or more `v1,<signature>` in `svix-signature`, and stamped
 *  within five minutes of now, so an old call can't be replayed. The bytes
 *  are checked as sent, not as the text they decode to. */
export function verifyResendWebhook(
  rawBody: string | Uint8Array,
  headers: { id?: string; timestamp?: string; signature?: string },
  secret: string,
  now = Date.now(),
): boolean {
  const { id, timestamp, signature } = headers
  const encoded = secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : ''
  if (!id || !timestamp || !signature || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(encoded)) return false
  const key = Buffer.from(encoded, 'base64')
  if (key.length < MIN_KEY_BYTES) return false
  const sent = Number(timestamp)
  if (!Number.isFinite(sent) || Math.abs(now / 1000 - sent) > TOLERANCE_S) return false
  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.`).update(rawBody).digest()
  return signature.split(' ').some((part) => {
    const [version, value] = part.split(',')
    if (version !== 'v1' || !value) return false
    const given = Buffer.from(value, 'base64')
    return given.length === expected.length && timingSafeEqual(given, expected)
  })
}

const BLOCK = /<\/?(?:p|div|li|ul|ol|tr|table|h[1-6]|blockquote)\b[^<>]*>/gi
const ENTITIES: Array<[RegExp, string]> = [[/&nbsp;/g, ' '], [/&lt;/g, '<'], [/&gt;/g, '>'], [/&quot;/g, '"'], [/&#39;/g, "'"]]

/** Plain text from an email's HTML, for one with no text part: blocks and
 *  breaks become line breaks, other tags go, and the common entities are
 *  decoded once (`&amp;` last). A tag stops at the next angle bracket, so a
 *  run of unclosed ones can't be rescanned. A single pass that took only
 *  whole tags could leave one rebuilt from the pieces round another
 *  (`<<b>script>`), so the pass takes every stray bracket too: no raw one
 *  survives it. A bracket the sender wrote as `&lt;` is text, decoded after. */
export function htmlToText(html: string): string {
  let text = html.slice(0, 500_000)
    .replace(/<br\b[^<>]*>/gi, '\n')
    .replace(BLOCK, '\n')
  // Repeated until nothing changes, the form a scanner can check. As the first
  // pass leaves no bracket, the second changes nothing: two passes, linear.
  let previous: string
  do {
    previous = text
    text = text.replace(/<[^<>]*>|[<>]/g, '')
  } while (text !== previous)
  for (const [pattern, value] of ENTITIES) text = text.replace(pattern, value)
  return text.replace(/&amp;/g, '&')
    .split('\n').map((line) => line.trim()).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>
type ReceivedAttachment = { id: string; filename?: string | null; content_type?: string | null; size?: number | null }
type ReceivedEmail = {
  subject?: string | null
  text?: string | null
  html?: string | null
  attachments?: ReceivedAttachment[]
  from?: unknown
  to?: unknown
  cc?: unknown
  bcc?: unknown
  received_for?: unknown
}

export type ResendFetched =
  /** With `outcome`, admit's answer for the message: its PDFs were never
   *  downloaded, so `message` has none. */
  | { ok: true; message: IntakeMessage; outcome?: IntakeOutcome }
  | { ok: false; error: 'too_many_files' | 'too_large' | 'email_unavailable'; detail: string }
  // One member each, so a caller that leaves these alone narrows them away.
  | { ok: false; error: 'not_for_intake'; detail: string }
  | { ok: false; error: 'sender_not_allowed'; detail: string }

const isPdf = (file: { filename?: string | null; content_type?: string | null }) =>
  /\.pdf$/i.test(file.filename ?? '') || file.content_type?.split(';')[0].trim().toLowerCase() === 'application/pdf'

/** The addresses in a list of them, bare and lower-cased. An item may hold
 *  several, joined by commas, and each address is the last <…> outside
 *  quotes, as a display name can hold brackets and commas of its own. One
 *  pass over each item, so no list can keep it busy. */
function addresses(list: unknown): string[] {
  const found: string[] = []
  for (const item of Array.isArray(list) ? list : [list]) {
    if (typeof item !== 'string') continue
    let start = 0
    let quoted = false
    let open = -1
    let address: string | null = null
    const end = (at: number) => {
      found.push((address ?? item.slice(start, at)).trim().toLowerCase())
      start = at + 1
      address = null
    }
    for (let i = 0; i < item.length; i++) {
      const char = item[i]
      if (quoted) {
        if (char === '\\') i++
        else if (char === '"') quoted = false
      } else if (char === '"') quoted = true
      else if (char === '<') open = i
      else if (char === '>' && open >= 0) {
        address = item.slice(open + 1, i)
        open = -1
      } else if (char === ',' && open < 0) end(i)
    }
    end(item.length)
  }
  return found
}

/** Resend would answer the same if asked again, so the webhook is answered
 *  with a refusal rather than delivered again for nothing. */
class Unavailable extends Error {}

/** Resend's own domains: resend.com for its API, and resend.app for the links
 *  to received files (cdn.resend.app, as staging found on 5 November). */
const RESEND_DOMAINS = ['resend.com', 'resend.app']
const onResend = (hostname: string) =>
  RESEND_DOMAINS.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))

type FetchInput = {
  apiKey: string
  address: string
  /** The only senders whose mail is taken; any sender when absent or empty. */
  senders?: string[]
  maxFiles: number
  maxFileBytes: number
  fetch?: Fetch
  timeoutMs?: number
  /** All of a delivery's fetches together; DELIVERY_MS when absent. */
  deliveryMs?: number
  /** Asked once the email's text is read and its PDFs' details pass, before
   *  any is downloaded: an answer for the message ends the fetch there. */
  admit?: (message: Omit<IntakeMessage, 'attachments'>) => Promise<IntakeOutcome | null>
}

/** The received email as the intake takes it: its subject, its text (from its
 *  HTML when it has none), and its PDF attachments' bytes. Resend calls the
 *  webhook for mail to any address it receives for, so only mail to the
 *  intake address is taken, named in a header or in the envelope a forward
 *  was delivered to, and, given its senders, only mail from one of them. The
 *  PDFs' count and sizes are checked from Resend's
 *  metadata before any is downloaded, and each download stops at its limit.
 *  No redirect is followed, and downloads go only to Resend's own https
 *  hosts, without the key. What Resend would answer again is a refusal,
 *  `email_unavailable`; its own trouble, or a key it refuses, throws, so the
 *  webhook is delivered again, as does a delivery whose fetches take longer
 *  than DELIVERY_MS in all. Given `admit`, the request is answered before any
 *  PDF is downloaded (DEC-046). */
export async function fetchResendMessage(emailId: string, input: FetchInput): Promise<ResendFetched> {
  const deliveryMs = input.deliveryMs ?? DELIVERY_MS
  const delivery = AbortSignal.timeout(deliveryMs)
  try {
    return await fetchMessage(emailId, input, delivery)
  } catch (error) {
    if (delivery.aborted) throw new Error(`Resend took longer than ${deliveryMs / 1000} s for the email and its files`)
    if (!(error instanceof Unavailable)) throw error
    return { ok: false, error: 'email_unavailable', detail: `Resend couldn't give the email or its files: ${error.message}.` }
  }
}

async function fetchMessage(emailId: string, input: FetchInput, delivery: AbortSignal): Promise<ResendFetched> {
  const fetchImpl = input.fetch ?? fetch
  const timeout = input.timeoutMs ?? 30_000
  const get = async (url: string, what: string, key?: string) => {
    const headers = key ? { authorization: `Bearer ${key}` } : undefined
    const signal = AbortSignal.any([AbortSignal.timeout(timeout), delivery])
    const res = await fetchImpl(url, { headers, redirect: 'manual', signal })
    if (res.ok) return res
    await res.body?.cancel()
    if (key && (res.status === 401 || res.status === 403)) {
      throw new Error(`${what} answered ${res.status}: RESEND_INBOUND_API_KEY must be a full-access key`)
    }
    if (res.status === 401 || res.status === 403 || res.status === 429 || res.status >= 500) {
      throw new Error(`${what} answered ${res.status}`)
    }
    throw new Unavailable(`${what} answered ${res.status}`)
  }
  const api = async <T>(path: string, what: string): Promise<T> =>
    (await (await get(`${API}${path}`, what, input.apiKey)).json()) as T

  const id = encodeURIComponent(emailId)
  // cid keeps inline images out of the HTML, which is read only as a fallback.
  const email = await api<ReceivedEmail>(`/emails/receiving/${id}?html_format=cid`, 'Resend email')
  const recipients = [email.to, email.cc, email.bcc, email.received_for].flatMap(addresses)
  if (!recipients.includes(input.address.trim().toLowerCase())) {
    return { ok: false, error: 'not_for_intake', detail: 'The email was not sent to the intake address.' }
  }
  if (input.senders?.length) {
    const sender = addresses(email.from)[0]
    if (!sender || !input.senders.some((allowed) => allowed.trim().toLowerCase() === sender)) {
      return { ok: false, error: 'sender_not_allowed', detail: 'The email came from an address the intake does not take mail from.' }
    }
  }
  const pdfs = (email.attachments ?? []).filter(isPdf)
  if (pdfs.length > input.maxFiles) {
    return { ok: false, error: 'too_many_files', detail: `A run takes at most ${input.maxFiles} files, and the message has ${pdfs.length} PDFs.` }
  }
  const tooLarge = (files: ReceivedAttachment[]): ResendFetched => ({
    ok: false,
    error: 'too_large',
    detail: `Each file can be at most ${Math.round(input.maxFileBytes / 1_048_576)} MB: ${files.map((file) => file.filename ?? file.id).join(', ')}.`,
  })
  const tooMuch: ResendFetched = {
    ok: false,
    error: 'too_large',
    detail: `The PDFs come to more than ${MAX_MESSAGE_BYTES / 1_048_576} MB, more than one message can bring.`,
  }
  const large = pdfs.filter((file) => (file.size ?? 0) > input.maxFileBytes)
  if (large.length) return tooLarge(large)
  if (pdfs.reduce((sum, file) => sum + (file.size ?? 0), 0) > MAX_MESSAGE_BYTES) return tooMuch

  const text = email.text?.trim() ? email.text : htmlToText(email.html ?? '')
  const read = { message_id: `resend:${emailId}`, subject: email.subject ?? '', text }
  // The request is read before any PDF is downloaded, so mail that isn't one,
  // the run it already made, or the hour's limit downloads nothing (DEC-046).
  const outcome = pdfs.length && input.admit ? await input.admit(read) : null
  if (outcome) return { ok: true, message: { ...read, attachments: [] }, outcome }

  const attachments: IntakeMessage['attachments'] = []
  let used = 0
  for (const pdf of pdfs) {
    const { download_url: url } = await api<{ download_url?: unknown }>(`/emails/receiving/${id}/attachments/${encodeURIComponent(pdf.id)}`, 'Resend attachment')
    const link = typeof url === 'string' && URL.canParse(url) ? new URL(url) : null
    if (!link || link.protocol !== 'https:' || !onResend(link.hostname)) {
      throw new Unavailable(`an attachment's link is off Resend's own hosts (${link?.hostname || 'none'})`)
    }
    const room = Math.min(input.maxFileBytes, MAX_MESSAGE_BYTES - used)
    const content = await readUpTo(await get(link.href, 'Resend attachment download'), room)
    // Resend may give no size, and the same bytes would fail every delivery.
    if (!content) return room < input.maxFileBytes ? tooMuch : tooLarge([pdf])
    used += content.byteLength
    attachments.push({ filename: pdf.filename ?? `${pdf.id}.pdf`, content_type: pdf.content_type ?? 'application/pdf', content })
  }

  return { ok: true, message: { ...read, attachments } }
}

/** A response's body, or null past `max` bytes: a length it declares is
 *  checked first, and the read stops at the limit. */
async function readUpTo(res: Response, max: number): Promise<Uint8Array | null> {
  if (Number(res.headers.get('content-length') ?? 0) > max) {
    await res.body?.cancel()
    return null
  }
  if (!res.body) return new Uint8Array(0)
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (let read = await reader.read(); !read.done; read = await reader.read()) {
    total += read.value.byteLength
    if (total > max) {
      await reader.cancel()
      return null
    }
    chunks.push(read.value)
  }
  const content = new Uint8Array(total)
  let at = 0
  for (const chunk of chunks) {
    content.set(chunk, at)
    at += chunk.byteLength
  }
  return content
}
