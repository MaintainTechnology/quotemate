// ════════════════════════════════════════════════════════════════════
// Painting — progress-modal open/copy logic (pure, no I/O).
//
// Mirrors the roofing measure page's MeasureProgressModal condition
// (app/dashboard/roofing/measure/page.tsx — open while measuring AND
// through the auto-save + navigation; only a save error drops back to
// the inline result so the manual Save retry is reachable).
//
// Split out of /dashboard/painting so the truth table is unit-testable
// (house pattern: lib/painting/publish-gate.ts).
// ════════════════════════════════════════════════════════════════════

export type PaintSaveState = 'idle' | 'saving' | 'saved' | 'error'

/** PURE — whether the blocking progress modal is showing. */
export function paintProgressOpen(args: {
  busy: boolean
  respOk: boolean
  saveState: PaintSaveState
}): boolean {
  return args.busy || (args.respOk && args.saveState !== 'error')
}

/** PURE — the modal's live status line. */
export function paintProgressTitle(busy: boolean): string {
  return busy ? 'Estimating paintable area…' : 'Saving estimate & opening its page…'
}
