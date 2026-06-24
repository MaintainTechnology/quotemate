import { createClient } from '@supabase/supabase-js'
import { after } from 'next/server'
import { runEstimation } from '@/lib/estimate/run'
import { sanitizeInspectionReason } from '@/lib/estimate/inspection-reason'
import { dispatchQuoteMessage } from '@/lib/sms/dispatch'
import { dispatchQuoteWithPdf } from '@/lib/sms/send-quote-pdf'
import { ensureQuotePdf, quotePdfUrl, signQuotePdfUrl } from '@/lib/quote/pdf'
import { archiveAndIngestQuote } from '@/lib/filestore/ingest-quote'
import { buildQuoteKbText } from '@/lib/filestore/minimize'
import { sendWhatsApp } from '@/lib/sms/twilio'
import {
  buildQuoteSms,
  buildTradieDraftNotification,
  buildTradieInspectionNotification,
  buildTradieReviewNotification,
} from '@/lib/sms/templates'
import { shouldHoldForReview } from '@/lib/quote/review-policy'
import { pipelineLog } from '@/lib/log/pipeline'
import { createCheckoutSessionsForQuote, createInspectionCheckoutSession, generateShareToken } from '@/lib/stripe/checkout'
import { withRetry } from '@/lib/util/retry'
import { decideRouting } from '@/lib/routing/decide'
import { advanceQuoteStatus } from '@/lib/quote/lifecycle'
import { computePriceHoldUntil } from '@/lib/quote/hold'
import { generatePreviewImage } from '@/lib/ig-engine/generate'
import { generateSampleImages } from '@/lib/ig-engine/samples'
import { resolvePricingBookForIntake } from '@/lib/estimate/pricing-book'
import {
  earlyBirdConfigFromOverlays,
  computeEarlyBirdOffer,
} from '@/lib/quote/early-bird'
import { asQuoteDisplayMode } from '@/lib/quote/display'
import { asQuoteTierMode } from '@/lib/quote/tier-visibility'
import {
  getDeliveryKnobs,
  logSendOutcome,
} from '@/lib/sms/send-reliability'
import { sendWithRetry } from '@/lib/sms/send-quote-dispatch'
import {
  checkQuoteEntitlement,
  checkVoiceEntitlement,
  isEnforcementEnabled,
} from '@/lib/billing/entitlements'
import { getMonthlyUsage } from '@/lib/billing/usage'

