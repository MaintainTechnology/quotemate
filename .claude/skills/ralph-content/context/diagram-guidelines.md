# Diagram Generation Guidelines

Guidelines for creating SVG diagrams that look like they belong in Cell, Nature, or NEJM publications.

---

## Design Philosophy

Create diagrams that Andrew Huberman or Peter Attia would share on Instagram:
- Insightful perspectives that make hard concepts easy to grasp
- Balance between detailed and simple enough for social media
- Focus on ONE core insight per diagram
- Make the central thesis visually obvious
- Labels should be concise (1-4 words max)

---

## Diagram Types

Choose the most appropriate type for the concept being visualized.

### Mechanism Pathway
**For:** Biological processes, cause-effect chains, signaling cascades

**Structure:**
- Linear or branching flow
- Arrows indicating direction and causation
- Labeled nodes for each state/step
- Use gradients for depth

**Example elements:**
- Substrate → Enzyme → Product arrows
- Receptor → Signal cascade → Cellular response
- Gene → mRNA → Protein pathway

### Process Flow
**For:** Step-by-step sequences, workflows, timelines

**Structure:**
- Clear START and END points
- Numbered steps (3-6 ideal)
- Directional arrows between steps
- Horizontal or vertical layout

### Comparison (Side-by-Side)
**For:** Before/after, traditional vs. new, contrasting approaches

**Structure:**
- Two columns or panels clearly labeled
- Visual parallel between sides
- Contrasting colors to highlight differences
- Summary labels at bottom

**Critical sizing:**
- Each panel minimum 160px wide × 200px tall
- ALL labels must be INSIDE their colored box
- Calculate: (number of text lines × 25px) + 100px padding = minimum height

### Network/Hub
**For:** Interconnected concepts, ecosystems, multi-factor relationships

**Structure:**
- Central node with radiating connections
- Glowing nodes for emphasis
- Connection lines with labels
- Size indicates importance

### Timeline
**For:** Chronological events, treatment phases, historical progression

**Structure:**
- Horizontal progression line with gradient
- Circular markers at key points
- Labels above and below
- Color progression (can indicate change)

### Concept/Hierarchy
**For:** Abstract ideas, organizational structures, layered concepts

**Structure:**
- Pyramid, stacked layers, or tree structure
- Clear visual groupings
- Size/position shows importance
- Isometric view for depth

### Quadrant/Positioning Chart
**For:** Competitive landscapes, 2x2 matrices, strategic positioning

**Structure:**
- Two axes dividing space into 4 quadrants
- Items positioned by their coordinates on both dimensions
- Clear quadrant labels describing each zone
- "Best" items in visually superior position

**⚠️ CRITICAL: Axis Orientation Rules**

In SVG, y=0 is at the TOP of the canvas. This creates counterintuitive positioning:

| Desired Position | SVG Y Value |
|------------------|-------------|
| HIGH (visually at top) | LOW cy value (e.g., cy="120") |
| LOW (visually at bottom) | HIGH cy value (e.g., cy="380") |

**Standard axis conventions:**
- **Y-axis (vertical):** Values INCREASE going UP (higher = better should be at TOP = low cy)
- **X-axis (horizontal):** Values INCREASE going RIGHT (higher = right = high cx)

**Mandatory for quadrant diagrams:**
1. Add explicit "HIGH" and "LOW" labels on each axis
2. Position "best" items at the TOP (low cy values) if Y represents something desirable
3. Quadrant labels should match the positioning (top quadrants = high Y-value outcomes)

**Example - Outcome Focus axis:**
```svg
<!-- HIGH outcome focus = TOP of chart = low cy value -->
<text x="68" y="80">HIGH</text>
<circle cx="200" cy="130" .../>  <!-- High outcome focus item at TOP -->

<!-- LOW outcome focus = BOTTOM of chart = high cy value -->
<text x="68" y="430">LOW</text>
<circle cx="200" cy="350" .../>  <!-- Low outcome focus item at BOTTOM -->
```

**Self-check:** Before finalizing, ask: "If I drew this on paper with a pencil, would HIGH values be at the top?" If yes, those items need LOW cy values in SVG.

---

## Diagram Style Standard (UNIVERSAL — Apply to Every Diagram)

**Canonical quality benchmark:** `content/graphics/garlic-linkedin/garlic-longevity-hub.html`

The garlic diagram is the **quality bar**, not the **template**. What makes it work — the palette, typography, polish, copy voice, and editorial framing — should show up in every diagram we ship, regardless of layout. What layout to use is a separate decision that depends on the content (hub, cascade, comparison, timeline, metaphor scene, etc. — see "Diagram Types" above and "Visual Metaphor Library" below).

This section codifies the *style* qualities. Layout conventions live in their own sections.

### Six Style Qualities That Apply to Every Diagram

#### 1. NGM Editorial Palette + Warm Paper Background

