// Mig 146 — the pure cache-signature helpers behind the self-healing quote PDF
// (lib/quote/pdf-signature.ts). The signature fingerprints what a cached PDF was
// rendered from; quotePdfIsStale decides when ensureQuotePdf must regenerate.

import { describe, expect, it } from 'vitest'
import { quotePdfSignature, quotePdfIsStale, hashReportContent } from './pdf-signature'

describe('quotePdfSignature', () => {
  const base = {
    templateVersion: 2,
    tierMode: 'single' as const,
    visibleTierKeys: ['better'] as const,
    recommendedTier: null,
  }

  it('is deterministic for the same inputs', () => {
    expect(quotePdfSignature(base)).toBe(quotePdfSignature(base))
  })

  it('changes when the tier mode changes (tradie flips the Pricing setting)', () => {
    expect(quotePdfSignature({ ...base, tierMode: 'good_better_best' })).not.toBe(
      quotePdfSignature(base),
    )
  })

  it('changes when the visible tier set changes', () => {
    expect(
      quotePdfSignature({ ...base, visibleTierKeys: ['good', 'better', 'best'] }),
    ).not.toBe(quotePdfSignature(base))
  })

  it('changes when the report template version is bumped', () => {
    expect(quotePdfSignature({ ...base, templateVersion: 3 })).not.toBe(quotePdfSignature(base))
  })

  it('changes when the recommended tier changes', () => {
    expect(quotePdfSignature({ ...base, recommendedTier: 'better' })).not.toBe(
      quotePdfSignature(base),
    )
  })
})

describe('quotePdfIsStale', () => {
  const sig = 'v2|single|t=better|r='

  it('is stale when there is no cached PDF yet', () => {
    expect(quotePdfIsStale({ pdfPath: null, storedSignature: sig, freshSignature: sig })).toBe(true)
  })

  it('is stale when an explicit regenerate is requested (send paths)', () => {
    expect(
      quotePdfIsStale({ pdfPath: 'p', storedSignature: sig, freshSignature: sig, regenerate: true }),
    ).toBe(true)
  })

  it('is stale when the stored signature differs (mode/template changed)', () => {
    expect(
      quotePdfIsStale({
        pdfPath: 'p',
        storedSignature: 'v1|good_better_best|t=good+better+best|r=better',
        freshSignature: sig,
      }),
    ).toBe(true)
  })

  it('is stale when the stored signature is NULL (pre-mig146 cached PDF)', () => {
    expect(quotePdfIsStale({ pdfPath: 'p', storedSignature: null, freshSignature: sig })).toBe(true)
  })

  it('is FRESH when the cached PDF matches the current signature', () => {
    expect(quotePdfIsStale({ pdfPath: 'p', storedSignature: sig, freshSignature: sig })).toBe(false)
  })
})

describe('hashReportContent', () => {
  it('is deterministic', () => {
    const doc = { version: 1, blocks: [{ type: 'title', content: [{ text: 'A' }] }] }
    expect(hashReportContent(doc, null)).toBe(hashReportContent(doc, null))
  })

  it('changes when the document changes', () => {
    const a = { version: 1, blocks: [{ type: 'title', content: [{ text: 'A' }] }] }
    const b = { version: 1, blocks: [{ type: 'title', content: [{ text: 'B' }] }] }
    expect(hashReportContent(a, null)).not.toBe(hashReportContent(b, null))
  })

  it('changes when the style changes', () => {
    const doc = { version: 1, blocks: [] }
    expect(hashReportContent(doc, { accentColor: '#FF5F00' })).not.toBe(
      hashReportContent(doc, { accentColor: '#2563EB' }),
    )
  })

  it('is empty string when there is no document (legacy quotes)', () => {
    expect(hashReportContent(null, null)).toBe('')
  })
})

describe('quotePdfSignature with gstRegistered (RC-2 — cross-channel GST parity)', () => {
  const base = {
    templateVersion: 2,
    tierMode: 'single' as const,
    visibleTierKeys: ['better'] as const,
    recommendedTier: null,
  }

  it('is UNCHANGED for a GST-registered tenant (the default) — no forced regen of existing PDFs', () => {
    // Registered is the platform default; omitting it OR passing true must keep
    // the pre-RC-2 signature byte-identical so every cached registered PDF is
    // NOT force-regenerated on the next download.
    expect(quotePdfSignature({ ...base, gstRegistered: true })).toBe(quotePdfSignature(base))
    expect(quotePdfSignature(base)).toBe('v2|single|t=better|r=')
  })

  it('changes when the tradie flips to NON-registered (headline drops the 10% GST)', () => {
    // The PDF headline is displayIncGst(subtotal, {gstRegistered}) — ×1.10 when
    // registered, ×1.00 when not. If the signature ignores gst_registered, the
    // cached download PDF keeps the old (with-GST) headline while a fresh send
    // and the live page show the new one, contradicting the Stripe charge.
    expect(quotePdfSignature({ ...base, gstRegistered: false })).not.toBe(
      quotePdfSignature(base),
    )
  })
})

describe('quotePdfSignature with docHash', () => {
  const base = {
    templateVersion: 2,
    tierMode: 'single' as const,
    visibleTierKeys: ['better'] as const,
    recommendedTier: null,
  }

  it('is UNCHANGED for a legacy quote (no docHash) — no forced regen', () => {
    expect(quotePdfSignature(base)).toBe('v2|single|t=better|r=')
  })

  it('appends a doc segment when a docHash is present', () => {
    const sig = quotePdfSignature({ ...base, docHash: 'abc123' })
    expect(sig).toBe('v2|single|t=better|r=|d=abc123')
  })

  it('differs when the docHash differs', () => {
    expect(quotePdfSignature({ ...base, docHash: 'aaa' })).not.toBe(
      quotePdfSignature({ ...base, docHash: 'bbb' }),
    )
  })
})
