# SlickSVG - SVG Editor

A **Node.js**-based, web SVG editor written in **TypeScript**, with no frontend frameworks. The UI and all interactions are managed using vanilla TypeScript, DOM APIs, and modern browser features. The app provides a full-screen split view for editing and previewing SVG code in real time.

![SVG Editor Screenshot](https://github.com/user-attachments/assets/d289cba7-9ac6-4040-9ce6-d41448905093)

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

## Setup

1. Install dependencies:

    ```sh
    npm install
    ```

2. Run development server:

    ```sh
    npm run dev
    ```

3. Open your browser to `http://localhost:8080`

## Available Scripts

- `npm run dev` - Start development server with auto-rebuild
- `npm run build` - Build CSS and JavaScript bundles
- `npm run style` - Build CSS only
- `npm run scripts` - Build JavaScript only
- `npm run lint` - Run ESLint
- `npm run lint:fix` - Run ESLint with auto-fix
- `npm run check` - Run unit tests with Vitest
- `npm run check:watch` - Run unit tests in watch mode
- `npm run check:e2e` - Run end-to-end tests with Playwright
- `npm run check:e2e:headed` - Run E2E tests with browser UI
- `npm run check:e2e:debug` - Debug E2E tests

## Project Structure

```
src/
├── scripts/         # TypeScript source files
│   └── main.ts      # Main application entry point
├── style/           # CSS and styling
│   ├── editor.css   # Main styles with Tailwind
│   └── palette.css  # Color palette definitions
└── www/             # Static web assets
    └── index.html   # Main HTML file

tests/               # End-to-end tests
├── svg-editor.spec.ts

dist/                # Built assets (generated)
├── editor.min.css
└── app.min.js
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

## Browser Support

Modern browsers supporting ES2022+ features:
- Chrome/Chromium 95+
- Firefox 93+
- Safari 15+
- Edge 95+

## License

[CC0 1.0 Universal](LICENSE) - Public Domain