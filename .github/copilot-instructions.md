# About the project

slicksvg is a **Node.js**-based, web SVG editor written in **TypeScript**, with no frontend frameworks. The UI and all interactions are managed using vanilla TypeScript, DOM APIs, and modern browser features. The app provides a full-screen split view for editing and previewing SVG code in real time.

## Features

- **Full-Screen UI**: Editor and live preview split 50/50, with toggle for vertical/horizontal orientation
- **Editor**:
  - Top toolbar with split toggle button
  - SVG code input uses [CodeMirror](https://codemirror.net/) with XML syntax highlighting
  - Live SVG preview updates as code changes
- **Preview**:
  - No scrollbars
  - SVG has a semi-transparent, dashed border for bounding
  - Click and drag pans the SVG within the preview
  - Toolbar (top-left) for zoom in/out controls
- **Modern Development**:
  - TypeScript with strict type checking
  - Tailwind CSS for styling
  - ESLint for code quality
  - Vitest for unit testing
  - Playwright for E2E testing

# Testing Instructions

To correctly test this app, please follow these steps:

1. **Install dependencies**
   Run:
   ```sh
   bun i
   ```

2. **Build the app**
   Run:
   ```sh
   bun run build
   ```

3. **Serve the app**
   Point your web server to the newly created `dist` folder.

4. **Verify in the browser**
   - Open the app in your browser.
   - Open the browser console and ensure **there are no errors**.
   - Click the **"dark mode"** button:
     - The color scheme should visually change from light to dark (or vice versa).
     - To validate, take two screenshots—one before and one after pressing the button.

**Note:**
If you encounter any errors or unexpected behavior, please include console output and screenshots in your report or pull request.

## Available Scripts

- `bun run build` - Build CSS and JavaScript bundles
- `bun run lint` - Run ESLint
- `bun run lint:fix` - Run ESLint with auto-fix

### Testing

The project includes comprehensive automated testing with both unit/integration tests and end-to-end tests:

#### Unit and Integration Tests (Vitest)

Place unit and integration tests in the `tests/` directory:

**Current Unit Test Coverage:**

- **Core SVGEditor functionality** - Element selection, error handling, theme switching
- **Transform operations** - Rotation, flipping, zoom controls, pan interactions
- **SVG parsing and validation** - Content validation, dimension extraction, transform parsing
- **Modal dialog functionality** - Show/hide, input validation, focus management
- **Touch and pinch zoom** - Multi-touch calculations, gesture handling
- **Drag-resize functionality** - Split panel resizing, percentage calculations, layout awareness
- **Error handling** - File upload errors, malformed SVG, input validation
- **Accessibility features** - Keyboard navigation, screen reader support, focus management
- **Performance optimization** - Event cleanup, memory management, transform caching
- **SVG optimization** - Code minification, whitespace removal, attribute optimization
- **SVG linting** - Real-time XML/SVG validation, error reporting
- **File operations** - Upload and download functionality, drag & drop support
- **Tokyo Night theme integration** - Light/dark mode theming, syntax highlighting

bun testing commands (e.g. `bun run test:e2e`)

- **test**: npm run check && npm run check:e2e
- **test:unit**: npm run check
- **test:integration**: npm run check:coverage
- **test:e2e**: start-server-and-test preview http://localhost:4173 check:e2e
- **preview**: vite preview --host --port 4173
- **check**: vitest run
- **check:e2e**: bunx playwright test --reporter=line --workers=2


#### End-to-End Tests (Playwright)

Place E2E tests in the `e2e/` directory:

- `bun run test:e2e` - Run end-to-end tests with Playwright

**Current E2E Test Coverage:**
- **Core editor functionality** - SVG editing, preview updates, UI interactions
- **Drag-resize functionality** - Split panel resizing, accessibility compliance, mobile compatibility
- **File upload workflows** - Drag & drop, file validation, error handling
- **Transform operations** - Rotation, flipping, zoom, layout switching
- **Accessibility testing** - Keyboard navigation, screen reader compatibility, focus management
- **Error handling** - Invalid content, network failures, rapid interactions
- **Mobile and touch support** - Responsive design, pinch-to-zoom, orientation changes
- **Performance testing** - Load times, memory usage, rapid interactions
- **Cross-browser compatibility** - Different browsers, screen densities, color schemes
- **SVG linting integration** - Real-time validation feedback, error highlighting
- **File operations** - Upload workflows, drag & drop functionality, clear operations


#### Running All Tests

- `bun run test` - Run both unit and E2E tests
- `bun run test:all` - Run all tests with coverage reporting

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
└── index.html       # Main HTML file

tests/               # Unit and integration tests (Vitest)
├── pinch-zoom.test.ts
├── svg-fallback-sizing.test.ts
├── svg-resolution-change.test.ts
└── svg-upload.test.ts

e2e/                 # End-to-end tests (Playwright)
├── svg-editor.spec.ts
└── svg-upload.spec.ts

dist/                # Built assets (generated)
├── theme.css
└── app.js
```

## Architecture

The application is built with:

- **CodeMirror 6** for the code editor with XML/SVG syntax highlighting
- **Tailwind CSS** for styling with PostCSS processing
- **ESBuild** for fast TypeScript bundling
- **Vanilla TypeScript** for all UI interactions and DOM manipulation
- **CSS Grid/Flexbox** for responsive layout

## Usage

1. **Edit SVG Code**: Use the CodeMirror editor on the left to write/edit SVG markup
2. **Live Preview**: See your changes instantly in the preview panel on the right
3. **Pan & Zoom**: Click and drag to pan the SVG; use +/- buttons to zoom
4. **Layout Toggle**: Click "flip screen" to switch between horizontal and vertical layouts

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

---

Thank you for helping ensure this app works as expected!
