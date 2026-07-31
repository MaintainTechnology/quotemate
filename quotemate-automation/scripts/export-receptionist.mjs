#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────
// export-receptionist.mjs — carve one self-contained NestJS receptionist
// service out of this monorepo, per trade.
//
//   node scripts/export-receptionist.mjs            # all five
//   node scripts/export-receptionist.mjs roofing    # just one
//   node scripts/export-receptionist.mjs --dry      # report, copy nothing
//
// What it does, per trade:
//   1. Copies app/api/sms/inbound/route.ts, app/api/intake/structure/route.ts
//      and app/api/estimate/draft/route.ts, deleting the OTHER trades'
//      handler functions + their call blocks, then stripping the imports
//      that go unused as a result.
//   2. Walks the import graph from those three files and copies the exact
//      closure of lib/ files each trade needs — nothing more.
//   3. Writes the NestJS shell: main.ts (Swagger), modules, controllers,
//      DTOs, tsconfig, package.json with only the deps the closure imports.
//
// Copied lib/ files are BYTE-IDENTICAL to source. The `@/*` path alias is
// preserved (tsconfig paths + tsc-alias at build), so re-running this after
// a monorepo change produces a clean diff instead of a merge conflict.
// ponytail: a copier, not a package registry — the isolation is the point,
// so drift between repos is expected and deliberate. Re-run to re-sync.
// ─────────────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC_ROOT = resolve(HERE, '..')
const OUT_ROOT = 'C:/Users/dalig/Desktop/MaintainTech/MaintainOrg/QuoteMax/Receptionists'

const SRC_PKG = JSON.parse(readFileSync(join(SRC_ROOT, 'package.json'), 'utf8'))

// ── trade config ─────────────────────────────────────────────────────────
// `handlers` = which of the two dedicated SMS receptionists this service
// keeps. electrical/plumbing/solar keep neither: they run the general
// Sonnet dialog (lib/sms/dialog.ts), which is the spine of the route and
// is never removed.
const TRADES = {
  electrical: {
    handlers: [],
    port: 3101,
    blurb: 'Electrical SMS AI receptionist — general dialog intake → Opus estimation → G/B/B quote.',
  },
  plumbing: {
    handlers: [],
    port: 3102,
    blurb: 'Plumbing SMS AI receptionist — general dialog intake → Opus estimation → G/B/B quote.',
  },
  roofing: {
    handlers: ['roofing'],
    port: 3103,
    blurb: 'Roofing SMS AI receptionist — address → measure → deterministic price → /q/roof quote.',
  },
  painting: {
    handlers: ['painting'],
    port: 3104,
    blurb: 'Painting SMS AI receptionist — gather → deterministic estimate → tradie-released quote.',
  },
  solar: {
    handlers: [],
    port: 3105,
    blurb: 'Solar SMS AI receptionist — general dialog intake, wired to the deterministic solar engine.',
  },
}

// Trades whose engine code must be force-included even when the trimmed
// route no longer references it. Solar has no SMS receptionist upstream,
// so nothing in the route pulls lib/solar — include it explicitly so the
// service actually contains the solar engine it is named after.
const FORCE_INCLUDE = {
  solar: ['lib/solar/estimate.ts', 'lib/solar/publish.ts', 'lib/solar/release.ts', 'lib/solar/notify.ts'],
  electrical: ['lib/estimate/electrical-prompt.ts'],
  plumbing: ['lib/estimate/plumbing-prompt.ts'],
  roofing: [],
  painting: [],
}

const ROUTES = [
  { from: 'app/api/sms/inbound/route.ts', to: 'src/receptionist/inbound.route.ts', trim: true },
  { from: 'app/api/intake/structure/route.ts', to: 'src/intake/structure.route.ts', trim: false },
  { from: 'app/api/estimate/draft/route.ts', to: 'src/estimate/draft.route.ts', trim: false },
]

// ── source trimming ──────────────────────────────────────────────────────

/** Index of the `}` matching the `{` at `open`. Skips strings, template
 *  literals, regex-ish slashes and both comment forms. */
function matchBrace(src, open) {
  if (src[open] !== '{') throw new Error(`matchBrace: no '{' at ${open}`)
  let depth = 0
  for (let i = open; i < src.length; i++) {
    const c = src[i]
    const next = src[i + 1]
    if (c === '/' && next === '/') { i = src.indexOf('\n', i); if (i < 0) break; continue }
    if (c === '/' && next === '*') { i = src.indexOf('*/', i + 2) + 1; continue }
    if (c === "'" || c === '"' || c === '`') {
      const quote = c
      i++
      while (i < src.length) {
        if (src[i] === '\\') { i += 2; continue }
        if (src[i] === quote) break
        // `${ ... }` inside a template can hold braces — step over it.
        if (quote === '`' && src[i] === '$' && src[i + 1] === '{') {
          const inner = matchBrace(src, i + 1)
          i = inner + 1
          continue
        }
        i++
      }
      continue
    }
    if (c === '{') depth++
    else if (c === '}') { depth--; if (depth === 0) return i }
  }
  throw new Error(`matchBrace: unbalanced from ${open}`)
}

/** Walk back from `idx` over the contiguous `//` comment block above it. */
function commentBlockStart(src, idx) {
  let lineStart = src.lastIndexOf('\n', idx - 1) + 1
  while (lineStart > 0) {
    const prevStart = src.lastIndexOf('\n', lineStart - 2) + 1
    const line = src.slice(prevStart, lineStart).trim()
    if (!line.startsWith('//')) break
    lineStart = prevStart
  }
  return lineStart
}

/** Remove `async function <name>(args: { ... }): Promise<boolean> { ... }`
 *  plus the comment block documenting it. */
function removeHandler(src, name) {
  const sig = `async function ${name}(args: {`
  const at = src.indexOf(sig)
  if (at < 0) return src
  const anchor = '): Promise<boolean> {'
  const anchorAt = src.indexOf(anchor, at)
  if (anchorAt < 0) throw new Error(`removeHandler: no body anchor for ${name}`)
  const bodyOpen = anchorAt + anchor.length - 1
  const end = matchBrace(src, bodyOpen)
  const start = commentBlockStart(src, at)
  let after = end + 1
  while (src[after] === '\n') after++
  return src.slice(0, start) + src.slice(after)
}

