// Flyer Designer — request validation + ownership decisions (pure).
//
// Kept out of the route files so vitest can unit-test the validation and
// tenant-isolation logic without importing the routes (which call
// createClient at module load and would throw without env vars). The routes
// import these helpers and supply the DB.

import { z } from 'zod'
import { FlyerDocumentSchema } from './schema'

export const CreateFlyerBody = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  template_id: z.string().trim().min(1),
})
export type CreateFlyerInput = z.infer<typeof CreateFlyerBody>

export const PatchFlyerBody = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    document: FlyerDocumentSchema.optional(),
  })
  .refine((b) => b.name !== undefined || b.document !== undefined, {
    message: 'nothing_to_update',
  })

export const ExportFlyerBody = z.object({
  // data: URLs produced client-side (Konva PNG + jsPDF PDF).
  png: z.string().startsWith('data:image/'),
  pdf: z.string().startsWith('data:application/pdf').optional(),
})

/** A row read for an ownership check — only the tenant link matters here. */
export type OwnedRow = { tenant_id: string } | null

export type OwnershipVerdict =
  | { ok: true }
  | { ok: false; status: 404 | 403; error: 'not_found' | 'forbidden' }

/** 404 when the row is missing, 403 when it belongs to another tenant. */
export function ownershipVerdict(row: OwnedRow, tenantId: string): OwnershipVerdict {
  if (!row) return { ok: false, status: 404, error: 'not_found' }
  if (row.tenant_id !== tenantId) return { ok: false, status: 403, error: 'forbidden' }
  return { ok: true }
}

export const DEFAULT_FLYER_NAME = 'Untitled flyer'
