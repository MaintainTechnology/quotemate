// Fire-and-forget provisioning of a session's persistent File Search store.
//
// Called from the estimator routes to index a session's documents (uploaded
// source files at extract time, the result PDF at save time) into its dedicated
// store AFTER the HTTP response is sent — via next/server `after`, the same
// pattern the webhook routes use for post-ack work. Uploading + indexing on
// Gemini can take 10–60s, so it must never sit on the request's critical path.
//
// Best-effort and never throws: a KB problem must not slow down or fail the
// estimate. Opt out entirely with ESTIMATOR_CHATBOT_ENABLED=false.

import { after } from 'next/server'
import { loadKbConfigFromEnv } from '../admin-loader/mt-filestore-kb'
import { addDocumentsToSessionStore, type SessionStoreDoc } from './session-store'
import type { EstimatorKind } from './store-name'

export function provisionSessionStore(args: {
  estimator: EstimatorKind
  sessionId: string
  documents: SessionStoreDoc[]
  label?: string | null
}): void {
  if (process.env.ESTIMATOR_CHATBOT_ENABLED === 'false') return
  const documents = (args.documents ?? []).filter(
    (d) => d && d.bytes && d.bytes.byteLength > 0,
  )
  if (documents.length === 0 || !args.sessionId) return

  const tag = `[filestore/provision] ${args.estimator}/${args.sessionId}`
  after(async () => {
    let config
    try {
      config = loadKbConfigFromEnv()
    } catch (e) {
      // No KB env (KB_API_URL / KB_API_KEY) — the chatbot store can't be built.
      console.warn(`${tag} skipped — KB not configured: ${e instanceof Error ? e.message : e}`)
      return
    }
    try {
      const res = await addDocumentsToSessionStore({
        config,
        estimator: args.estimator,
        sessionId: args.sessionId,
        label: args.label,
        documents,
      })
      if (!res.ok) {
        console.error(`${tag} failed to ensure store: ${res.reason}`)
      } else if (res.errors.length > 0) {
        // Store created but one or more documents failed to index — the most
        // common "store exists but is empty" cause. Surface every reason.
        console.error(
          `${tag} store=${res.storeName} uploaded=${res.uploaded} skipped=${res.skipped} ` +
            `errors=${res.errors.length}: ${res.errors.join(' | ')}`,
        )
      } else {
        console.log(
          `${tag} store=${res.storeName} uploaded=${res.uploaded} skipped=${res.skipped}`,
        )
      }
    } catch (e) {
      // best-effort: populating the chatbot store must never affect the estimate
      console.error(`${tag} threw: ${e instanceof Error ? e.message : e}`)
    }
  })
}