/** Remove `const <flag> = tenant … if (<flag> && …) { … } [else if … { … }]`. */
function removeCallBlock(src, flag) {
  const declSig = `const ${flag} = tenant`
  const declAt = src.indexOf(declSig)
  if (declAt < 0) return src
  const ifSig = `if (${flag} && !inflightContinuation) {`
  const ifAt = src.indexOf(ifSig, declAt)
  if (ifAt < 0) throw new Error(`removeCallBlock: no if-block for ${flag}`)
  let end = matchBrace(src, ifAt + ifSig.length - 1)
  // Consume any `} else if (...) { ... }` / `} else { ... }` tail.
  for (;;) {
    const tail = src.slice(end + 1, end + 40)
    const m = tail.match(/^\s*else\s*(if\s*\()?/)
    if (!m) break
    const braceAt = src.indexOf('{', end + 1 + m[0].length - (m[1] ? 1 : 0))
    if (braceAt < 0) break
    end = matchBrace(src, braceAt)
  }
  const start = commentBlockStart(src, declAt)
  let after = end + 1
  while (src[after] === '\n') after++
  return src.slice(0, start) + src.slice(after)
}

/** Drop import statements (and named specifiers) no longer referenced. */
function stripUnusedImports(src) {
  const importRe = /^import\s+(?:type\s+)?(?:([\w$]+)\s*,\s*)?(?:\{([\s\S]*?)\}|\*\s+as\s+([\w$]+)|([\w$]+))?\s*from\s*'([^']+)'\s*$/gm
  const statements = []
  for (const m of src.matchAll(importRe)) {
    statements.push({ text: m[0], index: m.index, defaultName: m[1] || m[4] || null, named: m[2] || null, star: m[3] || null })
  }
  if (!statements.length) return src

  const importsEnd = statements[statements.length - 1].index + statements[statements.length - 1].text.length
  const body = src.slice(importsEnd)
  const used = (name) => new RegExp(`\\b${name.replace(/\$/g, '\\$')}\\b`).test(body)

  let out = src
  // Rewrite back-to-front so earlier indices stay valid.
  for (const st of [...statements].reverse()) {
    if (!st.defaultName && !st.named && !st.star) continue // side-effect import — keep
    let replacement = null
    if (st.named) {
      const specs = st.named.split(',').map((s) => s.trim()).filter(Boolean)
      const kept = specs.filter((s) => {
        // `type Foo`, `Foo as Bar`, `type Foo as Bar` → the local binding is
        // the last word, after dropping any inline `type` modifier. Missing
        // this deletes every type-only import in the file.
        const local = s.replace(/^type\s+/, '').split(/\s+as\s+/).pop().trim()
        return used(local)
      })
      const defaultUsed = st.defaultName ? used(st.defaultName) : false
      if (!kept.length && !defaultUsed) replacement = ''
      else if (kept.length !== specs.length || (st.defaultName && !defaultUsed)) {
        const typeOnly = /^import\s+type\s/.test(st.text)
        const from = st.text.match(/from\s*'([^']+)'/)[1]
        const head = defaultUsed ? `${st.defaultName}, ` : ''
        const braces = kept.length ? `{ ${kept.join(', ')} }` : ''
        replacement = `import ${typeOnly ? 'type ' : ''}${head}${braces} from '${from}'`
      }
    } else {
      const local = st.star || st.defaultName
      if (!used(local)) replacement = ''
    }
    if (replacement === null) continue
    const before = out.slice(0, st.index)
    let afterIdx = st.index + st.text.length
    if (replacement === '') while (out[afterIdx] === '\n') afterIdx++
    out = before + replacement + (replacement === '' ? '' : '') + out.slice(afterIdx)
  }
  return out
}

/** Next-runtime shims + the `export const maxDuration` Next-only knob.
 *  Every `after()` import in this codebase is the identical one-liner, in
 *  the routes and in four lib/ modules — all of them get the shim. */
function denextify(src, toPath) {
  const depth = toPath.split('/').length - 2 // src/<dir>/file.ts -> 1
  const up = '../'.repeat(depth)
  return src
    .replace(/^import\s*\{\s*after\s*\}\s*from\s*'next\/server'\s*$/m, `import { after } from '${up}runtime/after'`)
    .replace(/^export const maxDuration = \d+\s*$/m, (m) => `// ${m.trim()} — Next-only; NestJS timeout lives in main.ts`)
}

// ── import-graph closure ─────────────────────────────────────────────────

const EXTS = ['.ts', '.tsx', '.mts', '.json']

function resolveSpec(spec, fromFile) {
  let base
  if (spec.startsWith('@/')) base = join(SRC_ROOT, spec.slice(2))
  else if (spec.startsWith('.')) base = resolve(dirname(fromFile), spec)
  else return null // bare specifier → npm dep
  for (const ext of EXTS) if (existsSync(base + ext)) return base + ext
  if (existsSync(base) && !existsSync(base + '.ts')) {
    for (const ext of EXTS) if (existsSync(join(base, 'index' + ext))) return join(base, 'index' + ext)
  }
  if (existsSync(base) && base.endsWith('.json')) return base
  return null
}

/** Drop comments so prose like "derived from 'a recipe'" can't be mistaken
 *  for an import. String and template literals are preserved — the import
 *  specifiers we're after live in them. */
function stripComments(src) {
  let out = ''
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    const next = src[i + 1]
    if (c === '/' && next === '/') { const nl = src.indexOf('\n', i); if (nl < 0) break; out += '\n'; i = nl; continue }
    if (c === '/' && next === '*') { const end = src.indexOf('*/', i + 2); if (end < 0) break; i = end + 1; continue }
    if (c === "'" || c === '"' || c === '`') {
      const quote = c
      out += c
      i++
      while (i < src.length) {
        if (src[i] === '\\') { out += src[i] + (src[i + 1] ?? ''); i += 2; continue }
        out += src[i]
        if (src[i] === quote) break
        i++
      }
      continue
    }
    out += c
  }
  return out
}

