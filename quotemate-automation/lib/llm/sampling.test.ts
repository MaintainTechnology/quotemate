import { describe, it, expect } from 'vitest'
import { modelAcceptsTemperature, deterministicSampling } from './sampling'

// Every expectation below was verified against the live Anthropic API on
// 2026-08-04 by sending `temperature: 0` and reading the status code. If one
// of these flips, a production call site is sending a parameter that 400s.
describe('modelAcceptsTemperature', () => {
  it('rejects the models that 400 on `temperature` (verified live)', () => {
    expect(modelAcceptsTemperature('claude-sonnet-5')).toBe(false)
    expect(modelAcceptsTemperature('claude-opus-4-8')).toBe(false)
    expect(modelAcceptsTemperature('claude-opus-4-7')).toBe(false)
  })

  it('accepts the models that still take `temperature` (verified live)', () => {
    expect(modelAcceptsTemperature('claude-sonnet-4-6')).toBe(true)
    expect(modelAcceptsTemperature('claude-haiku-4-5')).toBe(true)
  })

  it('does not confuse a 4-5 minor version for a 5 major', () => {
    // `claude-sonnet-4-5` must not match /sonnet-5/, or a working model
    // silently loses its temperature.
    expect(modelAcceptsTemperature('claude-sonnet-4-5')).toBe(true)
    expect(modelAcceptsTemperature('claude-opus-4-5')).toBe(true)
  })
})

describe('deterministicSampling', () => {
  it('declares temperature 0 where the model accepts it', () => {
    expect(deterministicSampling('claude-sonnet-4-6')).toEqual({ temperature: 0 })
  })

  it('spreads to nothing where the parameter would 400 the request', () => {
    expect(deterministicSampling('claude-sonnet-5')).toEqual({})
  })

  it('is spreadable either way without introducing an undefined key', () => {
    // `{ temperature: undefined }` is NOT equivalent — the AI SDK forwards the
    // key and the provider still sees the parameter.
    expect('temperature' in deterministicSampling('claude-sonnet-5')).toBe(false)
  })
})
