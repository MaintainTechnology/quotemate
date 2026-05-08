---
name: ralph-content
description: Generate high-quality content iteratively with a three-model split. Claude Opus 4.6 handles prose/copy generation (Vercel AI Gateway). GPT-5.5 runs a humanization pass on every approved draft to remove AI-tells (OpenRouter). Claude Opus 4.7 handles all visual-design steps (SVG diagrams, metaphor selection, validation, iteration) via the Vercel AI Gateway. No deterministic scripts.
allowed-tools: Read, Edit, Create, Grep, Glob, LS, WebSearch, Execute, TodoWrite
user_invocable: true
argument-hint: <topic> [--type newsletter|lead_magnet|linkedin|instagram] [--voice bryan_johnson|klosterman|dan_shipper|tina_he|daily_stoic|sinclair|attia|huberman|miklasz|etc.] [--verify] [--diagrams N] [--kb] [--gif] [--bundle]
---

# RALPH-Content: Iterative Content Generation

Generate newsletters, lead magnets, LinkedIn posts, and Instagram scripts with iterative quality improvement. Claude Opus 4.6 handles prose/copy generation and quality gates; Claude Opus 4.7 handles all visual-design steps (SVG diagrams, metaphor selection, self-validation, iteration). Both route through the Vercel AI Gateway. No deterministic scripts, regex parsing, or hard-coded logic.

## Invocation

```bash
/ralph-content "How psilocybin affects metabolic health" --type newsletter
/ralph-content "NAD+ supplementation deep dive" --type lead_magnet --diagrams 5
/ralph-content "Time-restricted eating benefits" --type linkedin
/ralph-content "Why we believe what we believe about supplements" --type newsletter --voice klosterman
/ralph-content "The AI content ecosystem is missing the forest for the trees" --bundle --voice klosterman
```

**Arguments:**
- `<topic>` - The subject to write about (required)
- `--type` - Content type: newsletter (default), lead_magnet, linkedin, instagram, regulatory_brief, podcast_roundup
- `--voice` - Voice style: bryan_johnson (default for `--type linkedin`), dan_shipper, tina_he, katie_parrott, klosterman, huberman, attia, daily_stoic, sinclair, miklasz, etc. See `context/every-voice-patterns.md` for the full catalog and per-voice patterns.
- `--verify` - Enable fact verification phase (cross-check claims with Perplexity). **Auto-enabled for regulatory_brief**
- `--diagrams N` - Number of diagrams to generate (default: 2 for newsletter, 5 for lead_magnet, 0 for regulatory_brief)
- `--kb` - Enable KB enrichment via Factor Shift pipeline. Surfaces cross-domain mechanistic connections from the NGM Signaling Knowledge Base. Use for any content touching biological mechanisms, pathways, interventions, or biomarkers. **Auto-enabled for podcast_roundup**
- `--gif` - Generate a fast-scroll teaser GIF of the HTML content for social media promotion. Sized 1200x627 (LinkedIn 1.91:1 ratio). Only applicable to HTML content types (newsletter, lead_magnet). Runs after Phase 6 publish.
- `--bundle` - Generate a full content package: newsletter + lead_magnet + linkedin + instagram, all from a single topic. Research (Phase 1) and KB enrichment (Phase 1.5) run ONCE and are shared across all 4 content types. See "Bundle Mode" section below.

---

## Core Principle: Three-Model Split by Task Type

Three different models are used, each routed through the gateway/provider that best supports it. Model selection is split by task type to match each step to the best-available capability:

| Task type | Model | Provider / ID | Auth | Why |
|---|---|---|---|---|
| Prose / copy generation (all content types) | Claude Opus 4.6 | Vercel AI Gateway · `anthropic/claude-opus-4-6` | `AI_GATEWAY_API_KEY` from `.env.local` | Established prose voice baseline; runs the Phase 2 self-critique loop against NGM editorial rubrics |
| **Humanization pass on all approved copy (Phase 2.5)** | **GPT-5.5** | OpenRouter · `openai/gpt-5.5` | `OPENROUTER_API_KEY` from `.env` | Different model architecture sands off Anthropic-flavored AI-tells without destroying the structural decisions Opus 4.6 made |
| Visual design — SVG diagram generation, self-validation, metaphor design, and any visual iteration | **Claude Opus 4.7** | Vercel AI Gateway · `anthropic/claude-opus-4-7` | `AI_GATEWAY_API_KEY` from `.env.local` | Stronger spatial reasoning, finer SVG path fidelity, better adherence to the Diagram Style Standard (palette, typography, drawn subjects, polish cues) |

**Endpoints:**
- Vercel AI Gateway: `https://ai-gateway.vercel.sh/v1/chat/completions`
- OpenRouter: `https://openrouter.ai/api/v1/chat/completions`

Do not substitute one model for another. Visual fidelity degrades noticeably when prose-tuned models generate SVG; prose cadence degrades when visual-tuned models generate long-form copy; AI-tells survive when the same model that generated copy is asked to humanize it. Match the model to the task.

There is NO:
- Regex parsing of outputs
- Hard-coded iteration limits
- Deterministic state machines
- Script-based orchestration

Claude reads the context files, understands the quality criteria, constructs prompts, evaluates the output, and makes judgments about iteration.

---

## Workflow

### Phase 0: Load Context

Before starting, read:
1. `.ralph-content/progress.txt` - Prior learnings (if exists)
2. The context files in this skill's `context/` directory (already loaded via skill)

Note any patterns or gotchas from previous runs.

### Phase 0.5: Deduplication Check (Weekly Roundups Only)

**Goal:** Ensure each weekly roundup contains only net-new content by comparing against all previous issues.

**When:** This phase is MANDATORY for any `weekly_roundup` format content (e.g., "This Week in Longevity"). Skip for all other content types.

**Actions:**
1. **Find all previous issues:** Glob for `content/social-content/newsletters/*this-week-in-longevity*.json` (or the relevant series slug)
2. **Read the most recent 2-3 issues' JSON files** — the `textContent` and `beats[].stories[].headline` fields contain all covered stories
3. **Build an exclusion list** of all topics, companies, studies, people, and regulatory actions already covered:
   - Editor's Pick topics
   - All beat stories (headlines + summaries)
   - Quick Hits items
   - What to Watch items
4. **Carry forward "What to Watch" items ONLY if there's a genuine update** — e.g., an FDA decision date that was "upcoming" last week now has a result. Do NOT repeat the same forward-looking item without new information.
5. **Document the exclusion list** in your working notes before starting Phase 1 research

**Exclusion rules:**
- If a story was the Editor's Pick in a previous issue, it CANNOT appear anywhere in the new issue unless there is a material new development (e.g., new funding announced, trial results published, regulatory decision made)
- If a story appeared as a beat story, it cannot be repeated. A genuinely new development on the same topic (e.g., "Klotho Clock" was covered → new: "Klotho Clock receives FDA Breakthrough designation") IS allowed as a new story
- Quick Hits from previous issues should not be promoted to full stories without new data
- Companies/organizations mentioned in previous issues can appear again only with new news

**Quality check:** Before proceeding to Phase 1, confirm: "I have identified N stories from M previous issues that must be excluded. My research queries will explicitly avoid these topics."

### Phase 1: Research (Perplexity Deep Research)

**Goal:** Gather comprehensive, verifiable information on the topic using Perplexity's deep research model.

**IMPORTANT:** Use Perplexity via OpenRouter for deep research, NOT the basic WebSearch tool.

**How to call Perplexity:**
```bash
API_KEY=$(grep OPENROUTER_API_KEY .env | cut -d'=' -f2)
curl -s https://openrouter.ai/api/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{
    "model": "perplexity/sonar-deep-research",
    "messages": [{"role": "user", "content": "YOUR RESEARCH QUERY HERE"}]
  }' | jq -r '.choices[0].message.content'
```

**Actions:**
1. Formulate a comprehensive research query that covers:
   - Molecular/mechanistic details
   - Clinical data with study citations (author, journal, year, n, findings)
   - Latest research (specify 2024-2025)
   - Practical implications
2. Call Perplexity `sonar-deep-research` via OpenRouter using the Bash tool
3. Evaluate: Is the research sufficient for the content type?
   - For newsletter: Need specific studies, company examples, expert quotes
   - For lead magnet: Need mechanism details, clinical data, practical applications
4. If insufficient, run additional targeted Perplexity queries
5. Track sources for later citation

**Why Perplexity Deep Research:**
- Returns comprehensive, well-sourced academic content
- Includes specific study citations (author, journal, year)
- Provides mechanistic depth not available from basic web search
- Single query can return 10,000+ words of research synthesis

**Quality Check (you decide):**
- Do I have specific names, numbers, and timeframes?
- Do I have 3+ examples for evidence cascades?
- Do I have mechanism details, not just surface claims?
- Are my sources from peer-reviewed journals with proper citations?

### Phase 1.5: Knowledge Base Enrichment (Factor Shift) — `--kb` flag

**Goal:** Surface non-obvious, cross-domain mechanistic connections from the NGM Signaling Knowledge Base that add genuine editorial value — NOT generic clinical advice.

