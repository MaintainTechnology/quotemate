import { describe, it, expect } from 'vitest'
import { buildInitialDocument, applyOverrides, headlineForTrade, resolveBinding } from './document'
import { getTemplate, FLYER_TEMPLATES } from './templates'
import { FlyerDocumentSchema, type FlyerDocument } from './schema'

const TENANT = {
  business_name: 'Atomic Electrical',
  logo_url: 'https://cdn.example.com/logo.png',
  owner_email: 'jo@atomic.com.au',
  owner_mobile: '0400 111 222',
  trade: 'electrical',
}

describe('headlineForTrade', () => {
  it('maps known trades and falls back for unknown', () => {
    expect(headlineForTrade('electrical')).toMatch(/electric/i)
    expect(headlineForTrade('plumbing')).toMatch(/plumb/i)
    expect(headlineForTrade('painting')).toMatch(/paint/i)
    expect(headlineForTrade(null)).toBe('Quality Trade Services')
    expect(headlineForTrade('underwater-basket-weaving')).toBe('Quality Trade Services')
  })
})

describe('resolveBinding', () => {
  it('reads tenant fields and trims', () => {
    expect(resolveBinding('business_name', TENANT)).toBe('Atomic Electrical')
    expect(resolveBinding('email', TENANT)).toBe('jo@atomic.com.au')
    expect(resolveBinding('phone', TENANT)).toBe('0400 111 222')
    expect(resolveBinding('headline', TENANT)).toMatch(/electric/i)
    expect(resolveBinding('tagline', TENANT)).toBe('')
  })
})

describe('buildInitialDocument', () => {
  const template = getTemplate('bold-promo')!

  it('fills bindings from tenant data', () => {
    const doc = buildInitialDocument(template, TENANT)
    const business = doc.elements.find((e) => e.id === 'business')!
    const logo = doc.elements.find((e) => e.id === 'logo')!
    expect(business.kind === 'text' && business.text).toBe('Atomic Electrical')
    expect(logo.kind === 'image' && logo.src).toBe(TENANT.logo_url)
  })

  it('produces a schema-valid document', () => {
    const doc = buildInitialDocument(template, TENANT)
    expect(FlyerDocumentSchema.safeParse(doc).success).toBe(true)
    expect(doc.templateId).toBe('bold-promo')
  })

  it('tolerates missing brand fields by keeping placeholders (E1)', () => {
    const doc = buildInitialDocument(template, {})
    const business = doc.elements.find((e) => e.id === 'business')!
    const logo = doc.elements.find((e) => e.id === 'logo')!
    // text binding empty → placeholder copy retained
    expect(business.kind === 'text' && business.text).toBe('Your Business')
    // no logo_url → null src, no crash
    expect(logo.kind === 'image' && logo.src).toBeNull()
    expect(FlyerDocumentSchema.safeParse(doc).success).toBe(true)
  })

  it('builds valid documents for every shipped template', () => {
    for (const t of FLYER_TEMPLATES) {
      const doc = buildInitialDocument(t, TENANT)
      expect(FlyerDocumentSchema.safeParse(doc).success, t.id).toBe(true)
    }
  })
})

describe('applyOverrides', () => {
  const template = getTemplate('bold-promo')!

  it('lets saved elements win and appends document-only elements', () => {
    const doc: FlyerDocument = {
      ...buildInitialDocument(template, TENANT),
    }
    // edit an existing element
    const headlineIdx = doc.elements.findIndex((e) => e.id === 'headline')
    const edited = { ...doc.elements[headlineIdx], text: 'Winter Special' }
    doc.elements[headlineIdx] = edited as typeof doc.elements[number]
    // add a document-only uploaded image
    doc.elements.push({ id: 'upload-1', kind: 'image', src: 'data:image/png;base64,xxx', role: 'upload', x: 10, y: 10, width: 100, height: 100 })

    const merged = applyOverrides(template, doc)
    const mergedHeadline = merged.find((e) => e.id === 'headline')!
    expect(mergedHeadline.kind === 'text' && mergedHeadline.text).toBe('Winter Special')
    expect(merged.some((e) => e.id === 'upload-1')).toBe(true)
    // template still contributes its other elements
    expect(merged.some((e) => e.id === 'qr')).toBe(true)
  })
})

describe('FlyerDocumentSchema', () => {
  it('rejects malformed documents', () => {
    expect(FlyerDocumentSchema.safeParse({}).success).toBe(false)
    expect(
      FlyerDocumentSchema.safeParse({
        templateId: 'x',
        width: 800,
        height: 1131,
        background: '#fff',
        elements: [{ id: 'a', kind: 'text' }], // missing required text fields
      }).success,
    ).toBe(false)
    expect(
      FlyerDocumentSchema.safeParse({
        templateId: 'x',
        width: 800,
        height: 1131,
        background: '#fff',
        elements: [{ id: 'a', kind: 'banana', x: 0, y: 0, width: 1, height: 1 }],
      }).success,
    ).toBe(false)
  })
})
