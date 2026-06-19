"use client"

// Light/dark theme toggle for the public site chrome. The effective
// theme is applied pre-paint by the inline script in layout.tsx (which
// reads localStorage) and by the prefers-color-scheme defaults in
// globals.css. This button only flips + persists the choice onto
// <html data-theme>; the CSS does the actual re-skinning via tokens.

import { useEffect, useState } from "react"

type Theme = "light" | "dark"

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null)

  // Resolve the effective theme on mount: an explicit data-theme wins,
  // otherwise fall back to the device preference.
  useEffect(() => {
    const attr = document.documentElement.getAttribute("data-theme")
    if (attr === "light" || attr === "dark") {
      setTheme(attr)
    } else {
      setTheme(
        window.matchMedia("(prefers-color-scheme: light)").matches
          ? "light"
          : "dark",
      )
    }
  }, [])

  function toggle() {
    const next: Theme = theme === "light" ? "dark" : "light"
    setTheme(next)
    const el = document.documentElement
    el.setAttribute("data-theme", next)
    el.style.colorScheme = next
    try {
      localStorage.setItem("qm-theme", next)
    } catch {
      /* private mode / blocked storage — ignore */
    }
  }

  // Stable-size placeholder until the theme is known, so the nav doesn't
  // shift and the SSR/CSR markup match (no hydration warning).
  if (theme === null) {
    return <span className="block h-11 w-11 md:h-9 md:w-9" aria-hidden="true" />
  }

  const target = theme === "dark" ? "light" : "dark"
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Switch to ${target} mode`}
      title={`Switch to ${target} mode`}
      className="inline-flex h-11 w-11 items-center justify-center border border-ink-line text-text-sec transition-colors hover:border-text-dim hover:text-text-pri focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft focus-visible:ring-offset-2 focus-visible:ring-offset-ink-deep md:h-9 md:w-9"
    >
      {theme === "dark" ? <SunIcon /> : <MoonIcon />}
    </button>
  )
}

function SunIcon() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2.5M12 19.5V22M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2 12h2.5M19.5 12H22M4.2 19.8 6 18M18 6l1.8-1.8" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20.5 14.8A8.2 8.2 0 1 1 9.2 3.5a6.4 6.4 0 0 0 11.3 11.3Z" />
    </svg>
  )
}