**When to use:** Enabled by `--kb` flag. **Auto-enabled for podcast_roundup.** Use for ANY content that touches biological mechanisms, interventions, biomarkers, or clinical protocols. The KB contains 862 curated documents across pathways (152), interventions (413), and biomarkers (297).

**Skip when:** Content is purely editorial/opinion, business strategy, or has no clinical/scientific substrate.

**How to call the Factor Shift Enrichment pipeline:**
```bash
VS_API_KEY=$(grep VECTORSHIFT_API_KEY .env 2>/dev/null | cut -d'=' -f2 || echo "sk_fkyJyb86LyHQR9IaomQq52xCdL7a31uyYbuHDxuqoTVqdf6n")

# Write full content to temp file, use jq to safely construct JSON
cat > /tmp/kb_content.txt << 'EOF'
YOUR FULL SECTION TEXT HERE — use complete paragraphs, not summaries
EOF

jq -n --rawfile content /tmp/kb_content.txt --arg focus "YOUR ENRICHMENT FOCUS" \
  '{inputs: {content: $content, enrichment_focus: $focus}}' | \
curl -s -X POST 'https://api.vectorshift.ai/v1/pipeline/69ab22d39813d41fbf525d0c/run' \
  -H "Authorization: Bearer $VS_API_KEY" \
  -H "Content-Type: application/json" \
  -d @-
```

The pipeline returns (nested under `outputs` key):
- `enriched_context` — narrative markdown with sections: Mechanistic Foundation, Key Interventions & Protocols, Biomarker Landscape, **Cross-Domain Connections**, Evidence Gaps, Key Citations
- `gap_analysis` — entity extraction + gap identification

#### CRITICAL: Input Quality Determines Output Quality

**DO NOT** send compressed summaries or one-line descriptions to the KB. The pipeline performs semantic retrieval — richer input text retrieves richer KB intersections.

**BAD** (produces generic output):
```
"Exercise induces GPLD1 which benefits cognition in aged mice"
```

**GOOD** (produces specific cross-domain connections):
```
"Exercise is not merely calorie expenditure or mitochondrial stress. It is a secretory event
distributed across liver, muscle, adipose tissue, endothelium, and brain. GPLD1 emerged as a
liver-derived mediator capable of recapitulating some exercise-associated gains in hippocampal
neurogenesis and cognition. The canonical muscle-brain pathway remains essential: exercise
elevates lactate, which signals through SIRT1 and PGC-1α, increasing FNDC5 expression and
cleavage to irisin, which supports BDNF-linked neuroplasticity..."
```

**Always send the FULL prose text** of each section/finding/topic — multiple paragraphs with mechanistic detail. This is what enables the KB to find deep intersections rather than surface-level matches.

#### Enrichment Focus by Content Type

Use a rich, specific enrichment focus — not a vague category:

- Newsletter: `"mechanistic depth, cross-domain connections, specific pathway crosstalk with other longevity pathways (AMPK, mTOR, NAD+, senescence), intervention protocols, biomarker interpretation, unexpected connections to other domains in the KB"`
- Lead magnet: `"intervention protocols and dosing, cross-domain pathway connections, biomarker panels for monitoring, evidence gaps"`
- Podcast roundup: `"mechanistic depth, cross-domain connections, specific pathway crosstalk, intervention protocols, biomarker interpretation, unexpected connections"`
- LinkedIn: `"one specific cross-domain connection or mechanistic insight that would surprise a knowledgeable clinician"`
- Regulatory brief: skip (use Phase 3 verification instead)

#### How to Use KB Output

**The key section is "Cross-Domain Connections."** This is where the editorial value lives. The KB surfaces connections like:

- NAD+ constraining the exercise→SIRT1→BDNF cascade (exercise may produce less cognitive benefit as NAD+ declines with age)
- Senescent cells upregulating DPP-4, which degrades GLP-1, creating a vicious cycle between aging and sugar craving
- Five independent inputs converging on AKT-GSK-3β (menopause + insulin resistance + inactivity = catastrophic GSK-3β disinhibition)
- Metformin's AMPK activation antagonizing mTORC1, creating a real drug-exercise timing conflict
- Circadian NAMPT oscillation → NAD+ peaks → mitochondrial biogenesis windows that circadian disruption collapses

**These are the insights that belong in NGM Deep Analysis callouts** — specific, non-obvious, pathway-named connections that practitioners wouldn't know from the source material alone.

#### Generating NGM Deep Analysis Callouts

After collecting KB cross-domain connections, integrate them into the draft with explicit attention to:

```
Write "NGM Deep Analysis" callout text. Rules:
- 2-3 sentences max
- Surface a specific cross-domain connection, not a truism
- Name specific pathways, molecules, or biomarkers
- Frame as "what practitioners wouldn't know from the source alone"
- No "For practitioners:" prefix — just state the insight directly
- Be intellectually honest about evidence confidence
```

**DO NOT** flatten KB insights into generic clinical advice like "treat exercise as a multisystem secretome." That wastes the KB's depth. Every callout should make a reader think "I didn't know that."

#### For podcast_roundup and multi-finding content:

Send each finding through enrichment **separately** with full text. Run queries in parallel. The KB returns different cross-domain connections for each topic because it retrieves against different pathway/intervention/biomarker clusters.

#### For LinkedIn posts with `--kb`:

A single KB query is usually sufficient. Extract the single most surprising cross-domain connection and use it as the post's intellectual anchor — the thing that makes someone stop scrolling. Example: "Your patient on metformin may be blunting their own exercise gains — AMPK activation from metformin antagonizes the mTORC1 signal their muscles need for protein synthesis after training."

### Phase 1.6: Editorial Angle Audit (MANDATORY before drafting)

**Goal:** Surface the *sharpest* finding inside the source paper, not the abstract headline. Authors optimize abstracts for citation pull. NGM optimizes for what changes how a thoughtful clinician thinks. These are different optimization functions.

**The failure mode this phase prevents:** Defaulting to the paper's abstract headline as the editorial anchor. Most longevity content does this. NGM's differentiation lives in surfacing the buried-but-sharp finding that the abstract treats as a sub-result.

**When this phase runs:** MANDATORY for any content type anchored to a specific paper, dataset, or trial result (LinkedIn, newsletter, lead magnet, podcast roundup, weekly roundup). Skip only for evergreen pieces that are not anchored to a specific source (e.g., voice/philosophy posts).

**Actions:**

1. **Enumerate 3–5 candidate findings from the source.** Read the paper end-to-end (not just the abstract). List the candidate findings explicitly. Each candidate must be statable in one sentence with at least one specific number, named comparison, or measurable contrast.

2. **Score each candidate on the 5-criterion sharpness rubric.** Score 1–5 on each:
   - **Counter-intuitive coefficient:** Does this finding violate what a thoughtful clinician would expect *before* reading the paper? (1 = confirms expectation; 5 = forces a reframe)
   - **Practical decision-changing:** Does this change how a clinician answers a real patient question or designs a protocol? (1 = no clinical implication; 5 = changes a specific decision tomorrow)
   - **Mechanism-richness:** Does this raise a "why" question worth answering, where the answer would be educational? (1 = mechanism is obvious; 5 = mechanism is genuinely puzzling)
   - **Differentiation from default coverage:** How much of the longevity content ecosystem will lead with this finding? (1 = everyone leads with this; 5 = almost nobody surfaces this)
   - **Specificity:** Can the finding be stated with an exact number, named comparison, or measurable contrast? (1 = vague; 5 = sharp single-number framing)

3. **Select the anchor.** The candidate with the highest total score becomes the editorial anchor. If multiple candidates score 18+, pick the one with the highest **counter-intuitive + practical** combined sub-score.

4. **Anti-default rule.** If the chosen anchor matches the paper's abstract headline, you must record a one-sentence justification in the JSON metadata: "I scored finding X higher than the abstract headline but chose the headline because [specific reason]." This forces a conscious decision rather than passive defaulting.

5. **Record the audit in pipeline metadata.** Add an `editorialAngleAudit` block to the JSON metadata for the deliverable, with the candidate enumeration, scores, selected anchor, and justification (if applicable). This makes the editorial decision auditable and allows future runs to learn from what worked.

6. **Anchor flows into Phase 2.** The hook architecture (Phase 2 step 1) and the body content (BJ voice) are now built around the audit-selected finding, not the abstract headline.

**The four "tells" that a finding is sharper than the abstract headline:**

- **Everyday-life implication.** The finding changes how a patient would answer "should I be doing X at home?" or how a clinician would respond to a common patient question.
- **Contradicts conventional wisdom.** The finding violates a reasonable prior held by an educated reader before they encountered the paper.
- **Has a "wait, why?" question attached.** The finding raises a mechanism question that doesn't have an obvious answer, making the post a natural teaching moment.
- **Requires no further data to be actionable.** The finding can be incorporated into clinical thinking without waiting for additional studies.

When two or more of these tells apply, the finding is almost certainly sharper than the abstract headline.

**Worked examples:** See `examples/sharpest-finding-audits/` for two reference cases (Lancet exercise meta-analysis 2026 and Cell Reports Medicine mRPG paper 2026) showing the candidate enumeration, scoring, and resulting editorial anchors.

