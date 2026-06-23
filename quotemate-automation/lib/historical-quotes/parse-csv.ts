// CSV parsing for historical-quote imports. Mirrors lib/catalogue/csv-import.ts'
// parse options (bom + trim + lowercased headers) but stays format-agnostic —
// columns are mapped to canonical fields downstream by lib/historical-quotes/
// column-map. PURE: string in, records out. Unit-tested.

import { parse } from 'csv-parse/sync'

/** Hard cap on one upload (spec edge case: huge file). */
export const MAX_HISTORICAL_ROWS = 5000

export type CsvParseResult = {
  header: string[]
  records: Record<string, string>[]
  error: string | null
  truncated: boolean
}

function clean(s: string): string {
  return (s ?? '').replace(/\s+/g, ' ').trim()
}

export function parseHistoricalCsv(csvText: string, maxRows = MAX_HISTORICAL_ROWS): CsvParseResult {
  let header: string[] = []
  let records: Record<string, string>[]
  try {
    records = parse(csvText, {
      bom: true,
      trim: true,
      skip_empty_lines: true,
      relax_column_count: true,
      columns: (h: string[]) => {
        header = h.map((c) => clean(c).toLowerCase())
        return header
      },
    }) as Record<string, string>[]
  } catch (e) {
    return {
      header: [],
      records: [],
      error: `CSV could not be parsed: ${e instanceof Error ? e.message : String(e)}`,
      truncated: false,
    }
  }
  const truncated = records.length > maxRows
  return {
    header,
    records: truncated ? records.slice(0, maxRows) : records,
    error: null,
    truncated,
  }
}
