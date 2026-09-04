// The dashboard EV photo upload route — auth and validation.
// Spec specs/ev-charger-location-photo.md R2 / R20.
//
// The gate is the point of these tests: its public siblings are token-authed
// because a customer holds a one-off link, whereas this one is reached by a
// signed-in tradie. Getting that wrong would leave an open upload endpoint.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'http://localhost:54321'
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'
})

const resolveTenantRequest = vi.fn()
const uploadIntakePhoto = vi.fn()

vi.mock('@/lib/tenant/from-request', () => ({
  resolveTenantRequest: (...a: unknown[]) => resolveTenantRequest(...a),
}))
vi.mock('@/lib/storage/upload', () => ({
  uploadIntakePhoto: (...a: unknown[]) => uploadIntakePhoto(...a),
}))

import { POST, MAX_FILES, MAX_BYTES } from './route'

/** A File of an exact byte size, so the size gate can be exercised. */
function file(name: string, type: string, bytes = 16): File {
  return new File([new Uint8Array(bytes)], name, { type })
}

function req(files: File[]): Request {
  const fd = new FormData()
  for (const f of files) fd.append('photos', f, f.name)
  return new Request('http://localhost/api/tenant/job-quote/photos', { method: 'POST', body: fd })
}

beforeEach(() => {
  resolveTenantRequest.mockReset()
  uploadIntakePhoto.mockReset()
  resolveTenantRequest.mockResolvedValue({ tenant: { id: 'tenant-1' } })
  uploadIntakePhoto.mockImplementation(async (a: { index: number }) => ({
    path: `intake-photos/draft/${a.index}.jpg`,
    signedUrl: `https://signed.example/${a.index}.jpg`,
  }))
})

describe('POST /api/tenant/job-quote/photos', () => {
  it('401s without a tenant', async () => {
    resolveTenantRequest.mockResolvedValue(null)
    const res = await POST(req([file('a.jpg', 'image/jpeg')]))
    expect(res.status).toBe(401)
    expect(uploadIntakePhoto).not.toHaveBeenCalled()
  })

  it('401s when authed but attached to no tenant', async () => {
    resolveTenantRequest.mockResolvedValue({ tenant: null })
    const res = await POST(req([file('a.jpg', 'image/jpeg')]))
    expect(res.status).toBe(401)
  })

  it('accepts JPEG, PNG and WebP', async () => {
    const res = await POST(
      req([file('a.jpg', 'image/jpeg'), file('b.png', 'image/png'), file('c.webp', 'image/webp')]),
    )
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.ok).toBe(true)
    expect(j.count).toBe(3)
    expect(j.paths).toHaveLength(3)
    expect(j.urls).toHaveLength(3)
  })

  it('rejects a non-image MIME', async () => {
    const res = await POST(req([file('nasty.pdf', 'application/pdf')]))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('unsupported_image_type')
    expect(uploadIntakePhoto).not.toHaveBeenCalled()
  })

  it('rejects a fourth file', async () => {
    const res = await POST(
      req([
        file('a.jpg', 'image/jpeg'),
        file('b.jpg', 'image/jpeg'),
        file('c.jpg', 'image/jpeg'),
        file('d.jpg', 'image/jpeg'),
      ]),
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe(`max_${MAX_FILES}_photos`)
    expect(uploadIntakePhoto).not.toHaveBeenCalled()
  })

  it('rejects an oversize file', async () => {
    const res = await POST(req([file('big.jpg', 'image/jpeg', MAX_BYTES + 1)]))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('photo_over_8mb')
  })

  it('rejects an empty submission', async () => {
    const res = await POST(req([]))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('no_photos')
  })

  it('scopes the storage key to the tenant', async () => {
    await POST(req([file('a.jpg', 'image/jpeg')]))
    const arg = uploadIntakePhoto.mock.calls[0][0] as { callId: string }
    expect(arg.callId).toContain('tenant-1')
  })

  it('returns what landed when one file fails, rather than failing the batch', async () => {
    // Photos are optional on this surface (R1) — a partial failure must not
    // cost the tradie the two that worked.
    uploadIntakePhoto
      .mockImplementationOnce(async () => ({ path: 'p/0.jpg', signedUrl: 'u0' }))
      .mockImplementationOnce(async () => {
        throw new Error('storage blip')
      })
    const res = await POST(req([file('a.jpg', 'image/jpeg'), file('b.jpg', 'image/jpeg')]))
    expect(res.status).toBe(200)
    expect((await res.json()).count).toBe(1)
  })

  it('502s when every upload fails', async () => {
    uploadIntakePhoto.mockRejectedValue(new Error('storage down'))
    const res = await POST(req([file('a.jpg', 'image/jpeg')]))
    expect(res.status).toBe(502)
  })
})
