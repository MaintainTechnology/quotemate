import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  EvQuoteCustomerReleaseError,
  persistGenericQuoteRelease,
} from './customer-release'

function clientWith(rows: Record<string, Record<string, unknown>[]>) {
  const rpc = vi.fn(async () => ({
    data: { approved: true, outbound: null, outbox_id: null }, error: null,
  }))
  const from = vi.fn((table: string) => {
    const result = { data: rows[table] ?? [], error: null }
    const query: Record<string, unknown> = {}
    query.select = vi.fn(() => query)
    query.eq = vi.fn(() => query)
    query.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve)
    return query
  })
  return { client: { from, rpc } as unknown as SupabaseClient, rpc }
}

const pricingBook = {
  hourly_rate: 100,
  apprentice_rate: 60,
  call_out_minimum: 100,
  default_markup_pct: 0,
}
const baseQuote = {
  id: '11111111-1111-4111-8111-111111111111',
  quote_kind: 'initial',
  // Historical resends retain the legacy price contract, but must still pass
  // every EV scope/presentation gate. New initial quotes need Quote Core proof.
  customer_released_at: '2026-09-01T00:00:00Z',
  risk_flags: [],
}
const unit = {
  description: 'EV charger unit', source: 'material:unit-1', quantity: 1,
  unit: 'each', unit_price_ex_gst: 800, total_ex_gst: 800,
}
const install = {
  description: 'Install EV charger', source: 'assembly:install-1', quantity: 1,
  unit: 'each', unit_price_ex_gst: 400, total_ex_gst: 400,
}
const labour = {
  description: 'Licensed electrician labour', source: 'labour', quantity: 2,
  unit: 'hr', unit_price_ex_gst: 100, total_ex_gst: 200,
}
const catalogue = {
  shared_materials: [{ id: 'unit-1', trade: 'electrical', category: 'ev_charger', name: 'EV charger unit', default_unit_price_ex_gst: 800 }],
  shared_assemblies: [{ id: 'install-1', trade: 'electrical', category: 'ev_charger', name: 'Install EV charger', default_unit_price_ex_gst: 400 }],
}
const scopeForMode = (mode?: string) => mode === 'supply_only'
  ? 'EV charger supply only. Installation and all electrical work are excluded.'
  : mode === 'install_only'
    ? 'Install the customer-supplied EV charger.'
    : mode === 'supply_and_install'
      ? 'Supply and install the selected EV charger.'
      : undefined
const input = (quote: Record<string, unknown>, mode?: string) => ({
  quote: quote.scope_of_works === undefined && scopeForMode(mode)
    ? { ...quote, scope_of_works: scopeForMode(mode) }
    : quote,
  tenantId: '22222222-2222-4222-8222-222222222222',
  ownerId: 'owner',
  holdUntil: null,
  intake: {
    job_type: 'ev_charger', trade: 'electrical',
    scope: {
      specs: { ...(mode ? { service_mode: mode } : {}) },
      ...(mode === 'supply_only' || mode === 'supply_and_install'
        ? { chosen_product: { catalogue_id: 'unit-1' } }
        : {}),
    },
  },
  pricingBook,
})

