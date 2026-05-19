import { describe, expect, it } from 'vitest'
import { resolveEnabledSharedAssembliesForDialog } from './service-scope'

describe('resolveEnabledSharedAssembliesForDialog', () => {
  it('skips hardcoded easy-5 rows already covered by assumption rules', () => {
    const rows = [{
      id: 'gpo',
      name: 'Replace double GPO',
      default_enabled: true,
      category: 'gpo',
      clarifying_questions: [],
    }]

    expect(resolveEnabledSharedAssembliesForDialog(rows, [])).toEqual([])
  })

  it('includes default-on priced services that need catalogue questions', () => {
    const rows = [
      {
        id: 'diagnostic',
        name: 'Diagnostic call-out (fault finding)',
        default_enabled: true,
        category: 'general',
        clarifying_questions: ['What is tripping?'],
      },
      {
        id: 'cctv',
        name: 'CCTV drain inspection',
        default_enabled: true,
        category: 'drain',
        clarifying_questions: ['Which drain line needs the camera?'],
      },
    ]

    expect(resolveEnabledSharedAssembliesForDialog(rows, []).map((r) => r.name)).toEqual([
      'Diagnostic call-out (fault finding)',
      'CCTV drain inspection',
    ])
  })

  it('includes opt-in rows only when the tenant enabled them', () => {
    const rows = [{
      id: 'ev',
      name: 'Install EV charger',
      default_enabled: false,
      category: 'ev_charger',
      clarifying_questions: ['Which charger model?'],
    }]

    expect(resolveEnabledSharedAssembliesForDialog(rows, [])).toEqual([])
    expect(resolveEnabledSharedAssembliesForDialog(rows, [
      { assembly_id: 'ev', enabled: true },
    ]).map((r) => r.name)).toEqual(['Install EV charger'])
  })

  it('respects explicit tenant off toggles for default-on rows', () => {
    const rows = [{
      id: 'prv',
      name: 'Pressure reduction valve install',
      default_enabled: true,
      category: 'valve',
      clarifying_questions: ['Where is the main isolation valve?'],
    }]

    expect(resolveEnabledSharedAssembliesForDialog(rows, [
      { assembly_id: 'prv', enabled: false },
    ])).toEqual([])
  })
})
