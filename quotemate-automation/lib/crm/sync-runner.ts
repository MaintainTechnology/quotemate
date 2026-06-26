// Contact-import runner shared by the OAuth callback (auto-import on connect)
// and the manual POST /api/tenant/crm/sync route. Loads the stored connection,
// decrypts the access token (refreshing it if expired), fetches contacts from
// the provider, and upserts them deduped into crm_contacts.
//
// Touches Supabase + the network, so it is integration-shaped; the pure pieces
// it relies on (token crypto, contact normalisation) are unit-tested separately.

import type { SupabaseClient } from '@supabase/supabase-js'
import { decryptSecret, encryptSecret } from '@/lib/crypto/encrypt'
import { getProvider } from '@/lib/crm/registry'
import { prepareContactRows } from '@/lib/crm/sync'

export type SyncResult = { imported: number; total_fetched: number }

export async function syncContactsForConnection(
  supabase: SupabaseClient,
  tenantId: string,
  provider: string,
): Promise<SyncResult> {
  const { data: conn, error } = await supabase
    .from('crm_connections')
    .select('id, provider, access_token_enc, refresh_token_enc, expires_at, status')
    .eq('tenant_id', tenantId)
    .eq('provider', provider)
    .maybeSingle()

  if (error) throw new Error(`failed to load connection: ${error.message}`)
  if (!conn || !conn.access_token_enc) throw new Error('no_connection')

  const impl = getProvider(provider)

  try {
    let accessToken = decryptSecret(conn.access_token_enc as string)

    // Refresh if the access token is expired (or expiring within 60s) and we
    // hold a refresh token. An unknown expiry (null) is treated as "needs
    // refresh" so a token row without expires_in still self-heals rather than
    // calling the provider with a possibly-stale token.
    const expiresAt = conn.expires_at ? new Date(conn.expires_at as string).getTime() : null
    const needsRefresh = expiresAt === null || expiresAt - Date.now() < 60_000
    if (needsRefresh && conn.refresh_token_enc) {
      const refreshToken = decryptSecret(conn.refresh_token_enc as string)
      const next = await impl.refresh(refreshToken)
      accessToken = next.accessToken
      await supabase
        .from('crm_connections')
        .update({
          access_token_enc: encryptSecret(next.accessToken),
          refresh_token_enc: next.refreshToken ? encryptSecret(next.refreshToken) : conn.refresh_token_enc,
          expires_at: next.expiresAt ? new Date(next.expiresAt).toISOString() : null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', conn.id as string)
    }

    const contacts = await impl.fetchContacts(accessToken)
    const rows = prepareContactRows(tenantId, conn.id as string, contacts)

    if (rows.length > 0) {
      const { error: upErr } = await supabase
        .from('crm_contacts')
        .upsert(rows, { onConflict: 'tenant_id,email' })
      if (upErr) throw new Error(`failed to store contacts: ${upErr.message}`)
    }

    await supabase
      .from('crm_connections')
      .update({ last_synced_at: new Date().toISOString(), status: 'connected', updated_at: new Date().toISOString() })
      .eq('id', conn.id as string)

    return { imported: rows.length, total_fetched: contacts.length }
  } catch (err) {
    // Mark the connection as errored so the dashboard can prompt a reconnect.
    await supabase
      .from('crm_connections')
      .update({ status: 'error', updated_at: new Date().toISOString() })
      .eq('id', conn.id as string)
    throw err
  }
}
