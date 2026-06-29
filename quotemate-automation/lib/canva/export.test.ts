import { describe, it, expect } from 'vitest'
import {
  buildExportJobBody,
  parseExportJob,
  isExportTerminal,
  EXPORTS_ENDPOINT,
} from './export'

describe('buildExportJobBody', () => {
  it('targets a design id with the requested format', () => {
    expect(buildExportJobBody('DAF-1', 'png')).toEqual({ design_id: 'DAF-1', format: { type: 'png' } })
    expect(buildExportJobBody('DAF-1', 'pdf')).toEqual({ design_id: 'DAF-1', format: { type: 'pdf' } })
  })
})

describe('parseExportJob', () => {
  it('reads an in-progress job', () => {
    const j = parseExportJob({ job: { id: 'job-1', status: 'in_progress' } })
    expect(j).toEqual({ id: 'job-1', status: 'in_progress', urls: [], error: null })
  })

  it('reads a successful job with download URLs', () => {
    const j = parseExportJob({ job: { id: 'job-1', status: 'success', urls: ['https://dl/a.png', 'https://dl/b.png'] } })
    expect(j.status).toBe('success')
    expect(j.urls).toEqual(['https://dl/a.png', 'https://dl/b.png'])
  })

  it('surfaces a failure message', () => {
    const j = parseExportJob({ job: { id: 'job-1', status: 'failed', error: { code: 'x', message: 'too big' } } })
    expect(j.status).toBe('failed')
    expect(j.error).toBe('too big')
  })

  it('defaults unknown/empty status to in_progress and filters non-string urls', () => {
    expect(parseExportJob({}).status).toBe('in_progress')
    expect(parseExportJob({ job: { status: 'weird', urls: ['ok', 5, null] } }).urls).toEqual(['ok'])
  })
})

describe('isExportTerminal', () => {
  it('is terminal only for success/failed', () => {
    expect(isExportTerminal('success')).toBe(true)
    expect(isExportTerminal('failed')).toBe(true)
    expect(isExportTerminal('in_progress')).toBe(false)
  })
})

describe('EXPORTS_ENDPOINT', () => {
  it('targets the Connect exports endpoint', () => {
    expect(EXPORTS_ENDPOINT).toBe('https://api.canva.com/rest/v1/exports')
  })
})