// Statement-anchored so only real imports match. `[^'"]*?` cannot cross a
// string literal, which keeps multi-line `import { … } from 'x'` working
// without swallowing unrelated quotes.
const SPEC_PATTERNS = [
  /\b(?:import|export)\b[^'"]*?\bfrom\s*['"]([^'"\n]+)['"]/g,
  /\bimport\s*['"]([^'"\n]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"\n]+)['"]/g,
  /\brequire\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g,
]

/** A module specifier has no whitespace and no trailing prose punctuation. */
const SPEC_SHAPE = /^(?:@[\w.-]+\/)?[\w.@/~-]+$/

function specifiersOf(text) {
  const clean = stripComments(text)
  const found = new Set()
  for (const re of SPEC_PATTERNS) {
    re.lastIndex = 0
    for (const m of clean.matchAll(re)) {
      const spec = m[1].trim()
      if (SPEC_SHAPE.test(spec)) found.add(spec)
    }
  }
  return [...found]
}

function collectClosure(entryFiles, extraSources = []) {
  const seen = new Set()
  const bare = new Set()
  const missing = new Set()
  const queue = []

  const scan = (text, fromPath) => {
    for (const spec of specifiersOf(text)) {
      const r = resolveSpec(spec, fromPath)
      if (r) { if (!seen.has(r)) queue.push(r) }
      else if (!spec.startsWith('.') && !spec.startsWith('@/')) bare.add(spec)
      else missing.add(`${spec} (from ${relative(SRC_ROOT, fromPath)})`)
    }
  }

  // Virtual entries: trimmed route text that isn't on disk yet. Scanned
  // BEFORE the Next shims are swapped in, so `../runtime/after` — which
  // only exists in the generated repo — never looks like a missing file.
  for (const { text, path } of extraSources) scan(text, path)
  for (const f of entryFiles) queue.push(f)

  while (queue.length) {
    const file = queue.pop()
    if (seen.has(file)) continue
    seen.add(file)
    if (file.endsWith('.json')) continue
    scan(readFileSync(file, 'utf8'), file)
  }
  return { files: [...seen], bare: [...bare], missing: [...missing] }
}

/** npm package name from a bare specifier (`@scope/pkg/sub` → `@scope/pkg`). */
function pkgName(spec) {
  if (spec.startsWith('node:')) return null
  const parts = spec.split('/')
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}

// ── file templates ───────────────────────────────────────────────────────

