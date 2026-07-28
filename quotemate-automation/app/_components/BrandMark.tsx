// Shared QuoteMax brand mark — the Q/M monogram, no container, transparent.
// Single source of truth for the in-app logo so every header matches the
// favicon (app/icon.svg) and the social card (app/opengraph-image.png).
//
// SOURCE: the two paths below are copied verbatim from
// redesign/DesignSystem/assets/logos/quote-max-logo-4.svg — the variants in
// that folder share these paths and differ only in their two fills, so one
// inlined copy serves the set:
//   light → quote-max-logo-4.svg  (charcoal #16120F body, gold #E3C13C notch)
//   dark  → quote-max-logo-5.svg  (white body, the same gold notch)
// One caveat on that "verbatim": logo-5's body path runs its M right stem to
// y=212 where logo-4 stops at y=214. Two units of 699, but y=214 is the top of
// the cropped viewBox below, so logo-5's geometry would clip that stem flat.
// Hence logo-4's path for both; grow the viewBox to "151 212 397 272" if
// logo-5's outline ever has to be exact.
// --logo-body / --logo-notch (globals.css) carry those literal source values,
// NOT --accent, so what renders is the supplied asset rather than a recolour of
// it. Inlined rather than served from public/ and referenced as an image, for
// two reasons: the source file is a 699×699 square with ~26% padding around the
// glyph (at a nav-sized height the mark would render ~2.5× smaller than the
// cropped viewBox below), and a referenced image can neither swap on theme
// without a second request nor be cropped in CSS.
//
// SIZING: the viewBox is cropped tight to the glyph's bounding box
// (x 151–548, y 214–484 in the source artwork), so the mark fills its box
// instead of floating in the ~26% padding the square tile used to need.
// Pass a height and let width follow — `h-10 w-auto`, not `h-10 w-10`; a square
// box letterboxes this 1.47:1 landscape mark and throws the extra size away.
// Server-safe (no hooks).
export function BrandMark({ className = "h-10 w-auto" }: { className?: string }) {
  return (
    <svg
      viewBox="151 214 397 270"
      className={`shrink-0 ${className}`}
      aria-hidden="true"
    >
      <path d="M324 214C324 214 280.454 210.115 253 214C246.325 214.945 236 217 236 217C236 217 225.42 220.111 219 223C211.182 226.519 206.972 229.01 200 234C195.71 237.071 193.283 238.823 189.5 242.5C188.906 243.077 188.582 243.411 188 244C182.165 249.906 178.83 253.247 174 260C171.7 263.216 170.56 265.125 168.5 268.5L168.44 268.598C167.884 269.509 167.554 270.05 167 271C160.826 281.588 155 300 155 300C155 300 151.645 314.52 151 324C150.55 330.624 150.562 334.376 151 341C151.733 352.083 152.738 358.382 156 369C159.132 379.196 161.526 384.845 167 394C169.168 397.626 170.499 399.596 173 403C180.032 412.572 184.727 417.579 194 425C198.821 428.858 201.701 430.831 207 434C207 434 216.522 439.385 223 442C232.751 445.936 238.598 447.461 249 449C262.135 450.943 269.869 450.967 283 449C288.53 448.172 291.606 447.471 297 446C302.5 444.5 304 444 312 439L271 398C271 398 262.432 398.623 257 398C253.043 397.546 250.827 397.103 247 396C241.284 394.353 238.185 392.914 233 390C229.318 387.93 227.278 386.665 224 384C217.985 379.11 215.113 375.57 211 369C206.728 362.176 205.043 357.787 203 350C201.892 345.777 201.41 343.347 201 339C200.303 331.603 200.717 327.319 202 320C203.195 313.184 204.167 309.314 207 303C209.221 298.05 210.795 295.377 214 291C217.104 286.761 219.069 284.486 223 281C229.164 275.534 233.376 273.121 241 270C246.262 267.846 249.4 266.985 255 266C260.782 264.983 264.133 264.785 270 265C279.567 265.351 286.571 266.461 295 271C301.5 274.5 319 289.455 324 294C364.55 330.864 419 384 419 384L492 314H494V450H548V214H513L466.5 258.5L420 303H418L371 258.5L324 214Z" fill="var(--logo-body)" />
      <path d="M373 362L329 319L329.269 325.462C329.753 337.065 328.211 348.664 324.714 359.738L324 362L300 338L282.5 355L264.5 372.5L376 484L411 450L359 398L361.406 393.723C365.782 385.943 369.097 377.611 371.262 368.951L373 362Z" fill="var(--logo-notch)" />
    </svg>
  )
}

// Mark + wordmark lockup: mark on the left, "Quote" on the first line and
// "Max" stacked under it. The two lines are set at 0.82 leading so the whole
// lockup stays SHORTER than the mark beside it — a header that swaps a
// one-line wordmark for this one grows by the mark's size change only, never
// by the second line. `className` sizes the mark; the type follows it.
export function BrandLockup({ className = "h-12 w-auto" }: { className?: string }) {
  return (
    <span className="flex items-center gap-2.5">
      <BrandMark className={className} />
      {/* Wordmark inherits the mark's body colour rather than --text-pri, so
          the lockup is always ONE colour: pure white beside a white mark on the
          dark canvas (--text-pri is a warm bone, which read dim next to it),
          and the mark's charcoal on paper. Recolour the mark and the type
          follows — they cannot drift apart. */}
      <span className="flex flex-col text-xl font-extrabold uppercase leading-[0.82] tracking-tight text-[var(--logo-body)]">
        <span>Quote</span>
        <span>Max</span>
      </span>
    </span>
  )
}

export default BrandMark
