import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { generatePaintAfterImage } from './paint-after'

afterEach(() => vi.restoreAllMocks())

type FakeRow = {
  id: string
  address: string | null
  postcode: string | null
  state: string | null
  scopes: string[] | null
  preview_status: string | null
  preview_image_path: string | null
}

/**
 * Purpose-built fake for the two supabase call shapes paint-after uses:
 *   read:   from().select().eq().maybeSingle()
 *   CAS:    from().update().eq().or().select().maybeSingle()
 *   update: await from().update().eq()            (thenable chain)
 *   upload: storage.from().upload()
 */
function fakeClient(opts: { row: FakeRow | null; claim: { id: string } | null }) {
  const updates: Array<Record<string, unknown>> = []
  const uploads: Array<{ path: string; contentType: string | undefined }> = []
  const updateChain = (vals: Record<string, unknown>) => {
    updates.push(vals)
    const chain: Record<string, unknown> = {}
    chain.eq = () => chain
    chain.or = () => chain
    chain.select = () => chain
    chain.maybeSingle = async () => ({ data: opts.claim, error: null })
    chain.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data: null, error: null }).then(resolve)
    return chain
  }
  const client = {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: opts.row, error: null }) }),
      }),
      update: updateChain,
    }),
    storage: {
      from: () => ({
        upload: async (path: string, _bytes: unknown, o?: { contentType?: string }) => {
          uploads.push({ path, contentType: o?.contentType })
          return { error: null }
        },
      }),
    },
  } as unknown as SupabaseClient
  return { client, updates, uploads }
}

const ROW: FakeRow = {
  id: 'row-1',
  address: '21 Greens Rd, Coorparoo',
  postcode: '4151',
  state: 'QLD',
  scopes: ['walls', 'exterior'],
  preview_status: null,
  preview_image_path: null,
}

const png = { base64: Buffer.from('img').toString('base64'), mime: 'image/png' }

describe('generatePaintAfterImage', () => {
  it('skips (no render, no claim) when the job has no exterior scope', async () => {
    // An interior-only repaint preview would show the customer an exterior
    // recolour the quote does not include — and bill a Gemini render for it.
    const { client, updates } = fakeClient({
      row: { ...ROW, scopes: ['walls', 'ceilings'] },
      claim: { id: ROW.id },
    })
    const render = vi.fn()
    const res = await generatePaintAfterImage('tok', {
      client,
      fetchSource: vi.fn(async () => png),
      render,
    })
    expect(res).toEqual({ ok: false, status: 'skipped', error: 'interior_only' })
    expect(render).not.toHaveBeenCalled()
    expect(updates).toHaveLength(0)
  })

  it('short-circuits to the stored path when the preview is already ready', async () => {
    const { client, updates } = fakeClient({
      row: { ...ROW, preview_status: 'ready', preview_image_path: 'painting/row-1/after-1.png' },
      claim: null,
    })
    const render = vi.fn()
    const res = await generatePaintAfterImage('tok', {
      client,
      fetchSource: vi.fn(async () => png),
      render,
    })
    expect(res).toEqual({ ok: true, path: 'painting/row-1/after-1.png' })
    expect(render).not.toHaveBeenCalled()
    expect(updates).toHaveLength(0)
  })

  it('reports busy without rendering when another request holds the CAS claim', async () => {
    const { client } = fakeClient({ row: ROW, claim: null })
    const render = vi.fn()
    const res = await generatePaintAfterImage('tok', {
      client,
      fetchSource: vi.fn(async () => png),
      render,
    })
    expect(res).toEqual({ ok: false, status: 'busy' })
    expect(render).not.toHaveBeenCalled()
  })

  it('renders, uploads under painting/<id>/, and marks the row ready', async () => {
    const { client, updates, uploads } = fakeClient({ row: ROW, claim: { id: ROW.id } })
    const res = await generatePaintAfterImage('tok', {
      client,
      fetchSource: vi.fn(async () => png),
      render: vi.fn(async () => png),
    })
    expect(res.ok).toBe(true)
    expect(uploads).toHaveLength(1)
    expect(uploads[0].path).toMatch(/^painting\/row-1\/after-\d+\.png$/)
    expect(uploads[0].contentType).toBe('image/png')
    const final = updates.at(-1)!
    expect(final.preview_status).toBe('ready')
    expect(final.preview_image_path).toBe(uploads[0].path)
  })

  it('marks the row failed when generation throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { client, updates } = fakeClient({ row: ROW, claim: { id: ROW.id } })
    const res = await generatePaintAfterImage('tok', {
      client,
      fetchSource: vi.fn(async () => png),
      render: vi.fn(async () => {
        throw new Error('gemini down')
      }),
    })
    expect(res).toEqual({ ok: false, status: 'failed', error: 'gemini down' })
    expect(updates.at(-1)).toEqual({ preview_status: 'failed' })
  })
})
