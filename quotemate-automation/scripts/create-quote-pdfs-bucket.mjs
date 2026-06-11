// QuoteMate · create the private `quote-pdfs` storage bucket.
// Holds Gotenberg-rendered customer quote PDFs:
//   quote-pdfs/quotes/<quoteId>.pdf   — electrical/plumbing G/B/B quotes
//   quote-pdfs/roofs/<token>.pdf      — roofing quotes
// Private — customer access streams through the token-scoped
// /api/q/[token]/pdf and /api/q/roof/[token]/pdf routes; MMS uses
// short-lived signed URLs.
// Idempotent. Usage: node --env-file=.env.local scripts/create-quote-pdfs-bucket.mjs

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
)

const SPEC = {
  public: false,
  fileSizeLimit: 8 * 1024 * 1024,
  allowedMimeTypes: ['application/pdf'],
}

const { data: existing } = await supabase.storage.getBucket('quote-pdfs')
if (existing) {
  const { error } = await supabase.storage.updateBucket('quote-pdfs', SPEC)
  if (error) {
    console.error('updateBucket failed:', error.message)
    process.exit(1)
  }
  console.log('OK — quote-pdfs bucket already existed; spec re-applied.')
} else {
  const { error } = await supabase.storage.createBucket('quote-pdfs', SPEC)
  if (error) {
    console.error('createBucket failed:', error.message)
    process.exit(1)
  }
  console.log('OK — quote-pdfs bucket created (private, 8MB, application/pdf).')
}
