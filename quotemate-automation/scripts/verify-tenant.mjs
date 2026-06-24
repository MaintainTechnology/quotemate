// QuoteMax · Verify (and optionally repair) a tenant's setup (spec A7).
//
//   node --env-file=.env.local scripts/verify-tenant.mjs --tenant <id|email>
//   node --env-file=.env.local scripts/verify-tenant.mjs --tenant <id|email> --apply
//
// Read-only by default: prints a green/red health report mirroring
// lib/onboard/health.ts (plus the LIVE Twilio SMS-webhook check that the
// admin view skips). With --apply it repairs what it safely can:
//   • re-seeds tenant_service_offerings (idempotent)
//   • ensures a pricing_book row per trade (copying rates from an existing
//     row + per-trade advanced defaults)
//   • re-points the Twilio SMS webhook to /api/sms/inbound
// Twilio/Vapi provisioning gaps (missing or stub) are reported, not fixed
// here — re-run provisioning via the dashboard / retry-provision endpoint.
//
// Repairs are idempotent: running --apply twice makes no further changes.

import pg from 'pg'

const { Client } = pg

// ── args ────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
const APPLY = argv.includes('--apply')
const tIdx = argv.indexOf('--tenant')
const TENANT = tIdx >= 0 ? argv[tIdx + 1] : null
if (!TENANT) {
  console.error('Usage: verify-tenant.mjs --tenant <id|email> [--apply]')
  process.exit(1)
}

// ── stub detection (mirror lib/onboard/health.ts) ─────────────────────────
const isStubTwilio = (n) => !!n && /^\+614820\d{5}$/.test(n)
const isStubVapi = (id) => !!id && String(id).startsWith('vapi-stub-')

// Mirror of ONBOARDING_TRADES / LICENCE_BODIES / bundled estimator trades.
const ONBOARDING_TRADES = new Set(['electrical', 'plumbing'])
const PRICING_DEFAULTS = {
  electrical: { apprentice_rate: 65, senior_rate: 160, after_hours_multiplier: 1.5, min_labour_hours: 2, risk_buffer_pct: 15 },
  plumbing: { apprentice_rate: 65, senior_rate: 160, after_hours_multiplier: 1.5, min_labour_hours: 1.5, risk_buffer_pct: 15 },
}

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL in .env.local')
  process.exit(1)
}
const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)

function tradesOf(t) {
  if (Array.isArray(t.trades) && t.trades.length > 0) return t.trades
  return t.trade ? [t.trade] : []
}

// ── Twilio helpers (best-effort) ──────────────────────────────────────────
function twilioAuth() {
  const sid = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  if (!sid || !token) return null
  return { sid, header: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64') }
}
async function getIncomingNumber(phoneNumber) {
  const a = twilioAuth()
  if (!a) return null
  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${a.sid}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(phoneNumber)}`
    const res = await fetch(url, { headers: { Authorization: a.header } })
    if (!res.ok) return null
    const json = await res.json()
    const row = json.incoming_phone_numbers?.[0]
    return row ? { sid: row.sid, smsUrl: row.sms_url } : null
  } catch {
    return null
  }
}
async function setIncomingSmsUrl(numberSid, smsUrl) {
  const a = twilioAuth()
  if (!a) return false
  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${a.sid}/IncomingPhoneNumbers/${numberSid}.json`
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: a.header, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ SmsUrl: smsUrl }).toString(),
    })
    return res.ok
  } catch {
    return false
  }
}

