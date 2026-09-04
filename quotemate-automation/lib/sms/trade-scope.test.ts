// Phase 0 exit gate (admin bulk loader §12/§13) — SMS path.
//
// tradeScopeDirective() feeds the SMS dialog's user message. The inline
// snapshots pin the pilot branches byte-for-byte so refactors cannot
// silently alter what the live agent is told. Two DELIBERATE content
// changes are baked into the pins:
//   - 2026-07-23 US-005: an explicit trades[] now appends a NOT OFFERED
//     decline block for absent dedicated-flow trades (roofing, painting,
//     solar, aircon). Undefined trades[] = config unknown = no declines.
// The carpentry case verifies the §3 fix: a non-pilot trade gets a real
// directive instead of the old degenerate "assume both pilots" fallback.

import { describe, it, expect } from 'vitest'
import { tradeScopeDirective } from './dialog'

describe('tradeScopeDirective — pilot trades unchanged (byte-identical pins)', () => {
  it('both trades', () => {
    expect(tradeScopeDirective(['electrical', 'plumbing']))
      .toMatchInlineSnapshot(`
        "TENANT TRADE SCOPE: this tradie covers BOTH electrical AND plumbing jobs.
          - All easy-5 job_types from both trades are valid:
              ELECTRICAL: downlights, power_points, ceiling_fans, smoke_alarms, outdoor_lighting
              PLUMBING  : blocked_drain, hot_water, tap_repair, tap_replace, toilet_repair, toilet_replace
          - Pick the right tradie noun ("sparky" for electrical jobs,
            "plumber" for plumbing jobs, generic "tradie" until job_type clear).
          - In the opener invite, mention BOTH trades:
              "We do electrical (downlights, GPOs, fans, smoke alarms, outdoor lights)
               AND plumbing (blocked drains, hot water, taps, toilets)."
          - The easy-5 list above is the AUTO-QUOTE job_type VOCABULARY, not the full
            list of what this tradie sells, and the opener list is EXAMPLES, not a limit.
            Any service in the TENANT SERVICES block is EQUALLY in scope. Before telling
            a customer we do not do something, CHECK that block: if it is listed there we
            DO do it — ask its MUST-ASK questions instead of declining. Only decline when
            the job is absent from that block AND from the easy-5 lists, or is named in
            DECLINED SERVICES.
          - NOT OFFERED: roofing, painting, solar, aircon. If the customer asks for one of these,
            say we don't offer that service and suggest a specialist — do NOT quote
            it, do NOT gather job details for it, and do NOT offer the $99 inspection."
      `)
  })

  it('electrical only', () => {
    expect(tradeScopeDirective(['electrical'])).toMatchInlineSnapshot(`
      "TENANT TRADE SCOPE: this tradie covers ELECTRICAL jobs ONLY. They do NOT do plumbing.
        - Valid easy-5 job_types: downlights, power_points, ceiling_fans, smoke_alarms, outdoor_lighting.
        - Always use "sparky" / "the sparkies" as the tradie noun. Never "plumber".
        - In the opener invite, mention ONLY electrical:
            "We do downlights, GPOs (power points), ceiling fans, smoke alarms, and outdoor lights."
        - If the customer mentions a PLUMBING job (blocked drain, hot water, tap, toilet, leak, pipe,
          gas, bathroom reno, drain camera): set action='end_conversation' with a polite redirect
          that makes it clear we only do electrical. Example:
            "Apologies <name>, we're sparkies - we don't do plumbing work.
             You'll need a plumber for that one. All the best!"
        - DO NOT escalate plumbing jobs to a $99 inspection. That's for out-of-scope ELECTRICAL
          work (switchboards, rewires, three-phase, mains/underground cabling), not for the
          wrong trade entirely.
        - The easy-5 list above is the AUTO-QUOTE job_type VOCABULARY, not the full
          list of what this tradie sells, and the opener list is EXAMPLES, not a limit.
          Any service in the TENANT SERVICES block is EQUALLY in scope. Before telling
          a customer we do not do something, CHECK that block: if it is listed there we
          DO do it — ask its MUST-ASK questions instead of declining. Only decline when
          the job is absent from that block AND from the easy-5 lists, or is named in
          DECLINED SERVICES.
        - NOT OFFERED: roofing, painting, solar, aircon. If the customer asks for one of these,
          say we don't offer that service and suggest a specialist — do NOT quote
          it, do NOT gather job details for it, and do NOT offer the $99 inspection."
    `)
  })

  it('plumbing only', () => {
    expect(tradeScopeDirective(['plumbing'])).toMatchInlineSnapshot(`
      "TENANT TRADE SCOPE: this tradie covers PLUMBING jobs ONLY. They do NOT do electrical.
        - Valid easy-5 job_types: blocked_drain, hot_water, tap_repair, tap_replace, toilet_repair, toilet_replace.
        - Always use "plumber" / "the plumbers" as the tradie noun. Never "sparky".
        - In the opener invite, mention ONLY plumbing:
            "We do blocked drains, hot water systems, tap repairs/replacements, and toilet repairs/replacements."
        - If the customer mentions an ELECTRICAL job (downlights, GPO, power point, ceiling fan, smoke alarm,
          outdoor light, switchboard, EV charger): set action='end_conversation' with a polite redirect
          that makes it clear we only do plumbing. Example:
            "Apologies <name>, we're plumbers - we don't do electrical work.
             You'll need a sparky for that one. All the best!"
        - DO NOT escalate electrical jobs to a $99 inspection. That's for out-of-scope PLUMBING
          work (gas fitting, bathroom reno, etc.), not for the wrong trade entirely.
        - The easy-5 list above is the AUTO-QUOTE job_type VOCABULARY, not the full
          list of what this tradie sells, and the opener list is EXAMPLES, not a limit.
          Any service in the TENANT SERVICES block is EQUALLY in scope. Before telling
          a customer we do not do something, CHECK that block: if it is listed there we
          DO do it — ask its MUST-ASK questions instead of declining. Only decline when
          the job is absent from that block AND from the easy-5 lists, or is named in
          DECLINED SERVICES.
        - NOT OFFERED: roofing, painting, solar, aircon. If the customer asks for one of these,
          say we don't offer that service and suggest a specialist — do NOT quote
          it, do NOT gather job details for it, and do NOT offer the $99 inspection."
    `)
  })

  it('undefined → permissive "both", minus the explicit-config declines', () => {
    // US-005: an EXPLICIT trades[] now declares absent trades NOT OFFERED;
    // undefined means "config unknown" and must not invent declines. So
    // undefined equals the both-pilots directive with that block removed.
    const explicit = tradeScopeDirective(['electrical', 'plumbing'])
    const legacy = tradeScopeDirective(undefined)
    expect(legacy).not.toContain('NOT OFFERED')
    expect(explicit).toContain(legacy) // same text, plus the declines
  })

  it('empty array → degenerate "unknown" fallback', () => {
    expect(tradeScopeDirective([])).toBe(
      'TENANT TRADE SCOPE: unknown — proceed as if both trades are supported. (Audit: tenant.trades was empty.)',
    )
  })
})

