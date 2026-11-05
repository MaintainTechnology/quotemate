import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { chromium, expect as browserExpect, type Browser, type BrowserContext } from '@playwright/test'
import { build } from 'esbuild'
import { createServer, type Server } from 'node:http'

type Family = 'sms-recovery' | 'sms-delivery'
type Mode = 'held' | 'error' | 'network-error' | 'malformed' | 'empty' | 'records'
const fixtures = {
  'sms-recovery': {
    loading: 'Loading enquiries…',
    empty: ['No unresolved review requests.', 'No outstanding processing jobs.'],
    stale: 'Showing the last loaded enquiries. Their status may have changed.',
    record: 'Check the saved switchboard request',
    action: 'Mark resolved',
    payload: { jobs: [], tasks: [{ id: 'task-1', trade: 'Electrical', reason: 'Check the saved switchboard request', status: 'open', customer_phone: '+61400000000', notification_error: null, resource_type: 'generic', resource_id: 'quote-1' }] },
    emptyPayload: { jobs: [], tasks: [] },
  },
  'sms-delivery': {
    loading: 'Loading delivery status…',
    empty: ['No messages have been queued yet.'],
    stale: 'Showing the last loaded messages. Their delivery status may have changed.',
    record: 'Your saved quote is ready to review',
    action: 'Retry this message',
    payload: { messages: [{ id: 'message-1', status: 'failed', body: 'Your saved quote is ready to review', to_number: '+61400000000', audience: 'customer', provider_error: '30003', requires_attention: true, created_at: '2026-09-10T00:00:00Z' }] },
    emptyPayload: { messages: [] },
  },
} as const

let browser: Browser, server: Server, origin: string
const contexts: BrowserContext[] = []