**Quality bar:** A reader of the finished post should be able to articulate the central finding in one sentence — and that sentence should be different from the abstract's stated conclusion. If the post's central finding *is* the abstract conclusion, the audit was either skipped or the justification was weak.

### Phase 2: Draft via Opus 4.6 + Self-Critique Loop

**Goal:** Generate content that passes the quality rubric using Claude Opus 4.6 for prose generation.

**Copywriting Model:** All prose/copy generation is done by **Claude Opus 4.6** via the Vercel AI Gateway.

**How to call Opus 4.6:**
```bash
AI_GATEWAY_KEY=$(grep AI_GATEWAY_API_KEY .env.local | cut -d'=' -f2)
curl -s -X POST "https://ai-gateway.vercel.sh/v1/chat/completions" \
  -H "Authorization: Bearer $AI_GATEWAY_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "anthropic/claude-opus-4-6",
    "messages": [{"role": "user", "content": "YOUR PROMPT HERE"}],
    "stream": false,
    "max_tokens": 8000
  }' | jq -r '.choices[0].message.content'
```

**Tip:** For long prompts, write the prompt to a temp file first, then use `jq` to construct the JSON safely:
```bash
cat > /tmp/prompt.txt << 'EOF'
Your prompt here...
EOF
PROMPT=$(cat /tmp/prompt.txt) && jq -n --arg model "anthropic/claude-opus-4-6" --arg content "$PROMPT" \
  '{"model": $model, "messages": [{"role": "user", "content": $content}], "stream": false, "max_tokens": 8000}' | \
curl -s -X POST "https://ai-gateway.vercel.sh/v1/chat/completions" \
  -H "Authorization: Bearer $AI_GATEWAY_KEY" \
  -H "Content-Type: application/json" \
  -d @- | jq -r '.choices[0].message.content'
```

**Actions:**
1. **Hook Architecture (MANDATORY for ALL content types):** The default hook architecture is the Curiosity-Driven Hook Architecture documented in `context/every-voice-patterns.md`. Apply one of the six templates (Results-Just-Came-In, Superlative-Plus-Contradiction, Specific-Metric-With-Population-Reference, Industry-Reframe-Plus-Alternative, Unexpected-Finding-With-Implication, Tension-Between-Belief-And-Data). Pick the template that best fits the topic; do not default to the same template every time.
   - **Self-audit before continuing:** Apply the test from `every-voice-patterns.md`: "If I removed the rest of the post, would the hook alone make a knowledgeable reader feel they learned something specific?" If no, the hook is too vague or hedged — rewrite before drafting the body.
   - **Hook anti-patterns to avoid (mandatory):** No hedging in the hook (may/might/could/potentially); no generic claims ("studies show X is important"); no listicle openings; no academic throat-clearing ("Recent research has begun to..."); no citation-first framing; no artificial urgency.
   - **Opening Variety Check (newsletters specifically):** Glob the 3 most recent newsletter JSON files in `content/social-content/newsletters/` and read their opening paragraphs. Even within the curiosity-driven architecture, vary which template you use. The clinical vignette pattern should appear in no more than 1 in 5 newsletters.
   - **Legacy fallback:** The older "Opening Constructions" patterns (Concrete Scenario, Counterintuitive Claim, etc.) remain available but should only be used when the curiosity-driven templates do not fit the content shape.

1a. **LinkedIn Body Voice — Bryan-Johnson-Adapted (DEFAULT for `--type linkedin`):** Once the hook is locked, the body of every LinkedIn post defaults to the Bryan-Johnson-Adapted Voice in `context/every-voice-patterns.md`. This is the *default* voice and applies unless `--voice` overrides it (with `klosterman`, `attia`, etc.).
   - **Body cadence:** Period-heavy declarative. Average sentence length 10–18 words. Fewer than 20% of sentences may exceed 25 words. Each significant claim gets its own sentence. Use periods where most writers would use semicolons or em-dashes.
   - **Numerical specificity throughout:** Every paragraph in the body contains at least one specific number, named study, or measurable comparison. No "many," "several," "studies suggest." Always cite β / OR / HR with 95% CI when reporting effect sizes.
   - **Confident-but-falsifiable:** Cut "may," "might," "could," "potentially," "in some cases," "appears to" except where genuine clinical uncertainty exists. Make the strongest defensible claim and accept reputational risk.
   - **Asymmetric honesty:** Every LinkedIn post acknowledges at least one limitation, null result, or open question — embedded in the analysis, not appended as a closing disclaimer. This is the signature NGM editorial move.
   - **Imperative close:** The last line is a 2–6 word clinical instruction or calibration directive. Examples: "Prescribe the exercise. Calibrate the language." / "Show me your system, not your shelf." / "Write the prescription."
   - **Off-brand patterns to NOT import (mandatory):** Zero personal n=1 framing of Anant's biomarkers; zero "Don't Die" / civilizational-scale stakes; zero supplement-stack disclosures; zero listicle structures as the spine of the argument; zero aggressive contrarianism untethered to specific data.
   - **BJ-Voice Self-Audit:** Before submitting the draft to Phase 2.5 humanization, run the six-item checklist from `every-voice-patterns.md` → "The BJ-Voice Self-Audit." All six must pass. If any fail, rewrite the body.
   - **Voice override rules:** If `--voice` is set to a non-default voice (e.g., `klosterman`), that voice's body patterns take precedence over the BJ defaults, but the BJ-derived hook architecture and asymmetric-honesty requirement still apply. `bryan_johnson` and `sinclair` and `attia` compose well; `klosterman` does not (Klosterman's winding sentences cut against BJ's period-heavy cadence — drop the BJ body cadence requirement when invoking Klosterman).
2. Construct a detailed prompt and call Opus 4.6 via the Vercel AI Gateway, applying:
   - Voice and style guidelines from `context/every-voice-patterns.md`
   - **Banned Patterns (MANDATORY):** Never use the 'Zero Echo' device (stating a fact then repeating the number alone on its own line for emphasis, e.g. 'Zero trials.\n\nZero.'). Never use 'let that sink in,' 'read that again,' or 'I'll say it again.' When evidence is absent, state it once and move immediately to implications, adjacent evidence, or what would need to be true. The absence is one sentence in a paragraph, not a standalone dramatic beat.
   - **Approachability Rules (MANDATORY for newsletters and lead magnets):** These pieces are teaching a clinician who skims. Every section must feel walkable, not dense. Apply all six rules:
     1. **Short paragraphs.** 1–3 sentences max. If a paragraph is 4+ sentences, split it. Four-sentence paragraphs are the density smell.
     2. **Analogy before mechanism.** Every time you introduce a molecular detail, pathway, or unfamiliar term, lead with a plain-English analogy or comparison ("Think of it like…", "This works similarly to…", "Imagine…"). The mechanism comes *after* the analogy, not before it.
     3. **Signpost why-this-matters.** Between every two sections, add a short bridge sentence or phrase that tells the reader what they're about to learn and why it matters clinically. Use phrases like "Here's why this matters for practice:", "The clinical implication:", "What this changes:". These are not filler — they are navigation.
     4. **One-sentence emphasis beats.** Aim for 4–8 one-sentence paragraphs in a newsletter (more than the Every 3–6 range) and 6–12 in a lead magnet. These break dense prose into breathable beats. They land the insight. They give the reader's eye a rest. Never place two in a row.
     5. **Walk-through transitional phrasing.** Use active teaching phrases that guide the reader through complexity: "Let me walk you through this.", "Here's the key idea:", "Let's unpack that.", "Stay with me — this matters.", "Here's what that looks like in practice.", "Picture it this way.". Use 3–6 per newsletter, 6–10 per lead magnet.
     6. **Progressive mechanism disclosure.** Never front-load mechanism detail. Every section follows hook → analogy → one-sentence thesis → mechanism detail → clinical implication. If a section opens with a protein name or pathway acronym, you've failed rule 6 — rewrite it.
   - Content type format requirements
   - All research gathered in Phase 1
   - KB enrichment context from Phase 1.5 (if applicable)
   - The opening construction selected in step 1
3. Review the output and self-critique against the rubric:
   - For newsletter: 8-point Every.to rubric
   - For lead magnet: 10-point lead magnet rubric
   - For LinkedIn: 14-point LinkedIn rubric
   - For Instagram: 10-point script rubric
   - For podcast roundup: 10-point podcast roundup rubric
4. For each failing criterion, identify what failed and where
5. If revisions are needed, call Opus 4.6 again via the gateway with specific revision instructions
6. Re-evaluate. Repeat until the content passes.

### Phase 2.5: Humanization Pass (GPT-5.5)

**Goal:** Take the rubric-approved Opus 4.6 draft and rewrite it to remove residual AI-tell patterns. Preserve every fact, citation, name, number, and structural section. Rewrite *only* voice and rhythm.

**When this runs:** MANDATORY for every copy type — newsletter, lead magnet, LinkedIn, Instagram, podcast roundup, regulatory brief, weekly roundup. Runs AFTER Phase 2 passes the quality rubric and BEFORE Phase 3 fact verification (so verification operates on the final humanized text).

**Why it runs second, not first:** Opus 4.6's self-critique loop enforces NGM editorial structure (evidence cascades, colon technique, opening variety, banned patterns). GPT-5.5 then sands off the AI-tell texture. Doing the humanization before structure is locked produces mush; doing it after produces editorial copy that doesn't read like a model wrote it.

