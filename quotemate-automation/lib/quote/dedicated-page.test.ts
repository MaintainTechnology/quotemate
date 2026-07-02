// Unit tests for the dedicated-page resolvers that route a generic /q/[token]
// quotes row to its trade's measurement-rich customer page.

import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  resolveSolarPagePath,
  resolveCommercialPaintTenderPath,
} from './dedicated-page'

type Result = { data: unknown; error: { message: string } | null }

/** Fake client keyed by table. Each table handler resolves the terminal call
 *  (.maybeSingle() or .limit()) with its canned result. */
function fakeClient(tables: Record<string, Result>): SupabaseClient {
  return {
    from: (table: string) => {
      const result = tables[table] ?? { data: null, error: { message: `no stub for ${table}` } }
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: () => Promise.resolve(result),
        limit: () => Promise.resolve(result),
      }
      return chain
    },
  } as unknown as SupabaseClient
}

describe('resolveSolarPagePath', () => {
  it('returns the dedicated solar path when a renderable estimate is token-twinned', async () => {
    const client = fakeClient({
      solar_estimates: { data: { public_token: 'tok123', estimate: { sizing: {} } }, error: null },
    })
    expect(await resolveSolarPagePath(client, 'tok123')).toBe('/q/solar/tok123')
  })

  it('returns null when the estimate jsonb is null (dedicated page would 404)', async () => {
    const client = fakeClient({
      solar_estimates: { data: { public_token: 'tok123', estimate: null }, error: null },
    })
    expect(await resolveSolarPagePath(client, 'tok123')).toBeNull()
  })

  it('returns null when no row matches or the read errors', async () => {
    expect(
      await resolveSolarPagePath(fakeClient({ solar_estimates: { data: null, error: null } }), 't'),
    ).toBeNull()
    expect(
      await resolveSolarPagePath(
        fakeClient({ solar_estimates: { data: null, error: { message: 'boom' } } }),
        't',
      ),
    ).toBeNull()
  })
})

describe('resolveCommercialPaintTenderPath', () => {
  it('resolves the tender page through the saved_quote backlink', async () => {
    const client = fakeClient({
      plan_extractions: { data: [{ paint_run_id: 'run-1' }], error: null },
      paint_runs: { data: { public_token: 'runtok' }, error: null },
    })
    expect(await resolveCommercialPaintTenderPath(client, 'quote-1')).toBe(
      '/q/commercial-paint/runtok',
    )
  })

  it('returns null when the run has no public token (pre-migration-143 save)', async () => {
    const client = fakeClient({
      plan_extractions: { data: [{ paint_run_id: 'run-1' }], error: null },
      paint_runs: { data: { public_token: null }, error: null },
    })
    expect(await resolveCommercialPaintTenderPath(client, 'quote-1')).toBeNull()
  })

  it('returns null when no extraction carries the backlink', async () => {
    const client = fakeClient({
      plan_extractions: { data: [], error: null },
    })
    expect(await resolveCommercialPaintTenderPath(client, 'quote-1')).toBeNull()
  })

  it('returns null on a read error rather than throwing into the page', async () => {
    const client = fakeClient({
      plan_extractions: { data: null, error: { message: 'boom' } },
    })
    expect(await resolveCommercialPaintTenderPath(client, 'quote-1')).toBeNull()
  })
})
