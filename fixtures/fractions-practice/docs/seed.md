# Fractions Practice — Seed Doc

Context handoff for a new Claude Code session that will run `/eforge:plan` to produce the real build plan. This doc captures everything decided so far; the planning session is the next step.

---

## The problem

Andrew (my son, 10, autistic, homeschooled) is on Saxon Math 4/5 Lesson 77.

- **Long division:** solid.
- **Fractions:** confuses numerator and denominator. Understands fractions-as-division (3/8 = 3÷8). Does *not* grasp "denominator = the number of equal parts that make a whole."

Autism context: strong pattern-seeker. Jumps to applying patterns before internalizing the abstraction. The design principle that falls out of this:

**Don't teach the abstraction. Give him the explicit pattern directly, and let him triangulate the concept by moving between multiple linked representations.**

---

## Product vision

A **concept-bridging tool** — *not* a drill generator. For a target concept (V1: fractions), show the *same* example across four linked representations simultaneously:

1. **Visual** — a shape divided into parts. Numerator = shaded regions. Denominator = total equal parts (labeled explicitly).
2. **Word form** — "3 out of 8 equal parts."
3. **Division form** — "3 ÷ 8 = 0.375."
4. **Number line** — where 3/8 sits between 0 and 1.

Then have Andrew *translate between representations*:
- "Here's the visual. Type the fraction."
- "Here's 3/8. Drag the slider to show where it sits between 0 and 1."
- "Here's the word form. Pick the matching visual."

The multi-representation linking is the mechanism. Explicit rules (numerator = shaded parts on top, denominator = total parts on bottom) are shown *as rules*, not as discoveries for him to make.

---

## V1 scope boundary

- **Just fractions.**
- **Just numerator/denominator understanding.**
- Not a general math app. Not a Saxon companion. Not Kimble reborn.
- One abstraction, nailed. If V1 works, the template generalizes to the next stuck concept (likely something around Saxon Lesson 90+).

---

## Design constraints

- **Autism-aware UX:** consistent formatting, explicit rules, immediate feedback, low sensory load, predictable layouts.
- **iPad-first** (Andrew's homeschool device). Landscape orientation.
- **Big tap targets** (44pt min, Apple guideline).
- **Drag interactions** for the number-line representation — works beautifully on touch.
- **No hover states.** Tap/drag only.
- **Single user** — Andrew. No auth, no accounts.

---

## Tech stack

- **Next.js 15** (App Router) — Mark's default, familiar.
- **Tailwind + shadcn/ui** — familiar.
- **No backend for V1** — pure client-side.
- **localStorage** for progress/session state.
- **PWA** — `manifest.json` + icons. "Add to Home Screen" on iPad gives fullscreen app-like launch.
- **Vercel** hosting. Subdomain of `markschaake.com` (e.g., `fractions.markschaake.com`).

### Explicit non-choices for V1

- No database, no Supabase.
- No LLM-driven problem generation (V2 candidate). V1 uses a handcrafted problem set.
- No service worker / offline support (V2 candidate).
- No native iOS app. PWA is the install story.

---

## Content / narrative angle

The project doubles as an eforge flagship demo. Blog post lives on `markschaake.com` once shipped:

> *"My autistic son doesn't grasp 'equal parts of a whole.' I built him a fraction bridge in a weekend with eforge. Here's what I learned about teaching and agentic engineering."*

Target reader: parents of neurodivergent kids (natural organic reach) + engineers watching eforge (thesis demo). Shipping it matters more than polishing it.

---

## Install story (for reference)

Andrew's path to "open the app":

1. Safari on iPad → navigate to `fractions.markschaake.com`
2. Tap share icon → "Add to Home Screen"
3. Icon on home screen, launches fullscreen, looks/feels like a native app

No store, no account, no Apple Developer Program.

---

## Next steps

1. **Start a new Claude Code session** in this repo (`~/projects/markschaake/fractions-practice`).
2. **Run `/eforge:plan`** to begin a structured planning conversation.
3. **Planning session outputs** (goal):
   - Screen-level user flow (landing → problem → feedback → next)
   - Question-type taxonomy (visual→fraction, fraction→slider, word→visual, etc.)
   - Data model (localStorage key shape, progress tracking, session state)
   - Scoring / feedback model — what Andrew sees on correct/incorrect
   - Problem-set authoring approach (hand-curated JSON for V1)
   - Accessibility/sensory spec (color palette, contrast, animation policy, sound)
   - Deployment plan (Vercel project setup, subdomain, PWA manifest)
   - An eforge-ready PRD that a harness can actually build from

---

## Open questions for the planning session

- How many questions per session? What's the right cognitive-load target?
- Session length target — 15 minutes? Or "do X problems"?
- Should the app celebrate streaks, or stay neutral? (Autism-dependent — some kids love streak mechanics, others find them stressful.)
- Color palette / high-contrast mode — does Andrew have sensory preferences to design around?
- V1 problem-set approach: hand-curated JSON (simpler, fine for V1), or parameterized generator (more flexible)?
- How do we know Andrew is getting it? What's the success metric — completion? Speed? Self-reported "I get it"? Teacher (Mark/Caitlin) observation?
- Error-handling for translation questions — does he get another try, or move on and revisit later?

---

## Out of scope (V1)

- Auth, multi-user, family sharing.
- Backend, database, sync across devices.
- Mixed numbers, improper fractions, fraction arithmetic.
- Other math topics (decimals, percents, etc.).
- Progress reporting for Caitlin (V2 candidate).
- LLM-generated problems (V2 candidate).
- Offline support via service worker (V2 candidate).
- Adaptive difficulty (V2+ candidate).
