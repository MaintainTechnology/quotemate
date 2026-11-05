import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

const exporter = readFileSync('scripts/export-receptionist.mjs', 'utf8')
const contentSource = exporter.slice(exporter.indexOf('const RECEPTIONIST_ENDPOINTS ='), exporter.indexOf('const ROUTES ='))
const generate = runInNewContext(`${contentSource}; webContentTs`) as (trade: string) => string

describe('exported service guidance matches the approval and readiness contracts', () => {
  it.each(['electrical', 'plumbing', 'roofing', 'painting', 'solar'])('%s documents approval before priced release', trade => {
    const generated = generate(trade)
    expect(generated).toContain('authenticated tradie approval')
    expect(generated).toContain('immutable customer release')
    expect(generated).toContain('durable receipt + job')
    expect(generated).toContain('/api/health/ready')
    expect(generated).toContain('Configuration presence only. A successful response does not establish quote capability.')
    expect(generated).not.toContain('usually inside a minute')
    expect(generated).not.toContain('RAG + tool-calling')
  })

  it('does not market missing prices as a paid site inspection or plumbing as automatic pricing', () => {
    expect(generate('electrical')).toContain('unpriced review hold, not an invented quote or an inspection charge')
    expect(generate('plumbing')).toContain('Generic plumbing requests currently need tradie review')
    expect(generate('plumbing')).not.toContain('bookable quote before the van leaves')
  })
})
