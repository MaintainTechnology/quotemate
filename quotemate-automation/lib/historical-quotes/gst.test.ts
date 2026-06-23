import { describe, it, expect } from 'vitest'
import { splitGst } from './gst'

describe('splitGst', () => {
  it('ex basis adds 10% for the inc figure', () => {
    expect(splitGst(100, 'ex')).toEqual({ ex: 100, inc: 110 })
  })

  it('inc basis divides out GST for the ex figure', () => {
    expect(splitGst(110, 'inc')).toEqual({ ex: 100, inc: 110 })
  })

  it('unknown basis defaults to treating the number as inc-GST', () => {
    expect(splitGst(110, 'unknown')).toEqual({ ex: 100, inc: 110 })
  })

  it('non-GST-registered keeps ex == inc', () => {
    expect(splitGst(100, 'ex', false)).toEqual({ ex: 100, inc: 100 })
  })

  it('returns null for a missing or invalid amount', () => {
    expect(splitGst(null, 'inc')).toBeNull()
    expect(splitGst(undefined, 'inc')).toBeNull()
    expect(splitGst(-5, 'inc')).toBeNull()
  })
})
