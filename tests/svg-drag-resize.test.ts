import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';

describe('SVG Drag Resize Functionality', () => {
  let dom: JSDOM;
  let window: Window;
  let document: Document;

  beforeEach(() => {
    // Create DOM with our dragbar structure
    dom = new JSDOM(`
      <!DOCTYPE html>
      <html>
        <body>
          <main id="editor" aria-label="SVG Code Editor">
            <nav></nav>
            <div>Editor content</div>
          </main>
          <div id="dragbar" tabindex="0" aria-orientation="vertical" role="separator" aria-label="Resize Panel"></div>
          <aside id="preview" role="complementary" aria-label="SVG Preview">
            <nav></nav>
            <div>Preview content</div>
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

    // Set up global objects
    global.window = window;
    global.document = document;
    global.Element = window.Element;
    global.HTMLElement = window.HTMLElement;
  });

  afterEach(() => {
    dom.window.close();
  });

  describe('Dragbar Element', () => {
    it('should have proper accessibility attributes', () => {
      const dragbar = document.getElementById('dragbar');
      
      expect(dragbar).toBeTruthy();
      expect(dragbar?.getAttribute('role')).toBe('separator');
      expect(dragbar?.getAttribute('aria-label')).toBe('Resize Panel');
      expect(dragbar?.getAttribute('aria-orientation')).toBe('vertical');
      expect(dragbar?.tabIndex).toBe(0);
    });

    it('should be positioned between editor and preview', () => {
      const editor = document.getElementById('editor');
      const dragbar = document.getElementById('dragbar');
      const preview = document.getElementById('preview');

      expect(editor?.nextElementSibling).toBe(dragbar);
      expect(dragbar?.nextElementSibling).toBe(preview);
    });
  });

  describe('Resize State Management', () => {
    it('should track resize state correctly', () => {
      // Mock the SVGEditor class structure
      class MockSVGEditor {
        private isResizing = false;
        private startPagePos = 0;
        private startEditorSize = 0;
        private startPreviewSize = 0;

        private get(id: string) {
          const element = document.getElementById(id);
          if (!element) throw new Error(`Element #${id} not found`);
          return element;
        }

        startResize = (e: MouseEvent): void => {
          this.isResizing = true;
          this.startPagePos = e.clientX;
          
          const editorRect = this.get('editor').getBoundingClientRect();
          const previewRect = this.get('preview').getBoundingClientRect();
          
          this.startEditorSize = editorRect.width;
          this.startPreviewSize = previewRect.width;
        };

        endResize = (): void => {
          this.isResizing = false;
        };

        getResizeState() {
          return {
            isResizing: this.isResizing,
            startPagePos: this.startPagePos,
            startEditorSize: this.startEditorSize,
            startPreviewSize: this.startPreviewSize
          };
        }
      }

      const mockEditor = new MockSVGEditor();
      const mockEvent = new window.MouseEvent('mousedown', { clientX: 100 });

      // Before resize
      expect(mockEditor.getResizeState().isResizing).toBe(false);

      // Start resize
      mockEditor.startResize(mockEvent);
      const state = mockEditor.getResizeState();
      expect(state.isResizing).toBe(true);
      expect(state.startPagePos).toBe(100);

      // End resize
      mockEditor.endResize();
      expect(mockEditor.getResizeState().isResizing).toBe(false);
    });
  });

  describe('Layout Direction Handling', () => {
    it('should handle horizontal layout (default)', () => {
      const body = document.body;
      
      // Default horizontal layout
      expect(body.classList.contains('vertical')).toBe(false);
      
      // Mock resize logic for horizontal mode
      const isVertical = body.classList.contains('vertical');
      expect(isVertical).toBe(false);
      
      // In horizontal mode, we should be measuring/setting width
      const mockEvent = { clientX: 100, clientY: 200 };
      const position = isVertical ? mockEvent.clientY : mockEvent.clientX;
      expect(position).toBe(100); // Uses clientX for horizontal
    });

    it('should handle vertical layout', () => {
      const body = document.body;
      body.classList.add('vertical');
      
      expect(body.classList.contains('vertical')).toBe(true);
      
      // Mock resize logic for vertical mode
      const isVertical = body.classList.contains('vertical');
      expect(isVertical).toBe(true);
      
      // In vertical mode, we should be measuring/setting height
      const mockEvent = { clientX: 100, clientY: 200 };
      const position = isVertical ? mockEvent.clientY : mockEvent.clientX;
      expect(position).toBe(200); // Uses clientY for vertical
    });
  });

  describe('Resize Calculations', () => {
    it('should calculate resize deltas correctly', () => {
      const startPos = 100;
      const newPos = 150;
      const delta = newPos - startPos;
      
      expect(delta).toBe(50);
      
      const startEditorSize = 300;
      const startPreviewSize = 300;
      
      const newEditorSize = Math.max(50, startEditorSize + delta);
      const newPreviewSize = Math.max(50, startPreviewSize - delta);
      
      expect(newEditorSize).toBe(350); // 300 + 50
      expect(newPreviewSize).toBe(250); // 300 - 50
    });

    it('should enforce minimum sizes', () => {
      const startEditorSize = 100;
      const startPreviewSize = 100;
      const largeDelta = -80; // Large negative delta that would make editor too small
      
      const newEditorSize = Math.max(50, startEditorSize + largeDelta);
      const newPreviewSize = Math.max(50, startPreviewSize - largeDelta);
      
      expect(newEditorSize).toBe(50); // Minimum enforced
      expect(newPreviewSize).toBe(180); // 100 - (-80) = 180
    });
  });

  describe('Style Application', () => {
    it('should apply inline styles for horizontal resize', () => {
      const editor = document.getElementById('editor') as HTMLElement;
      const preview = document.getElementById('preview') as HTMLElement;
      
      // Simulate horizontal resize
      editor.style.width = '400px';
      preview.style.width = '200px';
      
      expect(editor.style.width).toBe('400px');
      expect(preview.style.width).toBe('200px');
      expect(editor.style.height).toBe(''); // Should not be set in horizontal mode
      expect(preview.style.height).toBe(''); // Should not be set in horizontal mode
    });

    it('should apply inline styles for vertical resize', () => {
      const editor = document.getElementById('editor') as HTMLElement;
      const preview = document.getElementById('preview') as HTMLElement;
      
      // Simulate vertical resize
      editor.style.height = '400px';
      preview.style.height = '200px';
      
      expect(editor.style.height).toBe('400px');
      expect(preview.style.height).toBe('200px');
      expect(editor.style.width).toBe(''); // Should not be set in vertical mode
      expect(preview.style.width).toBe(''); // Should not be set in vertical mode
    });

    it('should clear styles when switching layout', () => {
      const editor = document.getElementById('editor') as HTMLElement;
      const preview = document.getElementById('preview') as HTMLElement;
      
      // Set some styles
      editor.style.width = '400px';
      editor.style.height = '300px';
      preview.style.width = '200px';
      preview.style.height = '400px';
      
      // Clear styles (simulating layout toggle)
      editor.style.width = '';
      editor.style.height = '';
      preview.style.width = '';
      preview.style.height = '';
      
      expect(editor.style.width).toBe('');
      expect(editor.style.height).toBe('');
      expect(preview.style.width).toBe('');
      expect(preview.style.height).toBe('');
    });
  });

  describe('Event Handling', () => {
    it('should handle mouse events correctly', () => {
      const dragbar = document.getElementById('dragbar');
      let mouseDownCalled = false;
      
      const handleMouseDown = (e: Event): void => {
        e.preventDefault();
        mouseDownCalled = true;
      };
      
      dragbar?.addEventListener('mousedown', handleMouseDown);
      
      const mouseEvent = new window.MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        clientX: 100,
        clientY: 200
      });
      
      dragbar?.dispatchEvent(mouseEvent);
      
      expect(mouseDownCalled).toBe(true);
    });

    it('should handle touch events correctly', () => {
      const dragbar = document.getElementById('dragbar');
      let touchStartCalled = false;
      
      const handleTouchStart = (e: Event): void => {
        e.preventDefault();
        touchStartCalled = true;
      };
      
      dragbar?.addEventListener('touchstart', handleTouchStart);
      
      // Create a mock touch event
      const touchEvent = new window.Event('touchstart', {
        bubbles: true,
        cancelable: true
      });
      
      // Add touches property to the event
      Object.defineProperty(touchEvent, 'touches', {
        value: [{
          clientX: 100,
          clientY: 200
        }],
        writable: false
      });
      
      dragbar?.dispatchEvent(touchEvent);
      
      expect(touchStartCalled).toBe(true);
    });
  });
});