# Build V1 of the Fractions Practice app for Andrew

## Context

### Source of truth
The V1 spec lives in `docs/seed.md`. Captures: problem (Andrew, 10, autistic, homeschooled, confuses numerator/denominator on Saxon 4/5 Lesson 77), product vision (concept-bridging tool across 4 linked representations), scope boundary, tech stack, and a list of open questions for planning.

### Repo state
Greenfield — only `docs/seed.md`, `eforge/config.yaml`, `.gitignore`, `.git/`. No code, no scaffolding, no `CLAUDE.md`, no roadmap. Planning output will drive the initial scaffold.

### Pedagogical core (from seed)
- **Four linked representations**: visual (shaded shape with labeled denominator), word form ("3 out of 8 equal parts"), division form ("3 ÷ 8 = 0.375"), number line (where the fraction sits between 0 and 1).
- **Translation mechanics** between representations are the learning mechanism — not drilling, not discovery.
- **Pattern-first, not abstraction-first** — explicit rules shown as rules, not discovered.

### Platform / constraints (from seed)
- iPad-first, landscape, PWA via "Add to Home Screen", single user (Andrew), no auth, no backend, localStorage for state.
- Tech: Next.js 15 App Router + Tailwind + shadcn/ui + TypeScript. Bun as package manager. Vercel hosting at `fractions.markschaake.com`.
- 44pt min tap targets, drag interactions, no hover states, autism-aware UX (consistent formatting, explicit rules, immediate feedback, low sensory load).

### Open questions flagged in the seed (to resolve in planning)
- Session length / questions-per-session
- Streak/celebration mechanics — use or skip?
- Color palette + sensory preferences
- Problem-set shape: hand-curated JSON vs. parameterized generator
- Success metric — what does "Andrew is getting it" look like?
- Error recovery on translation questions — retry or move on?

## Scope

### In Scope

- **Four representations**, rendered consistently across the app:
  - Visual: shaded shape with total parts labeled explicitly.
  - Word form: "N out of D equal parts."
  - Division form: "N ÷ D = 0.xxx" (passive display only — see below).
  - Number line: slider position between 0 and 1.
- **Three translation question types** (V1):
  1. Visual → fraction (type numerator/denominator).
  2. Fraction → number line (drag slider).
  3. Word form → visual (pick the matching shape).
- **Division form as passive display** — never a question, always revealed alongside a correct answer so Andrew sees the link without needing to compute.
- **Always-available rule panel** — explicit rule text ("numerator = shaded parts on top; denominator = total equal parts on bottom"), visible or one-tap-accessible on every question screen.
- **Session flow**: landing → problem sequence → end-of-session summary.
- **End-of-session summary** — predictable completion screen showing what was done.
- **Local progress tracking** via localStorage.
- **PWA shell**: manifest + icons, Add to Home Screen on iPad produces fullscreen launch.
- **Deploy** to `fractions.markschaake.com` on Vercel.

### Out of Scope (V1)

- Mixed numbers, improper fractions, equivalent fractions, fraction arithmetic.
- Other math topics.
- Auth, multi-user, family sharing, cross-device sync.
- Backend, database.
- LLM-generated problems.
- Adaptive difficulty.
- Progress reports for Caitlin.
- Offline support via service worker (only the PWA install shell).
- Additional question-type directions (fraction→word, word→fraction, visual→slider, etc.) — deferrable to V2.

## Code Impact

Greenfield — initial module layout defines the code impact. Tech stack is fixed by seed: Next.js 15 App Router, TypeScript, Tailwind, shadcn/ui, bun.

### Module layout

```
src/
├── app/
│   ├── layout.tsx              # Root layout
│   ├── page.tsx                # Landing / start-session screen
│   ├── session/page.tsx        # Single-page session player (problem → feedback → next)
│   └── globals.css             # Tailwind + app-level tokens
├── components/
│   ├── representations/
│   │   ├── VisualFraction.tsx  # Shaded shape with labeled denominator
│   │   ├── WordFraction.tsx    # "N out of D equal parts"
│   │   ├── DivisionFraction.tsx # "N ÷ D = 0.xxx" (passive display only)
│   │   └── NumberLine.tsx      # Slider (draggable or static)
│   ├── questions/
│   │   ├── VisualToFraction.tsx
│   │   ├── FractionToNumberLine.tsx
│   │   └── WordToVisual.tsx
│   ├── rule-panel/RulePanel.tsx    # Always-available rule reminder
│   ├── feedback/AnswerFeedback.tsx # Correct/incorrect + all-4-representations reveal
│   ├── session/
│   │   ├── SessionSummary.tsx
│   │   └── ProgressIndicator.tsx
│   └── ui/                     # shadcn components
├── lib/
│   ├── problems/
│   │   ├── problem-set.ts      # Hand-curated TS const (not JSON — type-safe)
│   │   ├── types.ts            # Problem, QuestionType, Answer types
│   │   └── session-builder.ts  # Pick N problems for a session
│   ├── storage/progress.ts     # localStorage read/write wrapper
│   └── utils.ts
public/
├── manifest.json               # PWA manifest
└── icons/                      # iPad home-screen icons (various sizes)
```

