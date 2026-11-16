"use client"

// The three plan cards with a Monthly / Annual billing toggle. Shared by
// the homepage pricing section (variant="home") and the dedicated
// /pricing page (variant="full"). QuoteMax Site Kit: a pill segmented
// toggle, paper cards (24px radius) with the featured (Pro) tier as a black
// card, prices in tabular Inter at weight 400. "home" is the same cards,
// tighter, with the link through to /pricing.

import { useRouter } from "next/navigation"
import { useState } from "react"
import { getAuthToken } from "@/lib/auth/client-token"
import { writePlanIntent } from "@/lib/billing/plan-intent"
import { BtnInner, Button, btnClass } from "./site-ui"
import {
  PLANS,
  annualPerMonth,
  annualSaving,
  aud,
  hasFreeTrial,
  type Plan,
  type PlanId,
} from "./pricing-data"

export function PricingTiers({
  variant = "full",
}: {
  variant?: "home" | "full"
}) {
  const [annual, setAnnual] = useState(true)
  const compact = variant === "home"

  return (
    <div>
      <BillingToggle annual={annual} setAnnual={setAnnual} centred={!compact} />

      <div className="mt-8 grid gap-4 lg:grid-cols-3">
        {PLANS.map((plan) => (
          <PlanCard key={plan.id} plan={plan} annual={annual} compact={compact} />
        ))}
      </div>

      <div
        className={`mt-6 flex flex-wrap items-center gap-x-8 gap-y-5 ${
          compact ? "justify-between" : "justify-center text-center"
        }`}
      >
        {/* qs-small (body colour), not qs-meta: the muted meta grey drops
            under 4.5:1 if the home section sits on the paper band. */}
        <p className="qs-small max-w-[40rem]">
          All prices in AUD, ex-GST. Starter Monthly includes a 14-day free
          trial; every other plan starts straight away. Cancel anytime.
        </p>
        {compact && (
          <Button href="/pricing" variant="secondary" arrow>
            See full pricing &amp; feature comparison
          </Button>
        )}
      </div>
    </div>
  )
}

function BillingToggle({
  annual,
  setAnnual,
  centred,
}: {
  annual: boolean
  setAnnual: (v: boolean) => void
  centred: boolean
}) {
  return (
    <div
      className={`flex flex-wrap items-center gap-x-5 gap-y-3 ${
        centred ? "justify-center" : ""
      }`}
    >
      <div
        className="inline-flex rounded-full border border-[var(--qs-line-strong)] bg-white p-[3px]"
        role="group"
        aria-label="Billing period"
      >
        <ToggleButton active={!annual} onClick={() => setAnnual(false)}>
          Monthly
        </ToggleButton>
        <ToggleButton active={annual} onClick={() => setAnnual(true)}>
          Annual
        </ToggleButton>
      </div>
      <span className="qs-small inline-flex items-center gap-2 font-medium text-[var(--qs-ink)]">
        <span
          className="size-2 rounded-full bg-[var(--qs-brand)]"
          aria-hidden="true"
        />
        Save ~17% · 2 months free
      </span>
    </div>
  )
}

function ToggleButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`min-h-11 min-w-[6.5rem] rounded-full px-5 text-[14px] font-medium tracking-[-0.02em] ${
        active
          ? "bg-[var(--qs-ink)] text-white"
          : "text-[var(--qs-body)] hover:bg-[var(--qs-paper)] hover:text-[var(--qs-ink)]"
      }`}
    >
      {children}
    </button>
  )
}

// Auth-aware CTA. Signed-in tradies go straight to a Stripe subscription
// Checkout for the chosen plan; signed-out visitors are sent to signup with
// the plan carried in the query so the choice survives onboarding.
function CheckoutButton({
  plan,
  interval,
  featured,
  compact,
}: {
  plan: PlanId
  interval: "month" | "year"
  featured: boolean
  compact: boolean
}) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function start() {
    // Stash the choice so it survives signup + email verification; the
    // dashboard Billing tab resumes this plan's Checkout after onboarding.
    const goSignup = () => {
      writePlanIntent(plan, interval)
      router.push(`/signup?plan=${plan}&interval=${interval}`)
    }
    setLoading(true)
    setError(null)
    try {
      const token = await getAuthToken()
      if (!token) {
        goSignup()
        return
      }
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ plan, interval }),
      })
      if (!res.ok) {
        setError("Couldn't start checkout. Please try again in a moment.")
        return
      }
      const json = (await res.json()) as { url?: string; updated?: boolean }
      if (json.url) {
        window.location.assign(json.url)
        return
      }
      // Existing subscriber → plan changed in place (prorated), no Checkout.
      // Send them to the dashboard billing tab to see the updated state.
      if (json.updated) {
        window.location.assign("/dashboard?tab=billing&switched=1")
        return
      }
      // Authed but no tenant yet → finish onboarding first.
      goSignup()
    } catch {
      setError("Couldn't start checkout. Check your connection and try again.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      {/* On the black (featured) card the kit's .qs-dark scope turns the
          primary pill white; the paper cards get the white hairline pill. */}
      <button
        type="button"
        onClick={start}
        disabled={loading}
        aria-busy={loading}
        aria-describedby={error ? `${plan}-checkout-error` : undefined}
        className={btnClass(
          featured ? "primary" : "secondary",
          compact ? "md" : "lg",
          "qs-btn--block",
        )}
      >
        <BtnInner arrow>
          {loading
            ? "Starting…"
            : hasFreeTrial(plan, interval)
              ? "Start free trial"
              : "Get started"}
        </BtnInner>
      </button>
      {error && (
        <p
          id={`${plan}-checkout-error`}
          role="alert"
          className={`mt-2 text-[13px] font-medium ${
            featured ? "text-[#ffb4a8]" : "text-[#b42318]"
          }`}
        >
          {error}
        </p>
      )}
    </div>
  )
}

