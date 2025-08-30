# SlickSVG - Split Screen SVG Editor
```
   ____     ____     ____ _______  _____   _____
 _/  _//__ |   /    /    V    __/__\    | /    /
_\___     \:   |    |    |    |/   Y    :/    /
\    |     |   |    |    |    |    |    /     \
|    :     |   |____|    |__  :    |    \      \
:____      |   :    /    |  \      |_____\ svg  \
     \____/ \______/ \__/    \____/       \_____/

        https://github.com/xero/slicksvg
```
A **Node.js**-based, web SVG editor written in **TypeScript**, with no frontend frameworks. The UI and all interactions are managed using vanilla TypeScript, DOM APIs, and modern browser features. The app provides a full-screen split view for editing and previewing SVG code in real time.

**Features**: Real-time editing • Resizable split view • Xray mode highlighting • Dark/light themes • SVG optimization • Transform tools • Mobile / Touch support • Comprehensive testing

## Screenshots

**Light Mode with Xray Highlighting:**
![Light Mode Vertical](https://github.com/user-attachments/assets/918073fb-28b3-4814-be49-0e171aeedf43)

**Dark Mode with Error State:**
![Dark Mode with Error](https://github.com/user-attachments/assets/61278330-a2af-4e2b-8005-134819008bfd)

## Features

### Core Editor
- **Resizable Split View**: Editor and live preview with draggable separator for custom sizing (10%-90% range)
- **Advanced Code Editor**: [CodeMirror 6](https://codemirror.net/) with XML/SVG syntax highlighting and real-time linting
- **Live Preview**: Instant SVG rendering with semi-transparent dashed border for bounding visualization
- **Real-time Validation**: XML/SVG syntax checking with detailed error reporting
- **Tokyo Night Themes**: Beautiful light/dark mode syntax highlighting with seamless theme switching

### Xray Mode
- **Visual Element Highlighting**: Toggle xray mode to visually highlight SVG elements in the preview when cursor is positioned within corresponding code
- **Native SVG Filters**: Uses sophisticated SVG filter effects for smooth, high-quality highlighting
- **Smart Element Detection**: Automatically detects cursor position and maps to corresponding SVG elements
- **Element Indexing**: Supports multiple elements of the same type (e.g., multiple circles, paths)
- **Non-intrusive**: Highlighting preserves original SVG appearance and doesn't modify code

### SVG Tools
- **Upload**: Drag & drop or click to upload SVG files with validation
- **Download**: Save current SVG code as a file
- **Resize**: Change SVG dimensions with modal dialog interface
- **Optimize**: Remove unnecessary whitespace, comments, and optimize SVG code for smaller file sizes
- **Transform**:
  - Rotate in 90° increments
  - Flip horizontal/vertical
  - Reset transformations

### Interactive Preview
- **Resizable Layout**: Drag the separator between editor and preview to customize panel sizes in both horizontal and vertical modes
- **Pan & Zoom**: Click and drag to pan, use +/- buttons or pinch gestures to zoom
- **Touch Support**: Full multi-touch support with pinch-to-zoom on mobile devices
- **Responsive Design**: Adapts to different screen sizes and orientations
- **Visual Feedback**: Real-time zoom level announcements for accessibility

### User Experience
- **Dark/Light Mode**: Seamless theme switching with persistent preferences
- **Layout Toggle**: Switch between horizontal and vertical split layouts
- **Accessibility**: Full keyboard navigation, screen reader support, and ARIA labels
- **Error Handling**: Graceful error handling with user-friendly messages
- **Performance**: Optimized for smooth interactions and fast rendering

### Modern Development
- **TypeScript**: Strict type checking for better code quality and developer experience
- **Tailwind CSS**: Utility-first CSS framework for consistent styling
- **ESLint**: Code quality enforcement with TypeScript rules
- **Comprehensive Testing**:
  - **Vitest**: 111+ unit and integration tests
  - **Playwright**: End-to-end testing across browsers
- **Build System**:
  - **Vite**: Fast development server with hot reload
  - **ESBuild**: Optimized production builds

## Setup

> [!NOTE]
> You can use `bun` or `npm` (`bunx` / `npx`) interchangeably in all examples.
> For building, you may use the convenient shortcut: `bun bake` (same as `bun run build`).

1. Install dependencies:

    ```sh
    bun install
    ```

2. Start the development server:

    ```sh
    bun run dev
    # or
    npm run dev
    ```

3. Build the project (**single-file ready**):

    ```sh
    bun bake
    # or
    bun run build
    # or
    npm run build
    ```

    - This produces a single HTML file at `dist/index.html`.

4. Preview the built app:

    ```sh
    bun run preview
    # or
    npm run preview
    ```

    - Then open your browser to [http://localhost:4173](http://localhost:4173)

---

## Available Scripts

- `bun bake` — Build the app (shortcut for `bun run build`)
- `bun run dev` — Start Vite development server (port 5173)
- `bun run build` — Validate CSS, build single-file HTML (`dist/index.html`)
- `bun run preview` — Local preview of built app (port 4173)
- `bun run lint` — Run ESLint
- `bun run lint:fix` — Run ESLint with auto-fix
- `bun run test` — Run all unit and E2E tests
- `bun run test:all` — Run all tests with coverage
- `bun run test:unit` — Run unit tests only
- `bun run test:e2e` — Run E2E tests only (with local server)
- `bun run test:integration` — Run tests with coverage reporting

---

### Testing

The project includes both unit/integration tests and end-to-end (E2E) tests.

#### Unit and Integration Tests (Vitest)

- `bun run check` — Run unit tests (Vitest)
- `bun run check:coverage` — Run unit/integration tests with coverage

Test files are located in the `tests/` directory.

#### End-to-End Tests (Playwright)

- `bun run check:e2e` — Run E2E tests (Playwright, with local server)
- `bun run check:e2e:headed` — Run E2E tests with browser UI visible
- `bun run check:e2e:debug` — Debug E2E tests step by step
- `bun run check:e2e:ui` — Run E2E tests with Playwright's interactive UI

E2E tests are located in the `e2e/` directory.

##### Playwright Install

Before running E2E tests for the first time, install Playwright browsers and dependencies:

```sh
bun run playwright:install
bun run playwright:install-deps
```

---

#### Running All Tests

- `bun run test` — Run all unit and E2E tests
- `bun run test:all` — Run all tests with coverage
- `bun run test:unit` — Run unit tests only
- `bun run test:e2e` — Run E2E tests only
- `bun run test:integration` — Run tests with coverage

---

> [!NOTE]
> All scripts can be run with `bun run <script>` or `npm run <script>`.
> For building, `bun bake` is a shortcut for `bun run build`.

---

#### Test Setup

**First-time setup:**
```bash
# Install dependencies
bun install

# Install Playwright browsers (required for E2E tests)
bun run playwright:install

# If you encounter issues, also install system dependencies
bun run playwright:install-deps
```

**Development workflow:**
```bash
# Run tests during development
bun run check:watch          # Unit tests in watch mode
bun run check:e2e:headed     # E2E tests with browser visible

# Before committing
bun run test:all             # Full test suite with coverage
```

#### Test Configuration

- **Vitest config**: `vitest.config.ts` - Excludes E2E tests, includes coverage reporting
- **Playwright config**: `playwright.config.ts` - Runs tests against local dev server
- **Coverage**: Reports generated in `coverage/` directory (HTML, JSON, text formats)

#### Test Organization

```
tests/                       # Unit and integration tests (Vitest)
├── svg-editor-core.test.ts     # Core class functionality
├── svg-drag-resize.test.ts     # Drag-resize functionality and calculations
├── svg-transforms.test.ts      # Transform operations and SVG parsing
├── svg-error-handling.test.ts  # Error scenarios and edge cases
├── svg-accessibility.test.ts   # Accessibility features and integration
├── svg-upload.test.ts          # File upload functionality
├── svg-download.test.ts        # File download functionality
├── svg-optimization.test.ts    # SVG optimization features
├── svg-resolution-change.test.ts # Resolution modal and resizing
├── svg-fallback-sizing.test.ts # SVG sizing logic
├── svg-linting.test.ts         # SVG/XML linting functionality
├── svg-drag-drop-clear.test.ts # Drag & drop and clear functionality
├── pinch-zoom.test.ts          # Pinch zoom calculations
└── tokyo-night-theme-integration.test.ts # Tokyo Night theme integration

e2e/                         # End-to-end tests (Playwright)
├── svg-editor.spec.ts          # Core editor functionality
├── svg-drag-resize.spec.ts     # Drag-resize E2E testing and accessibility
├── svg-upload.spec.ts          # Upload workflows
├── svg-accessibility.spec.ts   # Accessibility testing
├── svg-error-handling.spec.ts  # Error scenarios
├── svg-linting.spec.ts         # Linting integration tests
├── svg-drag-drop-clear.spec.ts # Drag & drop and clear functionality
└── svg-mobile-performance.spec.ts # Mobile, performance, compatibility
```

> **Note**: Keep test files in their respective directories to avoid runner conflicts. Vitest excludes the `e2e/` directory, and Playwright only looks in the `e2e/` directory.

For comprehensive testing instructions, setup details, and CI configuration, see [TESTING_GUIDE.md](./TESTING_GUIDE.md).

## Project Structure

```
src/
├── app.ts           # Main TypeScript application
├── theme.css        # CSS styles with Tailwind
├── index.html       # Main HTML file
└── ico/             # Icon assets

tests/               # Unit and integration tests (Vitest)
├── svg-editor-core.test.ts     # Core class functionality
├── svg-drag-resize.test.ts     # Drag-resize functionality and calculations
├── svg-transforms.test.ts      # Transform operations and SVG parsing
├── svg-error-handling.test.ts  # Error scenarios and edge cases
├── svg-accessibility.test.ts   # Accessibility features and integration
├── svg-upload.test.ts          # File upload functionality
├── svg-download.test.ts        # File download functionality
├── svg-optimization.test.ts    # SVG optimization features
├── svg-resolution-change.test.ts # Resolution modal and resizing
├── svg-fallback-sizing.test.ts # SVG sizing logic
├── svg-linting.test.ts         # SVG/XML linting functionality
├── svg-drag-drop-clear.test.ts # Drag & drop and clear functionality
├── pinch-zoom.test.ts          # Pinch zoom calculations
└── tokyo-night-theme-integration.test.ts # Tokyo Night theme integration

e2e/                 # End-to-end tests (Playwright)
├── svg-editor.spec.ts          # Core editor functionality
├── svg-drag-resize.spec.ts     # Drag-resize E2E testing and accessibility
├── svg-upload.spec.ts          # Upload workflows
├── svg-accessibility.spec.ts   # Accessibility testing
├── svg-error-handling.spec.ts  # Error scenarios
├── svg-linting.spec.ts         # Linting integration tests
├── svg-drag-drop-clear.spec.ts # Drag & drop and clear functionality
└── svg-mobile-performance.spec.ts # Mobile, performance, compatibility

dist/                # Built assets (generated)
├── theme.css        # Compiled CSS
├── app.js          # Bundled JavaScript
└── index.html      # HTML file
```

## Architecture

The application is built with modern web technologies:

- **CodeMirror 6** for the code editor with XML/SVG syntax highlighting and real-time linting
- **Tokyo Night themes** for beautiful light/dark mode syntax highlighting
- **Tailwind CSS** for utility-first styling with PostCSS processing
- **ESBuild** for fast TypeScript bundling (production builds)
- **Vite** for development server with hot reload and fast builds
- **Vanilla TypeScript** for all UI interactions and DOM manipulation
- **CSS Grid/Flexbox** for responsive layout system
- **Native SVG Filters** for xray mode highlighting effects
- **Modern Browser APIs** for drag & drop, touch events, and accessibility

## Usage

1. **Edit SVG Code**: Use the CodeMirror editor on the left to write/edit SVG markup with real-time syntax highlighting and error detection
2. **Live Preview**: See your changes instantly in the preview panel on the right
3. **Resize Layout**: Drag the blue separator between editor and preview panels to customize their sizes (10%-90% range)
4. **Upload Files**: Drag & drop SVG files onto the editor or use the Upload button
5. **Download Files**: Save your current SVG code as a file using the Download button
6. **Transform SVGs**: Use the toolbar buttons to rotate, flip, or optimize your SVG
7. **Resize**: Click the Resize button to change SVG dimensions via modal dialog
8. **Xray Mode**: Click the eye button to enable visual highlighting - move your cursor through different SVG elements in the code to see them highlighted in the preview
9. **Pan & Zoom**: Click and drag to pan the SVG; use +/- buttons or pinch gestures to zoom in/out
10. **Dark Mode**: Toggle between light and dark themes with the Dark Mode button
11. **Layout Toggle**: Click "Flip Screen" to switch between horizontal and vertical layouts

## Development

The project uses modern development practices:

- **TypeScript** with strict type checking for better code quality
- **ESLint** with TypeScript rules for consistent code style
- **Vitest** for fast unit testing
- **Playwright** for reliable end-to-end testing
- **PostCSS** with Tailwind for efficient CSS processing

### Contributing

When adding tests, place them in the appropriate directory:
- Unit/integration tests → `tests/` (run with Vitest)
- End-to-end tests → `e2e/` (run with Playwright)

This separation prevents test runner conflicts and ensures tests run with the correct environment.

## Browser Support

Modern browsers supporting ES2022+ features:
- Chrome/Chromium 95+
- Firefox 93+
- Safari 15+
- Edge 95+

## License

[CC0 1.0 Universal](LICENSE) - Public Domain