### Key observations

1. **Representations vs. questions are separate.** Representation components render; question components compose representations with interaction. Keeps the linking structure visible in the code.
2. **Division form is passive-only** — `DivisionFraction` is only used inside `AnswerFeedback`, never in a question.
3. **Problem set is a TypeScript const** — not JSON — to get type safety on each entry for free.
4. **No tests in V1.** Andrew's feedback is the validation. TypeScript + manual browser testing only.
5. **No state management library** — React state + a thin localStorage wrapper.
6. **Session is a single page** — all problems render in place, state transitions advance the view. No per-problem routes.

## Architecture Impact

Greenfield — no existing architecture to disrupt. V1 does, however, set up patterns V2 will inherit. Worth capturing the commitments explicitly.

### Commitments V1 locks in

1. **Client-only data flow.** No backend, no API routes. All state in browser (React + localStorage). V2 features like Caitlin progress reporting or LLM-generated problems will require introducing a backend; V1 doesn't block that, just doesn't open the door.
2. **Representation component contract.** All representations share a `{ numerator, denominator, mode }` prop shape. V1's narrow shape is fine; V2 representations (equivalent fractions, mixed numbers) will generalize it.
3. **Problem schema as content/code boundary.** The `Problem` type in `lib/problems/types.ts` is the contract between content and code. If V2 moves to LLM-generated problems, that generator emits this type — designing it carefully now pays off.
4. **Versioned localStorage keyspace.** All V1 state under `fractions-practice:v1:*` (e.g., `fractions-practice:v1:progress`). Versioning is free insurance for future migration.
5. **PWA shell, not offline app.** Manifest + icons ship in V1; no service worker. Page must be online-reachable to open. V2 candidate: SW-based offline with explicit cache strategy.

### Non-commitments (explicitly deferred)

- V2 data sync strategy — revisit if/when Caitlin reporting is added.
- Problem generation approach — hand-curated now, LLM-generated deferred.

## Design Decisions

### Session shape

1. **Session length = fixed problem count (10 problems), not a timer.** Rationale: a countable finish line is more predictable and less anxiety-inducing for Andrew than a wall-clock deadline. Configurable via constant.
2. **Deterministic rotation through the three question types, not randomized order.** Rationale: predictability supports autism-aware UX and guarantees balanced exposure to all three types each session.

### Problem authoring

3. **~40 hand-curated problems in a TS const.** Rationale: enough variety that consecutive sessions don't feel identical; small enough to curate carefully by hand; type-safe.
4. **Denominator range 2–10.** Rationale: covers Saxon 4/5's working range (halves through tenths); large denominators don't render cleanly in the visual representation.
5. **Proper fractions only (N < D).** Rationale: V1 concept is "parts of a whole" — improper fractions are a V2 concept.
6. **Random draw without replacement within a session.** Rationale: different 10 each session, no repeats within a session, no adaptive difficulty (deferred).

### Feedback & error recovery

7. **One retry on incorrect, then reveal and advance.** Rationale: second attempt is pedagogically valuable; a third attempt risks frustration. After retry-fail, the 4-representation reveal is the teaching moment.
8. **Quiet positive feedback on correct.** Checkmark + subtle green + optional soft chime. No confetti, no loud language, no mid-session streak counter. Rationale: autism-aware — celebration that's predictable and proportional, not activating.
9. **Non-alarming incorrect feedback — muted amber, not red.** Short gentle message; no emotional loading. Rationale: red is overweight; Andrew should experience a wrong answer as information, not as a problem.
10. **Answer reveal shows all four representations of the same fraction, visually linked, with the rule panel highlighted.** Rationale: this IS the teaching mechanism — the bridge moment is the entire point of the app.

### Visuals & sensory

11. **Single visual shape: rectangle divided into equal vertical strips, shaded left-to-right.** Rationale: rectangles scale to any denominator (circles degrade past ~8 slices); consistency > variety for autism-aware UX; vertical strips relate cleanly to horizontal number line. No mixing of shape types.
12. **Low-saturation palette.** Near-white background, near-black ink, deep teal accent for shading, muted green (correct), muted amber (not-quite). High contrast, low sensory load.
13. **Near-zero animation.** Instant transitions. Exception: slider knob moves because the user moves it. No fades, no slides, no decorative motion.
14. **Sound muted by default, user-toggleable.** A soft chime on correct only. Nothing on incorrect.

### Rule panel