// R42-draft — the after() block does the heavy sends (PDF render, customer
// quote SMS + retries, tradie notify + retries). Derive the Vercel function
// budget from the env knobs (getDeliveryKnobs) so ops can widen it without a
// code change, rather than a hardcoded 300. `maxDuration` must be a static
// number for Next's build-time analysis, so we read the knob at module load.
// Next route-segment configs must be STATICALLY-ANALYZABLE LITERALS — a
// computed value (getDeliveryKnobs().maxDurationSec) is silently ignored by
// Next's segment analyser ("Invalid segment configuration export"). Keep it a
// literal (300s default ceiling; raise to up to 800 on Vercel Pro/Fluid here).
// getDeliveryKnobs() is still used at runtime below for send retry/backoff.
export const maxDuration = 300

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: Request) {
  const { intakeId } = await req.json()
  const log = pipelineLog('estimate')
  log.step('received', { intakeId })

  try {
    log.step('loading intake, pricing_book, caller_number')
    const { data: intake } = await supabase.from('intakes').select('*').eq('id', intakeId).single()

    // v5 multi-trade: pick the pricing_book row matching intake.trade.
    // Legacy intake rows pre-dating v5 have no trade field — default to
    // 'electrical' (the original NSW/NECA pilot trade).
    const intakeTrade = (intake?.trade as 'electrical' | 'plumbing' | undefined) ?? 'electrical'
    const intakeTenantId = (intake?.tenant_id as string | null) ?? null

    // ── Billing enforcement gate (flag-gated by BILLING_ENFORCEMENT_ENABLED;
    // OFF by default). One chokepoint covers BOTH channels — voice and SMS
    // intakes both reach estimate/draft. Fails OPEN on any error so a
    // billing-lookup hiccup never blocks a legitimate quote; billing_exempt
    // tenants bypass entirely. Quotes are fair-use (soft flag on overage);
    // voice is the hard, plan-gated, minute-capped channel.
    let quoteOverFairUse = false
    if (intakeTenantId && isEnforcementEnabled()) {
      try {
        const { data: billingRow } = await supabase
          .from('tenants')
          .select('subscription_status, subscription_plan, billing_exempt')
          .eq('id', intakeTenantId)
          .maybeSingle()
        if (billingRow) {
          const usage = await getMonthlyUsage(supabase, intakeTenantId)
          if (intake.call_id != null) {
            const v = checkVoiceEntitlement(billingRow, usage)
            if (!v.allowed) {
              log.err('billing gate — voice not entitled; skipping draft', null, {
                tenant_id: intakeTenantId,
                reason: v.reason,
              })
              return Response.json({ ok: false, skipped: 'voice_not_entitled', reason: v.reason })
            }
          }
          const q = checkQuoteEntitlement(billingRow, usage)
          if (!q.allowed) {
            log.err('billing gate — tenant not entitled to auto-quote; skipping draft', null, {
              tenant_id: intakeTenantId,
              reason: q.reason,
            })
            return Response.json({ ok: false, skipped: 'not_entitled', reason: q.reason })
          }
          quoteOverFairUse = !!q.overFairUse
          if (quoteOverFairUse) {
            log.ok('billing gate — over fair-use quote allowance (soft; allowing)', {
              tenant_id: intakeTenantId,
              quotes_used: usage.quotesUsed,
            })
          }
        }
      } catch (e) {
        log.err(
          'billing gate errored — failing open (allowing draft)',
          e instanceof Error ? e.message : String(e),
          { tenant_id: intakeTenantId },
        )
      }
    }

    // WP1 — tenant-scoped lookup ONLY. The old "no row for this tenant →
    // grab the oldest book for the trade" fallback is deliberately gone:
    // it silently quoted one tradie's job on another tradie's rates and
    // markup, with no error a human would notice. If the book can't be
    // resolved for THIS tenant we route to the paid inspection (below),
    // with the reason logged — never a silent default.
    let tenantBook: Record<string, unknown> | null = null
    if (intakeTenantId) {
      const { data } = await supabase
        .from('pricing_book')
        .select('*')
        .eq('tenant_id', intakeTenantId)
        .eq('trade', intakeTrade)
        .maybeSingle()
      tenantBook = data ?? null
    }

    const bookResolution = resolvePricingBookForIntake({
      intakeTenantId,
      intakeTrade,
      tenantBook,
    })
    const pricingBook: Record<string, unknown> | null = bookResolution.ok
      ? (bookResolution.pricingBook as Record<string, unknown>)
      : null

    if (!bookResolution.ok) {
      // Hard rule fired. We CANNOT price this job (no pricing book that
      // provably belongs to this tenant). Do not call the estimator, do
      // not borrow another tradie's numbers — route straight to the $99
      // inspection with the reason persisted on the quote and logged so
      // the misconfigured tenant is visible instead of silently wrong.
      log.err('WP1: pricing_book did not resolve for this tenant — routing to inspection', null, {
        code: bookResolution.code,
        reason: bookResolution.reason,
        tenant_id: intakeTenantId,
        trade: intakeTrade,
      })
    } else {
      log.ok('pricing_book resolved for tenant', {
        tenant_id: intakeTenantId,
        trade: intakeTrade,
        pricing_book_id: pricingBook!.id,
      })
    }

    // v6 multi-tenant: load the tenant's provisioned Twilio number +
    // owner mobile so outbound SMS (quote to customer, notification to
    // tradie) goes from / to the right place per the tenant who owns
    // this quote. Legacy pre-v6 intakes without tenant_id keep the env-
    // var fallback used through v5.
    let tenantSmsNumber: string | null = null
    let tenantOwnerMobile: string | null = null
    let tenantBusinessName: string | null = null
    let tenantOwnerFirstName: string | null = null
    if (intakeTenantId) {
      const { data: tenantRow } = await supabase
        .from('tenants')
        .select('twilio_sms_number, owner_mobile, business_name, owner_first_name')
        .eq('id', intakeTenantId)
        .maybeSingle()
      tenantSmsNumber = (tenantRow?.twilio_sms_number as string | null) ?? null
      tenantOwnerMobile = (tenantRow?.owner_mobile as string | null) ?? null
      tenantBusinessName = (tenantRow?.business_name as string | null) ?? null
      tenantOwnerFirstName = (tenantRow?.owner_first_name as string | null) ?? null
      log.ok('tenant outbound profile loaded', {
        tenant_id: intakeTenantId,
        has_sms_number: !!tenantSmsNumber,
        has_owner_mobile: !!tenantOwnerMobile,
        has_owner_first_name: !!tenantOwnerFirstName,
      })
    }

    // Channel-aware customer lookup. Voice path: intake.call_id is set -> read
    // calls.caller_number. SMS path: intake.call_id is null -> look up the
    // sms_conversations row that points at this intake to recover the
    // customer's mobile number AND mark this quote as SMS-sourced (drives the
    // Phase 4 tradie-notify gate further down).
    const isSmsSource = intake.call_id == null
    let call: { caller_number: string | null } | null = null
    let smsConversationId: string | null = null
    // Phase 6 — conversation_state.slots threads through to the
    // price-bands recipe engine (lib/estimate/run.ts → merge step) so
    // customer answers captured by the slot extractor (Phase 4) reach
    // the per-assembly recipes. Loaded once here, passed as the 4th
    // arg to runEstimation. Voice path leaves this null; intake.scope
    // remains the fallback source for those callers.
    let smsConversationState: { slots?: Record<string, unknown> | null } | null = null

    if (isSmsSource) {
      const { data: convo } = await supabase
        .from('sms_conversations')
        .select('id, from_number, conversation_state')
        .eq('intake_id', intakeId)
        .maybeSingle()
      if (convo) {
        smsConversationId = convo.id
        call = { caller_number: convo.from_number ?? null }
        // conversation_state is jsonb on the DB; supabase-js returns
        // the parsed object (or null). Defensive shape check before we
        // hand it to the estimator — anything malformed becomes null
        // so the recipe falls back to intake.scope only.
        const rawState = (convo as { conversation_state?: unknown }).conversation_state
        if (rawState && typeof rawState === 'object') {
          const slots = (rawState as { slots?: unknown }).slots
          smsConversationState = {
            slots:
              slots && typeof slots === 'object'
                ? (slots as Record<string, unknown>)
                : null,
          }
        }
      }
      // Web-sourced intake (QR landing page) — call_id is null so it lands
      // in this SMS branch, but there is NO sms_conversations row, so the
      // recipient is still unknown. Recover the customer's mobile from the
      // structured intake.caller.phone (captured from the landing form) so
      // the quote SMS has a destination. Sent FROM the tenant's number per
      // the fromNumber policy below.
      if (!call?.caller_number) {
        const webPhone = (intake.caller as { phone?: string } | null)?.phone?.trim() || null
        if (webPhone) {
          call = { caller_number: webPhone }
          log.ok('web-sourced intake — recipient recovered from intake.caller.phone')
        }
      }
    } else {
      const { data: callRow } = await supabase
        .from('calls')
        .select('caller_number')
        .eq('id', intake.call_id)
        .single()
      call = callRow ?? null
    }

    log.ok('inputs loaded', {
      source: isSmsSource ? 'sms' : 'voice',
      trade: intakeTrade,
      job_type: intake.job_type,
      confidence: intake.confidence,
      caller_number: call?.caller_number ? 'set' : 'null',
      hourly_rate: pricingBook?.hourly_rate ?? null,
      sms_conversation_id: smsConversationId ?? 'n/a',
      conversation_slots_count: smsConversationState?.slots
        ? Object.keys(smsConversationState.slots).length
        : 0,
    })

    let estimation: Awaited<ReturnType<typeof runEstimation>>
    if (!bookResolution.ok) {
      // No valid tenant pricing book → synthesize an inspection-only draft
      // and SKIP the estimator entirely. There is nothing to price against;
      // calling the LLM here would only invite a hallucinated number the
      // grounding validator would reject anyway. Tiers are nulled; the
      // downstream inspection path forces the $99 total.
      estimation = {
        draft: {
          needs_inspection: true,
          inspection_reason: bookResolution.reason,
          scope_of_works: `Site inspection required before this job can be quoted. ${bookResolution.reason}`,
          scope_short: 'Site inspection required',
          assumptions: [],
          risk_flags: [`[pricing-book] ${bookResolution.code}: ${bookResolution.reason}`],
          optional_upsells: [],
          estimated_timeframe: 'After site visit (within 5 business days)',
          gst_note: null,
          good: null,
          better: null,
          best: null,
        },
      }
      log.ok('estimation skipped — inspection-only draft synthesized (WP1 hard rule)', {
        code: bookResolution.code,
      })
    } else {
      const MODEL_CASCADE = [
        { id: 'claude-opus-4-8',   label: 'Opus 4.8'   },
        { id: 'claude-opus-4-7',   label: 'Opus 4.7'   },
        { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
      ] as const
      let modelIdx = 0

      log.step(`running estimate — model cascade: ${MODEL_CASCADE.map(m => m.label).join(' → ')}, up to ${MODEL_CASCADE.length} attempts`)
      estimation = await withRetry(
        () => {
          const m = MODEL_CASCADE[Math.min(modelIdx++, MODEL_CASCADE.length - 1)]
          return runEstimation(
            intake,
            bookResolution.pricingBook,
            m.id,
            smsConversationState,
          )
        },
        {
          maxAttempts: MODEL_CASCADE.length,
          baseDelayMs: 2000,
          onAttemptFailed: (err, attempt, willRetry) => {
            const msg = err instanceof Error ? err.message : String(err)
            const used = MODEL_CASCADE[Math.min(attempt - 1, MODEL_CASCADE.length - 1)]
            const next = MODEL_CASCADE[Math.min(attempt, MODEL_CASCADE.length - 1)]
            if (willRetry) {
              log.err(`${used.label} attempt ${attempt}/${MODEL_CASCADE.length} failed — retrying with ${next.label}`, msg)
            } else {
              log.err(`${used.label} attempt ${attempt}/${MODEL_CASCADE.length} failed — giving up`, msg)
            }
          },
        }
      )
    }
    const draft = estimation.draft

    // Surface grounding failures clearly in the Vercel logs. Log EVERY
    // failure individually (not just the first) — when the validator
    // rejects 2-3 lines on the same draft, knowing only the first
    // failure makes diagnosis pointlessly slow. Each line gets its own
    // structured entry tagged with the same intake_id so a single
    // Vercel log filter ("grounding check failed") returns the full set.
    if (estimation.downgradedToInspection) {
      const failures = estimation.groundingFailures ?? []
      log.err('grounding check failed — downgrading quote to inspection-required', null, {
        total_failures: failures.length,
      })
      failures.forEach((f, i) => {
        log.err(`grounding check failed — line ${i + 1}/${failures.length}`, null, {
          tier: f.tier,
          line_index: f.lineIndex,
          description: f.description,
          unit: f.unit,
          unit_price_ex_gst: f.unit_price_ex_gst,
          expected: f.expected,
        })
      })
    }
    const tierCount = [draft.good, draft.better, draft.best].filter(Boolean).length
    log.ok('Opus parsed', {
      tiers: tierCount,
      better_total_ex_gst: draft.better?.subtotal_ex_gst ?? 'null',
      scope_short: draft.scope_short ? `"${draft.scope_short}"` : 'absent',
      needs_inspection: draft.needs_inspection ?? false,
    })

    // Two pricing paths — totals diverge based on the inspection branch.
    //   AUTO-QUOTE: total = selected (better) tier inc GST, deposit_pct from
    //               pricing_book, real DB-grounded numbers throughout.
    //   INSPECTION: total = $99 inc GST (the only chargeable amount); all
    //               three tiers FORCED to null, even if Opus tried to hand
    //               us indicative numbers (defence-in-depth against
    //               LLM hallucination — STRICT GROUNDING #10).
    const INSPECTION_TOTAL_INC_GST = 99
    const INSPECTION_GST_AMOUNT = +(INSPECTION_TOTAL_INC_GST / 11).toFixed(2)
    const INSPECTION_SUBTOTAL_EX_GST = +(INSPECTION_TOTAL_INC_GST - INSPECTION_GST_AMOUNT).toFixed(2)

    const isInspection = draft.needs_inspection === true

    // R13 — constrain the customer-facing inspection reason before it is
    // persisted and sent. Strips invented price claims (an inspection quote
    // has no grounded price) and calms sensational text; covers both the LLM
    // self-report path and the WP1 pricing-book fallback reason. Pure +
    // deterministic (see lib/estimate/inspection-reason.ts + its test).
    if (isInspection) {
      draft.inspection_reason = sanitizeInspectionReason(draft.inspection_reason)
    }

    let goodTier: typeof draft.good   | null = null
    let betterTier: typeof draft.better | null = null
    let bestTier: typeof draft.best   | null = null
    let selectedTier: 'good' | 'better' | 'best' | 'inspection' | null
    let selectedSubtotal: number
    let gst: number
    let total: number

    if (isInspection) {
      // Force null tiers regardless of what Opus emitted — pricing comes
      // only after the on-site visit.
      goodTier = null
      betterTier = null
      bestTier = null
      selectedTier = 'inspection'
      selectedSubtotal = INSPECTION_SUBTOTAL_EX_GST
      gst = INSPECTION_GST_AMOUNT
      total = INSPECTION_TOTAL_INC_GST
      if (draft.good || draft.better || draft.best) {
        log.err('Opus emitted indicative tier numbers on inspection-required quote — discarding per STRICT GROUNDING #10', null, {
          had_good:   !!draft.good,
          had_better: !!draft.better,
          had_best:   !!draft.best,
        })
      }
    } else {
      goodTier = draft.good ?? null
      betterTier = draft.better ?? null
      bestTier = draft.best ?? null
      // Honor an explicit selected_tier on the draft (set by the WP9
      // single-product collapse in lib/estimate/run.ts when the customer
      // pre-picked one product mid-chat — there's only ONE tier left and
      // it may not be 'better'). Otherwise the customer portal default
      // is "better", falling through to "good" or "best" if the canonical
      // default tier is missing (e.g. fault_finding has no best, WP9
      // collapse may keep only 'good', etc.).
      const draftSel = draft.selected_tier as 'good' | 'better' | 'best' | null | undefined
      const validDraftSel =
        (draftSel === 'good' || draftSel === 'better' || draftSel === 'best') &&
        !!draft[draftSel]
      const chosenKey: 'good' | 'better' | 'best' = validDraftSel
        ? draftSel
        : draft.better
          ? 'better'
          : draft.good
            ? 'good'
            : 'best'
      selectedTier = chosenKey
      selectedSubtotal = draft[chosenKey]?.subtotal_ex_gst ?? 0
      gst = pricingBook?.gst_registered ? +(selectedSubtotal * 0.10).toFixed(2) : 0
      total = +(selectedSubtotal + gst).toFixed(2)
    }

    const routing_decision = decideRouting({
      intake: {
        confidence: intake.confidence,
        inspection_required: intake.inspection_required ?? false,
        job_type: (intake.job_type as string | null) ?? null, // R2 allowlist
      },
      quote: { needs_inspection: isInspection },
      // R7 — only a deterministically-priced quote may auto-send.
      pricingPath: (draft as { pricing_path?: string }).pricing_path ?? null,
      // R23 — deployGate intentionally omitted: auto-send stays FAIL-CLOSED
      // until the per-tenant/per-job-type deploy gate is wired with real
      // measured metrics, so this computes 'tradie_review' until then.
    })
    log.ok('routing decided', { routing_decision })

    // When the validator downgraded the quote, attach the rejected line
    // items to risk_flags so they're queryable from the dashboard / SQL
    // without scrolling Vercel logs. Each entry is structured JSON so
    // future tooling can parse it; the human-readable description goes
    // first for at-a-glance debugging.
    const riskFlags = [...(draft.risk_flags ?? [])]
    if (quoteOverFairUse) {
      riskFlags.push(
        '[billing] over fair-use quote allowance for this plan this month — usage is high; consider upgrading',
      )
    }
    if (estimation.downgradedToInspection) {
      for (const f of estimation.groundingFailures ?? []) {
        riskFlags.push(
          `[grounding] tier=${f.tier} line#${f.lineIndex} ${f.description} — unit=${f.unit} × $${f.unit_price_ex_gst} — expected: ${f.expected}`,
        )
      }
    }

    log.step('inserting quotes row', { tenant_id: intakeTenantId })
    const shareToken = generateShareToken()
    const { data: quote } = await supabase.from('quotes').insert({
      intake_id: intakeId,
      // v6 multi-tenant: propagate the tenant from the intake so the
      // dashboard's Quotes tab (which filters quotes by tenant_id) picks
      // up every quote drafted from that tradie's inbound traffic.
      tenant_id: intakeTenantId,
      status: 'draft',
      // WP6 — stamp the price-hold window at creation so the customer SMS
      // and the quote page show a consistent "held until" countdown. The
      // page still derives from created_at as a legacy fallback when null.
      price_hold_until:    computePriceHoldUntil(new Date().toISOString()),
      scope_of_works:      draft.scope_of_works,
      assumptions:         draft.assumptions      ?? [],
      risk_flags:          riskFlags,
      good:                goodTier,
      better:              betterTier,
      best:                bestTier,
      optional_upsells:    draft.optional_upsells ?? [],
      estimated_timeframe: draft.estimated_timeframe,
      needs_inspection:    isInspection,
      inspection_reason:   draft.inspection_reason,
      gst_note:            draft.gst_note,
      selected_tier:       selectedTier,
      subtotal_ex_gst:     selectedSubtotal,
      gst,
      total_inc_gst:       total,
      share_token:         shareToken,
      routing_decision,
      // R7/R27 — observability: how this quote was priced + the intended send
      // decision + a grounding summary. (auto_sent records the gated INTENT;
      // the live dispatch flip to honour it is the conscious go-live step.)
      pricing_path:        (draft as { pricing_path?: string }).pricing_path ?? 'opus_fallback',
      auto_sent:           routing_decision === 'auto_send',
      grounding_result:    { ok: !isInspection, downgraded: !!estimation.downgradedToInspection },
    }).select().single()
    log.ok('quote inserted', { quote_id: quote!.id, total_inc_gst: total, routing: routing_decision, inspection: isInspection, share_token: shareToken.slice(0, 8) + '…' })

    // v8 Phase A — stamp the early-booking discount offer.
    //
    // Best-effort SEPARATE update (NOT part of the insert above): the
    // four early_bird_* columns land via migration 044, and a draft must
    // never fail because that migration hasn't been applied yet — same
    // defensive pattern the Stripe webhook uses for booking_state.
    //
    // Only auto-quotes get an offer: inspection-required quotes are
    // pay-first ($99 site visit) and never flow through the book-first
    // funnel, so an early-booking discount has nothing to attach to.
    // The offer is read from THIS tenant's pricing_book.overlays — a
    // zero-config tenant (no early_bird overlay) simply gets no offer.
    if (!isInspection) {
      const ebConfig = earlyBirdConfigFromOverlays(
        (pricingBook as { overlays?: unknown } | null)?.overlays,
      )
      const offer = computeEarlyBirdOffer(
        ebConfig,
        (quote!.created_at as string | null) ?? new Date().toISOString(),
      )
      if (offer) {
        const { error: ebErr } = await supabase
          .from('quotes')
          .update({
            early_bird_discount_pct: offer.discountPct,
            early_bird_expires_at: offer.expiresAt,
          })
          .eq('id', quote!.id)
        if (ebErr) {
          log.err('early-bird offer stamp skipped (non-fatal — apply migration 044)', ebErr.message, {
            quote_id: quote!.id,
          })
        } else {
          log.ok('early-bird offer stamped', {
            quote_id: quote!.id,
            discount_pct: offer.discountPct,
            expires_at: offer.expiresAt,
          })
        }
      }
    }

    // Create Stripe Checkout Session(s). Two distinct paths:
    //   • auto-quote → 3 Sessions (one per tier, deposit only)
    //   • inspection-required → 1 Session for the $99 site-visit fee
    // If creation fails for any reason we log + continue without links — the
    // quote is still saved; SMS will go without pay buttons rather than failing.
    let payLinks: Partial<Record<'good' | 'better' | 'best' | 'inspection', string>> | undefined
    let depositPct: number | null = null
    // Prefer the configured APP_URL (prod), but fall back to NEXT_PUBLIC_APP_URL
    // and finally the request's own origin so links still build in dev/preview
    // where APP_URL isn't set — without this, `${appUrl}/q/...` becomes
    // "undefined/q/..." and the customer SMS goes out with a broken link.
    const appUrl =
      process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin

    if (!draft.needs_inspection) {
      log.step('creating Stripe Checkout Sessions (one per tier, deposit only)')
      try {
        const stripeLinks = await createCheckoutSessionsForQuote({
          quote: { id: quote!.id, good: draft.good ?? null, better: draft.better ?? null, best: draft.best ?? null, deposit_pct: 30 },
          intake,
          shareToken,
          appUrl,
        })

        await supabase.from('quotes').update({ stripe_links: stripeLinks }).eq('id', quote!.id)
        depositPct = 30

        payLinks = {
          good:   stripeLinks.good   ? `${appUrl}/r/${shareToken}/good`   : undefined,
          better: stripeLinks.better ? `${appUrl}/r/${shareToken}/better` : undefined,
          best:   stripeLinks.best   ? `${appUrl}/r/${shareToken}/best`   : undefined,
        }

        log.ok('Stripe sessions created (auto-quote)', {
          tiers_with_links: Object.values(payLinks).filter(Boolean).length,
        })
      } catch (e: any) {
        log.err('Stripe session creation failed — SMS will go without pay links', e?.message ?? e, {
          quote_id: quote!.id,
        })
      }
    } else {
      log.step('creating Stripe Checkout Session for $99 site-visit deposit (inspection-required path)')
      try {
        const inspectionUrl = await createInspectionCheckoutSession({
          quoteId: quote!.id,
          intake,
          shareToken,
          appUrl,
        })

        if (inspectionUrl) {
          await supabase.from('quotes').update({ stripe_links: { inspection: inspectionUrl } }).eq('id', quote!.id)
          payLinks = {
            inspection: `${appUrl}/r/${shareToken}/inspection`,
          }
          log.ok('Stripe inspection-fee Session created', { inspection_link_set: true })
        } else {
          log.err('Stripe inspection Session returned no URL — SMS will mention the fee without a link', null, {
            quote_id: quote!.id,
          })
        }
      } catch (e: any) {
        log.err('Stripe inspection-fee creation failed — SMS will mention the fee without a link', e?.message ?? e, {
          quote_id: quote!.id,
        })
      }
    }

    // ─── AI preview trigger 3 (estimate draft completion) ───
    // Quote row exists; if photos already on file the preview can begin
    // generating in parallel with SMS dispatch. Customer's first photo
    // is the reference — Gemini edits THAT image. Idempotent: if photo
    // upload already kicked it off (trigger 1), the CAS in
    // generatePreviewImage() skips this call.
    after(async () => {
      const previewLog = pipelineLog('dispatch', `preview:${quote!.id.slice(0, 8)}`)
      try {
        const photoPaths = (Array.isArray(intake.photo_paths) ? intake.photo_paths : []) as string[]
        previewLog.step('preview + samples trigger 3 — kicking off Gemini in parallel', {
          quote_id: quote!.id,
          intake_id: intake.id,
          photo_count: photoPaths.length,
        })

        // Sample gallery doesn't need customer photos — fires regardless.
        // Main preview only fires if we have at least one photo on the
        // intake (photo-upload trigger 1 will catch it later otherwise).
        const previewPromise = photoPaths.length > 0
          ? generatePreviewImage(quote!.id as string)
          : Promise.resolve({ status: 'skipped' as const, reason: 'no photos yet on intake' })

        const samplesPromise = generateSampleImages(quote!.id as string)

        const [previewResult, samplesResult] = await Promise.all([previewPromise, samplesPromise])
        previewLog.ok('preview trigger 3 result', { status: previewResult.status })
        previewLog.ok('samples trigger 3 result', { status: samplesResult.status })
      } catch (e: any) {
        previewLog.err('preview/samples trigger 3 threw', e?.message ?? String(e))
      }
    })

    // Mig 078 — tradie review-before-send policy. Decide ONCE here so
    // the customer-dispatch + tradie-notify branches share one truth.
    // Only inspection routes bypass the gate (see lib/quote/review-policy.ts
    // docs for why). The WP9 product-picker no longer bypasses
    // always_review — a customer picking a variant is not a price
    // commitment, so the tradie's explicit "review every quote" toggle
    // wins over the picker signal.
    const reviewDecision = shouldHoldForReview({
      policy: (pricingBook as { review_policy?: string | null } | null)?.review_policy ?? null,
      threshold: (pricingBook as { review_threshold_inc_gst?: number | string | null } | null)
        ?.review_threshold_inc_gst ?? null,
      totalIncGst: total,
      isInspection,
      riskFlags,
    })
    log.ok('review-policy decided', {
      hold: reviewDecision.hold,
      reason: reviewDecision.reason,
    })

    // Auto-send the quote to the caller via SMS (Path B per current product mode).
    // Skip if no caller_number available, OR when the review policy says
    // hold for tradie approval first (mig 078).
    // Errors are logged but never fail the route.
    const callerNumber = call?.caller_number ?? null
    log.step(
      reviewDecision.hold
        ? 'holding SMS — review policy requires tradie approval first'
        : callerNumber
          ? 'queueing SMS dispatch'
          : 'skipping SMS — no caller_number',
    )

    // When holding, mark the quote awaiting_tradie_approval BEFORE the
    // after() block runs (which sends the tradie notification with the
    // approve link). The status is what /api/quote/[id]/approve looks
    // up to decide whether the approve action is valid.
    if (reviewDecision.hold) {
      const { error: holdErr } = await supabase
        .from('quotes')
        .update({ status: 'awaiting_tradie_approval' })
        .eq('id', quote!.id)
      if (holdErr) {
        log.err('failed to mark quote awaiting_tradie_approval', null, {
          quote_id: quote!.id,
          message: holdErr.message,
        })
      }
    }

    after(async () => {
      const dispatch = pipelineLog('dispatch', intake.call_id)
      const knobs = getDeliveryKnobs()
      // R45 — the WHOLE after() body is wrapped in this try/catch. Before, an
      // unhandled throw anywhere outside the per-send inner try blocks (URL
      // building, review branching, an unexpected null deref) killed EVERY
      // send and left the customer in total silence. Now any such escape lands
      // in the catch below, which fires a fallback "your quote is coming" SMS
      // to the customer and a "quote failed" notice to the tradie.
      try {
      // Best-effort: if we can't deliver the quote to the customer, make sure
      // the tradie gets the link so the lead is never silently lost. R46/R48 —
      // retried independently and logged as a first-class send outcome.
      const notifyTradieUndelivered = async (why: string) => {
        if (!tenantOwnerMobile) {
          logSendOutcome(dispatch, {
            sendType: 'tradie_notify',
            status: 'skipped',
            attempts: 0,
            latencyMs: 0,
            error: `no owner_mobile to notify of undelivered quote (${why})`,
          })
          return
        }
        const r = await sendWithRetry(
          'tradie_notify',
          () => dispatchQuoteMessage({
            to: tenantOwnerMobile!,
            from: tenantSmsNumber ?? undefined,
            text: `Heads up — we couldn't text the customer their quote (${why}). Quote ready: ${appUrl}/q/${shareToken}`,
          }),
          { knobs },
        )
        logSendOutcome(dispatch, r.outcome)
      }
      // R45/R46 review fix — when the customer send fails on both channels we
      // notify the tradie via notifyTradieUndelivered(); this flag stops the
      // Phase-4 "new quote drafted" SMS from ALSO firing (a confusing second
      // tradie text that implies the send succeeded).
      let tradieNotifiedUndelivered = false
      if (reviewDecision.hold) {
        // Customer SMS is held — tradie review path. We fall through to
        // the tradie-notify block below, which uses
        // buildTradieReviewNotification() (approve + edit links)
        // instead of the regular buildTradieDraftNotification().
        // R48 — an intentional, non-alertable skip (the tradie WILL be
        // notified to approve), logged as a first-class outcome.
        logSendOutcome(dispatch, {
          sendType: 'customer_quote',
          status: 'skipped',
          attempts: 0,
          latencyMs: 0,
          error: `held pending tradie approval (${reviewDecision.reason})`,
        })
      } else if (!callerNumber) {
        // R48 — ALERTABLE: a quote row exists but no customer SMS can be sent
        // (no phone on file). `quote_no_customer_sms` makes the "quote inserted
        // but customer never texted" condition a paging-worthy status rather
        // than a free-text err line.
        logSendOutcome(dispatch, {
          sendType: 'customer_quote',
          status: 'quote_no_customer_sms',
          attempts: 0,
          latencyMs: 0,
          error: 'no caller_number (voice call row, SMS convo, or intake.caller.phone all empty)',
        })
        await notifyTradieUndelivered('no customer phone on file')
        return
      } else {
      try {
        dispatch.step('building quote message body')
        // Migration 105 — Gotenberg quote PDF. Best-effort: a render or
        // storage failure never blocks the SMS (the /api/q/[token]/pdf
        // route lazy-generates later anyway). Inspection-routed quotes
        // skip it — no committable prices to put in a document.
        let quotePdfPath: string | null = null
        if (!(draft.needs_inspection ?? false)) {
          quotePdfPath = await ensureQuotePdf(quote!.id)
          if (quotePdfPath) dispatch.ok('quote PDF generated', { path: quotePdfPath })
          else dispatch.ok('quote PDF skipped/unavailable (non-fatal)')
        }
        const quoteForSms = {
          ...quote!,
          scope_short: draft.scope_short ?? null,
          pay_links: payLinks,
          deposit_pct: depositPct,
          needs_inspection: draft.needs_inspection ?? false,
          inspection_reason: draft.inspection_reason ?? null,
          quote_view_url: `${appUrl}/q/${shareToken}`,
          pdf_url: quotePdfPath ? quotePdfUrl(shareToken) : null,
        }
        // Phase A — thread the tenant's display preference through to the
        // SMS so summary-mode tradies don't get "- N items + Yhr labour"
        // bullets in the customer's text.
        const displayMode = asQuoteDisplayMode(
          (pricingBook as { quote_display?: string | null } | null)?.quote_display ?? null,
          'itemised',
        )
        // Mig 142 — thread the tenant/feature tier mode so single-price tradies
        // get one option in the customer SMS, not the full Good/Better/Best list.
        const tierMode = asQuoteTierMode(
          (pricingBook as { quote_tier_mode?: string | null } | null)?.quote_tier_mode ?? null,
        )
        const body = buildQuoteSms(intake, quoteForSms, { displayMode, tierMode })
        const segs = body.length <= 160 ? 1 : Math.ceil(body.length / 153)
        dispatch.ok('body built', { chars: body.length, sms_segments: segs })

        // Origin number policy:
        //   • v6 multi-tenant SMS quote → reply from the TENANT'S
        //     provisioned twilio_sms_number so the customer sees ONE
        //     continuous thread (dialog turns + final quote in the
        //     same conversation, from the same `04xx` they texted).
        //   • Legacy SMS quote (no tenant_id, pre-v6) → fall back to
        //     TWILIO_SMS_NUMBER env so the pilot pipeline still works.
        //   • Voice-sourced quote → fall through to dispatchQuoteMessage's
        //     default (TWILIO_PHONE_NUMBER, the voice line) — preserves
        //     prior voice-path behaviour exactly.
        const fromNumber = isSmsSource
          ? (tenantSmsNumber ?? process.env.TWILIO_SMS_NUMBER)
          : undefined
        if (isSmsSource && !fromNumber) {
          dispatch.err('customer SMS — no tenant FROM number and TWILIO_SMS_NUMBER unset (send may use wrong line)', null, {
            quote_id: quote!.id,
          })
        }
        dispatch.step('attempting SMS first (WhatsApp fallback if SMS rejects)', {
          to: callerNumber,
          from: fromNumber ?? '(default TWILIO_PHONE_NUMBER)',
        })
        // R46-sends — the customer quote SMS retries INDEPENDENTLY at the route
        // level via retryWithBackoff (env-tuned exponential backoff). dispatch
        // already retries the SMS leg + WhatsApp-falls-back; this outer retry
        // adds backoff on a transient *whole-dispatch* failure (e.g. a 429 that
        // survived dispatch's own short retries) and on the thrown-timeout case
        // dispatch can't see. A failure here NEVER aborts the tradie-notify
        // below — they're separate sequential blocks under the outer try.
        // Best-effort MMS attachment of the quote PDF — the shared helper
        // signs the media URL (best-effort) and dispatch retries as a plain
        // SMS automatically when the carrier rejects media; the body always
        // carries the download link.
        const sent = await sendWithRetry(
          'customer_quote',
          () => dispatchQuoteWithPdf({
            to: callerNumber,
            text: body,
            from: fromNumber,
            pdfPath: quotePdfPath,
            signMediaUrl: signQuotePdfUrl,
          }),
          {
            knobs,
            onRetry: (err, nextAttempt, delayMs) =>
              dispatch.step('customer quote retry scheduled', {
                quote_id: quote!.id,
                next_attempt: nextAttempt,
                delay_ms: delayMs,
                code: (err as { code?: unknown })?.code ?? null,
              }),
          },
        )
        // R48 — single structured outcome record for the customer quote send.
        logSendOutcome(dispatch, sent.outcome)

        if (sent.dispatch?.ok) {
          dispatch.done('quote dispatched to caller', {
            quote_id: quote!.id,
            channel: sent.dispatch.channel,
            attempts: sent.attempts,
          })
          // WP7 — the customer has now received the quote. Advance the
          // lifecycle to 'sent' so the follow-up queue can tell who got
          // a quote but hasn't acted. Monotonic + non-throwing: a
          // re-draft / duplicate dispatch is a no-op and a failure here
          // never undoes the (already-delivered) SMS. Inspection-routed
          // quotes are still "sent" — the customer received something.
          await advanceQuoteStatus(supabase, quote!.id, 'sent')

          // Per-tenant file-store ingest — best-effort, post-send. Archives
          // the rendered quote PDF + a minimized KB text doc for retrieval.
          // STUBs when TENANT_FILESTORE_ENABLED !== 'true' and no-ops on
          // missing inputs, so it never blocks or alters the customer send.
          after(async () => {
            try {
              const fullDocPath = await ensureQuotePdf(quote!.id)
              if (!fullDocPath) return
              const { markdown, contentHash } = buildQuoteKbText({
                quote: quote!,
                trade: intakeTrade,
              })
              await archiveAndIngestQuote({
                tenantId: quote!.tenant_id ?? null,
                sourceKind: 'quote',
                sourceId: quote!.id,
                trade: intakeTrade,
                fullDocPath,
                kbText: markdown,
                contentHash,
              })
            } catch {
              /* best-effort */
            }
          })
        } else {
          // Both channels failed after retries — make sure the tradie still
          // gets the link so the lead isn't silently lost. This IS the tradie
          // notification for this quote; suppress the Phase-4 draft ping below
          // so the tradie doesn't get a second, success-implying SMS.
          await notifyTradieUndelivered('SMS + WhatsApp both failed after retries')
          tradieNotifiedUndelivered = true
        }
      } catch (e) {
        // Inner guard kept as defence-in-depth (the outer R45 try also covers
        // this) so a throw in the customer block still lets the tradie-notify
        // block below run.
        logSendOutcome(dispatch, {
          sendType: 'customer_quote',
          status: 'failed',
          attempts: 1,
          latencyMs: 0,
          error: e,
        })
      }
      } // end of: else branch (customer dispatch path — opposite of reviewDecision.hold)

      // ──────────────── Phase 4 / notify ────────────────
      // SMS-only tradie ping. Voice quotes intentionally skip this so the
      // voice path's behaviour stays exactly as it was before Phase 4.
      // Sends BOTH:
      //   • SMS+WhatsApp-fallback to TRADIE_NOTIFY_NUMBER (mobile)
      //   • a standalone WhatsApp to TRADIE_NOTIFY_WHATSAPP (the tradie's
      //     joined-sandbox or registered-WABA WhatsApp identity)
      // Errors are logged but never block.
      if (!isSmsSource) {
        // Voice path intentionally skips the tradie ping (unchanged behaviour).
        // R48 — recorded as a non-alertable skip so the absence of a notify is
        // explained, not silent.
        logSendOutcome(dispatch, {
          sendType: 'tradie_notify',
          status: 'skipped',
          attempts: 0,
          latencyMs: 0,
          error: 'voice-sourced quote — tradie ping skipped by design',
        })
        return
      }

      // Test-mode skip — when the customer's number is a designated test
      // sender (n8n harness, internal QA mobile), do NOT fire the tradie
      // notification SMS. Without this, every stress-test run spams the
      // real tradie owner. Added 2026-05-14 after Jeph received two
      // unexpected "[QuoteMax] New SMS quote drafted" SMSes on his
      // personal mobile during a debug session.
      //
      // Configure via env: TEST_CUSTOMER_NUMBERS=+61489083371,+61400000000
      // The hardcoded fallback covers the existing n8n test harness.
      const testNumbers = new Set(
        (process.env.TEST_CUSTOMER_NUMBERS ?? '+61489083371')
          .split(',').map((s) => s.trim()).filter(Boolean),
      )
      if (callerNumber && testNumbers.has(callerNumber)) {
        logSendOutcome(dispatch, {
          sendType: 'tradie_notify',
          status: 'skipped',
          attempts: 0,
          latencyMs: 0,
          error: `test customer number (${callerNumber}) — tradie spam guard`,
        })
        return
      }

      // v6 multi-tenant: notify the actual TENANT owner, not a shared
      // env-var mobile. The tradie's personal mobile + the from-number
      // used for that notify both come from the tenant row so each
      // tradie sees the message land from their own QuoteMax number
      // ("Sparky — QuoteMax: new quote drafted for Jon · $820"). Env
      // fallback (TRADIE_NOTIFY_*) keeps the legacy pilot working.
      const notifyMobile =
        tenantOwnerMobile ?? process.env.TRADIE_NOTIFY_NUMBER
      const notifyWhatsApp = process.env.TRADIE_NOTIFY_WHATSAPP
      if (!notifyMobile && !notifyWhatsApp) {
        logSendOutcome(dispatch, {
          sendType: 'tradie_notify',
          status: 'skipped',
          attempts: 0,
          latencyMs: 0,
          error: 'tenant.owner_mobile + TRADIE_NOTIFY_* env all empty — nobody to notify',
        })
        return
      }

      try {
        const customerName = intake.caller?.name ?? undefined
        const customerPhone = callerNumber ?? undefined
        const quoteUrl = `${appUrl}/q/${shareToken}`
        const dashboardUrl = `${appUrl}/dashboard`
        // Mig 078 — three-way pick for the tradie SMS body:
        //   1. inspection-required → buildTradieInspectionNotification
        //   2. held by review policy → buildTradieReviewNotification
        //      (approve + edit links, customer SMS not yet sent)
        //   3. auto-sent → buildTradieDraftNotification (today's path)
        const tradieBody = isInspection
          ? buildTradieInspectionNotification({
              tradieFirstName: tenantOwnerFirstName,
              customerName,
              customerPhone,
              jobType: intake.job_type,
              inspectionReason: draft.inspection_reason ?? null,
              quoteUrl,
              dashboardUrl,
            })
          : reviewDecision.hold
            ? buildTradieReviewNotification({
                tradieFirstName: tenantOwnerFirstName,
                customerName,
                customerPhone,
                jobType: intake.job_type,
                itemCount: intake.scope?.item_count ?? undefined,
                totalIncGst: total,
                approveUrl: `${appUrl}/q/${shareToken}/approve`,
                // ?edit=1 is the auto-open hint the TradieEditor reads
                // on mount — without it, the customer-facing quote page
                // shows the edit affordance as a small floating button
                // that's easy to miss on mobile. With it, the editor
                // modal opens immediately on arrival.
                editUrl: `${quoteUrl}?edit=1`,
                policyReason: reviewDecision.reason,
              })
            : buildTradieDraftNotification({
                tradieFirstName: tenantOwnerFirstName,
                customerName,
                customerPhone,
                jobType: intake.job_type,
                itemCount: intake.scope?.item_count ?? undefined,
                totalIncGst: total,
                quoteUrl,
                dashboardUrl,
              })

        if (notifyMobile && !tradieNotifiedUndelivered) {
          // Send the tradie's "new quote drafted" SMS FROM the tenant's
          // own provisioned number so the message lands in the same
          // QuoteMax thread on their phone, not the shared dev line.
          dispatch.step('tradie notify — SMS (with WhatsApp fallback)', {
            to: notifyMobile,
            from: tenantSmsNumber ?? '(default TWILIO_PHONE_NUMBER)',
            tenantBusinessName,
          })
          // R46-sends — the tradie notify retries INDEPENDENTLY of the customer
          // quote send above. They share the outer try, but each has its own
          // retryWithBackoff, so one failing never aborts the other.
          const r = await sendWithRetry(
            'tradie_notify',
            () => dispatchQuoteMessage({
              to: notifyMobile,
              text: tradieBody,
              from: tenantSmsNumber ?? undefined,
            }),
            {
              knobs,
              onRetry: (err, nextAttempt, delayMs) =>
                dispatch.step('tradie notify retry scheduled', {
                  quote_id: quote!.id,
                  next_attempt: nextAttempt,
                  delay_ms: delayMs,
                  code: (err as { code?: unknown })?.code ?? null,
                }),
            },
          )
          logSendOutcome(dispatch, r.outcome)
        }

        // Multi-tenant guardrail (v6+): the explicit shared
        // TRADIE_NOTIFY_WHATSAPP env var was designed for the single-
        // pilot setup. Sending every tenant's customer details to one
        // shared WhatsApp would leak Plumber A's leads onto a number
        // that handles Plumber B's leads too. Skip the env-var path
        // whenever we have a real tenant on the quote. Legacy pre-v6
        // quotes (intakeTenantId == null) still hit the env var for
        // back-compat with the pilot flow.
        //
        // The customer-facing tradie notify already runs WhatsApp as a
        // fallback at the tenant's own mobile (via dispatchQuoteMessage)
        // when SMS gets rejected, so we don't lose WhatsApp delivery —
        // we just stop using the shared sandbox.
        if (notifyWhatsApp && !intakeTenantId) {
          dispatch.step('tradie notify — explicit WhatsApp (legacy pilot only)', {
            to: notifyWhatsApp,
          })
          const r = await sendWhatsApp({ to: notifyWhatsApp, text: tradieBody })
          if (r.ok) {
            dispatch.ok('tradie WhatsApp notify sent', { sid: r.sid, status: r.status })
          } else {
            dispatch.err('tradie WhatsApp notify failed', null, { code: r.code, reason: r.reason })
          }
        } else if (notifyWhatsApp && intakeTenantId) {
          dispatch.ok('tradie WhatsApp notify skipped — tenant-scoped quote (env var is pilot-only)', {
            tenant_id: intakeTenantId,
          })
        }
      } catch (e) {
        dispatch.err('tradie notify threw', e)
      }
      } catch (afterErr) {
        // R45 — TOP-LEVEL after() guard. Any throw that escaped the per-send
        // blocks above (review-branch logic, URL building, an unexpected null
        // deref) lands here. Without this the whole after() died and the
        // customer was left in silence. We:
        //   1. log the escape as an alertable failure, then
        //   2. fire a FALLBACK "your quote is coming" SMS to the customer
        //      (best-effort, only when we actually hold their number and the
        //      quote wasn't held for tradie review), and
        //   3. notify the tradie the quote failed so the lead isn't lost.
        // Each fallback is independently guarded so one failing can't abort
        // the other or re-throw out of after().
        logSendOutcome(dispatch, {
          sendType: 'customer_quote',
          status: 'failed',
          attempts: 1,
          latencyMs: 0,
          error: afterErr,
        })

        const canTextCustomer = !!callerNumber && !reviewDecision.hold
        if (canTextCustomer) {
          try {
            const fromNumber = isSmsSource
              ? (tenantSmsNumber ?? process.env.TWILIO_SMS_NUMBER)
              : undefined
            const fb = await sendWithRetry(
              'failure_notice',
              () => dispatchQuoteMessage({
                to: callerNumber!,
                from: fromNumber,
                text: 'Thanks — we hit a snag finalising your quote, but it’s on the way. We’ll text it through shortly.',
              }),
              { knobs },
            )
            logSendOutcome(dispatch, fb.outcome)
          } catch (fbErr) {
            logSendOutcome(dispatch, {
              sendType: 'failure_notice',
              status: 'failed',
              attempts: 1,
              latencyMs: 0,
              error: fbErr,
            })
          }
        } else {
          logSendOutcome(dispatch, {
            sendType: 'failure_notice',
            status: 'skipped',
            attempts: 0,
            latencyMs: 0,
            error: reviewDecision.hold
              ? 'after() failed while quote held for review — no customer fallback sent'
              : 'after() failed but no customer phone on file — no fallback possible',
          })
        }

        // Tradie "quote failed" notice — independent of the customer fallback.
        const tradieTo = tenantOwnerMobile ?? process.env.TRADIE_NOTIFY_NUMBER
        if (tradieTo) {
          try {
            const tn = await sendWithRetry(
              'tradie_notify',
              () => dispatchQuoteMessage({
                to: tradieTo,
                from: tenantSmsNumber ?? undefined,
                text: `Heads up — a quote draft hit an error while sending. Check it here: ${appUrl}/q/${shareToken}`,
              }),
              { knobs },
            )
            logSendOutcome(dispatch, tn.outcome)
          } catch (tnErr) {
            logSendOutcome(dispatch, {
              sendType: 'tradie_notify',
              status: 'failed',
              attempts: 1,
              latencyMs: 0,
              error: tnErr,
            })
          }
        }
      }
    })

    log.done('estimate handler done', { quote_id: quote!.id })
    return Response.json({ ok: true, quoteId: quote!.id })
  } catch (err: any) {
    log.err('estimate handler failed', err, { stack: err?.stack?.split('\n').slice(0, 4).join(' | ') })
    return Response.json({
      ok: false,
      error: err?.message ?? String(err),
      cause: err?.cause?.message,
      stack: err?.stack?.split('\n').slice(0, 6).join('\n'),
    }, { status: 500 })
  }
}
