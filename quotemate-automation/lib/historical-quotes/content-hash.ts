// Deterministic content hash for import dedup (spec edge case: re-import must
// not double-count). sha256 over the normalised, order-fixed parts of a row.

import { createHash } from 'node:crypto'

export function contentHash(parts: Array<string | number | null | undefined>): string {
  const normalised = parts
    .map((p) => (p == null ? '' : String(p).trim().toLowerCase()))
    .join('|')
  return createHash('sha256').update(normalised).digest('hex')
}