**Model:** GPT-5.5 via OpenRouter (`openai/gpt-5.5`). Use `OPENROUTER_API_KEY` from `.env` — the same key the Phase 1 Perplexity calls use.

**How to call GPT-5.5:**

```bash
API_KEY=$(grep OPENROUTER_API_KEY .env | cut -d'=' -f2)

# Write the approved draft and the humanization brief to temp files, then construct JSON safely
cat > /tmp/humanize_draft.txt << 'EOF'
[The full rubric-approved copy from Phase 2, verbatim]
EOF

cat > /tmp/humanize_system.txt << 'EOF'
[See "Humanization System Prompt" below]
EOF

DRAFT=$(cat /tmp/humanize_draft.txt) && SYSTEM=$(cat /tmp/humanize_system.txt) && \
jq -n --arg model "openai/gpt-5.5" --arg system "$SYSTEM" --arg draft "$DRAFT" \
  '{model: $model, messages: [{role: "system", content: $system}, {role: "user", content: $draft}], temperature: 0.7, max_tokens: 8000}' | \
curl -s https://openrouter.ai/api/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d @- | jq -r '.choices[0].message.content'
```

#### Humanization System Prompt (use verbatim)

```
You are a senior editor at a high-end editorial publication (think The Atlantic, NEJM essays, Every.to). You are rewriting AI-generated copy so it no longer reads as machine-written, while preserving every factual claim and structural decision the original made.

## What you MUST preserve

- Every named person, company, drug, study, gene, pathway, biomarker, dose, percentage, dollar figure, year, and citation. Do not paraphrase numbers. Do not change author attributions.
- Every section break, heading, paragraph break, and line break. The structure was deliberate.
- Every quoted phrase in quotation marks (these are often deliberate brand callouts).
- The opening hook construction. Do not rewrite the first sentence into a different rhetorical pattern.
- The CTA at the end. Do not rephrase the call-to-action mechanic.
- Word count within ±10% of the input.

## What you MUST rewrite — the AI-tells to eliminate

These are the patterns that mark copy as AI-generated. Hunt them and remove them:

1. **Overly balanced sentence rhythm.** AI tends to write sentences of similar length back-to-back. Vary sentence length deliberately. Mix 4-word sentences with 35-word sentences. The variance is the human signal.

2. **"Not just X, but Y" / "It's not X, it's Y" constructions.** These are AI's go-to rhetorical move. Eliminate every instance. State the real thing directly without negating an alternative first.

3. **Generic transitions.** Delete every "Furthermore," "Moreover," "Additionally," "In addition," "What's more," "It's worth noting that," "Importantly," "Notably." If a transition is needed, use a colon, a period, or rewrite to make the connection implicit.

4. **Hedging clutter.** Cut "potentially," "arguably," "in many cases," "tends to," "may suggest" when the source claim is more direct. Hedge only where genuine uncertainty exists.

5. **Adjective stacking.** "Comprehensive, evidence-based, holistic approach" — pick one adjective, drop the others. Three adjectives in a row is an AI fingerprint.

6. **Three-item lists everywhere.** AI loves the rule of three. Where the underlying claim has two items or four, don't artificially shape it into three.

7. **Perfectly tied-up conclusions.** AI ends with a circular callback to the opening or a tidy synthesis. Real writers leave a sharper edge: a forward-looking implication, an unresolved tension, or a single concrete instruction.

8. **Buzzword density.** "Cutting-edge," "rapidly evolving," "transformative," "revolutionary," "paradigm shift," "deep dive," "leverage," "ecosystem," "robust," "seamless." Strip these on sight.

9. **"It's important to" / "It's worth noting that" / "Ultimately" / "At its core."** Filler scaffolding. Cut.

10. **Topic-name repetition.** AI repeats the topic word every paragraph for cohesion. Use pronouns, synonyms, or trust the reader's working memory.

11. **Empty intensifiers.** "Truly remarkable," "incredibly significant," "fundamentally changes." If a number or specific claim makes it remarkable, the adjective is redundant.

12. **Faux-conversational openers.** "Now," "So," "Look," dropped at the front of paragraphs to feign casualness. Cut unless the surrounding voice is genuinely conversational.

## What you MUST NOT do

- Do not introduce em-dashes (—). Use periods, colons, commas, or parentheses.
- Do not introduce "Not X. It's Y." or "It's not X, it's Y" constructions.
- Do not introduce "let that sink in," "read that again," "think about that," "I'll say it again."
- Do not introduce the "zero echo" device (stating a fact then repeating the number alone on its own line for emphasis).
- Do not introduce banned phrases: game-changer, revolutionary, paradigm shift, deep dive, unpack, leverage, ecosystem, seamless, robust, scalable, cutting-edge, thought leader, hustle, grind, 10x, at the end of the day, in today's world, in this day and age, now more than ever.
- Do not soften specific quantitative claims into vague ones.
- Do not add a "Conclusion:" or "In summary:" header.
- Do not add disclaimers, hedges, or "consult your physician" boilerplate.

## Output format

Return ONLY the rewritten copy. No preamble. No explanation of what you changed. No "Here is the revised version:" header. The next thing in your output should be the first character of the rewritten piece.
```

**Actions:**

1. Take the Phase 2 rubric-approved draft and feed it to GPT-5.5 with the system prompt above.
2. Receive the humanized version.
3. **Re-run the banned-pattern scan** on the humanized output:
   - em-dashes (`—`) — count must be 0
   - "Not X. It's Y." / "Not X, it's Y." — count must be 0
   - Zero-echo / "let that sink in" variants — count must be 0
   - Banned phrases (game-changer, paradigm shift, deep dive, leverage, ecosystem, robust, seamless, etc.) — count must be 0
4. **If the scan finds any banned pattern introduced by GPT-5.5:**
   - For 1–2 instances: surgically Edit the file to fix them (replace em-dash with period/colon, rewrite "Not X. It's Y." into a direct affirmative).
   - For 3+ instances: re-call GPT-5.5 with the original draft AND a feedback line listing the specific patterns it introduced, asking for another pass.
5. **Verify content preservation.** Quick spot-check that all named people, dollar figures, percentages, study citations, and the CTA mechanic are still present in the humanized version. If any factual element is missing or altered, re-call GPT-5.5 with an explicit instruction to preserve those specific claims.
6. Use the humanized text as the input for Phase 3 (verification) and Phase 5 (assembly).

**Quality bar:** A reader should not be able to tell the piece was first-drafted by an LLM. The structure (NGM editorial cadence, evidence cascades, opening variety) should be preserved exactly; only the surface texture (sentence rhythm, transition choices, adjective density, hedging cadence) should change.

**Diagrams are exempt.** Phase 4 SVG generation does not produce prose copy and does not run through this humanization step. The text labels inside diagrams are short enough that AI-tell patterns rarely surface.

### Phase 3: Fact Verification (if --verify flag or regulatory_brief)

**Goal:** Ensure claims are accurate, citations are correct, and sources are reputable.

**For regulatory_brief type, this phase is MANDATORY and expanded.**

**Actions:**

#### 3A. Source Credibility Audit
Before verifying claims, audit ALL cited sources for credibility:

**ACCEPTABLE sources:**
- Peer-reviewed journals (PubMed, PMC, MDPI, Nature, Science, etc.)
- Official regulatory bodies (FDA.gov, EMA.europa.eu, WHO)
- Academic institutions (.edu domains)
- Professional medical associations
- StatPearls/NCBI Bookshelf
- Wikipedia (for general/regulatory reference only, note as such)

**REJECT and replace:**
- Ecommerce sites selling the product being discussed
- Supplement/peptide vendor sites (e.g., peptidesciences.com, cosmicnootropic.com)
- Biased commercial sources
- Anonymous blogs without citations
- Social media posts

If a rejected source is found, search for a peer-reviewed alternative that supports the same claim.

#### 3B. Citation Accuracy Validation
For each citation, verify:
1. **Author attribution** - Correct authors listed (not misattributed)
2. **Year** - Publication year is accurate
3. **Journal/Source** - Correct journal name
4. **Claim mapping** - Citation actually supports the claim it's attached to

Common errors to catch:
- Wrong author (study may have multiple related papers)
- Wrong year (confusing similar studies)
- Citation supports a different claim than stated

#### 3C. Claim Verification
1. Identify the 3-5 most significant claims in the content
2. For each claim, use `WebSearch` to cross-verify with primary sources
3. If a claim is inaccurate:
   - Correct it with accurate information
   - Update the source citation
4. If a claim cannot be verified:
   - Either remove it or mark it as "preliminary" with appropriate hedging

#### 3D. Reasoning Consistency Check (for multi-document sets)
When creating related documents (e.g., multiple safety briefs), ensure:
1. **Consistent evidence weighting** - Same types of evidence receive similar weight across documents
2. **Explicit reasoning** - If conclusions differ, the justification is explicit
3. **Proportional conclusions** - Stronger evidence → stronger conclusions

**Example:** If Document A has human trial data and Document B only has preclinical data, Document A should not receive a weaker conclusion unless there's explicit justification (e.g., Document B has class-level regulatory precedent).

