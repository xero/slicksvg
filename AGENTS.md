# AGENTS.md

The contract for all AI-assisted work on SlickSVG. Every rule here applies to every session.

## About the project

SlickSVG is a split-screen SVG editor for the browser: the code on one side, a live preview on the other, and both edit the same drawing. It is written in vanilla TypeScript with DOM APIs, with no frontend framework, and builds to one self-contained HTML file. The live editor is at <https://xero.github.io/slicksvg/>.

The preview is a drawing surface, not just a viewer. It offers:

- **Select:** move, resize, turn, flip, clone, and delete elements.
- **Points:** edit the anchors and handles of paths, polygons, polylines, and lines.
- **Shapes:** draw rectangles, circles, ellipses, lines, polylines, polygons, and paths with a pen tool.
- **Paint:** set fill, stroke, stroke width, and paint order.

It is built tablet-first: iPad with Apple Pencil and touch, then desktop, then phones.

## Ground rules

- **Branches:** work on a feature branch. Never commit, push, or merge to `main` without the owner's explicit approval. A push to `main` deploys GitHub Pages.
- **Commits:** make one commit per feature or fix. Each carries its unit and e2e tests and its README update. Leave unrelated changes, including the owner's, out of your commits.
- **The source is the truth:** every edit in the preview is written into the code as a change to that element's own attributes, and undoes in one step. Never let the preview and the code disagree.
- **Report results faithfully:** if a test fails or a step was skipped, say so with the output.
- **Ask, don't guess,** when a choice is the owner's: a visible behaviour, a design trade-off, or a new dependency.

## Commands

```sh
bun i                                      # install
bun run dev                                # dev server
bun run lint                               # ESLint, strictTypeChecked
bunx tsc --noEmit -p . --ignoreDeprecations 6.0   # type check; vite and eslint do not
bun run check                              # unit tests (Vitest); deletes dist/
rm -rf dist && bun run build               # single-file build to dist/index.html
bun run test:e2e                           # Playwright against `vite preview` on :4173
```

A single e2e spec, run against the preview server:

```sh
bunx start-server-and-test preview http://localhost:4173 "bunx playwright test e2e/x.spec.ts --reporter=line --workers=4 --retries=0"
```

Gotchas:

- `bun run check` deletes `dist/`, so build again before e2e, and before handing a build over for testing.
- Never run two e2e runs at once. They share `dist/` and port 4173, and one breaks the other.
- Watch CI with `gh run list --workflow test.yml --branch <branch> --limit 1`, then `gh run watch <id> --exit-status`.

## Code style

- **Indentation:** `src/*.ts` uses tabs, and arrow functions are written `=>` with no spaces round them, as ESLint enforces. `tests/` and `e2e/` use two spaces.
- **Lint and types:** lint is `strictTypeChecked`. No non-null `!`, and no `??` or `?.` on types that cannot be nullish; use `.at()` for indexing. Run `tsc` yourself, because a missed key in a typed record has slipped past both vite and eslint before.
- **Comments:** doc comments say what a thing is for and why, in full sentences, at the density of the code around them. Write code that reads like the code beside it: match its naming and idiom.
- **CSS:** styles live in `src/theme.css`, in Tailwind 4 with `@apply`. Colours are tokens in `@theme`, redefined under `.dark`. CodeMirror injects its styles outside any cascade layer, so overrides of them need `!` utilities.
- **UI copy:** button labels are short (Clone, Clean, Turn, Rect, Width) so a button stays near 44px wide. Labels are normal weight, not bold.

## Architecture

```
src/
├── app.ts          # The app: the editor, preview, toolbars, gestures, and every tool
├── source-map.ts   # Tag scanning, attribute-level edits, stamping preview elements with source ordinals
├── geometry.ts     # Move, resize, rotate, and flip planners, and matrix maths
├── path-data.ts    # Path and polygon point editing, through one plan engine
├── shapes.ts       # Basic shapes as path data, one way (To path)
├── draw.ts         # New shapes: their geometry, markup, and how the pen paints them
├── paint.ts        # Reading and writing fills, strokes, and styles
├── select.ts       # Picking in the preview, group walking, and box geometry
├── view.ts         # Pan and zoom about a point, wheel and pinch maths
├── xray.ts         # The element under the editor's cursor
├── theme.css       # Styles
└── index.html      # The page
```

