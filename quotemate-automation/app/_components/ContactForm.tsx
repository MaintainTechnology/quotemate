"use client"

// The contact form island. Posts JSON to /api/contact, which validates
// again server-side and emails the enquiry through Resend.
//
// FIELD VALIDATION IS NATIVE, not hand-rolled: required, type="email",
// minLength and maxLength on the controls block the submit and produce a
// localised browser message before onSubmit ever runs. An earlier pass also
// checked the message length in JS, which was simply unreachable code behind
// minLength. The route re-validates everything server-side regardless, since
// nothing arriving over the wire can be trusted.
//
// The error panel below therefore reports only what the client cannot know
// in advance: a rejected payload, the rate limit, a failed send, a dropped
// network. It takes focus when it appears so a screen-reader or keyboard user
// is told what happened, rather than being left on a submit button whose
// label just changed.
//
// Presentation: the kit's white form card on the paper band (24px radius,
// hairline border), qs-field / qs-label / qs-input controls and the black
// pill submit. Site-ui, not site: this is a client island.

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react"
import { BtnInner, Chevron, btnClass } from "./site-ui"

const TOPICS = [
  "General enquiry",
  "Pricing and plans",
  "My trade is not listed",
  "Partnership",
  "Something else",
] as const

/** Mirrors MESSAGE_MIN in app/api/contact/route.ts. */
const MESSAGE_MIN = 10

const CARD =
  "rounded-[var(--qs-r-xl)] border border-[var(--qs-line)] bg-[var(--qs-white)] p-6 sm:p-8"