### Phase 4: Diagram Generation + Validation

> **🚨 MANDATORY PRE-FLIGHT GATE — Lead Magnet Bundles**
>
> Before proceeding past Phase 2.5, if the content type is `lead_magnet` (either standalone or part of `--bundle`), you MUST add the following items to your TodoWrite list as **explicit pending tasks**, separate from "assembly":
>
> 1. `Select N visual metaphors for lead magnet (default N=4, range 3-7)`
> 2. `Generate N SVG diagrams via Opus 4.7`
> 3. `Validate diagrams against Diagram Style Standard (criteria 11-17)`
> 4. `Embed diagrams into lead magnet HTML at section breaks`
> 5. `Update lead magnet JSON with diagrams[] array`
>
> **Phase 4 cannot be skipped for lead magnets.** The lead magnet rubric in `context/quality-rubrics.md` requires 3-7 diagrams (criterion 8 `diagram_count`). A lead magnet with zero diagrams fails the rubric, period — there is no partial pass.
>
> **Failure mode this gate prevents:** Bundle mode is verbose enough that Phase 4 can be silently skipped between Phase 2.5 (humanization) and Phase 5 (assembly). The agent assembles the HTML, the JSON validates, and the deliverable looks "done" — but the diagrams never got generated. This has happened in production. The 2026-05-04 henagliflozin bundle shipped without diagrams and required a backfill round. Do not repeat.
>
> **Self-check before declaring Phase 4 complete:** Run `grep -c '<svg' content/learn-platform/lead-magnets/<slug>.html`. The count MUST be ≥ 3 for a lead magnet. If 0, you skipped Phase 4. Go back and do it.

**Goal:** Create SVG diagrams that render correctly, illuminate concepts, and use visual metaphors that make molecular biology intuitive.

**Visual Design Model:** All visual-design steps in this phase run on **Claude Opus 4.7** via the Vercel AI Gateway — SVG generation, metaphor selection, self-validation, and any iteration/refinement. Do NOT use Opus 4.6 (the prose model) for any of these steps. Opus 4.7's stronger spatial reasoning and SVG path fidelity are material to hitting the Diagram Style Standard.

**How to call Opus 4.7 for visual steps:**
```bash
AI_GATEWAY_KEY=$(grep AI_GATEWAY_API_KEY .env.local | cut -d'=' -f2 | tr -d '"')
cat > /tmp/visual_prompt.txt << 'EOF'
Your visual-design prompt here. Include:
- The content the diagram must convey
- The chosen layout (Hub, Comparison, Timeline, etc.) and why it fits
- The Diagram Style Standard constraints (palette, typography, drawn subject, label hierarchy, polish, framing)
- Canvas geometry (e.g. 1200×1200 for LinkedIn square, 800×450 for inline)
- Any specific figure title and citation footer text
EOF
PROMPT=$(cat /tmp/visual_prompt.txt) && jq -n --arg model "anthropic/claude-opus-4-7" --arg content "$PROMPT" \
  '{"model": $model, "messages": [{"role": "user", "content": $content}], "stream": false, "max_tokens": 12000}' | \
curl -s -X POST "https://ai-gateway.vercel.sh/v1/chat/completions" \
  -H "Authorization: Bearer $AI_GATEWAY_KEY" \
  -H "Content-Type: application/json" \
  -d @- | jq -r '.choices[0].message.content'
```

**Canonical quality benchmark:** `content/graphics/garlic-linkedin/garlic-longevity-hub.html` is the *quality bar*, not a template to clone. What makes it ship-worthy is the **style** (palette, typography, drawn subjects, plain-English-over-mechanism labels, polished rendering, editorial framing), which applies to every diagram. The specific radial layout is one of several valid layouts — pick the layout that fits the content, not the one that matches garlic.

**Read before creating any diagram:** `context/diagram-guidelines.md` → "Diagram Style Standard (UNIVERSAL)". Those six style qualities apply to every diagram regardless of layout. Then consult "Diagram Types," "Visual Metaphor Library," and "Hub Layout" for layout-specific conventions.

**Validation:** Every diagram must pass the Style Standard criteria (11–17 in `context/quality-rubrics.md` → "Diagram Validation Criteria"). Hub-layout diagrams additionally must pass H1–H5. Other layouts carry their own structural rules from "Diagram Types" in the guidelines.

**Layout selection:** Pick based on content shape.
- Central concept with 3–10 parallel downstream outcomes, shared valence → Hub Layout
- Sequential steps or causal chain → Process Flow / Mechanism Pathway
- Before/after, A/B, two-paradigm contrast → Comparison panel
- Time progression → Timeline
- Nested hierarchy → Concept/Hierarchy
- Two-variable position → Quadrant/Positioning Chart
- Physical-world scene teaching a mechanism → Visual Metaphor

Variability in layout is expected. Variability in *style* is not — every diagram shares the editorial palette, typography, drawn-subject bias, label hierarchy, polish cues, and framing.

**Actions:**

*Every numbered step below that produces or evaluates visual output MUST route through Opus 4.7 (`anthropic/claude-opus-4-7`) on the Vercel AI Gateway. Do not fall back to Opus 4.6 for any visual sub-step.*

1. Identify concepts that would benefit from visualization. Choose the layout that fits the content shape, not a default.
2. **[Opus 4.7] For each diagram, select a visual metaphor FIRST** (especially for lead magnets):
   - Do NOT default to box-and-arrow flowcharts. Instead, find a physical-world metaphor that makes the mechanism viscerally understandable.
   - Map the biology to the metaphor: What is the actor? What is the action? What is the outcome?
   - See `context/diagram-guidelines.md` → "Visual Metaphor Library" for the catalog of proven metaphors.
   - **Lead magnet standard:** Every lead magnet diagram MUST use a visual metaphor. Each diagram gets a narrative title (e.g., "The Hungry Pathogen", "The Spreading Fire", "The Parking Brake") that frames the biology as a story.
   - **Newsletter diagrams** may use simpler metaphors or annotated comparisons, since they're inline within prose.
3. For each diagram:
   a. **[Opus 4.7]** Choose the appropriate diagram type (mechanism, comparison, process, etc.)
   b. **[Opus 4.7]** Select a visual metaphor from the library or invent a new one that fits
   c. **[Opus 4.7]** Generate SVG code following `context/diagram-guidelines.md` — call Opus 4.7 via the gateway using the template at the top of this phase. Include the Style Standard constraints and the chosen layout in the prompt.
   d. **[Opus 4.7] Self-validate the SVG:**
      - Parse the SVG mentally—check text positions vs container bounds
      - Verify viewBox has sufficient size for content
      - Confirm text has 40px+ padding from edges
      - Check that text inside containers is FULLY contained
      - Verify color palette compliance with the NGM editorial palette
      - Verify Diagram Style Standard criteria (11–17 in `context/quality-rubrics.md`)
      - If the layout is Hub, additionally verify H1–H5
      - **Check metaphor clarity:** Would someone who hasn't read the article understand the visual story?
   e. **[Opus 4.7]** If validation fails, call Opus 4.7 again with specific fixes to regenerate.

**Metaphor Selection Example:**
"This section explains how bacterial DPP-4 degrades host GLP-1. The metaphor: a pac-man pathogen devouring fragile molecules. Top scene shows the devouring (without drug). Bottom scene shows an armored molecule soaring past the predator (with drug). Title: 'The Hungry Pathogen'."

**Validation Example:**
"I see text at y=380 in a viewBox of height 400. With 40px padding requirement, the lowest y for text should be 360. This will overflow. I need to either increase the viewBox height or move the text up."

### Phase 5: Assembly

**Goal:** Compose final HTML output using the ONE editorial design system.

**CRITICAL — Template Selection:**

| Content Type | Delivery | Font Import | Styling | Width |
|-------------|----------|-------------|---------|-------|
| Lead magnet | Web page | Google Fonts `<link>` | `<style>` block + CSS classes + `:root` vars | 820px |
| Newsletter  | Email    | None (email clients ignore) | Inline styles on every element | 600px table |
| LinkedIn    | Plain text | N/A | N/A | N/A |
| Instagram   | Script   | N/A | N/A | N/A |

Both HTML types use the SAME font families:
- Display: `'Cormorant Garamond', Georgia, serif`
- Body: `'Source Serif 4', Georgia, serif` (lead magnet) / `Georgia, serif` (email fallback)
- UI/Labels: `'DM Sans', system-ui, sans-serif` (lead magnet) / `'DM Sans', Arial, sans-serif` (email)

**Bundle-mode guardrail:** When generating newsletter + lead magnet in the same session, generate lead magnet FIRST (CSS classes), then newsletter (inline styles). Never carry formatting patterns from one type to the other.

**Wrong-template diagnostic:** If a lead magnet HTML has zero `class="..."` attributes or no `<style>` block — it's using the email template by mistake. Regenerate.

**Actions:**
1. For lead magnet: Use the "Lead Magnet HTML Template" from `context/ngm-style-guide.md` — full `<style>` block with CSS classes, Google Fonts `<link>`, semantic HTML
2. For newsletter: Use the "Newsletter HTML (Editorial Email)" from `context/ngm-style-guide.md` — inline styles with editorial font families, table-based layout
3. For LinkedIn: Format as plain text with appropriate line breaks
4. For Instagram: Format as script with HOOK / BODY / CTA markers