beforeAll(async () => {
  const bundled = await build({
    stdin: {
      contents: `import { createRoot } from 'react-dom/client';
        import Recovery from './app/dashboard/sms-recovery/page';
        import Delivery from './app/dashboard/sms-delivery/page';
        const Page = location.pathname.endsWith('sms-delivery') ? Delivery : Recovery;
        createRoot(document.getElementById('app')).render(<Page />);`,
      resolveDir: process.cwd(), loader: 'tsx',
    },
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"test"' },
    plugins: [{ name: 'offline-auth-and-navigation', setup(plugin) {
      plugin.onResolve({ filter: /^@\/lib\/auth\/client-token$|^next\/link$/ }, args => ({ path: args.path, namespace: 'fixture' }))
      plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({
        contents: args.path === 'next/link'
          ? 'export default function Link(props) { return <a {...props} /> }'
          : 'export async function getAuthToken() { return "fixture-owner-token" }',
        loader: 'tsx', resolveDir: process.cwd(),
      }))
    } }],
  })
  const js = bundled.outputFiles[0].text
  server = createServer((request, response) => {
    if (request.url === '/fixture.js') {
      response.setHeader('Content-Type', 'application/javascript')
      response.end(js)
    } else {
      response.setHeader('Content-Type', 'text/html')
      response.end('<!doctype html><div id="app"></div><script src="/fixture.js"></script>')
    }
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  browser = await chromium.launch({ headless: true })
}, 60000)

afterEach(async () => { await Promise.all(contexts.splice(0).map(context => context.close())) })
afterAll(async () => {
  await browser?.close()
  if (server) await new Promise<void>(resolve => server.close(() => resolve()))
})

async function fixture(family: Family, initialMode: Mode = 'held') {
  const context = await browser.newContext()
  contexts.push(context)
  const page = await context.newPage()
  page.setDefaultTimeout(5000)
  const data = fixtures[family]
  const state = { mode: initialMode, gets: 0, posts: [] as unknown[], errors: [] as string[] }
  let release = () => {}
  const gate = new Promise<void>(resolve => { release = resolve })
  page.on('pageerror', error => state.errors.push(error.message))
  await page.route('**/*', async route => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.origin !== origin) return route.abort()
    if (url.pathname !== `/api/tenant/${family}`) return route.continue()
    expect(request.headers().authorization).toBe('Bearer fixture-owner-token')
    if (request.method() === 'POST') {
      state.posts.push(request.postDataJSON())
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    }
    state.gets += 1
    if (state.mode === 'held') await gate
    if (state.mode === 'network-error') return route.abort('failed')
    const body = state.mode === 'records' ? data.payload : state.mode === 'empty' ? data.emptyPayload : { error: 'unavailable' }
    return route.fulfill({ status: state.mode === 'error' ? 503 : 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
  await page.goto(`${origin}/${family}`)
  return { page, state, release, data }
}

describe.each(['sms-recovery', 'sms-delivery'] as const)('%s loading and recovery', family => {
  it('never shows empty success for pending, failed, or invalid loads and refreshes successfully', async () => {
    const { page, state, release, data } = await fixture(family)
    await browserExpect(page.getByRole('status')).toHaveText(data.loading)
    await browserExpect(page.getByRole('button', { name: 'Refreshing…' })).toBeDisabled()
    for (const text of data.empty) await browserExpect(page.getByText(text, { exact: true })).toHaveCount(0)

    state.mode = 'error'
    release()
    await browserExpect(page.getByRole('alert')).toContainText('temporarily unavailable')
    for (const text of data.empty) await browserExpect(page.getByText(text, { exact: true })).toHaveCount(0)
    await browserExpect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled()

    state.mode = 'empty'
    await page.getByRole('button', { name: 'Refresh', exact: true }).click()
    for (const text of data.empty) await browserExpect(page.getByText(text, { exact: true })).toBeVisible()
    await browserExpect(page.getByRole('alert')).toHaveCount(0)

    state.mode = 'network-error'
    await page.getByRole('button', { name: 'Refresh', exact: true }).click()
    await browserExpect(page.getByRole('alert')).toContainText('temporarily unavailable')
    for (const text of data.empty) await browserExpect(page.getByText(text, { exact: true })).toHaveCount(0)

    state.mode = 'records'
    await page.getByRole('button', { name: 'Refresh', exact: true }).click()
    await browserExpect(page.getByText(data.record, { exact: true })).toBeVisible()

    state.mode = 'malformed'
    await page.getByRole('button', { name: 'Refresh', exact: true }).click()
    await browserExpect(page.getByRole('alert')).toContainText('temporarily unavailable')
    await browserExpect(page.getByText(data.record, { exact: true })).toBeVisible()
    await browserExpect(page.getByText(data.stale, { exact: true })).toBeVisible()
    for (const text of data.empty) await browserExpect(page.getByText(text, { exact: true })).toHaveCount(0)

    state.mode = 'records'
    await page.getByRole('button', { name: 'Refresh', exact: true }).click()
    await browserExpect(page.getByRole('alert')).toHaveCount(0)
    await browserExpect(page.getByText(data.stale, { exact: true })).toHaveCount(0)
    expect(state.gets).toBe(6)
    expect(state.posts).toEqual([])
    expect(state.errors).toEqual([])
  })

  it('keeps an action refresh failure visible without hiding records or automatically repeating the action', async () => {
    const { page, state, data } = await fixture(family, 'records')
    await browserExpect(page.getByText(data.record, { exact: true })).toBeVisible()
    state.mode = 'error'
    await page.getByRole('button', { name: data.action, exact: true }).click()
    await browserExpect(page.getByRole('alert')).toContainText('temporarily unavailable')
    await browserExpect(page.getByText(data.stale, { exact: true })).toBeVisible()
    await browserExpect(page.getByText(data.record, { exact: true })).toBeVisible()
    await browserExpect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled()
    expect(state.posts).toEqual([family === 'sms-delivery' ? { id: 'message-1' } : { id: 'task-1', action: 'resolve' }])
    expect(state.errors).toEqual([])
  })
})
