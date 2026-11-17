// Inter — the face of the Atomos-derived kits: the marketing Site Kit
// (app/_components/site-kit.css) and the Dashboard Kit
// (app/dashboard/dash-kit.css).
//
// One definition, imported wherever it is needed (Next's "font definitions
// file" pattern): each call to a font loader hosts a separate instance, so
// defining Inter once here means the marketing pages and the dashboard share
// the same files and the same `--font-qs` variable instead of two copies.
//
// It lives in its own module rather than in ./index.ts on purpose: the root
// layout imports ./index.ts, and anything defined there is preloaded on every
// route — including the customer quote pages, which stay on Manrope.
import { Inter } from "next/font/google";

export const inter = Inter({ subsets: ["latin"], variable: "--font-qs", display: "swap" });
