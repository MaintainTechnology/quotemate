// Trust-video generation — pure parts (spec tradie-trust-video-generation R7):
// prompt builder, script validation, slot state machine, auto-gen guard, and
// the tolerant Veo response extraction.

import { describe, expect, it } from 'vitest'
import {
  MAX_SCRIPT_CHARS,
  SLOT_URL_COLUMN,
  buildAttemptLadder,
  buildTrustVideoPrompt,
  defaultScript,
  extractRaiReason,
  extractVideoUri,
  isPersonNameBlock,
  readSlotState,
  scriptMentionsPersonalName,
  shouldAutoGenerate,
  trustVideoModel,
  validateScript,
  withSlotState,
} from './trust-video'

describe('defaultScript', () => {
  it('welcome introduces the business and invites the site visit', () => {
    const s = defaultScript('welcome', 'Bob Roofing')
    expect(s).toContain('Bob Roofing')
    expect(s.toLowerCase()).toContain('site visit')
  })

  it('thankyou thanks for the accepted quote and promises the confirmation call', () => {
    const s = defaultScript('thankyou', 'Bob Roofing')
    expect(s).toContain('accepting our quote')
    expect(s).toContain('confirm the exact time')
  })

  it('personalises the intro with the contact name from the account', () => {
    expect(defaultScript('welcome', 'Bob Roofing', 'Bob')).toContain("I'm Bob from Bob Roofing")
    expect(defaultScript('thankyou', 'Bob Roofing', 'Bob')).toContain("it's Bob from Bob Roofing")
  })

  it('welcome carries the "Why Choose Me" promise', () => {
    const s = defaultScript('welcome', 'Bob Roofing', 'Bob')
    expect(s).toContain('No shortcuts and no surprises')
    expect(s).toContain('built to last')
  })

  it('default scripts obey the copy rules: no emoji, exclamations, or em-dashes', () => {
    for (const slot of ['welcome', 'thankyou'] as const) {
      for (const contact of [null, 'Bob']) {
        const s = defaultScript(slot, 'Bob Roofing', contact)
        expect(s).not.toMatch(/!|—|[\u{1F300}-\u{1FAFF}]/u)
        expect(s.length).toBeLessThanOrEqual(MAX_SCRIPT_CHARS)
      }
    }
  })
})

describe('validateScript', () => {
  it('passes clean scripts through, collapsing whitespace', () => {
    expect(validateScript('  Hi   there.  ')).toEqual({ ok: true, script: 'Hi there.' })
  })

  it('null/blank → no custom script (defaults apply)', () => {
    expect(validateScript(null)).toEqual({ ok: true, script: null })
    expect(validateScript('   ')).toEqual({ ok: true, script: null })
  })

  it('rejects over-long scripts with an honest error — never truncates', () => {
    const long = 'a '.repeat(MAX_SCRIPT_CHARS)
    const out = validateScript(long)
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.error).toContain(String(MAX_SCRIPT_CHARS))
  })
})

describe('buildTrustVideoPrompt', () => {
  it('quotes the spoken line and shows the business name', () => {
    const p = buildTrustVideoPrompt({
      slot: 'welcome',
      businessName: 'Bob Roofing',
      contactName: 'Bob',
      trade: 'roofing',
      script: 'Custom line here.',
    })
    expect(p).toContain('"Custom line here."')
    expect(p).toContain('Bob Roofing')
    expect(p).toContain('Bob, the owner of Bob Roofing')
    expect(p).toContain('Australian')
  })

  it('falls back to the default script and neutral speaker', () => {
    const p = buildTrustVideoPrompt({ slot: 'thankyou', businessName: 'Bob Roofing' })
    expect(p).toContain('accepting our quote')
    expect(p).toContain('friendly owner of Bob Roofing')
  })

  it('directs Veo to match the reference logo when one rides along', () => {
    const withLogo = buildTrustVideoPrompt({
      slot: 'welcome',
      businessName: 'Bob Roofing',
      hasReferenceImage: true,
    })
    expect(withLogo).toContain('matching the reference exactly')
    const without = buildTrustVideoPrompt({ slot: 'welcome', businessName: 'Bob Roofing' })
    expect(without).toContain('clean lettering')
    expect(without).not.toContain('reference image')
  })

  it('sanitises double quotes inside the script (prompt structure survives)', () => {
    const p = buildTrustVideoPrompt({
      slot: 'welcome',
      businessName: 'X',
      script: 'We are "the best" around.',
    })
    expect(p).toContain("'the best'")
  })

  it('stays far under the Veo 480-token prompt limit even with max inputs', () => {
    const p = buildTrustVideoPrompt({
      slot: 'welcome',
      businessName: 'A'.repeat(60),
      contactName: 'B'.repeat(40),
      trade: 'commercial_painting',
      script: 'c'.repeat(MAX_SCRIPT_CHARS),
      extraContext: 'd'.repeat(400),
    })
    // ~4 chars/token heuristic: keep prompt < 1600 chars ≈ 400 tokens.
    expect(p.length).toBeLessThan(1600)
  })
})

