// Roofing 3D model — pure helper tests (request builder + parsers).

import { describe, expect, it } from 'vitest'
import { buildMultiviewTaskBody, parseDataUrl, parseTripoTask, VIEW_ORDER } from './model3d'

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

  it('honours quality overrides', () => {
    const body = buildMultiviewTaskBody(tokens, 'v3.1-20260211', {
      textureQuality: 'extreme',
      faceLimit: 800_000,
    })
    expect(body).toMatchObject({ texture_quality: 'extreme', face_limit: 800_000 })
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
