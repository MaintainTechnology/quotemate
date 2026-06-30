// Clerk-hosted sign-up (catch-all route so Clerk owns /sign-up,
// /sign-up/verify-email-address, /sign-up/sso-callback, …). Two-column
// editorial split via ClerkAuthShell + the global clerkAppearance theming.
// Lives at /sign-up (hyphenated) and does NOT collide with the existing
// Supabase pages at /signup.

import { SignUp } from "@clerk/nextjs";
import Link from "next/link";
import { ClerkAuthShell } from "@/app/_components/ClerkAuthShell";

export default function ClerkSignUpPage() {
  return (
    <ClerkAuthShell
      editorial={{
        eyebrow: "From the workshop · Vol. I",
        quote:
          "A tradie shouldn’t lose a night to quoting. The customer texts, we draft the quote in under a minute — you review, tweak, send.",
        author: "QuoteMax",
        role: "Built for AU sparkies and plumbers",
        points: [
          "Free to start — see a sample quote in minutes.",
          "Your AI receptionist drafts the quote the moment a customer texts.",
          "You review and send. Never quote at midnight again.",
        ],
      }}
      eyebrow="New · Get started"
      title={
        <>
          Begin your <span className="text-accent">account</span>
        </>
      }
      subtitle="Free to start. Upgrade when your workshop is ready."
      altPrompt={
        <>
          Already onboard?{" "}
          <Link
            href="/sign-in"
            className="font-semibold text-accent hover:text-accent-press"
          >
            Sign in
          </Link>
        </>
      }
      footerNote={
        <p className="font-mono text-[0.7rem] uppercase tracking-[0.14em] text-text-dim">
          No card · We never auto-send quotes without your review
        </p>
      }
    >
      <SignUp />
    </ClerkAuthShell>
  );
}
