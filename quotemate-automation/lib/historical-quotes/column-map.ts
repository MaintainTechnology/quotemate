// LLM-assisted CSV column mapping (spec R4). Maps a tradie spreadsheet's
// arbitrary headers to canonical fields. Mirrors the generateObject + Zod +
// temperature:0 + maxRetries:0 pattern in lib/commercial-painting/classify.ts.
// Degrades to a pure header-name heuristic when the model is unavailable or
// errors — classification must never block an import.

import { anthropic } from '@ai-sdk/anthropic'
import { generateObject } from 'ai'
import { z } from 'zod'
import type { ColumnMapping } from './types'

export const COLUMN_MAP_MODEL = 'claude-sonnet-4-6'

function matchHeader(header: string[], patterns: RegExp[]): string | null {
  for (const p of patterns) {
    const hit = header.find((h) => p.test(h))
    if (hit) return hit
  }
  return null
}

/** PURE header-name heuristic — the fallback, independently unit-tested. */
export function heuristicColumnMap(header: string[]): ColumnMapping {
  return {
    description: matchHeader(header, [/desc/, /job/, /service/, /work/, /item/, /detail/, /summary/]),
    price: matchHeader(header, [/total/, /price/, /amount/, /cost/, /charge/, /value/, /\$/]),
    gst_basis: matchHeader(header, [/gst/, /tax/]),
    date: matchHeader(header, [/date/, /quoted/, /created/, /when/]),
    quantity: matchHeader(header, [/qty/, /quantit/, /\bunits?\b/, /count/]),
    unit: matchHeader(header, [/^unit$/, /uom/, /measure/]),
  }
}

const MappingSchema = z.object({
  description: z.string().nullable(),
  price: z.string().nullable(),
  gst_basis: z.string().nullable(),
  date: z.string().nullable(),
  quantity: z.string().nullable(),
  unit: z.string().nullable(),
})

const COLUMN_MAP_SYSTEM =
  "You map a tradie quote spreadsheet's columns to canonical fields. Given the " +
  'header columns and a few sample rows, return — for each canonical field — the ' +
  'EXACT header name (from the provided list) that holds it, or null if absent. ' +
  'Canonical fields: description (what the job/service was), price (the total amount ' +
  'charged), gst_basis (a column stating whether the price includes or excludes GST), ' +
  'date (when the quote was made), quantity, unit. Only use header names that appear ' +
  'in the provided list; never invent one.'

/** Map columns with the model, falling back per-field to the heuristic when the
 *  model is unavailable, errors, or names a header that isn't real. */
export async function mapColumns(
  header: string[],
  sampleRows: Record<string, string>[],
  opts?: { model?: string },
): Promise<ColumnMapping> {
  const fallback = heuristicColumnMap(header)
  if (!process.env.ANTHROPIC_API_KEY || header.length === 0) return fallback
  try {
    const { object } = await generateObject({
      model: anthropic(opts?.model ?? COLUMN_MAP_MODEL),
      schema: MappingSchema,
      temperature: 0,
      maxRetries: 0,
      system: COLUMN_MAP_SYSTEM,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Header columns: ${JSON.stringify(header)}\n\nSample rows:\n${JSON.stringify(
                sampleRows.slice(0, 5),
                null,
                2,
              )}`,
            },
          ],
        },
      ],
    })
    // Keep only mappings that name a real (lowercased) header; else fall back.
    const valid = (v: string | null): string | null =>
      v && header.includes(v.toLowerCase()) ? v.toLowerCase() : null
    return {
      description: valid(object.description) ?? fallback.description,
      price: valid(object.price) ?? fallback.price,
      gst_basis: valid(object.gst_basis) ?? fallback.gst_basis,
      date: valid(object.date) ?? fallback.date,
      quantity: valid(object.quantity) ?? fallback.quantity,
      unit: valid(object.unit) ?? fallback.unit,
    }
  } catch {
    return fallback
  }
}
