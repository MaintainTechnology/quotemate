// Public self-serve painting form page — the unique-hash link the SMS
// receptionist offers first. Server component: awaits the dynamic param
// (Next 16) and hands the token to the client form.

import { PaintRequestForm } from './PaintRequestForm'

export const dynamic = 'force-dynamic'

export default async function PaintRequestPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  return <PaintRequestForm token={token} />
}
