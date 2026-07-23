// ═══════════════════════════════════════════════════════════════════
// QuoteMate · Fix "voice AI doesn't pick up" (2026-07-23).
//
// Root cause: the org's custom 11labs credential was a FREE-tier
// ElevenLabs key — ElevenLabs refuses free keys via Vapi, so every
// inbound call died at first TTS synth (endedReason=
// pipeline-error-eleven-labs-quota-exceeded, 0-1s calls).
//
// Fix: 1. DELETE the custom 11labs credential → Vapi falls back to its
//         managed ElevenLabs pool (billed per-minute via Vapi wallet).
//      2. PATCH every active assistant's voice with a fallbackPlan to a
//         Vapi-native voice so a future TTS-provider outage degrades
//         instead of dropping the call.
//
// Usage: node --env-file=.env.local scripts/fix-vapi-11labs-credential.mjs
// ═══════════════════════════════════════════════════════════════════

const VAPI_API_KEY = process.env.VAPI_API_KEY
if (!VAPI_API_KEY) { console.error('Missing VAPI_API_KEY'); process.exit(1) }

const headers = { Authorization: `Bearer ${VAPI_API_KEY}`, 'Content-Type': 'application/json' }
const vapi = async (method, path, body) => {
  const res = await fetch(`https://api.vapi.ai${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined })
  const t = await res.text()
  let data; try { data = JSON.parse(t) } catch { data = t }
  return { ok: res.ok, status: res.status, data }
}

// ── 1. Delete the dead 11labs credential ────────────────────────────
const creds = await vapi('GET', '/credential')
if (!creds.ok) { console.error('credential list failed', creds.status); process.exit(1) }
const elevenlabs = creds.data.filter((c) => c.provider === '11labs')
if (!elevenlabs.length) {
  console.log('→ No custom 11labs credential found (already removed).')
} else {
  for (const c of elevenlabs) {
    const del = await vapi('DELETE', `/credential/${c.id}`)
    console.log(del.ok
      ? `→ ✓ Deleted 11labs credential ${c.id} — Vapi-managed ElevenLabs now in use.`
      : `→ ✗ Delete failed for ${c.id}: HTTP ${del.status} ${JSON.stringify(del.data).slice(0, 200)}`)
    if (!del.ok) process.exit(1)
  }
}

// ── 2. Add a Vapi-native fallback voice to every assistant ──────────
// Godfrey is a Vapi-included voice already proven in this org (the
// deprecated pre-05-26 assistant used it).
const FALLBACK = { provider: 'vapi', voiceId: 'Godfrey' }
const list = await vapi('GET', '/assistant?limit=100')
if (!list.ok) { console.error('assistant list failed', list.status); process.exit(1) }

for (const a of list.data) {
  if (/deprecated/i.test(a.name ?? '')) { console.log(`  · skip "${a.name}" (deprecated)`); continue }
  const voice = a.voice ?? {}
  if (voice.provider !== '11labs') { console.log(`  · skip "${a.name}" (voice=${voice.provider})`); continue }
  const patch = await vapi('PATCH', `/assistant/${a.id}`, {
    voice: { ...voice, fallbackPlan: { voices: [FALLBACK] } },
  })
  console.log(patch.ok
    ? `  ✓ "${a.name}" — fallbackPlan → vapi/Godfrey`
    : `  ✗ "${a.name}" — HTTP ${patch.status} ${JSON.stringify(patch.data).slice(0, 200)}`)
}

// ── 3. Verify final state ───────────────────────────────────────────
const after = await vapi('GET', '/credential')
console.log(`\n→ Remaining custom credentials: ${after.ok ? after.data.map((c) => c.provider).join(', ') || '(none)' : '?'}`)
console.log('→ Done. Place one test call to any tenant number to confirm pickup.')
