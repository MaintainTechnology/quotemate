// Storage wrapper for the private `plan-pdfs` bucket (SMS estimator flow).
//
// The dashboard estimator analyses PDFs live and never stores them; the SMS
// flow is asynchronous (customer uploads → analysis runs in after()), so the
// plan PDF must be retained. Layout, keyed by plan_upload_requests.id:
//   plan-pdfs/<requestId>/plan.pdf    — the customer's uploaded plan
//   plan-pdfs/<requestId>/report.pdf  — the Gotenberg-rendered results report
//
// Bucket is private (created by scripts/create-plan-pdfs-bucket.mjs);
// customer access goes through token-scoped API routes or signed URLs.

import { createClient } from '@supabase/supabase-js'

const BUCKET = 'plan-pdfs'
const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 7 // 7 days — matches link expiry

let _client: ReturnType<typeof createClient> | null = null
function getClient() {
  if (_client) return _client
  _client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
  return _client
}

/** Store a PDF; returns its storage path. upsert so a retry overwrites. */
export async function uploadPlanPdf(opts: {
  requestId: string
  kind: 'plan' | 'report'
  data: ArrayBuffer | Uint8Array | Buffer
}): Promise<string> {
  const path = `${opts.requestId}/${opts.kind}.pdf`
  const { error } = await getClient()
    .storage.from(BUCKET)
    .upload(path, opts.data, { contentType: 'application/pdf', upsert: true })
  if (error) throw new Error(`plan-pdf upload failed: ${error.message}`)
  return path
}

/** Read a stored PDF back as a Buffer (e.g. to feed the extraction model). */
export async function downloadPlanPdf(path: string): Promise<Buffer> {
  const { data, error } = await getClient().storage.from(BUCKET).download(path)
  if (error || !data) throw new Error(`plan-pdf download failed: ${error?.message ?? 'no data'}`)
  return Buffer.from(await data.arrayBuffer())
}

/** Short-lived public URL (e.g. for a Twilio MMS media fetch). */
export async function signPlanPdfUrl(path: string, ttlSeconds = SIGNED_URL_TTL_SECONDS): Promise<string> {
  const { data, error } = await getClient().storage.from(BUCKET).createSignedUrl(path, ttlSeconds)
  if (error || !data?.signedUrl) throw new Error(`plan-pdf sign failed: ${error?.message ?? 'no url'}`)
  return data.signedUrl
}
