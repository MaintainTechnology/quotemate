// IG Engine — provider selector tests. Gemini is the unconditional default
// (2026-08-04); only an explicit IG_IMAGE_PROVIDER override moves off it.
// The old "STABILITY_NIM_URL set → stability" auto-switch is gone and is
// pinned as gone below — that env var must never re-acquire the power to
// silently route the image stage away from Gemini.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  imageProviderName,
  selectImageProvider,
  imageGenReadiness,
} from './select'

describe('image provider selector', () => {
  const env = { ...process.env }
  beforeEach(() => {
    delete process.env.IG_IMAGE_PROVIDER
    delete process.env.STABILITY_NIM_URL
    delete process.env.GEMINI_API_KEY
  })
  afterEach(() => {
    process.env = { ...env }
  })

  it('defaults to gemini when nothing is configured', () => {
    expect(imageProviderName()).toBe('gemini')
    expect(selectImageProvider().name).toBe('gemini')
  })

  it('stays on gemini even when STABILITY_NIM_URL is set', () => {
    // The regression this guards: STABILITY_NIM_URL used to flip the whole
    // el/plumbing image stage to Stability as a side effect of being set.
    process.env.STABILITY_NIM_URL = 'http://nim.test/v1/infer'
    expect(imageProviderName()).toBe('gemini')
    expect(selectImageProvider().name).toBe('gemini')
  })

  it('only an explicit IG_IMAGE_PROVIDER override moves off gemini', () => {
    process.env.IG_IMAGE_PROVIDER = 'stability'
    expect(imageProviderName()).toBe('stability')

    process.env.IG_IMAGE_PROVIDER = 'replicate'
    expect(imageProviderName()).toBe('replicate')

    process.env.IG_IMAGE_PROVIDER = 'gemini'
    expect(imageProviderName()).toBe('gemini')
  })

  it('ignores an unknown or blank override and stays on gemini', () => {
    process.env.IG_IMAGE_PROVIDER = 'dall-e'
    expect(imageProviderName()).toBe('gemini')
    process.env.IG_IMAGE_PROVIDER = '   '
    expect(imageProviderName()).toBe('gemini')
  })

  it('readiness reflects the selected provider credential', () => {
    // stability selected but URL missing → not ready
    process.env.IG_IMAGE_PROVIDER = 'stability'
    expect(imageGenReadiness()).toMatchObject({ ready: false, provider: 'stability' })
    process.env.STABILITY_NIM_URL = 'http://nim.test/v1/infer'
    expect(imageGenReadiness()).toMatchObject({ ready: true, provider: 'stability' })

    // gemini selected but key missing → not ready
    delete process.env.STABILITY_NIM_URL
    process.env.IG_IMAGE_PROVIDER = 'gemini'
    expect(imageGenReadiness()).toMatchObject({ ready: false, provider: 'gemini' })
    process.env.GEMINI_API_KEY = 'k'
    expect(imageGenReadiness()).toMatchObject({ ready: true, provider: 'gemini' })
  })
})
