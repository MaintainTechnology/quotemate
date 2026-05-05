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
