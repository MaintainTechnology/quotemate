import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname, relative, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { digest } from './eval-hash.mjs'

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Runtime import closure, excluding imports erased by TypeScript. This binds
 * local source contents and locked package/alias configuration, not Git HEAD. */
export function collectRank1SourceEvidence(platformRoot = defaultRoot) {
  const root = resolve(platformRoot)
  const sourceFiles = {}
  const visit = (absolute) => {
    const path = relative(root, absolute).replaceAll('\\', '/')
    if (path.startsWith('../') || path === '..') throw new Error('Runtime dependency leaves the platform root')
    if (sourceFiles[path]) return
    const source = readFileSync(absolute, 'utf8')
    sourceFiles[path] = digest(source)
    if (!['.ts', '.mjs', '.js'].includes(extname(absolute))) return
    const ast = ts.createSourceFile(absolute, source, ts.ScriptTarget.Latest, true)
    for (const statement of ast.statements) {
      if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue
      if (ts.isImportDeclaration(statement) && statement.importClause?.isTypeOnly) continue
      if (ts.isExportDeclaration(statement) && statement.isTypeOnly) continue
      if (!statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) continue
      const name = statement.moduleSpecifier.text
      if (!name.startsWith('.') && !name.startsWith('@/')) continue
      const pathBase = name.startsWith('@/') ? resolve(root, name.slice(2)) : resolve(dirname(absolute), name)
      const file = [pathBase, `${pathBase}.ts`, `${pathBase}.mjs`, `${pathBase}.js`, resolve(pathBase, 'index.ts')].find(existsSync)
      if (!file) throw new Error(`Cannot fingerprint local dependency ${name} from ${path}`)
      visit(file)
    }
  }
  for (const path of ['scripts/eval-rank1-adapter.ts', 'lib/estimate/rank1.ts', 'lib/estimate/rank1-policy.ts', 'scripts/eval-quotes.mjs',
    'scripts/receptionist-rank1-gate.mjs', 'scripts/eval-rank1-replay.mjs', 'package.json', 'pnpm-lock.yaml', 'tsconfig.json']) visit(resolve(root, path))
  const sorted = Object.fromEntries(Object.entries(sourceFiles).sort(([a], [b]) => a.localeCompare(b)))
  const sourceHash = digest(sorted)
  return { sourceFiles: sorted, sourceRevision: `source-sha256:${sourceHash}`,
    configSha256: digest({ sourceHash, node: process.version, contract: 3,
      policy: 'rank1_all_accounts_frozen_inputs', rounding: 'half_up_unit_then_line_then_gst' }) }
}
