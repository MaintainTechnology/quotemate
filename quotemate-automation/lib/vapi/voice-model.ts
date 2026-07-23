// The ONE place the voice receptionist's LLM is chosen (2026-07-23 upgrade:
// Haiku → Sonnet 5 for genuinely intelligent call handling). provision.ts,
// update-assistant.ts and scripts/sync-vapi-assistants.mjs all resolve
// through here so create / settings-toggle / backfill can never drift.
// VAPI_VOICE_MODEL overrides for rollback without a deploy.

export const DEFAULT_VOICE_MODEL = 'claude-sonnet-5'

export function resolveVoiceModel(): string {
  const override = process.env.VAPI_VOICE_MODEL?.trim()
  return override || DEFAULT_VOICE_MODEL
}
