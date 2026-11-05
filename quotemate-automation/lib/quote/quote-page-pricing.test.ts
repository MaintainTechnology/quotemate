import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const rows: Record<string, Record<string, unknown> | null> = {}
  const errors: Record<string, unknown> = {}
  const reads: Array<{ table: string; fields: string; filters: Record<string, unknown> }> = []
  const client = { rpc: async () => ({ data: 18, error: null }), from: (table: string) => {
    const read = { table, fields: '', filters: {} as Record<string, unknown> }; reads.push(read)
    const q = {
      select: (fields: string) => { read.fields = fields; return q },
      eq: (k: string, v: unknown) => { read.filters[k] = v; return q },
      in: () => q, not: () => q, is: () => q, order: () => q, limit: () => q,
      maybeSingle: async () => {
        const data = rows[table] ?? null
        return { data: data && read.fields !== '*' ? Object.fromEntries(read.fields.split(',').map(key => [key.trim(), data[key.trim()]])) : data,
          error: errors[read.fields.startsWith('early_bird_discount_pct') ? 'early_bird' : table] ?? null }
      },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve),
    }; return q
  } }
  return { rows, errors, reads, client }
})
vi.mock('@supabase/supabase-js', () => ({ createClient: () => h.client }))
vi.mock('next/server', () => ({ after: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => '/q/saved-token', notFound: () => { throw Error('404') }, redirect: (path: string) => { throw Error(`redirect:${path}`) } }))
vi.mock('@/lib/quote/page-owner', () => ({ isQuotePageOwner: async () => true }))
vi.mock('@/lib/ig-engine/generate', () => ({ generatePreviewImage: vi.fn() }))
vi.mock('@/lib/ig-engine/samples', () => ({ generateSampleImages: vi.fn() }))
vi.mock('@/lib/storage/upload', () => ({ refreshSignedUrl: vi.fn(async () => null) }))
vi.mock('@/app/q/[token]/TradieEditor', () => ({ default: () => null }))
vi.mock('@/app/dashboard/quote/[token]/QuoteReportViewerClient', () => ({ default: () => null }))
vi.mock('@/lib/quote/send-customer', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/quote/send-customer')>(),
  resolveCustomerContact: async () => ({ phone: null, email: null }),
}))

import DashboardQuoteViewerPage from '@/app/dashboard/quote/[token]/page'
import PublicQuotePage from '@/app/q/[token]/page'
import { QuotePricingReview } from '@/app/q/_chrome/QuotePricingReview'
import { QuoteUnavailable } from '@/app/q/_chrome/QuoteUnavailable'
import { TradeTiers } from '@/app/q/[token]/TradeTiers'
import { evIncidentTier, evIncidentScope, evIncidentAssumptions, evIncidentUpsells } from '@/tests/fixtures/ev-charger-est0018'
const params = () => ({ params: Promise.resolve({ token: 'saved-token' }) })
function textOf(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (Array.isArray(value)) return value.map(textOf).join(' ')
  if (value && typeof value === 'object' && 'props' in value) return textOf((value as { props: { children?: unknown } }).props.children)
  return ''
}
beforeEach(() => {
  vi.stubGlobal('React', React)
  h.reads.length = 0
  for (const key of Object.keys(h.rows)) delete h.rows[key]
  for (const key of Object.keys(h.errors)) delete h.errors[key]
  h.rows.quotes = { id: 'quote-id', tenant_id: 'tenant-id', intake_id: 'intake-id', share_token: 'saved-token',
    quote_kind: 'initial', parent_quote_id: null, good: null, best: null,
    better: { label: 'Saved work', subtotal_ex_gst: 100.05, line_items: [
      { description: 'Owned item', quantity: 1, unit: 'each', unit_price_ex_gst: 100.05, total_ex_gst: 100.05 },
    ] }, total_inc_gst: 100.05, selected_tier: 'better', pricing_book_version_id: 'version-id',
    needs_inspection: false, status: 'sent', paid_at: null, deposit_pct: 30,
    created_at: '2026-09-08T00:00:00Z', scope_of_works: 'Customer scope only', risk_flags: ['PRIVATE SAFETY FLAG'],
    assumptions: [], stripe_links: {}, report_doc: null, optional_upsells: [], applied_discount_pct: 0 }
  h.rows.intakes = { id: 'intake-id', tenant_id: 'tenant-id', trade: 'electrical', job_type: 'power_points',
    caller: { name: 'Sam' }, scope: {}, photo_paths: [] }
  h.rows.quote_pricing_versions = { id: 'version-id', tenant_id: 'tenant-id', trade: 'electrical', pricing_book_id: 'book-id',
    content_hash: 'a'.repeat(64), snapshot: { id: 'book-id', tenant_id: 'tenant-id', trade: 'electrical', gst_registered: false, quote_tier_mode: 'single' } }
  h.rows.pricing_book = { gst_registered: true, quote_tier_mode: 'good_better_best' }
})

