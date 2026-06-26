import { describe, it, expect } from 'vitest'
import { CreateFlyerBody, PatchFlyerBody, ExportFlyerBody, ownershipVerdict } from './api-logic'
import { buildInitialDocument } from './document'
import { getTemplate } from './templates'

describe('CreateFlyerBody', () => {
  it('requires a template_id, name optional', () => {
    expect(CreateFlyerBody.safeParse({ template_id: 'bold-promo' }).success).toBe(true)
    expect(CreateFlyerBody.safeParse({ template_id: 'bold-promo', name: 'Promo' }).success).toBe(true)
    expect(CreateFlyerBody.safeParse({}).success).toBe(false)
    expect(CreateFlyerBody.safeParse({ template_id: '' }).success).toBe(false)
  })
})

describe('PatchFlyerBody', () => {
  it('accepts a name-only or document-only update', () => {
    expect(PatchFlyerBody.safeParse({ name: 'Renamed' }).success).toBe(true)
    const doc = buildInitialDocument(getTemplate('clean-services')!, { business_name: 'X' })
    expect(PatchFlyerBody.safeParse({ document: doc }).success).toBe(true)
  })

  it('rejects an empty patch and a malformed document', () => {
    expect(PatchFlyerBody.safeParse({}).success).toBe(false)
    expect(PatchFlyerBody.safeParse({ document: { templateId: 'x' } }).success).toBe(false)
  })
})

describe('ExportFlyerBody', () => {
  it('requires a data-image png; pdf optional', () => {
    expect(ExportFlyerBody.safeParse({ png: 'data:image/png;base64,AAAA' }).success).toBe(true)
    expect(
      ExportFlyerBody.safeParse({ png: 'data:image/png;base64,AAAA', pdf: 'data:application/pdf;base64,BBBB' }).success,
    ).toBe(true)
    expect(ExportFlyerBody.safeParse({ png: 'https://evil/x.png' }).success).toBe(false)
  })
})

describe('ownershipVerdict (tenant isolation, E5)', () => {
  it('404 when the row is missing', () => {
    const v = ownershipVerdict(null, 't1')
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.status).toBe(404)
  })

  it('403 when the row belongs to another tenant', () => {
    const v = ownershipVerdict({ tenant_id: 't2' }, 't1')
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.status).toBe(403)
  })

  it('ok when the row belongs to the caller', () => {
    expect(ownershipVerdict({ tenant_id: 't1' }, 't1').ok).toBe(true)
  })
})
