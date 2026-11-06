// The takeoff pages' API helper and labels (TKO-19): the tradie's token on
// every call, the service's refusals in words, and chips that always carry one.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { CHECK_NAMES, checkChip, isPreliminary, reviewLine, statusChip, TakeoffError, takeoffApi, takeoffDownload } from './takeoff-api'

vi.mock('@/lib/auth/client-token', () => ({ getAuthToken: vi.fn(async () => 'tradie-token') }))

const answer = (status: number, body?: unknown) =>
  vi.fn(async () => new Response(body === undefined ? null : JSON.stringify(body), { status }))

describe('takeoffApi', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('calls the service as the tradie, with a JSON body', async () => {
    const fetch = answer(201, { run_id: 'run-1' })
    vi.stubGlobal('fetch', fetch)
    expect(await takeoffApi('/api/takeoff/runs', { method: 'POST', body: { site_address: '59 Grange Rd' } })).toEqual({ run_id: 'run-1' })
    expect(fetch).toHaveBeenCalledWith('/api/takeoff/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer tradie-token' },
      body: '{"site_address":"59 Grange Rd"}',
    })
  })

  it('throws a refusal with the service\'s detail in words', async () => {
    vi.stubGlobal('fetch', answer(409, { ok: false, error: 'run_not_ready', detail: { message: 'A run under review saves only with accept_review: true', status: 'needs_review' } }))
    const refused = await takeoffApi('/api/takeoff/runs/run-1/save', { method: 'POST', body: {} }).catch((error: unknown) => error)
    expect(refused).toBeInstanceOf(TakeoffError)
    expect(refused).toMatchObject({ status: 409, code: 'run_not_ready', message: 'A run under review saves only with accept_review: true' })

    vi.stubGlobal('fetch', answer(404, { ok: false, error: 'not_found', detail: 'No such run' }))
    await expect(takeoffApi('/api/takeoff/runs/run-2')).rejects.toMatchObject({ code: 'not_found', message: 'No such run' })
  })

  it('says takeoffs aren\'t on the account when the service won\'t admit the tenant', async () => {
    // The service answers every caller it won't admit with the same 401: a
    // tenant off the pilot allowlist, without roofing, or signed in elsewhere.
    vi.stubGlobal('fetch', answer(401, { ok: false, error: 'unauthorized', detail: 'Unauthorized' }))
    await expect(takeoffApi('/api/takeoff/runs?limit=50')).rejects.toMatchObject({
      status: 401,
      code: 'unauthorized',
      message: 'Plan takeoffs aren’t switched on for this account yet. Ask QuoteMax to turn them on.',
    })
  })

  it('answers nothing for a 204', async () => {
    vi.stubGlobal('fetch', answer(204))
    expect(await takeoffApi('/api/takeoff/runs/run-1', { method: 'DELETE' })).toBeUndefined()
  })
})

describe('takeoffDownload (TKO-18)', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('fetches a file of the pack as the tradie', async () => {
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04])
    const fetch = vi.fn(async () => new Response(zip, { status: 200, headers: { 'content-type': 'application/zip' } }))
    vi.stubGlobal('fetch', fetch)
    const blob = await takeoffDownload('/api/takeoff/runs/run-1/export?accept_review=true')
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(zip)
    expect(fetch).toHaveBeenCalledWith('/api/takeoff/runs/run-1/export?accept_review=true', { headers: { authorization: 'Bearer tradie-token' } })
  })

  it('throws the service\'s refusal in words, as every call does', async () => {
    vi.stubGlobal('fetch', answer(503, { ok: false, error: 'pdf_unavailable', detail: 'The roof brief\'s PDF couldn\'t be made; try again shortly' }))
    await expect(takeoffDownload('/api/takeoff/runs/run-1/export')).rejects.toMatchObject({
      status: 503,
      code: 'pdf_unavailable',
      message: 'The roof brief\'s PDF couldn\'t be made; try again shortly',
    })
    vi.stubGlobal('fetch', answer(401, { ok: false, error: 'unauthorized', detail: 'Unauthorized' }))
    await expect(takeoffDownload('/api/takeoff/runs/run-1/export')).rejects.toMatchObject({ status: 401, message: expect.stringMatching(/switched on for this account/) })
  })
})

describe('chips and lines', () => {
  it('names every check the service runs, the aerial one included', () => {
    expect(Object.keys(CHECK_NAMES)).toEqual(['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9', 'C10'])
    expect(CHECK_NAMES.C10).toBe('Aerial agrees')
  })

  it('pairs each status and result with a word and an icon', () => {
    expect([statusChip('extracting'), statusChip('needs_review'), statusChip('saved')].map((chip) => chip.words)).toEqual(['Reading plans', 'Needs review', 'Saved'])
    expect(statusChip('on_hold')).toMatchObject({ words: 'on hold', tone: 'neutral' })
    expect([checkChip('pass'), checkChip('fail'), checkChip('skipped')].map((chip) => [chip.icon, chip.words])).toEqual([['✓', 'Pass'], ['×', 'Fail'], ['–', 'Skipped']])
  })

  it('knows a preliminary sheet and counts the checks to look at', () => {
    expect(isPreliminary('PRELIMINARY 21.04.26 -NOT FOR CONSTRUCTION- FOR REFERENCE ONLY')).toBe(true)
    expect([isPreliminary('CONSTRUCTION ISSUE'), isPreliminary(null)]).toEqual([false, false])
    expect([reviewLine(1), reviewLine(2)]).toEqual([
      '1 check needs a look before this goes to the supplier.',
      '2 checks need a look before this goes to the supplier.',
    ])
  })
})
