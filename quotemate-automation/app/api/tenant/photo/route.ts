// POST /api/tenant/photo — authenticated tradie-photo change (migration 180).
//
// The dashboard Account tab calls this to set the photo shown in the "Your
// tradie" section of every customer quote — both the web quote page and the
// downloadable PDF. Writes photo_url + photo_path onto the tenants row, so
// existing quotes pick it up too (the page reads it live; the PDF's cache
// signature includes photo_url, so a cached PDF regenerates on next download).
//
// Auth + validation + storage are shared with the logo route
// (lib/tenant/image-upload.ts).

import { createClient } from '@supabase/supabase-js'
import { handleTenantImageUpload } from '@/lib/tenant/image-upload'

// node:crypto + the Supabase client need the Node.js runtime.
export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function POST(req: Request) {
  return handleTenantImageUpload(supabase, req, 'photo')
}
