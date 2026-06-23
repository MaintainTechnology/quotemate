// Text-layer PDF extraction for historical-quote imports. Mirrors the unpdf
// usage in app/api/signage/ingest. Image-only PDFs (no text layer) yield an
// empty string — the caller flags those as failed (spec non-goal: no OCR in v1).

export async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import('unpdf')
  const pdf = await getDocumentProxy(bytes)
  const res = await extractText(pdf, { mergePages: true })
  const text = Array.isArray(res.text) ? res.text.join('\n') : (res.text ?? '')
  return text.trim()
}

/** Best-effort "total" detector: the largest $-amount in the text. Returns null
 *  when no currency figure is present. */
export function extractTotalFromText(text: string): number | null {
  const matches = text.match(/\$\s?\d[\d,]*(?:\.\d{1,2})?/g)
  if (!matches || matches.length === 0) return null
  const values = matches
    .map((m) => Number(m.replace(/[^0-9.]/g, '')))
    .filter((n) => Number.isFinite(n) && n > 0)
  if (values.length === 0) return null
  return Math.max(...values)
}
