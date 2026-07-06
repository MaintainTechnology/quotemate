// Tests for POST /api/quote/[id]/document — the owner-gated, money-free write of
// the quote document (report_doc) + per-quote branding (report_style). Verifies:
// the owner-gate + paid/inspection guards, no_changes/invalid_style rejection,
// server-side ReportDoc sanitisation, and that the PDF cache is invalidated.
// Mirrors the supabase mock shape from the /edit route test.

import { describe, it, expect, beforeEach, vi } from 'vitest'

type Row = unknown
const state: { user: { id: string } | null; userErr: unknown; quote: Row; tenant: Row; updErr: unknown } = {
  user: null,
  userErr: null,
  quote: undefined,
  tenant: undefined,
  updErr: null,
}
const captured: { update: Record<string, unknown> | null } = { update: null }

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: state.user }, error: state.userErr }) },
    from: (table: string) => {
      const data = table === 'quotes' ? state.quote : table === 'tenants' ? state.tenant : null
      const builder: Record<string, unknown> = {}
      const chain = () => builder
      builder.select = chain
      builder.eq = chain
      builder.maybeSingle = async () => ({ data })
      builder.update = (body: Record<string, unknown>) => {
        if (table === 'quotes') captured.update = body
        return { eq: async () => ({ error: state.updErr }) }
      }
      return builder
    },
  }),
}))

import { POST } from './route'

function post(body: unknown, opts: { bearer?: boolean } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (opts.bearer !== false) headers.authorization = 'Bearer tok'
  return POST(new Request('http://x/api/quote/q1/document', { method: 'POST', headers, body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: 'q1' }),
  })
}

beforeEach(() => {
  state.user = { id: 'owner-1' }
  state.userErr = null
  state.quote = { id: 'q1', tenant_id: 't1', paid_at: null, needs_inspection: false }
  state.tenant = { id: 't1', owner_user_id: 'owner-1' }
  state.updErr = null
  captured.update = null
})

const doc = { version: 1, blocks: [{ type: 'title', content: [{ text: 'Hi' }] }] }

describe('POST /api/quote/[id]/document — auth & guards', () => {
  it('401 without a bearer token', async () => {
    const res = await post({ report_doc: doc }, { bearer: false })
    expect(res.status).toBe(401)
  })

  it('401 when the token resolves to no user', async () => {
    state.user = null
    expect((await post({ report_doc: doc })).status).toBe(401)
  })

  it('403 not_owner when the tenant owner differs', async () => {
    state.tenant = { id: 't1', owner_user_id: 'someone-else' }
    const res = await post({ report_doc: doc })
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ error: 'not_owner' })
  })

  it('409 on a paid quote (immutable)', async () => {
    state.quote = { id: 'q1', tenant_id: 't1', paid_at: '2026-07-01', needs_inspection: false }
    expect((await post({ report_doc: doc })).status).toBe(409)
  })

  it('409 on an inspection-routed quote', async () => {
    state.quote = { id: 'q1', tenant_id: 't1', paid_at: null, needs_inspection: true }
    expect((await post({ report_doc: doc })).status).toBe(409)
  })

  it('404 when the quote is missing', async () => {
    state.quote = null
    expect((await post({ report_doc: doc })).status).toBe(404)
  })
})

describe('POST /api/quote/[id]/document — body handling', () => {
  it('400 no_changes when neither field is present', async () => {
    const res = await post({})
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'no_changes' })
  })

  it('400 invalid_style for an off-list branding value', async () => {
    const res = await post({ report_style: { accentColor: '#123456' } })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'invalid_style' })
  })

  it('persists a sanitised report_doc and invalidates the PDF cache', async () => {
    const dirty = {
      version: 1,
      blocks: [
        { type: 'title', content: [{ text: 'Clean' }] },
        { type: 'image', attrs: { src: 'http://evil/x' } }, // dropped
        { type: 'paragraph', content: [{ text: 'x', marks: ['bold', 'evil'] }] }, // 'evil' dropped
      ],
    }
    const res = await post({ report_doc: dirty })
    expect(res.status).toBe(200)
    expect(captured.update).toMatchObject({ pdf_path: null, pdf_signature: null })
    expect(captured.update?.report_doc).toEqual({
      version: 1,
      blocks: [
        { type: 'title', content: [{ text: 'Clean' }] },
        { type: 'paragraph', content: [{ text: 'x', marks: ['bold'] }] },
      ],
    })
  })

  it('stores a valid report_style and allows clearing it with null', async () => {
    await post({ report_style: { fontFamily: 'serif' } })
    expect(captured.update?.report_style).toEqual({ fontFamily: 'serif' })

    await post({ report_style: null })
    expect(captured.update?.report_style).toBeNull()
  })
})