export function ContactForm({ fallbackEmail }: { fallbackEmail?: string }) {
  const [topic, setTopic] = useState<string>(TOPICS[0])
  const [company, setCompany] = useState("") // honeypot
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const statusRef = useRef<HTMLDivElement>(null)

  // The submit button unmounts with the form, which would drop focus to
  // <body>; and a status region that mounts already filled often goes
  // unannounced. Focusing the confirmation fixes both.
  useEffect(() => {
    if (sent) statusRef.current?.focus()
  }, [sent])

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const data = new FormData(form)
    const payload = {
      name: String(data.get("name") ?? "").trim(),
      email: String(data.get("email") ?? "").trim(),
      phone: String(data.get("phone") ?? "").trim(),
      topic,
      message: String(data.get("message") ?? "").trim(),
      company,
    }

    setError(null)
    setSubmitting(true)
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(
          (body as { message?: string }).message ??
            "That did not send. Please try again in a moment.",
        )
      }
      setSent(true)
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "That did not send. Please try again in a moment.",
      )
      statusRef.current?.focus()
    } finally {
      setSubmitting(false)
    }
  }

  if (sent) {
    return (
      <div
        ref={statusRef}
        tabIndex={-1}
        role="status"
        // min-h keeps the panel roughly the height of the form it replaces,
        // so confirming does not yank the rest of the page up the viewport.
        className={`${CARD} flex min-h-[26rem] flex-col items-center justify-center gap-4 text-center focus:outline-none`}
      >
        {/* Yellow as a fill with an ink tick (13:1), never as text. */}
        <span
          className="grid h-14 w-14 place-items-center rounded-full bg-[var(--qs-brand)] text-[var(--qs-brand-ink)]"
          aria-hidden="true"
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
        </span>
        <h3 className="qs-h4">Message sent</h3>
        <p className="qs-text max-w-sm">
          Thanks for getting in touch. Someone will read it and come back to you,
          usually within one business day.
        </p>
      </div>
    )
  }

  return (
    <form
      onSubmit={handleSubmit}
      // The kit marks a focused field with an ink border + soft halo
      // (.qs-input:focus); this drops the extra ring globals.css adds.
      // @container: the field pairs below split on the card's own width,
      // not the viewport's — the card is narrowest beside the copy at 1024.
      className={`${CARD} @container flex flex-col`}
    >
      <div className="flex items-baseline justify-between gap-3 border-b border-[var(--qs-line)] pb-5">
        <p className="qs-h5 qs-ink">Send us a message</p>
        <p className="qs-meta">Takes a minute</p>
      </div>

      <div className="mt-6 grid gap-5">
        <div className="grid gap-5 @md:grid-cols-2">
          <Field id="cf-name" label="Your name" required>
            <input
              id="cf-name"
              name="name"
              type="text"
              required
              autoComplete="name"
              maxLength={100}
              className="qs-input"
              placeholder="Dave Roberts"
            />
          </Field>
          <Field id="cf-email" label="Email" required>
            <input
              id="cf-email"
              name="email"
              type="email"
              required
              autoComplete="email"
              maxLength={200}
              className="qs-input"
              placeholder="you@yourtrade.com.au"
            />
          </Field>
        </div>

        <div className="grid gap-5 @md:grid-cols-2">
          <Field id="cf-phone" label="Mobile" hint="Optional">
            <input
              id="cf-phone"
              name="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              maxLength={40}
              className="qs-input"
              placeholder="04xx xxx xxx"
            />
          </Field>
          <Field id="cf-topic" label="What is it about?">
            {/* Native select, with the kit chevron in place of the
                platform arrow so it matches the inputs beside it. */}
            <div className="relative">
              <select
                id="cf-topic"
                name="topic"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                className="qs-input cursor-pointer appearance-none pr-11"
              >
                {TOPICS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <Chevron className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[var(--qs-ink)]" />
            </div>
          </Field>
        </div>

        <Field id="cf-message" label="Message" required>
          <textarea
            id="cf-message"
            name="message"
            required
            rows={5}
            minLength={MESSAGE_MIN}
            maxLength={4000}
            className="qs-input"
            placeholder="Tell us what you are after. If you are a tradie, your trade and where you work helps us answer properly."
          />
        </Field>
      </div>

      {/* Honeypot. Hidden from people, catches the naive bots; the route
          drops anything that fills it in. */}
      <div className="hidden" aria-hidden="true">
        <label htmlFor="cf-company">Company</label>
        <input
          id="cf-company"
          name="company"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={company}
          onChange={(e) => setCompany(e.target.value)}
        />
      </div>

      {/* Always in the DOM so the live region is registered before it has
          anything to announce; empty until something goes wrong. */}
      <div
        ref={statusRef}
        tabIndex={-1}
        role="alert"
        aria-live="polite"
        className="focus:outline-none"
      >
        {error ? (
          <p className="mt-5 rounded-[var(--qs-r-sm)] border border-[#c2410c]/30 bg-[#c2410c]/[0.06] px-4 py-3 text-sm leading-relaxed text-[var(--qs-ink)]">
            {error}
            {fallbackEmail ? (
              <>
                {" "}
                You can also email us at{" "}
                <a href={`mailto:${fallbackEmail}`} className="qs-link">
                  {fallbackEmail}
                </a>
                .
              </>
            ) : null}
          </p>
        ) : null}
      </div>

      <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-3">
        <button
          type="submit"
          disabled={submitting}
          aria-busy={submitting}
          className={btnClass("primary", "lg")}
        >
          <BtnInner arrow>{submitting ? "Sending" : "Send message"}</BtnInner>
        </button>
        <p className="qs-meta">
          We use your details to answer you. Nothing else.
        </p>
      </div>
    </form>
  )
}

function Field({
  id,
  label,
  hint,
  required = false,
  children,
}: {
  id: string
  label: string
  /** Shown beside the label, e.g. "Optional". */
  hint?: string
  required?: boolean
  children: ReactNode
}) {
  return (
    <div className="qs-field">
      {/* "Required" is spelled out rather than left to a bare asterisk,
          which carries no meaning to a screen reader on its own. */}
      <label
        htmlFor={id}
        className="qs-label flex items-baseline justify-between gap-2"
      >
        <span>{label}</span>
        {required ? (
          <span className="qs-meta font-normal">Required</span>
        ) : hint ? (
          <span className="qs-meta font-normal">{hint}</span>
        ) : null}
      </label>
      {children}
    </div>
  )
}
