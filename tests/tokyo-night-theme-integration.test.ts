import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { JSDOM } from 'jsdom';

describe('Tokyo Night Theme Integration', () => {
  let dom: JSDOM;
  let window: Window;
  let document: Document;

  beforeEach(() => {
    dom = new JSDOM(`
      <!DOCTYPE html>
      <html>
        <head>
          <link rel="stylesheet" href="theme.css" />
        </head>
        <body>
          <main id="editor"></main>
          <aside id="preview">
            <nav>
              <button id="dark">dark mode</button>
            </nav>
          </aside>
        </body>
      </html>
    `, {
      url: 'http://localhost',
      pretendToBeVisual: true,
      resources: 'usable'
    });

    window = dom.window as unknown as Window;
    document = window.document;
    global.document = document;
    global.window = window;
    global.Element = window.Element;
    global.Node = window.Node;
    global.HTMLElement = window.HTMLElement;
    global.HTMLDialogElement = window.HTMLDialogElement;
    global.HTMLInputElement = window.HTMLInputElement;
    global.FileReader = window.FileReader as any;
  });

  afterEach(() => {
    dom.window.close();
  });

  describe('Theme Toggle Functionality', () => {
    it('should toggle dark mode class on body', () => {
      const body = document.body;
      let isDarkMode = false;

      const toggleMode = () => {
        isDarkMode = !isDarkMode;
        body.classList.toggle('dark');
      };

      // Initially light mode
      expect(body.classList.contains('dark')).toBe(false);
      expect(isDarkMode).toBe(false);

      // Toggle to dark mode
      toggleMode();
      expect(body.classList.contains('dark')).toBe(true);
      expect(isDarkMode).toBe(true);

      // Toggle back to light mode
      toggleMode();
      expect(body.classList.contains('dark')).toBe(false);
      expect(isDarkMode).toBe(false);
    });

    it('should have dark mode button available', () => {
      const darkButton = document.getElementById('dark');
      expect(darkButton).toBeTruthy();
      expect(darkButton?.textContent).toBe('dark mode');
    });
  });
});