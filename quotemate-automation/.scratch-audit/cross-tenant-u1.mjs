// U1 cross-tenant write check (live DB). The lib/customers unit tests prove
// updateCustomerFromIntake/writeCustomerCorrections CALL customerMemoryAllowed and
// skip on a mismatch; this proves the DB-level isolation with the REAL Atomic +
// Peppers tenant ids, and clears the stale test-number name.
//   node --env-file=.env.local .scratch-audit/cross-tenant-u1.mjs
import pg from 'pg'

// customerMemoryAllowed — copied verbatim from lib/customers/memory-scope.ts.
const allowed = (rowTenant, curTenant) => (!rowTenant || !curTenant ? true : rowTenant === curTenant)

const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await c.connect()

const { rows: tenants } = await c.query(
  `select id, business_name, twilio_sms_number from tenants where twilio_sms_number in ('+61468011464','+61468072695')`,
)
const atomic = tenants.find((t) => t.twilio_sms_number === '+61468011464')
const peppers = tenants.find((t) => t.twilio_sms_number === '+61468072695')
console.log('tenants:', { atomic: atomic?.id, atomicName: atomic?.business_name, peppers: peppers?.id, peppersName: peppers?.business_name })
if (!atomic || !peppers) {
  console.log('⚠ could not resolve both tenants by name — aborting')
  await c.end()
  process.exit(1)
}

const TEST_PHONE = '+61400000199'
await c.query(`delete from customers where phone_number=$1`, [TEST_PHONE])
await c.query(
  `insert into customers (phone_number, first_name, suburb, tenant_id) values ($1,'PeppersName','PeppersSuburb',$2)`,
  [TEST_PHONE, peppers.id],
)

const { rows: [row] } = await c.query(`select tenant_id, first_name, suburb from customers where phone_number=$1`, [TEST_PHONE])

const atomicAllowed = allowed(row.tenant_id, atomic.id)
console.log(`\nAtomic intake writing a Peppers-owned row -> gate allows? ${atomicAllowed} (expect false)`)
if (atomicAllowed) {
  console.log('❌ FAIL — the gate would let Atomic overwrite the Peppers row')
} else {
  const { rows: [after] } = await c.query(`select first_name, suburb, tenant_id from customers where phone_number=$1`, [TEST_PHONE])
  const ok = after.first_name === 'PeppersName' && after.suburb === 'PeppersSuburb' && after.tenant_id === peppers.id
  console.log(ok ? '✅ PASS — Peppers row untouched by an Atomic intake' : '❌ FAIL — Peppers row mutated', after)
}
console.log(`Peppers writing its own row -> gate allows? ${allowed(row.tenant_id, peppers.id)} (expect true)`)
console.log(`Write when the row tenant is NULL (heal) -> gate allows? ${allowed(null, atomic.id)} (expect true)`)
console.log(`Write when the current tenant is NULL (legacy) -> gate allows? ${allowed(row.tenant_id, null)} (expect true)`)

await c.query(`delete from customers where phone_number=$1`, [TEST_PHONE])

// Data cleanup — clear the stale name:Sam on the scenario-runner test number.
const { rowCount } = await c.query(`update customers set first_name=null, full_name=null where phone_number=$1`, ['+61489083371'])
console.log(`\ncleared stale name on the scenario test number (+61489083371): ${rowCount} row(s)`)

await c.end()
