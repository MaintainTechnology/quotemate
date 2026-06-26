import { describe, it, expect } from 'vitest'
import { FLYER_TEMPLATES, getTemplate, FLYER_TEMPLATE_IDS } from './templates'
import { FlyerTemplateSchema, TEXT_BINDINGS } from './schema'

describe('FLYER_TEMPLATES', () => {
  it('ships at least 3 templates with unique ids', () => {
    expect(FLYER_TEMPLATES.length).toBeGreaterThanOrEqual(3)
    const ids = FLYER_TEMPLATES.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every template is schema-valid', () => {
    for (const t of FLYER_TEMPLATES) {
      const r = FlyerTemplateSchema.safeParse(t)
      expect(r.success, `${t.id}: ${r.success ? '' : JSON.stringify(r.error.flatten())}`).toBe(true)
    }
  })

  it('every template has exactly one QR slot', () => {
    for (const t of FLYER_TEMPLATES) {
      const qrSlots = t.elements.filter((e) => e.kind === 'image' && e.role === 'qr')
      expect(qrSlots, t.id).toHaveLength(1)
    }
  })

  it('element ids are unique within each template', () => {
    for (const t of FLYER_TEMPLATES) {
      const ids = t.elements.map((e) => e.id)
      expect(new Set(ids).size, t.id).toBe(ids.length)
    }
  })

  it('text bindings only reference known tenant fields', () => {
    for (const t of FLYER_TEMPLATES) {
      for (const e of t.elements) {
        if (e.kind === 'text' && e.binding) {
          expect(TEXT_BINDINGS).toContain(e.binding)
        }
      }
    }
  })

  it('getTemplate resolves known ids and returns null otherwise', () => {
    expect(getTemplate(FLYER_TEMPLATE_IDS[0])?.id).toBe(FLYER_TEMPLATE_IDS[0])
    expect(getTemplate('does-not-exist')).toBeNull()
  })
})
