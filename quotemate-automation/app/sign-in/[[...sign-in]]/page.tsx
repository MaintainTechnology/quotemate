// Clerk-hosted sign-in (catch-all route — see the sign-up page for the
// /sign-in vs /signin coexistence note). Two-column editorial split via
// ClerkAuthShell + the global clerkAppearance theming.

import { SignIn } from "@clerk/nextjs";
import Link from "next/link";
import { ClerkAuthShell } from "@/app/_components/ClerkAuthShell";

export default function ClerkSignInPage() {
  return (
    <ClerkAuthShell
      editorial={{
        eyebrow: "From the workshop · Vol. II",
        quote:
          "The quote you started this morning is right here — your pricing, your jobs, your AI receptionist, exactly where you left them.",
        author: "QuoteMax",
        role: "Built in Australia, for tradies",
        points: [
          "Pick up every quote where you left off.",
          "Your AI receptionist keeps drafting while you’re on the tools.",
          "Pricing, jobs and chats — one workshop, one login.",
        ],
      }}
      eyebrow="Returning · Sign in"
      title={
        <>
          Welcome <span className="text-accent">back</span>
        </>
      }
      subtitle="Pick up where you left off — your pricing, your quotes, your AI receptionist."
      altPrompt={
        <>
          New here?{" "}
          <Link
            href="/sign-up"
            className="font-semibold text-accent hover:text-accent-press"
          >
            Create an account
          </Link>
        </>
      }
    >
      <SignIn />
    </ClerkAuthShell>
  );
}