### Phase 6: Publish + Learn

**Goal:** Save output and capture learnings.

> **🚨 PUBLISH-TIME GATE — Lead Magnets**
>
> Before saving any lead magnet HTML or JSON to disk, run this verification (one-liner):
>
> ```bash
> SLUG="<your-slug>"
> SVG_COUNT=$(grep -c '<svg' "content/learn-platform/lead-magnets/${SLUG}.html" 2>/dev/null || echo 0)
> if [ "$SVG_COUNT" -lt 3 ]; then
>   echo "❌ GATE FAILURE: Lead magnet has $SVG_COUNT diagrams. Rubric requires ≥3."
>   echo "Go back to Phase 4 before continuing."
>   exit 1
> fi
> echo "✅ Diagram gate passed: $SVG_COUNT diagrams present."
> ```
>
> If the gate fails, you must return to Phase 4 and generate diagrams. Do not proceed to commit. Do not declare the bundle complete. The diagram count IS a publish gate, not an aspirational target.
>
> **The same gate applies to bundle mode.** When generating a `--bundle`, the bundle is not complete until the lead magnet portion passes this gate. The newsletter, LinkedIn post, and Instagram script can be assembled and saved independently, but the bundle as a whole is incomplete until the lead magnet has its diagrams.

**Actions:**
1. Save the content:
   - Newsletter: `content/social-content/newsletters/YYYY-MM-DD-{slug}.html`
   - Lead magnet: `content/learn-platform/lead-magnets/{slug}.html` + `.json`
   - LinkedIn: `content/social-content/linkedin-posts/YYYY-MM-DD-{slug}.md`
   - Instagram: `content/social-content/instagram-scripts/YYYY-MM-DD-{slug}.md`

2. Update `.ralph-content/progress.txt`:
   - What worked well
   - What needed iteration
   - Patterns discovered
   - Gotchas to avoid

3. Git commit with quality summary:
   ```
   feat: Add {type}: {title}

   - Quality: Passed {N}/{total} criteria on iteration {M}
   - Diagrams: {N} generated, {N} validated
   - Research: {N} sources cited

   Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>
   ```

### Phase 6.5: GIF Generation (when `--gif` flag is set)

**Goal:** Create a fast-scroll teaser GIF of the HTML content for social media promotion.

**Prerequisites:** `gifsicle` must be installed (`brew install gifsicle`).

**Only runs for HTML content types** (newsletter, lead_magnet). Skip for plain-text types (linkedin, instagram).

**Workflow:**

1. **Open the HTML in Chrome:**
   - Use `tabs_context_mcp` to get/create a tab group
   - Use `navigate` to open the published HTML file via `file://` path

2. **Set up the viewport:**
   - Use `resize_window` to set browser to 1200x627

3. **Record the fast scroll:**
   - Scroll to top: `javascript_tool` with `window.scrollTo(0, 0)`
   - Take a screenshot to confirm top of page
   - Start GIF recording: `gif_creator` action `start_recording`
   - Take initial screenshot (captures first frame)
   - Scroll through entire page using `computer` tool `scroll` action with `scroll_amount: 10` (maximum speed). Take a screenshot after each scroll. Repeat until bottom is reached (~6-10 scrolls depending on page length)
   - Take final screenshot, then stop recording: `gif_creator` action `stop_recording`

4. **Export raw GIF:**
   - `gif_creator` action `export` with `download: true`
   - Raw GIF saves to `~/Downloads/`

5. **Post-process with gifsicle:**
   ```bash
   gifsicle -d15 ~/Downloads/{raw-gif-name}.gif \
     --resize 1200x627 \
     --colors 256 \
     -O3 \
     -o ~/Downloads/{slug}-linkedin.gif
   ```
   - `-d15` = 150ms per frame (~1.2s total for 8 frames) — fast enough that viewers can't read the content
   - `--resize 1200x627` = LinkedIn image dimensions (corrects Retina scaling)
   - `--colors 256 -O3` = optimize file size

6. **Reset browser:**
   - `resize_window` back to 1440x900

**Output:** `~/Downloads/{slug}-linkedin.gif` — ready for LinkedIn/social media upload.

**Key learnings:**
- The GIF recorder only captures `computer` tool actions (screenshot, scroll, click) — NOT `javascript_tool` actions
- macOS Retina displays capture at 2x resolution, so gifsicle resize is essential
- Scroll speed must be fast enough that viewers can't read the full content (they should need to download the actual guide)

---

## Bundle Mode (`--bundle`)

When `--bundle` is set, generate all 4 content types from a single topic: **newsletter + lead_magnet + linkedin + instagram**. This is the default content package for any new topic.

### How It Works

Bundle mode modifies the standard workflow to share research and avoid redundant API calls:

**Phase 0-1 (shared):** Context loading, research, and KB enrichment run ONCE. The research corpus is reused across all 4 content types.

**Phase 2 + 2.5 (sequential, 4 passes):** Draft each content type in this order, with its own Opus 4.6 call via the gateway, quality rubric self-critique, AND its own GPT-5.5 humanization pass before moving to the next type:

1. **Newsletter first** (the anchor piece)
   - Longest form, most research-dense
   - Apply Opening Variety Check
   - Run through 8-point newsletter rubric
   - This draft establishes the core argument, evidence cascade, and key insights
   - **Run Phase 2.5 humanization on the approved draft before drafting the lead magnet.** The lead magnet should be derived from the *humanized* newsletter, not the raw Opus 4.6 output, so editorial voice flows consistently across the bundle.

2. **Lead magnet second**
   - Derive from the humanized newsletter's research and restructure for the lead magnet format
   - Add mechanism table, frameworks, and diagrams (default 5)
   - Run through 10-point lead magnet rubric
   - Generate `accessKeyword` from the topic
   - **Run Phase 2.5 humanization on the approved draft.** This is the longest piece in the bundle; humanization matters most here because dense AI-tells compound across sections.

3. **LinkedIn post third**
   - Distill the humanized newsletter's core insight into 200-300 words
   - Apply Curiosity Architecture (tease the lead magnet or newsletter)
   - Run through 14-point LinkedIn rubric
   - CTA should point to the lead magnet or newsletter
   - **Run Phase 2.5 humanization on the approved post.** Short-form copy is where AI-tells stand out most to readers; the humanization pass is non-negotiable here.

4. **Instagram script last**
   - Extract the single most compelling hook from the humanized newsletter
   - Write for spoken delivery (30-90 seconds)
   - Run through 10-point script rubric
   - **Run Phase 2.5 humanization on the approved script.** Use the spoken-delivery framing in the GPT-5.5 prompt so it preserves natural cadence (contractions, sentence fragments, conversational beats).

**Phase 3 (verification, optional):** Verification applies if `--verify` is set. It runs on the humanized text from Phase 2.5, not the raw Opus 4.6 draft.

**Phase 4 (diagrams, MANDATORY for lead magnet):** Lead magnets in a bundle MUST go through Phase 4. This is non-negotiable. The bundle default is 5 lead magnet diagrams (see Bundle Defaults table below). Without diagrams, the lead magnet fails the rubric (criterion 8 `diagram_count` requires ≥3) and the bundle is incomplete. Phase 4 runs after Phase 2.5 and before Phase 5 assembly. The newsletter's 2 diagrams are also recommended unless the topic is purely textual analysis.

> **🚨 BUNDLE-MODE DIAGRAM CHECKLIST (the failure mode this prevents)**
>
> Bundle mode runs four content types in sequence and Phase 4 is easy to skip silently because (a) you finish humanizing the lead magnet text, (b) you mentally jump to LinkedIn next because that's the next item in the bundle order, and (c) Phase 4 sits between content-type drafting and bundle-wide assembly. The 2026-05-04 henagliflozin bundle shipped without diagrams for exactly this reason.
>
> **Hard requirement:** After Phase 2.5 humanization of the lead magnet, BEFORE drafting the LinkedIn post, you MUST add the diagram tasks to your TodoWrite list as separate pending items. Do not move on to LinkedIn drafting with the diagram tasks unrecorded.

**Phase 5-6 (shared):** Assembly and publishing for all 4 types. Single git commit with all outputs. The Phase 6 publish-time gate (≥3 diagrams in lead magnet HTML) applies in bundle mode too.

### Bundle Defaults

| Setting | Bundle Default |
|---------|---------------|
| Newsletter diagrams | 2 |
| Lead magnet diagrams | 5 |
| LinkedIn diagrams | 0 |
| Instagram diagrams | 0 |
| KB enrichment | Follows `--kb` flag (not auto-enabled) |
| Verification | Follows `--verify` flag (not auto-enabled) |

### Bundle Commit Message

```
feat: Add content bundle: {title}

- Newsletter: {word_count} words, {quality_score} quality
- Lead magnet: {diagram_count} diagrams, keyword {keyword}
- LinkedIn: {word_count} words, {quality_score} quality
- Instagram: {duration}s script, {quality_score} quality
- Research: {source_count} sources cited

Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>
```

### Example

