import type { Metadata } from "next";
import { Manrope, JetBrains_Mono } from "next/font/google";
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
  title: "QuoteMate — AI receptionist for Australian tradies",
  description:
    "Customer texts. AI drafts your Good / Better / Best quote. You review, tweak, send. Built for AU sparkies and plumbers who'd rather be on the tools.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${manrope.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      {/* suppressHydrationWarning: browser extensions (ClickUp etc.) inject
          classes onto <body> before React hydrates — attribute-only, expected. */}
      <body
        suppressHydrationWarning
        className="min-h-full flex flex-col bg-ink-deep text-text-pri"
      >
        {children}
      </body>
    </html>
  );
}