describe('slot state machine', () => {
  it('readSlotState defaults to idle', () => {
    expect(readSlotState(null, 'welcome')).toEqual({ status: 'idle' })
    expect(readSlotState({}, 'thankyou')).toEqual({ status: 'idle' })
  })

  it('withSlotState patches one slot without touching the other', () => {
    const s1 = withSlotState(null, 'welcome', { status: 'generating', operation: 'op-1' })
    const s2 = withSlotState(s1, 'thankyou', { status: 'failed', error: 'x' })
    expect(readSlotState(s2, 'welcome').status).toBe('generating')
    expect(readSlotState(s2, 'welcome').operation).toBe('op-1')
    expect(readSlotState(s2, 'thankyou').status).toBe('failed')
    expect(readSlotState(s2, 'welcome').updated_at).toBeTruthy()
  })
})

describe('shouldAutoGenerate — never clobber real content', () => {
  it('generates when the slot is empty and idle', () => {
    expect(shouldAutoGenerate(null, null, 'welcome')).toBe(true)
    expect(shouldAutoGenerate('', {}, 'thankyou')).toBe(true)
  })

  it('skips when a video URL is already set (manual film or earlier generation)', () => {
    expect(shouldAutoGenerate('https://x/own.mp4', null, 'welcome')).toBe(false)
  })

  it('skips in-flight and completed jobs; retries failed ones', () => {
    const generating = withSlotState(null, 'welcome', { status: 'generating' })
    const ready = withSlotState(null, 'welcome', { status: 'ready' })
    const failed = withSlotState(null, 'welcome', { status: 'failed', error: 'x' })
    expect(shouldAutoGenerate(null, generating, 'welcome')).toBe(false)
    expect(shouldAutoGenerate(null, ready, 'welcome')).toBe(false)
    expect(shouldAutoGenerate(null, failed, 'welcome')).toBe(true)
  })
})

describe('plumbing constants', () => {
  it('slots map to the mig-175 URL columns', () => {
    expect(SLOT_URL_COLUMN.welcome).toBe('intro_video_url')
    expect(SLOT_URL_COLUMN.thankyou).toBe('thankyou_video_url')
  })

  it('model defaults to veo-3.1-fast and honours the env override', () => {
    const prev = process.env.TRUST_VIDEO_MODEL
    delete process.env.TRUST_VIDEO_MODEL
    expect(trustVideoModel()).toBe('veo-3.1-fast-generate-preview')
    process.env.TRUST_VIDEO_MODEL = 'veo-3.1-generate-preview'
    expect(trustVideoModel()).toBe('veo-3.1-generate-preview')
    if (prev === undefined) delete process.env.TRUST_VIDEO_MODEL
    else process.env.TRUST_VIDEO_MODEL = prev
  })
})

describe('extractVideoUri — tolerant across Veo response shapes', () => {
  it('reads the documented generatedSamples shape', () => {
    expect(
      extractVideoUri({
        generateVideoResponse: { generatedSamples: [{ video: { uri: 'https://v/1' } }] },
      }),
    ).toBe('https://v/1')
  })

  it('reads alternate generatedVideos / predictions shapes', () => {
    expect(
      extractVideoUri({ generateVideoResponse: { generatedVideos: [{ video: { uri: 'https://v/2' } }] } }),
    ).toBe('https://v/2')
    expect(extractVideoUri({ generatedVideos: [{ video: { uri: 'https://v/3' } }] })).toBe('https://v/3')
    expect(extractVideoUri({ predictions: [{ video: { uri: 'https://v/4' } }] })).toBe('https://v/4')
  })

  it('null on anything else', () => {
    expect(extractVideoUri(null)).toBeNull()
    expect(extractVideoUri({})).toBeNull()
  })
})

