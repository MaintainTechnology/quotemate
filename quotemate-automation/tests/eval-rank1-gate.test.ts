import { afterAll, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, relative, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { digest } from '../scripts/eval-hash.mjs'
import { collectRank1SourceEvidence } from '../scripts/eval-rank1-evidence.mjs'
import { verifyRank1Evidence } from '../scripts/receptionist-rank1-gate.mjs'

const platformRoot = fileURLToPath(new URL('..', import.meta.url))
const temporary = mkdtempSync(join(tmpdir(), 'qm-eval-gate-unit-'))
afterAll(() => {
  // Delete only the exact isolated directory this test created.
  if (!relative(resolve(tmpdir()), resolve(temporary)).startsWith('qm-eval-gate-unit-')) throw new Error('Unexpected test cleanup path')
  rmSync(temporary, { recursive: true, force: true })
})

function evidence() {
  const source = collectRank1SourceEvidence(platformRoot)
  const lines = [
    { catalogue_item_id: 'tenant:synthetic', quantity_milli: 1000, unit_price_ex_gst_cents: 1200 },
    { catalogue_item_id: 'labour:pricing_book:synthetic-version:hourly_rate', quantity_milli: 1000, unit_price_ex_gst_cents: 10000 },
  ]
  const tier = { total_ex_gst_cents: 11200, labour_minutes: 60, material_catalogue_ids: ['tenant:synthetic'], line_items: lines }
  const actualTier = { ...tier, gst_rate_bps: 1000, gst_cents: 1120, total_inc_gst_cents: 12320,
    line_items: lines.map((line) => ({ ...line, line_total_ex_gst_cents: line.unit_price_ex_gst_cents })) }
  // These are synthetic contract-test records. They never leave the temporary
  // test directory, never ship as holdouts, and prove no real pricing accuracy.
  const fixture = { schema_version: 2, band_pct: 0, pairs: Array.from({ length: 100 }, (_, index) => ({
    id: `synthetic-${index}`, needs_grading: false,
    intake: { trade: 'electrical', job_type: 'downlights', tenant_id: 'synthetic-tenant', confidence: 'HIGH',
      inspection_required: false, address: 'Synthetic test address',
      scope: { summary: `unit test ${index}`, item_count: 1, specs: { supplied_by: 'tradie', requested_specs: {} } } },
    context: { tenant_id: 'synthetic-tenant', pricing_book_version_id: 'synthetic-version', gst_rate_bps: 1000,
      pricing_book: { id: 'synthetic-book', tenant_id: 'synthetic-tenant', trade: 'electrical',
        gst_registered: true, min_labour_hours: 1, call_out_minimum: 0 },
      resolved_recipe: { assemblyName: 'Synthetic assembly', recipeSourceId: 'synthetic-recipe', recipeRowIds: ['synthetic-bom'],
        taskRows: { tenant: [], shared: [] }, input: {
          bom: [{ material_category: 'downlight', quantity: 1, required: true, unit: 'ea' }],
          tenantMaterials: [{ id: 'synthetic', category: 'downlight', name: 'Synthetic component', unit: 'ea',
            unit_price_ex_gst: 10, active: true, is_preferred: true, brand: null, range_series: null, tier_hint: 'good', properties: {} }],
          sharedMaterials: [], labourHours: 1, hourlyRate: 100, markupPct: 20,
        } } },
    provenance: { classification: 'tradie_verified', holdout: true, graded_by: 'SYNTHETIC CONTRACT TEST',
      graded_at: '2026-09-23T00:00:00Z', source_ref: 'unit test, never grading evidence' },
    expected: { route: 'awaiting_tradie_approval', good: tier, better: tier, best: tier },
  })) }
  const artifact = { schema_version: 2, dataset_sha256: digest(fixture), run: {
    kind: 'estimator_capture', evidence_scope: 'deterministic_quote_core_replay',
    source_revision: source.sourceRevision, source_files: source.sourceFiles,
    config_sha256: source.configSha256, captured_at: '2026-09-23T00:00:00Z',
  }, results: fixture.pairs.map((pair) => ({ id: pair.id, actual: { tenant_id: 'synthetic-tenant',
    pricing_book_version_id: 'synthetic-version', customer_release_allowed: false,
    route: 'awaiting_tradie_approval', good: actualTier, better: actualTier, best: actualTier, review_reason: null } })) }
  const hashes = Object.fromEntries(Object.keys(source.sourceFiles).map((path) => [path,
    createHash('sha256').update(readFileSync(resolve(platformRoot, path))).digest('hex')]))
  const manifest = { rank1Required: true, rank1Scope: 'all_accounts', trade: 'electrical', approvalRequired: true,
    platformContractHashes: hashes,
    generatedHashes: Object.fromEntries(Object.entries(hashes).filter(([path]) => path.startsWith('lib/')).map(([path, hash]) => [`src/${path}`, hash])),
  }
  return { fixture, artifact, manifest }
}
let serial = 0
function verify(data: ReturnType<typeof evidence>) {
  const fixturePath = join(temporary, `fixture-${++serial}.json`)
  const actualsPath = join(temporary, `actuals-${serial}.json`)
  writeFileSync(fixturePath, JSON.stringify(data.fixture))
  writeFileSync(actualsPath, JSON.stringify(data.artifact))
  return verifyRank1Evidence(data.manifest, { fixturePath, actualsPath, platformRoot })
}

describe('Rank 1 release evidence gate', () => {
  it('accepts complete fixture-bound source-bound evidence (synthetic gate test only)', async () => {
    expect((await verify(evidence())).passed).toBe(true)
  }, 30000)
  it('requires raw inputs and an explicit Rank 1 approval-required candidate', async () => {
    const data = evidence(); data.manifest.rank1Required = false
    await expect(verify(data)).rejects.toThrow('rank1Required')
    data.manifest.rank1Required = true; data.manifest.approvalRequired = false
    await expect(verify(data)).rejects.toThrow('tradie approval')
    await expect(verifyRank1Evidence(evidence().manifest, { platformRoot, fixturePath: undefined, actualsPath: undefined })).rejects.toThrow('raw fixture')
  })
  it('re-scores every row instead of trusting a saved passed report', async () => {
    const data = evidence(); data.artifact.results[0].actual.customer_release_allowed = true
    await expect(verify(data)).rejects.toThrow('rubric dimensions failed')
  })
  it('rejects pilot-only designation and never certifies another trade with Electrical evidence', async () => {
    const pilot = evidence(); pilot.manifest.rank1Scope = 'pilot'
    await expect(verify(pilot)).rejects.toThrow('all_accounts')
    for (const trade of ['plumbing','roofing','painting','solar']) {
      const other = evidence(); other.manifest.trade = trade
      await expect(verify(other)).rejects.toThrow('Electrical evidence cannot certify another trade')
    }
  })
  it('rejects fewer than 100, synthetic capture labels and incomplete source snapshots', async () => {
    const tooSmall = evidence(); tooSmall.fixture.pairs.pop(); tooSmall.artifact.results.pop()
    tooSmall.artifact.dataset_sha256 = digest(tooSmall.fixture)
    await expect(verify(tooSmall)).rejects.toThrow('100 graded holdouts')
    const synthetic = evidence(); synthetic.artifact.run.kind = 'synthetic_test'
    await expect(verify(synthetic)).rejects.toThrow('synthetic fixtures')
    const missing = evidence(); delete (missing.fixture.pairs[0].context as Record<string, unknown>).resolved_recipe
    missing.artifact.dataset_sha256 = digest(missing.fixture)
    await expect(verify(missing)).rejects.toThrow('source evidence')
  })
  it('rejects stale capture source/config and a missing candidate binding', async () => {
    const stale = evidence(); stale.artifact.run.source_files['lib/estimate/rank1.ts'] = '0'.repeat(64)
    await expect(verify(stale)).rejects.toThrow('capture sources differ')
    const config = evidence(); config.artifact.run.config_sha256 = '0'.repeat(64)
    await expect(verify(config)).rejects.toThrow('configuration differs')
    const manifest = evidence(); delete manifest.manifest.platformContractHashes['lib/estimate/rank1.ts']
    await expect(verify(manifest)).rejects.toThrow('does not bind')
    const runtime = evidence(); runtime.manifest.generatedHashes['src/lib/estimate/rank1.ts'] = '0'.repeat(64)
    await expect(verify(runtime)).rejects.toThrow('runtime differs')
  })
  it('rejects invented results which score correctly but disagree with the real runtime', async () => {
    const data = evidence()
    // The captured expected/actual remain self-consistent, but the recorded
    // source cannot produce them. Only the actual runtime replay catches this.
    data.fixture.pairs[0].context.resolved_recipe.input.tenantMaterials[0].active = false
    data.artifact.dataset_sha256 = digest(data.fixture)
    await expect(verify(data)).rejects.toThrow('actual Rank 1 runtime replay')
  }, 30000)
})
