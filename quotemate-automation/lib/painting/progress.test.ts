import { describe, expect, it } from 'vitest'
import { paintProgressOpen, paintProgressTitle } from './progress'

describe('paintProgressOpen', () => {
  it('opens while the estimate is running', () => {
    expect(paintProgressOpen({ busy: true, respOk: false, saveState: 'idle' })).toBe(true)
  })

  it('stays open from estimate success through auto-save and navigation', () => {
    expect(paintProgressOpen({ busy: false, respOk: true, saveState: 'idle' })).toBe(true)
    expect(paintProgressOpen({ busy: false, respOk: true, saveState: 'saving' })).toBe(true)
    expect(paintProgressOpen({ busy: false, respOk: true, saveState: 'saved' })).toBe(true)
  })

  it('closes when the save fails so the inline retry is reachable', () => {
    expect(paintProgressOpen({ busy: false, respOk: true, saveState: 'error' })).toBe(false)
  })

  it('stays open when a save error is superseded by a fresh run', () => {
    expect(paintProgressOpen({ busy: true, respOk: true, saveState: 'error' })).toBe(true)
  })

  it('is closed before any estimate has run', () => {
    expect(paintProgressOpen({ busy: false, respOk: false, saveState: 'idle' })).toBe(false)
  })
})

describe('paintProgressTitle', () => {
  it('shows the estimating copy while the estimate runs', () => {
    expect(paintProgressTitle(true)).toBe('Estimating paintable area…')
  })

  it('shows the saving copy once the estimate has landed', () => {
    expect(paintProgressTitle(false)).toBe('Saving estimate & opening its page…')
  })
})
