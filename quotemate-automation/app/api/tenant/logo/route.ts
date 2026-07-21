// POST /api/tenant/logo — authenticated logo change for an existing tenant.
//
// The dashboard Account tab calls this to replace the tradie's logo. We upload
// to the public tenant-logos bucket (keyed by tenant id now that the tenant
// exists), then write logo_url + logo_path onto the tenants row — so every
// customer quote letterhead (which renders tenants.logo_url live at /q/[token])
// immediately shows the new logo, on existing quotes as well as future ones.
//
// Auth + validation + storage live in lib/tenant/image-upload.ts, shared with
// the tradie-photo route (/api/tenant/photo).

import { createClient } from '@supabase/supabase-js'
import { handleTenantImageUpload } from '@/lib/tenant/image-upload'

// node:crypto + the Supabase client need the Node.js runtime.
export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function POST(req: Request) {
  return handleTenantImageUpload(supabase, req, 'logo')
}
