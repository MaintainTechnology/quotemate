// lib/roofing/quote-cta — pure CTA derivation for the customer roofing quote
// page (specs/quote-confirm-send.md task 4). The tier cards and the sticky bar
// were rendering dead null-href "Reply to book" pills; this policy points them
// at the on-page accept block (or the SMS confirm gate) instead.

import { describe, expect, it } from 'vitest'
import { roofQuoteCta } from '@/lib/roofing/quote-cta'

describe('roofQuoteCta', () => {
  const base = {
    showPrices: true,
    indicative: false,
    acceptActionable: true,
    smsNumber: '+61481613464' as string | null,
  }

  it('priced + actionable accept: anchors to the on-page accept block', () => {
    expect(roofQuoteCta(base)).toEqual({ label: 'Accept & book', href: '#accept' })
    expect(roofQuoteCta({ ...base, indicative: true })).toEqual({
      label: 'Book site visit',
      href: '#accept',
    })
  })

  it('priced but accept not actionable (paid/expired): label-only pill, current wording', () => {
    expect(roofQuoteCta({ ...base, acceptActionable: false })).toEqual({
      label: 'Reply to book',
      href: null,
    })
    expect(roofQuoteCta({ ...base, acceptActionable: false, indicative: true })).toEqual({
      label: 'Reply to confirm',
      href: null,
    })
  })

  it('gate closed: sms deep-link prefilled with YES when the tenant has a number', () => {
    expect(roofQuoteCta({ ...base, showPrices: false })).toEqual({
      label: 'Reply YES to see prices',
      href: 'sms:+61481613464?&body=YES',
    })
  })

  it('gate closed without a tenant number: label-only', () => {
    expect(roofQuoteCta({ ...base, showPrices: false, smsNumber: null })).toEqual({
      label: 'Reply YES to see prices',
      href: null,
    })
  })
})
