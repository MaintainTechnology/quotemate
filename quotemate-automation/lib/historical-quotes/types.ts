// Shared types for the Historical Quotes feature (spec specs/historical-quotes.md).
// Pure type declarations — no runtime deps, importable anywhere.

export type GstBasis = 'inc' | 'ex' | 'unknown'
export type Confidence = 'high' | 'medium' | 'low'
export type ReviewStatus = 'pending_review' | 'confirmed' | 'rejected'
export type ImportSourceKind = 'csv' | 'pdf'
export type BatchStatus =
  | 'parsing'
  | 'categorizing'
  | 'awaiting_review'
  | 'committed'
  | 'failed'

/** The minimal row shape the analytics aggregator needs. */
export type AnalyticsInputRow = {
  job_type: string | null
  trade?: string | null
  price_inc_gst: number | null
  price_ex_gst: number | null
  quoted_at: string | null
  status: string
}

/** Per-job-type analytics, computed over confirmed rows only. */
export type JobTypeStats = {
  job_type: string
  trade: string | null
  count: number
  avg_price_inc_gst: number
  avg_price_ex_gst: number
  min_price_inc_gst: number
  max_price_inc_gst: number
  most_recent_quoted_at: string | null
}

/** Hint payload for the in-quote badge: full stats, or a clean empty marker. */
export type HintResult = JobTypeStats | { job_type: string; trade: string | null; count: 0 }

/** LLM/heuristic column mapping for a CSV import. Each value is the source
 *  header name that holds that canonical field, or null when absent. */
export type ColumnMapping = {
  description: string | null
  price: string | null
  gst_basis: string | null
  date: string | null
  quantity: string | null
  unit: string | null
}