async function hasTradePromptRow(trade) {
  try {
    const r = await client.query(
      `select tp.estimator_system_prompt as tpl from trade_prompts tp
         join trades tr on tr.id = tp.trade_id where tr.name = $1 limit 1`,
      [trade],
    )
    const tpl = r.rows[0]?.tpl
    return !!(tpl && String(tpl).trim() !== '')
  } catch {
    return false
  }
}
async function tradeReady(trade) {
  const pricingDefaults = ONBOARDING_TRADES.has(trade)
  const sa = await client.query('select count(*)::int n from shared_assemblies where trade=$1', [trade])
  const sharedAssemblies = (sa.rows[0]?.n ?? 0) > 0
  const estimatorPrompt = ONBOARDING_TRADES.has(trade) || (await hasTradePromptRow(trade))
  const intakeRules = ONBOARDING_TRADES.has(trade)
  const licenceSchema = ONBOARDING_TRADES.has(trade)
  return pricingDefaults && sharedAssemblies && estimatorPrompt && intakeRules && licenceSchema
}

const checks = []
function record(level, label, ok, detail) {
  checks.push({ level, label, ok, detail })
}

try {
  await client.connect()

  // ── Resolve tenant ──────────────────────────────────────────────────
  const where = isUuid(TENANT) ? 'id = $1' : 'lower(owner_email) = lower($1)'
  const tRes = await client.query(
    `select id, business_name, status, activated_at, owner_user_id, trade, trades,
            twilio_sms_number, vapi_assistant_id
       from tenants where ${where} limit 1`,
    [TENANT],
  )
  const tenant = tRes.rows[0]
  if (!tenant) {
    console.error(`No tenant matches "${TENANT}"`)
    process.exit(1)
  }
  const trades = tradesOf(tenant)
  console.log(`\nTenant: ${tenant.business_name ?? '(no name)'}  [${tenant.id}]`)
  console.log(`Trades: ${trades.join(' + ') || '(none)'}   Status: ${tenant.status}`)
  console.log(`Mode:   ${APPLY ? 'APPLY (will repair)' : 'VERIFY (read-only)'}\n`)

  // ── Checks ──────────────────────────────────────────────────────────
  record('required', 'Owner user linked', !!tenant.owner_user_id, tenant.owner_user_id ? '' : 'owner_user_id NULL')

  const activeOk = tenant.status === 'active' && !!tenant.activated_at
  record('required', 'Status active + activated_at', activeOk, activeOk ? '' : `status=${tenant.status}`)

  // pricing per trade
  const pb = await client.query(
    'select trade, hourly_rate, call_out_minimum, default_markup_pct, gst_registered, licence_type, licence_number, licence_state, licence_expiry from pricing_book where tenant_id=$1',
    [tenant.id],
  )
  const pricingByTrade = new Map(pb.rows.map((r) => [r.trade, r]))
  let missingPricing = trades.filter((t) => !pricingByTrade.get(t) || !(Number(pricingByTrade.get(t).hourly_rate) > 0))
  record('required', 'Pricing book per trade', trades.length > 0 && missingPricing.length === 0, missingPricing.length ? `missing: ${missingPricing.join(', ')}` : '')

  // offerings per trade
  const sa = await client.query('select id, trade from shared_assemblies where trade = any($1)', [trades.length ? trades : ['__none__']])
  const idsByTrade = new Map()
  for (const r of sa.rows) {
    if (!idsByTrade.has(r.trade)) idsByTrade.set(r.trade, new Set())
    idsByTrade.get(r.trade).add(r.id)
  }
  const off = await client.query('select assembly_id from tenant_service_offerings where tenant_id=$1', [tenant.id])
  const offered = new Set(off.rows.map((r) => r.assembly_id))
  function missingOfferingTrades() {
    return trades.filter((t) => {
      const ids = idsByTrade.get(t)
      if (!ids || ids.size === 0) return false
      for (const id of ids) if (offered.has(id)) return false
      return true
    })
  }
  let missingOff = missingOfferingTrades()
  record('required', 'Service offerings per trade', missingOff.length === 0, missingOff.length ? `no offerings: ${missingOff.join(', ')}` : '')

  // twilio / vapi
  const twilioStub = isStubTwilio(tenant.twilio_sms_number)
  record('required', 'Real Twilio number', !!tenant.twilio_sms_number && !twilioStub, !tenant.twilio_sms_number ? 'none' : twilioStub ? `stub ${tenant.twilio_sms_number}` : tenant.twilio_sms_number)
  const vapiStub = isStubVapi(tenant.vapi_assistant_id)
  record('required', 'Real Vapi assistant', !!tenant.vapi_assistant_id && !vapiStub, !tenant.vapi_assistant_id ? 'none' : vapiStub ? `stub ${tenant.vapi_assistant_id}` : tenant.vapi_assistant_id)

  // sms webhook (live, best-effort)
  const appUrl = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL
  let numberRow = null
  if (tenant.twilio_sms_number && !twilioStub && twilioAuth() && appUrl) {
    const expected = `${appUrl}/api/sms/inbound`
    numberRow = await getIncomingNumber(tenant.twilio_sms_number)
    if (numberRow) {
      record('required', 'SMS webhook → /api/sms/inbound', numberRow.smsUrl === expected, numberRow.smsUrl === expected ? '' : `is "${numberRow.smsUrl}", expected "${expected}"`)
    } else {
      record('info', 'SMS webhook → /api/sms/inbound', true, 'could not read from Twilio (number not found / API error)')
    }
  } else {
    record('info', 'SMS webhook → /api/sms/inbound', true, 'skipped (stub number or missing Twilio creds / APP_URL)')
  }

  // trade readiness
  const notReady = []
  for (const t of trades) if (!(await tradeReady(t))) notReady.push(t)
  record('required', 'All trades onboardable', trades.length > 0 && notReady.length === 0, notReady.length ? `not ready: ${notReady.join(', ')}` : '')

  // info
  const lic = await client.query('select count(*)::int n from tenant_licences where tenant_id=$1', [tenant.id])
  record('info', 'Per-trade licence rows', (lic.rows[0]?.n ?? 0) > 0, '')
  let prov = { rows: [{ n: 0 }] }
  try {
    prov = await client.query('select count(*)::int n from tenant_feature_sources where tenant_id=$1', [tenant.id])
  } catch {
    /* table may not exist in some envs */
  }
  record('info', 'Feature provenance stamped', (prov.rows[0]?.n ?? 0) > 0, '')

  printChecks('Verify')

  // ── Repair ──────────────────────────────────────────────────────────
  if (APPLY) {
    console.log('\nRepairing…')

    // 1. Re-seed offerings (idempotent)
    if (missingOff.length > 0) {
      let inserted = 0
      for (const trade of missingOff) {
        const rows = (await client.query('select id, default_enabled from shared_assemblies where trade=$1', [trade])).rows
        for (const a of rows) {
          const r = await client.query(
            'insert into tenant_service_offerings (tenant_id, assembly_id, enabled) values ($1,$2,$3) on conflict (tenant_id, assembly_id) do nothing',
            [tenant.id, a.id, a.default_enabled === null || a.default_enabled === undefined ? true : a.default_enabled],
          )
          inserted += r.rowCount ?? 0
        }
      }
      console.log(`  • service offerings: +${inserted} rows`)
    }

    // 2. Ensure pricing rows per trade (copy from an existing row)
    if (missingPricing.length > 0) {
      const template = pb.rows.find((r) => Number(r.hourly_rate) > 0)
      if (!template) {
        console.log('  • pricing: cannot repair — tenant has no existing pricing row to copy rates from (needs manual entry)')
      } else {
        let added = 0
        for (const trade of missingPricing) {
          if (pricingByTrade.get(trade)) continue
          const d = PRICING_DEFAULTS[trade] ?? PRICING_DEFAULTS.electrical
          const r = await client.query(
            `insert into pricing_book
               (tenant_id, trade, hourly_rate, call_out_minimum, default_markup_pct,
                apprentice_rate, senior_rate, after_hours_multiplier, min_labour_hours,
                risk_buffer_pct, gst_registered, licence_type, licence_number, licence_state, licence_expiry)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
             on conflict (tenant_id, trade) do nothing`,
            [
              tenant.id, trade, template.hourly_rate, template.call_out_minimum, template.default_markup_pct,
              d.apprentice_rate, d.senior_rate, d.after_hours_multiplier, d.min_labour_hours,
              d.risk_buffer_pct, template.gst_registered ?? true,
              template.licence_type, template.licence_number, template.licence_state, template.licence_expiry,
            ],
          )
          added += r.rowCount ?? 0
        }
        console.log(`  • pricing book: +${added} rows`)
      }
    }

    // 3. Fix SMS webhook
    if (numberRow && appUrl) {
      const expected = `${appUrl}/api/sms/inbound`
      if (numberRow.smsUrl !== expected) {
        const ok = await setIncomingSmsUrl(numberRow.sid, expected)
        console.log(`  • sms webhook: ${ok ? 'fixed → ' + expected : 'fix FAILED (check Twilio creds)'}`)
      }
    }

    // 4. Provisioning gaps — cannot fix from a script
    if (!tenant.twilio_sms_number || twilioStub || !tenant.vapi_assistant_id || vapiStub) {
      console.log('  • provisioning: Twilio/Vapi missing or stub — re-run provisioning via the dashboard "Retry provisioning" (POST /api/onboard/retry-provision). Not fixable from this script.')
    }

    // ── Re-verify ──────────────────────────────────────────────────────
    checks.length = 0
    record('required', 'Owner user linked', !!tenant.owner_user_id, '')
    record('required', 'Status active + activated_at', tenant.status === 'active' && !!tenant.activated_at, '')
    const pb2 = await client.query('select trade, hourly_rate from pricing_book where tenant_id=$1', [tenant.id])
    const pbt2 = new Map(pb2.rows.map((r) => [r.trade, r]))
    record('required', 'Pricing book per trade', trades.length > 0 && trades.every((t) => pbt2.get(t) && Number(pbt2.get(t).hourly_rate) > 0), '')
    const off2 = await client.query('select assembly_id from tenant_service_offerings where tenant_id=$1', [tenant.id])
    const offered2 = new Set(off2.rows.map((r) => r.assembly_id))
    const missingOff2 = trades.filter((t) => {
      const ids = idsByTrade.get(t)
      if (!ids || ids.size === 0) return false
      for (const id of ids) if (offered2.has(id)) return false
      return true
    })
    record('required', 'Service offerings per trade', missingOff2.length === 0, missingOff2.length ? `still missing: ${missingOff2.join(', ')}` : '')
    record('required', 'Real Twilio number', !!tenant.twilio_sms_number && !twilioStub, '')
    record('required', 'Real Vapi assistant', !!tenant.vapi_assistant_id && !vapiStub, '')
    const notReady2 = []
    for (const t of trades) if (!(await tradeReady(t))) notReady2.push(t)
    record('required', 'All trades onboardable', trades.length > 0 && notReady2.length === 0, '')
    printChecks('After repair')
  }
} catch (err) {
  console.error('verify-tenant failed:', err.message ?? err)
  process.exit(1)
} finally {
  await client.end()
}

function printChecks(title) {
  console.log(`\n${title}:`)
  for (const c of checks) {
    const mark = c.ok ? 'OK  ' : 'FAIL'
    const tag = c.level === 'info' ? ' (info)' : ''
    console.log(`  [${mark}] ${c.label}${tag}${c.detail ? ` — ${c.detail}` : ''}`)
  }
  const requiredFails = checks.filter((c) => c.level === 'required' && !c.ok)
  const verdict = requiredFails.length === 0 ? 'READY' : 'INCOMPLETE'
  console.log(`\n  Verdict: ${verdict}${requiredFails.length ? ` (${requiredFails.length} required check(s) failing)` : ''}`)
}