function PlanCard({
  plan,
  annual,
  compact,
}: {
  plan: Plan
  annual: boolean
  compact: boolean
}) {
  const featured = !!plan.featured
  const perMonth = annual ? annualPerMonth(plan) : plan.monthly
  // h2 on /pricing (the cards sit straight under the page's h1); h3 under
  // the homepage pricing section's h2 — the outline stays in order on both.
  const Name = compact ? "h3" : "h2"

  return (
    <div
      className={[
        "qs-card h-full",
        // .qs-dark remaps the type, the pill CTA and focus ring to the black card.
        featured && "qs-card--dark qs-dark",
        compact ? "gap-6 p-6 sm:p-8" : "gap-8 p-7 sm:p-8 xl:p-10",
        // 768–1023px: the cards stack, so each lays out as two columns; the
        // highlight list gets the wider one so its lines don't orphan a word.
        "md:max-lg:grid md:max-lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] md:max-lg:items-start md:max-lg:gap-x-8",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className={`flex flex-col ${compact ? "gap-5" : "gap-6"}`}>
        {/* The badge shares the name's row (negative margin keeps the row at
            the name's height) so the tagline gets the full width and the
            prices line up across all three cards. */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between gap-3">
            <Name className="qs-title">{plan.name}</Name>
            {featured && (
              <span className="-my-1 inline-flex flex-none items-center rounded-full bg-[var(--qs-brand)] px-3 py-1 text-[12px] font-medium leading-[1.4] text-[var(--qs-brand-ink)]">
                Most popular
              </span>
            )}
          </div>
          <p className="qs-small">{plan.tagline}</p>
        </div>

        <div>
          <p className="flex items-baseline gap-1.5">
            <span
              className={`qs-stat__value ${
                compact ? "" : "text-[clamp(2.5rem,2rem+1.2vw,3rem)]"
              }`}
            >
              {aud(perMonth)}
            </span>
            <span className="qs-small">/ mo</span>
          </p>
          <p className="qs-small mt-2">
            {annual ? (
              <>
                Billed {aud(plan.annual)}/yr ·{" "}
                <span className="qs-ink font-medium">
                  save {aud(annualSaving(plan))}
                </span>
              </>
            ) : (
              <>Billed monthly · or {aud(plan.annual)}/yr</>
            )}
          </p>
        </div>

        <CheckoutButton
          plan={plan.id}
          interval={annual ? "year" : "month"}
          featured={featured}
          compact={compact}
        />
      </div>

      <div
        className={`flex flex-col gap-4 border-t pt-6 md:max-lg:border-t-0 md:max-lg:border-l md:max-lg:pt-0 md:max-lg:pl-8 ${
          featured ? "border-white/[0.12]" : "border-black/[0.08]"
        }`}
      >
        {plan.inheritsFrom && (
          <p className="qs-small qs-ink font-medium">
            Everything in {plan.inheritsFrom}, plus:
          </p>
        )}
        <ul className="flex flex-col gap-3">
          {plan.highlights.map((h) => (
            <li
              key={h}
              className="flex items-start gap-3 text-[15px] leading-[1.45] text-pretty"
            >
              <Check className="qs-ink mt-px size-[18px] flex-none" />
              {/* Glue "mins / mo" so a wrap never strands "/ mo"; text-pretty
                  then carries the number down with its unit. */}
              {h.replace(" / ", " / ")}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

// ponytail: the kit ships Arrow + Chevron only; a thin check lives here.
function Check({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M4.5 12.5l5 5L19.5 7" />
    </svg>
  )
}
