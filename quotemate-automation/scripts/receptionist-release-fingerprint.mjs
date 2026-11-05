import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'

// Trade readiness evidence must name both sides of the release contract: an
// unchanged worker cannot reuse evidence after website approval/rendering changes.
// Front desk has a separately versioned routing contract and keeps its identity.
export function receptionistSourceHash(manifest) {
  const inputs = { generatedHashes: manifest.generatedHashes, buildInputHashes: manifest.buildInputHashes }
  if (manifest.trade !== 'front-desk') {
    assert.ok(manifest.platformContractHashes, 'Trade release identity requires website contract hashes')
    inputs.platformContractHashes = manifest.platformContractHashes
  }
  // Preserve old candidates' identity while preventing a designated Rank 1
  // build from being promoted using legacy readiness/evaluation evidence.
  if (manifest.rank1Required === true) {
    assert.ok(['electrical', 'plumbing', 'roofing', 'painting', 'solar'].includes(manifest.trade), 'Unknown Rank 1 trade')
    inputs.rank1Required = true
    // Keep historical pilot hashes reproducible, but bind every new candidate
    // to the universal policy. Promotion rejects the historical missing scope.
    if (manifest.rank1Scope !== undefined) {
      assert.equal(manifest.rank1Scope, 'all_accounts', 'Rank 1 scope must cover all accounts')
      inputs.rank1Scope = manifest.rank1Scope
    }
  }
  return createHash('sha256').update(JSON.stringify(inputs)).digest('hex')
}
