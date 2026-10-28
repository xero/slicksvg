# Agent Instructions

Development contract for AI-assisted work on this repo. Read in full
before starting any task.

---

## What This Project Is

SlickSVG is a split-screen SVG editor for the browser: the code on one
side, a live preview to draw on on the other, both editing the same
drawing. It is vanilla TypeScript with no frontend framework, and it
builds to one self-contained HTML file. It is built tablet first, for an
iPad with a pencil.

- Live editor: <https://xero.github.io/slicksvg/>
- Features, project structure, and architecture: [README.md](./README.md)
- Test setup and CI: [TESTING_GUIDE.md](./TESTING_GUIDE.md)

---

## Ground Rules

- **Work on a feature branch.** Never commit, push, or merge to `main`
  without the owner's approval. A push to `main` deploys GitHub Pages.
- **One commit per feature or fix**, with its tests and its README
  update. Leave unrelated changes, including the owner's, out of it.
- **The code is the truth.** Every edit in the preview is written to
  the code as a change to that element's own attributes, one undo step.
  The preview and the code never disagree.
- **Pure modules stay pure.** Everything in `src/` but `app.ts` has no
  side effects and no runtime dependencies, and is unit tested. Put new
  logic there where it fits; `app.ts` is the DOM wiring.
- **Client side only.** No network requests, telemetry, or runtime CDNs.
  The preview sets `innerHTML` to the user's own code: never render SVG
  from anywhere else that way, never `eval`, and never add a path that
  runs code from a drawing.
- **No new dependency** without the owner's say. Workflow actions stay
  pinned to commit SHAs; update them with `actions-up`.

---

## Build & Test

```sh
bun i                                             # install
bun run lint                                      # ESLint, strictTypeChecked
bunx tsc --noEmit -p . --ignoreDeprecations 6.0   # type check (vite and eslint skip it)
bun run check                                     # unit tests; deletes dist/
rm -rf dist && bun run build                      # build to dist/index.html
bun run test:e2e                                  # e2e against vite preview on :4173
```

### Running tests during iteration

```sh
bunx vitest run tests/x.test.ts
bunx start-server-and-test preview http://localhost:4173 "bunx playwright test e2e/x.spec.ts --reporter=line --workers=4 --retries=0"
```

- `bun run check` deletes `dist/`: build again before e2e.
- Never run two e2e runs at once; they share `dist/` and port 4173.

---

## Code Style

- **Tabs in `src/`**, and `=>` with no spaces round it. Tests in
  `tests/` and `e2e/` use two spaces.
- **Unix line endings.**
- **Match the code around you**: its naming, idiom, and comment density.
- **No comments that restate code**: comments explain *why*, not *what*.
- **NEVER use emdashes or endashes**: rewrite the sentence or use
  different punctuation. Ranges use a regular hyphen.
- **Spec citations in source**: cite the section. Example:
  `// SVG 2 §9.3.9, path data grammar`; use `§` as the section symbol.
- **Exports are the public contract**: a module exports only what
  another module calls.
- **Lint is `strictTypeChecked`**: no non-null `!`, no `??` or `?.` on
  types that cannot be nullish (use `.at()`). Run `tsc` yourself.
- **Run `bun run lint:fix` before committing**; lint errors aren't the
  reviewer's problem.

---

## Definition of Done

A task is complete when **all** are true:

1. Lint, the type check, the unit tests, a fresh build, and the full
   e2e suite pass locally
2. It has tests: unit for logic, e2e for what a user sees and does
   (on touch where touch is involved)
3. It works in light and dark, side by side and stacked, at tablet width
4. Its controls are named, reachable by the keys, and announced
5. The README says what it does
6. It is committed alone, pushed, and green on CI

---

## Raising an Issue

**Never guess. Never hallucinate a value, a spec behavior, or an API
decision.**

If any of these are true:

- Can't find an authoritative source for a value you need
- Test failing and you can't tell whether the bug is in the
  implementation, the test, or your understanding of the spec or the
  browser's behavior
- Two authoritative sources contradict each other
- Task as written is ambiguous and proceeding requires an assumption
  you aren't confident in
- More than two failed attempts at the same problem
- Anything else where the honest answer is "I am not sure"

**Stop. Don't guess. Don't proceed. Raise an issue.**

Two failed attempts is the limit. The third is guessing. Create
`ISSUE.md` at the repository root:

```markdown
# Issue, [short title]

## Status
Blocked. Implementation work stopped at [file / function / test].

## What I was trying to do
[The specific task or step that hit the blocker]

## What I tried
[Each attempt, in order, with the result. Be specific: error messages,
wrong output values, what you expected instead.]

## Where I am stuck
[The specific question, ambiguity, or failure I cannot resolve.
If a spec section is involved, name it.]

## What I need from you
[The specific information, clarification, or decision that would
unblock me.]

## Relevant files
[Source files, test files, docs to look at]

## Relevant spec sections
[Spec sections that are ambiguous, contradictory, or inaccessible]
```

Stop all work and present the issue. A detailed issue that stops work
cleanly is far more valuable than a completed task built on a guess.

---

## When Stuck (Before Raising an Issue)

- **e2e fails but the feature works**: most common causes are a stale
  or missing `dist/`, another run on port 4173, a colour read mid
  transition (poll instead of waiting), and an SVG `<line>` whose box
  has no height (press it with `page.mouse` at drawing coordinates).
- **Passing tests, wrong output**: verify expecteds came from the SVG
  spec or a browser's rendering, not from the implementation.
- **Conflict between files**: this file > README.md > task
  instructions > any other file. Raise conflicts rather than resolving
  silently.
- **Uncertainty about a decision**: check the README's Architecture
  section. If not covered, raise an issue rather than deciding
  unilaterally.
