// Vercel cron — per-tenant file-store reconcile + retention (spec 2026-06-19, R15).
//   (a) confirm async KB indexing (pending → active)
//   (b) bounded retry of failed ingests
//   (c) prune the KB index past TENANT_FILESTORE_MAX_DOCS (Supabase archive kept)
//
// Registered in vercel.json. Auth mirrors the sms-cleanup cron: a
// Bearer ${CRON_SECRET} header is required in production, optional in dev.
// STUBs (no-op) when TENANT_FILESTORE_ENABLED !== 'true'.

import { defaultReconcilePorts, reconcileTenantFileDocs } from '@/lib/filestore/reconcile'

function isAuthorised(req: Request): boolean {
  const expected = process.env.CRON_SECRET
  if (process.env.NODE_ENV === 'production') {
    if (!expected) return false
    return req.headers.get('authorization') === `Bearer ${expected}`
  }
  const got = req.headers.get('authorization')
  if (got && expected) return got === `Bearer ${expected}`
  return true
}

export async function GET(req: Request) {
  if (!isAuthorised(req)) {
    return Response.json({ ok: false, error: 'unauthorised' }, { status: 401 })
  }
  if (process.env.TENANT_FILESTORE_ENABLED !== 'true') {
    return Response.json({ ok: true, stubbed: true })
  }
  try {
    const stats = await reconcileTenantFileDocs(defaultReconcilePorts())
    console.log('[cron/tenant-filestore-reconcile] done', stats)
    return Response.json({ ok: true, ...stats })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error('[cron/tenant-filestore-reconcile] failed', message)
    return Response.json({ ok: false, error: message }, { status: 500 })
  }
}
