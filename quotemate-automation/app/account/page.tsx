// /account — Clerk verification surface for the dev setup.
//
// Server Component that reads the Clerk session via `currentUser()` (only
// works because proxy.ts runs clerkMiddleware). It renders the signed-in
// user's identity + the Clerk <UserButton/> so you can confirm the whole
// loop works: sign up → land here → see your profile + sign out.
//
// NOTE: this is NOT yet wired to the tenant model — it shows the raw Clerk
// identity only. Linking a Clerk user to a `tenants` row is a later
// migration step (the dashboard still authenticates via Supabase).

import { currentUser } from "@clerk/nextjs/server";
import { UserButton } from "@clerk/nextjs";
import { redirect } from "next/navigation";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const email = user.primaryEmailAddress?.emailAddress ?? user.emailAddresses[0]?.emailAddress ?? "—";
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ") || "there";

  return (
    <main className="min-h-screen flex items-center justify-center bg-ink-deep px-6 py-16">
      <div className="w-full max-w-lg border border-ink-line bg-ink-card p-8 md:p-10">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="font-mono text-[0.65rem] uppercase tracking-[0.16em] text-accent font-bold">
              Clerk · connected
            </div>
            <h1 className="mt-2 font-extrabold uppercase text-2xl tracking-[-0.02em] text-text-pri">
              Hi {name}
            </h1>
          </div>
          {/* The profile icon — proves the signed-in Clerk session is live.
              Sign-out redirect is configured on <ClerkProvider> in layout.tsx. */}
          <UserButton />
        </div>

        <dl className="mt-8 grid gap-4 text-sm">
          <div className="flex justify-between gap-4 border-b border-ink-line pb-3">
            <dt className="font-mono text-[0.7rem] uppercase tracking-[0.14em] text-text-dim">Email</dt>
            <dd className="text-text-pri">{email}</dd>
          </div>
          <div className="flex justify-between gap-4 border-b border-ink-line pb-3">
            <dt className="font-mono text-[0.7rem] uppercase tracking-[0.14em] text-text-dim">Clerk user id</dt>
            <dd className="font-mono text-xs text-text-sec break-all">{user.id}</dd>
          </div>
        </dl>

        <p className="mt-8 text-sm leading-relaxed text-text-sec">
          You&rsquo;re signed in through Clerk. This page is the dev
          verification surface — the tradie dashboard still authenticates via
          Supabase until the auth migration links your Clerk identity to a
          tenant.
        </p>

        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href="/"
            className="inline-flex items-center border border-ink-line bg-transparent px-5 py-3 text-xs font-semibold uppercase tracking-wider text-text-pri transition-colors hover:bg-ink-deep"
          >
            Home
          </Link>
        </div>
      </div>
    </main>
  );
}
