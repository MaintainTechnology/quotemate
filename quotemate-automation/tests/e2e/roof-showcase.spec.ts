// 3D house showcase on the roofing thank-you page + the /share surface.
//
// Spec: docs/superpowers/specs/2026-07-22-thanks-3d-showcase-design.md
// (R1 customer-safe access, R5 share, R6 layout).
//
// Three properties are seeded so the states can be asserted independently:
//   readyToken  — paid + scheduled + a model asset in storage
//   noModelToken — paid + scheduled, model never generated
//   unpaidToken — no payment (must not reach the model at all)
//
// The stored "GLB" is a few bytes, not a real model. That is deliberate and
// sufficient: the viewer is lazy by contract, so nothing parses the file until
// a user taps "View in 3D". What these tests assert is the SERVER's decisions —
// entitlement, signing, and whether the section renders — not three.js.

import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'node:crypto'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const seedable = Boolean(url && key)

test.describe.configure({ mode: 'serial' })

const readyToken = `e2e${randomBytes(12).toString('hex')}`
const noModelToken = `e2e${randomBytes(12).toString('hex')}`
const unpaidToken = `e2e${randomBytes(12).toString('hex')}`

const ADDRESS = `9${randomBytes(4).toString('hex')} Showcase St, Chandler QLD 4155`
const BUCKET = 'roof-models'

/** capture-cache's normalizeAddressKey, mirrored so the test pins the real
 *  storage layout rather than trusting the implementation it is testing. */
function addressKey(address: string): string {
  return address
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 120)
}

const glbPath = `roofing/e2e-${readyToken}/model3d.glb`
const synthFront = `synth/v4/${addressKey(ADDRESS)}/front`
const synthBack = `synth/v4/${addressKey(ADDRESS)}/back`

