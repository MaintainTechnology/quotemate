// Roofing 3D model — pure helper tests (request builder + parsers).

import { describe, expect, it } from 'vitest'
import {
  ENHANCE_SYSTEM,
  ENHANCE_USER,
  buildMultiviewTaskBody,
  captureOrbitRangeM,
  parseDataUrl,
  parseTripoTask,
  VIEW_ORDER,
} from './model3d'

describe('parseDataUrl', () => {
  it('strips a data-URL prefix and keeps the mime', () => {
    expect(parseDataUrl('data:image/jpeg;base64,AAAA')).toEqual({ mime: 'image/jpeg', base64: 'AAAA' })
    expect(parseDataUrl('data:image/png;base64,BBBB')).toEqual({ mime: 'image/png', base64: 'BBBB' })
  })

  it('treats bare base64 as jpeg', () => {
    expect(parseDataUrl('CCCC')).toEqual({ mime: 'image/jpeg', base64: 'CCCC' })
  })
})

describe('buildMultiviewTaskBody', () => {
  const tokens = { front: 'f', left: 'l', back: 'b', right: 'r' } as const

  it('emits view-keyed inputs in canonical front/left/back/right order', () => {
    const body = buildMultiviewTaskBody(tokens, 'v3.1-20260211')
    expect(body.inputs).toEqual([
      { front: { file_token: 'f' } },
      { left: { file_token: 'l' } },
      { back: { file_token: 'b' } },
      { right: { file_token: 'r' } },
    ])
    expect(VIEW_ORDER).toEqual(['front', 'left', 'back', 'right'])
  })

  it('pins colour-preserving, storage-safe defaults', () => {
    const body = buildMultiviewTaskBody(tokens, 'v3.1-20260211')
    expect(body).toMatchObject({
      model: 'v3.1-20260211',
      texture: true,
      pbr: true,
      texture_quality: 'detailed',
      geometry_quality: 'detailed',
      texture_alignment: 'original_image',
      // Bounds the GLB under the 50 MB storage cap (8K/uncapped hit 62 MB).
      face_limit: 300_000,
    })
  })

  it('emits only the provided views, in canonical order (views may be omitted)', () => {
    const body = buildMultiviewTaskBody({ right: 'r', front: 'f' }, 'v3.1-20260211')
    expect(body.inputs).toEqual([
      { front: { file_token: 'f' } },
      { right: { file_token: 'r' } },
    ])
  })

  it('honours quality overrides', () => {
    const body = buildMultiviewTaskBody(tokens, 'v3.1-20260211', {
      textureQuality: 'extreme',
      faceLimit: 800_000,
    })
    expect(body).toMatchObject({ texture_quality: 'extreme', face_limit: 800_000 })
  })
})

describe('captureOrbitRangeM', () => {
  it('floors at 21 m so small sheds do not go macro', () => {
    expect(captureOrbitRangeM(5)).toBe(21)
    expect(captureOrbitRangeM(10)).toBe(21)
  })

  it('scales linearly with the footprint diagonal (0.8 × d + 8)', () => {
    expect(captureOrbitRangeM(20)).toBe(24)
    expect(captureOrbitRangeM(30)).toBe(32)
    expect(captureOrbitRangeM(50)).toBe(48)
  })

  it('falls back to 36 m when no footprint diagonal is available', () => {
    expect(captureOrbitRangeM(null)).toBe(36)
    expect(captureOrbitRangeM(Number.NaN)).toBe(36)
    expect(captureOrbitRangeM(0)).toBe(36)
    expect(captureOrbitRangeM(-4)).toBe(36)
  })

  it('is strictly closer than the previous max(26, d + 10) framing for every footprint', () => {
    for (let d = 1; d <= 80; d++) {
      expect(captureOrbitRangeM(d)).toBeLessThan(Math.max(26, d + 10))
    }
    expect(captureOrbitRangeM(null)).toBeLessThan(45)
  })
})

describe('enhancement prompt contract (subject-property isolation)', () => {
  it('instructs removal of neighbouring buildings', () => {
    expect(ENHANCE_USER).toMatch(/remove neighbouring/i)
    expect(ENHANCE_SYSTEM).toMatch(/remove/i)
  })

  it('preserves the central property and its own-lot structures unchanged', () => {
    expect(ENHANCE_USER).toMatch(/central (house|property)/i)
    expect(ENHANCE_USER).toMatch(/exactly as captured/i)
    expect(ENHANCE_SYSTEM).toMatch(/never change/i)
  })

  it('still asks for the sharpen/upscale enhancement', () => {
    expect(ENHANCE_USER).toMatch(/sharpness/i)
    expect(ENHANCE_USER).toMatch(/photorealistic/i)
  })
})

describe('parseTripoTask', () => {
  it('reads status/progress/model_url from a success body', () => {
    const parsed = parseTripoTask({
      code: 0,
      data: {
        task_id: 't1',
        status: 'success',
        progress: 100,
        output: { model_url: 'https://cdn.tripo3d.ai/out/model.glb' },
      },
    })
    expect(parsed).toEqual({
      status: 'success',
      progress: 100,
      modelUrl: 'https://cdn.tripo3d.ai/out/model.glb',
      error: null,
    })
  })

  it('is defensive about malformed bodies', () => {
    expect(parseTripoTask(null)).toEqual({ status: 'unknown', progress: null, modelUrl: null, error: null })
    expect(parseTripoTask({ data: { status: 'running', progress: 40, output: {} } })).toEqual({
      status: 'running',
      progress: 40,
      modelUrl: null,
      error: null,
    })
  })
})
