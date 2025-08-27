import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { JSDOM } from 'jsdom';

describe('SVGEditor Core Functionality', () => {
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
          <dialog>
            <header>Change Resolution</header>
            <article>
              <label>Width:<input type="number" min="1" id="width"></label>
              <label>Height:<input type="number" min="1" id="height"></label>
            </article>
            <footer>
              <button id="resize">Update</button>
              <button id="cancel">Cancel</button>
            </footer>
          </dialog>
          <main id="editor">
            <nav>
              <button id="upload">upload</button>
              <button id="resolution">resize</button>
              <button id="optimize">optimize <i>⚡</i></button>
              <label>transform:</label>
              <button id="rotate"><i>↻</i></button>
              <button id="flipx"><i>⇔</i></button>
              <button id="flipy"><i>⥮</i></button>
            </nav>
          </main>
          <aside id="preview">
            <nav>
              <button id="dark">dark mode</button>
              <button id="flip">flip screen</button>
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
    global.MouseEvent = window.MouseEvent;
    global.TouchEvent = window.TouchEvent;
  });

  afterEach(() => {
    dom.window.close();
  });

  describe('Element Selection and Error Handling', () => {
    it('should find elements by ID correctly', () => {
      const get = (id: string) => {
        const element = document.getElementById(id);
        if (!element) throw new Error(`Element #${id} not found`);
        return element;
      };

      expect(get('editor')).toBeTruthy();
      expect(get('preview')).toBeTruthy();
      expect(get('dark')).toBeTruthy();
      expect(() => get('nonexistent')).toThrow('Element #nonexistent not found');
    });

    it('should find elements by selector correctly', () => {
      const getTyped = <T extends Element = HTMLElement>(q: string): T => {
        const element = document.querySelector(q);
        if (!element) throw new Error(`Element ${q} was not found`);
        return element as T;
      };

      expect(getTyped('dialog')).toBeTruthy();
      expect(getTyped('#editor')).toBeTruthy();
      expect(() => getTyped('#nonexistent')).toThrow('Element #nonexistent was not found');
    });
  });

  describe('Theme and Mode Switching', () => {
    it('should handle dark mode toggle correctly', () => {
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

    it('should handle layout toggle correctly', () => {
      const body = document.body;
      let isVerticalLayout = false;

      const toggleLayout = () => {
        isVerticalLayout = !isVerticalLayout;
        body.classList.toggle('vertical');
      };

      // Initially horizontal layout
      expect(body.classList.contains('vertical')).toBe(false);
      expect(isVerticalLayout).toBe(false);

      // Toggle to vertical layout
      toggleLayout();
      expect(body.classList.contains('vertical')).toBe(true);
      expect(isVerticalLayout).toBe(true);

      // Toggle back to horizontal layout
      toggleLayout();
      expect(body.classList.contains('vertical')).toBe(false);
      expect(isVerticalLayout).toBe(false);
    });
  });

  describe('Zoom Controls', () => {
    it('should handle zoom in correctly', () => {
      let zoomLevel = 1;

      const zoomIn = () => {
        zoomLevel = Math.min(zoomLevel * 1.2, 50);
      };

      // Test normal zoom in
      zoomIn();
      expect(zoomLevel).toBeCloseTo(1.2, 2);

      // Test multiple zoom ins
      for (let i = 0; i < 10; i++) {
        zoomIn();
      }
      expect(zoomLevel).toBeCloseTo(7.43, 2);

      // Test zoom limit
      zoomLevel = 49;
      zoomIn();
      expect(zoomLevel).toBe(50); // Should be capped at 50
    });

    it('should handle zoom out correctly', () => {
      let zoomLevel = 1;

      const zoomOut = () => {
        zoomLevel = Math.max(zoomLevel / 1.2, 0.1);
      };

      // Test normal zoom out
      zoomOut();
      expect(zoomLevel).toBeCloseTo(0.833, 3);

      // Test multiple zoom outs
      for (let i = 0; i < 10; i++) {
        zoomOut();
      }
      expect(zoomLevel).toBeCloseTo(0.134, 2);

      // Test zoom limit
      zoomLevel = 0.12;
      zoomOut();
      expect(zoomLevel).toBe(0.1); // Should be capped at 0.1
    });

    it('should respect zoom limits', () => {
      const applyZoomLimits = (level: number) => Math.max(0.1, Math.min(level, 50));

      expect(applyZoomLimits(0.05)).toBe(0.1);
      expect(applyZoomLimits(100)).toBe(50);
      expect(applyZoomLimits(25)).toBe(25);
      expect(applyZoomLimits(0.5)).toBe(0.5);
    });
  });

  describe('Pan Controls', () => {
    it('should handle pan start correctly', () => {
      let isPanning = false;
      let lastPanX = 0;
      let lastPanY = 0;

      const startPan = (e: { clientX: number, clientY: number, preventDefault: () => void }) => {
        isPanning = true;
        lastPanX = e.clientX;
        lastPanY = e.clientY;
        e.preventDefault();
      };

      const mockEvent = {
        clientX: 100,
        clientY: 200,
        preventDefault: vi.fn()
      };

      startPan(mockEvent);

      expect(isPanning).toBe(true);
      expect(lastPanX).toBe(100);
      expect(lastPanY).toBe(200);
      expect(mockEvent.preventDefault).toHaveBeenCalled();
    });

    it('should handle pan movement correctly', () => {
      let isPanning = true;
      let panX = 0;
      let panY = 0;
      let lastPanX = 100;
      let lastPanY = 200;

      const doPan = (e: { clientX: number, clientY: number, preventDefault: () => void }) => {
        if (!isPanning) return;

        const deltaX = e.clientX - lastPanX;
        const deltaY = e.clientY - lastPanY;

        panX += deltaX;
        panY += deltaY;

        lastPanX = e.clientX;
        lastPanY = e.clientY;

        e.preventDefault();
      };

      const mockEvent = {
        clientX: 150,
        clientY: 250,
        preventDefault: vi.fn()
      };

      doPan(mockEvent);

      expect(panX).toBe(50);
      expect(panY).toBe(50);
      expect(lastPanX).toBe(150);
      expect(lastPanY).toBe(250);
      expect(mockEvent.preventDefault).toHaveBeenCalled();

      // Test when not panning
      isPanning = false;
      const initialPanX = panX;
      const initialPanY = panY;
      
      doPan(mockEvent);
      expect(panX).toBe(initialPanX); // Should not change
      expect(panY).toBe(initialPanY); // Should not change
    });

    it('should handle pan end correctly', () => {
      let isPanning = true;

      const endPan = () => {
        isPanning = false;
      };

      endPan();
      expect(isPanning).toBe(false);
    });
  });

  describe('Modal Dialog Controls', () => {
    it('should handle modal open state correctly', () => {
      const modal = document.querySelector('dialog') as HTMLDialogElement;
      
      // Mock the open property since JSDOM doesn't fully support dialog
      Object.defineProperty(modal, 'open', {
        value: false,
        writable: true
      });

      const modalIsOpen = () => modal.open;

      expect(modalIsOpen()).toBe(false);

      modal.open = true;
      expect(modalIsOpen()).toBe(true);
    });

    it('should handle modal show correctly', () => {
      const modal = document.querySelector('dialog') as HTMLDialogElement;
      modal.showModal = vi.fn();
      modal.classList.remove = vi.fn();
      
      Object.defineProperty(modal, 'open', {
        value: false,
        writable: true
      });

      const modalIsOpen = () => modal.open;
      const modalShow = () => {
        modal.classList.remove('closing');
        if (!modalIsOpen()) {
          modal.showModal();
        }
      };

      modalShow();
      expect(modal.classList.remove).toHaveBeenCalledWith('closing');
      expect(modal.showModal).toHaveBeenCalled();
    });

    it('should handle modal close correctly', () => {
      vi.useFakeTimers();
      
      const modal = document.querySelector('dialog') as HTMLDialogElement;
      modal.close = vi.fn();
      modal.classList.add = vi.fn();
      modal.classList.remove = vi.fn();

      const modalClose = () => {
        modal.classList.add('closing');
        setTimeout(() => {
          modal.classList.remove('closing');
          modal.close();
        }, 700);
      };

      modalClose();
      expect(modal.classList.add).toHaveBeenCalledWith('closing');
      
      // Fast forward time to test the timeout
      vi.runAllTimers();
      expect(modal.classList.remove).toHaveBeenCalledWith('closing');
      expect(modal.close).toHaveBeenCalled();
      
      vi.useRealTimers();
    });
  });

  describe('Touch and Pinch Zoom', () => {
    it('should calculate pinch distance correctly', () => {
      const calculatePinchDistance = (touch1: { clientX: number, clientY: number }, touch2: { clientX: number, clientY: number }) => {
        const dx = touch1.clientX - touch2.clientX;
        const dy = touch1.clientY - touch2.clientY;
        return Math.sqrt(dx * dx + dy * dy);
      };

      // Test horizontal distance
      expect(calculatePinchDistance(
        { clientX: 100, clientY: 100 },
        { clientX: 200, clientY: 100 }
      )).toBe(100);

      // Test vertical distance
      expect(calculatePinchDistance(
        { clientX: 100, clientY: 100 },
        { clientX: 100, clientY: 200 }
      )).toBe(100);

      // Test diagonal distance (3-4-5 triangle)
      expect(calculatePinchDistance(
        { clientX: 0, clientY: 0 },
        { clientX: 3, clientY: 4 }
      )).toBe(5);
    });

    it('should handle touch start for pinch zoom', () => {
      let isMultiTouch = false;
      let initialPinchDistance = 0;
      let initialZoomLevel = 1;

      const calculatePinchDistance = (touch1: any, touch2: any) => {
        const dx = touch1.clientX - touch2.clientX;
        const dy = touch1.clientY - touch2.clientY;
        return Math.sqrt(dx * dx + dy * dy);
      };

      const handleTouchStart = (e: { touches: any[], preventDefault: () => void }) => {
        if (e.touches.length === 2) {
          isMultiTouch = true;
          initialPinchDistance = calculatePinchDistance(e.touches[0], e.touches[1]);
          initialZoomLevel = 1;
          e.preventDefault();
        } else {
          isMultiTouch = false;
        }
      };

      const mockTouchEvent = {
        touches: [
          { clientX: 100, clientY: 100 },
          { clientX: 200, clientY: 100 }
        ],
        preventDefault: vi.fn()
      };

      handleTouchStart(mockTouchEvent);

      expect(isMultiTouch).toBe(true);
      expect(initialPinchDistance).toBe(100);
      expect(initialZoomLevel).toBe(1);
      expect(mockTouchEvent.preventDefault).toHaveBeenCalled();

      // Test single touch
      const singleTouchEvent = {
        touches: [{ clientX: 100, clientY: 100 }],
        preventDefault: vi.fn()
      };

      handleTouchStart(singleTouchEvent);
      expect(isMultiTouch).toBe(false);
    });

    it('should handle touch move for pinch zoom', () => {
      let isMultiTouch = true;
      let initialPinchDistance = 100;
      let initialZoomLevel = 1;
      let zoomLevel = 1;

      const calculatePinchDistance = (touch1: any, touch2: any) => {
        const dx = touch1.clientX - touch2.clientX;
        const dy = touch1.clientY - touch2.clientY;
        return Math.sqrt(dx * dx + dy * dy);
      };

      const handleTouchMove = (e: { touches: any[], preventDefault: () => void }) => {
        if (isMultiTouch && e.touches.length === 2) {
          const currentDistance = calculatePinchDistance(e.touches[0], e.touches[1]);
          const scale = currentDistance / initialPinchDistance;
          const newZoomLevel = initialZoomLevel * scale;
          zoomLevel = Math.max(0.1, Math.min(newZoomLevel, 50));
          e.preventDefault();
        }
      };

      const mockTouchEvent = {
        touches: [
          { clientX: 100, clientY: 100 },
          { clientX: 300, clientY: 100 }  // Distance of 200, scale of 2
        ],
        preventDefault: vi.fn()
      };

      handleTouchMove(mockTouchEvent);

      expect(zoomLevel).toBe(2);
      expect(mockTouchEvent.preventDefault).toHaveBeenCalled();

      // Test with zoom limits
      isMultiTouch = true;
      initialPinchDistance = 100;
      initialZoomLevel = 40;

      const limitTouchEvent = {
        touches: [
          { clientX: 100, clientY: 100 },
          { clientX: 250, clientY: 100 }  // Distance of 150, scale of 1.5, would result in 60 but should cap at 50
        ],
        preventDefault: vi.fn()
      };

      handleTouchMove(limitTouchEvent);
      expect(zoomLevel).toBe(50); // Should be capped
    });
  });
});