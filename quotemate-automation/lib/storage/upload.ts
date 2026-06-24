// Wrapper around Supabase Storage for the intake-photos bucket.
// All photos are stored at intake-photos/<callId>/<timestamp>-<index>.<ext>
// Bucket is private; reads are via short-lived signed URLs.

import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'node:crypto'

const BUCKET = 'intake-photos'
const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24  // 24h — long enough for Sonnet to consume

let _client: ReturnType<typeof createClient> | null = null
function getClient() {
  if (_client) return _client
  _client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
  return _client
}

export async function uploadIntakePhoto(opts: {
  callId: string
  data: ArrayBuffer | Uint8Array
  contentType: string
  index: number
}): Promise<{ path: string; signedUrl: string }> {
  const ext = mimeToExt(opts.contentType)
  const stamp = Date.now()
  const random = randomBytes(4).toString('hex')
  const path = `${opts.callId}/${stamp}-${opts.index}-${random}.${ext}`

  const { error: uploadErr } = await getClient().storage
    .from(BUCKET)
    .upload(path, opts.data, { contentType: opts.contentType, upsert: false })

  if (uploadErr) throw new Error(`Upload failed: ${uploadErr.message}`)

  const { data: signed, error: signErr } = await getClient().storage
    .from(BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS)

  if (signErr || !signed?.signedUrl) {
    throw new Error(`Sign failed: ${signErr?.message ?? 'no url returned'}`)
  }

  return { path, signedUrl: signed.signedUrl }
}

/**
 * Re-sign an existing storage path. Use when a stored URL has expired and
 * we need to feed the photo to Sonnet vision again.
 */
export async function refreshSignedUrl(path: string): Promise<string> {
  const { data, error } = await getClient().storage
    .from(BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS)
  if (error || !data?.signedUrl) throw new Error(`re-sign failed: ${error?.message}`)
  return data.signedUrl
}

function mimeToExt(mime: string): string {
  switch (mime) {
    case 'image/jpeg': return 'jpg'
    case 'image/png':  return 'png'
    case 'image/webp': return 'webp'
    default:           return 'bin'
  }
}

// ─── Tenant logos ──────────────────────────────────────────────────
// Separate PUBLIC bucket (migration 141). Logos are rendered on the
// customer quote letterhead via a plain getPublicUrl() <img src>, so a
// short-lived signed URL would be wrong here — we want a stable public URL.

export const TENANT_LOGO_BUCKET = 'tenant-logos'
export const MAX_LOGO_BYTES = 2 * 1024 * 1024 // 2 MB — must match the bucket cap
export const ALLOWED_LOGO_MIME = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/svg+xml',
] as const

function logoMimeToExt(mime: string): string {
  switch (mime) {
    case 'image/jpeg':    return 'jpg'
    case 'image/png':     return 'png'
    case 'image/webp':    return 'webp'
    case 'image/svg+xml': return 'svg'
    default:              return 'bin'
  }
}

/**
 * Strip the active content out of an uploaded SVG before it's stored in a
 * public bucket. A malicious SVG served from our storage origin could run
 * <script>, inline event handlers, or javascript: URLs — stored XSS. We only
 * ever render the logo via <img src>, where scripts don't execute, but the raw
 * URL is publicly reachable, so we harden the file itself: remove <script>,
 * <foreignObject>, on*= handlers, and javascript:/data:text URIs.
 */
export function sanitizeSvg(svg: string): string {
  return svg
    .replace(/<\s*script[\s\S]*?<\s*\/\s*script\s*>/gi, '')
    .replace(/<\s*script[^>]*\/?>/gi, '')
    .replace(/<\s*foreignObject[\s\S]*?<\s*\/\s*foreignObject\s*>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/\son\w+\s*=\s*[^\s>]+/gi, '')
    .replace(/(href|xlink:href)\s*=\s*("|')\s*javascript:[^"']*\2/gi, '$1=$2#$2')
}

/**
 * Upload a tenant's logo to the public tenant-logos bucket and return its
 * stable public URL + storage path. `ownerKey` scopes the object (the auth
 * user_id pre-activate, since the tenant row doesn't exist yet). SVGs are
 * sanitised before storage. Validates type + size; throws on violation so the
 * API route can surface a clean error and persist nothing.
 */
export async function uploadTenantLogo(opts: {
  ownerKey: string
  data: ArrayBuffer | Uint8Array
  contentType: string
}): Promise<{ path: string; publicUrl: string }> {
  const mime = opts.contentType.split(';')[0].trim().toLowerCase()
  if (!(ALLOWED_LOGO_MIME as readonly string[]).includes(mime)) {
    throw new Error('Logo must be a PNG, JPG, WEBP, or SVG image.')
  }

  let bytes = opts.data instanceof Uint8Array ? opts.data : new Uint8Array(opts.data)
  if (bytes.byteLength > MAX_LOGO_BYTES) {
    throw new Error('Logo must be 2 MB or smaller.')
  }
  if (bytes.byteLength === 0) {
    throw new Error('Logo file is empty.')
  }

  // Harden SVGs before they land in a public bucket.
  if (mime === 'image/svg+xml') {
    const cleaned = sanitizeSvg(new TextDecoder().decode(bytes))
    bytes = new TextEncoder().encode(cleaned)
  }

  const ext = logoMimeToExt(mime)
  const safeKey = (opts.ownerKey || 'pending').replace(/[^a-zA-Z0-9_-]/g, '') || 'pending'
  const path = `${safeKey}/logo-${Date.now()}-${randomBytes(4).toString('hex')}.${ext}`

  const { error: uploadErr } = await getClient().storage
    .from(TENANT_LOGO_BUCKET)
    .upload(path, bytes, { contentType: mime, upsert: true })
  if (uploadErr) throw new Error(`Logo upload failed: ${uploadErr.message}`)

  const { data: pub } = getClient().storage.from(TENANT_LOGO_BUCKET).getPublicUrl(path)
  if (!pub?.publicUrl) throw new Error('Could not resolve the logo public URL.')

  return { path, publicUrl: pub.publicUrl }
}
