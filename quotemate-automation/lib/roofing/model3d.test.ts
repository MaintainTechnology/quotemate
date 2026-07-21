// Roofing 3D model — pure helper tests (request builder + parsers).

import { afterEach, describe, expect, it } from 'vitest'
import {
  ANATOMY_SYSTEM,
  ANATOMY_USER,
  ENHANCE_SYSTEM,
  ENHANCE_USER,
  MODEL3D_IMAGE_MODEL,
  SYNTH_FRONT_REFERENCE_LABEL,
  SYNTH_SYSTEM,
  SYNTH_USER_BACK,
  SYNTH_USER_FRONT,
  buildMultiviewTaskBody,
  captureLabel,
  captureOrbitRangeM,
  parseDataUrl,
  parseTripoTask,
  selectTripoInputs,
  synthesisInputs,
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
  it('floors at 26 m so small sheds keep a sane standoff', () => {
    expect(captureOrbitRangeM(5)).toBe(26)
    expect(captureOrbitRangeM(10)).toBe(26)
  })

  it('scales with the footprint diagonal (d + 10 m of margin)', () => {
    expect(captureOrbitRangeM(20)).toBe(30)
    expect(captureOrbitRangeM(30)).toBe(40)
    expect(captureOrbitRangeM(50)).toBe(60)
  })

  it('falls back to 45 m when no footprint diagonal is available', () => {
    expect(captureOrbitRangeM(null)).toBe(45)
    expect(captureOrbitRangeM(Number.NaN)).toBe(45)
    expect(captureOrbitRangeM(0)).toBe(45)
    expect(captureOrbitRangeM(-4)).toBe(45)
  })

  it('always clears the whole footprint with margin — a clipped eave breaks the synthesis pass', () => {
    for (let d = 1; d <= 80; d++) {
      expect(captureOrbitRangeM(d)).toBeGreaterThanOrEqual(d + 10)
    }
  })

  it('is wider than the tight 0.8×d + 8 framing it replaced, for every footprint', () => {
    for (let d = 1; d <= 80; d++) {
      expect(captureOrbitRangeM(d)).toBeGreaterThan(Math.max(21, d * 0.8 + 8))
    }
    expect(captureOrbitRangeM(null)).toBeGreaterThan(36)
  })
})