describe('buildAttemptLadder — RAI degradation, one trigger dropped per step', () => {
  const base = {
    requestedScript: 'custom words here.',
    neutralScript: 'Neutral business script.',
    contactName: 'Jon Pepper',
  }

  it('custom script + owner photo: drops the photo, NEVER rewrites the words', () => {
    const ladder = buildAttemptLadder({
      ...base,
      usingDefaultScript: false,
      hasPersonPhoto: true,
      hasBrandRef: true,
    })
    expect(ladder).toHaveLength(2)
    expect(ladder[0]).toMatchObject({ script: 'custom words here.', refs: 'full' })
    expect(ladder[1]).toMatchObject({ script: 'custom words here.', refs: 'brand' })
    expect(ladder.every((a) => a.script === 'custom words here.')).toBe(true)
  })

  it('default script + owner photo: photo dropped first, then the personal name', () => {
    const ladder = buildAttemptLadder({
      ...base,
      requestedScript: "Hi, I'm Jon Pepper from Sparky.",
      usingDefaultScript: true,
      hasPersonPhoto: true,
      hasBrandRef: true,
    })
    expect(ladder).toHaveLength(3)
    expect(ladder[0].refs).toBe('full')
    expect(ladder[1]).toMatchObject({ script: "Hi, I'm Jon Pepper from Sparky.", refs: 'brand' })
    expect(ladder[2]).toMatchObject({ script: 'Neutral business script.', contactName: null, refs: 'brand' })
    expect(ladder[2].note).toContain('personal names')
  })

  it('default script, no photo, no contact: a single attempt', () => {
    const ladder = buildAttemptLadder({
      requestedScript: 'x',
      neutralScript: 'x',
      contactName: null,
      usingDefaultScript: true,
      hasPersonPhoto: false,
      hasBrandRef: true,
    })
    expect(ladder).toHaveLength(1)
  })

  it('dedupes identical consecutive configs and caps at three attempts', () => {
    const ladder = buildAttemptLadder({
      requestedScript: 'same',
      neutralScript: 'same',
      contactName: 'Jon',
      usingDefaultScript: true,
      hasPersonPhoto: false,
      hasBrandRef: false,
    })
    // attempt1 (same, Jon, none) and the neutral attempt (same, null, none)
    // differ only by contactName → both kept; nothing identical repeats.
    expect(ladder.length).toBeLessThanOrEqual(3)
    const keys = ladder.map((a) => `${a.script}|${a.contactName}|${a.refs}`)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('scriptMentionsPersonalName', () => {
  it('finds the contact name spoken in a script (whole word, any case)', () => {
    expect(
      scriptMentionsPersonalName("G'day, we're Sparky and I'm Jon Pepper.", ['Jon Pepper']),
    ).toBe('Jon Pepper')
    expect(scriptMentionsPersonalName('call JON today', ['Jon Pepper'])).toBe('Jon Pepper')
  })

  it('no false hits on substrings or absent names', () => {
    // "Jonathan"/"Jonno" contain "Jon" only as a substring, not a whole word.
    expect(scriptMentionsPersonalName('Jonathan and Jonno are here', ['Jon'])).toBeNull()
    expect(scriptMentionsPersonalName('no names here', ['Jon Pepper'])).toBeNull()
    expect(scriptMentionsPersonalName('anything', [null, '  '])).toBeNull()
  })
})

describe('RAI filter handling (observed live: person-name block)', () => {
  const RAI_RESPONSE = {
    generateVideoResponse: {
      raiMediaFilteredCount: 1,
      raiMediaFilteredReasons: [
        "Sorry, we can't create videos with real people's names or likenesses. Please remove the celebrity reference and try again.",
      ],
    },
  }

  it('extractRaiReason surfaces the real block reason', () => {
    expect(extractRaiReason(RAI_RESPONSE)).toContain("real people's names")
    expect(extractRaiReason({})).toBeNull()
    expect(extractRaiReason(null)).toBeNull()
  })

  it('isPersonNameBlock recognises the name/likeness family and nothing else', () => {
    expect(isPersonNameBlock(extractRaiReason(RAI_RESPONSE))).toBe(true)
    expect(isPersonNameBlock('celebrity reference detected')).toBe(true)
    expect(isPersonNameBlock('violent content')).toBe(false)
    expect(isPersonNameBlock(null)).toBe(false)
  })

  it('the neutral fallback script really has no personal name in it', () => {
    const neutral = defaultScript('welcome', 'Sparky', null)
    expect(neutral).not.toContain('Jon')
    expect(neutral).toContain('Sparky')
  })
})