describe('tradeScopeDirective — non-pilot trade (§3 fix)', () => {
  it('a brand-new trade gets a real directive, not the "both pilots" fallback', () => {
    const directive = tradeScopeDirective(['carpentry'])
    expect(directive).toContain('this tradie covers carpentry work')
    expect(directive).toContain('TENANT CUSTOM')
    // It must NOT wrongly claim the electrical/plumbing pilot scope.
    expect(directive).not.toContain('downlights')
    expect(directive).not.toContain('blocked_drain')
    expect(directive).not.toContain('proceed as if both trades')
  })

  it('multiple non-pilot trades are named together', () => {
    expect(tradeScopeDirective(['carpentry', 'tiling'])).toContain(
      'this tradie covers carpentry and tiling work',
    )
  })
})

// Reported 2026-07-23: "the system responds that it doesn't do roofing, even
// though roofing is already enabled". Root cause was that the pilot branches
// are chosen purely on electrical/plumbing membership, so every extra trade
// was invisible and the easy-5 decline instructions applied to it. All three
// arrays below are REAL production values.
describe('tradeScopeDirective — roofing must never be declined', () => {
  const LIVE = {
    peppers: ['plumbing', 'electrical', 'roofing'],
    atomic: ['electrical', 'plumbing', 'roofing', 'painting', 'aircon', 'signage', 'commercial_painting', 'solar'],
    roofingOnly: ['roofing'],
    elecRoof: ['electrical', 'roofing'],
    plumbRoof: ['plumbing', 'roofing'],
  }

  it('every roofing-enabled tenant is told roofing is in scope', () => {
    for (const trades of Object.values(LIVE)) {
      const d = tradeScopeDirective(trades)
      expect(d.toLowerCase()).toContain('roofing')
    }
  })

  it('a cross-trade tenant keeps its pilot scope AND gains the extra trades', () => {
    const d = tradeScopeDirective(LIVE.peppers)
    expect(d).toContain('BOTH electrical AND plumbing') // pilot scope intact
    expect(d).toContain('THIS TRADIE ALSO COVERS: roofing')
    expect(d).toContain('NEVER tell the customer we do not do them')
  })

  it('names every extra trade a multi-trade tenant holds', () => {
    const d = tradeScopeDirective(LIVE.atomic)
    for (const t of ['roofing', 'painting', 'aircon', 'signage', 'commercial_painting', 'solar']) {
      expect(d).toContain(t)
    }
  })

  // P2 (live 2026-07-24): "Hi" to Sparky (electrical+plumbing+roofing+painting+...)
  // greeted "we do electrical and plumbing" only — the opener omitted the extra
  // trades. The opener instruction must tell the model to mention them too.
  it('P2: the opener is told to mention the extra trades, not just the pilots', () => {
    const d = tradeScopeDirective(LIVE.atomic)
    expect(d).toMatch(/opener[^\n]*mention these/i)
    // a pilot-only tenant keeps the byte-identical pinned opener (no extras).
    expect(tradeScopeDirective(['electrical', 'plumbing'])).not.toMatch(/mention these/i)
  })

  it('a roofing-only tenant is NOT told to decline everything absent from custom services', () => {
    const d = tradeScopeDirective(LIVE.roofingOnly)
    expect(d).toContain('ROOFING IS THEIR TRADE')
    expect(d).toContain('NEVER say we do not do roofing')
    // The generic non-pilot branch would defer to a custom-services list.
    // All three live roofing-only tenants have ZERO custom assemblies, so
    // that branch told the model its in-scope list was empty.
    expect(d).not.toContain('TENANT CUSTOM')
    expect(d).not.toContain('politely decline')
    // ...and it must not offer the pilot job types it cannot do.
    expect(d).not.toContain('blocked_drain')
  })

  it('an electrical+roofing tenant is not told to end_conversation on roofing', () => {
    const d = tradeScopeDirective(LIVE.elecRoof)
    expect(d).toContain('ELECTRICAL jobs ONLY') // legacy pilot line retained
    expect(d).toContain('THIS TRADIE ALSO COVERS: roofing')
    expect(d).toContain('end_conversation because a job is one of these')
  })

  it('pilot-only tenants are completely unchanged (no extra block leaks in)', () => {
    for (const trades of [['electrical'], ['plumbing'], ['electrical', 'plumbing']]) {
      expect(tradeScopeDirective(trades)).not.toContain('THIS TRADIE ALSO COVERS')
    }
  })
})