Constraints:

- **Pure modules stay pure:** everything but `app.ts` is free of side effects and has no runtime dependencies, so it can be unit tested. Keep it that way, and put new logic in a pure module where it fits. `app.ts` holds the DOM wiring, which e2e tests cover.
- **Edits are text changes:** `planAttributeEdits` and its siblings change only the characters that need to change, so the code keeps its formatting. Each edit is one CodeMirror transaction, one undo step via `isolateHistory`, unless it joins a run on purpose.
- **The preview is drawn from the code:** it is rendered again from the code after every change. Its elements are stamped with source ordinals, and the selection is kept by ordinal, so it survives a re-render.
- **Toolbars:**
  - One app bar runs across the top: menus, Clean and X-ray, the modes, Undo and Redo, and zoom.
  - The drawing's strip at the foot of the preview holds the current mode's tools and the paint tools.
  - The code's strip holds a validity icon and the app's single message line (`say`, `readOut`, `restoreHint`).
- **Touch is first class:**
  - Targets are at least 44px.
  - A touch on a bar while the pencil is down is treated as a resting palm.
  - Two fingers pinch and pan.
  - The native colour picker is laid over the Fill and Stroke tools.
- **No frameworks and no runtime CDNs:** the build inlines everything into `dist/index.html`.

## Security

- **Client side only:** SlickSVG makes no network requests, has no accounts or telemetry, and a drawing never leaves the browser. Do not add any of these.
- **The preview runs on `innerHTML`:** it sets `innerHTML` to the user's own code, in their own browser. Never render SVG from any other source that way, and never `eval` code or add a path that runs code from a drawing.
- **Parse untrusted text with `DOMParser`** or the source scanner, never by injecting it into the page.
- **Dependencies:**
  - Dependencies are locked (`bun.lock`, `package-lock.json`) and updated in one batch.
  - Workflow actions are pinned to commit SHAs with their version in a comment. Update them with `actions-up`, and check each SHA against its tag.
  - Add no dependency without the owner's say.
- **No secrets** in the repo, the workflows, or test fixtures.

## Testing

- **Where tests go:**
  - Pure logic: unit tests in `tests/` (Vitest).
  - Anything in the page: e2e tests in `e2e/` (Playwright, Chromium, with tablet and phone viewports where it matters). Vitest leaves `e2e/` alone, and Playwright looks only there.
- **e2e helpers:**
  - `e2e/toolbar.ts` opens the app bar's menus: `pressMenuItem`.
  - `e2e/fixtures.ts` has `useHello`, which puts the old circle-and-text drawing in the editor for specs written against it. The app opens with a light bulb instead.
- **Playwright gotchas:**
  - An SVG `<line>` has a box with no height, so press it with `page.mouse` at drawing coordinates.
  - A colour transition can be read halfway through, so poll for the colour rather than wait a fixed while.
- **More:** [TESTING_GUIDE.md](./TESTING_GUIDE.md).

## Definition of done

A change is done when:

1. Lint, the type check, the unit tests, a fresh build, and the full e2e suite all pass locally.
2. It has tests: unit tests for its logic, and e2e tests for what a user sees and does, on touch where touch is involved.
3. It works in light and dark, side by side and stacked, and at tablet width.
4. It is accessible: named controls, reachable by the keys, and announced to screen readers where it changes something.
5. The README says what it does.
6. It is committed on its own with a message that says what changed and why, pushed, and green on CI.
7. It has been reviewed, and the review's findings are fixed or answered.

## Browser support

The current Chrome, Edge, and Firefox, and Safari 17 or later, on macOS and iPadOS. The app uses the Popover API and CSS `:has()`.
