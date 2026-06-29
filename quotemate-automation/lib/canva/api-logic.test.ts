import { describe, it, expect } from 'vitest'
import {
  CreateCanvaDesignBody,
  ImportCanvaBody,
  importFormats,
  isCanvaConnected,
  DEFAULT_CANVA_TITLE,
} from './api-logic'

describe('CreateCanvaDesignBody', () => {
  it('accepts an empty body or an optional title', () => {
    expect(CreateCanvaDesignBody.safeParse({}).success).toBe(true)
    expect(CreateCanvaDesignBody.safeParse({ title: 'Promo' }).success).toBe(true)
  })

  it('rejects a blank or oversized title', () => {
    expect(CreateCanvaDesignBody.safeParse({ title: '   ' }).success).toBe(false)
    expect(CreateCanvaDesignBody.safeParse({ title: 'x'.repeat(121) }).success).toBe(false)
  })
})

describe('ImportCanvaBody + importFormats', () => {
  it('accepts an explicit format subset', () => {
    expect(ImportCanvaBody.safeParse({ formats: ['png'] }).success).toBe(true)
    expect(ImportCanvaBody.safeParse({ formats: ['png', 'pdf'] }).success).toBe(true)
  })

  it('rejects an empty or invalid formats array', () => {
    expect(ImportCanvaBody.safeParse({ formats: [] }).success).toBe(false)
    expect(ImportCanvaBody.safeParse({ formats: ['gif'] }).success).toBe(false)
  })

  it('defaults to png + pdf and de-dupes', () => {
    expect(importFormats(null)).toEqual(['png', 'pdf'])
    expect(importFormats({})).toEqual(['png', 'pdf'])
    expect(importFormats({ formats: ['pdf'] })).toEqual(['pdf'])
    expect(importFormats({ formats: ['png', 'png', 'pdf'] })).toEqual(['png', 'pdf'])
  })
})

describe('isCanvaConnected', () => {
  it('is connected only with a refresh token', () => {
    expect(isCanvaConnected({ refresh_token: 'rt' })).toBe(true)
    expect(isCanvaConnected({ refresh_token: null })).toBe(false)
    expect(isCanvaConnected(null)).toBe(false)
  })
})

describe('DEFAULT_CANVA_TITLE', () => {
  it('is a non-empty default', () => {
    expect(DEFAULT_CANVA_TITLE.length).toBeGreaterThan(0)
  })
})
