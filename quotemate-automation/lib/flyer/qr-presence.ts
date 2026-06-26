// Flyer Designer — QR presence detection (pure).
//
// Decides the in-editor QR flow: if the tenant already has a customer-facing
// QR (any non-'signup' row in marketing_qrs), the editor offers "insert an
// existing QR"; otherwise it offers a one-tap "generate QR" that reuses the
// existing POST /api/dashboard/marketing/qr builder.

export type QrLite = { destination_type: string; status?: string | null }

/** Customer-facing QRs only — 'signup' QRs recruit other tradies and are not
 *  a flyer destination. */
export function customerQrs<T extends QrLite>(qrs: readonly T[]): T[] {
  return qrs.filter((q) => q.destination_type !== 'signup')
}

export function hasCustomerQr(qrs: readonly QrLite[]): boolean {
  return qrs.some((q) => q.destination_type !== 'signup')
}

/** 'generate' when the tenant has no customer QR yet, else 'insert'. */
export function flyerQrAction(qrs: readonly QrLite[]): 'generate' | 'insert' {
  return hasCustomerQr(qrs) ? 'insert' : 'generate'
}
