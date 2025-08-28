# SlickSVG - SVG Editor

A **Node.js**-based, web SVG editor written in **TypeScript**, with no frontend frameworks. The UI and all interactions are managed using vanilla TypeScript, DOM APIs, and modern browser features. The app provides a full-screen split view for editing and previewing SVG code in real time.

## Screenshots

**Light Mode:**
![Light Mode](https://github.com/user-attachments/assets/cd5529a8-38d2-48fa-adba-e8e668829ab1)

**Dark Mode:**
![Dark Mode](https://github.com/user-attachments/assets/dcf3c202-9c06-4553-9aee-25614517b83d)

## Features

- **Full-Screen UI**: Editor and live preview split 50/50, with toggle for vertical/horizontal orientation
- **Editor**:
  - Top toolbar with file upload, resize, optimize, and transform controls
  - SVG code input uses [CodeMirror 6](https://codemirror.net/) with XML syntax highlighting and real-time linting
  - Live SVG preview updates as code changes
  - Supports drag & drop file upload
- **Preview**:
  - Real-time SVG rendering with semi-transparent dashed border
  - Click and drag to pan the SVG within the preview
  - Zoom in/out controls with button or pinch gestures
  - Dark/light mode toggle
- **SVG Tools**:
  - **Upload**: Drag & drop or click to upload SVG files
  - **Resize**: Change SVG dimensions with modal dialog
  - **Optimize**: Remove unnecessary whitespace, comments, and optimize SVG code
  - **Transform**: Rotate (90° increments), flip horizontal/vertical
- **Modern Development**:
  - TypeScript with strict type checking
  - Tailwind CSS for styling
  - ESLint for code quality
  - Vitest for unit testing (94 tests)
  - Playwright for E2E testing
  - Tokyo Night themes for light/dark mode syntax highlighting

## Setup

> [!NOTE]
> You can use `bun` or `npm` (`bunx` / `npx`) interchangeably in all examples

1. Install dependencies:

    ```sh
    bun install
    ```

2. Build the project:

    ```sh
    bun run build
    ```

3. Start the development server:

    ```sh
    bun run dev
    ```

4. Open your browser to `http://localhost:5173`

**Alternative build for single-file deployment:**
```sh
bun run build  # Creates a single HTML file in dist/src/index.html
```

## Available Scripts

- `bun run dev` - Start Vite development server with hot reload (port 5173)
- `bun run build` - Build single HTML file with all assets inlined
- `bun run style` - Build CSS only
- `bun run scripts` - Build JavaScript only
- `bun run lint` - Run ESLint
- `bun run lint:fix` - Run ESLint with auto-fix

### Testing

The project includes comprehensive automated testing with both unit/integration tests and end-to-end tests:

#### Unit and Integration Tests (Vitest)

Place unit and integration tests in the `tests/` directory:

- `bun run check` - Run unit tests with Vitest
- `bun run check:watch` - Run unit tests in watch mode
- `bun run check:ui` - Run unit tests with interactive UI
- `bun run check:coverage` - Run tests with coverage reporting

**Current Unit Test Coverage:**

- **Core SVGEditor functionality** - Element selection, error handling, theme switching
- **Transform operations** - Rotation, flipping, zoom controls, pan interactions
- **SVG parsing and validation** - Content validation, dimension extraction, transform parsing
- **Modal dialog functionality** - Show/hide, input validation, focus management
- **Touch and pinch zoom** - Multi-touch calculations, gesture handling
- **Error handling** - File upload errors, malformed SVG, input validation
- **Accessibility features** - Keyboard navigation, screen reader support, focus management
- **Performance optimization** - Event cleanup, memory management, transform caching
- **SVG optimization** - Code minification, whitespace removal, attribute optimization
- **SVG linting** - Real-time XML/SVG validation, error reporting
- **Tokyo Night theme integration** - Light/dark mode theming, syntax highlighting

#### End-to-End Tests (Playwright)

Place E2E tests in the `e2e/` directory:

- `bun run check:e2e` - Run end-to-end tests with Playwright
- `bun run check:e2e:headed` - Run E2E tests with browser UI visible
- `bun run check:e2e:debug` - Debug E2E tests step by step
- `bun run check:e2e:ui` - Run E2E tests with interactive UI

**Current E2E Test Coverage:**
- **Core editor functionality** - SVG editing, preview updates, UI interactions
- **File upload workflows** - Drag & drop, file validation, error handling
- **Transform operations** - Rotation, flipping, zoom, layout switching
- **Accessibility testing** - Keyboard navigation, screen reader compatibility, focus management
- **Error handling** - Invalid content, network failures, rapid interactions
- **Mobile and touch support** - Responsive design, pinch-to-zoom, orientation changes
- **Performance testing** - Load times, memory usage, rapid interactions
- **Cross-browser compatibility** - Different browsers, screen densities, color schemes
- **SVG linting integration** - Real-time validation feedback, error highlighting

#### Running All Tests

- `bun run test` - Run both unit and E2E tests
- `bun run test:all` - Run all tests with coverage reporting
- `bun run test:unit` - Run unit tests only
- `bun run test:e2e` - Run E2E tests only
- `bun run test:integration` - Run tests with coverage

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
├── svg-transforms.test.ts      # Transform operations and SVG parsing
├── svg-error-handling.test.ts  # Error scenarios and edge cases
├── svg-accessibility.test.ts   # Accessibility features and integration
├── svg-upload.test.ts          # File upload functionality
├── svg-optimization.test.ts    # SVG optimization features
├── svg-resolution-change.test.ts # Resolution modal and resizing
├── svg-fallback-sizing.test.ts # SVG sizing logic
├── svg-linting.test.ts         # SVG/XML linting functionality
├── pinch-zoom.test.ts          # Pinch zoom calculations
└── tokyo-night-theme-integration.test.ts # Tokyo Night theme integration

e2e/                         # End-to-end tests (Playwright)
├── svg-editor.spec.ts          # Core editor functionality
├── svg-upload.spec.ts          # Upload workflows
├── svg-accessibility.spec.ts   # Accessibility testing
├── svg-error-handling.spec.ts  # Error scenarios
├── svg-linting.spec.ts         # Linting integration tests
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
├── svg-transforms.test.ts      # Transform operations and SVG parsing
├── svg-error-handling.test.ts  # Error scenarios and edge cases
├── svg-accessibility.test.ts   # Accessibility features and integration
├── svg-upload.test.ts          # File upload functionality
├── svg-optimization.test.ts    # SVG optimization features
├── svg-resolution-change.test.ts # Resolution modal and resizing
├── svg-fallback-sizing.test.ts # SVG sizing logic
├── svg-linting.test.ts         # SVG/XML linting functionality
├── pinch-zoom.test.ts          # Pinch zoom calculations
└── tokyo-night-theme-integration.test.ts # Tokyo Night theme integration

e2e/                 # End-to-end tests (Playwright)
├── svg-editor.spec.ts          # Core editor functionality
├── svg-upload.spec.ts          # Upload workflows
├── svg-accessibility.spec.ts   # Accessibility testing
├── svg-error-handling.spec.ts  # Error scenarios
├── svg-linting.spec.ts         # Linting integration tests
└── svg-mobile-performance.spec.ts # Mobile, performance, compatibility

dist/                # Built assets (generated)
├── theme.css        # Compiled CSS
├── app.js          # Bundled JavaScript
└── index.html      # HTML file
```

## Architecture

The application is built with:

- **CodeMirror 6** for the code editor with XML/SVG syntax highlighting and real-time linting
- **Tokyo Night themes** for light/dark mode syntax highlighting
- **Tailwind CSS** for styling with PostCSS processing
- **ESBuild** for fast TypeScript bundling (production builds)
- **Vite** for development server with hot reload
- **Vanilla TypeScript** for all UI interactions and DOM manipulation
- **CSS Grid/Flexbox** for responsive layout

## Usage

1. **Edit SVG Code**: Use the CodeMirror editor on the left to write/edit SVG markup with real-time syntax highlighting and error detection
2. **Live Preview**: See your changes instantly in the preview panel on the right
3. **Upload Files**: Drag & drop SVG files onto the editor or use the Upload button
4. **Transform SVGs**: Use the toolbar buttons to rotate, flip, or optimize your SVG
5. **Resize**: Click the Resize button to change SVG dimensions
6. **Pan & Zoom**: Click and drag to pan the SVG; use +/- buttons to zoom in/out
7. **Dark Mode**: Toggle between light and dark themes with the Dark Mode button
8. **Layout Toggle**: Click "Flip Screen" to switch between horizontal and vertical layouts

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
