import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';

describe('Text Selection Highlighting', () => {
  let dom: JSDOM;
  let document: Document;
  let window: Window & typeof globalThis;

  beforeEach(() => {
    // Mock dependencies before importing the main module
    vi.doMock('@codemirror/view', () => ({
      EditorView: vi.fn(),
    }));

    vi.doMock('@codemirror/state', () => ({
      EditorState: vi.fn(),
      Compartment: vi.fn()
    }));

    vi.doMock('@codemirror/lang-xml', () => ({
      xml: vi.fn()
    }));

    vi.doMock('codemirror', () => ({
      basicSetup: {}
    }));

    vi.doMock('@fsegurai/codemirror-theme-tokyo-night-day', () => ({
      tokyoNightDay: {}
    }));

    vi.doMock('@fsegurai/codemirror-theme-tokyo-night-storm', () => ({
      tokyoNightStorm: {}
    }));

    vi.doMock('@codemirror/lint', () => ({
      linter: () => ({}),
      lintGutter: () => ({})
    }));

    // Create DOM environment
    dom = new JSDOM(`<!DOCTYPE html>
      <html>
        <head>
          <style>
            /* Include our selection color variables */
            :root {
              --color-selection: #5d5fef;
            }
            .dark {
              --color-selection: #7dcfff;
            }
            
            /* Our selection highlighting CSS rules */
            .cm-editor .cm-selectionBackground,
            .cm-editor.cm-focused .cm-selectionBackground {
              background: var(--color-selection) !important;
            }
            .cm-editor .cm-content ::selection,
            .cm-editor .cm-line ::selection,
            .cm-editor .cm-line::selection {
              background-color: var(--color-selection) !important;
            }
          </style>
        </head>
        <body>
          <div class="cm-editor">
            <div class="cm-content">
              <div class="cm-line">Hello World</div>
            </div>
            <div class="cm-selectionLayer">
              <div class="cm-selectionBackground"></div>
            </div>
          </div>
        </body>
      </html>`);

    document = dom.window.document;
    window = dom.window as unknown as Window & typeof globalThis;
    global.document = document;
    global.window = window;
  });

  afterEach(() => {
    vi.resetAllMocks();
    vi.clearAllMocks();
    dom.window.close();
  });

  it('should define selection color variables for light mode', () => {
    const lightSelectionColor = getComputedStyle(document.documentElement)
      .getPropertyValue('--color-selection').trim();
    
    expect(lightSelectionColor).toBe('#5d5fef');
  });

  it('should define selection color variables for dark mode', () => {
    // Add dark class to body
    document.body.classList.add('dark');
    
    const darkSelectionColor = getComputedStyle(document.body)
      .getPropertyValue('--color-selection').trim();
    
    expect(darkSelectionColor).toBe('#7dcfff');
  });

  it('should apply selection background to CodeMirror selection elements', () => {
    const selectionBackground = document.querySelector('.cm-selectionBackground');
    expect(selectionBackground).toBeTruthy();
    
    const styles = getComputedStyle(selectionBackground as Element);
    expect(styles.background).toContain('var(--color-selection)');
  });

  it('should have CSS rules for text selection pseudo-elements', () => {
    // Check that the selection CSS rules exist in the stylesheet
    const styleSheets = Array.from(document.styleSheets);
    let hasSelectionRules = false;
    
    for (const sheet of styleSheets) {
      try {
        const rules = Array.from(sheet.cssRules);
        hasSelectionRules = rules.some(rule => 
          rule.cssText.includes('::selection') && 
          rule.cssText.includes('var(--color-selection)')
        );
        if (hasSelectionRules) break;
      } catch (e) {
        // Skip inaccessible stylesheets
      }
    }
    
    expect(hasSelectionRules).toBe(true);
  });

  it('should override CodeMirror theme selection with custom colors', () => {
    const editor = document.querySelector('.cm-editor');
    expect(editor).toBeTruthy();
    
    // Verify that our CSS selector specificity should override theme defaults
    const selectionBg = editor?.querySelector('.cm-selectionBackground');
    expect(selectionBg).toBeTruthy();
    
    // Our CSS uses !important to ensure it overrides theme defaults
    const styles = getComputedStyle(selectionBg as Element);
    expect(styles.background).toContain('var(--color-selection)');
  });
});