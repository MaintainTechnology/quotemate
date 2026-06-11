// In-memory handoff of the plan PDF between the Estimator tab and the
// full-view run page. The raw PDF is never stored server-side, so a client
// navigation is the only way the run page can show the plan overlay without
// asking the tradie to re-select the file. Survives App Router client
// navigations (module state), not hard reloads — callers must handle null.

const files = new Map<string, File>()

export function stashPlanFile(extractionId: string, file: File) {
  files.set(extractionId, file)
}

export function getPlanFile(extractionId: string): File | null {
  return files.get(extractionId) ?? null
}
