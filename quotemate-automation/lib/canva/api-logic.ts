// Canva Connect — request validation + connection/import decisions (pure).
//
// Kept out of the route files so vitest can unit-test validation and the
// connected/format logic without importing the routes (which construct a
// Supabase client at module load and throw without env vars). Routes import
// these helpers and supply the DB + network.

import { z } from 'zod'

/** POST /designs body: only an optional human title for the new Canva design. */
export const CreateCanvaDesignBody = z.object({
  title: z.string().trim().min(1).max(120).optional(),
})
export type CreateCanvaDesignInput = z.infer<typeof CreateCanvaDesignBody>

/** POST /designs/[id]/import body: which formats to pull back (default both). */
export const ImportCanvaBody = z.object({
  formats: z.array(z.enum(['png', 'pdf'])).min(1).optional(),
})
export type ImportCanvaInput = z.infer<typeof ImportCanvaBody>

/** The export formats the Flyer tab imports back from Canva. */
export type CanvaImportFormat = 'png' | 'pdf'

export const DEFAULT_CANVA_TITLE = 'QuoteMax flyer'

/** Resolve the export formats to import — defaults to PNG + PDF. */
export function importFormats(input: ImportCanvaInput | null | undefined): CanvaImportFormat[] {
  const requested = input?.formats
  if (requested && requested.length > 0) {
    // De-dupe while preserving order.
    return Array.from(new Set(requested))
  }
  return ['png', 'pdf']
}

/** A connection row read only for its refresh capability. */
export type CanvaConnectionRow = { refresh_token: string | null } | null

/** Connected when a row exists with a refresh token we can renew access from. */
export function isCanvaConnected(row: CanvaConnectionRow): boolean {
  return Boolean(row && row.refresh_token)
}
