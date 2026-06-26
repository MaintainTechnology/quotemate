import { describe, it, expect } from 'vitest'
import { flyerAssetPath, flyerUploadPath, FLYER_BUCKET } from './storage'

describe('flyer storage paths', () => {
  it('namespaces export artifacts by tenant + flyer + kind', () => {
    expect(flyerAssetPath('t1', 'f9', 'png')).toBe('t1/flyers/f9.png')
    expect(flyerAssetPath('t1', 'f9', 'pdf')).toBe('t1/flyers/f9.pdf')
  })

  it('namespaces uploads by tenant', () => {
    expect(flyerUploadPath('t1', 'abc', 'jpg')).toBe('t1/uploads/abc.jpg')
  })

  it('exposes the bucket name', () => {
    expect(FLYER_BUCKET).toBe('flyer-assets')
  })
})
