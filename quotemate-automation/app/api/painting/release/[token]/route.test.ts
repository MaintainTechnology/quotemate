// Spec tradie-onsite-quote-editing R5 — "Send to customer" can RESEND an
// already-released painting quote (after an on-site edit) when the tradie
// explicitly asks ({ resend: true }); the default stays the idempotent
// no-op so a double-click never re-texts.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => {
  type Result = { data: unknown; error: unknown }
  type Op = { op: string; args: unknown[] }
  const results: Result[] = []
  const queries: { table: string; ops: Op[] }[] = []

  function from(table: string) {
    const record = { table, ops: [] as Op[] }
    const builder: Record<string, unknown> = {}
    for (const op of ['select', 'update', 'eq', 'maybeSingle']) {
      builder[op] = (...args: unknown[]) => {
        record.ops.push({ op, args })
        return builder
      }
    }
    builder.then = (resolve: (r: Result) => unknown, reject?: (e: unknown) => unknown) => {
      queries.push(record)
      const r = results.shift() ?? { data: null, error: null }
      return Promise.resolve(r).then(resolve, reject)
    }
    return builder
  }

  return { results, queries, client: { from } }
})

vi.mock('@supabase/supabase-js', () => ({ createClient: () => h.client }))
// The repaint pre-warm runs in after() — inline it so the test observes it.
vi.mock('next/server', () => ({ after: (fn: () => unknown) => void fn() }))
vi.mock('@/lib/painting/release', () => ({
  sendPaintingQuoteToCustomer: vi.fn(async () => ({ sent: true })),
  revertPaintingRelease: vi.fn(async () => ({ reverted: true })),
}))
// The route pre-warms the AI repaint before the send — stub it so the test
// never depends on Gemini/Maps env.
vi.mock('@/lib/painting/paint-after', () => ({
  generatePaintAfterImage: vi.fn(async () => ({ ok: false, status: 'skipped' })),
}))

import { POST } from './route'
import { revertPaintingRelease, sendPaintingQuoteToCustomer } from '@/lib/painting/release'

beforeEach(() => {
  h.results.length = 0
  h.queries.length = 0
  vi.mocked(sendPaintingQuoteToCustomer).mockReset().mockResolvedValue({ sent: true })
  vi.mocked(revertPaintingRelease).mockReset().mockResolvedValue({ reverted: true })
})

// Released AND delivered — the only state in which a plain Send is a no-op.
const releasedRow = {
  id: 'p1',
  estimate_token: 'tok-estimate-1',
  public_token: 'pub-1',
  released_at: '2026-07-01T00:00:00Z',
  quote_sent_at: '2026-07-01T00:00:05Z',
  routing: 'auto_quote',
}

function releaseReq(body?: unknown) {
  return new Request('http://localhost/api/painting/release/tok-estimate-1', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
}

const ctx = { params: Promise.resolve({ token: 'tok-estimate-1' }) }

describe('POST /api/painting/release/[token]', () => {
  it('resends an already-released quote when asked, without restamping released_at', async () => {
    h.results.push({ data: releasedRow, error: null })
    const res = await POST(releaseReq({ resend: true }), ctx)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      ok: true,
      sent: true,
      released_at: releasedRow.released_at,
    })
    expect(vi.mocked(sendPaintingQuoteToCustomer)).toHaveBeenCalledTimes(1)

    const upd = h.queries.find((q) => q.ops.some((o) => o.op === 'update'))
    expect(upd, 'released_at must not be restamped on resend').toBeUndefined()
  })

  it('stays an idempotent no-op on a released AND SENT row without the resend flag', async () => {
    h.results.push({ data: releasedRow, error: null })
    const res = await POST(releaseReq(), ctx)
    expect(res.status).toBe(200)
    // Nothing was texted on this request, so it must not claim one was.
    expect(await res.json()).toMatchObject({ ok: true, sent: false })
    expect(vi.mocked(sendPaintingQuoteToCustomer)).not.toHaveBeenCalled()
  })

  // A dashboard save releases at save time and texts nobody. Keying the no-op
  // off released_at alone made the primary button dead on first press for the
  // dominant population — it must SEND, not report "not texted".
  it('sends on the first press of a released-but-never-sent row (dashboard save)', async () => {
    h.results.push({ data: { ...releasedRow, quote_sent_at: null }, error: null })
    const res = await POST(releaseReq(), ctx)
    expect(await res.json()).toMatchObject({ ok: true, sent: true })
    expect(vi.mocked(sendPaintingQuoteToCustomer)).toHaveBeenCalledTimes(1)
    // It was already released — nothing to restamp, and nothing to revert.
    expect(h.queries.find((q) => q.ops.some((o) => o.op === 'update'))).toBeUndefined()
    expect(vi.mocked(revertPaintingRelease)).not.toHaveBeenCalled()
  })

  it('first release still stamps released_at and sends', async () => {
    h.results.push(
      { data: { ...releasedRow, released_at: null }, error: null },
      { data: null, error: null }, // update stamping released_at
    )
    const res = await POST(releaseReq(), ctx)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, sent: true })
    expect(vi.mocked(sendPaintingQuoteToCustomer)).toHaveBeenCalledTimes(1)
    const upd = h.queries.find((q) => q.ops.some((o) => o.op === 'update'))
    expect(upd, 'expected the released_at stamp update').toBeTruthy()
  })

  // ── Spec painting-auto-send R3 — no path may report a send that did not
  //    happen. The response carries the SMS outcome, not just the stamp.
  it('reports sent:false and rolls the stamp back when the first send fails', async () => {
    vi.mocked(sendPaintingQuoteToCustomer).mockResolvedValue({ sent: false })
    h.results.push(
      { data: { ...releasedRow, released_at: null }, error: null },
      { data: null, error: null }, // update stamping released_at
    )
    const res = await POST(releaseReq(), ctx)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, sent: false, released_at: null })
    expect(vi.mocked(revertPaintingRelease)).toHaveBeenCalledWith(expect.anything(), 'pub-1')
  })

  it('keeps released_at in the response when the ROLLBACK ITSELF fails', async () => {
    // supabase-js resolves { error } instead of throwing, so a failed revert is
    // easy to swallow. If the row is still released, the response must not
    // claim otherwise — the tradie would be told "held" over a live quote page.
    vi.mocked(sendPaintingQuoteToCustomer).mockResolvedValue({ sent: false })
    vi.mocked(revertPaintingRelease).mockResolvedValue({ reverted: false })
    h.results.push(
      { data: { ...releasedRow, released_at: null }, error: null },
      { data: null, error: null },
    )
    const res = await POST(releaseReq(), ctx)
    const body = await res.json()
    expect(body.sent).toBe(false)
    expect(body.released_at, 'a failed revert must not report the row as held').not.toBeNull()
  })

  it('reports sent:false on a failed RESEND without unreleasing the row', async () => {
    vi.mocked(sendPaintingQuoteToCustomer).mockResolvedValue({ sent: false })
    h.results.push({ data: releasedRow, error: null })
    const res = await POST(releaseReq({ resend: true }), ctx)
    expect(await res.json()).toMatchObject({
      ok: true,
      sent: false,
      released_at: releasedRow.released_at,
    })
    // The original send DID happen — a failed resend must not unpublish it.
    expect(vi.mocked(revertPaintingRelease)).not.toHaveBeenCalled()
  })

})
