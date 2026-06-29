// POST /api/dashboard/flyer/canva/disconnect
//   Forget this tenant's Canva connection (deletes the stored tokens). Their
//   created designs stay in canva_designs; only the auth link is removed.
// Auth: Authorization: Bearer <token>. Tenant-scoped.

import { userFromBearer } from '@/lib/marketing/auth'
import { tenantBrandForUser } from '@/lib/flyer/tenant'
import { deleteConnection } from '@/lib/canva/tokens'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const user = await userFromBearer(req)
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const tenant = await tenantBrandForUser(user.id)
  if (!tenant) return Response.json({ error: 'no_tenant' }, { status: 404 })

  await deleteConnection(tenant.id)
  return Response.json({ ok: true })
}
