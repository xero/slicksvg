# Comprehensive Testing Guide for `slicksvg`

This document provides detailed instructions and technical requirements for writing and organizing both unit and end-to-end (E2E) tests for the `slicksvg` project. It also includes a breakdown of the current test directory structure.

---

## Current Test Directory Structure

```
tests/                # Unit and integration tests (Vitest)
├── pinch-zoom.test.ts
├── svg-fallback-sizing.test.ts
├── svg-resolution-change.test.ts
├── svg-upload.test.ts

e2e/                  # End-to-end tests (Playwright)
├── svg-editor.spec.ts
├── svg-upload.spec.ts

(vitest.config.ts, playwright.config.ts in repo root)
```

- **Unit/Integration tests:** written in TypeScript, use [Vitest](https://vitest.dev/), located in `tests/`
- **E2E tests:** written in TypeScript, use [Playwright](https://playwright.dev/), located in `e2e/`

> **Note:** For an up-to-date file listing or for results beyond the first 10, [browse the repo on GitHub](https://github.com/xero/slicksvg/search?q=test).

---

## Testing Requirements & Technical Details

### 1. Unit Tests

- **Framework:** Use [Vitest](https://vitest.dev/) (preferred for Vite projects).
- **Scope:** Cover all core modules, components, and utility functions. Include edge cases, error handling, and input validation.
- **File Placement:** Place test files next to their source as `<filename>.test.ts(x)?` or in the `tests/` directory.
- **Mocking:** Use mocks for external dependencies (APIs, network requests, local storage, etc.).
- **Configuration:** Ensure `vitest.config.ts` is present and correctly excludes E2E and build directories:
  ```typescript
  // vitest.config.ts
  import { defineConfig } from 'vitest/config';
  export default defineConfig({
    test: {
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        '**/e2e/**',
        '**/.{idea,git,cache,output,temp}/**',
        '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build}.config.*'
      ],
    },
  });
  ```
- **Running Tests:**
  - `npm run check` - Run all unit tests
  - `npm run check:watch` - Watch mode
  - `npm run check:ui` - Vitest UI

### 2. End-to-End (E2E) Tests

- **Framework:** Use [Playwright](https://playwright.dev/).
- **Scope:** Write tests that simulate major user flows, including authentication, navigation, form submissions, error states, and integrations.
- **File Placement:** Place E2E tests in `e2e/` as `.spec.ts` files.
- **Configuration:** Ensure `playwright.config.ts` is present, with the following (or similar) settings:
  ```typescript
  // playwright.config.ts
  import { defineConfig, devices } from '@playwright/test';
  export default defineConfig({
    testDir: './e2e',
    fullyParallel: true,
    reporter: 'html',
    use: {
      baseURL: 'http://localhost:8080',
      trace: 'on-first-retry',
    },
    projects: [
      { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    ],
    webServer: {
      command: 'npm run dev',
      url: 'http://localhost:8080',
      reuseExistingServer: true,
    },
  });
  ```
- **Running Tests:**
  - `npm run check:e2e` - Run E2E tests
  - `npm run check:e2e:headed` - Headed mode
  - `npm run check:e2e:debug` - Debug mode

### 3. Project Configuration & Documentation

- **Config files:** Keep `vitest.config.ts` and `playwright.config.ts` up to date.
- **Scripts:** Test-related scripts are defined in `package.json`:
  ```json
  "scripts": {
    "check": "vitest run",
    "check:watch": "vitest",
    "check:ui": "vitest --ui",
    "check:e2e": "playwright test",
    "check:e2e:headed": "playwright test --headed",
    "check:e2e:debug": "playwright test --debug"
  }
  ```
- **Documentation:** Document all testing instructions in the `README.md` or this `TESTING_GUIDE.md`. If new workflows or directories are added, update these docs accordingly.
- **Continuous Integration:** If CI is configured, ensure both unit and E2E tests run on pull requests. If not, suggest a `.github/workflows/test.yml` (not present as of this writing).

### 4. Best Practices

- **Test Naming:** Use descriptive names for test files and test cases.
- **Structure:** Keep a clear separation between unit and E2E tests to avoid runner conflicts.
- **Maintainability:** Write clear, concise, and maintainable tests; refactor as necessary.
- **Coverage:** Aim for high coverage of business logic, including edge cases and user flows.

---

## Testing Commands Quick Reference

### Unit Tests (Vitest)
```bash
# Run all unit tests once
npm run check

# Run tests in watch mode (auto-rerun on file changes)
npm run check:watch

# Open Vitest UI for interactive testing
npm run check:ui
```

### End-to-End Tests (Playwright)
```bash
# Install Playwright browsers (first time setup)
npx playwright install

# Run E2E tests (headless)
npm run check:e2e

# Run E2E tests with browser UI visible
npm run check:e2e:headed

# Run E2E tests in debug mode (with debugging tools)
npm run check:e2e:debug
```

### Development Server
```bash
# Start development server for E2E testing
npm run dev

# Build production files
npm run build
```

---

## Continuous Integration Setup

For automated testing in CI/CD pipelines, create a `.github/workflows/test.yml` file:

```yaml
name: Test Suite
on:
  push:
    branches: [ main ]
  pull_request:
    branches: [ main ]

jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '18'
          cache: 'npm'
      - run: npm ci
      - run: npm run check

  e2e-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '18'
          cache: 'npm'
      - run: npm ci
      - run: npx playwright install --with-deps
      - run: npm run check:e2e
```

---

## References

- [Vitest Docs](https://vitest.dev/)
- [Playwright Docs](https://playwright.dev/)
- [Current repo test search results](https://github.com/xero/slicksvg/search?q=test)
