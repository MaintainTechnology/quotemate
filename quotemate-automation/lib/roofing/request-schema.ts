// ════════════════════════════════════════════════════════════════════
// Roofing — HTTP request validation schema.
//
// Splits validation away from the route file so we can unit-test the
// parser without spinning up Next.js handlers.
// ════════════════════════════════════════════════════════════════════

import { z } from 'zod'

/** Reusable address + inputs schemas so the single- and multi-structure
 *  requests share one source of truth. */
export const MeasureAddressSchema = z.object({
  address: z.string().min(3).max(300),
  postcode: z.string().regex(/^\d{4}$/, 'AU postcode is 4 digits'),
  state: z.enum(['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'ACT', 'NT']),
})

export const MeasureInputsSchema = z.object({
  material: z.enum([
    'colorbond_corrugated',
    'colorbond_trimdek',
    'colorbond_spandek',
    'colorbond_kliplok',
    'concrete_tile',
    'terracotta_tile',
    'cement_sheet',
    'unknown',
  ]),
  pitch: z.enum(['shallow', 'standard', 'steep', 'very_steep', 'unknown']),
  building_year_built: z.number().int().min(1850).max(2100).optional().nullable(),
  intent: z.enum([
    'full_reroof',
    'patch_repair',
    'leak_trace',
    'gutter_replace',
    'ridge_cap',
    'flashing_repair',
    'unknown',
  ]),
})

export const MeasureRequestSchema = z.object({
  address: MeasureAddressSchema,
  inputs: MeasureInputsSchema,
  /** Optional `?mock=1` style override — flips orchestrator to the
   *  deterministic mock provider regardless of env. */
  use_mock_provider: z.boolean().optional(),
})

export type MeasureRequest = z.infer<typeof MeasureRequestSchema>

/**
 * Multi-structure measurement request. `inputs` is the shared default
 * applied to every structure; `perBuilding` overrides individual fields
 * for a specific buildingId (e.g. a Colorbond shed on a tile house).
 */
export const MeasureAllRequestSchema = z.object({
  address: MeasureAddressSchema,
  inputs: MeasureInputsSchema,
  perBuilding: z.record(z.string(), MeasureInputsSchema.partial()).optional(),
  use_mock_provider: z.boolean().optional(),
})

export type MeasureAllRequest = z.infer<typeof MeasureAllRequestSchema>

/** One structure the tradie chose to keep, sent to the save endpoint. */
export const SaveStructureSchema = z.object({
  buildingId: z.string().nullable(),
  role: z.enum(['primary', 'secondary']),
  label: z.string().min(1).max(120),
  inputs: MeasureInputsSchema,
})

/** Persist a confirmed multi-structure roofing measurement. */
export const SaveRoofMeasurementSchema = z.object({
  address: MeasureAddressSchema,
  provider: z.enum(['geoscape', 'lidar', 'mock', 'manual']),
  structures: z.array(SaveStructureSchema).min(1).max(12),
  /** Whole-measurement payload as returned by measure-all, stored verbatim. */
  quote: z.unknown().optional(),
  /**
   * The tradie's 1-based structure selection from the dashboard include
   * toggles. Persisted as the authoritative `included_indices` so the saved
   * quote, customer page and PDF all reflect exactly what was checked. Omitted
   * ⇒ the server defaults to roof-only (the primary structure).
   */
  included_indices: z.array(z.number().int()).max(64).optional(),
  customer_name: z.string().max(160).optional().nullable(),
  customer_phone: z.string().max(40).optional().nullable(),
})

export type SaveRoofMeasurementRequest = z.infer<typeof SaveRoofMeasurementSchema>
