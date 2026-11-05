import type { SupabaseClient } from '@supabase/supabase-js'

type IntakeForRag = {
  id?: string
  embedding?: number[] | string | null
  job_type?: string
  scope?: unknown
  access?: unknown
  risks?: string[]
}

/**
 * Historical-quote retrieval is retired for Rank 1 quoting.
 *
 * The former match_intakes RPC did not enforce a tenant boundary and this
 * caller can receive a privileged database client. It also supplied previous
 * quote amounts to the model, bypassing the current pricing book's authority.
 * No environment flag may re-enable that path. Do not fetch or format any
 * historical customer data here, even when the intake contains a tenant ID.
 *
 * Keep the existing API while callers migrate. Permissioned reference-document
 * retrieval requires a separate, tenant-scoped implementation and isolation
 * tests; historic quote amounts must never become pricing inputs again.
 */
export async function fetchSimilarPastQuotesContext(
  _supabase: SupabaseClient,
  _intake: IntakeForRag,
): Promise<{ context: string; matchCount: number } | null> {
  // Retain the call contract without dereferencing either sensitive input.
  void _supabase
  void _intake
  return null
}
