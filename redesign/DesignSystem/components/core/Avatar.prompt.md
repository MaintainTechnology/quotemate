Identity tile — shows an image, or initials derived from `name`. Square yellow tile by default (echoes the logo mark); pass `round` for a disc.

```jsx
<Avatar name="DaveNguyen" />
<Avatar name="Sparky Co" src="/logo.jpg" size={56} />
<Avatar name="JS" tone="ink" round />
```

- Default `accent` tone = yellow tile, dark-ink initials. `ink` tone = sunken surface + hairline for a quieter look.
- `round` is the rare exception to square corners — use for profile discs only.
