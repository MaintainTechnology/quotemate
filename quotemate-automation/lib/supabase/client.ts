// Browser-side Supabase client for client components.
//
// Uses the public anon key (safe to ship to the browser — Row Level
// Security policies on the database enforce who can read/write what).
// For server-side privileged operations (signing up users, writing
// across tenants), the API routes continue to use SUPABASE_SERVICE_ROLE_KEY
// directly via @supabase/supabase-js's createClient.

'use client'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let _client: SupabaseClient | null = null

export function getBrowserSupabase(): SupabaseClient {
  if (_client) return _client
  _client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // detectSessionInUrl handles legacy hash-fragment links
        // (#access_token=...). PKCE links (?code=...) AND OTP token-hash
        // links (?token_hash=...&type=signup) are handled explicitly in
        // /auth/callback/page.tsx — both shapes need an explicit exchange
        // call which detectSessionInUrl does NOT cover.
        detectSessionInUrl: true,
        // PKCE is the modern, more secure email-confirmation flow.
        // Forces Supabase to send links shaped like
        //   <project>.supabase.co/auth/v1/verify?token=...&redirect_to=
        //     <our app>/auth/callback?code=<short-lived auth code>
        // The code is then exchanged for a session via
        // supabase.auth.exchangeCodeForSession(code) on the callback page.
        flowType: 'pkce',
      },
    },
  )
  return _client
}
