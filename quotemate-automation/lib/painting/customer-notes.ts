// Customer-safe measurement provenance — the "How we measured" bullets on
// /q/paint/[token] and the customer PDF.
//
// The measurement engine (lib/painting/area.ts, enrich.ts) writes its
// derivation notes for the TRADIE review surface, so some sentences are
// instructions ("Confirm storeys and internal area.", "Set the storey
// count… before quoting."). Nothing in them is secret — the takeoff notes
// with trade $ rates never reach this list — but the imperatives read
// wrongly on a customer surface, so they are stripped at sentence level.
// PURE; unit-tested.

/** A sentence addressed at the tradie, not the customer. */
const TRADIE_SENTENCE = /^(confirm|set |check )|before quoting|treated as confirmed/i

/**
 * Filter the engine's derivation notes down to the customer-safe sentences.
 * jsonb-sourced, so the shape is guarded; notes that end up empty drop out.
 */
export function customerMeasurementNotes(notes: string[] | null | undefined): string[] {
  if (!Array.isArray(notes)) return []
  return notes
    .map((n) =>
      String(n)
        .split(/(?<=\.)\s+/)
        .filter((s) => !TRADIE_SENTENCE.test(s.trim()))
        .join(' ')
        .trim(),
    )
    .filter((n) => n.length > 0)
}
