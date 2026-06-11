// QuoteMate · create the private `plan-pdfs` storage bucket (SMS estimator).
// Holds customer-uploaded plan PDFs + Gotenberg report PDFs:
//   plan-pdfs/<requestId>/plan.pdf
//   plan-pdfs/<requestId>/report.pdf
// 32MB cap (Anthropic PDF ceiling), application/pdf only, private —
// reads happen server-side or via short-lived signed URLs.
// Idempotent. Usage: node --env-file=.env.local scripts/create-plan-pdfs-bucket.mjs

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
)

const SPEC = {
  public: false,
  fileSizeLimit: 32 * 1024 * 1024,
  allowedMimeTypes: ['application/pdf'],
}

const { data: existing } = await supabase.storage.getBucket('plan-pdfs')
if (existing) {
  const { error } = await supabase.storage.updateBucket('plan-pdfs', SPEC)
  if (error) {
    console.error('updateBucket failed:', error.message)
    process.exit(1)
  }
  console.log('OK — plan-pdfs bucket already existed; spec re-applied.')
} else {
  const { error } = await supabase.storage.createBucket('plan-pdfs', SPEC)
  if (error) {
    console.error('createBucket failed:', error.message)
    process.exit(1)
  }
  console.log('OK — plan-pdfs bucket created (private, 32MB, application/pdf).')
}
