// Source-independent Phase-1 benchmark manifests.
//
// They deliberately contain scenario labels and expected semantic outcomes,
// not provider imagery, URLs, masks, or Google-derived bytes. Real labelled
// source assets can only be connected after the commercial source gate passes.

export const REQUIRED_ROOF_TOPOLOGY_BENCHMARK_SCENARIOS = [
  'gable',
  'hip',
  'l_valley',
  'dormer',
  'tree_covered',
  'solar_covered',
  'multi_structure',
] as const

export type RoofTopologyBenchmarkScenario =
  (typeof REQUIRED_ROOF_TOPOLOGY_BENCHMARK_SCENARIOS)[number]

export type RoofTopologyBenchmarkFixture = {
  id: string
  scenario: RoofTopologyBenchmarkScenario
  dataOrigin: 'synthetic' | 'licensed'
  description: string
  expected: {
    selectedStructureIndex: number
    reviewRequired: boolean
    requiredKinds: ReadonlyArray<'ridge' | 'hip' | 'valley' | 'eave' | 'unknown'>
  }
}

export const ROOF_TOPOLOGY_BENCHMARK_FIXTURES: readonly RoofTopologyBenchmarkFixture[] = [
  {
    id: 'synthetic-gable-01',
    scenario: 'gable',
    dataOrigin: 'synthetic',
    description: 'Simple gable baseline with ridge and exterior eave candidates.',
    expected: { selectedStructureIndex: 1, reviewRequired: false, requiredKinds: ['ridge', 'eave'] },
  },
  {
    id: 'synthetic-hip-01',
    scenario: 'hip',
    dataOrigin: 'synthetic',
    description: 'Four-sided hip roof baseline.',
    expected: { selectedStructureIndex: 1, reviewRequired: false, requiredKinds: ['ridge', 'hip', 'eave'] },
  },
  {
    id: 'synthetic-l-valley-01',
    scenario: 'l_valley',
    dataOrigin: 'synthetic',
    description: 'L-shaped roof with an interior valley candidate.',
    expected: { selectedStructureIndex: 1, reviewRequired: false, requiredKinds: ['ridge', 'hip', 'valley', 'eave'] },
  },
  {
    id: 'licensed-dormer-01',
    scenario: 'dormer',
    dataOrigin: 'licensed',
    description: 'Dormer case with small ambiguous boundaries retained as unknown.',
    expected: { selectedStructureIndex: 1, reviewRequired: true, requiredKinds: ['ridge', 'valley', 'eave', 'unknown'] },
  },
  {
    id: 'licensed-tree-cover-01',
    scenario: 'tree_covered',
    dataOrigin: 'licensed',
    description: 'Tree-overhang case requiring review for occluded edges.',
    expected: { selectedStructureIndex: 1, reviewRequired: true, requiredKinds: ['ridge', 'eave', 'unknown'] },
  },
  {
    id: 'licensed-solar-cover-01',
    scenario: 'solar_covered',
    dataOrigin: 'licensed',
    description: 'Existing rooftop solar case; panels are obstructions, not source data.',
    expected: { selectedStructureIndex: 1, reviewRequired: true, requiredKinds: ['ridge', 'eave', 'unknown'] },
  },
  {
    id: 'synthetic-multi-structure-01',
    scenario: 'multi_structure',
    dataOrigin: 'synthetic',
    description: 'Confirmed dwelling plus a larger detached shed excluded from analysis.',
    expected: { selectedStructureIndex: 1, reviewRequired: false, requiredKinds: ['ridge', 'hip', 'eave'] },
  },
]
