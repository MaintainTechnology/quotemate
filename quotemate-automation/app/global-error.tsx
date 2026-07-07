'use client'

// Root-level error boundary — catches errors thrown in the root layout and
// unrecoverable React render errors that escape nested `error.tsx` boundaries.
// Reports them to Sentry, then renders a minimal, dependency-free fallback in
// the app's charcoal + yellow palette.
import * as Sentry from '@sentry/nextjs'
import { useEffect } from 'react'

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string }
}) {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#16120F',
          color: '#F5F3F0',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        <div style={{ textAlign: 'center', padding: '2rem', maxWidth: '28rem' }}>
          <h1 style={{ fontSize: '1.25rem', margin: '0 0 0.5rem', fontWeight: 600 }}>
            Something went wrong
          </h1>
          <p style={{ opacity: 0.7, margin: '0 0 1.5rem', lineHeight: 1.5 }}>
            The error has been logged and we&apos;re looking into it.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              background: '#FFC400',
              color: '#16120F',
              border: 0,
              borderRadius: 0,
              padding: '0.6rem 1.4rem',
              fontWeight: 600,
              fontSize: '0.95rem',
              cursor: 'pointer',
            }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  )
}
