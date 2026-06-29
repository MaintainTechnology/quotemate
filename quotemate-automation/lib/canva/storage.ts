// Canva Connect — Supabase Storage paths for imported design exports (pure).
//
// Imported Canva PNG/PDF artifacts live in the existing `flyer-assets` bucket
// under a `canva/` namespace, tenant-scoped so one tenant can never read
// another's exports via a guessed path. Mirrors lib/flyer/storage.ts.

import { FLYER_BUCKET } from '../flyer/storage'

export { FLYER_BUCKET }

/** Path for the latest imported Canva export of one design row. */
export function canvaAssetPath(tenantId: string, designRowId: string, kind: 'png' | 'pdf'): string {
  return `${tenantId}/canva/${designRowId}.${kind}`
}
