// POST /api/contact: validation and escaping rules.
//
// Only the pure pieces are exercised here: parseContact and the two body
// renderers. The handler itself needs Supabase and Resend, which the route
// already guards behind env checks; what has to be right regardless of the
// environment is that a bad payload never reaches the send, and that
// nothing a stranger typed can inject markup into the email we open.

import { describe, it, expect } from 'vitest'
import { parseContact, escapeHtml, renderEnquiryHtml, MESSAGE_MIN } from './route'

const valid = {
  name: 'Dave Roberts',
  email: 'dave@sparkies.com.au',
  phone: '0412 345 678',
  topic: 'Pricing and plans',
  message: 'Keen to know whether the Starter plan covers two vans.',
}

describe('parseContact', () => {
  it('accepts and trims a well-formed enquiry', () => {
    const r = parseContact({ ...valid, name: '  Dave Roberts  ' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.name).toBe('Dave Roberts')
      expect(r.value.email).toBe('dave@sparkies.com.au')
    }
  })

  it('defaults a missing topic rather than failing', () => {
    const { name, email, phone, message } = valid
    const r = parseContact({ name, email, phone, message })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.topic).toBe('General enquiry')
  })

  it('allows an empty phone', () => {
    const r = parseContact({ ...valid, phone: '' })
    expect(r.ok).toBe(true)
  })

  it.each([
    ['a non-object body', null],
    ['a missing name', { ...valid, name: '   ' }],
    ['an address with no @', { ...valid, email: 'dave.sparkies.com.au' }],
    ['an address with no dot in the domain', { ...valid, email: 'dave@sparkies' }],
    ['an address with a space', { ...valid, email: 'da ve@sparkies.com.au' }],
    ['an over-long name', { ...valid, name: 'x'.repeat(101) }],
    ['an over-long message', { ...valid, message: 'x'.repeat(4001) }],
  ])('rejects %s', (_label, body) => {
    expect(parseContact(body).ok).toBe(false)
  })

  it(`rejects a message under ${MESSAGE_MIN} characters`, () => {
    expect(parseContact({ ...valid, message: 'x'.repeat(MESSAGE_MIN - 1) }).ok).toBe(false)
    expect(parseContact({ ...valid, message: 'x'.repeat(MESSAGE_MIN) }).ok).toBe(true)
  })
})

describe('escaping', () => {
  it('escapes every character that can break out of HTML', () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe(
      '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;',
    )
  })

  it('does not let a submitted message inject markup into the email', () => {
    const html = renderEnquiryHtml({
      ...valid,
      name: '<script>alert(1)</script>',
      message: '<img src=x onerror=alert(1)>',
    })
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;script&gt;')
  })
})
