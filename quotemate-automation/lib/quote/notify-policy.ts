// Pure decision for whether an edit to a quote should send the customer an
// "updated quote" SMS. Extracted from app/api/quote/[id]/edit/route.ts so the
// rule is unit-testable without standing up the route's Supabase / Stripe /
// SMS dependencies.

/**
 * Decide whether to notify the customer after a tradie edits a quote.
 *
 * A quote in `awaiting_tradie_approval` has NOT been shown to the customer yet
 * — only the explicit Approve action first-contacts them — so an edit must
 * never be their first contact (no-leak-on-held-quotes). Otherwise:
 *   - `notifyCustomer === true`      → always notify (tradie opted in)
 *   - `notifyCustomer === undefined` → legacy default: notify iff a tier price
 *                                      changed (`changedTiersCount > 0`)
 *   - `notifyCustomer === false`     → never notify (tradie chose "save quietly")
 */
export function shouldNotifyOnEdit(args: {
  status: string | null | undefined
  notifyCustomer: boolean | undefined
  changedTiersCount: number
}): boolean {
  if (args.status === 'awaiting_tradie_approval') return false
  if (args.notifyCustomer === true) return true
  if (args.notifyCustomer === undefined) return args.changedTiersCount > 0
  return false
}
