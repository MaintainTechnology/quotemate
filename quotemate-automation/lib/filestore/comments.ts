// Shared data + presentation helpers for the Files-tab comment thread
// (specs/files-tab.md R6–R14). One flat, two-party (tenant ↔ QuoteMate staff)
// thread per archived document, plus a per-document resolved state.
//
// All DB access uses the service-role client (RLS bypass); tenancy and author
// ownership are enforced by the callers (the role-scoped /api routes). These
// helpers never expose storage_path / kb_document_id, and comment text never
// reaches the KB — comments live only in Postgres.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { isAdminUser } from '@/lib/admin-loader/auth'

export type CommentAuthorRole = 'tenant' | 'admin'

export const MAX_COMMENT_LEN = 5000

const UUID_RE = /^[0-9a-f-]{36}$/i
export function isUuid(v: string | null | undefined): boolean {
  return !!v && UUID_RE.test(v)
}

let _client: SupabaseClient | null = null
function svc(): SupabaseClient {
  if (_client) return _client
  _client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
  return _client
}

// ─── Auth helpers ───────────────────────────────────────────────────
// `id` is the tenant uuid; `userId` is the author's Supabase auth user id
// (the tenant owner) used for the is-own ownership check.
export type BearerTenant = { id: string; userId: string; business_name: string | null }

export async function tenantFromBearer(req: Request): Promise<BearerTenant | null> {
  const auth = req.headers.get('authorization') ?? ''
  if (!auth.toLowerCase().startsWith('bearer ')) return null
  const token = auth.slice(7).trim()
  if (!token) return null
  const { data, error } = await svc().auth.getUser(token)
  if (error || !data.user) return null
  const { data: tenant } = await svc()
    .from('tenants')
    .select('id, business_name')
    .eq('owner_user_id', data.user.id)
    .maybeSingle<{ id: string; business_name: string | null }>()
  if (!tenant) return null
  return { id: tenant.id, userId: data.user.id, business_name: tenant.business_name }
}

export async function adminFromBearer(req: Request): Promise<{ userId: string } | null> {
  const auth = req.headers.get('authorization') ?? ''
  if (!auth.toLowerCase().startsWith('bearer ')) return null
  const token = auth.slice(7).trim()
  if (!token) return null
  const { data, error } = await svc().auth.getUser(token)
  if (error || !data.user) return null
  const ok = await isAdminUser(svc(), data.user.id)
  return ok ? { userId: data.user.id } : null
}

// ─── Validation ─────────────────────────────────────────────────────
export function validateCommentBody(
  raw: unknown,
): { ok: true; body: string } | { ok: false; error: string } {
  if (typeof raw !== 'string') return { ok: false, error: 'invalid_body' }
  const body = raw.trim()
  if (!body) return { ok: false, error: 'empty_body' }
  if (body.length > MAX_COMMENT_LEN) return { ok: false, error: 'body_too_long' }
  return { ok: true, body }
}

// ─── Types ──────────────────────────────────────────────────────────
export type CommentRow = {
  id: string
  file_document_id: string
  tenant_id: string
  author_role: CommentAuthorRole
  author_user_id: string
  body: string
  created_at: string
  updated_at: string | null
  deleted_at: string | null
}

export type CommentDto = {
  id: string
  author_role: CommentAuthorRole
  author_label: string
  body: string
  created_at: string
  updated_at: string | null
  is_own: boolean
}

export type Viewer = {
  role: CommentAuthorRole
  userId: string
  /** Tenant business name — used to label tenant-authored comments to staff. */
  businessName: string | null
}

export type FileDocMeta = {
  id: string
  tenant_id: string
  business_name: string | null
  resolved_at: string | null
  resolved_by: string | null
}

export type ThreadState = {
  resolved: boolean
  resolved_at: string | null
  resolved_by: string | null
}

const COMMENT_COLS =
  'id, file_document_id, tenant_id, author_role, author_user_id, body, created_at, updated_at, deleted_at'

// ─── Presentation (R11) ─────────────────────────────────────────────
// Own comment → "You"; otherwise an admin comment → "QuoteMate" and a tenant
// comment → the tradie's business name (the only cross-author case a viewer
// sees is staff looking at a tenant comment, or a tradie looking at a staff
// comment — isolation prevents tenant↔tenant visibility).
export function commentLabel(c: CommentRow, viewer: Viewer): string {
  if (c.author_role === viewer.role && c.author_user_id === viewer.userId) return 'You'
  if (c.author_role === 'admin') return 'QuoteMate'
  return viewer.businessName || 'Tradie'
}