```bash
/ralph-content "How cold exposure affects brown adipose tissue" --bundle --voice huberman --kb
```

Produces:
- `content/social-content/newsletters/YYYY-MM-DD-cold-exposure-bat.html` + `.json`
- `content/learn-platform/lead-magnets/cold-exposure-bat.html` + `.json`
- `content/social-content/linkedin-posts/YYYY-MM-DD-cold-exposure-bat.json`
- `content/social-content/instagram-scripts/YYYY-MM-DD-cold-exposure-bat.json`

All from one command with shared research.

---

## Content Type Specifics

### Newsletter
- **Format:** Email-ready HTML
- **Length:** 1200-2000 words
- **Diagrams:** 2-3 SVG
- **Quality rubric:** Every.to 8-point
- **Voice:** Select based on content (Dan Shipper, Tina He, etc.)

### Lead Magnet
- **Format:** Full HTML document
- **Length:** ~1000 words
- **Diagrams:** 3-7 SVG
- **Additional:** Mechanism table, references section
- **Voice:** Andrew Huberman style

### LinkedIn
- **Format:** Plain text with line breaks
- **Length:** 200-300 words
- **Diagrams:** 1 SVG (for image post)
- **Quality rubric:** 14-point LinkedIn rubric

### Instagram
- **Format:** Script with sections
- **Duration:** 30-90 seconds spoken
- **Diagrams:** None (video format)
- **Quality rubric:** 10-point script rubric

### Podcast Roundup
- **Format:** Email-ready HTML (NGM editorial design)
- **Length:** 1500-2500 words
- **Diagrams:** 0 (text-driven format)
- **Quality rubric:** Podcast roundup rubric (see quality-rubrics.md)
- **Voice:** Every.to editorial — confident, specific, forward-looking
- **KB Enrichment:** REQUIRED (this is the core differentiator)

**Podcast roundup workflow (replaces generic Phase 1-2 flow):**

1. **Phase 1: Episode Research** — Use Perplexity to find recent episodes from the podcast roster (Huberman, Attia, Patrick, Hyman, Nicola, Campbell, and emerging voices). Extract the 5-8 most interesting, novel, or clinically actionable findings across all episodes. Do NOT force findings into predefined themes.

2. **Phase 1.5: KB Enrichment (REQUIRED)** — For each major finding, call the Factor Shift Enrichment pipeline with the finding as content and `"mechanistic depth, pathway connections, intervention protocols, evidence quality"` as enrichment focus. The KB enrichment serves three purposes:
   - **Deepen**: Add mechanistic specificity the podcaster may have glossed over (pathway names, molecular targets, gene symbols)
   - **Connect**: Surface cross-domain connections between findings that the podcasters didn't make (e.g., two episodes discussing different aspects of the same signaling pathway)
   - **Challenge**: Where the KB documents evidence gaps, dose-response paradoxes, or conflicting data, use those to add intellectual honesty

3. **Phase 2: Draft** — Write the roundup as a series of **short, punchy findings** (not mini-essays). Each finding:
   - 2-3 paragraphs max (not 4-5 dense paragraphs)
   - Opens with the most surprising or actionable claim from the episode
   - Weaves in 1-2 KB enrichment insights that deepen or connect the finding
   - Ends with a practitioner-relevant implication
   - Source attribution: podcaster, show, episode, date

**Structure:**
```
HEADER: Title, subtitle, date range, byline
THE BOTTOM LINE: 2-3 sentence executive summary
FINDINGS (5-8): Each is a self-contained insight enriched by KB context
  - Finding headline (specific, not thematic)
  - Episode attribution
  - The claim + KB-enriched analysis (2-3 paragraphs)
  - NGM DEEP ANALYSIS callout (what the knowledge base adds)
QUICK HITS: 3-5 one-liner mentions of other notable moments
WHAT TO LISTEN TO: Top 3 episode recommendations with reasons
```

**What NOT to do:**
- Do NOT group findings into forced themes (e.g., "The Exercise Prescription Is Being Rewritten")
- Do NOT write 4-5 paragraph mini-essays per finding — keep it tight
- Do NOT summarize episodes — extract the single most interesting claim and enrich it
- Do NOT use generic theme headlines — every headline should be specific and surprising

**Output location:** `content/social-content/newsletters/YYYY-MM-DD-podcast-roundup.html` (+ `.json`)

