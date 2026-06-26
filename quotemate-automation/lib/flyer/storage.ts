// Flyer Designer — Supabase Storage paths (pure).
//
// Exported PNG/PDF artifacts and tradie-uploaded images live in the
// `flyer-assets` bucket, namespaced by tenant_id so one tenant can never read
// another's objects via a guessed path.

export const FLYER_BUCKET = 'flyer-assets'

/** Path for an exported flyer artifact (latest PNG/PDF per flyer). */
export function flyerAssetPath(tenantId: string, flyerId: string, kind: 'png' | 'pdf'): string {
  return `${tenantId}/flyers/${flyerId}.${kind}`
}

/** Path for a tradie-uploaded image used inside a flyer. */
export function flyerUploadPath(tenantId: string, fileId: string, ext: string): string {
  return `${tenantId}/uploads/${fileId}.${ext}`
}
