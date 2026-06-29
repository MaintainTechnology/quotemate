import { describe, it, expect } from 'vitest'
import { FLYER_BUCKET, canvaAssetPath } from './storage'

describe('canva storage paths', () => {
  it('reuses the flyer-assets bucket', () => {
    expect(FLYER_BUCKET).toBe('flyer-assets')
  })

  it('namespaces exports by tenant under canva/', () => {
    expect(canvaAssetPath('t1', 'row-9', 'png')).toBe('t1/canva/row-9.png')
    expect(canvaAssetPath('t1', 'row-9', 'pdf')).toBe('t1/canva/row-9.pdf')
  })

  it('keeps one tenant out of another tenant’s path', () => {
    expect(canvaAssetPath('a', 'r', 'png').startsWith('a/')).toBe(true)
    expect(canvaAssetPath('b', 'r', 'png').startsWith('b/')).toBe(true)
  })
})
