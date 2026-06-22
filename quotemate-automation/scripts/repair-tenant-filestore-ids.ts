// Repair pass for tenant_file_documents rows stranded as `failed` by the
// upload-response-has-no-name bug (fixed in lib/filestore/tenant-store.ts).
//
// The documents were ACTUALLY uploaded + indexed in each tenant's Gemini store;
// only the QuoteMate tracking row failed to capture the kb_document_id. This
// script resolves each failed row's id by matching its display_name against the
// tenant store's live document list (read-only on the KB — no re-upload), sets
// state from the doc's real indexing state, and stamps tenants.file_store_id
// (which the backfill's ensureTenantStore created but never persisted).
//
// Usage:
//   node --env-file=.env.local --import tsx scripts/repair-tenant-filestore-ids.ts [--dry-run] [--tenant=<id>]

import { createClient } from '@supabase/supabase-js'
import {
  isKbActiveState,
  kbListDocuments,
  loadKbConfigFromEnv,
} from '../lib/admin-loader/mt-filestore-kb'
import { ensureTenantStore } from '../lib/filestore/tenant-store'

const DRY_RUN = process.argv.includes('--dry-run')
const tenantArg = process.argv.find((a) => a.startsWith('--tenant='))?.split('=')[1]

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
)
const config = loadKbConfigFromEnv()

type Row = { id: string; tenant_id: string; display_name: string; state: string }

async function main() {
  console.log(`repair-tenant-filestore-ids ${DRY_RUN ? '(DRY RUN)' : '(APPLY)'}${tenantArg ? ` tenant=${tenantArg}` : ''}\n`)

  let q = supabase
    .from('tenant_file_documents')
    .select('id, tenant_id, display_name, state')
    .eq('state', 'failed')
  if (tenantArg) q = q.eq('tenant_id', tenantArg)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  const rows = (data ?? []) as Row[]
  console.log(`failed rows to repair: ${rows.length}`)
  if (rows.length === 0) return

  // Group failed rows by tenant so each store is listed once.
  const byTenant = new Map<string, Row[]>()
  for (const r of rows) {
    const list = byTenant.get(r.tenant_id) ?? []
    list.push(r)
    byTenant.set(r.tenant_id, list)
  }

  const totals = { active: 0, pending: 0, unmatched: 0, noStore: 0 }

  for (const [tenantId, tenantRows] of byTenant) {
    const { data: t } = await supabase
      .from('tenants')
      .select('business_name, file_store_id')
      .eq('id', tenantId)
      .maybeSingle<{ business_name: string | null; file_store_id: string | null }>()

    const storeId = await ensureTenantStore(tenantId, t?.business_name ?? null)
    if (!storeId) {
      console.log(`  tenant ${tenantId}: NO STORE (KB unavailable) — skipping ${tenantRows.length} rows`)
      totals.noStore += tenantRows.length
      continue
    }

    // Stamp the resolved store id back onto the tenant if missing (backfill gap).
    if (!t?.file_store_id && !DRY_RUN) {
      await supabase.from('tenants').update({ file_store_id: storeId }).eq('id', tenantId)
    }

    const docs = await kbListDocuments(config, storeId)
    const byName = new Map<string, { name: string; state?: string }>()
    for (const d of docs) {
      const dn = (d.displayName ?? '').trim()
      if (dn) byName.set(dn, { name: d.name, state: d.state })
    }

    let active = 0
    let pending = 0
    let unmatched = 0
    for (const r of tenantRows) {
      const match = byName.get(r.display_name.trim())
      if (!match?.name) {
        unmatched++
        continue
      }
      const state = isKbActiveState(match.state) ? 'active' : 'pending'
      if (state === 'active') active++
      else pending++
      if (!DRY_RUN) {
        await supabase
          .from('tenant_file_documents')
          .update({ kb_document_id: match.name, state, error: null, updated_at: new Date().toISOString() })
          .eq('id', r.id)
      }
    }
    totals.active += active
    totals.pending += pending
    totals.unmatched += unmatched
    console.log(
      `  tenant ${tenantId} (${t?.business_name ?? '?'}): ${tenantRows.length} failed → active=${active} pending=${pending} unmatched=${unmatched} | store docs=${docs.length}`,
    )
  }

  console.log(
    `\n${DRY_RUN ? 'WOULD repair' : 'Repaired'}: active=${totals.active} pending=${totals.pending} | unmatched(left failed)=${totals.unmatched} noStore=${totals.noStore}`,
  )
  if (DRY_RUN) console.log('\nRe-run without --dry-run to apply.')
}

main().catch((e) => {
  console.error('REPAIR FAILED:', e instanceof Error ? e.message : String(e))
  process.exit(1)
})
