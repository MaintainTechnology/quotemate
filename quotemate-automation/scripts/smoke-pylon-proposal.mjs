// Smoke test: seed a fixture Pylon proposal (docs example design, already
// normalized), render /q/pylon/[token] pre- and post-confirm against a
// running dev server, assert the confirm gate, then clean up.
// Usage: node --env-file=.env.local scripts/smoke-pylon-proposal.mjs [baseUrl]
import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'node:crypto'

const BASE = process.argv[2] ?? 'http://localhost:3000'
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
)

const token = randomBytes(16).toString('base64url')

const design = {
  pylon_design_id: 'SMOKE-DESIGN',
  title: '13.5kWh Battery storage with 4.99kW Inverter',
  label: null,
  is_primary: true,
  summary: {
    dc_output_kw: 6.49,
    storage_kwh: 13.5,
    description: '6.49kW REC + 13.5kWh storage',
    web_proposal_url: 'https://app.getpylon.com/proposals/GOAn41FTYY',
    pdf_proposal_url: null,
    pv_site_information_url: null,
    single_line_diagram_pdf_url: null,
    latest_snapshot_url: null,
  },
  locale_au: {
    stc_quantity: 103,
    stc_value_cents: 0,
    battery_stc_quantity: null,
    battery_stc_value_cents: null,
  },
  components: [
    {
      kind: 'module',
      sku: '779db75d-436a-5631-ba68-5eea5e3d25e2',
      description: 'REC Solar TwinPeak 2 Series',
      quantity: 22,
      datasheet: {
        sku: '779db75d-436a-5631-ba68-5eea5e3d25e2',
        name: 'REC Solar TwinPeak 2 Series 295W',
        brand: 'REC Solar',
        series: 'TwinPeak 2 Series',
        model_number: 'REC295TP2',
        datasheet_url: 'https://static.getpylon.com/datasheets/panels/example.pdf',
      },
    },
    {
      kind: 'inverter',
      sku: 'cb532cd0-a5d4-5b77-a0e3-9a8dd27690f7',
      description: 'Sungrow Power Sun Access SH5K',
      quantity: 1,
      datasheet: null,
    },
    {
      kind: 'battery',
      sku: '56f5e7f0-4fb3-5ceb-8e8e-2f1be9dcdb0e',
      description: 'Sonnen Eco 8.10',
      quantity: 1,
      datasheet: null,
    },
  ],
  pricing: { total_cents: 760000, total_includes_tax: true, currency: 'aud' },
  line_items: [
    {
      key: 'a',
      included_in_summary_line: 'subtotal',
      description: '13.5kWh Battery storage with 4.99kW Inverter',
      unit_amount_cents: 1120500,
      quantity: null,
      total_amount_cents: 1120500,
      tax_type: 'output',
      tax_rate: 0,
      tax_amount_cents: 0,
      is_line_hidden: false,
      is_amount_hidden: false,
      component_type: null,
      component_id: null,
    },
    {
      key: 'b',
      included_in_summary_line: 'total',
      description: 'STCs',
      unit_amount_cents: -3500,
      quantity: 103,
      total_amount_cents: -360500,
      tax_type: 'au:exempt_expenses',
      tax_rate: null,
      tax_amount_cents: null,
      is_line_hidden: false,
      is_amount_hidden: false,
      component_type: null,
      component_id: null,
    },
  ],
  proposal_quote: {
    currency: 'aud',
    total_tax_formatted: '$0.00',
    total_price_formatted: '$7,600.00',
    deposit_amount_formatted: '$760.00',
    financed_amount_formatted: null,
    amount_payable_formatted: '$6,840.00',
    estimated_total_repayments_formatted: null,
    locale_au: {
      eligible_for_stcs: true,
      stc_quantity: 103,
      stc_value_formatted: '$0.00',
      battery_stc_quantity: null,
      battery_stc_value_formatted: null,
      eligible_for_lgcs: false,
      lgc_quantity: null,
      lgc_value_formatted: null,
    },
  },
  pylon_created_at: '2020-02-18T13:14:00+00:00',
  pylon_updated_at: '2020-02-18T16:09:40+00:00',
}

