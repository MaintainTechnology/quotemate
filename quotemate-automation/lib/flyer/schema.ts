// Flyer Designer — zod schemas + inferred types (single source of truth).
//
// The flyer "document" is the editable state the tradie saves and reopens:
// a template id, canvas size/background, and a flat list of positioned
// elements (text / image / rect). zod is the source of truth so the
// persisted shape stays validated end-to-end; TS types are inferred from it.
//
// Pure module — NO supabase / next imports — so vitest (node env) can import
// it directly, exactly like lib/marketing/qr.ts.

import { z } from 'zod'

/** Text elements may bind to a tenant brand field; resolved at build time. */
export const TEXT_BINDINGS = ['business_name', 'headline', 'tagline', 'email', 'phone'] as const
export type TextBinding = (typeof TEXT_BINDINGS)[number]

/** Curated, web-safe font choices offered in the editor. */
export const FLYER_FONTS = ['Inter', 'Arial', 'Georgia', 'Trebuchet MS', 'Courier New', 'Impact'] as const

const baseShape = {
  id: z.string().min(1),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  rotation: z.number().optional(),
}

export const FlyerTextElementSchema = z.object({
  ...baseShape,
  kind: z.literal('text'),
  text: z.string(),
  binding: z.enum(TEXT_BINDINGS).nullish(),
  fontFamily: z.string(),
  fontSize: z.number().positive(),
  fontStyle: z.enum(['normal', 'bold', 'italic']).optional(),
  fill: z.string(),
  align: z.enum(['left', 'center', 'right']).optional(),
})

export const FlyerImageElementSchema = z.object({
  ...baseShape,
  kind: z.literal('image'),
  // null until a source is chosen (e.g. a QR slot before generation, or a
  // logo slot on a tenant with no logo yet).
  src: z.string().nullable(),
  role: z.enum(['logo', 'qr', 'upload', 'photo']).nullish(),
})

export const FlyerRectElementSchema = z.object({
  ...baseShape,
  kind: z.literal('rect'),
  fill: z.string(),
  cornerRadius: z.number().optional(),
})

export const FlyerElementSchema = z.discriminatedUnion('kind', [
  FlyerTextElementSchema,
  FlyerImageElementSchema,
  FlyerRectElementSchema,
])

export const FlyerTemplateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  width: z.number().positive(),
  height: z.number().positive(),
  background: z.string(),
  elements: z.array(FlyerElementSchema),
})

export const FlyerDocumentSchema = z.object({
  templateId: z.string().min(1),
  width: z.number().positive(),
  height: z.number().positive(),
  background: z.string(),
  elements: z.array(FlyerElementSchema),
})

export type FlyerTextElement = z.infer<typeof FlyerTextElementSchema>
export type FlyerImageElement = z.infer<typeof FlyerImageElementSchema>
export type FlyerRectElement = z.infer<typeof FlyerRectElementSchema>
export type FlyerElement = z.infer<typeof FlyerElementSchema>
export type FlyerTemplate = z.infer<typeof FlyerTemplateSchema>
export type FlyerDocument = z.infer<typeof FlyerDocumentSchema>