// US-005 (audit 2026-07-23, Q6) — the DECLINE half. The advertise half
// above tells a roofing-enabled tenant roofing is in scope; but a tenant
// WITHOUT roofing had no instruction at all: the electrical-only branch
// declines plumbing and says nothing about roofing, so the model
// improvised. A tenant with an explicit trades[] that lacks a dedicated-
// flow trade must be told to decline it — no quote, no $99 inspection.
describe('tradeScopeDirective — absent trades are explicitly declined', () => {
  it('an electrical-only tenant is told it does NOT offer roofing', () => {
    const d = tradeScopeDirective(['electrical'])
    expect(d).toContain('NOT OFFERED')
    expect(d).toMatch(/NOT OFFERED[^\n]*roofing/)
    // The instruction must forbid both failure modes we observed.
    expect(d).toMatch(/NOT OFFERED[\s\S]*\$99 inspection/)
  })

  it('a both-pilots tenant without roofing gets the same decline rule', () => {
    const d = tradeScopeDirective(['electrical', 'plumbing'])
    expect(d).toMatch(/NOT OFFERED[^\n]*roofing/)
  })

  it('a roofing-enabled tenant is NOT told roofing is unavailable', () => {
    const d = tradeScopeDirective(['electrical', 'plumbing', 'roofing'])
    expect(d).not.toMatch(/NOT OFFERED[^\n]*roofing/)
    expect(d).toContain('THIS TRADIE ALSO COVERS: roofing')
  })

  it('commercial_painting counts as painting for the decline list', () => {
    const d = tradeScopeDirective(['electrical', 'commercial_painting'])
    expect(d).not.toMatch(/NOT OFFERED[^\n]*\bpainting/)
  })

  it('legacy tenants (no explicit trades[]) get NO invented declines', () => {
    expect(tradeScopeDirective(undefined)).not.toContain('NOT OFFERED')
  })

  it('empty trades[] stays the degenerate fallback, no declines', () => {
    expect(tradeScopeDirective([])).not.toContain('NOT OFFERED')
  })
})

