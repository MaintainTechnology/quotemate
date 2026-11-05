// Offline promotion proof. A successful saved report is not trusted: re-score
// raw captured results against the separately graded fixture and exact sources.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { evaluateDataset } from './eval-quotes.mjs'
import { collectRank1SourceEvidence } from './eval-rank1-evidence.mjs'

export async function verifyRank1Evidence(manifest, { fixturePath, actualsPath, platformRoot }) {
  assert.equal(manifest.rank1Required, true, 'Rank 1 candidate must declare rank1Required:true')
  assert.equal(manifest.rank1Scope, 'all_accounts', 'Rank 1 promotion requires the all_accounts policy')
  // Universal safeguards do not make one trade's price fixtures evidence for
  // another trade. Hold promotion until its actual calculator has an adapter
  // and independently graded captures; never fall back to Electrical results.
  assert.equal(manifest.trade, 'electrical', `Trade-specific graded replay adapter is not yet available for ${manifest.trade}; Electrical evidence cannot certify another trade`)
  assert.equal(manifest.approvalRequired, true, 'Rank 1 requires authenticated tradie approval')
  assert.ok(fixturePath && actualsPath && platformRoot, 'Rank 1 promotion requires raw fixture and estimator capture paths plus platform root')
  const fixture = JSON.parse(readFileSync(resolve(fixturePath), 'utf8'))
  const artifact = JSON.parse(readFileSync(resolve(actualsPath), 'utf8'))
  const report = evaluateDataset({ fixture, artifact, production: true, trade: manifest.trade })
  assert.equal(report.passed, true, `Rank 1 evaluation gate failed: ${report.reasons.join('; ')}`)
  assert.equal(report.accuracy_measured, true, 'Rank 1 promotion requires measured estimator evidence')
  assert.equal(artifact.run.evidence_scope, 'deterministic_quote_core_replay', 'Unexpected evaluation evidence scope')
  const current = collectRank1SourceEvidence(platformRoot)
  assert.deepEqual(artifact.run.source_files, current.sourceFiles, 'Evaluation capture sources differ from the current platform; re-run the candidate capture')
  assert.equal(artifact.run.source_revision, current.sourceRevision, 'Evaluation source revision is not bound to its source contents')
  assert.equal(artifact.run.config_sha256, current.configSha256, 'Evaluation configuration differs from the current runtime/contract')
  for (const path of Object.keys(current.sourceFiles)) {
    const hash = createHash('sha256').update(readFileSync(resolve(platformRoot, path))).digest('hex')
    assert.equal(manifest.platformContractHashes?.[path], hash, `Candidate does not bind the evaluated platform source: ${path}`)
    if (path.startsWith('lib/')) {
      assert.equal(manifest.generatedHashes?.[`src/${path}`], hash, `Candidate runtime differs from evaluated source: ${path}`)
    }
  }
  for (const pair of fixture.pairs.filter((row) => row.intake.trade === manifest.trade)) {
    assert.ok(pair.context.pricing_book && pair.context.resolved_recipe,
      `Rank 1 case ${pair.id} lacks frozen price-book/recipe source evidence`)
    assert.equal(pair.intake.tenant_id, pair.context.tenant_id, `Rank 1 case ${pair.id} has mismatched intake ownership`)
    assert.equal(pair.context.pricing_book.tenant_id, pair.context.tenant_id, `Rank 1 case ${pair.id} has mismatched book ownership`)
  }
  // Re-run the pure estimator, not only the scorecard. A self-consistent edited
  // capture must not pass just because somebody copied expected answers into it.
  // A separate Node process gives TS path aliases a normal loader environment,
  // including when this verifier is called inside a test runner's module VM.
  const replay = await promisify(execFile)(process.execPath, ['--import', 'tsx',
    resolve(platformRoot, 'scripts/eval-rank1-replay.mjs'), resolve(fixturePath), manifest.trade],
  { cwd: platformRoot, timeout: 60000, maxBuffer: 16 * 1024 * 1024, windowsHide: true })
  const replayedArtifact = JSON.parse(replay.stdout)
  assert.equal(replayedArtifact.run.source_revision, current.sourceRevision, 'Runtime changed while loading the evaluation adapter')
  const actuals = new Map(artifact.results.map((row) => [row.id, row.actual]))
  for (const row of replayedArtifact.results) {
    assert.deepEqual(row.actual, actuals.get(row.id), `Captured output differs from actual Rank 1 runtime replay: ${row.id}`)
  }
  assert.equal(collectRank1SourceEvidence(platformRoot).sourceRevision, current.sourceRevision, 'Evaluation source changed during replay')
  return report
}