const tpl = {
  after: () => `// Next's \`after()\` runs work once the response is flushed. Nest has no
// equivalent, and the receptionist relies on it for every heavy turn
// (measure, estimate, dispatch) — so the shim runs the callback on the
// next tick and keeps the process alive until it settles.
// ponytail: in-process fire-and-forget, same as Next on a single node.
// Swap for a real queue (BullMQ/SQS) if a turn must survive a redeploy.
const inflight = new Set<Promise<unknown>>()

export function after(fn: () => unknown | Promise<unknown>): void {
  const p = Promise.resolve()
    .then(fn)
    .catch((e) => {
      console.error('[runtime/after] background task threw', e)
    })
    .finally(() => {
      inflight.delete(p)
    })
  inflight.add(p)
}

/** Await every queued background task — used by tests and graceful shutdown. */
export async function drainAfter(): Promise<void> {
  while (inflight.size) await Promise.allSettled([...inflight])
}
`,

  webRequest: () => `import type { Request as ExpressRequest } from 'express'

/** Express request → WHATWG Request, so the copied Next route handlers run
 *  unmodified. The raw body is required: Twilio signs the exact bytes. */
export function toWebRequest(req: ExpressRequest & { rawBody?: Buffer }): Request {
  const proto = (req.headers['x-forwarded-proto'] as string) ?? req.protocol ?? 'http'
  const host = (req.headers['x-forwarded-host'] as string) ?? req.headers.host ?? 'localhost'
  const url = \`\${proto}://\${host}\${req.originalUrl ?? req.url}\`

  const headers = new Headers()
  for (const [k, v] of Object.entries(req.headers)) {
    if (v == null) continue
    headers.set(k, Array.isArray(v) ? v.join(', ') : String(v))
  }

  const method = (req.method ?? 'GET').toUpperCase()
  const hasBody = method !== 'GET' && method !== 'HEAD'
  const body = hasBody ? (req.rawBody ?? Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {}))) : undefined

  return new Request(url, { method, headers, body: body as unknown as BodyInit, duplex: 'half' } as RequestInit)
}

/** Copy a WHATWG Response onto the Express response. */
export async function sendWebResponse(webRes: Response, res: import('express').Response): Promise<void> {
  webRes.headers.forEach((value, key) => res.setHeader(key, value))
  const buf = Buffer.from(await webRes.arrayBuffer())
  res.status(webRes.status).send(buf)
}
`,

  main: (trade, cfg) => `import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { ValidationPipe, Logger } from '@nestjs/common'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { AppModule } from './app.module'
import { drainAfter } from './runtime/after'

const TRADE = '${trade}'

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Twilio signs the raw request bytes — the validator needs them intact.
    rawBody: true,
  })

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
  app.enableShutdownHooks()

  const config = new DocumentBuilder()
    .setTitle(\`QuoteMax \${TRADE} receptionist\`)
    .setDescription(
      '${cfg.blurb}\\n\\n' +
        'Isolated service: this API owns the ${trade} trade only. ' +
        'POST /api/sms/inbound is the Twilio webhook (signature-validated). ' +
        'POST /api/receptionist/simulate is the same pipeline with a JSON body for testing.',
    )
    .setVersion(process.env.npm_package_version ?? '0.1.0')
    .addTag('receptionist', 'SMS turn handling for ${trade}')
    .addTag('intake', 'Intake engine — free text + photos → structured Intake')
    .addTag('estimate', 'Estimation engine — Intake → grounded G/B/B quote')
    .addTag('health', 'Liveness and dependency checks')
    .addApiKey({ type: 'apiKey', name: 'x-sim-key', in: 'header' }, 'sim-key')
    .addBearerAuth({ type: 'http', scheme: 'bearer' }, 'cron-secret')
    .build()

  const doc = SwaggerModule.createDocument(app, config)
  SwaggerModule.setup('api/docs', app, doc, {
    swaggerOptions: { persistAuthorization: true },
    customSiteTitle: \`QuoteMax \${TRADE} receptionist API\`,
  })

  const port = Number(process.env.PORT ?? ${cfg.port})
  const server = await app.listen(port)
  // A roofing measure turn can run ~200-300s; don't let the HTTP layer
  // cut the request out from under it.
  server.setTimeout(Number(process.env.HTTP_TIMEOUT_MS ?? 310_000))

  process.on('SIGTERM', async () => {
    await drainAfter()
    await app.close()
  })

  new Logger('bootstrap').log(\`\${TRADE} receptionist on :\${port} — docs at /api/docs\`)
}

void bootstrap()
`,

  appModule: () => `import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { ReceptionistModule } from './receptionist/receptionist.module'
import { IntakeModule } from './intake/intake.module'
import { EstimateModule } from './estimate/estimate.module'
import { HealthController } from './health/health.controller'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env.local', '.env'] }),
    ReceptionistModule,
    IntakeModule,
    EstimateModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
`,

  receptionistModule: () => `import { Module } from '@nestjs/common'
import { ReceptionistController } from './receptionist.controller'

@Module({ controllers: [ReceptionistController] })
export class ReceptionistModule {}
`,

  receptionistController: (trade) => `import {
  Body, Controller, ForbiddenException, Headers, Post, Req, Res,
} from '@nestjs/common'
import { ApiBody, ApiExcludeEndpoint, ApiOperation, ApiResponse, ApiSecurity, ApiTags } from '@nestjs/swagger'
import type { Request as ExpressRequest, Response as ExpressResponse } from 'express'
import { POST as inboundRoute } from './inbound.route'
import { toWebRequest, sendWebResponse } from '../runtime/web-request'
import { SimulateTurnDto } from './dto/simulate-turn.dto'

const SIM_ENABLED = process.env.SMS_SIMULATE_ENABLED === '1'

@ApiTags('receptionist')
@Controller('api')
export class ReceptionistController {
  /** The live Twilio webhook. Body is form-encoded and signature-checked
   *  inside the route — Swagger can't drive this one, use /simulate. */
  @Post('sms/inbound')
  @ApiExcludeEndpoint()
  async inbound(
    @Req() req: ExpressRequest & { rawBody?: Buffer },
    @Res() res: ExpressResponse,
  ): Promise<void> {
    const webRes = await inboundRoute(toWebRequest(req))
    await sendWebResponse(webRes, res)
  }

  /** Same pipeline, JSON in — this is the endpoint to drive from Swagger.
   *  Guarded: it can send real SMS and mint real quotes. */
  @Post('receptionist/simulate')
  @ApiSecurity('sim-key')
  @ApiOperation({
    summary: 'Run one ${trade} receptionist turn (test harness)',
    description:
      'Synthesises a Twilio webhook from JSON and runs the identical handler. ' +
      'Requires SMS_SIMULATE_ENABLED=1 and a matching x-sim-key header. ' +
      'WARNING: sends real SMS and writes real rows when pointed at live credentials.',
  })
  @ApiBody({ type: SimulateTurnDto })
  @ApiResponse({ status: 202, description: 'Turn accepted; reply is dispatched in the background.' })
  @ApiResponse({ status: 403, description: 'Simulation disabled or bad x-sim-key.' })
  async simulate(
    @Body() dto: SimulateTurnDto,
    @Headers('x-sim-key') simKey: string | undefined,
    @Req() req: ExpressRequest,
  ): Promise<{ accepted: true; trade: string }> {
    const expected = process.env.SIM_API_KEY
    if (!SIM_ENABLED || !expected || simKey !== expected) {
      throw new ForbiddenException('simulation disabled — set SMS_SIMULATE_ENABLED=1 and a matching SIM_API_KEY')
    }

    const form = new URLSearchParams({
      From: dto.from,
      To: dto.to,
      Body: dto.body,
      MessageSid: dto.messageSid ?? \`SM\${Date.now().toString(36)}\${Math.random().toString(36).slice(2, 10)}\`,
      NumMedia: String(dto.mediaUrls?.length ?? 0),
    })
    dto.mediaUrls?.forEach((url, i) => {
      form.set(\`MediaUrl\${i}\`, url)
      form.set(\`MediaContentType\${i}\`, 'image/jpeg')
    })

    const proto = (req.headers['x-forwarded-proto'] as string) ?? 'http'
    const host = req.headers.host ?? 'localhost'
    // SMS_SKIP_SIGNATURE is what the route already checks in dev.
    const webReq = new Request(\`\${proto}://\${host}/api/sms/inbound\`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-quotemax-simulated': '1' },
      body: form.toString(),
    })

    await inboundRoute(webReq)
    return { accepted: true, trade: '${trade}' }
  }
}
`,

  simulateDto: (trade) => `import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsArray, IsOptional, IsString, Matches, MaxLength } from 'class-validator'

export class SimulateTurnDto {
  @ApiProperty({ example: '+61400000001', description: "Customer's mobile, E.164." })
  @IsString()
  @Matches(/^\\+[1-9]\\d{6,15}$/, { message: 'from must be E.164, e.g. +61400000001' })
  from!: string

  @ApiProperty({ example: '+61481613464', description: "The tenant's provisioned SMS number, E.164. Resolves the tenant." })
  @IsString()
  @Matches(/^\\+[1-9]\\d{6,15}$/, { message: 'to must be E.164, e.g. +61481613464' })
  to!: string

  @ApiProperty({ example: ${trade === 'roofing'
    ? "'Hi, after a quote to re-roof my place at 12 Example St, Brisbane'"
    : trade === 'painting'
      ? "'Looking for a quote to repaint the outside of my house'"
      : trade === 'solar'
        ? "'Keen for a solar quote for my place'"
        : trade === 'plumbing'
          ? "'Hot water system is leaking, need a quote'"
          : "'Need 4 double GPOs installed in my garage'"}, description: 'The inbound SMS text.' })
  @IsString()
  @MaxLength(1600)
  body!: string

  @ApiPropertyOptional({ description: 'Twilio MessageSid. Omit and one is generated — reusing a Sid exercises the dedup path.' })
  @IsOptional()
  @IsString()
  messageSid?: string

  @ApiPropertyOptional({ type: [String], description: 'MMS photo URLs attached to the message.' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  mediaUrls?: string[]
}
`,

  intakeModule: () => `import { Module } from '@nestjs/common'
import { IntakeController } from './intake.controller'

@Module({ controllers: [IntakeController] })
export class IntakeModule {}
`,

  intakeController: () => `import { Controller, Post, Req, Res } from '@nestjs/common'
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger'
import type { Request as ExpressRequest, Response as ExpressResponse } from 'express'
import { POST as structureRoute } from './structure.route'
import { toWebRequest, sendWebResponse } from '../runtime/web-request'

/** The intake engine. Internal-only: guarded by CRON_SECRET inside the
 *  route (isCronAuthorised). Path is kept at /api/intake/structure so the
 *  receptionist's existing self-call resolves against APP_URL unchanged. */
@ApiTags('intake')
@Controller('api/intake')
export class IntakeController {
  @Post('structure')
  @ApiSecurity('cron-secret')
  @ApiOperation({
    summary: 'Structure a raw intake (Opus vision + Zod) and hand off to estimation',
    description:
      'Internal route. Requires Authorization: Bearer $CRON_SECRET. ' +
      'Accepts { intake_id } or a raw transcript payload; writes the structured intake, ' +
      'embeds it, then fires the estimate draft.',
  })
  async structure(
    @Req() req: ExpressRequest & { rawBody?: Buffer },
    @Res() res: ExpressResponse,
  ): Promise<void> {
    const webRes = await structureRoute(toWebRequest(req))
    await sendWebResponse(webRes, res)
  }
}
`,

  estimateModule: () => `import { Module } from '@nestjs/common'
import { EstimateController } from './estimate.controller'

@Module({ controllers: [EstimateController] })
export class EstimateModule {}
`,

  estimateController: () => `import { Controller, Post, Req, Res } from '@nestjs/common'
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger'
import type { Request as ExpressRequest, Response as ExpressResponse } from 'express'
import { POST as draftRoute } from './draft.route'
import { toWebRequest, sendWebResponse } from '../runtime/web-request'

/** The estimation engine. Internal-only (CRON_SECRET). Every price still
 *  comes from a tool call and is checked by the grounding validator —
 *  a failure downgrades the whole quote to the inspection route. */
@ApiTags('estimate')
@Controller('api/estimate')
export class EstimateController {
  @Post('draft')
  @ApiSecurity('cron-secret')
  @ApiOperation({
    summary: 'Draft a grounded G/B/B quote from a structured intake',
    description:
      'Internal route. Requires Authorization: Bearer $CRON_SECRET. ' +
      'Runs RAG + tool-calling estimation, validates every line item against the ' +
      'pricing book, mints Stripe sessions and dispatches the quote SMS.',
  })
  async draft(
    @Req() req: ExpressRequest & { rawBody?: Buffer },
    @Res() res: ExpressResponse,
  ): Promise<void> {
    const webRes = await draftRoute(toWebRequest(req))
    await sendWebResponse(webRes, res)
  }
}
`,

  healthController: (trade, required) => `import { Controller, Get } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'

/** Generated from the env vars this service's code actually reads —
 *  see scripts/export-receptionist.mjs in the monorepo. */
const REQUIRED = ${JSON.stringify(required)} as const

@ApiTags('health')
@Controller('api/health')
export class HealthController {
  @Get()
  @ApiOperation({
    summary: 'Liveness + configuration check',
    description: 'Reports which required env vars are present. Never returns their values.',
  })
  check(): {
    ok: boolean
    trade: string
    uptimeSeconds: number
    missing: string[]
  } {
    const missing = REQUIRED.filter((k) => !process.env[k])
    return {
      ok: missing.length === 0,
      trade: '${trade}',
      uptimeSeconds: Math.round(process.uptime()),
      missing,
    }
  }
}
`,

  tsconfig: () => JSON.stringify({
    compilerOptions: {
      module: 'commonjs',
      target: 'ES2022',
      // Matches the monorepo. ES2022 is too old for the copied code —
      // lib/solar reaches for Array.prototype.toSorted (ES2023). Node 20+
      // has it at runtime; this just tells tsc that.
      lib: ['ESNext', 'DOM', 'DOM.Iterable'],
      declaration: false,
      removeComments: false,
      emitDecoratorMetadata: true,
      experimentalDecorators: true,
      allowSyntheticDefaultImports: true,
      esModuleInterop: true,
      resolveJsonModule: true,
      sourceMap: true,
      outDir: './dist',
      baseUrl: './',
      incremental: true,
      skipLibCheck: true,
      strict: true,
      // The copied lib/ is byte-identical to the monorepo, which does not
      // run these two. Turning them on here would fail on vendored code we
      // deliberately do not edit.
      noUnusedLocals: false,
      noUnusedParameters: false,
      forceConsistentCasingInFileNames: true,
      paths: {
        '@/*': ['src/*'],
        // Nest emits CommonJS, so TS resolves stripe's CJS typings — which
        // `export = StripeConstructor` and expose the class only as a
        // namespace member, breaking `let s: Stripe`. The monorepo uses
        // bundler resolution and gets the ESM d.ts (`export default Stripe`)
        // instead. Same API, same runtime require() — just the typings the
        // vendored lib/stripe/client.ts is written against.
        // ponytail: pinned because the dep version is pinned; revisit if
        // stripe ships a single unified d.ts.
        stripe: ['node_modules/stripe/esm/stripe.esm.node.d.ts'],
      },
    },
    include: ['src/**/*'],
    exclude: ['node_modules', 'dist', '**/*.test.ts'],
  }, null, 2) + '\n',

  nestCli: () => JSON.stringify({
    $schema: 'https://json.schemastore.org/nest-cli',
    collection: '@nestjs/schematics',
    sourceRoot: 'src',
    compilerOptions: { deleteOutDir: true, tsConfigPath: 'tsconfig.json' },
  }, null, 2) + '\n',

  gitignore: () => `node_modules/
dist/
.env
.env.local
*.tsbuildinfo
.DS_Store
`,
}

