import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('tenant BOM consumers', () => {
  it('uses the trade-keyed priced catalogue contract in the web recipe editor', () => {
    const dashboard = readFileSync(
      resolve(process.cwd(), 'app', 'dashboard', 'page.tsx'),
      'utf8',
    )
    expect(dashboard).toContain('catalogue_categories_by_trade?: Record<string, string[]>')
    expect(dashboard).toContain('catalogueCatsByTrade[(selectedAsm.trade ?? \'\').toLowerCase()]')
  })
})