async function expectContains(url, must, mustNot = []) {
  const res = await fetch(url)
  const html = await res.text()
  const failures = []
  if (res.status !== 200) failures.push(`status ${res.status}`)
  for (const s of must) if (!html.includes(s)) failures.push(`missing: ${s}`)
  for (const s of mustNot) if (html.includes(s)) failures.push(`should not contain: ${s}`)
  return failures
}

// Use the first active tenant as the owner of the smoke proposal.
const { data: tenant } = await supabase.from('tenants').select('id, business_name').limit(1).maybeSingle()
if (!tenant) {
  console.error('No tenant found — cannot smoke test')
  process.exit(1)
}

const { error: insErr } = await supabase.from('pylon_proposals').insert({
  tenant_id: tenant.id,
  public_token: token,
  pylon_design_id: 'SMOKE-DESIGN',
  pylon_project_id: 'SMOKE-PROJECT',
  title: design.title,
  address_text: '19 Parmesan Avenue, Glen Iris, Victoria, 3147',
  customer: { name: 'Hubert J. Farnsworth', phone: null, email: null },
  site: {
    address: { line1: '19 Parmesan Avenue', line2: null, city: 'Glen Iris', state: 'Victoria', zip: '3147', country: 'Australia' },
    address_text: '19 Parmesan Avenue, Glen Iris, Victoria, 3147',
    location: [145.0709934, -37.8510383],
    roof_type: 'tile',
    number_of_storeys: 1,
    power_phases: 'one',
    nmi: null,
    energy_retailer: null,
    energy_distributor: null,
  },
  design,
  assets: {},
  flags: [],
  status: 'awaiting_confirmation',
})
if (insErr) {
  console.error('Seed insert failed:', insErr.message)
  process.exit(1)
}
console.log('Seeded smoke proposal', token.slice(0, 8) + '…')

let failed = false
try {
  // 1. Pre-confirm: design visible, money hidden.
  const pre = await expectContains(
    `${BASE}/q/pylon/${token}`,
    [
      // NB: React SSR inserts comment markers between static text and
      // interpolations, so assert on the dynamic value alone.
      'Hubert J. Farnsworth',
      '19 Parmesan Avenue',
      'System', // system details
      'REC Solar TwinPeak 2 Series',
      'finalising this proposal',
      'Environmental',
    ],
    ['$7,600.00', '$11,205.00', 'Pay deposit'],
  )
  console.log(pre.length === 0 ? '✓ pre-confirm page OK' : '✗ pre-confirm FAIL: ' + pre.join('; '))
  if (pre.length > 0) failed = true

  // 2. Confirm → quote table + totals visible.
  await supabase
    .from('pylon_proposals')
    .update({ confirmed_at: new Date().toISOString(), status: 'confirmed' })
    .eq('public_token', token)
  const post = await expectContains(
    `${BASE}/q/pylon/${token}`,
    ['$7,600.00', '$11,205.00', 'STCs', '20-year financial', 'Assumed', 'verbatim'],
    ['finalising this proposal'],
  )
  console.log(post.length === 0 ? '✓ post-confirm page OK' : '✗ post-confirm FAIL: ' + post.join('; '))
  if (post.length > 0) failed = true

  // 3. Asset route 404s gracefully when nothing was cached.
  const asset = await fetch(`${BASE}/api/pylon/q/${token}/asset/snapshot`)
  console.log(asset.status === 404 ? '✓ asset route 404 on missing asset' : `✗ asset route returned ${asset.status}`)
  if (asset.status !== 404) failed = true
} finally {
  await supabase.from('pylon_proposals').delete().eq('public_token', token)
  console.log('Cleaned up smoke proposal')
}
process.exit(failed ? 1 : 0)