describe('actual dashboard saved price reader', () => {
  it('passes saved non-GST evidence to the editor even after current GST changes', async () => {
    const view = await DashboardQuoteViewerPage(params())
    expect(view.props.gstRegistered).toBe(false)
    expect(h.reads.find(r => r.table === 'intakes')?.filters).toEqual({ id: 'intake-id', tenant_id: 'tenant-id' })
    h.rows.pricing_book = null
    expect((await DashboardQuoteViewerPage(params())).props.gstRegistered).toBe(false)
  })
  it('shows an explicit review state for unavailable historical evidence', async () => {
    h.rows.quote_pricing_versions = null
    expect(textOf(await DashboardQuoteViewerPage(params()))).toContain('pricing needs review')
  })
  it('keeps inspection chain actions available without inventing an editor tax value', async () => {
    Object.assign(h.rows.quotes!, { needs_inspection: true, paid_at: '2026-09-08', paid_tier: 'inspection', better: null, total_inc_gst: 99 })
    const view = await DashboardQuoteViewerPage(params())
    expect(view.props.gstRegistered).toBeNull()
    expect(view.props.chainAction).toBe('issue-final')
    expect(view.props.docEditorEnabled).toBe(false)
  })
  it.each(['quotes', 'intakes', 'quote_pricing_versions'])('keeps %s failure retryable', async table => {
    h.errors[table] = { code: 'XX000' }
    expect(textOf(await DashboardQuoteViewerPage(params()))).toContain('temporarily unavailable')
  })
})
describe('actual public quote saved price reader', () => {
  it.each([true, false])('recognises a manual charger unit only with stored edit provenance: %s', async (authorised) => {
    Object.assign(h.rows.intakes!, { job_type: 'ev_charger', scope: { specs: { service_mode: 'supply_and_install', supplied_by: 'tradie' } } })
    Object.assign(h.rows.quotes!, {
      better: { label: 'EV estimate', subtotal_ex_gst: 1200, line_items: [
        { description: 'EV charger unit', source: 'tradie_manual', quantity: 1, unit: 'each', unit_price_ex_gst: 1000, total_ex_gst: 1000 },
        { description: 'Installation labour', source: 'labour', quantity: 2, unit: 'hr', unit_price_ex_gst: 100, total_ex_gst: 200 },
      ] }, total_inc_gst: 1200, scope_of_works: 'Supply and install an EV charger. Charger unit supply excluded.',
      risk_flags: authorised ? ['tradie_manual_line:better#0'] : [],
    })
    const html = renderToStaticMarkup(await PublicQuotePage(params()))
    expect(html.includes('Supply and installation estimate')).toBe(authorised)
    expect(html.includes('Charger unit supply and its cost')).toBe(!authorised)
    expect(html.includes('tradie_manual_line:')).toBe(false)
    expect(html.includes('1,200')).toBe(true)
  })
  it('reconciles the stored EV incident without presenting installation charges as charger supply', async () => {
    Object.assign(h.rows.intakes!, { job_type: 'ev_charger', scope: { specs: { service_mode: 'supply_and_install', supplied_by: 'tradie' } } })
    Object.assign(h.rows.quotes!, {
      better: evIncidentTier, scope_of_works: evIncidentScope, assumptions: evIncidentAssumptions,
      optional_upsells: evIncidentUpsells, total_inc_gst: 881.1,
      risk_flags: ['Switchboard capacity needs verification.', '[upsell-guard] ungrounded_lines_stripped: Add RCBO safety switch'],
    })
    Object.assign(h.rows.quote_pricing_versions!.snapshot as object, { gst_registered: true })
    const html = renderToStaticMarkup(await PublicQuotePage(params()))
    expect(html.includes('Installation estimate (charger unit excluded)')).toBe(true)
    expect(html.includes('Charger unit supply and its cost')).toBe(true)
    expect(html.includes('Supply and install a 7kW')).toBe(false)
    expect(html.includes('Items supplied')).toBe(false)
    expect(html.includes('upsell-guard')).toBe(false)
    expect(html.includes('Switchboard capacity needs verification.')).toBe(true)
    expect(html.includes('Add RCBO safety switch')).toBe(false)
    expect(html.includes('881.10')).toBe(true)
    const optionalStart = html.indexOf('Optional upgrades')
    const optionalEnd = html.indexOf('Good to know', optionalStart)
    expect(optionalStart).toBeGreaterThan(0)
    expect(optionalEnd).toBeGreaterThan(optionalStart)
    const optional = html.slice(optionalStart, optionalEnd)
    expect(optional.includes('Switchboard health check')).toBe(false)
    expect(evIncidentTier.subtotal_ex_gst).toBe(801)
  })
  it('renders a structurally clean supply-only product tier without stale installation, labour, certification or $99 content', async () => {
    Object.assign(h.rows.intakes!, {
      job_type: 'ev_charger',
      scope: { specs: { service_mode: 'supply_only', supplied_by: 'tradie' } },
    })
    Object.assign(h.rows.quotes!, {
      better: {
        label: 'Supply and install EV charger', subtotal_ex_gst: 800,
        line_items: [{
          description: 'EV charger unit', source: 'tradie_manual', quantity: 1,
          unit: 'each', unit_price_ex_gst: 800, total_ex_gst: 800,
        }],
      },
      total_inc_gst: 800,
      scope_of_works: 'Supply and install the charger, including testing and certification.',
      assumptions: ['Four hours on-site installation labour.'],
      risk_flags: ['tradie_manual_line:better#0'],
    })

    const html = renderToStaticMarkup(await PublicQuotePage(params()))
    expect(html).toContain('EV charger supply only')
    expect(html).toContain('EV charger unit')
    expect(html).toContain('Installation and all electrical work are excluded')
    expect(html).not.toContain('Supply and install EV charger')
    expect(html).not.toContain('testing and certification')
    expect(html).not.toContain('Four hours on-site installation labour')
    expect(html).not.toContain('$99')
    expect(html).not.toContain('Pay $99')
  })

  it('fails closed instead of hiding priced installation rows from a supply-only total', async () => {
    Object.assign(h.rows.intakes!, {
      job_type: 'ev_charger',
      scope: { specs: { service_mode: 'supply_only', supplied_by: 'tradie' } },
    })
    Object.assign(h.rows.quotes!, {
      better: {
        label: 'Supply and install', subtotal_ex_gst: 1000,
        line_items: [
          { description: 'EV charger unit', source: 'tradie_manual', quantity: 1, unit: 'each', unit_price_ex_gst: 800, total_ex_gst: 800 },
          { description: 'Installation labour', source: 'labour', quantity: 2, unit: 'hr', unit_price_ex_gst: 100, total_ex_gst: 200 },
        ],
      },
      total_inc_gst: 1000,
      scope_of_works: 'Supply and install the charger, including certification.',
      risk_flags: ['tradie_manual_line:better#0'],
    })

    const view = await PublicQuotePage(params())
    expect(view.type).toBe(QuotePricingReview)
    expect(view.props).toEqual({
      scope: 'EV charger supply only. Installation and all electrical work are excluded.',
    })
    expect(JSON.stringify(view)).not.toContain('Installation labour')
    expect(JSON.stringify(view)).not.toContain('certification')
  })

  it.each([
    ['inspection state', () => { h.rows.quotes!.needs_inspection = true }],
    ['missing pricing evidence', () => { h.rows.quote_pricing_versions = null }],
  ])('keeps supply-only %s in a safe review view with no inspection route', async (_name, arrange) => {
    Object.assign(h.rows.intakes!, {
      job_type: 'ev_charger',
      scope: { specs: { service_mode: 'supply_only', supplied_by: 'tradie' } },
    })
    Object.assign(h.rows.quotes!, {
      better: { label: 'Charger supplied', subtotal_ex_gst: 800, line_items: [{
        description: 'EV charger unit', source: 'tradie_manual', quantity: 1,
        unit: 'each', unit_price_ex_gst: 800, total_ex_gst: 800,
      }] },
      scope_of_works: 'Supply and install with testing and certification.',
      risk_flags: ['tradie_manual_line:better#0'],
    })
    arrange()

    const view = await PublicQuotePage(params())
    expect(view.type).toBe(QuotePricingReview)
    expect(view.props.scope).toBe('EV charger supply only. Installation and all electrical work are excluded.')
    expect(view.props.inspectionUrl).toBeUndefined()
    expect(JSON.stringify(view)).not.toContain('testing and certification')
  })

  it('fails closed when an EV quote has no canonical or safely inferred service mode', async () => {
    Object.assign(h.rows.intakes!, {
      job_type: 'ev_charger', scope: { specs: { supplied_by: 'tradie' } },
    })
    h.rows.quotes!.scope_of_works = 'Supply and install with testing and certification.'

    const view = await PublicQuotePage(params())
    expect(view.type).toBe(QuotePricingReview)
    expect(view.props).toEqual({
      scope: 'EV charger service scope needs confirmation before this quote can be shown.',
    })
    expect(JSON.stringify(view)).not.toContain('testing and certification')
    expect(JSON.stringify(view)).not.toContain('inspectionUrl')
  })
  it('uses saved false GST and tier mode after the current book changes or disappears', async () => {
    const view = await PublicQuotePage(params())
    expect(JSON.stringify(view)).toContain('No GST')
    expect(JSON.stringify(view)).not.toContain('All prices include 10% GST')
    h.rows.pricing_book = null
    expect(JSON.stringify(await PublicQuotePage(params()))).toContain('No GST')
    expect(h.reads.find(r => r.table === 'quotes')?.fields).toContain('pricing_book_version_id')
    expect(h.reads.find(r => r.table === 'intakes')?.filters).toEqual({ id: 'intake-id', tenant_id: 'tenant-id' })
  })
  it('renders cent-precise public tier totals from the saved tax basis', async () => {
    const html = renderToStaticMarkup(await PublicQuotePage(params()))
    expect(html).toContain('100.05')
    expect(html).toContain('No GST')
    expect(html).not.toContain('include 10% GST')
  })
  it('preserves the saved discount when the optional offer/countdown read fails', async () => {
    h.rows.quotes!.applied_discount_pct = 5
    h.errors.early_bird = { code: 'XX000' }
    const html = renderToStaticMarkup(await PublicQuotePage(params()))
    expect(html).toContain('95.05')
    expect(html).toContain('5% off applied')
    expect(h.reads.find(r => r.table === 'quotes')?.fields).toContain('applied_discount_pct')
  })
  it('renders non-generic tier totals and deposit cents without adding GST', () => {
    const html = renderToStaticMarkup(React.createElement(TradeTiers, {
      tiers: { good: { label: 'Saved', subtotal_ex_gst: 100.05 }, better: null, best: null },
      token: 'saved-token', stripeLinks: {}, depositPct: 30, selectedTier: 'good', appliedDiscountPct: 0,
      isPaid: false, paidTier: null, gstRegistered: false, depositEnabled: true,
    }))
    expect(html).toContain('$100.05')
    expect(html).toContain('$30.02')
    expect(html).toContain('No GST')
    expect(html).not.toContain('inc GST')
  })
  it('keeps customer scope and known site-visit action when prices need review, without private flags', async () => {
    h.rows.quote_pricing_versions = null
    const view = await PublicQuotePage(params())
    expect(view.type).toBe(QuotePricingReview)
    expect(view.props).toEqual({ scope: 'Customer scope only', inspectionUrl: '/r/saved-token/inspection' })
    expect(JSON.stringify(view)).not.toContain('PRIVATE SAFETY FLAG')
  })
  it('does not offer a second site visit on a final quote whose history is invalid', async () => {
    Object.assign(h.rows.quotes!, { quote_kind: 'final', parent_quote_id: 'parent-id' })
    h.rows.quote_pricing_versions = null
    const view = await PublicQuotePage(params())
    expect(view.type).toBe(QuotePricingReview)
    expect(view.props.inspectionUrl).toBeUndefined()
  })
  it.each([null, 0, 91])('withholds deposit prices when the stored deposit is invalid: %j', async deposit => {
    h.rows.intakes!.trade = 'painting'
    h.rows.quote_pricing_versions!.trade = 'painting'
    ;(h.rows.quote_pricing_versions!.snapshot as Record<string, unknown>).trade = 'painting'
    h.rows.quotes!.deposit_pct = deposit
    expect((await PublicQuotePage(params())).type).toBe(QuotePricingReview)
  })
  it.each(['intakes', 'quote_pricing_versions'])('returns the retryable unavailable view for %s errors', async table => {
    h.errors[table] = { code: 'XX000' }
    expect((await PublicQuotePage(params())).type).toBe(QuoteUnavailable)
  })
  it('rejects a foreign intake before looking up any pricing book', async () => {
    h.rows.intakes!.tenant_id = 'other'
    expect((await PublicQuotePage(params())).type).toBe(QuotePricingReview)
    expect(h.reads.some(r => ['pricing_book', 'quote_pricing_versions'].includes(r.table))).toBe(false)
  })
})
