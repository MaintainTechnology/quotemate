// Manrope and JetBrains Mono, self-hosted from the files beside this module so
// a build never downloads fonts. next/font/google fetched them from
// fonts.gstatic.com on every build, and one failed download failed the build.
//
// These are the exact files next/font/google self-hosted (sha256-matched
// against production on 5 Nov 2026), declared with the same six unicode-range
// subsets, discrete weights, family names, preloads (latin only) and fallback
// metrics, so the CSS is the CSS the Google loader made. Both fonts are
// SIL OFL 1.1; the licences sit beside the files.
//
// Why it looks like this:
// - next/font/local takes one unicode-range per call, so each subset is a call.
// - The `font-family` declaration merges the calls into one family, named
//   "Manrope" / "JetBrains Mono" as before; some HTML and SVG name them
//   literally. Single quotes only: Turbopack mangles a double-quoted value.
// - next/font's `.variable` class would name the const, not that family, so
//   the CSS variables and the fallback faces come from fonts.module.css.
//
// To refresh: fetch fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800
// (and JetBrains+Mono:wght@400;500;600;700) with next/font's User-Agent
// (Chrome 104 on macOS) and save each subset's woff2 under its name here.
import localFont from "next/font/local";
import styles from "./fonts.module.css";

/* eslint-disable @typescript-eslint/no-unused-vars -- each call only has to
   exist: it ships its @font-face rules. next/font requires the const. */

const manropeCyrillicExt = localFont({
  src: [
    { path: "./manrope/cyrillic-ext.woff2", weight: "400" },
    { path: "./manrope/cyrillic-ext.woff2", weight: "500" },
    { path: "./manrope/cyrillic-ext.woff2", weight: "600" },
    { path: "./manrope/cyrillic-ext.woff2", weight: "700" },
    { path: "./manrope/cyrillic-ext.woff2", weight: "800" },
  ],
  preload: false,
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "'Manrope'" },
    { prop: "unicode-range", value: "U+0460-052F, U+1C80-1C8A, U+20B4, U+2DE0-2DFF, U+A640-A69F, U+FE2E-FE2F" },
  ],
});

const manropeCyrillic = localFont({
  src: [
    { path: "./manrope/cyrillic.woff2", weight: "400" },
    { path: "./manrope/cyrillic.woff2", weight: "500" },
    { path: "./manrope/cyrillic.woff2", weight: "600" },
    { path: "./manrope/cyrillic.woff2", weight: "700" },
    { path: "./manrope/cyrillic.woff2", weight: "800" },
  ],
  preload: false,
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "'Manrope'" },
    { prop: "unicode-range", value: "U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116" },
  ],
});

const manropeGreek = localFont({
  src: [
    { path: "./manrope/greek.woff2", weight: "400" },
    { path: "./manrope/greek.woff2", weight: "500" },
    { path: "./manrope/greek.woff2", weight: "600" },
    { path: "./manrope/greek.woff2", weight: "700" },
    { path: "./manrope/greek.woff2", weight: "800" },
  ],
  preload: false,
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "'Manrope'" },
    { prop: "unicode-range", value: "U+0370-0377, U+037A-037F, U+0384-038A, U+038C, U+038E-03A1, U+03A3-03FF" },
  ],
});

const manropeVietnamese = localFont({
  src: [
    { path: "./manrope/vietnamese.woff2", weight: "400" },
    { path: "./manrope/vietnamese.woff2", weight: "500" },
    { path: "./manrope/vietnamese.woff2", weight: "600" },
    { path: "./manrope/vietnamese.woff2", weight: "700" },
    { path: "./manrope/vietnamese.woff2", weight: "800" },
  ],
  preload: false,
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "'Manrope'" },
    { prop: "unicode-range", value: "U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB" },
  ],
});

const manropeLatinExt = localFont({
  src: [
    { path: "./manrope/latin-ext.woff2", weight: "400" },
    { path: "./manrope/latin-ext.woff2", weight: "500" },
    { path: "./manrope/latin-ext.woff2", weight: "600" },
    { path: "./manrope/latin-ext.woff2", weight: "700" },
    { path: "./manrope/latin-ext.woff2", weight: "800" },
  ],
  preload: false,
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "'Manrope'" },
    { prop: "unicode-range", value: "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF" },
  ],
});

