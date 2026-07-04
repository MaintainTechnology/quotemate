Square, heavy, uppercase action button — primary is a Caterpillar-yellow fill with dark ink; use it for the one headline action per view.

```jsx
<Button variant="primary" size="lg" withArrow href="/signup">Get my QuoteMax</Button>
<Button variant="secondary">See how it works</Button>
<Button variant="ghost" size="sm">Cancel</Button>
```

- **Variants:** `primary` (yellow fill / `--accent-ink` text — never white), `secondary` (hairline border, fills to `--ink-card` on hover), `ghost` (borderless), `danger` (state fill).
- **Sizes:** `sm` · `md` (default) · `lg` (marketing hero). All clear the 44px tap target at `md`+.
- **`withArrow`** appends the brand arrow that nudges right on hover. **`href`** renders an `<a>`. Hover/press are handled internally; focus uses the global accent ring.
- One primary per view. Don't put white text on yellow.
