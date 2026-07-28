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

import { useRef, useState, type FormEvent } from "react"

const TOPICS = [
  "General enquiry",
  "Pricing and plans",
  "My trade is not listed",
  "Partnership",
  "Something else",
] as const

/** Mirrors MESSAGE_MIN in app/api/contact/route.ts. */
const MESSAGE_MIN = 10

export function ContactForm({ fallbackEmail }: { fallbackEmail?: string }) {
  const [topic, setTopic] = useState<string>(TOPICS[0])
  const [company, setCompany] = useState("") // honeypot
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const statusRef = useRef<HTMLDivElement>(null)

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
        className="edge-lit flex min-h-[26rem] flex-col justify-center rounded-2xl border border-ink-line bg-ink-card p-8 text-center focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft md:p-10"
      >
        <span
          className="mx-auto grid h-12 w-12 place-items-center rounded-lg border border-accent/45 bg-accent/10 font-mono text-xl font-bold text-accent"
          aria-hidden="true"
        >
          &#10003;
        </span>
        <h3 className="mt-5 font-extrabold uppercase tracking-tight text-text-pri text-xl">
          Message sent
        </h3>
        <p className="mx-auto mt-3 max-w-sm text-base leading-relaxed text-text-sec">
          Thanks for getting in touch. Someone will read it and come back to you,
          usually within one business day.
        </p>
      </div>
    )
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="edge-lit flex flex-col rounded-2xl border border-ink-line bg-ink-card p-6 md:p-8"
    >
      <div className="flex items-center justify-between gap-3 border-b border-ink-line pb-4">
        <span className="font-mono text-[0.75rem] font-semibold uppercase tracking-[0.1em] text-text-dim">
          Send us a message
        </span>
        <span className="font-mono text-[0.7rem] uppercase tracking-[0.08em] text-text-dim">
          Takes a minute
        </span>
      </div>

      <div className="mt-6 grid gap-5">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field id="cf-name" label="Your name" required>
            <input
              id="cf-name"
              name="name"
              type="text"
              required
              autoComplete="name"
              maxLength={100}
              className={INPUT}
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
              className={INPUT}
              placeholder="you@yourtrade.com.au"
            />
          </Field>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field id="cf-phone" label="Mobile" hint="Optional">
            <input
              id="cf-phone"
              name="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              maxLength={40}
              className={INPUT}
              placeholder="04xx xxx xxx"
            />
          </Field>
          <Field id="cf-topic" label="What is it about?">
            <select
              id="cf-topic"
              name="topic"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              className={INPUT}
            >
              {TOPICS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
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
            className={`${INPUT} resize-y`}
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
          <p className="mt-5 rounded-lg border border-danger-bright/45 bg-danger-bright/10 px-4 py-3 text-sm leading-relaxed text-text-pri">
            {error}
            {fallbackEmail ? (
              <>
                {" "}
                You can also email us at{" "}
                <a
                  href={`mailto:${fallbackEmail}`}
                  className="link-underline font-semibold"
                >
                  {fallbackEmail}
                </a>
                .
              </>
            ) : null}
          </p>
        ) : null}
      </div>

      <div className="mt-7 flex flex-wrap items-center gap-4">
        <button
          type="submit"
          disabled={submitting}
          aria-busy={submitting}
          className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-accent px-7 py-3.5 text-sm font-semibold uppercase tracking-wider text-accent-ink transition-colors hover:bg-accent-press focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft focus-visible:ring-offset-2 focus-visible:ring-offset-ink-card disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? "Sending" : "Send message"}
        </button>
        <p className="text-sm text-text-dim">
          We use your details to answer you. Nothing else.
        </p>
      </div>
    </form>
  )
}

const INPUT =
  "mt-2 w-full min-h-11 rounded-lg border border-ink-line bg-ink px-3.5 py-2.5 text-sm text-text-pri placeholder:text-text-dim outline-none transition-colors focus:border-accent/60 focus-visible:ring-2 focus-visible:ring-accent-soft"

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
  children: React.ReactNode
}) {
  return (
    <div>
      {/* "Required" is spelled out rather than left to a bare asterisk,
          which carries no meaning to a screen reader on its own. */}
      <label
        htmlFor={id}
        className="flex items-baseline justify-between gap-2 font-mono text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-text-dim"
      >
        <span>{label}</span>
        {required ? (
          <span className="text-text-dim/80">Required</span>
        ) : hint ? (
          <span className="text-text-dim/80">{hint}</span>
        ) : null}
      </label>
      {children}
    </div>
  )
}
