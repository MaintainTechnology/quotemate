// ════════════════════════════════════════════════════════════════════
// Commercial painting — document classification (spec §3).
//
// Every upload is auto-classified into a PaintDocType; the tradie can
// correct it in the UI. Two layers:
//   classifyByFilename — PURE heuristics (unit-tested), instant.
//   classifyPaintDoc   — Sonnet 4.6 vision over the first page image +
//                        filename; falls back to the filename heuristic
//                        on any failure (classification must never
//                        block an upload — reject nothing, spec §3).
// ════════════════════════════════════════════════════════════════════

import { anthropic } from '@ai-sdk/anthropic'
import { generateObject } from 'ai'
import { z } from 'zod'
import type { PaintDocType } from './types'

export const CLASSIFY_MODEL = 'claude-sonnet-4-6'

/** PURE — filename-based classification. Order matters: most-specific first. */
export function classifyByFilename(filename: string): PaintDocType {
  const f = filename.toLowerCase()
  if (/measur|takeoff|take-off|areas|quantit/.test(f)) return 'measurement_takeoff'
  if (/duct|mech|hvac|services|m\d{3}|hydraulic|electrical|fire/.test(f)) return 'services_layout'
  if (/photo|img_|pic|site|\.(jpe?g|png|heic|webp)$/.test(f)) return 'site_photo'
  if (/plan|arch|as\d+|a\d{2,}|drawing|dwg|set|elevation|cp\d/.test(f)) return 'plan_set'
  return 'other'
}

const ClassifySchema = z.object({
  doc_type: z.enum(['plan_set', 'measurement_takeoff', 'services_layout', 'site_photo', 'other']),
  confidence: z.enum(['high', 'medium', 'low']),
  reason: z.string().max(160),
})

export type ClassifyResult = {
  doc_type: PaintDocType
  confidence: 'high' | 'medium' | 'low'
  reason: string
  /** 'vision' when the model classified; 'filename' on fallback. */
  via: 'vision' | 'filename'
}

const CLASSIFY_SYSTEM =
  'You classify construction documents for a commercial painting estimator. ' +
  'Given the FIRST PAGE of a document and its filename, pick exactly one type:\n' +
  '- plan_set: architectural drawing set (floor plans, finishes schedules, elevations, RCPs, cover sheets with drawing registers)\n' +
  '- measurement_takeoff: a quantity takeoff / measurement list (numbered line items with areas in m², often typed or handwritten tables)\n' +
  '- services_layout: mechanical/electrical/hydraulic services drawings (ductwork, diffusers, cable trays)\n' +
  '- site_photo: a photograph of the real building or space\n' +
  '- other: anything else (specs, emails, contracts)\n' +
  'Choose other when genuinely unsure.'

/**
 * Classify one uploaded document. Vision over the first-page PNG when
 * available; pure filename heuristic otherwise or on ANY failure.
 */
export async function classifyPaintDoc(args: {
  filename: string
  /** PNG/JPEG bytes of page 1, when the caller could rasterise it. */
  firstPageImage?: { data: Buffer | Uint8Array; mediaType: 'image/png' | 'image/jpeg' } | null
  model?: string
}): Promise<ClassifyResult> {
  const fallback: ClassifyResult = {
    doc_type: classifyByFilename(args.filename),
    confidence: 'low',
    reason: 'filename heuristic',
    via: 'filename',
  }
  if (!args.firstPageImage || !process.env.ANTHROPIC_API_KEY) return fallback

  try {
    const { object } = await generateObject({
      model: anthropic(args.model ?? CLASSIFY_MODEL),
      schema: ClassifySchema,
      temperature: 0,
      maxRetries: 0,
      system: CLASSIFY_SYSTEM,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: `Filename: ${args.filename}\nClassify this document's first page:` },
            {
              type: 'image',
              image: args.firstPageImage.data,
              mediaType: args.firstPageImage.mediaType,
            },
          ],
        },
      ],
    })
    return { ...object, via: 'vision' }
  } catch {
    return fallback
  }
}