### Regulatory Brief (NEW)
- **Format:** Print-optimized HTML (8.5" × 11", 0.75" margins)
- **Length:** One page (~600-800 words)
- **Diagrams:** 0-1 (tables preferred)
- **Quality rubric:** 12-point regulatory brief rubric
- **Verification:** MANDATORY (--verify auto-enabled)
- **Voice:** Formal, objective, evidence-based

**Structure for regulatory briefs:**
1. **Header** - Document type, subject, key identifiers (MW, sequence, CAS#)
2. **Section 1: Safety Data Summary**
   - Clinical trials (with n, design, key findings)
   - Observational/real-world data
   - Route-specific considerations (table format)
   - Adverse event profile (common/uncommon/rare)
   - Safety signals (Known/Theoretical/Absent)
3. **Section 2: Regulatory Precedent**
   - EMA/non-U.S. approvals
   - Historical FDA position
   - Analogous drug precedents
4. **Section 3: Conclusion**
   - Evidence synthesis
   - Explicit statement of evidence gaps
   - Recommendation with conditions
5. **References** - All with clickable links, peer-reviewed sources only

**Output location:** `content/social-content/newsletters/YYYY-MM-DD-{slug}.html` (+ `.json`)

---

## Example Run

```
User: /ralph-content "How cold exposure affects brown adipose tissue" --type newsletter --verify

You (thinking through each phase):

PHASE 0: CONTEXT
- Reading progress.txt... Previous runs show diagram text overflow was common issue.
  I'll be extra careful with text positioning in diagrams.

PHASE 1: RESEARCH
- Query 1: "cold exposure brown adipose tissue activation mechanisms 2025 2026 studies"
  [WebSearch results with studies]
- Query 2: "BAT thermogenesis UCP1 clinical applications"
  [WebSearch results with mechanism details]
- Evaluating: I have Hanssen et al. 2015, Cypess et al. 2009, specific activation 
  temperatures, and metabolic rate increases. Sufficient for newsletter.

PHASE 2: DRAFT + CRITIQUE
- Writing draft with concrete scenario hook...
- Self-critique against 8 points:
  ✓ Specificity: Named researchers, 17.5°C threshold, 5-15% metabolic increase
  ✗ Evidence cascade: Only 2 studies stacked, need 3+
  ✓ Colon technique: Used 4 times
  ✓ Em-dash clarity: Used for definitions and contrast
  ✓ One-sentence paragraphs: 4 strategic placements
  ✓ Concrete opening: Dr. Cypess case at Joslin
  ✓ Voice: Confident, specific
  ✓ Forward-looking: Ends with implications for metabolic practice
- Revising: Adding Ouellet et al. 2012 to evidence cascade...
- Re-evaluating: All 8 criteria now pass.

PHASE 3: VERIFICATION
- Claim: "Cold exposure at 17-19°C activates BAT"
  [WebSearch confirms - Hanssen et al., Cell Metabolism]
- Claim: "5-15% increase in metabolic rate"
  [WebSearch confirms - multiple sources]
- All key claims verified.

PHASE 4: DIAGRAMS
- Concept 1: BAT activation mechanism (pathway diagram)
  - Generating SVG...
  - Validating: Text at y=350 in 400-height viewBox, with 40px padding = OK
  - Container at height 120 with 3 text lines (75px) + 80px padding = needs 155px, FAIL
  - Regenerating with taller container...
  - Re-validating: Container now 180px, text fits with padding. PASS.
- Concept 2: Cold vs thermoneutral comparison
  - Generating SVG...
  - Validating: All checks pass.

PHASE 5: ASSEMBLY
- Composing email HTML with diagrams embedded...

PHASE 6: PUBLISH
- Saving to content/social-content/newsletters/2026-01-18-cold-exposure-bat.html
- Updating progress.txt with learnings
- Git commit
```

---

## Example: Regulatory Brief Run

```
User: /ralph-content "FDA safety brief for DSIP peptide" --type regulatory_brief

You (thinking through each phase):

PHASE 0: CONTEXT
- Reading progress.txt... Previous regulatory brief run had citation attribution error.
  I'll verify each citation's author/year against PubMed.

PHASE 1: RESEARCH (Extended for regulatory)
- Query 1: "DSIP delta sleep inducing peptide clinical trials safety human studies PubMed"
  [WebSearch returns 4 clinical studies from 1980s-1990s]
- Query 2: "DSIP regulatory approval Russia Deltaran Ministry of Health"
  [WebSearch returns registration info]
- Query 3: "DSIP LD50 toxicity animal studies lethal dose"
  [WebSearch confirms no lethal dose established]
- Evaluating: I have human trial data (n=~200 total), Russian approval, toxicity profile.
  Sufficient for regulatory brief.

PHASE 2: DRAFT + CRITIQUE
- Writing with regulatory brief structure...
- Self-critique against 12-point regulatory rubric:
  ✓ Clinical data with n, design, findings
  ✓ Route-specific table
  ✓ Safety signals categorized (Known/Theoretical/Absent)
  ✓ Regulatory precedent documented
  ✗ Conclusion needs explicit evidence gap statement
- Revising conclusion to explicitly state limitations...
- Re-evaluating: All 12 criteria now pass.

PHASE 3: VERIFICATION (MANDATORY for regulatory_brief)
- Step 3A: Source Credibility Audit
  - Found cosmicnootropic.com in research notes - REJECT (vendor site)
  - Searching for peer-reviewed alternative...
  - Found Popovich et al. 2003 (PMID 12782416) - ACCEPT
- Step 3B: Citation Accuracy Validation
  - Ref [1] claims "Schneider-Helmert 1988" but PubMed 1299794 shows "Bes F et al. 1992"
  - CORRECTING: Update author and year
- Step 3C: Claim Verification
  - Claim: "LD50 never determined" - Verified via Graf & Kastin 1984 review
  - Claim: "97% opiate addicts improved" - Verified via Dick 1984 (PMID 6548969)
- Step 3D: Reasoning Consistency
  - N/A for single document (check if creating related briefs)

PHASE 4: DIAGRAMS
- Regulatory briefs use tables, not diagrams. Skipping.

PHASE 5: ASSEMBLY
- Composing print-optimized HTML with NGM styling...

PHASE 6: PUBLISH
- Saving to content/social-content/newsletters/2026-01-27-fda-safety-brief-dsip.html
- Creating JSON metadata file
- Updating progress.txt with citation validation learning
- Git commit
```

---

## Quality Over Speed

This skill prioritizes quality over speed. It's acceptable to:
- Run 4-5 research queries if needed
- Iterate on content 3+ times
- Regenerate diagrams multiple times
- Take the time to verify claims

The goal is content that meets Every.to editorial standards—content the team would be proud to publish.

---

## JSON Schema for Content Pipeline

**CRITICAL:** All content must be saved as JSON files to appear in `/content-pipeline`. The content-pipeline API reads JSON files from content directories.

### LinkedIn Post JSON Schema

```json
{
  "id": "unique-id",
  "createdAt": "2026-01-22T17:30:00.000Z",
  "content": "The full post text with\n\nline breaks preserved...",
  "meta": {
    "alphaIdea": "Short summary used as title in content pipeline",
    "hookType": "curiosity|stakes|contrarian|pattern",
    "wordCount": 195,
    "targetAudience": "longevity medicine professionals"
  },
  "quality": {
    "iterations": 1,
    "passed": true,
    "scores": {
      "pattern_interrupt": true,
      "hook_under_150_chars": true,
      "creates_curiosity": true,
      "has_clear_thesis": true,
      "uses_line_breaks": true,
      "avoids_wall_of_text": true,
      "follows_hook_expand_close": true,
      "has_specific_numbers": true,
      "avoids_jargon": true,
      "has_original_insight": true,
      "stays_focused": true,
      "has_subtle_cta": true,
      "paragraphs_punchy": true,
      "intellectually_honest": true
    }
  },
  "status": "draft",
  "images": []
}
```

**Required fields for display:**
- `id` - Unique identifier
- `createdAt` - ISO 8601 timestamp (used for sorting)
- `content` - Full post text
- `meta.alphaIdea` - **Used as title in content pipeline**
- `quality.passed` - Boolean for quality badge
- `quality.iterations` - Number for iteration count
- `quality.scores` - Object with individual rubric scores

### Newsletter JSON Schema

```json
{
  "id": "unique-id",
  "createdAt": "2026-01-22T17:30:00.000Z",
  "title": "The Newsletter Title",
  "subtitle": "Optional subtitle shown in preview",
  "textContent": "## Full markdown content\n\nWith all sections...",
  "hasHtmlContent": true,
  "status": "draft",
  "meta": {
    "format": "research_synthesis|ai_in_clinic_playbook|deep_dive",
    "length": "short|medium|long",
    "wordCount": 680,
    "estimatedReadTime": 3,
    "targetAudience": "longevity medicine professionals"
  },
  "quality": {
    "iterations": 1,
    "passed": true,
    "scores": {
      "specificity_check": true,
      "evidence_cascade_present": true,
      "colon_technique_used": true,
      "em_dash_clarity": true,
      "one_sentence_emphasis": true,
      "concrete_over_abstract": true,
      "voice_authenticity": true,
      "forward_looking_conclusion": true
    }
  }
}
```

**Required fields for display:**
- `id` - Unique identifier
- `createdAt` - ISO 8601 timestamp
- `title` - **Used as title in content pipeline**
- `textContent` - Full markdown content (shown in Markdown view)
- `hasHtmlContent` - Set to `true` if HTML file exists (enables preview iframe)
- `quality.passed`, `quality.iterations` - For quality badge

**Note:** The HTML file must have the same base filename as the JSON for the preview iframe to work.

### Lead Magnet JSON Schema

The content pipeline supports **two formats**. Use the **new format** for all new content.

#### New Format (Recommended)

```json
{
  "id": "unique-slug",
  "createdAt": "2026-01-22T17:30:00.000Z",
  "title": "The Lead Magnet Title",
  "subtitle": "Optional subtitle",
  "slug": "unique-slug",
  "sections": [
    {
      "title": "Section Title",
      "content": ["paragraph 1", "paragraph 2"]
    }
  ],
  "unexpectedDiscoveries": [
    "Discovery 1",
    "Discovery 2"
  ],
  "frameworks": [
    {
      "name": "Framework Name",
      "description": "Framework description"
    }
  ],
  "references": [
    {
      "title": "Reference title with authors and journal"
    }
  ],
  "accessKeyword": "OPTIONAL_KEYWORD"
}
```

#### Legacy Format (Still Supported)

```json
{
  "id": "unique-id",
  "title": "The Lead Magnet Title",
  "slug": "unique-slug",
  "created_at": "2026-01-22T00:00:00.000Z",
  "keyword": "KEYWORD",
  "key_findings": [
    { "finding": "Finding text", "source": "Source citation" }
  ],
  "mechanisms": [
    { "mechanism": "Mechanism name", "clinical_takeaway": "Clinical takeaway" }
  ],
  "references": ["Reference 1 as string", "Reference 2 as string"]
}
```

**Required fields for display:**
- `id` - Unique identifier
- `createdAt` OR `created_at` - ISO 8601 timestamp
- `title` - **Used as title in content pipeline**

**Content fields (use one set):**
- New: `sections`, `frameworks`, `unexpectedDiscoveries`
- Legacy: `key_findings`, `mechanisms`

**References:** Supports both `[{title: "..."}]` and `["string"]` formats

**Keyword:** Supports both `accessKeyword` and `keyword`

**Note:** The "View HTML Lead Magnet" button always appears for lead magnets (HTML file must exist with same base name as JSON).

**Diagram PDF Export:** Lead magnets support diagram-only PDF export via the "Download Diagram PDF" button. Features:
- **Cover page** with scroll-stopping hook (auto-generated from title), Cormorant Garamond/serif typography, and NGM branding
- **Access keyword** displayed prominently with "Comment below to get the full analysis" CTA—auto-generated from title if not provided in JSON (`accessKeyword` or `keyword` field)
- **One diagram per page**, scaled to maximize page real estate
- **JPEG compression** for small file sizes (~300-400KB)
- **LinkedIn carousel optimized**: landscape orientation, swipe hint, visual hierarchy

The hook is auto-generated using pattern matching on the title/subtitle (e.g., "What 30+ Top Researchers Agree On" for consensus topics, "The Shift Nobody Saw Coming" for revolution topics).

### Instagram Script JSON Schema

```json
{
  "id": "unique-id",
  "createdAt": "2026-01-22T17:30:00.000Z",
  "meta": {
    "topic": "Short topic used as title"
  },
  "script": {
    "hook": "First 3 seconds text",
    "body": "Main content of the script...",
    "cta": "Call to action text",
    "totalDuration": 45
  },
  "quality": {
    "passed": true
  }
}
```

**Required fields for display:**
- `id` - Unique identifier
- `createdAt` - ISO 8601 timestamp
- `meta.topic` - **Used as title in content pipeline**
- `script.hook`, `script.body`, `script.cta`, `script.totalDuration`
- `quality.passed` - Boolean for quality badge

---

## Files

### Output Locations
- Newsletters: `content/social-content/newsletters/` (both `.html` AND `.json`)
- Lead Magnets: `content/learn-platform/lead-magnets/` (both `.html` AND `.json`)
- LinkedIn: `content/social-content/linkedin-posts/` (`.json` only)
- Instagram: `content/social-content/instagram-scripts/` (`.json` only)

### API Endpoints
- View Lead Magnet HTML: `GET /api/lead-magnet-html/[slug]`
- Download Diagram PDF: `GET /api/lead-magnet-diagrams-pdf/[slug]` - Generates LinkedIn-optimized PDF with cover page + diagrams (uses puppeteer + jspdf)

### Learning Persistence
- Progress: `.ralph-content/progress.txt`

### Context (Read at Start)
- `context/every-voice-patterns.md` - Voice patterns and techniques
- `context/quality-rubrics.md` - All quality criteria
- `context/diagram-guidelines.md` - SVG generation rules
- `context/ngm-style-guide.md` - Brand and HTML templates