15. **Persistent rule panel — always visible on every question screen, top of screen, fixed position.** Rationale: pattern-first teaching means the rule is a constant companion, not a stashed helper.
16. **Rule panel wording: "Top number = shaded parts / Bottom number = total equal parts."** "Numerator" and "denominator" appear only as secondary labels. Rationale: give him the pattern in plain language first; jargon is a label for a concept he already knows, not the primary name of the concept.

### Success metric

17. **Success measured by observation + simple per-session correct-count in localStorage.** "Getting it" heuristic: visual→fraction correct on first try ~80%+ across sessions. No formal dashboard or reporting in V1. Rationale: Mark can observe directly; data is stored in case deeper analysis is wanted later; no scope creep into reporting features.

## Documentation Impact

### Docs to create with V1

- **`CLAUDE.md`** (project root) — Project overview, tech stack, dev commands (`bun dev`, `bun run build`, `bun run typecheck`), localStorage key namespace (`fractions-practice:v1:*`), problem-set location. First file future Claude Code sessions read.
- **`README.md`** (project root) — Public-facing: what the app is, who it's for, 4-representation thesis, deployed URL once live.
- **`docs/problem-authoring.md`** — Short guide for adding/editing problems in `lib/problems/problem-set.ts`: the `Problem` type, constraints (denominators 2–10, proper fractions only), how rotation uses them.

### Docs NOT created

- **`docs/architecture.md` / ADRs** — V1 too small; architectural commitments live in `CLAUDE.md`. Revisit if V2 adds backend or sync.
- **API docs** — no API.
- **`CONTRIBUTING.md`** — single-author project.

### Docs left as-is

- **`docs/seed.md`** — historical V1 spec, archival, not updated.

### Explicitly out of V1 delivery

- **Blog post** for `markschaake.com` — separate writing task, not part of the eforge build.

## Risks & Edge Cases

### Build / implementation

1. **PWA install UX on iPad is manual.** Share → Add to Home Screen is not a flow Andrew will drive. Mark installs it once; no fancy install prompt needed.
2. **Landscape orientation lock only works post-install.** iOS Safari ignores `screen.orientation.lock()` outside fullscreen. **Mitigation:** layouts degrade gracefully to portrait; show a gentle "rotate your iPad" hint when portrait is detected AND app is not installed.
3. **Slider dragging on iPad — touch interaction.** Native `<input type=range>` has a too-small knob for a 10-year-old. **Mitigation:** custom slider with ≥44pt knob using pointer events (covers touch + mouse).
4. **Number-line slider snaps to ticks at the problem's denominator.** Decision: snap, not continuous. Rationale: fractions are discrete at this level; snapping removes floating-point fuzziness from answer-checking and matches the conceptual model.
5. **localStorage unavailable in Safari private mode.** Not a realistic case for Andrew's installed PWA. Noted, not mitigated.
6. **Hand-curated problem set typo risk.** **Mitigation:** a `problem-set.validate.ts` runs constraint checks (denominator 2–10, numerator < denominator, no dupes) at module load; build fails on violation. Cheap footgun eliminator.

### Pedagogical

7. **"All four representations at once" on answer reveal may overload Andrew.** Ship as spec'd, observe, revisit in V2 with staggered reveal if needed.
8. **Deterministic question-type rotation may become dull.** Ship as spec'd, observe, revisit if needed (V2 could shuffle the rotation order per session while staying balanced).
9. **40 hand-curated problems is thin for extended daily use.** Authoring is cheap — adding more is just edits to `problem-set.ts`. Not a blocker.
10. **Wrong-answer messages must be per-question-type, not global.** Decision: per-type. "The bottom number is the total equal parts" fits visual→fraction; it doesn't fit fraction→slider. Each question type gets its own short gentle retry message.

### Deploy / ops

11. **DNS setup for `fractions.markschaake.com`.** CNAME on Mark's DNS → Vercel. Explicit step in the build; don't let it surprise at deploy time.
12. **Apple PWA icon sizing.** iPad needs the full Apple icon set (180×180 minimum + maskable variants). Tedious but straightforward; budget for it.

### Silent

13. **No analytics, no error reporting, no crash tracking.** By design (no backend). Mark observes; Andrew tells him if something's broken.

## Profile Signal

**Recommendation: `expedition`.**

Rationale: V1 is a greenfield full-stack build spanning multiple independent subsystems:

1. Project scaffolding (Next.js, Tailwind, shadcn, TS, bun setup)
2. Four representation components with shared contract
3. Three question-type components composing representations
4. Session player / flow / end-of-session summary
5. Rule panel + feedback system (per-type messages + 4-representation reveal)
6. Hand-curated problem-set authoring + build-time validator
7. localStorage progress layer (versioned keyspace)
8. PWA manifest + icon set
9. Deploy pipeline (Vercel + DNS)

Nine subsystems with real interdependencies (representations → questions → session → feedback; problem set → question rendering → progress). Excursion would flatten this into a single plan; expedition lets it decompose into coherent modules that can be planned and built in parallel waves.