describe('EV service-mode gate for historical resends and manual final quotes', () => {
  it('blocks an inconsistent supply-only quote before the atomic release RPC', async () => {
    const { client, rpc } = clientWith(catalogue)
    const quote = {
      ...baseQuote,
      good: { line_items: [unit, install, labour], subtotal_ex_gst: 1400 },
    }
    await expect(persistGenericQuoteRelease(client, input(quote, 'supply_only')))
      .rejects.toBeInstanceOf(EvQuoteCustomerReleaseError)
    expect(rpc).not.toHaveBeenCalled()
  })

  it.each([
    ['needs_inspection', { needs_inspection: true }],
    ['routing_decision', { routing_decision: 'inspection_required' }],
    ['selected_tier', { selected_tier: 'inspection' }],
    ['inspection_reason', { inspection_reason: 'Confirm on site' }],
    ['inspection_link', { stripe_links: { inspection: 'https://pay.test/inspection' } }],
  ])('blocks supply-only when %s still routes to a site visit', async (_name, routeState) => {
    const { client, rpc } = clientWith(catalogue)
    const quote = {
      ...baseQuote, ...routeState,
      good: { line_items: [unit], subtotal_ex_gst: 800 },
    }
    await expect(persistGenericQuoteRelease(client, input(quote, 'supply_only')))
      .rejects.toMatchObject({
        failures: expect.arrayContaining([
          expect.objectContaining({ code: 'supply_only_inspection_route' }),
        ]),
      })
    expect(rpc).not.toHaveBeenCalled()
  })

  it.each([
    ['supply_only', [unit], 'Supply and install the EV charger on a dedicated circuit.'],
    ['install_only', [install, labour], 'Supply and install our EV charger.'],
    ['supply_and_install', [unit, install, labour], 'Install the charger. Charger unit supply is excluded and priced separately.'],
  ] as const)('blocks %s when the saved customer scope contradicts the mode', async (mode, lines, scope) => {
    const { client, rpc } = clientWith(catalogue)
    await expect(persistGenericQuoteRelease(client, input({
      ...baseQuote, scope_of_works: scope,
      good: { line_items: [...lines], subtotal_ex_gst: [...lines].reduce<number>((sum, line) => sum + line.total_ex_gst, 0) },
    }, mode))).rejects.toMatchObject({
      failures: expect.arrayContaining([
        expect.objectContaining({ code: 'service_mode_scope_conflict' }),
      ]),
    })
    expect(rpc).not.toHaveBeenCalled()
  })

  it.each([
    'Supply only. We provide the selected EV charger.',
    'Supply only. Installation and all electrical work, testing and certification are excluded.',
  ])('requires complete certification-free supply-only exclusion wording: %s', async (scope) => {
    const { client, rpc } = clientWith(catalogue)
    await expect(persistGenericQuoteRelease(client, input({
      ...baseQuote, scope_of_works: scope,
      good: { line_items: [unit], subtotal_ex_gst: 800 },
    }, 'supply_only'))).rejects.toMatchObject({
      failures: expect.arrayContaining([
        expect.objectContaining({ code: 'service_mode_scope_conflict' }),
      ]),
    })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('blocks missing mode and a supply catalogue gap without creating a $99 inspection release', async () => {
    const missingMode = clientWith(catalogue)
    await expect(persistGenericQuoteRelease(missingMode.client, input({
      ...baseQuote, good: { line_items: [unit], subtotal_ex_gst: 800 },
    }))).rejects.toMatchObject({ code: 'ev_service_mode_review_required' })
    expect(missingMode.rpc).not.toHaveBeenCalled()

    const missingProduct = clientWith({ shared_assemblies: catalogue.shared_assemblies })
    await expect(persistGenericQuoteRelease(missingProduct.client, input({
      ...baseQuote, good: { line_items: [unit], subtotal_ex_gst: 800 },
    }, 'supply_only'))).rejects.toMatchObject({ code: 'ev_service_mode_review_required' })
    expect(missingProduct.rpc).not.toHaveBeenCalled()
  })

  it('blocks supply-bearing modes when no selected product anchors the priced unit', async () => {
    const { client, rpc } = clientWith(catalogue)
    const request = input({
      ...baseQuote, good: { line_items: [unit], subtotal_ex_gst: 800 },
    }, 'supply_only')
    request.intake.scope = { specs: { service_mode: 'supply_only' } }
    await expect(persistGenericQuoteRelease(client, request)).rejects.toMatchObject({
      code: 'ev_service_mode_review_required',
      failures: expect.arrayContaining([expect.objectContaining({ code: 'missing_chosen_product' })]),
    })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('blocks a second present tier whose empty breakdown would otherwise be ignored', async () => {
    const { client, rpc } = clientWith(catalogue)
    await expect(persistGenericQuoteRelease(client, input({
      ...baseQuote,
      good: { line_items: [unit], subtotal_ex_gst: 800 },
      better: { line_items: [], subtotal_ex_gst: 250 },
    }, 'supply_only'))).rejects.toMatchObject({
      failures: expect.arrayContaining([
        expect.objectContaining({ code: 'supply_only_tier_presentation_conflict', tier: 'better' }),
      ]),
    })
    expect(rpc).not.toHaveBeenCalled()
  })

  it.each([
    { description: 'Install EV charger', source: 'tradie_manual', quantity: 1, unit: 'each', unit_price_ex_gst: 100, total_ex_gst: 100 },
    { description: 'Call-out fee', source: 'callout', quantity: 1, unit: 'each', unit_price_ex_gst: 100, total_ex_gst: 100 },
    { description: 'Electrical sundries', source: 'sundry', quantity: 1, unit: 'each', unit_price_ex_gst: 100, total_ex_gst: 100 },
  ])('blocks a supply-only row the public/PDF presentation boundary would reject: %j', async (unsafeLine) => {
    const { client, rpc } = clientWith(catalogue)
    await expect(persistGenericQuoteRelease(client, input({
      ...baseQuote,
      good: { line_items: [unit, unsafeLine], subtotal_ex_gst: 900 },
    }, 'supply_only'))).rejects.toMatchObject({
      failures: expect.arrayContaining([
        expect.objectContaining({ code: 'supply_only_tier_presentation_conflict' }),
      ]),
    })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('allows each structurally and catalogue-consistent explicit mode', async () => {
    for (const [mode, lines] of [
      ['supply_only', [unit]],
      ['install_only', [install, labour]],
      ['supply_and_install', [unit, install, labour]],
    ] as const) {
      const { client, rpc } = clientWith(catalogue)
      const quote = {
        ...baseQuote,
        good: {
          line_items: [...lines],
          subtotal_ex_gst: Array.from(lines).reduce(
            (sum, line) => sum + Number(line.total_ex_gst),
            0,
          ),
        },
      }
      await expect(persistGenericQuoteRelease(client, input(quote, mode))).resolves.toEqual({
        outbound: null, outboxId: null,
      })
      expect(rpc).toHaveBeenCalledOnce()
    }
  })

  it('leaves non-EV and tier-less balance release behavior unchanged', async () => {
    const generic = clientWith({})
    await expect(persistGenericQuoteRelease(generic.client, {
      ...input(baseQuote), intake: { job_type: 'power_points', trade: 'electrical', scope: null },
    })).resolves.toBeDefined()
    expect(generic.rpc).toHaveBeenCalledOnce()

    const balance = clientWith({})
    await expect(persistGenericQuoteRelease(balance.client, {
      ...input({ ...baseQuote, quote_kind: 'balance' }),
      intake: { job_type: 'ev_charger', trade: 'electrical', scope: { specs: {} } },
    })).resolves.toBeDefined()
    expect(balance.rpc).toHaveBeenCalledOnce()
  })

  it('enforces the EV service-mode contract on final customer quotes', async () => {
    const missingMode = clientWith(catalogue)
    await expect(persistGenericQuoteRelease(missingMode.client, {
      ...input({
        ...baseQuote, quote_kind: 'final',
        good: { line_items: [unit], subtotal_ex_gst: 800 },
      }),
      intake: { job_type: 'ev_charger', trade: 'electrical', scope: { specs: {} } },
    })).rejects.toMatchObject({
      failures: expect.arrayContaining([expect.objectContaining({ code: 'missing_service_mode' })]),
    })
    expect(missingMode.rpc).not.toHaveBeenCalled()

    const contradictory = clientWith(catalogue)
    await expect(persistGenericQuoteRelease(contradictory.client, input({
      ...baseQuote, quote_kind: 'final',
      good: { line_items: [unit, install], subtotal_ex_gst: 1200 },
    }, 'supply_only'))).rejects.toMatchObject({
      failures: expect.arrayContaining([expect.objectContaining({ code: 'supply_only_tier_presentation_conflict', tier: 'good' })]),
    })
    expect(contradictory.rpc).not.toHaveBeenCalled()

    const valid = clientWith(catalogue)
    await expect(persistGenericQuoteRelease(valid.client, input({
      ...baseQuote, quote_kind: 'final',
      good: { line_items: [unit], subtotal_ex_gst: 800 },
    }, 'supply_only'))).resolves.toBeDefined()
    expect(valid.rpc).toHaveBeenCalledOnce()
  })
})