// ─────────────────────────────────────────────────────────────────────────
// Regression: an ENABLED catalogue service must never be contradicted by
// the trade-scope block.
//
// Live 2026-09-04, tenants Sparky and Electrical3. Both hold "Install EV
// charger" ENABLED (tenant_service_offerings.enabled = true, overriding the
// shared_assemblies default_enabled = false), and it renders inside the
// TENANT SERVICES block well within the 40-row cap. The receptionist still
// answered turn 1 with "Sorry Jeff, EV charger installs aren't something we
// take on. We do cover downlights, GPOs, ceiling fans, smoke alarms and
// outdoor lights though" — reciting the easy-5 opener as if it were the
// tenant's whole scope — and only self-corrected ("Actually Jeff, my
// mistake - EV charger installs are something we do") once the customer
// pushed back.
//
// Two causes, both here in tradeScopeDirective:
//   1. the electrical branch named "EV chargers" as an example of
//      out-of-scope ELECTRICAL work, contradicting Rule 6's conditional
//      carve-out ("in scope when TENANT SERVICES lists it"); and
//   2. nothing told the model the easy-5 list was a job_type vocabulary
//      rather than the tradie's full service list.
//
// The Railway fleet hard-scopes every tenant to a single trade
// (service-dialog.ts -> scopeTenantTrades), so multi-trade tenants like
// Sparky render the ELECTRICAL-ONLY branch — which is why the electrical
// branch specifically is the one that shipped the contradiction.
describe('tradeScopeDirective — enabled services are not pre-declined', () => {
  const EASY_5_BRANCHES: ReadonlyArray<readonly string[]> = [
    ['electrical'],
    ['plumbing'],
    ['electrical', 'plumbing'],
  ]

  it('never names EV chargers as out-of-scope electrical work', () => {
    for (const trades of EASY_5_BRANCHES) {
      const d = tradeScopeDirective([...trades])
      expect(d, `trades=${trades.join('+')}`).not.toMatch(
        /out-of-scope ELECTRICAL[\s\S]*EV charger/i,
      )
    }
  })

  it('the $99 examples come from Rule 6 unconditional escalate list only', () => {
    const d = tradeScopeDirective(['electrical'])
    expect(d).toContain('switchboards, rewires, three-phase, mains/underground cabling')
  })

  it('tells the model the easy-5 list is a vocabulary, not the full scope', () => {
    for (const trades of EASY_5_BRANCHES) {
      const d = tradeScopeDirective([...trades])
      expect(d, `trades=${trades.join('+')}`).toContain(
        'not the full',
      )
      expect(d, `trades=${trades.join('+')}`).toContain('TENANT SERVICES')
    }
  })

  it('a plumbing-only tenant still redirects electrical work by trade', () => {
    // The wrong-TRADE redirect is correct and must survive: a plumber does
    // not install EV chargers. Only the out-of-SCOPE framing was wrong.
    const d = tradeScopeDirective(['plumbing'])
    expect(d).toContain("we don't do electrical work")
  })

  it('branches with no easy-5 list do not carry the vocabulary note', () => {
    expect(tradeScopeDirective(['roofing'])).not.toContain('AUTO-QUOTE job_type VOCABULARY')
    expect(tradeScopeDirective(['carpentry'])).not.toContain('AUTO-QUOTE job_type VOCABULARY')
  })
})
