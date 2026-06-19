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
  title: "QuoteMate: AI receptionist for Australian tradies",
  description:
    "Customer texts. AI drafts your Good / Better / Best quote. You review, tweak, send. Built for AU sparkies and plumbers who'd rather be on the tools.",
};

// Browser chrome (mobile address bar) matches each theme.
export const viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0E1622" },
    { media: "(prefers-color-scheme: light)", color: "#F2EEE6" },
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
        {/* Apply a stored theme choice before first paint so there is no
            flash. No stored choice falls through to the prefers-color-scheme
            default in globals.css. Static string, no user input. */}
        <Script id="qm-theme" strategy="beforeInteractive">
          {`(function(){try{var t=localStorage.getItem('qm-theme');if(t==='light'||t==='dark'){var e=document.documentElement;e.setAttribute('data-theme',t);e.style.colorScheme=t;}}catch(e){}})();`}
        </Script>
        {children}
      </body>
    </html>
  );
}