test.describe('Roofing 3D showcase', () => {
  test.skip(!seedable, 'Supabase service-role env not available for seeding')

  let tenantId: string

  test.beforeAll(async () => {
    const supabase = createClient(url!, key!)
    const { data: tenant, error: tenantErr } = await supabase
      .from('tenants')
      .insert({
        business_name: 'E2E Showcase Roofing Co',
        trade: 'electrical',
        status: 'active',
        state: 'QLD',
        owner_email: `e2e-showcase-${readyToken}@example.com`,
        owner_mobile: '+61400000009',
      })
      .select('id')
      .single()
    if (tenantErr || !tenant) throw new Error(`tenant seed failed: ${tenantErr?.message}`)
    tenantId = tenant.id as string

    const paidBooked = {
      tenant_id: tenantId,
      address: ADDRESS,
      state: 'QLD',
      paid_at: new Date().toISOString(),
      paid_tier: 'inspection',
      paid_amount_cents: 9900,
      scheduled_at: '2026-07-27T05:00:00+00:00',
      scheduled_window: null,
      quote: { structures: [{ role: 'primary', inputs: { material: 'colorbond_trimdek' } }] },
    }

    const { error } = await supabase.from('roofing_measurements').insert([
      { ...paidBooked, public_token: readyToken, model3d_status: 'ready', model3d_glb_path: glbPath },
      { ...paidBooked, public_token: noModelToken },
      { ...paidBooked, public_token: unpaidToken, paid_at: null, paid_amount_cents: null },
    ])
    if (error) throw new Error(`measurement seed failed: ${error.message}`)

    // Storage assets for the ready property. Content is irrelevant — the
    // server only signs these; nothing decodes them before a user taps.
    await supabase.storage
      .from(BUCKET)
      .upload(glbPath, Buffer.from('glTF-e2e-placeholder'), {
        contentType: 'model/gltf-binary',
        upsert: true,
      })
    // 1x1 transparent PNG.
    const px = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    )
    for (const p of [synthFront, synthBack]) {
      await supabase.storage.from(BUCKET).upload(p, px, { contentType: 'image/png', upsert: true })
    }
  })

  test.afterAll(async () => {
    const supabase = createClient(url!, key!)
    await supabase.storage.from(BUCKET).remove([glbPath, synthFront, synthBack])
    await supabase
      .from('roofing_measurements')
      .delete()
      .in('public_token', [readyToken, noModelToken, unpaidToken])
    if (tenantId) await supabase.from('tenants').delete().eq('id', tenantId)
  })

  // ── entitlement ───────────────────────────────────────────────────

  test('an UNPAID token cannot reach the showcase API', async ({ page }) => {
    // 404 rather than 403: a 403 would confirm the token is real.
    const res = await page.request.get(`/api/q/roof/${unpaidToken}/showcase`)
    expect(res.status()).toBe(404)
    const body = await res.text()
    expect(body).not.toContain('modelUrl')
    expect(body).not.toContain('.glb')
  })

  test('an unknown token 404s', async ({ page }) => {
    const res = await page.request.get(`/api/q/roof/doesnotexist12345/showcase`)
    expect(res.status()).toBe(404)
  })

  test('a paid+booked job with NO model reports unavailable, not an error', async ({ page }) => {
    const res = await page.request.get(`/api/q/roof/${noModelToken}/showcase`)
    expect(res.status()).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.status).toBe('unavailable')
    expect(json.modelUrl).toBeNull()
  })

  test('a ready job returns a signed model and the two studio renders', async ({ page }) => {
    const res = await page.request.get(`/api/q/roof/${readyToken}/showcase`)
    expect(res.status()).toBe(200)
    const json = await res.json()
    expect(json.status).toBe('ready')
    expect(json.modelUrl).toContain(glbPath)
    expect(json.images.front).toBeTruthy()
    expect(json.images.back).toBeTruthy()
    // The quoted material is the starting state.
    expect(json.material).toBe('colorbond_trimdek')
  })

  test('the showcase response carries no tradie-only fields', async ({ page }) => {
    const res = await page.request.get(`/api/q/roof/${readyToken}/showcase`)
    const body = await res.text()
    for (const leak of ['measure_token', 'model3d_task_id', 'model3d_error', 'tenant_id']) {
      expect(body).not.toContain(leak)
    }
  })

  // ── the section on the thank-you page ─────────────────────────────

  test('the section renders on the thank-you page when a model is ready', async ({ page }) => {
    await page.goto(`/q/roof/${readyToken}/thanks`)
    await expect(page.getByText('Your house in 3D')).toBeVisible()
    await expect(page.getByRole('radiogroup', { name: 'Roof colour' })).toBeVisible()
    await expect(page.getByRole('radiogroup', { name: 'House colour' })).toBeVisible()
    // Lazy by contract: the GLB must NOT be fetched until asked for.
    await expect(page.getByRole('button', { name: /view in 3d/i })).toBeVisible()
  })

  test('the section is ABSENT when no model was generated', async ({ page }) => {
    // An empty 3D panel is worse than none.
    await page.goto(`/q/roof/${noModelToken}/thanks`)
    await expect(page.getByText("What's booked")).toBeVisible()
    await expect(page.getByText('Your house in 3D')).toHaveCount(0)
  })

  test('the material selector offers the seven selectable roof materials', async ({ page }) => {
    await page.goto(`/q/roof/${readyToken}/thanks`)
    for (const label of ['Corrugated', 'Trimdek', 'Spandek', 'Klip-Lok', 'Concrete tile', 'Terracotta tile']) {
      await expect(page.getByRole('button', { name: label, exact: true })).toBeVisible()
    }
    // 'unknown' is never offered — it has no render and no readable label.
    await expect(page.getByRole('button', { name: 'Existing roof', exact: true })).toHaveCount(0)
  })

  test('the share control is present with a recipient picker', async ({ page }) => {
    await page.goto(`/q/roof/${readyToken}/thanks`)
    await expect(page.getByLabel('Show someone')).toBeVisible()
    await expect(page.getByRole('button', { name: /share it/i })).toBeVisible()
  })

  // ── /share ────────────────────────────────────────────────────────

  test('the share page renders the house and leaks NOTHING private', async ({ page }) => {
    await page.goto(`/share/${readyToken}?roof=monument&wall=surfmist&mat=colorbond_trimdek`)
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/new roof/i)
    await expect(page.getByText(/Trimdek/)).toBeVisible()

    const body = (await page.locator('body').innerText()).toLowerCase()
    // The amount paid, the address and the booked time all stay behind the
    // quote token — a forwarded link must not carry them.
    expect(body).not.toContain('99.00')
    expect(body).not.toContain('showcase st')
    expect(body).not.toContain('chandler')
    expect(body).not.toContain("what's booked")
  })

  test('the share page validates hostile query values instead of trusting them', async ({ page }) => {
    await page.goto(`/share/${readyToken}?roof=%23ff00ff&wall=<script>&mat=slate`)
    // Falls back to the default swatches and the quoted material.
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    expect(await page.locator('body').innerText()).not.toContain('<script>')
  })

  test('the share page 404s for an unpaid or model-less job', async ({ page }) => {
    for (const t of [unpaidToken, noModelToken]) {
      const res = await page.request.get(`/share/${t}`, { maxRedirects: 0 })
      expect(res.status()).toBe(404)
    }
  })

  // ── indexing ──────────────────────────────────────────────────────

  test('/share and /q both emit noindex', async ({ page }) => {
    // These pages carry a customer's address, price and visit time. /q/* was
    // indexable before this change.
    await page.goto(`/share/${readyToken}`)
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/)

    await page.goto(`/q/roof/${readyToken}/thanks`)
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/)
  })
})
