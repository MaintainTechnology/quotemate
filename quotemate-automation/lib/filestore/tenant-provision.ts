// Per-tenant file-store provisioning (spec 2026-06-19, R5) — mirrors the
// discriminated-union shape of lib/twilio/provision.ts & lib/vapi/provision.ts.
//
// Gated by TENANT_FILESTORE_ENABLED: when not 'true' it STUBs (no KB calls, no
// DB write) so onboarding runs end-to-end during the flag-off pilot exactly as
// twilio/vapi stub. When enabled it find-or-creates the tenant's Gemini store
// and stamps tenants.file_store_id. Idempotent: a no-op if the id is already
// set and the store still resolves.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { ensureTenantStore } from './tenant-store'
import type { KbConfig, KbFetch } from '../admin-loader/mt-filestore-kb'

export type TenantStoreProvisionResult =
  | { ok: true; fileStoreId: string | null; stubbed?: true }
  | { ok: false; reason: string; code?: string }

export type TenantProvisionDeps = {
  /** Service-role client (tests inject a fake). Defaults to a lazy service client. */
  supabase?: Pick<SupabaseClient, 'from'>
  /** Override env (tests). Defaults to process.env. */
  env?: NodeJS.ProcessEnv
  config?: KbConfig
  fetchImpl?: KbFetch
}

let _client: SupabaseClient | null = null
function serviceClient(): SupabaseClient {
  if (_client) return _client
  _client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
  return _client
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export async function provisionTenantStore(
  args: { tenantId: string; businessName?: string | null },
  deps?: TenantProvisionDeps,
): Promise<TenantStoreProvisionResult> {
  const env = deps?.env ?? process.env
  // Flag gate — STUB exactly like twilio/vapi when disabled.
  if (env.TENANT_FILESTORE_ENABLED !== 'true') {
    return { ok: true, stubbed: true, fileStoreId: null }
  }
  if (!args.tenantId) return { ok: false, reason: 'tenantId is required' }

  const supabase = deps?.supabase ?? serviceClient()

  // Idempotence: if the tenant already has a store id, do nothing.
  try {
    const { data } = await supabase
      .from('tenants')
      .select('file_store_id')
      .eq('id', args.tenantId)
      .maybeSingle<{ file_store_id: string | null }>()
    if (data?.file_store_id) return { ok: true, fileStoreId: data.file_store_id }
  } catch {
    // non-fatal — fall through to ensure/create
  }

  const storeId = await ensureTenantStore(args.tenantId, args.businessName, {
    config: deps?.config,
    fetchImpl: deps?.fetchImpl,
  })
  if (!storeId) {
    return { ok: false, reason: 'could not create or find tenant file store (KB unavailable)' }
  }

  try {
    const { error } = await supabase
      .from('tenants')
      .update({ file_store_id: storeId })
      .eq('id', args.tenantId)
    if (error) return { ok: false, reason: `tenant update failed: ${error.message ?? String(error)}` }
  } catch (e) {
    return { ok: false, reason: `tenant update threw: ${errMsg(e)}` }
  }

  return { ok: true, fileStoreId: storeId }
}
