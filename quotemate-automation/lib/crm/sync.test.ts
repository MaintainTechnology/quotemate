import { describe, expect, it } from 'vitest'
import { prepareContactRows } from '@/lib/crm/sync'
import type { CrmContact } from '@/lib/crm/provider'

const mk = (email: string, first?: string): CrmContact => ({
  externalId: 'x',
  email,
  firstName: first ?? null,
  lastName: null,
})

describe('prepareContactRows', () => {
  it('normalises emails and stamps tenant + connection ids', () => {
    const rows = prepareContactRows('t1', 'conn1', [mk('  Lead@X.com ', 'Sam')])
    expect(rows).toEqual([
      {
        tenant_id: 't1',
        connection_id: 'conn1',
        email: 'lead@x.com',
        first_name: 'Sam',
        last_name: null,
        external_id: 'x',
      },
    ])
  })

  it('dedups case-insensitively, keeping the first occurrence', () => {
    const rows = prepareContactRows('t1', 'c', [mk('a@x.com', 'First'), mk('A@X.com', 'Second')])
    expect(rows).toHaveLength(1)
    expect(rows[0].first_name).toBe('First')
  })

  it('drops invalid addresses', () => {
    const rows = prepareContactRows('t1', 'c', [mk('ok@x.com'), mk('broken'), mk('also@bad')])
    expect(rows.map((r) => r.email)).toEqual(['ok@x.com'])
  })

  it('coerces blank names to null', () => {
    const rows = prepareContactRows('t1', 'c', [{ externalId: 'x', email: 'a@x.com', firstName: '  ', lastName: '' }])
    expect(rows[0]).toMatchObject({ first_name: null, last_name: null })
  })

  it('returns an empty array for no contacts', () => {
    expect(prepareContactRows('t', 'c', [])).toEqual([])
  })
})
