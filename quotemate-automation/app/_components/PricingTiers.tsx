"use client"

// The three plan cards with a Monthly / Annual billing toggle. Shared by
// the homepage pricing section (variant="home") and the dedicated
// /pricing page (variant="full"). Maintain design system — square cards,
// orange accent on the featured (Pro) tier, mono tabular-nums for prices.

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { getBrowserSupabase } from "@/lib/supabase/client"
import { writePlanIntent } from "@/lib/billing/plan-intent"
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

  return (
    <div>
      <BillingToggle annual={annual} setAnnual={setAnnual} />

      <div className="mt-10 grid gap-4 lg:grid-cols-3">
        {PLANS.map((plan) => (
          <PlanCard key={plan.id} plan={plan} annual={annual} />
        ))}
      </div>

      <p className="mt-6 text-sm leading-relaxed text-text-dim">
        All prices in AUD, ex-GST. Starter Monthly includes a 14-day free
        trial; every other plan starts straight away. Cancel anytime.
      </p>

      {variant === "home" && (
        <div className="mt-7">
          <Link
            href="/pricing"
            className="link-underline pb-0.5 font-mono text-sm font-semibold uppercase tracking-[0.12em] text-accent hover:text-accent-soft"
          >
            See full pricing &amp; feature comparison →
          </Link>
        </div>
      )}
    </div>
  )
}

function BillingToggle({
  annual,
  setAnnual,
}: {
  annual: boolean
  setAnnual: (v: boolean) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-4">
      <div
        className="inline-flex border border-ink-line bg-ink-card p-1"
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
      <span className="font-mono text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-accent">
        Save ~17% — 2 months free
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
      className={`px-5 py-2 text-xs font-semibold uppercase tracking-wider transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft focus-visible:ring-offset-2 focus-visible:ring-offset-ink-deep ${
        active
          ? "bg-accent text-white"
          : "bg-transparent text-text-sec hover:text-text-pri"
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
}: {
  plan: PlanId
  interval: "month" | "year"
  featured: boolean
}) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  async function start() {
    // Stash the choice so it survives signup + email verification; the
    // dashboard Billing tab resumes this plan's Checkout after onboarding.
    const goSignup = () => {
      writePlanIntent(plan, interval)
      router.push(`/signup?plan=${plan}&interval=${interval}`)
    }
    setLoading(true)
    try {
      const supabase = getBrowserSupabase()
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
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
      const json = (await res.json()) as { url?: string }
      if (json.url) {
        window.location.assign(json.url)
        return
      }
      // Authed but not onboarded (no tenant) or an error → onboarding.
      goSignup()
    } catch {
      goSignup()
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      type="button"
      onClick={start}
      disabled={loading}
      className={`mt-7 inline-flex items-center justify-center gap-2 px-6 py-3.5 text-sm font-semibold uppercase tracking-wider transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft focus-visible:ring-offset-2 focus-visible:ring-offset-ink-deep disabled:opacity-60 ${
        featured
          ? "bg-accent text-white hover:bg-accent-press"
          : "border border-ink-line bg-transparent text-text-pri hover:border-text-dim hover:bg-ink"
      }`}
    >
      {loading
        ? "Starting…"
        : hasFreeTrial(plan, interval)
          ? "Start free trial"
          : "Get started"}
    </button>
  )
}

function PlanCard({ plan, annual }: { plan: Plan; annual: boolean }) {
  const featured = !!plan.featured
  const perMonth = annual ? annualPerMonth(plan) : plan.monthly

  return (
    <div
      className={`edge-lit card-sweep relative flex h-full flex-col border bg-ink-card p-6 transition-colors duration-300 md:p-8 ${
        featured
          ? "border-accent/50 hover:border-accent/70"
          : "border-ink-line hover:border-text-dim"
      }`}
    >
      {featured && (
        <>
          <span
            className="absolute inset-x-0 top-0 h-0.5 bg-accent"
            aria-hidden="true"
          />
          <span className="absolute right-5 top-5 bg-accent px-2.5 py-1 font-mono text-[0.6rem] font-bold uppercase tracking-[0.12em] text-white">
            Most popular
          </span>
        </>
      )}

      <h3 className="font-extrabold uppercase tracking-tight text-text-pri text-2xl">
        {plan.name}
      </h3>
      <p className="mt-1.5 font-mono text-[0.72rem] uppercase tracking-[0.1em] text-text-dim">
        {plan.tagline}
      </p>

      <div className="mt-6 flex items-baseline gap-2">
        <span
          className={`font-mono text-5xl font-bold tabular-nums tracking-tight ${
            featured ? "text-accent" : "text-text-pri"
          }`}
        >
          {aud(perMonth)}
        </span>
        <span className="font-mono text-xs uppercase tracking-[0.14em] text-text-dim">
          / mo
        </span>
      </div>
      <p className="mt-2 min-h-[1.25rem] text-sm text-text-sec">
        {annual ? (
          <>
            Billed {aud(plan.annual)}/yr ·{" "}
            <span className="text-accent">save {aud(annualSaving(plan))}</span>
          </>
        ) : (
          <>Billed monthly · or {aud(plan.annual)}/yr</>
        )}
      </p>

      <CheckoutButton
        plan={plan.id}
        interval={annual ? "year" : "month"}
        featured={featured}
      />

      {plan.inheritsFrom && (
        <p className="mt-7 font-mono text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-text-dim">
          Everything in {plan.inheritsFrom}, plus:
        </p>
      )}
      <ul className={`grid gap-2.5 ${plan.inheritsFrom ? "mt-3" : "mt-7"}`}>
        {plan.highlights.map((h) => (
          <li
            key={h}
            className="flex items-baseline gap-3 text-sm leading-relaxed text-text-sec"
          >
            <span className="font-mono text-xs text-accent" aria-hidden="true">
              →
            </span>
            {h}
          </li>
        ))}
      </ul>
    </div>
  )
}
