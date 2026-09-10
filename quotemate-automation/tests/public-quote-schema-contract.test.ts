import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { expect, it } from 'vitest'
import { PUBLIC_QUOTE_SCHEMA, verifyPublicQuoteSchema } from '../lib/quote/public-schema'
import type { SupabaseClient } from '@supabase/supabase-js'

// Exercise the deployed readers' actual projections. A readiness probe must
// not pass while a column required by the page or embedded report is missing.
it.each([
  'app/q/[token]/page.tsx',
  'app/api/q/[token]/html/route.ts',
  'app/api/q/[token]/pdf/route.ts',
])('readiness covers every initial quote column used by %s', file => {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
  let projection: string | undefined
  function visit(node: ts.Node) {
    if (projection !== undefined) return
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'select' && ts.isStringLiteral(node.arguments[0])) {
      const from = node.expression.expression
      if (ts.isCallExpression(from) && ts.isPropertyAccessExpression(from.expression) &&
          from.expression.name.text === 'from' && ts.isStringLiteral(from.arguments[0]) &&
          from.arguments[0].text === 'quotes') projection = node.arguments[0].text
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  expect(projection).toBeDefined()
  const probe = PUBLIC_QUOTE_SCHEMA.find(contract => contract.family === 'generic')!.select.split(',')
  expect(probe).toEqual(expect.arrayContaining(projection!.split(',').map(column => column.trim())))
})

it.each(['customer_released_at', 'pricing_book_version_id', 'applied_discount_pct'])(
  'readiness fails when production is missing %s', async missing => {
    const db = { from(table: string) {
      let projection = ''
      const query = {
        select(value: string) { projection = value; return query },
        limit(value: number) { expect(value).toBe(0); return query },
        async abortSignal(signal: AbortSignal) {
          expect(signal).toBeInstanceOf(AbortSignal)
          return { data: [], error: table === 'quotes' && projection.split(',').includes(missing)
            ? { code: '42703' } : null }
        },
      }
      return query
    } } as unknown as SupabaseClient
    const result = await verifyPublicQuoteSchema(db)
    expect(result.ready).toBe(false)
    expect(result.families.find(family => family.family === 'generic'))
      .toEqual({ family: 'generic', ready: false, errorCode: '42703' })
  },
)
