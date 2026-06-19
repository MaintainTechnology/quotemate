// One-time backfill of the per-tenant file store (spec 2026-06-19, R14).
//
// For each ACTIVE tenant: ensure the store exists, then ingest every
// finalized/sent quote across all live trades (electrical/plumbing via `quotes`,
// roofing/solar/painting via their token tables) plus extracted invoices —
// archiving the full PDF to Supabase and the PII-minimized text to the KB. Reuses
// the SAME tested path as the live hooks (loadAndBuildKbDoc + archiveAndIngestQuote),
// so behaviour can't diverge. Lazy painting/roofing/solar PDFs are eagerly
// rendered first (inside loadAndBuildKbDoc) before ingest.
//
// Run (TENANT_FILESTORE_ENABLED=true must be set for ingest to do anything):
//   node --env-file=.env.local --import tsx scripts/backfill-tenant-filestore.ts [--dry-run] [--tenant=<id>] [--resume]
//
// Idempotent: a second run adds zero duplicate KB docs / rows (dedup by
// displayName + UNIQUE (tenant_id, display_name) + content_hash). --resume skips
// rows already 'active' in tenant_file_documents.

import { createClient } from '@supabase/supabase-js'
import { ensureTenantStore } from '../lib/filestore/tenant-store'
import { loadAndBuildKbDoc, type SourceRef } from '../lib/filestore/source-doc'
import { archiveAndIngestQuote } from '../lib/filestore/ingest-quote'
import { quoteDocDisplayName } from '../lib/filestore/tenant-store-name'

const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const RESUME = args.includes('--resume')
const ONLY_TENANT = args.find((a) => a.startsWith('--tenant='))?.split('=')[1]
const BATCH = 25
const BATCH_DELAY_MS = 1500

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
})

const tally = { ingested: 0, skipped: 0, eager_rendered: 0, errored: 0 }

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

async function activeDisplayNames(tenantId: string): Promise<Set<string>> {
  const { data } = await sb
    .from('tenant_file_documents')
    .select('display_name')
    .eq('tenant_id', tenantId)
    .eq('state', 'active')
  return new Set((data ?? []).map((r: { display_name: string }) => r.display_name))
}

/** Build the list of (sourceKind, sourceId, trade) for a tenant across all trades. */
async function collectRefs(tenantId: string): Promise<SourceRef[]> {
  const refs: SourceRef[] = []

  // electrical / plumbing — `quotes` rows (trade comes from the intake).
  const { data: quotes } = await sb
    .from('quotes')
    .select('id, intake_id, status')
    .eq('tenant_id', tenantId)
    .neq('status', 'draft')
  for (const q of quotes ?? []) {
    let trade = 'electrical'
    if (q.intake_id) {
      const { data: intake } = await sb.from('intakes').select('trade').eq('id', q.intake_id).maybeSingle()
      if (intake?.trade) trade = intake.trade
    }
    refs.push({ sourceKind: 'quote', sourceId: q.id, trade })
  }

  // roofing — only genuinely-sent quotes (last_step='quoted'), matching the
  // live send_saved hook's finalized signal so un-confirmed drafts aren't seeded.
  const { data: roofs } = await sb
    .from('roofing_measurements')
    .select('public_token')
    .eq('tenant_id', tenantId)
    .eq('last_step', 'quoted')
    .not('quote', 'is', null)
  for (const r of roofs ?? []) refs.push({ sourceKind: 'quote', sourceId: r.public_token, trade: 'roofing' })

  // solar (confirmed only)
  const { data: solar } = await sb
    .from('solar_estimates')
    .select('public_token')
    .eq('tenant_id', tenantId)
    .not('confirmed_at', 'is', null)
  for (const s of solar ?? []) refs.push({ sourceKind: 'quote', sourceId: s.public_token, trade: 'solar' })

  // painting (residential + commercial)
  const { data: paint } = await sb
    .from('painting_measurements')
    .select('public_token')
    .eq('tenant_id', tenantId)
    .not('estimate', 'is', null)
  for (const p of paint ?? []) refs.push({ sourceKind: 'quote', sourceId: p.public_token, trade: 'painting' })

  // invoices (extracted)
  const { data: invoices } = await sb
    .from('invoice_uploads')
    .select('id, status')
    .eq('tenant_id', tenantId)
    .eq('status', 'extracted')
  for (const inv of invoices ?? []) refs.push({ sourceKind: 'invoice', sourceId: inv.id, trade: null })

  return refs
}

async function processTenant(tenant: { id: string; business_name: string | null }) {
  console.log(`\n── tenant ${tenant.id} (${tenant.business_name ?? '—'})`)
  if (!DRY_RUN) {
    const store = await ensureTenantStore(tenant.id, tenant.business_name)
    if (!store) {
      console.warn('  ! could not ensure store (KB unavailable / flag off) — skipping tenant')
      return
    }
  }
  const refs = await collectRefs(tenant.id)
  const skipNames = RESUME ? await activeDisplayNames(tenant.id) : new Set<string>()
  console.log(`  ${refs.length} source rows`)

  for (let i = 0; i < refs.length; i += BATCH) {
    const batch = refs.slice(i, i + BATCH)
    await Promise.all(
      batch.map(async (ref) => {
        try {
          const dn = quoteDocDisplayName({ sourceKind: ref.sourceKind, trade: ref.trade, sourceId: ref.sourceId })
          if (RESUME && skipNames.has(dn)) {
            tally.skipped++
            return
          }
          if (DRY_RUN) {
            console.log(`  would ingest ${dn}`)
            tally.ingested++
            return
          }
          const built = await loadAndBuildKbDoc(sb, ref)
          if (!built || !built.fullDocPath) {
            tally.skipped++
            return
          }
          tally.eager_rendered++
          await archiveAndIngestQuote({
            tenantId: built.tenantId ?? tenant.id,
            sourceKind: ref.sourceKind,
            sourceId: ref.sourceId,
            trade: built.trade ?? ref.trade,
            fullDocPath: built.fullDocPath,
            kbText: built.kbText,
            contentHash: built.contentHash,
          })
          tally.ingested++
        } catch (e) {
          tally.errored++
          console.error('  ! row failed', ref, e instanceof Error ? e.message : e)
        }
      }),
    )
    if (i + BATCH < refs.length) await sleep(BATCH_DELAY_MS)
  }
}

async function main() {
  if (!DRY_RUN && process.env.TENANT_FILESTORE_ENABLED !== 'true') {
    console.warn('TENANT_FILESTORE_ENABLED !== "true" — ingest will STUB (no-op). Use --dry-run to preview, or set the flag.')
  }
  let q = sb.from('tenants').select('id, business_name').eq('status', 'active')
  if (ONLY_TENANT) q = q.eq('id', ONLY_TENANT)
  const { data: tenants, error } = await q
  if (error) {
    console.error('failed to list tenants:', error.message)
    process.exit(1)
  }
  console.log(`Backfill ${DRY_RUN ? '(dry-run) ' : ''}over ${tenants?.length ?? 0} active tenant(s)`)
  for (const t of tenants ?? []) await processTenant(t)
  console.log('\n── done', tally)
  if (DRY_RUN) {
    console.log(
      '   (dry-run: `ingested` is an UPPER BOUND — it counts every candidate row ' +
        'and does not subtract rows a real run would skip, e.g. inspection-routed / ' +
        'Gotenberg-unavailable / null-pdf rows.)',
    )
  }
}

main().catch((e) => {
  console.error('backfill crashed:', e)
  process.exit(1)
})
