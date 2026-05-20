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

  it('no-tenant fallback (assumeAllEnabled) includes opt-in migration-021 extras', () => {
    // The dev shared SMS number has no tenant attached. Without this
    // fallback the dialog declines LED strip, security camera, doorbell,
    // garbage disposal, rainwater tank, water filter as out_of_scope.
    const rows = [
      { id: 'strip', name: 'Install LED strip lighting', default_enabled: false, category: 'strip_light', clarifying_questions: ['How many metres?'] },
      { id: 'cam', name: 'Install security camera (single)', default_enabled: false, category: 'security_camera', clarifying_questions: ['How many cameras?'] },
      { id: 'tank', name: 'Install rainwater tank', default_enabled: false, category: 'rainwater_tank', clarifying_questions: ['Tank size?'] },
      // Hardcoded easy-5 still filtered out even in fallback mode
      { id: 'downlight', name: 'Install LED downlight', default_enabled: true, category: 'downlight', clarifying_questions: [] },
    ]

    const fallback = resolveEnabledSharedAssembliesForDialog(rows, [], {
      assumeAllEnabled: true,
    })
    expect(fallback.map((r) => r.name)).toEqual([
      'Install LED strip lighting',
      'Install security camera (single)',
      'Install rainwater tank',
    ])
  })
})
