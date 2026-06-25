// Read-only diagnostic for the quote-PDF tenant-logo bug.
// Spec: specs/quote-pdf-logo-fix.md R2 — answers, per channel/row:
//   • is tenant_id null on the intake/quote/painting row?
//   • does the resolved tenant have a non-empty, fetchable logo_url?
//   • would loadTenantBranding() populate logoSrc (→ logo renders) or not?
//
// This NEVER writes — pure investigation. It mirrors the real decision in
// lib/pdf/branding.ts (loadTenantBranding) + lib/pdf/image.ts (prepareLogo):
//   logoSrc populates IFF  tenant_id non-null
//                     AND  tenants.logo_url non-empty
//                     AND  the logo URL returns HTTP 200 with an image/* type.
//
// Run:
//   node --env-file=.env.local scripts/diagnose-quote-logo.mjs
//   node --env-file=.env.local scripts/diagnose-quote-logo.mjs --tenant-id=<uuid>
//   node --env-file=.env.local scripts/diagnose-quote-logo.mjs --quote-id=<uuid>
//   node --env-file=.env.local scripts/diagnose-quote-logo.mjs --token=<share_or_public_token>

import pg from 'pg'
const { Client } = pg

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)=(.*)$/)
    return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true]
  }),
)

const c = new Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
})

// Resolve the logo outcome for one tenant_id, the same way the PDF path does.
async function checkLogo(tenantId) {
  if (!tenantId) {
    return { verdict: 'NO LOGO — tenant_id is null (loadTenantBranding short-circuits to wordmark)' }
  }
  const { rows } = await c.query(
    'select business_name, logo_url from tenants where id = $1',
    [tenantId],
  )
  if (!rows.length) return { tenantId, verdict: 'NO LOGO — tenant row not found' }
  const { business_name, logo_url } = rows[0]
  if (!logo_url || !String(logo_url).trim()) {
    return {
      tenantId,
      businessName: business_name,
      logoUrl: null,
      verdict: 'NO LOGO — tenants.logo_url is empty (cause b: wordmark fallback)',
    }
  }
  let fetchInfo
  try {
    const res = await fetch(logo_url, { signal: AbortSignal.timeout(15000) })
    const ct = res.headers.get('content-type') || ''
    const buf = Buffer.from(await res.arrayBuffer())
    const ok = res.ok && ct.startsWith('image/') && buf.byteLength > 0
    fetchInfo = { status: res.status, contentType: ct, bytes: buf.byteLength, ok }
  } catch (e) {
    fetchInfo = { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
  return {
    tenantId,
    businessName: business_name,
    logoUrl: logo_url,
    fetch: fetchInfo,
    verdict: fetchInfo.ok
      ? 'LOGO OK — logoSrc should populate; logo will render'
      : 'NO LOGO — logo_url set but fetch failed (cause c: prepareLogo returns null → wordmark)',
  }
}

function line() {
  console.log('─'.repeat(72))
}

async function reportRow(label, tenantId, extra = {}) {
  console.log(`\n• ${label}`, extra)
  console.log('  →', await checkLogo(tenantId))
}

try {
  await c.connect()

  // ── Targeted: a specific tenant ──────────────────────────────────────
  if (args['tenant-id']) {
    line()
    console.log('TENANT LOGO CHECK')
    await reportRow(`tenant ${args['tenant-id']}`, args['tenant-id'])
  }

  // ── Targeted: a specific quote ───────────────────────────────────────
  else if (args['quote-id']) {
    line()
    console.log('QUOTE LOGO CHECK')
    const { rows } = await c.query(
      `select q.id, q.tenant_id, q.share_token, i.trade
         from quotes q left join intakes i on i.id = q.intake_id
        where q.id = $1`,
      [args['quote-id']],
    )
    if (!rows.length) console.log('  quote not found')
    else await reportRow(`quote ${rows[0].id} (trade=${rows[0].trade})`, rows[0].tenant_id, {
      share_token: rows[0].share_token,
    })
  }

  // ── Targeted: a share/public token across the trade tables ───────────
  else if (args['token']) {
    line()
    console.log('TOKEN LOGO CHECK')
    const probes = [
      ['quotes (electrical/plumbing/roofing/solar via save-as-quote)', 'select id, tenant_id from quotes where share_token = $1'],
      ['roofing_measurements', 'select id, tenant_id from roofing_measurements where public_token = $1'],
      ['painting_measurements', 'select id, tenant_id from painting_measurements where public_token = $1'],
      ['solar_estimates', 'select id, tenant_id from solar_estimates where public_token = $1'],
    ]
    let found = false
    for (const [label, sql] of probes) {
      const { rows } = await c.query(sql, [args['token']])
      if (rows.length) {
        found = true
        await reportRow(`${label} row ${rows[0].id}`, rows[0].tenant_id)
      }
    }
    if (!found) console.log('  token not found in any trade table')
  }

  // ── Default: health + recent samples per channel ─────────────────────
  else {
    line()
    console.log('NULL tenant_id counts (the cause-a population)')
    const { rows: counts } = await c.query(`
      select 'intakes' t, count(*) filter (where tenant_id is null)::int n, count(*)::int total from intakes union all
      select 'quotes', count(*) filter (where tenant_id is null)::int, count(*)::int from quotes union all
      select 'painting_measurements', count(*) filter (where tenant_id is null)::int, count(*)::int from painting_measurements union all
      select 'roofing_measurements', count(*) filter (where tenant_id is null)::int, count(*)::int from roofing_measurements union all
      select 'solar_estimates', count(*) filter (where tenant_id is null)::int, count(*)::int from solar_estimates`)
    for (const r of counts) console.log(`  ${r.t.padEnd(24)} ${r.n}/${r.total} null tenant_id`)

    line()
    console.log('Recent electrical/plumbing quotes (cause a likely if tenant_id null):')
    const { rows: ep } = await c.query(
      `select q.id, q.tenant_id, i.trade, q.created_at
         from quotes q join intakes i on i.id = q.intake_id
        where i.trade in ('electrical','plumbing')
        order by q.created_at desc limit 5`,
    )
    for (const r of ep) await reportRow(`quote ${r.id} (${r.trade})`, r.tenant_id)

    line()
    console.log('Recent painting quotes (cause a impossible — must be b or c):')
    const { rows: pm } = await c.query(
      `select id, tenant_id, public_token, created_at
         from painting_measurements order by created_at desc limit 5`,
    )
    for (const r of pm) await reportRow(`painting ${r.id}`, r.tenant_id, { public_token: r.public_token })

    line()
    console.log('Hint: pass --quote-id / --token / --tenant-id to drill into one row.')
  }
} finally {
  await c.end()
}