describe('MODEL3D_IMAGE_MODEL', () => {
  const prev = process.env.ROOFING_MODEL3D_IMAGE_MODEL

  afterEach(() => {
    if (prev === undefined) delete process.env.ROOFING_MODEL3D_IMAGE_MODEL
    else process.env.ROOFING_MODEL3D_IMAGE_MODEL = prev
  })

  it('defaults to the GA Nano Banana Pro id — the -preview id was shut down 2026-06-25', () => {
    delete process.env.ROOFING_MODEL3D_IMAGE_MODEL
    expect(MODEL3D_IMAGE_MODEL()).toBe('gemini-3-pro-image')
  })

  it('is env-overridable so a newer snapshot needs no deploy', () => {
    process.env.ROOFING_MODEL3D_IMAGE_MODEL = 'gemini-4-pro-image'
    expect(MODEL3D_IMAGE_MODEL()).toBe('gemini-4-pro-image')
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

  it('pins the camera angle and framing — multiview reconstruction needs consistent views', () => {
    expect(`${ENHANCE_SYSTEM} ${ENHANCE_USER}`).toMatch(/camera angle/i)
    expect(`${ENHANCE_SYSTEM} ${ENHANCE_USER}`).toMatch(/framing/i)
  })

  it('keeps ambiguous frame-edge structures rather than erasing own-lot buildings', () => {
    expect(ENHANCE_USER).toMatch(/unsure|uncertain|in doubt/i)
    expect(ENHANCE_USER).toMatch(/keep it/i)
  })
})

describe('anatomy prompt contract (annotate the polished captures)', () => {
  it('identifies every roof feature the overlay legend promises', () => {
    for (const feature of ['ridge', 'hip', 'valley', 'eave', 'gutter']) {
      expect(ANATOMY_USER.toLowerCase()).toContain(feature)
    }
  })

  it('forbids altering the underlying photograph', () => {
    expect(ANATOMY_SYSTEM).toMatch(/never alter/i)
    expect(ANATOMY_USER).toMatch(/otherwise unchanged/i)
  })
})

describe('captureLabel', () => {
  it('labels each capture so the model knows which view it is looking at', () => {
    expect(captureLabel('front')).toBe('FRONT capture of the house')
    expect(captureLabel('top')).toBe('TOP capture of the house')
  })
})

describe('synthesis prompt contract (two 3D renders of ONE house)', () => {
  it('opens with the brief verbatim — full 3D view, front and back, matching the five screenshots', () => {
    expect(SYNTH_SYSTEM).toContain(
      'Based on the screenshots of the house provided, generate a high-quality full 3D view ' +
        'of the house, including front and back perspectives. The result must be accurate and ' +
        'match exactly what is shown in the five screenshots.',
    )
  })

  it('locks the identity of the building across both renders', () => {
    expect(SYNTH_SYSTEM).toMatch(/ONE single physical building/i)
    expect(SYNTH_SYSTEM).toMatch(/same house at the same address/i)
    expect(SYNTH_SYSTEM).toMatch(/reproduce; you do not design/i)
  })

  it('locks every attribute that could drift between the two images', () => {
    for (const attr of [
      'storey count',
      'roof form',
      'pitch',
      'material and exact colour',
      'frame colour',
      'lighting',
      'camera',
    ]) {
      expect(SYNTH_SYSTEM.toLowerCase()).toContain(attr.toLowerCase())
    }
  })

  it('demands a plain white or grey backdrop with no surroundings at all', () => {
    for (const prompt of [SYNTH_SYSTEM, SYNTH_USER_FRONT, SYNTH_USER_BACK]) {
      expect(prompt).toMatch(/white or light (neutral )?grey/i)
    }
    for (const banned of ['grass', 'trees', 'fences', 'driveways', 'vehicles', 'sky', 'horizon']) {
      expect(SYNTH_SYSTEM.toLowerCase()).toContain(banned)
    }
  })

  it('keeps the foundation while removing the land', () => {
    expect(SYNTH_SYSTEM).toMatch(/foundation edge/i)
    expect(SYNTH_USER_FRONT).toMatch(/foundation edge/i)
    expect(SYNTH_USER_BACK).toMatch(/foundation edge/i)
  })

  it('asks for a 360-degree read across the pair — opposite sides, rotated 180 degrees', () => {
    expect(SYNTH_SYSTEM).toMatch(/360/)
    expect(SYNTH_USER_FRONT).toMatch(/FRONT three-quarter/)
    expect(SYNTH_USER_BACK).toMatch(/REAR three-quarter/)
    expect(SYNTH_USER_BACK).toMatch(/rotated 180 degrees/i)
    expect(SYNTH_USER_BACK).toMatch(/opposite side/i)
    expect(SYNTH_USER_BACK).toMatch(/all four elevations/i)
  })

  it('forbids inventing detail that is not in the captures', () => {
    expect(SYNTH_SYSTEM).toMatch(/Never invent/i)
    expect(SYNTH_SYSTEM).toMatch(/Nothing added, nothing removed/i)
  })

  it('makes the front render the ground truth for the back render', () => {
    expect(SYNTH_FRONT_REFERENCE_LABEL).toMatch(/ground truth/i)
    expect(SYNTH_FRONT_REFERENCE_LABEL).toMatch(/only difference/i)
    expect(SYNTH_FRONT_REFERENCE_LABEL).toMatch(/camera heading/i)
    expect(SYNTH_FRONT_REFERENCE_LABEL).toMatch(/same house/i)
  })
})

describe('synthesisInputs', () => {
  const img = (base64: string) => ({ base64, mime: 'image/jpeg' })
  const all = [
    { view: 'back' as const, image: img('b') },
    { view: 'front' as const, image: img('f') },
    { view: 'top' as const, image: img('t') },
    { view: 'left' as const, image: img('l') },
    { view: 'right' as const, image: img('r') },
  ]

  it('labels every capture and emits them in the canonical order, whatever order they arrived in', () => {
    expect(synthesisInputs(all)).toEqual([
      { image: img('f'), label: 'FRONT capture of the house' },
      { image: img('l'), label: 'LEFT capture of the house' },
      { image: img('r'), label: 'RIGHT capture of the house' },
      { image: img('b'), label: 'BACK capture of the house' },
      { image: img('t'), label: 'TOP capture of the house' },
    ])
  })

  it('refuses an incomplete set — the prompt promises five captures, so it must get five', () => {
    for (const missing of ['front', 'left', 'right', 'back', 'top']) {
      expect(synthesisInputs(all.filter((c) => c.view !== missing))).toBeNull()
    }
    expect(synthesisInputs([])).toBeNull()
  })
})

describe('selectTripoInputs', () => {
  const img = (base64: string) => ({ base64, mime: 'image/jpeg' })
  const polished = [
    { view: 'front' as const, image: img('pf') },
    { view: 'left' as const, image: img('pl') },
    { view: 'right' as const, image: img('pr') },
    { view: 'back' as const, image: img('pb') },
    { view: 'top' as const, image: img('pt') },
  ]

  it('uses ONLY the two synthesised renders when both exist', () => {
    expect(selectTripoInputs(polished, { front: img('sf'), back: img('sb') })).toEqual({
      front: img('sf'),
      back: img('sb'),
    })
  })

  it('falls back to the polished captures when synthesis is off', () => {
    expect(selectTripoInputs(polished, null)).toEqual({
      front: img('pf'),
      left: img('pl'),
      right: img('pr'),
      back: img('pb'),
    })
  })

  it('never mixes a synthesised view with aerial captures when only one render succeeded', () => {
    // A studio-lit front render beside a −50° aerial side view is a worse
    // multiview prior than four consistent aerials.
    expect(selectTripoInputs(polished, { front: img('sf'), back: null })).toEqual(
      selectTripoInputs(polished, null),
    )
    expect(selectTripoInputs(polished, { front: null, back: img('sb') })).toEqual(
      selectTripoInputs(polished, null),
    )
  })

  it('drops the top capture — Tripo has no top slot', () => {
    expect(selectTripoInputs(polished, null)).not.toHaveProperty('top')
  })

  it('passes through whatever slots the fallback actually has', () => {
    expect(selectTripoInputs([{ view: 'front', image: img('pf') }], null)).toEqual({
      front: img('pf'),
    })
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
