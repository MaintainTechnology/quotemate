// Pure recipient-selection logic for an announcement send. Kept free of any DB
// or network access so the rules (dedup, unsubscribe suppression, unsent-vs-all
// modes, invalid-address filtering) are exhaustively unit-testable. The route
// loads contacts / unsubscribes / prior sends from Postgres and hands them here.

export type Contact = {
  email: string
  first_name?: string | null
  last_name?: string | null
}

/**
 * 'unsent' (default) sends only to contacts not already sent THIS campaign —
 * the natural behaviour for a re-send after a sync pulls in new leads.
 * 'all' re-sends to everyone (still excluding unsubscribes — those are never
 * overridable).
 */
export type SelectMode = 'unsent' | 'all'

export type SelectResult = {
  recipients: Contact[]
  /** Emails suppressed because they're unsubscribed — recorded per-recipient (R12). */
  suppressedEmails: string[]
  suppressedUnsubscribed: number
  skippedAlreadySent: number
  duplicatesRemoved: number
  invalidRemoved: number
}

/** Normalise an email for comparison + storage: trimmed + lowercased. */
export function normalizeEmail(email: string): string {
  return (email ?? '').trim().toLowerCase()
}

// Deliberately conservative: must have a single @ with non-empty local and a
// domain containing a dot. Good enough to drop obvious junk before we hand a
// list to the email provider; the provider does the real validation.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(normalizeEmail(email))
}

/**
 * Decide who actually receives the announcement.
 *
 * Order of operations (each step's removals are counted for the confirmation
 * screen): drop invalid addresses → dedup by normalised email → suppress
 * unsubscribes (always) → in 'unsent' mode, skip contacts already sent this
 * campaign.
 */
export function selectRecipients(opts: {
  contacts: Contact[]
  unsubscribed: string[]
  alreadySent: string[]
  mode: SelectMode
}): SelectResult {
  const unsubSet = new Set(opts.unsubscribed.map(normalizeEmail))
  const sentSet = new Set(opts.alreadySent.map(normalizeEmail))

  let invalidRemoved = 0
  let duplicatesRemoved = 0
  let skippedAlreadySent = 0

  const seen = new Set<string>()
  const recipients: Contact[] = []
  const suppressedEmails: string[] = []

  for (const contact of opts.contacts) {
    const email = normalizeEmail(contact.email)

    if (!isValidEmail(email)) {
      invalidRemoved++
      continue
    }
    if (seen.has(email)) {
      duplicatesRemoved++
      continue
    }
    seen.add(email)

    if (unsubSet.has(email)) {
      suppressedEmails.push(email)
      continue
    }
    if (opts.mode === 'unsent' && sentSet.has(email)) {
      skippedAlreadySent++
      continue
    }

    recipients.push({ ...contact, email })
  }

  return {
    recipients,
    suppressedEmails,
    suppressedUnsubscribed: suppressedEmails.length,
    skippedAlreadySent,
    duplicatesRemoved,
    invalidRemoved,
  }
}