export function toDto(c: CommentRow, viewer: Viewer): CommentDto {
  return {
    id: c.id,
    author_role: c.author_role,
    author_label: commentLabel(c, viewer),
    body: c.body,
    created_at: c.created_at,
    updated_at: c.updated_at,
    is_own: c.author_role === viewer.role && c.author_user_id === viewer.userId,
  }
}

// ─── Data ops ───────────────────────────────────────────────────────
/** Document metadata (incl. owning tenant + thread resolved state). Null when
 *  the id is malformed or no such document exists. */
export async function getFileDocMeta(docId: string): Promise<FileDocMeta | null> {
  if (!isUuid(docId)) return null
  const { data: doc } = await svc()
    .from('tenant_file_documents')
    .select('id, tenant_id, comments_resolved_at, comments_resolved_by')
    .eq('id', docId)
    .maybeSingle<{
      id: string
      tenant_id: string
      comments_resolved_at: string | null
      comments_resolved_by: string | null
    }>()
  if (!doc) return null
  const { data: t } = await svc()
    .from('tenants')
    .select('business_name')
    .eq('id', doc.tenant_id)
    .maybeSingle<{ business_name: string | null }>()
  return {
    id: doc.id,
    tenant_id: doc.tenant_id,
    business_name: t?.business_name ?? null,
    resolved_at: doc.comments_resolved_at,
    resolved_by: doc.comments_resolved_by,
  }
}

export async function listComments(docId: string): Promise<CommentRow[]> {
  const { data } = await svc()
    .from('tenant_file_comments')
    .select(COMMENT_COLS)
    .eq('file_document_id', docId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
  return (data ?? []) as CommentRow[]
}

/** Non-deleted comment counts per document for a tenant, for list badges. */
export async function commentCounts(tenantId: string): Promise<Map<string, number>> {
  const { data } = await svc()
    .from('tenant_file_comments')
    .select('file_document_id')
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
  const m = new Map<string, number>()
  for (const r of (data ?? []) as Array<{ file_document_id: string }>) {
    m.set(r.file_document_id, (m.get(r.file_document_id) ?? 0) + 1)
  }
  return m
}

export async function insertComment(args: {
  fileDocumentId: string
  tenantId: string
  authorRole: CommentAuthorRole
  authorUserId: string
  body: string
}): Promise<CommentRow> {
  const { data, error } = await svc()
    .from('tenant_file_comments')
    .insert({
      file_document_id: args.fileDocumentId,
      tenant_id: args.tenantId,
      author_role: args.authorRole,
      author_user_id: args.authorUserId,
      body: args.body,
    })
    .select(COMMENT_COLS)
    .single()
  if (error || !data) throw new Error(error?.message ?? 'insert_failed')
  // R12: a new comment reopens a resolved thread.
  await svc()
    .from('tenant_file_documents')
    .update({ comments_resolved_at: null, comments_resolved_by: null })
    .eq('id', args.fileDocumentId)
  return data as CommentRow
}

export async function findComment(commentId: string): Promise<CommentRow | null> {
  if (!isUuid(commentId)) return null
  const { data } = await svc()
    .from('tenant_file_comments')
    .select(COMMENT_COLS)
    .eq('id', commentId)
    .maybeSingle<CommentRow>()
  return data ?? null
}

export async function updateCommentBody(commentId: string, body: string): Promise<CommentRow> {
  const { data, error } = await svc()
    .from('tenant_file_comments')
    .update({ body, updated_at: new Date().toISOString() })
    .eq('id', commentId)
    .select(COMMENT_COLS)
    .single()
  if (error || !data) throw new Error(error?.message ?? 'update_failed')
  return data as CommentRow
}

export async function softDeleteComment(commentId: string): Promise<void> {
  await svc()
    .from('tenant_file_comments')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', commentId)
}

export async function setThreadResolved(
  docId: string,
  resolved: boolean,
  byRole: CommentAuthorRole,
): Promise<ThreadState> {
  const resolved_at = resolved ? new Date().toISOString() : null
  const resolved_by = resolved ? byRole : null
  await svc()
    .from('tenant_file_documents')
    .update({ comments_resolved_at: resolved_at, comments_resolved_by: resolved_by })
    .eq('id', docId)
  return { resolved, resolved_at, resolved_by }
}

/** True iff `c` belongs to `docId` and was authored by (role,userId). Used by
 *  the edit/delete routes to gate own-comment mutations (else 403). */
export function isOwnCommentOnDoc(
  c: CommentRow | null,
  docId: string,
  role: CommentAuthorRole,
  userId: string,
): { found: boolean; own: boolean } {
  if (!c || c.file_document_id !== docId || c.deleted_at) return { found: false, own: false }
  return { found: true, own: c.author_role === role && c.author_user_id === userId }
}
