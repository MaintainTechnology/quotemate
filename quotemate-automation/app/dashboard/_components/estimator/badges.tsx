import type { RunStatus } from '@/lib/estimation/run-status'
import { StatusPill, type Tone } from '../quote-ui'
import type { Confidence } from './types'

/** AI count confidence — low is the "verify me first" signal. */
const CONFIDENCE_TONE: Record<Confidence, Tone> = {
  high: 'success',
  medium: 'dim',
  low: 'warn',
}
export function ConfidenceBadge({ confidence }: { confidence: Confidence }) {
  return <StatusPill label={confidence} tone={CONFIDENCE_TONE[confidence]} dot compact />
}

const RUN_STATUS: Record<RunStatus, { label: string; tone: Tone }> = {
  draft: { label: 'Draft', tone: 'dim' },
  verified: { label: 'Verified', tone: 'success' },
  priced: { label: 'Priced', tone: 'accent' },
}

/** Lifecycle chip for a saved run: draft → verified → priced. */
export function RunStatusChip({ status }: { status: RunStatus }) {
  const s = RUN_STATUS[status]
  return <StatusPill label={s.label} tone={s.tone} dot compact />
}
