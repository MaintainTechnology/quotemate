// The default mark for a tradie who never uploaded a logo.
//
// Derived from tenants.business_name at render time rather than stored: it
// follows a rename, costs no storage object, and an uploaded logo_url simply
// wins wherever one exists. Only the letter derivation is shared — each
// surface (quote letterhead, PDF chrome, onboarding preview) already owns its
// own square markup and draws these letters in its own idiom.

/** Words carrying no brand signal — dropped so "The Roof Doctor" reads RD and
 *  "Bob's Plumbing Pty Ltd" reads BP. */
const NOISE = new Set(['the', 'and', 'pty', 'ltd', 'limited', 'inc', 'co', 'group'])

/**
 * One or two uppercase initials for `name`, or '' when it yields no letters or
 * digits at all (callers hide the mark rather than draw an empty square).
 */
export function businessInitials(name: string | null | undefined): string {
  // Apostrophes are stripped, not split on: "Bob's Plumbing" must read BP, not BS.
  const words = (name ?? '')
    .replace(/['’]/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
  if (words.length === 0) return ''

  // An all-noise name ("The Group") still deserves a mark — keep the raw words.
  const signal = words.filter((w) => !NOISE.has(w.toLowerCase()))
  const use = signal.length > 0 ? signal : words

  const letters = use.length === 1 ? use[0].slice(0, 2) : use[0][0] + use[1][0]
  return letters.toUpperCase()
}