Use the NGM editorial palette from `ngm-style-guide.md` — the same palette the lead magnet HTML uses — for every lead-magnet hero diagram, every hub/network diagram, every LinkedIn/social graphic, and every newsletter diagram. The legacy palette earlier in this file (#F5F2EC, #302C27, #C49A6C) is acceptable only for small inline mechanism diagrams where the full editorial treatment would be overkill.

- paper: `#FEFDFB`, paper-warm: `#F5F3EE`
- ink: `#1A1A1A`, ink-2: `#3A3A3A`, ink-3: `#6A6A6A`, ink-4: `#9A9A9A`
- rule: `#D4D0C8`
- accent (warm brown): `#8B7355`
- green (positive/benefit): `#4A7A5A`
- blue (neutral/informational): `#4A6A7A`
- orange (caution/friction): `#B06840`
- purple (special/advanced): `#6A5A7A`

The background should be a radial gradient from `#FEFDFB` (center) to `#F5F3EE` (edge) rather than a flat fill. Warm, dimensional, editorial — not clinical white.

```svg
<radialGradient id="bg" cx="50%" cy="50%" r="70%">
  <stop offset="0%" stop-color="#FEFDFB"/>
  <stop offset="100%" stop-color="#F5F3EE"/>
</radialGradient>
<rect width="[CANVAS_W]" height="[CANVAS_H]" fill="url(#bg)"/>
```

#### 2. NGM Editorial Typography

Three fonts. Never deviate.

- **Display (titles, deck, subject names, pull quotes):** `'Cormorant Garamond', Georgia, serif` — italic variant for decks and asides.
- **UI (kickers, labels, captions, metadata, tables):** `'DM Sans', system-ui, sans-serif`.
- **Body (if running text appears in a diagram):** `'Source Serif 4', Georgia, serif`.

Kickers are uppercase, DM Sans 11–14px, weight 700, letter-spacing 2–4, accent color. Titles are Cormorant Garamond at 36–52px for hero diagrams, 22–32px for inline figures. Decks are Cormorant Garamond italic at 18–22px. Labels on shapes are DM Sans 11–13px.

#### 3. Drawn / Stylized Subjects — Not Generic Shapes

When a diagram references a concrete object, organism, organ, molecule, or intervention, render it as a recognizable silhouette with SVG paths and a radial-gradient fill — not a labeled circle, not a generic rounded rectangle. The garlic bulb at the center of the canonical example is the quality bar.

- Use `<radialGradient>` fills to give the subject depth. A warm off-center highlight (stop at cx=50%, cy=45%) reads as "lit from above."
- Stroke the outline at 2–2.5px in accent brown (`#8B7355`) for warmth. Only use ink for clinical/diagrammatic subjects where warmth would feel off (e.g. a diagram about regulatory failure).
- Add a soft radial-gradient halo behind the subject (`fill="url(#glow)"` with accent stop at 0.18 opacity) so the focal subject is visually magnetic.
- Include a subtle drop-shadow ellipse beneath to seat the subject on the page.
- Keep it minimalist — editorial illustration, not anatomical atlas. 2–5 internal highlight strokes, a single silhouette, no hatching or crosshatching.

**Subjects to draw rather than box:** garlic bulb, pill/capsule, brain, liver, mitochondrion, cell with nucleus, gut/intestine, muscle fiber, sun/moon, tree, clock/timer, flame, droplet, DNA helix, hand, pen. See the "Adapting the Central Subject" table at the bottom of the Hub Layout section for a starter catalog, but the principle is broader than hubs — use drawn subjects in comparison panels, metaphor scenes, process flows, and any diagram with a physical referent.

**Use abstract shapes (rounded rects, ovals, stylized arrows) only when:** the concept is genuinely abstract (a "state," a "network," an "equilibrium"), or the diagram is a small inline figure where a drawn subject would eat visual budget.

#### 4. Label Hierarchy: Plain-English Benefit Over Mechanism

This is the copy voice. Every label element that names a biological effect, pathway, or outcome should follow a two-tier pattern: a **small mechanistic kicker** that respects clinical audience expertise, and a **larger plain-English benefit or effect headline** that an interested layperson would instantly grasp. The benefit is always bigger and more prominent.

Apply this everywhere labels appear — inside spoke cards (hub layout), inside comparison panels, inside cascade step labels, inside metaphor scene captions, inside timeline beat headings.

- **Kicker (mechanistic):** DM Sans 11px, weight 700, letter-spacing 2, color matching the layout's semantic tone (green for benefit, orange for caution, blue for neutral informational, accent brown for factual). Examples: `mTOR ↓ · AUTOPHAGY ↑`, `NRF2 ↑`, `CYP3A4 INTERACTION`, `PHASE 2 TRIAL · n=107`.
- **Headline (plain-English):** Cormorant Garamond 18–24px (scale with available space), weight 500, ink color. Examples: "Cells clean house", "Antioxidant defenses rise", "Liver clears drugs slower", "Trial missed its primary endpoint".
- **Optional subtitle (specifics):** DM Sans 11–12px, ink-3 color. One to two lines naming the biomarkers, molecules, populations, or numbers.

**The invariant:** A reader who does not know the pathway abbreviations still understands the outcome. The mechanistic term is always present — we don't dumb down. But the benefit/effect is what the eye lands on first.

**Bad label (mechanism-first, no translation):**
> `NRF2 ↑` / `Activates antioxidant response element transcription`

**Good label (Style Standard):**
> kicker: `NRF2 ↑`
> headline: `Antioxidant defenses rise`
> subtitle: `Glutathione, HO-1, NQO1`

Same pattern in a comparison panel:
> kicker (left column): `RAPAMYCIN · 62h HALF-LIFE`
> headline: `Scalpel: narrow window`
> subtitle: `mTORC1 only at correct dose/timing`

Same pattern in a cascade step:
> kicker: `STEP 2 · ALLIINASE ACTIVATION`
> headline: `Crushing sparks the chemistry`
> subtitle: `Alliin → allicin in 10 seconds`

#### 5. Polished Rendering: Gradients, Halos, Rhythmic Spacing

Flat, diagrammatic, "PowerPoint SmartArt" rendering fails the style bar. The difference between a shipped NGM diagram and a generic one comes from three cheap-but-nontrivial details:

- **Radial gradients on subjects and backgrounds** (not flat fills). Every focal subject uses a two-to-three-stop radial gradient that suggests lighting. The background itself is a subtle radial gradient from paper center to paper-warm edge.
- **Soft halos around focal elements.** A faint accent-tinted radial-gradient halo behind the primary subject (or behind a section label) guides the eye without clutter. Opacity 0.12–0.18 is the sweet spot.
- **Rhythmic spacing and alignment.** Elements align to a grid. Labels have 40px+ breathing room from viewBox edges. Text inside containers has 15–20px padding on all sides. Sibling elements are spaced at consistent intervals (e.g. 170px gap between cards in a row).

Other polish cues that show up in strong diagrams: dashed guide rings or baselines at low opacity, thin rule lines (1–2px at `#D4D0C8`) separating sections, small terminator dots on connector lines (r=7 at the line's semantic endpoint), generous whitespace around the focal area.

#### 6. Editorial Framing: Header + Footer Banner on Hero Diagrams

Hero diagrams — the single biggest diagram in a lead magnet, a LinkedIn image, a slide deck title card — need editorial framing that makes them self-contained shareable assets. Inline sub-figures inside a lead magnet can skip the header (the article's heading already serves that role) but should still carry a lightweight footer rule + attribution line.

**Header (hero diagrams only):**
- Kicker (DM Sans 14px, weight 700, letter-spacing 4, accent): `NEXT GENERATION MEDICINE · [SECTION TAG]`
- Thin centered rule (`<line stroke="#D4D0C8" stroke-width="1">`)
- Title (Cormorant Garamond 44–52px, ink): a scroll-stopping editorial headline — *not* a figure caption
- Deck (Cormorant Garamond italic 18–22px, ink-3): one-line elaboration

**Footer banner (every diagram that will be shared standalone, including every LinkedIn/social graphic and every lead-magnet hero):**
- Horizontal rule at ~10% from the bottom
- Left side: unifying-insight kicker (DM Sans 13px, weight 600, tracked, accent), one-line explainer (DM Sans 12px, ink-3), source citation with DOI + effect size (DM Sans 11px italic, ink-4)
- Right side, right-aligned: `NGM` wordmark (DM Sans 13px, weight 700, letter-spacing 2, ink), URL `nextgenerationmedicine.co` (DM Sans 10px, ink-3), author byline (DM Sans 10px, ink-3)

**Inline sub-figures (no header, lighter footer):** Skip the kicker+title+deck header. Keep a single thin rule + small italic caption at the bottom naming the source, plus a small `NGM` wordmark in the corner. The surrounding article provides the editorial frame.

### Standalone Readability Test (Applies to Every Standalone Diagram)

Before shipping any diagram that could be posted to LinkedIn or reused in a slide deck, test: with no caption, no article text, nothing but the diagram — does a clinician understand (a) the subject, (b) what's happening in the visual, and (c) the unifying claim? If not, it's not yet a shippable standalone diagram; add editorial framing until the answer is yes.

### Canvas Geometry

- **Lead-magnet hero or LinkedIn square graphic:** 1200 × 1200 viewBox.
- **Newsletter hero or landscape banner:** 1200 × 628 viewBox.
- **Inline figure inside a lead magnet:** 800 × 450 to 820 × 500, scales to the article column width.
- **Small diagnostic/mechanism figure:** 600 × 400.

All use the same radial-gradient paper background. All use `overflow="visible"`. All have 40px+ internal padding before content.

---

## Hub Layout (One Layout Option — Use When Content Fits)

**Canonical example:** `content/graphics/garlic-linkedin/garlic-longevity-hub.html`

The Hub Layout is one of several valid layouts. It is appropriate *only when the content actually has radial structure* — one central concept with 3–10 downstream outcomes where the spokes don't have a meaningful order among themselves. The garlic diagram is the canonical hub example because garlic → H₂S persulfidation → eight roughly-parallel longevity outcomes genuinely is radial.

Many great diagrams are not hubs. Use the other layouts in "Diagram Types" above, "Visual Metaphor Library" below, or invent a layout that suits the content. What matters is that *every* diagram — regardless of layout — meets the Style Standard above.

### When to Use the Hub Layout

- **One central concept** (an intervention, compound, organ, system) with 3–10 downstream consequences that are **roughly parallel** (no temporal order, no causal dependency among spokes).
- **Overview / thesis role** — the diagram is the visual thesis of a section or the whole piece.
- **All spokes share a valence** (all beneficial, or all risks, or all markers) — this makes the radial green/orange/blue convention coherent.

### When NOT to Use the Hub Layout (Use Something Else)

- Sequential steps → Process Flow / Mechanism Pathway
- Before / after or A / B → Comparison panel
- Time progression → Timeline
- Nested hierarchy → Concept/Hierarchy
- One physical-world scene that teaches a mechanism → Visual Metaphor (see library)
- Two-variable position → Quadrant/Positioning Chart

### Hub-Specific Structural Rules

These are *in addition* to the universal Style Standard:

- **Radial node placement on a clock face.** 8 nodes: 12, 1:30, 3, 4:30, 6, 7:30, 9, 10:30. 6 nodes: 12, 2, 4, 6, 8, 10. 5 nodes: 72° spacing.
- **Dashed concentric ring guides** at roughly 270px and 370px radius (on a 1200×1200 canvas) at `stroke="#D4D0C8"`, `stroke-dasharray="2,6"`, `opacity="0.5"`.
- **Connector + terminator dot + card** per spoke. Connector stroke 2px in the valence color (green for beneficial, orange for caution, blue for neutral). Terminator dot at node r=7 in the same color. Card: `#FEFDFB` fill, border in valence color at 1.5px.
- **Consistent valence across all spokes.** If all outcomes are beneficial, all connectors are green. If all outcomes are risks, all connectors are orange. If the spokes mix positive and negative, the Hub Layout is wrong for this content; use Comparison or Cascade instead.

### Hub Layout SVG Skeleton (Copy-Adapt This)

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 1200">
  <defs>
    <radialGradient id="bg" cx="50%" cy="50%" r="70%">
      <stop offset="0%" stop-color="#FEFDFB"/>
      <stop offset="100%" stop-color="#F5F3EE"/>
    </radialGradient>
    <radialGradient id="subjectGrad" cx="50%" cy="45%" r="55%">
      <!-- Warm tones that match the subject. Bulb = tan. Brain = pink-grey. Etc. -->
    </radialGradient>
    <radialGradient id="glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#8B7355" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="#8B7355" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="1200" fill="url(#bg)"/>

  <!-- HEADER: kicker + title + deck -->
  <text x="600" y="70" text-anchor="middle" font-family="DM Sans" font-size="14" font-weight="700" letter-spacing="4" fill="#8B7355">NEXT GENERATION MEDICINE · [TAG]</text>
  <line x1="440" y1="88" x2="760" y2="88" stroke="#D4D0C8" stroke-width="1"/>
  <text x="600" y="148" text-anchor="middle" font-family="Cormorant Garamond" font-size="52" fill="#1A1A1A">[Scroll-stopping headline.]</text>
  <text x="600" y="196" text-anchor="middle" font-family="Cormorant Garamond" font-size="22" font-style="italic" fill="#6A6A6A">[One-line elaboration.]</text>

  <!-- CENTER: glow halo + drawn subject with labels inside -->
  <circle cx="600" cy="620" r="240" fill="url(#glow)"/>
  <g transform="translate(600,620)">
    <!-- Drawn subject paths here -->
    <text y="-10" text-anchor="middle" font-family="Cormorant Garamond" font-size="44" fill="#1A1A1A">[SUBJECT NAME]</text>
    <text y="22" text-anchor="middle" font-family="DM Sans" font-size="13" font-weight="600" letter-spacing="2.5" fill="#6F5A3E">[SUB-LABEL]</text>
    <text y="62" text-anchor="middle" font-family="DM Sans" font-size="11" font-weight="500" letter-spacing="1.2" fill="#8B7355">[MECHANISM HINT]</text>
  </g>

  <!-- Dashed ring guides -->
  <g fill="none" stroke="#D4D0C8" stroke-width="1" opacity="0.5">
    <circle cx="600" cy="620" r="270" stroke-dasharray="2,6"/>
    <circle cx="600" cy="620" r="370" stroke-dasharray="2,6"/>
  </g>

  <!-- SPOKE NODES: one per outcome. Connector + dot + card with kicker/headline/subtitle. -->
  <!-- Each card: rect fill=#FEFDFB stroke=#4A7A5A, kicker=green 11px, headline=Cormorant 20-22px, subtitle=DM Sans 11-12px -->

  <!-- FOOTER banner -->
  <line x1="80" y1="1085" x2="1120" y2="1085" stroke="#D4D0C8" stroke-width="1"/>
  <text x="80" y="1120" font-family="DM Sans" font-size="13" font-weight="600" letter-spacing="2" fill="#8B7355">[UNIFYING INSIGHT]</text>
  <text x="80" y="1146" font-family="DM Sans" font-size="12" fill="#6A6A6A">[One-line explainer.]</text>
  <text x="80" y="1170" font-family="DM Sans" font-size="11" font-style="italic" fill="#9A9A9A">[Source citation with DOI and effect size.]</text>
  <text x="1120" y="1120" text-anchor="end" font-family="DM Sans" font-size="13" font-weight="700" letter-spacing="2" fill="#1A1A1A">NGM</text>
  <text x="1120" y="1140" text-anchor="end" font-family="DM Sans" font-size="10" fill="#6A6A6A">nextgenerationmedicine.co</text>
  <text x="1120" y="1156" text-anchor="end" font-family="DM Sans" font-size="10" fill="#6A6A6A">Dr. Anant Vinjamoori</text>
</svg>
```

### Drawn-Subject Catalog (Applies to Any Layout With a Physical Referent)

The drawn subject at the center of a Hub, inside a Comparison panel, or anchoring a Metaphor Scene is the highest-effort visual. This catalog is a starter; invent new subjects when a topic demands it. The constraint set — single silhouette, 2–3 internal highlight strokes, warm tone, radial-gradient fill, 140–170px major axis for focal subjects — stays constant across layouts.

| Topic | Subject shape | Key visual features |
|---|---|---|
| Garlic / Allium | Bulb silhouette + cloves + stem | 5 vertical ridges, tan gradient, small green stem |
| Rapamycin / small molecule | Stylized pill/capsule | Half-tone fill split, blister-pack shadow |
| Exercise / skeletal muscle | Flexed-arm or muscle-fiber silhouette | Striation lines, warm flesh tone |
| Brain / cognition | Top-down brain silhouette | Gyri as curved lines, symmetric |
| Liver / metabolic hub | Organ-shape silhouette | Lobe separation, rich burgundy gradient |
| Mitochondrion | Cristae-ridged oval | Double-membrane detail, warm amber |
| Sleep / circadian | Moon + sun split disc | Half light / half dark, no hard line |
| Gut microbiome | Coiled intestine | Gentle tube curl, neutral tan |
| Hormone (estrogen, GLP-1) | Molecular ball-and-stick silhouette | 3–4 circles connected by lines |
| Heart / cardiovascular | Anatomical heart silhouette | Chambered outline, warm red gradient |
| Cell membrane / receptor | Bilayer with protein silhouette | Dotted bilayer, receptor as ribbon |

Use drawn subjects in any layout that has a physical referent: inside a comparison panel's left and right sides, as the "actor" in a metaphor scene, as a mile-marker along a timeline, as a node in a cascade. The Style Standard travels across layouts.

### Hub Layout Validation — Before Shipping Any Hub Diagram

For Hub Layout diagrams, verify both the universal Style Standard (palette, typography, drawn subject, label hierarchy, polish, editorial framing, standalone readability) AND the hub-specific structural rules above:
- Is the center a *drawn subject*, not a labeled circle?
- Does every spoke-card have a plain-English headline *larger* than its mechanistic kicker?
- Is the spoke valence consistent (all beneficial = all green; all risks = all orange; mixed = wrong layout)?
- Is the palette the NGM editorial palette (`#FEFDFB`/`#F5F3EE`/`#1A1A1A`/`#8B7355`/`#4A7A5A`/`#D4D0C8`), not the older diagram-guidelines palette?
- Is there a footer banner with unifying insight + source + NGM branding?
- Can the diagram stand alone as a LinkedIn/slide asset with no surrounding article context?

---

## Visual Metaphor Library (Lead Magnets)

**Lead magnet diagrams MUST use visual metaphors**, not default box-and-arrow flowcharts. The goal is to make molecular biology viscerally understandable by mapping it to physical-world imagery the reader already intuitively grasps.

### Why Metaphors Over Flowcharts

| Flowchart approach | Metaphor approach |
|---|---|
| Box: "Bacterial DPP-4" → Arrow: "degrades" → Box: "GLP-1 inactive" | Pac-man pathogen devouring a fragile molecule, leaving scattered fragments |
| Box: "NF-κB" → Arrow → Box: "IL-1β, IL-6" → Arrow → Box: "Bone loss" | Flame sources igniting cytokine embers that erode a jagged bone edge |
| Box: "AGEs" → Arrow → Box: "PKCβ2↑" → Arrow → Box: "Runx2↓" | Sugar rain activating a parking brake lever that locks a gear wheel |

Metaphors are memorable because they create a **visual narrative** — a story the reader can replay in their mind without re-reading the diagram.

### The Metaphor Selection Process

Before writing any SVG code for a lead magnet diagram:

1. **Name the biological actor** — What entity is doing something? (enzyme, pathogen, drug, receptor)
2. **Name the action** — What is happening? (degradation, suppression, activation, blockade, bypass)
3. **Name the outcome** — What results? (signal loss, inflammation, bone loss, repair)
4. **Find the physical-world analog:**

| Biological Action | Metaphor Candidates |
|---|---|
| Enzymatic degradation | Predator devouring prey, acid dissolving, shredder destroying |
| Inflammatory cascade | Spreading fire, chain of dominoes, alarm bells propagating |
| Pathway inhibition / blockade | Parking brake engaged, locked gate, dam holding back water |
| Drug bypassing resistance | Armored vehicle, shield deflecting, alternate route around roadblock |
| Receptor activation | Key turning in lock, switch flipping on, gear engaging |
| Feedback loop / vicious cycle | Whirlpool, circular chain, snake eating its own tail |
| Dose-response threshold | Water level rising to spillway, dimmer switch, thermostat |
| Competitive binding | Musical chairs, parking spaces filling, lock with two keys |
| Tissue repair / regeneration | Scaffolding going up on a building, brick wall being rebuilt, garden regrowing |
| Evidence hierarchy | Stacking blocks (tallest = strongest), pyramid layers, foundation to roof |

5. **Give the diagram a narrative title** — Not "NF-κB/NLRP3 Pathway" but "The Spreading Fire". The title is the reader's entry point.

### Proven Metaphor Patterns (with SVG techniques)

#### The Hungry Predator
**For:** Enzymatic degradation, pathogen consuming a substrate
**Visual:** Pac-man/chomping shape with jagged teeth, fragile target molecule, scattered fragments as debris
**SVG elements:** `<path>` for pac-man wedge mouth, `<polyline>` for teeth, `<circle>` for target, short `<line>` segments at angles for fragments
**Split-scene:** Top = "without intervention" (devouring), Bottom = "with intervention" (armored bypass with bounce sparks)
**Example:** P. gingivalis DPP-4 devouring GLP-1 vs. GLP-1RA with shield icon soaring over

#### The Spreading Fire
**For:** Inflammatory cascades, cytokine storms, NF-κB/NLRP3 activation
**Visual:** Flame-shaped ignition sources, scattered ember circles (one per cytokine), jagged eroding surface
**SVG elements:** `<path>` with bezier curves for flame silhouettes, `<circle>` with low-opacity fill for embers, `<polyline>` zigzag for bone erosion
**Counterpart:** Suppression dome (`<path>` arc) sheltering outcome cards
**Example:** NF-κB + NLRP3 as dual ignition sources, IL-1β/IL-6/TNF-α/IL-18/ROS as scattered embers, M1 macrophage as "destroy" circle, GLP-1RA as dome with M2/RANKL/cytokine outcome cards

#### The Parking Brake
**For:** Pathway inhibition, molecular blockade, enzyme-mediated suppression of a transcription factor
**Visual:** Brake lever (up = engaged, down = released), locked gear vs. spinning gear, cracked surface vs. healthy cross-hatched surface
**SVG elements:** `<line>` with `stroke-linecap="round"` for lever, `<circle>` for knob, `<rect>` with internal `<line>` cross-hatching for healthy tissue, `<path>` cracks for damaged tissue
**Split-scene:** Left panel = "brake engaged" (locked, crumbling), Right panel = "brake released" (spinning, rebuilding) with vertical dashed divider
**Example:** AGEs as falling rain onto PKCβ2 brake lever, locked Runx2 gear with padlock icon, vs. GLP-1RA hand pushing lever down, freed spinning gear with trabecular bone pattern

#### The Shield / Armor
**For:** Drug resistance to degradation, protective mechanisms
**Visual:** Shield icon on a molecule, bounce sparks where enzyme hits, clear travel arc bypassing danger
**SVG elements:** `<path>` shield shape, short `<line>` sparks at deflection point, `<path>` bezier arc for bypass trajectory
**Example:** GLP-1RA molecule with shield vs. DPP-4 enzyme that can't bite through

#### The Rising Water
**For:** Dose-response thresholds, accumulation effects, tipping points
**Visual:** Container with rising fill level, threshold line, spillway
**SVG elements:** `<rect>` container, `<rect>` with animated fill height, dashed `<line>` for threshold, `<path>` for overflow

#### The Locked Gate / Dam
**For:** Signaling blockade, receptor antagonism, competitive inhibition
**Visual:** Gate/dam structure blocking flow, key/drug opening the gate, flow resuming on the other side
**SVG elements:** `<rect>` for gate structure, `<path>` for water/signal flow, gate in open vs. closed position

### Diagram Structure for Lead Magnets

Each lead magnet diagram should follow this template:

```
Title (narrative, Cormorant Garamond): "The [Metaphor Name]"
Subtitle (DM Sans, small): One-line explanation of the biology
─────────────────────────────────────
Scene(s):
  - Split-scene (left/right or top/bottom) with clear labels
  - OR single panoramic scene with progressive narrative
─────────────────────────────────────
Legend (bottom): 2-3 items mapping visual elements to biological entities
Brand mark (bottom-right): "NextGenMed"
```

**viewBox sizing:** Lead magnet metaphor diagrams need more vertical space than flowcharts. Use `620×400` as the default (vs `600×300` for simple flowcharts).

### Self-Check for Visual Metaphors

Before finalizing a metaphor-based diagram:
1. [ ] Does the diagram have a narrative title (not a pathway name)?
2. [ ] Would a non-scientist understand the visual story at a glance?
3. [ ] Is the metaphor consistent throughout (no mixing fire + water + gears in one diagram)?
4. [ ] Does the split-scene clearly show "without intervention" vs "with intervention"?
5. [ ] Are biological entities mapped to visual elements in the legend?
6. [ ] Is the metaphor visceral enough to be memorable 24 hours later?

---

## DO NOT Create

- Bar charts, line graphs, pie charts, scatter plots
- Data visualizations with axes
- Generic stock-image style graphics
- Diagrams that require reading the full article to understand
- Overly complex diagrams with >7 main elements

---

## SVG Technical Requirements

### Required Structure

```svg
<svg viewBox="0 0 600 450" overflow="visible" xmlns="http://www.w3.org/2000/svg">
  <!-- Background -->
  <rect width="100%" height="100%" fill="#F5F2EC" stroke="none"/>
  
  <!-- Content with 40px padding from all edges -->
  <!-- Bottom content should not exceed y=410 to maintain padding -->
</svg>
```

### Critical Rules

1. **viewBox:** Always use `viewBox="0 0 600 450"` for generous breathing room
2. **overflow:** Always set `overflow="visible"` to prevent clipping
3. **stroke:** Use `stroke="none"` attribute (NOT "stroke-none" which is INVALID)
4. **padding:** Maintain 40px padding from all viewBox edges
5. **contrast:** 4.5:1 minimum ratio (dark text on light backgrounds)

### Text Containment Rules (CRITICAL)

**ALL text that belongs to a container MUST be FULLY INSIDE that container:**

1. **No text straddling boundaries** - Text labels must be entirely within their colored box
2. **Minimum container padding** - All text inside a box must have at least 15px padding from ALL edges
3. **Size containers to fit text** - Make rectangles large enough to contain all text with padding
4. **Vertical stacking** - Multiple text lines stack vertically INSIDE the container
5. **External labels go OUTSIDE** - Labels describing a container from outside need 10px+ gap

**Container sizing formula:**
- Minimum height = (number of text lines × 25px) + 40px top padding + 40px bottom padding
- Minimum width = longest text line width + 30px left padding + 30px right padding

### Invalid SVG Attributes (DO NOT USE)
- ❌ `stroke-none` (use `stroke="none"`)
- ❌ `fill-none` (use `fill="none"`)
- ❌ Attributes without equals sign and quotes

---

## Color Palette (MUST USE)

```
/* BACKGROUNDS */
--paper: #FFFFFF           /* Pure white */
--paper-alt: #F5F2EC       /* Warm off-white - USE FOR SVG BACKGROUNDS */

/* TEXT & SHAPES */
--ink-900: #302C27         /* Primary text, headings, key shapes */
--ink-700: #4A4540         /* Secondary text, body copy */
--ink-500: #706C66         /* Tertiary text, labels */
--ink-400: #9C9890         /* Subtle text, annotations */

/* LINES & BORDERS */
--line: #E3DFD7            /* Borders, dividers, connecting lines */

/* ACCENTS (use sparingly - max 5-10% of visual area) */
--gold: #C49A6C            /* Primary accent, highlights */
--vermillion: #C07050      /* Warnings, negative states, emphasis */
--green: #5C8A6B           /* Positive states, success, growth */
--blue: #5C7A8A            /* Informational, neutral, trust */
--purple: #7A6C8A          /* Special, advanced, premium */
--orange: #D4845C          /* Warm accent, caution, attention */
```

---

## Typography

### Title Text
```svg
<text
  font-family="'Cormorant Garamond', Georgia, serif"
  font-size="18"
  font-weight="500"
  fill="#4A4540"
  stroke="none">
  Diagram Title
</text>
```

### Label Text
```svg
<text
  font-family="'DM Sans', system-ui, sans-serif"
  font-size="13"
  fill="#302C27"
  stroke="none"
  dominant-baseline="middle"
  text-anchor="middle">
  Label Text
</text>
```

### Category Labels (Uppercase)
```svg
<text
  font-family="'DM Sans', sans-serif"
  font-size="11"
  font-weight="600"
  letter-spacing="0.08em"
  fill="#C49A6C"
  stroke="none">
  CATEGORY
</text>
```

---

## Visual Techniques

### Gradient Fills (for depth)
```svg
<defs>
  <linearGradient id="blueGrad" x1="0%" y1="0%" x2="0%" y2="100%">
    <stop offset="0%" stop-color="#6B8A9A"/>
    <stop offset="100%" stop-color="#5C7A8A"/>
  </linearGradient>
</defs>
<rect fill="url(#blueGrad)" rx="8" .../>
```

### Drop Shadows (for elevation)
```svg
<defs>
  <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
    <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#302C27" flood-opacity="0.1"/>
  </filter>
</defs>
<rect filter="url(#shadow)" .../>
```

### Rounded Corners
```svg
<rect x="10" y="10" width="100" height="60" rx="8" ry="8" fill="#5C8A6B" stroke="none"/>
```

### Dashed Lines (for relationships)
```svg
<line stroke-dasharray="5,5" stroke="#E3DFD7" stroke-width="1.5" .../>
```

---

## Horizontal Layout & Element Spacing (CRITICAL)

**The #1 cause of broken diagrams: overlapping elements in sequential layouts.**

When placing elements horizontally (e.g., Step 1 → Step 2 → Step 3), you MUST calculate positions mathematically to prevent overlap.

### The Overlap Problem

```
❌ WRONG - Elements overlap:
Box A: x=100, width=200 → ends at x=300
Box B: x=250, width=200 → starts at x=250 (OVERLAPS Box A by 50px!)

✅ CORRECT - Elements have gaps:
Box A: x=100, width=200 → ends at x=300
Arrow: x=300 to x=330
Box B: x=335, width=200 → starts at x=335 (35px gap for arrow)
```

### Mandatory Spacing Rules

1. **Calculate end position:** `element_end = x + width`
2. **Arrow gaps:** Leave 30-50px between element end and next element start for arrows
3. **Minimum gap without arrow:** 20px between adjacent elements
4. **Validate before rendering:** Ensure `element[n].x + element[n].width + gap < element[n+1].x`

### Sequential Layout Template

For 3-element horizontal flows in a 700px viewBox:

```svg
<!-- Element 1: x=30, width=150 → ends at 180 -->
<rect x="30" y="70" width="150" height="70"/>

<!-- Arrow 1: 180 → 215 (35px gap) -->
<line x1="180" y1="105" x2="210" y2="105"/>
<polygon points="215,105 205,100 205,110"/>

<!-- Element 2: x=220, width=220 → ends at 440 -->
<rect x="220" y="70" width="220" height="70"/>

<!-- Arrow 2: 440 → 475 (35px gap) -->
<line x1="440" y1="105" x2="470" y2="105"/>
<polygon points="475,105 465,100 465,110"/>

<!-- Element 3: x=480, width=180 → ends at 660 -->
<rect x="480" y="70" width="180" height="70"/>
```

### ViewBox Sizing for Horizontal Layouts

| # of Elements | Recommended viewBox Width |
|---------------|---------------------------|
| 2 elements    | 500-550px                 |
| 3 elements    | 650-700px                 |
| 4 elements    | 800-850px                 |

**Never assume 600px is enough for 3+ horizontal elements with arrows.**

### Text Centering in Boxes

When using `text-anchor="middle"`, the text centers on the x coordinate. Calculate the center of each box:

```
Box center x = box_x + (box_width / 2)

Example:
Box: x=220, width=220
Text should be at: x = 220 + (220/2) = 330
```

### Pre-Flight Checklist for Horizontal Layouts

Before writing SVG code, write out the math:

```
Element 1: x=___, width=___, ends at ___
Gap 1: ___ px
Element 2: x=___, width=___, ends at ___
Gap 2: ___ px
Element 3: x=___, width=___, ends at ___
Total width needed: ___
ViewBox width: ___ (must be > total + 40px padding)
```

If any element's start x is less than the previous element's end x, you have an overlap.

---

## Self-Validation Checklist

Before finalizing any diagram, verify:

1. [ ] viewBox is appropriately sized (600×450 for simple, 700+ width for 3+ horizontal elements)
2. [ ] Background rect fills with #F5F2EC
3. [ ] All text has 40px+ padding from viewBox edges
4. [ ] All text inside containers is FULLY contained with 15px+ padding
5. [ ] No text straddles container boundaries
6. [ ] All shapes have explicit `stroke="none"` unless borders intentional
7. [ ] Gold accent (#C49A6C) is ≤10% of visual area
8. [ ] All text has adequate contrast (4.5:1 minimum)
9. [ ] Diagram makes sense without reading the article
10. [ ] Uses only NGM palette colors
11. [ ] **AXIS ORIENTATION (for quadrant/positioning diagrams):** Items with HIGH values on Y-axis are positioned at TOP of chart (LOW cy values). Ask: "On paper, would 'better' be higher up?" If yes, those items need lower cy values.
12. [ ] **HORIZONTAL OVERLAP CHECK:** For sequential layouts, verify math: `element[n].x + element[n].width + 30 < element[n+1].x`. No element should start before the previous one ends + gap.

If any check fails, regenerate with specific corrections.

---

## Common Mistakes to Avoid

**❌ Text spilling below container:**
```svg
<rect x="100" y="100" width="150" height="120" fill="#5C8A6B"/>
<text y="210">Subtitle</text>  <!-- y=210 is OUTSIDE the box (100+120=220) -->
```

**✅ Text fully contained:**
```svg
<rect x="100" y="100" width="150" height="180" fill="#5C8A6B"/>
<text y="130">Label</text>      <!-- 30px inside top -->
<text y="160">Subtitle</text>   <!-- Still inside -->
<text y="190">Description</text> <!-- 90px from bottom = safe -->
```

**❌ External label on the edge:**
```svg
<text y="100">Consumer</text>  <!-- ON the top edge - ambiguous -->
<rect x="100" y="100" width="150" height="150" fill="#5C8A6B"/>
```

**✅ External label clearly above with gap:**
```svg
<text y="80">Consumer</text>  <!-- 20px gap before box -->
<rect x="100" y="100" width="150" height="150" fill="#5C8A6B"/>
```

**❌ Horizontal elements overlapping (THE MOST COMMON BUG):**
```svg
<!-- Box A ends at x=460 but Box B starts at x=400 - OVERLAP! -->
<rect x="260" y="70" width="200" height="70"/>  <!-- ends at 460 -->
<rect x="400" y="70" width="160" height="70"/>  <!-- starts at 400, overlaps by 60px -->
```

**✅ Horizontal elements properly spaced:**
```svg
<!-- Box A ends at x=440, gap of 40px, Box B starts at x=480 -->
<rect x="220" y="70" width="220" height="70"/>  <!-- ends at 440 -->
<!-- Arrow fills gap: 440 to 475 -->
<rect x="480" y="70" width="180" height="70"/>  <!-- starts at 480, no overlap -->
```

**The fix:** Always calculate: `next_element.x > prev_element.x + prev_element.width + arrow_gap`
