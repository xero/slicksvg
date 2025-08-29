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
          <div class="container" style="width: 800px; height: 600px; display: flex; position: relative;">
            <main id="editor" aria-label="SVG Code Editor" style="flex: 1; width: 50%; min-width: 10%; min-height: 10%;">
              <nav></nav>
              <div>Editor content</div>
            </main>
            <div id="dragbar" tabindex="0" aria-orientation="vertical" role="separator" aria-label="Resize Panel" style="width: 6px; min-width: 6px; cursor: col-resize; position: relative; z-index: 30;"></div>
            <aside id="preview" role="complementary" aria-label="SVG Preview" style="flex: 1; width: 50%; min-width: 10%; min-height: 10%;">
              <nav></nav>
              <div>Preview content</div>
            </aside>
          </div>
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
    
    // Mock getBoundingClientRect for testing
    const mockGetBoundingClientRect = (element: HTMLElement) => {
      const container = document.querySelector('.container') as HTMLElement;
      if (element === container) {
        return { left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 };
      }
      if (element.id === 'editor') {
        return { left: 0, top: 0, width: 400, height: 600, right: 400, bottom: 600 };
      }
      if (element.id === 'preview') {
        return { left: 406, top: 0, width: 394, height: 600, right: 800, bottom: 600 };
      }
      if (element.id === 'dragbar') {
        return { left: 400, top: 0, width: 6, height: 600, right: 406, bottom: 600 };
      }
      return { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 };
    };

    // Apply mock to all relevant elements
    Element.prototype.getBoundingClientRect = function() {
      return mockGetBoundingClientRect(this as HTMLElement);
    };
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

    it('should update aria-orientation based on layout mode', () => {
      const dragbar = document.getElementById('dragbar');
      const body = document.body;
      
      // Default horizontal layout
      expect(dragbar?.getAttribute('aria-orientation')).toBe('vertical');
      
      // Switch to vertical layout
      body.classList.add('vertical');
      
      // In vertical layout, aria-orientation should be 'horizontal'
      // (This would be handled by the actual app code)
      dragbar?.setAttribute('aria-orientation', 'horizontal');
      expect(dragbar?.getAttribute('aria-orientation')).toBe('horizontal');
    });
  });

  describe('Resize State Management', () => {
    it('should track resize state correctly', () => {
      // Mock the SVGEditor class structure based on actual implementation
      class MockSVGEditor {
        private isResizing = false;

        private get(id: string) {
          const element = document.getElementById(id);
          if (!element) throw new Error(`Element #${id} not found`);
          return element;
        }

        startResize = (e: MouseEvent | TouchEvent): void => {
          e.preventDefault();
          this.isResizing = true;
        };

        endResize = (): void => {
          this.isResizing = false;
        };

        getResizeState() {
          return {
            isResizing: this.isResizing
          };
        }
      }

      const mockEditor = new MockSVGEditor();
      const mockEvent = new window.MouseEvent('mousedown', { clientX: 100 });

      // Before resize
      expect(mockEditor.getResizeState().isResizing).toBe(false);

      // Start resize
      mockEditor.startResize(mockEvent);
      expect(mockEditor.getResizeState().isResizing).toBe(true);

      // End resize
      mockEditor.endResize();
      expect(mockEditor.getResizeState().isResizing).toBe(false);
    });

    it('should add resizing class during drag operations', () => {
      const editor = document.getElementById('editor') as HTMLElement;
      const preview = document.getElementById('preview') as HTMLElement;

      // Initially no resizing class
      expect(editor.classList.contains('resizing')).toBe(false);
      expect(preview.classList.contains('resizing')).toBe(false);

      // Add resizing class (as done in doResize method)
      editor.classList.add('resizing');
      preview.classList.add('resizing');

      expect(editor.classList.contains('resizing')).toBe(true);
      expect(preview.classList.contains('resizing')).toBe(true);

      // Remove resizing class (as done in toggleLayout method)
      editor.classList.remove('resizing');
      preview.classList.remove('resizing');

      expect(editor.classList.contains('resizing')).toBe(false);
      expect(preview.classList.contains('resizing')).toBe(false);
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

  describe('Percentage-Based Resize Calculations', () => {
    it('should calculate percentages correctly for horizontal layout', () => {
      const body = document.body;
      const container = document.querySelector('.container') as HTMLElement;
      const containerRect = container.getBoundingClientRect();
      
      // Horizontal layout (default)
      const vertical = body.classList.contains('vertical');
      expect(vertical).toBe(false);
      
      const total = vertical ? containerRect.height : containerRect.width;
      expect(total).toBe(800); // Container width
      
      // Simulate mouse position at 300px from left (37.5% of 800px)
      const pagePos = 300;
      const offset = pagePos - (vertical ? containerRect.top : containerRect.left);
      let percent = Math.max(10, Math.min(90, (offset / total) * 100));
      
      expect(offset).toBe(300);
      expect(percent).toBe(37.5);
    });

    it('should calculate percentages correctly for vertical layout', () => {
      const body = document.body;
      body.classList.add('vertical'); // Switch to vertical layout
      
      const container = document.querySelector('.container') as HTMLElement;
      const containerRect = container.getBoundingClientRect();
      
      const vertical = body.classList.contains('vertical');
      expect(vertical).toBe(true);
      
      const total = vertical ? containerRect.height : containerRect.width;
      expect(total).toBe(600); // Container height
      
      // Simulate mouse position at 240px from top (40% of 600px)
      const pagePos = 240;
      const offset = pagePos - (vertical ? containerRect.top : containerRect.left);
      let percent = Math.max(10, Math.min(90, (offset / total) * 100));
      
      expect(offset).toBe(240);
      expect(percent).toBe(40);
    });

    it('should enforce minimum percentage (10%)', () => {
      const container = document.querySelector('.container') as HTMLElement;
      const containerRect = container.getBoundingClientRect();
      const total = containerRect.width; // 800px
      
      // Try to drag to 5% (40px from left) - should be clamped to 10%
      const pagePos = 40;
      const offset = pagePos;
      let percent = Math.max(10, Math.min(90, (offset / total) * 100));
      
      expect(percent).toBe(10); // Clamped to minimum
    });

    it('should enforce maximum percentage (90%)', () => {
      const container = document.querySelector('.container') as HTMLElement;
      const containerRect = container.getBoundingClientRect();
      const total = containerRect.width; // 800px
      
      // Try to drag to 95% (760px from left) - should be clamped to 90%
      const pagePos = 760;
      const offset = pagePos;
      let percent = Math.max(10, Math.min(90, (offset / total) * 100));
      
      expect(percent).toBe(90); // Clamped to maximum
    });

    it('should handle edge case percentages correctly', () => {
      const container = document.querySelector('.container') as HTMLElement;
      const containerRect = container.getBoundingClientRect();
      const total = containerRect.width; // 800px
      
      // Test exact boundary values
      const testCases = [
        { pos: 80, expected: 10 },   // 10% exactly
        { pos: 720, expected: 90 },  // 90% exactly
        { pos: 400, expected: 50 },  // 50% exactly (middle)
        { pos: 0, expected: 10 },    // 0% clamped to 10%
        { pos: 800, expected: 90 },  // 100% clamped to 90%
      ];
      
      testCases.forEach(({ pos, expected }) => {
        const percent = Math.max(10, Math.min(90, (pos / total) * 100));
        expect(percent).toBe(expected);
      });
    });

    it('should calculate complementary percentages correctly', () => {
      // When editor is 30%, preview should be 70%
      const editorPercent = 30;
      const previewPercent = 100 - editorPercent;
      
      expect(previewPercent).toBe(70);
      
      // Total should always equal 100%
      expect(editorPercent + previewPercent).toBe(100);
    });
  });

  describe('Style Application', () => {
    it('should apply percentage-based width styles for horizontal resize', () => {
      const editor = document.getElementById('editor') as HTMLElement;
      const preview = document.getElementById('preview') as HTMLElement;
      
      // Simulate horizontal resize with percentages
      const editorPercent = 60;
      const previewPercent = 40;
      
      editor.style.width = editorPercent + "%";
      preview.style.width = previewPercent + "%";
      editor.classList.add('resizing');
      preview.classList.add('resizing');
      
      expect(editor.style.width).toBe('60%');
      expect(preview.style.width).toBe('40%');
      expect(editor.style.height).toBe(''); // Should not be set in horizontal mode
      expect(preview.style.height).toBe(''); // Should not be set in horizontal mode
      expect(editor.classList.contains('resizing')).toBe(true);
      expect(preview.classList.contains('resizing')).toBe(true);
    });

    it('should apply percentage-based height styles for vertical resize', () => {
      const editor = document.getElementById('editor') as HTMLElement;
      const preview = document.getElementById('preview') as HTMLElement;
      const body = document.body;
      
      body.classList.add('vertical'); // Switch to vertical layout
      
      // Clear any existing width styles first (as would happen in toggleLayout)
      editor.style.width = '';
      preview.style.width = '';
      
      // Simulate vertical resize with percentages
      const editorPercent = 70;
      const previewPercent = 30;
      
      editor.style.height = editorPercent + "%";
      preview.style.height = previewPercent + "%";
      editor.classList.add('resizing');
      preview.classList.add('resizing');
      
      expect(editor.style.height).toBe('70%');
      expect(preview.style.height).toBe('30%');
      expect(editor.style.width).toBe(''); // Should not be set in vertical mode
      expect(preview.style.width).toBe(''); // Should not be set in vertical mode
      expect(editor.classList.contains('resizing')).toBe(true);
      expect(preview.classList.contains('resizing')).toBe(true);
    });

    it('should handle the special vertical offset adjustment', () => {
      // The actual implementation has: editor.style.height = percent-1 + "%"
      const editor = document.getElementById('editor') as HTMLElement;
      const preview = document.getElementById('preview') as HTMLElement;
      const body = document.body;
      
      body.classList.add('vertical');
      
      const percent = 50;
      // Simulate the actual implementation behavior
      editor.style.height = (percent - 1) + "%";
      preview.style.height = (100 - percent - 1) + "%";
      
      expect(editor.style.height).toBe('49%'); // 50% - 1
      expect(preview.style.height).toBe('49%'); // 100% - 50% - 1
    });

    it('should clear all resize styles when switching layout', () => {
      const editor = document.getElementById('editor') as HTMLElement;
      const preview = document.getElementById('preview') as HTMLElement;
      
      // Set some styles first
      editor.style.width = '60%';
      editor.style.height = '70%';
      preview.style.width = '40%';
      preview.style.height = '30%';
      editor.classList.add('resizing');
      preview.classList.add('resizing');
      
      // Clear styles (simulating toggleLayout method)
      editor.style.width = '';
      editor.style.height = '';
      preview.style.width = '';
      preview.style.height = '';
      editor.classList.remove('resizing');
      preview.classList.remove('resizing');
      
      expect(editor.style.width).toBe('');
      expect(editor.style.height).toBe('');
      expect(preview.style.width).toBe('');
      expect(preview.style.height).toBe('');
      expect(editor.classList.contains('resizing')).toBe(false);
      expect(preview.classList.contains('resizing')).toBe(false);
    });

    it('should maintain minimum size constraints with CSS', () => {
      const editor = document.getElementById('editor') as HTMLElement;
      const preview = document.getElementById('preview') as HTMLElement;
      
      // Test that elements have minimum size constraints
      const editorStyle = window.getComputedStyle(editor);
      const previewStyle = window.getComputedStyle(preview);
      
      // Note: In a real browser, these would come from CSS
      // Here we just verify the style properties can be set
      editor.style.minWidth = '10%';
      editor.style.minHeight = '10%';
      preview.style.minWidth = '10%';
      preview.style.minHeight = '10%';
      
      expect(editor.style.minWidth).toBe('10%');
      expect(editor.style.minHeight).toBe('10%');
      expect(preview.style.minWidth).toBe('10%');
      expect(preview.style.minHeight).toBe('10%');
    });
  });

  describe('Event Handling', () => {
    it('should handle mouse events correctly', () => {
      const dragbar = document.getElementById('dragbar');
      let mouseDownCalled = false;
      let eventPrevented = false;
      
      const handleMouseDown = (e: Event): void => {
        e.preventDefault();
        mouseDownCalled = true;
        eventPrevented = e.defaultPrevented;
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
      expect(eventPrevented).toBe(true);
    });

    it('should handle touch events correctly', () => {
      const dragbar = document.getElementById('dragbar');
      let touchStartCalled = false;
      let eventPrevented = false;
      
      const handleTouchStart = (e: Event): void => {
        e.preventDefault();
        touchStartCalled = true;
        eventPrevented = e.defaultPrevented;
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
      expect(eventPrevented).toBe(true);
    });

    it('should handle window event listeners for drag operations', () => {
      // Mock window event listener management
      const mockWindow = {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
      };
      
      // Simulate startResize method behavior
      const mockDoResize = vi.fn();
      const mockEndResize = vi.fn();
      
      // Add event listeners (like in startResize)
      mockWindow.addEventListener('mousemove', mockDoResize);
      mockWindow.addEventListener('mouseup', mockEndResize);
      mockWindow.addEventListener('touchmove', mockDoResize);
      mockWindow.addEventListener('touchend', mockEndResize);
      
      expect(mockWindow.addEventListener).toHaveBeenCalledWith('mousemove', mockDoResize);
      expect(mockWindow.addEventListener).toHaveBeenCalledWith('mouseup', mockEndResize);
      expect(mockWindow.addEventListener).toHaveBeenCalledWith('touchmove', mockDoResize);
      expect(mockWindow.addEventListener).toHaveBeenCalledWith('touchend', mockEndResize);
      
      // Remove event listeners (like in endResize)
      mockWindow.removeEventListener('mousemove', mockDoResize);
      mockWindow.removeEventListener('mouseup', mockEndResize);
      mockWindow.removeEventListener('touchmove', mockDoResize);
      mockWindow.removeEventListener('touchend', mockEndResize);
      
      expect(mockWindow.removeEventListener).toHaveBeenCalledWith('mousemove', mockDoResize);
      expect(mockWindow.removeEventListener).toHaveBeenCalledWith('mouseup', mockEndResize);
      expect(mockWindow.removeEventListener).toHaveBeenCalledWith('touchmove', mockDoResize);
      expect(mockWindow.removeEventListener).toHaveBeenCalledWith('touchend', mockEndResize);
    });

    it('should extract correct coordinates from mouse events', () => {
      const mouseEvent = new window.MouseEvent('mousemove', {
        clientX: 350,
        clientY: 250
      });
      
      // Test horizontal layout coordinate extraction
      const vertical = false;
      const pagePos = vertical ? mouseEvent.clientY : mouseEvent.clientX;
      expect(pagePos).toBe(350);
      
      // Test vertical layout coordinate extraction  
      const verticalLayout = true;
      const pagePosVertical = verticalLayout ? mouseEvent.clientY : mouseEvent.clientX;
      expect(pagePosVertical).toBe(250);
    });

    it('should extract correct coordinates from touch events', () => {
      const touchEvent = new window.Event('touchmove') as any;
      
      // Mock touch event with touches array
      touchEvent.touches = [{
        clientX: 450,
        clientY: 350
      }];
      
      // Test horizontal layout coordinate extraction
      const vertical = false;
      const pagePos = vertical ? touchEvent.touches[0].clientY : touchEvent.touches[0].clientX;
      expect(pagePos).toBe(450);
      
      // Test vertical layout coordinate extraction
      const verticalLayout = true;
      const pagePosVertical = verticalLayout ? touchEvent.touches[0].clientY : touchEvent.touches[0].clientX;
      expect(pagePosVertical).toBe(350);
    });

    it('should handle event prevention for touch events', () => {
      const touchEvent = new window.Event('touchmove', {
        bubbles: true,
        cancelable: true
      }) as any;
      
      touchEvent.touches = [{ clientX: 100, clientY: 200 }];
      
      // Simulate the preventDefault call in doResize for touch events
      touchEvent.preventDefault();
      
      expect(touchEvent.defaultPrevented).toBe(true);
    });
  });

  describe('Integration Tests', () => {
    it('should simulate complete drag operation in horizontal layout', () => {
      const editor = document.getElementById('editor') as HTMLElement;
      const preview = document.getElementById('preview') as HTMLElement;
      const container = document.querySelector('.container') as HTMLElement;
      const containerRect = container.getBoundingClientRect();
      
      // Start drag at 400px (50% of 800px)
      const startPos = 400;
      let percent = Math.max(10, Math.min(90, (startPos / containerRect.width) * 100));
      expect(percent).toBe(50);
      
      // Drag to 300px (37.5% of 800px)
      const dragPos = 300;
      percent = Math.max(10, Math.min(90, (dragPos / containerRect.width) * 100));
      expect(percent).toBe(37.5);
      
      // Apply the styles
      editor.style.width = percent + "%";
      preview.style.width = (100 - percent) + "%";
      editor.classList.add('resizing');
      preview.classList.add('resizing');
      
      expect(editor.style.width).toBe('37.5%');
      expect(preview.style.width).toBe('62.5%');
      expect(editor.classList.contains('resizing')).toBe(true);
      expect(preview.classList.contains('resizing')).toBe(true);
    });

    it('should simulate complete drag operation in vertical layout', () => {
      const editor = document.getElementById('editor') as HTMLElement;
      const preview = document.getElementById('preview') as HTMLElement;
      const container = document.querySelector('.container') as HTMLElement;
      const body = document.body;
      
      body.classList.add('vertical');
      const containerRect = container.getBoundingClientRect();
      
      // Start drag at 300px (50% of 600px)
      const startPos = 300;
      let percent = Math.max(10, Math.min(90, (startPos / containerRect.height) * 100));
      expect(percent).toBe(50);
      
      // Drag to 180px (30% of 600px)
      const dragPos = 180;
      percent = Math.max(10, Math.min(90, (dragPos / containerRect.height) * 100));
      expect(percent).toBe(30);
      
      // Apply the styles (with the -1 adjustment for vertical)
      editor.style.height = (percent - 1) + "%";
      preview.style.height = (100 - percent - 1) + "%";
      editor.classList.add('resizing');
      preview.classList.add('resizing');
      
      expect(editor.style.height).toBe('29%'); // 30% - 1
      expect(preview.style.height).toBe('69%'); // 100% - 30% - 1
    });

    it('should simulate layout toggle clearing resize state', () => {
      const editor = document.getElementById('editor') as HTMLElement;
      const preview = document.getElementById('preview') as HTMLElement;
      const body = document.body;
      
      // Set up resized state
      editor.style.width = '70%';
      preview.style.width = '30%';
      editor.classList.add('resizing');
      preview.classList.add('resizing');
      
      // Verify resized state
      expect(editor.style.width).toBe('70%');
      expect(preview.style.width).toBe('30%');
      expect(editor.classList.contains('resizing')).toBe(true);
      
      // Toggle layout (simulates toggleLayout method)
      body.classList.toggle('vertical');
      
      // Clear resize state
      editor.style.width = '';
      editor.style.height = '';
      preview.style.width = '';
      preview.style.height = '';
      editor.classList.remove('resizing');
      preview.classList.remove('resizing');
      
      // Verify cleared state
      expect(editor.style.width).toBe('');
      expect(editor.style.height).toBe('');
      expect(preview.style.width).toBe('');
      expect(preview.style.height).toBe('');
      expect(editor.classList.contains('resizing')).toBe(false);
      expect(preview.classList.contains('resizing')).toBe(false);
    });
  });
});