// IG Engine — provider selector tests. Verifies the config-gated rollout:
// Stability when STABILITY_NIM_URL is set, Gemini otherwise, with an
// explicit IG_IMAGE_PROVIDER override winning over both.

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

  it('selects stability when STABILITY_NIM_URL is set', () => {
    process.env.STABILITY_NIM_URL = 'http://nim.test/v1/infer'
    expect(imageProviderName()).toBe('stability')
    expect(selectImageProvider().name).toBe('stability')
  })

  it('IG_IMAGE_PROVIDER override wins over the URL heuristic', () => {
    process.env.STABILITY_NIM_URL = 'http://nim.test/v1/infer'
    process.env.IG_IMAGE_PROVIDER = 'gemini'
    expect(imageProviderName()).toBe('gemini')

    process.env.IG_IMAGE_PROVIDER = 'stability'
    delete process.env.STABILITY_NIM_URL
    expect(imageProviderName()).toBe('stability')
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
