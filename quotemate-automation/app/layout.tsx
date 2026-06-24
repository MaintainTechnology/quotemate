import type { Metadata } from "next";
import { Manrope, JetBrains_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "QuoteMax: We will do the quoting for you. You will never quote again",
  description:
    "Customer texts. AI drafts your Good / Better / Best quote. You review, tweak, send. Built for AU sparkies and plumbers who'd rather be on the tools.",
};

// Browser chrome (mobile address bar). The site defaults to the Maintain
// LIGHT palette on first visit, so the warm-cream tone is the default; the
// dark tone still applies for visitors whose device prefers dark.
export const viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#16120F" },
    { color: "#FAF8F4" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${manrope.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      {/* suppressHydrationWarning: browser extensions (ClickUp etc.) inject
          classes onto <body> before React hydrates — attribute-only, expected. */}
      <body
        suppressHydrationWarning
        className="min-h-full flex flex-col bg-ink-deep text-text-pri"
      >
        {/* Apply the effective theme before first paint so there is no flash.
            A stored choice wins; with no stored choice the site defaults to
            the Maintain LIGHT palette (the primary design target). The
            ThemeToggle reads this data-theme on mount and persists any flip,
            so dark mode stays one click away. Static string, no user input. */}
        <Script id="qm-theme" strategy="beforeInteractive">
          {`(function(){try{var t=localStorage.getItem('qm-theme');var e=document.documentElement;var m=(t==='light'||t==='dark')?t:'light';e.setAttribute('data-theme',m);e.style.colorScheme=m;}catch(e){var el=document.documentElement;el.setAttribute('data-theme','light');el.style.colorScheme='light';}})();`}
        </Script>
        {children}
      </body>
    </html>
  );
}
