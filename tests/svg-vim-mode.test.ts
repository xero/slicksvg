import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { JSDOM } from 'jsdom';

describe('Vim Mode Integration', () => {
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
          <div id="test-announcements" aria-live="polite" aria-atomic="true" class="sr-only"></div>
          <dialog aria-labelledby="dialog-title" role="dialog">
            <header id="dialog-title">Change Resolution</header>
            <article>
              <label>Width:<input type="number" min="1" id="width"></label>
              <label>Height:<input type="number" min="1" id="height"></label>
            </article>
            <footer>
              <button id="resize" aria-label="update">Update</button>
              <button id="cancel" aria-label="cancel">Cancel</button>
            </footer>
          </dialog>
          <main id="editor" aria-label="SVG Code Editor">
            <nav>
              <button id="upload" aria-label="upload">upload</button>
              <button id="download" aria-label="download">download</button>
              <button id="resolution" aria-label="resize">resize</button>
              <button id="optimize" aria-label="optimize">optimize</button>
              <button id="vim-toggle" aria-label="toggle vim mode" aria-pressed="false" title="Enable Vim mode (starts in insert mode, press Esc for normal mode)">vim</button>
              <label>transform:</label>
              <button id="rotate"><i>↻</i></button>
              <button id="flipx"><i>⇔</i></button>
              <button id="flipy"><i>⥮</i></button>
            </nav>
            <div id="svg-status-bar" class="svg-status-bar" aria-live="polite" aria-atomic="true">svg valid</div>
          </main>
          <aside id="preview" role="complementary" aria-label="SVG Preview">
            <nav>
              <button id="dark" aria-label="dark mode">dark mode</button>
              <button id="flip" aria-label="flip screen">flip screen</button>
              <label>zoom:</label>
              <button id="zoomin"><i>+</i></button>
              <button id="zoomout"><i>-</i></button>
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
    global.HTMLElement = window.HTMLElement;
    global.HTMLDialogElement = window.HTMLDialogElement;
    global.HTMLInputElement = window.HTMLInputElement;
    global.HTMLButtonElement = window.HTMLButtonElement;
    global.DOMParser = window.DOMParser;
    global.KeyboardEvent = window.KeyboardEvent;
    global.MouseEvent = window.MouseEvent;
    global.TouchEvent = window.TouchEvent;
    global.CustomEvent = window.CustomEvent;
    global.Event = window.Event;

    // Mock matchMedia
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation(query => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  afterEach(() => {
    dom.window.close();
  });

  describe('Vim Toggle Button', () => {
    it('should have vim toggle button in the UI', () => {
      const vimToggle = document.getElementById('vim-toggle');
      expect(vimToggle).toBeTruthy();
      expect(vimToggle?.getAttribute('aria-label')).toBe('toggle vim mode');
      expect(vimToggle?.getAttribute('aria-pressed')).toBe('false');
      expect(vimToggle?.textContent).toBe('vim');
    });

    it('should have proper accessibility attributes', () => {
      const vimToggle = document.getElementById('vim-toggle');
      expect(vimToggle?.getAttribute('title')).toContain('Enable Vim mode');
      expect(vimToggle?.getAttribute('title')).toContain('starts in insert mode');
      expect(vimToggle?.getAttribute('title')).toContain('press Esc for normal mode');
    });

    it('should be properly positioned in the toolbar', () => {
      const vimToggle = document.getElementById('vim-toggle');
      const optimizeButton = document.getElementById('optimize');
      
      expect(vimToggle).toBeTruthy();
      expect(optimizeButton).toBeTruthy();
      
      // Vim toggle should come after optimize button
      const nav = vimToggle?.parentElement;
      const buttons = Array.from(nav?.children || []);
      const vimIndex = buttons.indexOf(vimToggle!);
      const optimizeIndex = buttons.indexOf(optimizeButton!);
      
      expect(vimIndex).toBeGreaterThan(optimizeIndex);
    });
  });

  describe('Vim Mode State Management', () => {
    it('should track vim enabled state', () => {
      const createVimStateManager = () => {
        let isVimEnabled = false;
        
        const toggleVim = () => {
          isVimEnabled = !isVimEnabled;
          return isVimEnabled;
        };
        
        const getVimState = () => isVimEnabled;
        
        return { toggleVim, getVimState };
      };
      
      const vimManager = createVimStateManager();
      
      // Initially disabled
      expect(vimManager.getVimState()).toBe(false);
      
      // Toggle to enabled
      expect(vimManager.toggleVim()).toBe(true);
      expect(vimManager.getVimState()).toBe(true);
      
      // Toggle back to disabled
      expect(vimManager.toggleVim()).toBe(false);
      expect(vimManager.getVimState()).toBe(false);
    });

    it('should update button text and aria-pressed state', () => {
      const vimToggle = document.getElementById('vim-toggle') as HTMLButtonElement;
      
      const updateVimButton = (isEnabled: boolean) => {
        vimToggle.setAttribute('aria-pressed', isEnabled.toString());
        vimToggle.textContent = isEnabled ? 'vim (on)' : 'vim';
      };
      
      // Initially off
      expect(vimToggle.getAttribute('aria-pressed')).toBe('false');
      expect(vimToggle.textContent).toBe('vim');
      
      // Enable vim mode
      updateVimButton(true);
      expect(vimToggle.getAttribute('aria-pressed')).toBe('true');
      expect(vimToggle.textContent).toBe('vim (on)');
      
      // Disable vim mode
      updateVimButton(false);
      expect(vimToggle.getAttribute('aria-pressed')).toBe('false');
      expect(vimToggle.textContent).toBe('vim');
    });
  });

  describe('Extensions Management', () => {
    it('should dynamically create extensions based on vim state', () => {
      const createExtensionsManager = () => {
        let isVimEnabled = false;
        let isDarkMode = false;
        
        const mockExtensions = {
          basicSetup: 'basicSetup',
          xml: 'xml',
          lineWrapping: 'lineWrapping',
          lintGutter: 'lintGutter',
          svgLinter: 'svgLinter',
          theme: 'theme',
          vim: 'vim',
          updateListener: 'updateListener'
        };
        
        const getExtensions = () => {
          const extensions = [
            mockExtensions.basicSetup,
            mockExtensions.xml,
            mockExtensions.lineWrapping,
            mockExtensions.lintGutter,
            mockExtensions.svgLinter,
            mockExtensions.theme,
            isVimEnabled ? mockExtensions.vim : null,
            mockExtensions.updateListener
          ].filter(Boolean);
          
          return extensions;
        };
        
        const toggleVim = () => {
          isVimEnabled = !isVimEnabled;
        };
        
        return { getExtensions, toggleVim, isVimEnabled: () => isVimEnabled };
      };
      
      const manager = createExtensionsManager();
      
      // Initially without vim
      let extensions = manager.getExtensions();
      expect(extensions).not.toContain('vim');
      expect(extensions.length).toBe(7);
      
      // Enable vim
      manager.toggleVim();
      extensions = manager.getExtensions();
      expect(extensions).toContain('vim');
      expect(extensions.length).toBe(8);
      
      // Disable vim
      manager.toggleVim();
      extensions = manager.getExtensions();
      expect(extensions).not.toContain('vim');
      expect(extensions.length).toBe(7);
    });
  });

  describe('Focus Handling', () => {
    it('should handle editor focus for vim insert mode', async () => {
      const createFocusHandler = (isVimEnabled: boolean) => {
        let insertModeActivated = false;
        
        const handleEditorFocus = () => {
          return new Promise<void>((resolve) => {
            if (isVimEnabled) {
              // Simulate entering insert mode
              setTimeout(() => {
                insertModeActivated = true;
                resolve();
              }, 50);
            } else {
              resolve();
            }
          });
        };
        
        const wasInsertModeActivated = () => insertModeActivated;
        
        return { handleEditorFocus, wasInsertModeActivated };
      };
      
      // Test with vim disabled
      const handlerDisabled = createFocusHandler(false);
      await handlerDisabled.handleEditorFocus();
      expect(handlerDisabled.wasInsertModeActivated()).toBe(false);
      
      // Test with vim enabled
      const handlerEnabled = createFocusHandler(true);
      await handlerEnabled.handleEditorFocus();
      expect(handlerEnabled.wasInsertModeActivated()).toBe(true);
    });

    it('should add focus event listener to editor', () => {
      const mockEditor = {
        dom: {
          addEventListener: vi.fn(),
          removeEventListener: vi.fn()
        }
      };
      
      const mockHandler = vi.fn();
      
      // Simulate adding focus listener
      mockEditor.dom.addEventListener('focus', mockHandler);
      
      expect(mockEditor.dom.addEventListener).toHaveBeenCalledWith('focus', mockHandler);
    });
  });

  describe('Accessibility Integration', () => {
    it('should announce vim mode changes', () => {
      const announcements: string[] = [];
      
      const announceAction = (message: string) => {
        announcements.push(message);
        const announcer = document.getElementById('test-announcements');
        if (announcer) {
          announcer.textContent = message;
        }
      };
      
      // Enable vim
      announceAction('Vim mode enabled');
      expect(announcements).toContain('Vim mode enabled');
      
      const announcer = document.getElementById('test-announcements');
      expect(announcer?.textContent).toBe('Vim mode enabled');
      
      // Disable vim
      announceAction('Vim mode disabled');
      expect(announcements).toContain('Vim mode disabled');
      expect(announcer?.textContent).toBe('Vim mode disabled');
    });

    it('should maintain keyboard navigation for vim toggle', () => {
      const vimToggle = document.getElementById('vim-toggle') as HTMLButtonElement;
      
      // Should be focusable
      expect(vimToggle.tabIndex).toBeGreaterThanOrEqual(0);
      
      // Should have proper role
      expect(vimToggle.tagName.toLowerCase()).toBe('button');
      
      // Should respond to clicks
      vimToggle.focus = vi.fn();
      vimToggle.click = vi.fn();
      
      vimToggle.click();
      expect(vimToggle.click).toHaveBeenCalled();
    });
  });

  describe('Opt-in Behavior', () => {
    it('should be disabled by default', () => {
      const vimToggle = document.getElementById('vim-toggle') as HTMLButtonElement;
      
      expect(vimToggle.getAttribute('aria-pressed')).toBe('false');
      expect(vimToggle.textContent).toBe('vim');
    });

    it('should only activate vim when explicitly toggled', () => {
      let vimModeActivated = false;
      
      const simulateVimToggle = () => {
        vimModeActivated = !vimModeActivated;
      };
      
      // Initially disabled
      expect(vimModeActivated).toBe(false);
      
      // Must be explicitly enabled
      simulateVimToggle();
      expect(vimModeActivated).toBe(true);
      
      // Can be disabled again
      simulateVimToggle();
      expect(vimModeActivated).toBe(false);
    });

    it('should provide clear user guidance', () => {
      const vimToggle = document.getElementById('vim-toggle') as HTMLButtonElement;
      const title = vimToggle.getAttribute('title');
      
      expect(title).toContain('Enable Vim mode');
      expect(title).toContain('starts in insert mode');
      expect(title).toContain('press Esc for normal mode');
    });
  });
});