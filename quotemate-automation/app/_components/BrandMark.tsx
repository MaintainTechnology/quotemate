// Shared QuoteMax brand mark — the chat-bubble "Q" on the Maintain orange tile.
// Single source of truth for the in-app logo so every header matches the favicon
// (app/icon.svg), the marketing nav, and the social card. The bubble's hole uses
// var(--accent) so it stays seamless on both the dark- and light-theme accent.
// Server-safe (no hooks); size the orange tile via `className` (defaults h-7 w-7).
export function BrandMark({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <span
      className={`grid shrink-0 place-items-center bg-accent ${className}`}
      aria-hidden="true"
    >
      <svg viewBox="0 0 64 64" className="h-[62%] w-[62%]">
        <circle cx="31" cy="28" r="17" fill="#fff" />
        <circle cx="31" cy="28" r="7.5" fill="var(--accent)" />
        <path d="M21 39 L37 39 L21 52 Z" fill="#fff" />
      </svg>
    </span>
  )
}

export default BrandMark
