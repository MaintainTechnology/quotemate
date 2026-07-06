// The quote DOCUMENT model (spec 2026-07-06 §3). A minimal, serialisable block
// list — a deliberate subset of ProseMirror so the server serializer stays pure
// and dependency-free. Prices are NOT represented here: the `pricing` block is a
// locked marker that renders from good/better/best at serialize time.

export type ReportDocMark = 'bold' | 'italic' | 'underline' | 'highlight'

/** A run of inline text with optional allow-listed marks. */
export type ReportDocText = { text: string; marks?: ReportDocMark[] }

export type ReportDocBlock =
  | { type: 'title'; content: ReportDocText[] }
  | { type: 'heading'; content: ReportDocText[] }
  | { type: 'paragraph'; content: ReportDocText[] }
  | { type: 'bulletList'; items: ReportDocText[][] } // each item = one line of inline content
  | { type: 'pricing' } // locked node — renders good/better/best; carries no data

export type ReportDoc = { version: 1; blocks: ReportDocBlock[] }

export const REPORT_DOC_VERSION = 1 as const
export const ALLOWED_MARKS: readonly ReportDocMark[] = ['bold', 'italic', 'underline', 'highlight']