const manropeLatin = localFont({
  src: [
    { path: "./manrope/latin.woff2", weight: "400" },
    { path: "./manrope/latin.woff2", weight: "500" },
    { path: "./manrope/latin.woff2", weight: "600" },
    { path: "./manrope/latin.woff2", weight: "700" },
    { path: "./manrope/latin.woff2", weight: "800" },
  ],
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "'Manrope'" },
    { prop: "unicode-range", value: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD" },
  ],
});

const jetbrainsMonoCyrillicExt = localFont({
  src: [
    { path: "./jetbrains-mono/cyrillic-ext.woff2", weight: "400" },
    { path: "./jetbrains-mono/cyrillic-ext.woff2", weight: "500" },
    { path: "./jetbrains-mono/cyrillic-ext.woff2", weight: "600" },
    { path: "./jetbrains-mono/cyrillic-ext.woff2", weight: "700" },
  ],
  preload: false,
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "'JetBrains Mono'" },
    { prop: "unicode-range", value: "U+0460-052F, U+1C80-1C8A, U+20B4, U+2DE0-2DFF, U+A640-A69F, U+FE2E-FE2F" },
  ],
});

const jetbrainsMonoCyrillic = localFont({
  src: [
    { path: "./jetbrains-mono/cyrillic.woff2", weight: "400" },
    { path: "./jetbrains-mono/cyrillic.woff2", weight: "500" },
    { path: "./jetbrains-mono/cyrillic.woff2", weight: "600" },
    { path: "./jetbrains-mono/cyrillic.woff2", weight: "700" },
  ],
  preload: false,
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "'JetBrains Mono'" },
    { prop: "unicode-range", value: "U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116" },
  ],
});

const jetbrainsMonoGreek = localFont({
  src: [
    { path: "./jetbrains-mono/greek.woff2", weight: "400" },
    { path: "./jetbrains-mono/greek.woff2", weight: "500" },
    { path: "./jetbrains-mono/greek.woff2", weight: "600" },
    { path: "./jetbrains-mono/greek.woff2", weight: "700" },
  ],
  preload: false,
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "'JetBrains Mono'" },
    { prop: "unicode-range", value: "U+0370-0377, U+037A-037F, U+0384-038A, U+038C, U+038E-03A1, U+03A3-03FF" },
  ],
});

const jetbrainsMonoVietnamese = localFont({
  src: [
    { path: "./jetbrains-mono/vietnamese.woff2", weight: "400" },
    { path: "./jetbrains-mono/vietnamese.woff2", weight: "500" },
    { path: "./jetbrains-mono/vietnamese.woff2", weight: "600" },
    { path: "./jetbrains-mono/vietnamese.woff2", weight: "700" },
  ],
  preload: false,
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "'JetBrains Mono'" },
    { prop: "unicode-range", value: "U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB" },
  ],
});

const jetbrainsMonoLatinExt = localFont({
  src: [
    { path: "./jetbrains-mono/latin-ext.woff2", weight: "400" },
    { path: "./jetbrains-mono/latin-ext.woff2", weight: "500" },
    { path: "./jetbrains-mono/latin-ext.woff2", weight: "600" },
    { path: "./jetbrains-mono/latin-ext.woff2", weight: "700" },
  ],
  preload: false,
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "'JetBrains Mono'" },
    { prop: "unicode-range", value: "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF" },
  ],
});

const jetbrainsMonoLatin = localFont({
  src: [
    { path: "./jetbrains-mono/latin.woff2", weight: "400" },
    { path: "./jetbrains-mono/latin.woff2", weight: "500" },
    { path: "./jetbrains-mono/latin.woff2", weight: "600" },
    { path: "./jetbrains-mono/latin.woff2", weight: "700" },
  ],
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "'JetBrains Mono'" },
    { prop: "unicode-range", value: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD" },
  ],
});

/* eslint-enable @typescript-eslint/no-unused-vars */

/** Sets --font-manrope, as Manrope({ variable }) did. */
export const manrope = { variable: styles.manrope };
/** Sets --font-jetbrains-mono, as JetBrains_Mono({ variable }) did. */
export const jetbrainsMono = { variable: styles.jetbrainsMono };
/** Sets --font-mono, the /docs pages' name for JetBrains Mono. */
export const fontMono = { variable: styles.fontMono };
