// Trade-book extraction orchestrator.
//
// Glue between trade-book-prompt.ts (pure prompt + schema) and
// mt-filestore-kb.ts (HTTP client). Runs ONE search query against an
// indexed document store, parses the response, returns the validated
// rows + per-row errors + the raw answer (for audit / debugging).
//
// Pure: no DB writes here. The API route in app/api/admin/loader/
// trade-book/extract/route.ts owns the import_batch + import_staged_rows
// inserts. This module just turns "a store_id" into "a set of validated
// candidate rows".

import {
  buildExtractionPrompt,
  parseExtractionResponse,
  type ExtractedService,
  type ExtractionError,
  type PromptOptions,
} from './trade-book-prompt'
import {
  kbSearch,
  type KbConfig,
  type KbFetch,
  type KbSearchResult,
} from './mt-filestore-kb'

export type ExtractTradeBookOptions = {
  config: KbConfig
  /** Store id or full "fileSearchStores/..." name. */
  storeId: string
  /** Optional trade hint to bias the prompt. */
  trade?: string
  /** Optional metadata filter passed to mt-filestore-kb (e.g.
   *  'documentTitle="Sparky pricing guide 2024"') to scope to a single
   *  document when the store carries several. */
  metadataFilter?: string
  /** Optional Gemini model override (default: server default). */
  model?: string
  /** Injectable fetch — used by tests to mock the KB HTTP layer. */
  fetchImpl?: KbFetch
}

export type ExtractTradeBookResult = {
  rows: ExtractedService[]
  errors: ExtractionError[]
  /** Raw KB response — kept for the audit trail. */
  kbResult: KbSearchResult
  /** Prompt actually sent — recorded so the operator UI can show it. */
  promptSent: string
}

/**
 * Extract structured catalogue rows from an indexed trade-book document.
 *
 * Flow:
 *   1. Build the structured-extraction prompt (with optional trade hint)
 *   2. POST it to mt-filestore-kb /v1/search against the given store
 *   3. Pull the model's answer out of the response envelope
 *   4. Parse + Zod-validate each candidate row
 *   5. Return the clean rows, the per-row errors, and the raw response
 *
 * Never writes to the DB. Caller owns import_batch + import_staged_rows.
 */
export async function extractTradeBook(
  opts: ExtractTradeBookOptions,
): Promise<ExtractTradeBookResult> {
  if (!opts.storeId) throw new Error('storeId is required')

  const promptOpts: PromptOptions = {}
  if (opts.trade) promptOpts.trade = opts.trade
  const promptSent = buildExtractionPrompt(promptOpts)

  const kbResult = await kbSearch(
    opts.config,
    {
      store: opts.storeId,
      query: promptSent,
      ...(opts.model ? { model: opts.model } : {}),
      ...(opts.metadataFilter ? { metadataFilter: opts.metadataFilter } : {}),
    },
    opts.fetchImpl,
  )

  const parsed = parseExtractionResponse(kbResult.answer ?? '')

  return {
    rows: parsed.rows,
    errors: parsed.errors,
    kbResult,
    promptSent,
  }
}

/** Convenience: turn one ExtractedService into the shape we'd insert
 *  into shared_assemblies (the bulk-loader's import_staged_rows.payload
 *  jsonb). Pure — no DB. The api route calls this then hands the array
 *  to lib/admin-loader/store.ts. */
export function toAssemblyPayload(svc: ExtractedService): Record<string, unknown> {
  return {
    trade: svc.trade,
    name: svc.name,
    description: svc.description ?? null,
    category: svc.category,
    default_unit: svc.default_unit,
    default_unit_price_ex_gst: svc.default_unit_price_ex_gst,
    default_labour_hours: svc.default_labour_hours,
    default_exclusions: svc.default_exclusions ?? null,
    clarifying_questions: svc.clarifying_questions ?? [],
    row_assumptions: svc.row_assumptions ?? {},
    inspection_triggers: svc.inspection_triggers ?? [],
    properties: svc.properties ?? {},
    always_inspection: svc.always_inspection ?? false,
    // materials kept separately — the api route splits them into
    // import_staged_rows entries with target_table='shared_materials'.
    _materials: svc.materials ?? [],
  }
}
