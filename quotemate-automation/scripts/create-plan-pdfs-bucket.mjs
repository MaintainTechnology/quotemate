// QuoteMate · create the private `plan-pdfs` storage bucket (SMS estimator
// + commercial painting runs).
// Holds customer-uploaded plan PDFs + Gotenberg report PDFs:
//   plan-pdfs/<requestId>/plan.pdf
//   plan-pdfs/<requestId>/report.pdf
// and commercial painting run documents (PDFs AND site photos):
//   plan-pdfs/paint/<runId>/<uploadId>.<ext>
// and roof plan takeoff runs (qm-roofing-takeoff), plus their eval fixtures:
//   plan-pdfs/roofing/<tenantId>/<runId>/<uploadId>.pdf
//   plan-pdfs/eval/<fixture>/
// 50MB cap since migration 223, for takeoff plan sets; the SMS and painting
// upload routes keep their own 32MB checks (the Anthropic PDF ceiling).
// Re-running this script re-applies the cap, so keep it in step with 223.
// Private — reads happen server-side or
// via short-lived signed URLs. The MIME allowlist matches the painting
// upload routes (app/api/tenant/commercial-painting/upload/{sign,complete}
// — browsers PUT files straight to storage via signed URLs): PDF + images.
// Idempotent. Usage: node --env-file=.env.local scripts/create-plan-pdfs-bucket.mjs

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
)

const SPEC = {
  public: false,
  fileSizeLimit: 50 * 1024 * 1024,
  // application/zip: the takeoff's Roof Wizard packs (migration 225, TKO-18).
  allowedMimeTypes: ['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'application/zip'],
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
  console.log('OK — plan-pdfs bucket created (private, 50MB, PDF and images).')
}
