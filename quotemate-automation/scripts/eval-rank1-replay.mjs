// Isolated process entry point for promotion-time deterministic replay.
// Run with `node --import tsx`; no credential loading or file writes.
import { readFileSync } from 'node:fs'
import { captureAdapter } from './eval-quotes.mjs'
import * as adapterModule from './eval-rank1-adapter.ts'

const fixture = JSON.parse(readFileSync(process.argv[2], 'utf8'))
// tsx can expose a TS file as a CommonJS default namespace in this ESM entry.
const adapter = typeof adapterModule.estimate === 'function' ? adapterModule : adapterModule.default
process.stdout.write(JSON.stringify(await captureAdapter(fixture, adapter, process.argv[3] ?? 'electrical')))
