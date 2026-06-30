// Shared Clerk `appearance` — maps every Clerk widget (SignIn, SignUp, the
// UserButton sign-out popover, OTP/verification steps) onto the QuoteMax
// "Maintain" design system.
//
// Design contract (see app/globals.css + .claude/skills/maintain-design-system):
//   • Accent  = Caterpillar yellow #FFC400 (theme-STABLE — same in light/dark).
//   • On-yellow text is ALWAYS charcoal (--accent-ink), never white.
//   • Surfaces/text are theme-AWARE: bg-ink-card / bg-ink-deep / text-pri etc.
//     resolve via CSS variables, so the widget follows the light/dark toggle
//     with zero JS.
//   • Square corners (borderRadius 0), borders over shadows, Manrope display +
//     JetBrains Mono for labels/eyebrows.
//
// IMPORTANT-MODIFIER NOTE (Tailwind v4 trailing `!`):
//   Clerk ships its own internal CSS for inputs / header / social buttons that
//   wins on specificity, so where a token MUST override Clerk we use `text-…!`
//   / `bg-…!`. This is applied ONLY to theme-adaptive tokens (text-pri,
//   text-sec, text-dim, ink-deep, ink-line). It is deliberately NOT used on
//   `text-accent`, because globals.css remaps `.text-accent` to charcoal in
//   light mode (yellow text is illegible on cream) — forcing it would break
//   that. Accent links therefore stay non-important and remap correctly.
//
// Theme-stable values (accent / radius / font) live in `variables` because
// Clerk derives colour scales from them at JS time and can't resolve a CSS
// var() into a scale. Plain string-only object so it can cross the
// Server→Client boundary via <ClerkProvider appearance={...}>. Every class is
// written in full so Tailwind v4's source scan generates it.

export const clerkAppearance = {
  variables: {
    colorPrimary: "#FFC400", // accent — identical in both themes
    colorDanger: "#B91C1C",
    colorSuccess: "#15803D",
    colorWarning: "#B45309",
    colorTextOnPrimaryBackground: "#1C1812", // charcoal on the yellow fill
    borderRadius: "0px",
    fontFamily: 'var(--font-manrope), Manrope, "Inter", system-ui, sans-serif',
    fontFamilyButtons:
      'var(--font-manrope), Manrope, "Inter", system-ui, sans-serif',
  },
  elements: {
    rootBox: "w-full",
    // The auth page's right panel IS the surface now, so the widget itself is
    // transparent/borderless (NGM-style bare form) instead of a card-on-card.
    cardBox: "w-full bg-transparent shadow-none",
    card: "bg-transparent border-0 shadow-none rounded-none p-0 gap-6",

    // We render our own branded heading in ClerkAuthShell — force Clerk's own
    // header off (its internal display:flex beats a plain `hidden`).
    header: "hidden!",

    // Social / SSO buttons — square, outlined, brand surfaces.
    socialButtonsBlockButton:
      "bg-transparent border border-ink-line! text-text-pri! rounded-none hover:bg-ink-deep transition-colors",
    socialButtonsBlockButtonText: "font-semibold text-text-pri!",

    dividerLine: "bg-ink-line!",
    dividerText:
      "font-mono text-[0.65rem] uppercase tracking-[0.16em] text-text-dim!",

    formFieldLabel:
      "font-mono text-[0.7rem] uppercase tracking-[0.14em] text-text-pri! font-semibold",
    formFieldInput:
      "bg-ink-deep! border border-ink-line! text-text-pri! rounded-none focus:border-accent focus:ring-2 focus:ring-accent-soft",
    formFieldInputShowPasswordButton: "text-text-dim! hover:text-text-pri!",
    formFieldAction: "text-accent hover:text-accent-press", // accent: no `!`
    formFieldSuccessText: "text-success",
    formFieldErrorText: "text-danger",
    formFieldHintText: "text-text-dim!",

    // Primary CTA — yellow fill, charcoal label, uppercase, square.
    formButtonPrimary:
      "bg-accent hover:bg-accent-press text-accent-ink font-semibold uppercase tracking-wider rounded-none shadow-none",

    footer: "bg-transparent",
    footerActionText: "text-text-sec!",
    footerActionLink: "text-accent hover:text-accent-press font-semibold", // accent: no `!`

    identityPreview: "bg-ink-deep border border-ink-line! rounded-none",
    identityPreviewText: "text-text-pri!",
    identityPreviewEditButtonIcon: "text-accent",

    // Email-code / OTP verification step.
    otpCodeFieldInput:
      "bg-ink-deep! border border-ink-line! text-text-pri! rounded-none focus:border-accent",
    formResendCodeLink: "text-accent hover:text-accent-press", // accent: no `!`

    alert: "rounded-none border border-ink-line!",
    alertText: "text-text-sec!",
    badge: "rounded-none bg-accent text-accent-ink",
    spinner: "text-accent",

    // UserButton + sign-out popover — the "sign out" surface.
    userButtonPopoverCard:
      "bg-ink-card border border-ink-line! rounded-none shadow-none",
    userButtonPopoverActionButton: "text-text-pri! hover:bg-ink-deep rounded-none",
    userButtonPopoverActionButtonText: "text-text-pri!",
    userButtonPopoverActionButtonIcon: "text-text-dim!",
    userButtonPopoverFooter: "hidden!",
    userPreviewMainIdentifier: "text-text-pri! font-semibold",
    userPreviewSecondaryIdentifier: "text-text-sec!",
  },
}

export default clerkAppearance
