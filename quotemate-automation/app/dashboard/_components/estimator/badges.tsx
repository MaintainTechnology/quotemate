import type { RunStatus } from '@/lib/estimation/run-status'
import type { Confidence } from './types'

/** AI count confidence — low is the "verify me first" signal. */
export function ConfidenceBadge({ confidence }: { confidence: Confidence }) {
  const styles: Record<Confidence, string> = {
    high: 'border-teal-glow/60 text-teal-glow',
    medium: 'border-ink-line text-text-sec',
    low: 'border-warning bg-warning/10 text-warning',
  }
  return (
    <span
      className={`inline-flex border px-1.5 py-0.5 font-mono text-[0.6rem] font-semibold uppercase tracking-[0.12em] ${styles[confidence]}`}
    >
      {confidence}
    </span>
  )
}

const STATUS_STYLES: Record<RunStatus, { label: string; cls: string }> = {
  draft: { label: 'Draft', cls: 'border-ink-line text-text-dim' },
  verified: { label: 'Verified', cls: 'border-teal-glow/60 text-teal-glow' },
  priced: { label: 'Priced', cls: 'border-accent/70 bg-accent/10 text-accent' },
}

/** Lifecycle chip for a saved run: draft → verified → priced. */
export function RunStatusChip({ status }: { status: RunStatus }) {
  const s = STATUS_STYLES[status]
  return (
    <span
      className={`inline-flex border px-2 py-0.5 font-mono text-[0.62rem] font-semibold uppercase tracking-[0.12em] ${s.cls}`}
    >
      {s.label}
    </span>
  )
}