// ── env template ─────────────────────────────────────────────────────────

// Env vars the service cannot start a turn without. Everything else the
// code reads is optional (a provider, a feature flag) and is listed in the
// generated "also referenced" block so nothing is invisible.
const REQUIRED_ENV = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'ANTHROPIC_API_KEY',
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'CRON_SECRET',
  'APP_URL',
]

/** Every `process.env.NAME` the copied code reads. */
function envVarsUsed(files, generated) {
  const found = new Set()
  const add = (text) => {
    for (const m of text.matchAll(/process\.env\.([A-Z][A-Z0-9_]{2,})\b/g)) found.add(m[1])
    for (const m of text.matchAll(/process\.env\[['"]([A-Z][A-Z0-9_]{2,})['"]\]/g)) found.add(m[1])
  }
  for (const f of files) if (!f.endsWith('.json')) add(readFileSync(f, 'utf8'))
  for (const g of generated) add(g.text)
  return [...found].sort()
}

function envExample(trade, cfg, used) {
  const optional = used.filter((v) => !REQUIRED_ENV.includes(v) && v !== 'PORT' && v !== 'NODE_ENV')
  const tradeFlags = {
    roofing: [
      '# Roofing measurement providers',
      'ROOFING_PROVIDER=geoscape',
      'GEOSCAPE_API_KEY=',
      'GOOGLE_MAPS_API_KEY=',
      'ROOFING_EDGE_ANALYSIS_ENABLED=0',
      'SMS_ROOFING_ENABLED=1   # no-tenant fallback only; tenants.trades[] is the real gate',
    ],
    painting: [
      '# Painting area lookup',
      'GOOGLE_MAPS_API_KEY=',
      'SMS_PAINTING_ENABLED=1  # no-tenant fallback only; tenants.trades[] is the real gate',
    ],
    solar: [
      '# Solar sizing + rebate',
      'GOOGLE_MAPS_API_KEY=',
      'SOLAR_AUTO_RELEASE=1',
      'PYLON_ENABLED=0',
    ],
    electrical: ['# Electrical uses the shared pricing book — no extra providers.'],
    plumbing: ['# Plumbing uses the shared pricing book — no extra providers.'],
  }[trade]

  return `# ── QuoteMax ${trade} receptionist ──────────────────────────────────
# ${cfg.blurb}
# Copy to .env.local. NEVER commit a filled-in copy.

PORT=${cfg.port}
NODE_ENV=development

# APP_URL must point at THIS service — the receptionist self-calls
# /api/intake/structure and /api/estimate/draft, which this app serves.
APP_URL=http://localhost:${cfg.port}

# Shared secret for those internal self-calls. Absent in production ⇒ the
# pipeline fails closed and no quotes are produced. Required.
CRON_SECRET=

# ── Data ──────────────────────────────────────────────────────────────
# Named NEXT_PUBLIC_* because the code is copied verbatim from the Next
# monorepo. Nothing here is public — this service is server-only.
NEXT_PUBLIC_SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=

# ── Models ────────────────────────────────────────────────────────────
ANTHROPIC_API_KEY=
SMS_LLM_RECEPTIONIST_ENABLED=1   # 0 = kill switch, falls back to the state machine

# ── Twilio ────────────────────────────────────────────────────────────
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_MESSAGING_SERVICE_SID=
# Dev only — skips inbound signature validation. Never set in production.
SMS_SKIP_SIGNATURE=0

# ── Stripe (test keys unless you mean it) ─────────────────────────────
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=

# ── Swagger test harness ──────────────────────────────────────────────
# /api/receptionist/simulate runs the real pipeline: real SMS, real rows.
SMS_SIMULATE_ENABLED=0
SIM_API_KEY=

${tradeFlags.join('\n')}

# ── Also referenced by this service's code ────────────────────────────
# Auto-listed from every process.env read in src/. All optional: unset
# means the matching provider or feature is simply off.
${optional.map((v) => `# ${v}=`).join('\n')}
`
}

/** Names the trade boundary explicitly, because "isolated" does not mean
 *  "contains no other trade's code" — some shared modules genuinely serve
 *  every trade, and silently deleting them would change behaviour. */
function isolationDoc(trade, cfg, libFiles) {
  const rel = libFiles.map((f) => relative(SRC_ROOT, f).split(sep).join('/'))
  const other = ['roofing', 'painting'].filter((t) => !cfg.handlers.includes(t))
  const foreign = rel.filter((p) => other.some((t) => p.includes(`/${t}-`) || p.startsWith(`lib/${t}/`)))

  return `# Isolation boundary — qm-${trade}-receptionist

This service is deployed and versioned on its own. **Nothing you change
here can affect the other four receptionists.** That is the isolation
guarantee, and it holds unconditionally.

What follows is about tidiness, not safety.

## Yours to customise

| Layer | Path | Safe to edit? |
|---|---|---|
| HTTP surface, Swagger, DTOs | \`src/main.ts\`, \`src/*/[a-z]*.controller.ts\`, \`src/receptionist/dto/\` | Yes — hand-written for this repo, never overwritten. |
| Runtime shims | \`src/runtime/\` | Yes. |
| ${trade[0].toUpperCase() + trade.slice(1)} receptionist + engines | \`src/receptionist/inbound.route.ts\`, \`src/intake/structure.route.ts\`, \`src/estimate/draft.route.ts\` | Yes, but a re-sync overwrites them. |
| Domain code | \`src/lib/\` | Yes, but a re-sync overwrites it. Keep custom logic in the controllers. |

## Why other trades' files are still here

${foreign.length === 0
  ? `None are. This service's closure contains no ${other.join('/')} modules.`
  : `${foreign.length} file(s) belonging to ${other.join('/')} are present:

${foreign.map((p) => `- \`src/${p}\``).join('\n')}

They are **not dead code**. Three real reasons:

1. **Shared conversation state.** All five services read the same
   \`sms_conversations\` row. \`isActiveRoofingFlow\` / \`isActivePaintingFlow\`
   and the idle-state expiry helpers run in every service's spine so this
   one doesn't stomp a thread another service owns. Delete them and a
   multi-trade tenant gets crossed wires.
2. **One shared LLM conversation layer.** \`lib/sms/llm-receptionist.ts\`
   is a single Sonnet module covering every trade's tool schema.
3. **One shared quote renderer.** \`lib/quote/pdf.ts\` imports the roofing
   report builder because the PDF generator handles all trades.

Splitting these is a real refactor, not a delete. Until then they cost
disk, not correctness.`}

## The thing this architecture does not solve

Twilio points a phone number at exactly **one** URL, and a tenant has one
SMS number covering every trade they offer. So:

- **Single-trade tenant** → point the number straight at that service. Done.
- **Multi-trade tenant** → you need a router in front of all five that
  decides which service gets each inbound message. Splitting the code did
  not create that decision and does not make it — it still has to be made
  somewhere, once, before the receptionists see the message.
`
}

function readme(trade, cfg, stats) {
  const Title = trade[0].toUpperCase() + trade.slice(1)
  return `# qm-${trade}-receptionist

${cfg.blurb}

This service owns **${trade} only**. It is a standalone NestJS API — no
runtime dependency on the QuoteMax monorepo or on the other four
receptionists. Changing anything here cannot affect them.

## What's inside

| Piece | Path |
|---|---|
| ${Title} SMS receptionist | \`src/receptionist/inbound.route.ts\` |
| Intake engine | \`src/intake/structure.route.ts\` + \`src/lib/intake/\` |
| Estimation engine | \`src/estimate/draft.route.ts\` + \`src/lib/estimate/\` |
| Domain code | \`src/lib/\` (${stats.libFiles} files, ${stats.libLoc.toLocaleString()} lines) |

## Run it

\`\`\`bash
npm install
cp .env.example .env.local   # then fill it in
npm run start:dev
\`\`\`

Swagger UI: <http://localhost:${cfg.port}/api/docs>

## Endpoints

| Method | Path | Notes |
|---|---|---|
| POST | \`/api/sms/inbound\` | Twilio webhook. Form-encoded, signature-validated. Hidden from Swagger — drive \`/simulate\` instead. |
| POST | \`/api/receptionist/simulate\` | Same pipeline, JSON body. Needs \`SMS_SIMULATE_ENABLED=1\` + \`x-sim-key\`. |
| POST | \`/api/intake/structure\` | Intake engine. Internal — \`Authorization: Bearer $CRON_SECRET\`. |
| POST | \`/api/estimate/draft\` | Estimation engine. Internal — \`Authorization: Bearer $CRON_SECRET\`. |
| GET | \`/api/health\` | Liveness + which env vars are present. |

\`APP_URL\` must point at this service: the receptionist self-calls
\`/api/intake/structure\`, which this app serves itself.

## Two things that will bite you

1. **\`/api/receptionist/simulate\` is not a mock.** It runs the real
   pipeline against whatever credentials are in \`.env.local\` — it sends
   real SMS and writes real rows. Point it at a test tenant, or leave
   \`SMS_SIMULATE_ENABLED=0\`.
2. **Twilio can only point a number at one URL.** Tenants have one SMS
   number covering all their trades, so a multi-trade tenant needs a
   router in front of these five services deciding which one gets the
   message. Single-trade tenants can point straight here.

## Re-syncing from the monorepo

\`src/lib/\` is copied byte-identical from \`quotemate-automation\`. To pull
upstream fixes:

\`\`\`bash
node scripts/export-receptionist.mjs ${trade}
\`\`\`

(run from the monorepo). It rewrites \`src/lib/\` and the three route files
and leaves everything else alone, so local customisation belongs in
\`src/receptionist/\`, \`src/intake/\`, \`src/estimate/\` controllers — not in
\`src/lib/\`, which is overwritten.
`
}

// ── build one trade ──────────────────────────────────────────────────────

function buildTrade(trade, opts) {
  const cfg = TRADES[trade]
  const outDir = join(OUT_ROOT, `qm-${trade}-receptionist`)
  if (!existsSync(outDir)) throw new Error(`target repo missing: ${outDir}`)

  // 1. Trim the three routes.
  const generated = []
  for (const r of ROUTES) {
    let src = readFileSync(join(SRC_ROOT, r.from), 'utf8')
    if (r.trim) {
      for (const [name, flag, key] of [
        ['handleRoofingTurn', 'roofingEnabled', 'roofing'],
        ['handlePaintingTurn', 'paintingEnabled', 'painting'],
      ]) {
        if (cfg.handlers.includes(key)) continue
        src = removeCallBlock(src, flag)
        src = removeHandler(src, name)
      }
      src = stripUnusedImports(src)
    }
    // Keep the pre-shim text for closure scanning; shim only on write.
    generated.push({ path: join(SRC_ROOT, r.from), out: r.to, raw: src, text: denextify(src, r.to) })
  }

  // 2. Closure over the trimmed routes + forced trade engines.
  const forced = (FORCE_INCLUDE[trade] ?? [])
    .map((p) => join(SRC_ROOT, p))
    .filter((p) => existsSync(p))
  const { files, bare, missing } = collectClosure(
    forced,
    generated.map((g) => ({ text: g.raw, path: g.path })),
  )

  const libFiles = files.filter((f) => f.startsWith(join(SRC_ROOT, 'lib') + sep))
  const strays = files.filter((f) => !f.startsWith(join(SRC_ROOT, 'lib') + sep))

  // Every `next` reference in the closure must be the one `after()` import
  // that denextify() rewrites — otherwise this service would silently ship
  // a Next dependency it can't satisfy. Verify rather than assume.
  const AFTER_IMPORT = /^import\s*\{\s*after\s*\}\s*from\s*'next\/server'\s*$/m
  const stubbornNext = []
  for (const f of files) {
    if (f.endsWith('.json')) continue
    const text = readFileSync(f, 'utf8')
    const nextSpecs = specifiersOf(text).filter((s) => s === 'next' || s.startsWith('next/'))
    if (!nextSpecs.length) continue
    if (nextSpecs.length === 1 && nextSpecs[0] === 'next/server' && AFTER_IMPORT.test(text)) continue
    stubbornNext.push(`${relative(SRC_ROOT, f)} → ${nextSpecs.join(', ')}`)
  }

  const deps = new Set()
  for (const b of bare) {
    const n = pkgName(b)
    if (!n) continue
    if (n === 'next' && !stubbornNext.length) continue // fully shimmed away
    deps.add(n)
  }

  const libLoc = libFiles.reduce((n, f) => n + readFileSync(f, 'utf8').split('\n').length, 0)
  const stats = { libFiles: libFiles.length, libLoc, deps: [...deps].sort(), strays, missing, stubbornNext }

  if (opts.dry) return stats

  // 3. Wipe only what we own, then write.
  rmSync(join(outDir, 'src'), { recursive: true, force: true })

  const write = (rel, text) => {
    const p = join(outDir, rel)
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, text)
  }

  for (const f of [...libFiles, ...strays]) {
    const rel = join('src', relative(SRC_ROOT, f)).split(sep).join('/')
    const text = readFileSync(f, 'utf8')
    // .json copies verbatim; .ts gets the same after() shim as the routes.
    write(rel, f.endsWith('.json') ? text : denextify(text, rel))
  }
  for (const g of generated) write(g.out, g.text)

  write('src/runtime/after.ts', tpl.after())
  write('src/runtime/web-request.ts', tpl.webRequest())
  write('src/main.ts', tpl.main(trade, cfg))
  write('src/app.module.ts', tpl.appModule())
  write('src/receptionist/receptionist.module.ts', tpl.receptionistModule())
  write('src/receptionist/receptionist.controller.ts', tpl.receptionistController(trade))
  write('src/receptionist/dto/simulate-turn.dto.ts', tpl.simulateDto(trade))
  write('src/intake/intake.module.ts', tpl.intakeModule())
  write('src/intake/intake.controller.ts', tpl.intakeController())
  write('src/estimate/estimate.module.ts', tpl.estimateModule())
  write('src/estimate/estimate.controller.ts', tpl.estimateController())
  const usedEnv = envVarsUsed(files, generated)
  write('src/health/health.controller.ts', tpl.healthController(trade, REQUIRED_ENV.filter((v) => usedEnv.includes(v))))

  const runtimeDeps = {
    '@nestjs/common': '^11.1.6',
    '@nestjs/config': '^4.0.2',
    '@nestjs/core': '^11.1.6',
    '@nestjs/platform-express': '^11.1.6',
    '@nestjs/swagger': '^11.2.0',
    'class-transformer': '^0.5.1',
    'class-validator': '^0.14.2',
    'reflect-metadata': '^0.2.2',
    rxjs: '^7.8.2',
  }
  for (const d of deps) {
    // Pin the EXACT version the monorepo resolved, not its semver range.
    // Stripe ships the pinned API version in its types, so a caret range
    // installs a newer client than lib/stripe/client.ts is written against
    // and the build fails on an apiVersion literal mismatch.
    const installed = join(SRC_ROOT, 'node_modules', d, 'package.json')
    if (existsSync(installed)) {
      runtimeDeps[d] = JSON.parse(readFileSync(installed, 'utf8')).version
      continue
    }
    const v = SRC_PKG.dependencies?.[d] ?? SRC_PKG.devDependencies?.[d]
    runtimeDeps[d] = v ?? 'latest'
  }

  write('package.json', JSON.stringify({
    name: `qm-${trade}-receptionist`,
    version: '0.1.0',
    private: true,
    description: cfg.blurb,
    scripts: {
      build: 'nest build && tsc-alias -p tsconfig.json',
      start: 'node dist/main',
      'start:dev': 'nest start --watch',
      typecheck: 'tsc --noEmit',
      lint: 'eslint src --ext .ts',
    },
    dependencies: Object.fromEntries(Object.entries(runtimeDeps).sort(([a], [b]) => a.localeCompare(b))),
    devDependencies: {
      '@nestjs/cli': '^11.0.10',
      '@nestjs/schematics': '^11.0.9',
      '@types/express': '^5.0.3',
      '@types/node': '^20.19.9',
      'tsc-alias': '^1.8.16',
      typescript: '^5.9.2',
    },
    engines: { node: '>=20.11' },
  }, null, 2) + '\n')

  write('tsconfig.json', tpl.tsconfig())
  write('nest-cli.json', tpl.nestCli())
  write('.gitignore', tpl.gitignore())
  write('.env.example', envExample(trade, cfg, usedEnv))
  write('README.md', readme(trade, cfg, stats))
  write('ISOLATION.md', isolationDoc(trade, cfg, libFiles))

  return stats
}

// ── main ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const dry = args.includes('--dry')
const wanted = args.filter((a) => !a.startsWith('--'))
const list = wanted.length ? wanted : Object.keys(TRADES)

for (const trade of list) {
  if (!TRADES[trade]) { console.error(`unknown trade: ${trade}`); process.exitCode = 1; continue }
  try {
    const s = buildTrade(trade, { dry })
    console.log(`\n── ${trade} ${dry ? '(dry run)' : ''}`)
    console.log(`   lib files : ${s.libFiles}  (${s.libLoc.toLocaleString()} lines)`)
    console.log(`   npm deps  : ${s.deps.join(', ')}`)
    if (s.strays.length) console.log(`   non-lib   : ${s.strays.map((f) => relative(SRC_ROOT, f)).join(', ')}`)
    if (s.stubbornNext.length) console.log(`   NEXT DEP  : not shimmable — ${s.stubbornNext.join(' | ')}`)
    if (s.missing.length) console.log(`   UNRESOLVED: ${s.missing.slice(0, 10).join(' | ')}${s.missing.length > 10 ? ` (+${s.missing.length - 10})` : ''}`)
  } catch (e) {
    console.error(`\n── ${trade} FAILED: ${e.message}`)
    process.exitCode = 1
  }
}
