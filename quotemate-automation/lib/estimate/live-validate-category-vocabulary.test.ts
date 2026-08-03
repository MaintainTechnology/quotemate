// The 2026-07-31 downgrade, replayed against the LIVE database.
//
// validate-category-vocabulary.test.ts proves the fix with hand-built rows.
// This proves it against the actual production data that produced the
// failure, so the test cannot pass on a fixture that flatters it. It is also
// the guard against the OTHER way this breaks: someone edits
// shared_materials.category, or adds a trade whose vocab drifts again, and
// the hand-built test keeps passing while production stops grounding.
//
// Read-only. Run with (vitest does not load .env.local itself):
//   LIVE_DB=1 node --env-file=.env.local \
//     ./node_modules/vitest/vitest.mjs run \
//     lib/estimate/live-validate-category-vocabulary.test.ts --testTimeout=120000
//
// Mirrors lib/estimate/live-material-vocabulary.test.ts.

import { describe, it, expect } from 'vitest'
import { Client } from 'pg'
import {
  validateQuoteGrounding,
  buildCandidatePrices,
  type PricingBookForValidation,
} from './validate'
import { granularToGroundingCategory } from '@/lib/catalogue/category-mapping'

const LIVE = !!process.env.LIVE_DB

async function withDb<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const c = new Client({
    connectionString: process.env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
  })
  await c.connect()
  try {
    return await fn(c)
  } finally {
    await c.end()
  }
}

/** The markup on the book that priced the failing quote. 5.00 × 1.28 = 6.40. */
const pricingBook: PricingBookForValidation = {
  hourly_rate: 110,
  apprentice_rate: 80,
  call_out_minimum: 150,
  default_markup_pct: 28,
  min_labour_hours: 2,
}

type Row = { name: string; price: number; category: string | null }

const loadElectricalMaterials = () =>
  withDb(async (c) => {
    const { rows } = await c.query(
      `select name, category, default_unit_price_ex_gst as price
         from shared_materials
        where trade = 'electrical' and default_unit_price_ex_gst is not null`,
    )
    return rows as Row[]
  })

describe.skipIf(!LIVE)('the 2026-07-31 downgrade, against live data (LIVE_DB)', () => {
  it('the row that caused it is still filed in the MATERIAL vocab', () => {
    // The precondition. If this ever fails because someone "fixed" the data
    // by renaming the column value, read the note below before celebrating.
    return withDb(async (c) => {
      const { rows } = await c.query(
        `select category, default_unit_price_ex_gst as price
           from shared_materials
          where name = 'TPS cable 2.5mm² per metre' and trade = 'electrical'`,
      )
      expect(rows.length, 'the TPS cable row has gone').toBeGreaterThan(0)
      expect(rows[0].category).toBe('sundries')
      expect(Number(rows[0].price)).toBeCloseTo(5.0, 2)
    })
  })

  it('grounds the exact line that was rejected in production', async () => {
    const materials = await loadElectricalMaterials()
    const candidates = buildCandidatePrices(materials, [], pricingBook)
    const draft = {
      needs_inspection: false,
      good: {
        label: 'Standard',
        line_items: [
          { description: 'Call-out', quantity: 1, unit: 'each', unit_price_ex_gst: 150, source: 'callout' },
          { description: 'Install labour', quantity: 2, unit: 'hr', unit_price_ex_gst: 110, source: 'labour' },
          // Verbatim from quotes dc5abcbb / c5f2dd93.
          { description: 'Cable, terminals, clips', quantity: 1, unit: 'each', unit_price_ex_gst: 6.4 },
        ],
      },
      better: null,
      best: null,
    }
    const r = validateQuoteGrounding(draft, pricingBook, candidates)
    expect(r.valid, r.valid ? '' : JSON.stringify(r.failures, null, 2)).toBe(true)
  })

  // ── The durable guard ─────────────────────────────────────────────────
  //
  // Nothing constrains any of these category columns to either vocabulary —
  // no CHECK, no FK — so a new trade or a CSV import can introduce a value
  // that silently drops on the floor again, exactly as 'sundries' did for
  // ten weeks.
  //
  // ALL FOUR sources that reach buildCandidatePrices are covered. An earlier
  // version of this guard checked only the two material tables; a review
  // caught that loadCandidatePrices (run.ts:1420-1439) also passes
  // `category` through for shared_assemblies and tenant_custom_assemblies.
  // Those use the grounding vocab TODAY — which is exactly the assumption
  // worth pinning, since nothing enforces it.
  //
  // ⚠ No `active = true` filter, deliberately, mirroring the production
  // query. loadCandidatePrices omits it on purpose (M-6, run.ts:1370:
  // deactivating a product must not retroactively invalidate a quote), so a
  // guard that filtered on it would have a blind spot the validator does
  // not — an inactive row with an unmapped category still reaches grounding.
  // Scoped to the trades whose quotes are PRICED BY OPUS and therefore run
  // through this validator. Roofing, solar, painting, aircon and signage all
  // price deterministically — no LLM in their money path — so they never
  // reach validateQuoteGrounding and have no grounding-vocab equivalent.
  //
  // This scope is load-bearing, not convenience. Running the guard unscoped
  // reports 14 roofing/aircon values (re_roof_tile, box_gutter,
  // split_install …), and the only way to "fix" that would be to invent
  // grounding categories for them in GRANULAR_TO_GROUNDING. Fabricating
  // semantics to silence a test — on the money path — is worse than the
  // gap. Every electrical and plumbing value already maps today, verified
  // against live data, which is exactly the assumption worth pinning.
  //
  // ⚠ Separately true and NOT addressed here: shared_materials and
  // shared_assemblies are loaded with no trade filter (run.ts:1321-1332),
  // so a roofing row IS in an electrical quote's candidate set and grounds
  // on its name alone. That is pre-existing, unchanged by this diff, and
  // the cross-trade guard in categoriesMatch is what stands against it.
  const GROUNDED_TRADES = ['electrical', 'plumbing'] as const

  const SOURCES = [
    'shared_materials',
    'tenant_material_catalogue',
    'shared_assemblies',
    'tenant_custom_assemblies',
  ] as const

  for (const table of SOURCES) {
    it(`every ${table}.category on a grounded trade translates`, async () => {
      const rows = await withDb(async (c) => {
        // Absent table/column on an older DB → report nothing rather than
        // fail for the wrong reason. The other three still assert.
        try {
          const { rows } = await c.query(
            `select distinct category from ${table}
              where category is not null and trade = any($1::text[])`,
            [GROUNDED_TRADES as unknown as string[]],
          )
          return rows as Array<{ category: string }>
        } catch {
          return []
        }
      })
      const unmapped = rows
        .map((r) => r.category)
        .filter((c) => granularToGroundingCategory(c) === null)
      expect(
        unmapped,
        `these ${table}.category values reach the grounding validator and are ` +
          `DROPPED, so those rows ground on their NAME alone — the exact ` +
          `failure that billed a customer $99 on 2026-07-31. Add them to ` +
          `GRANULAR_TO_GROUNDING in lib/catalogue/category-mapping.ts:\n  ` +
          unmapped.join('\n  '),
      ).toEqual([])
    })
  }
})
