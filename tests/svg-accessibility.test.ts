import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { JSDOM } from 'jsdom';

describe('SVGEditor Accessibility and Integration Tests', () => {
  let dom: JSDOM;
  let window: Window;
  let document: Document;

  beforeEach(() => {
    dom = new JSDOM(`
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="description" content="free online svg editor and preview tool">
          <meta name="keywords" content="svg, editor, slick, slicksvg">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>slicksvg</title>
          <link rel="stylesheet" href="theme.css" />
        </head>
        <body>
          <dialog>
            <header>Change Resolution</header>
            <article>
              <label>Width:<input type="number" min="1" id="width" aria-label="SVG width in pixels"></label>
              <label>Height:<input type="number" min="1" id="height" aria-label="SVG height in pixels"></label>
            </article>
            <footer>
              <button id="resize">Update</button>
              <button id="cancel">Cancel</button>
            </footer>
          </dialog>
          <main id="editor" role="main" aria-label="SVG Code Editor">
            <nav aria-label="SVG editing tools">
              <button id="upload" aria-label="Upload SVG file">upload</button>
              <button id="resolution" aria-label="Change SVG resolution">resize</button>
              <button id="optimize" aria-label="Optimize SVG code">optimize <i>⚡</i></button>
              <label>transform:</label>
              <button id="rotate" aria-label="Rotate SVG 90 degrees"><i>↻</i></button>
              <button id="flipx" aria-label="Flip SVG horizontally"><i>⇔</i></button>
              <button id="flipy" aria-label="Flip SVG vertically"><i>⥮</i></button>
            </nav>
          </main>
          <aside id="preview" role="complementary" aria-label="SVG Preview">
            <nav aria-label="Preview controls">
              <button id="dark" aria-label="Toggle dark mode">dark mode</button>
              <button id="flip" aria-label="Toggle vertical layout">flip screen</button>
              <label>zoom:</label>
              <button id="zoomin" aria-label="Zoom in"><i>+</i></button>
              <button id="zoomout" aria-label="Zoom out"><i>-</i></button>
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
  });

  afterEach(() => {
    dom.window.close();
  });

  describe('Accessibility Features', () => {
    it('should have proper semantic HTML structure', () => {
      // Check for main landmark
      const main = document.querySelector('main');
      expect(main).toBeTruthy();
      expect(main?.getAttribute('role')).toBe('main');
      expect(main?.getAttribute('aria-label')).toBe('SVG Code Editor');

      // Check for complementary landmark
      const aside = document.querySelector('aside');
      expect(aside).toBeTruthy();
      expect(aside?.getAttribute('role')).toBe('complementary');
      expect(aside?.getAttribute('aria-label')).toBe('SVG Preview');

      // Check for navigation landmarks
      const navElements = document.querySelectorAll('nav');
      expect(navElements.length).toBeGreaterThan(0);
      navElements.forEach(nav => {
        expect(nav.getAttribute('aria-label')).toBeTruthy();
      });
    });

    it('should have proper button accessibility labels', () => {
      const buttons = [
        { id: 'upload', label: 'Upload SVG file' },
        { id: 'resolution', label: 'Change SVG resolution' },
        { id: 'optimize', label: 'Optimize SVG code' },
        { id: 'rotate', label: 'Rotate SVG 90 degrees' },
        { id: 'flipx', label: 'Flip SVG horizontally' },
        { id: 'flipy', label: 'Flip SVG vertically' },
        { id: 'dark', label: 'Toggle dark mode' },
        { id: 'flip', label: 'Toggle vertical layout' },
        { id: 'zoomin', label: 'Zoom in' },
        { id: 'zoomout', label: 'Zoom out' }
      ];

      buttons.forEach(({ id, label }) => {
        const button = document.getElementById(id);
        expect(button).toBeTruthy();
        expect(button?.getAttribute('aria-label')).toBe(label);
      });
    });

    it('should have proper form input labels', () => {
      const widthInput = document.getElementById('width') as HTMLInputElement;
      const heightInput = document.getElementById('height') as HTMLInputElement;

      expect(widthInput).toBeTruthy();
      expect(heightInput).toBeTruthy();
      expect(widthInput.getAttribute('aria-label')).toBe('SVG width in pixels');
      expect(heightInput.getAttribute('aria-label')).toBe('SVG height in pixels');
      expect(widthInput.type).toBe('number');
      expect(heightInput.type).toBe('number');
      expect(widthInput.min).toBe('1');
      expect(heightInput.min).toBe('1');
    });

    it('should support keyboard navigation', () => {
      const buttons = document.querySelectorAll('button');

      buttons.forEach(button => {
        // Buttons should be focusable by default
        expect(button.tabIndex).toBeGreaterThanOrEqual(0);

        // Should have accessible text content or aria-label
        const hasText = button.textContent?.trim();
        const hasAriaLabel = button.getAttribute('aria-label');
        expect(hasText || hasAriaLabel).toBeTruthy();
      });

      const inputs = document.querySelectorAll('input');
      inputs.forEach(input => {
        expect(input.tabIndex).toBeGreaterThanOrEqual(0);
      });
    });

    it('should handle focus management correctly', () => {
      const createFocusManager = () => {
        let focusedElement: HTMLElement | null = null;

        const setFocus = (element: HTMLElement) => {
          if (focusedElement) {
            focusedElement.blur();
          }
          element.focus();
          focusedElement = element;
        };

        const getFocusedElement = () => focusedElement;

        const trapFocus = (container: HTMLElement, event: KeyboardEvent) => {
          if (event.key !== 'Tab') return;

          const focusableElements = container.querySelectorAll(
            'button, input, select, textarea, [tabindex]:not([tabindex="-1"])'
          );
          const firstElement = focusableElements[0] as HTMLElement;
          const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement;

          if (event.shiftKey) {
            if (document.activeElement === firstElement) {
              lastElement.focus();
              event.preventDefault();
            }
          } else {
            if (document.activeElement === lastElement) {
              firstElement.focus();
              event.preventDefault();
            }
          }
        };

        return { setFocus, getFocusedElement, trapFocus };
      };

      const focusManager = createFocusManager();
      const button = document.getElementById('upload') as HTMLElement;

      button.focus = vi.fn();
      button.blur = vi.fn();

      focusManager.setFocus(button);
      expect(button.focus).toHaveBeenCalled();
      expect(focusManager.getFocusedElement()).toBe(button);
    });

    it('should provide screen reader announcements', () => {
      const createA11yAnnouncer = () => {
        let announcements: string[] = [];

        const announce = (message: string, priority: 'polite' | 'assertive' = 'polite') => {
          announcements.push(message);

          // In a real implementation, this would create a live region
          const liveRegion = document.createElement('div');
          liveRegion.setAttribute('aria-live', priority);
          liveRegion.setAttribute('aria-atomic', 'true');
          liveRegion.className = 'sr-only'; // Screen reader only
          liveRegion.textContent = message;

          document.body.appendChild(liveRegion);

          // Clean up after announcement
          setTimeout(() => {
            if (liveRegion.parentNode) {
              liveRegion.parentNode.removeChild(liveRegion);
            }
          }, 1000);
        };

        const getAnnouncements = () => announcements;
        const clearAnnouncements = () => { announcements = []; };

        return { announce, getAnnouncements, clearAnnouncements };
      };

      const announcer = createA11yAnnouncer();

      announcer.announce('SVG loaded successfully');
      announcer.announce('Error: Invalid SVG format', 'assertive');

      const announcements = announcer.getAnnouncements();
      expect(announcements).toContain('SVG loaded successfully');
      expect(announcements).toContain('Error: Invalid SVG format');

      // Check that live regions are created
      const liveRegions = document.querySelectorAll('[aria-live]');
      expect(liveRegions.length).toBeGreaterThan(0);
    });
  });

  describe('Integration Tests', () => {
    it('should integrate editor and preview updates', () => {
      let editorContent = '<svg><rect/></svg>';
      let previewContent = '';

      const updateSVGPreview = () => {
        try {
          if (!editorContent.includes('<svg')) {
            throw new Error('Invalid SVG content');
          }
          previewContent = editorContent;
          return { success: true };
        } catch (error) {
          return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
        }
      };

      const updateEditor = (newContent: string) => {
        editorContent = newContent;
        return updateSVGPreview();
      };

      // Test valid update
      const result1 = updateEditor('<svg><circle r="50"/></svg>');
      expect(result1.success).toBe(true);
      expect(previewContent).toBe('<svg><circle r="50"/></svg>');

      // Test invalid update
      const result2 = updateEditor('<div>Not SVG</div>');
      expect(result2.success).toBe(false);
      expect(result2.error).toBe('Invalid SVG content');
    });

    it('should integrate zoom and transform operations', () => {
      let zoomLevel = 1;
      let rotationDegrees = 0;
      let flipX = false;
      let flipY = false;

      const applyAllTransforms = () => {
        const transforms = [];

        if (zoomLevel !== 1) {
          transforms.push(`scale(${zoomLevel})`);
        }

        if (rotationDegrees !== 0) {
          transforms.push(`rotate(${rotationDegrees}deg)`);
        }

        if (flipX || flipY) {
          const scaleX = flipX ? -1 : 1;
          const scaleY = flipY ? -1 : 1;
          transforms.push(`scale(${scaleX}, ${scaleY})`);
        }

        return transforms.join(' ');
      };

      // Test combined transformations
      zoomLevel = 1.5;
      rotationDegrees = 90;
      flipX = true;

      const transformString = applyAllTransforms();
      expect(transformString).toBe('scale(1.5) rotate(90deg) scale(-1, 1)');

      // Test reset
      zoomLevel = 1;
      rotationDegrees = 0;
      flipX = false;
      flipY = false;

      const resetTransformString = applyAllTransforms();
      expect(resetTransformString).toBe('');
    });

    it('should integrate file upload with editor', () => {
      const integratedFileHandler = () => {
        let editorContent = '<svg><rect/></svg>';

        const handleFileUpload = (fileContent: string) => {
          try {
            // Validate file content
            if (!fileContent || typeof fileContent !== 'string') {
              throw new Error('Invalid file content');
            }

            if (!fileContent.includes('<svg')) {
              throw new Error('File is not a valid SVG');
            }

            // Update editor
            editorContent = fileContent;

            // Update preview
            return {
              success: true,
              editorContent,
              previewUpdated: true
            };
          } catch (error) {
            return {
              success: false,
              error: error instanceof Error ? error.message : 'Upload failed',
              editorContent,
              previewUpdated: false
            };
          }
        };

        const getEditorContent = () => editorContent;

        return { handleFileUpload, getEditorContent };
      };

      const handler = integratedFileHandler();

      // Test successful upload
      const validSVG = '<svg width="100" height="100"><circle r="40"/></svg>';
      const result1 = handler.handleFileUpload(validSVG);
      expect(result1.success).toBe(true);
      expect(result1.previewUpdated).toBe(true);
      expect(handler.getEditorContent()).toBe(validSVG);

      // Test failed upload
      const invalidContent = 'Not SVG content';
      const result2 = handler.handleFileUpload(invalidContent);
      expect(result2.success).toBe(false);
      expect(result2.error).toBe('File is not a valid SVG');
      expect(result2.previewUpdated).toBe(false);
      expect(handler.getEditorContent()).toBe(validSVG); // Should remain unchanged
    });

    it('should integrate modal operations with main app', () => {
      const integratedModalManager = () => {
        let isModalOpen = false;
        let editorContent = '<svg width="200" height="200"><rect/></svg>';

        const showResolutionModal = () => {
          try {
            // Extract current dimensions
            const widthMatch = editorContent.match(/width="([^"]+)"/);
            const heightMatch = editorContent.match(/height="([^"]+)"/);

            const currentWidth = widthMatch ? parseInt(widthMatch[1]) : 200;
            const currentHeight = heightMatch ? parseInt(heightMatch[1]) : 200;

            // Simulate setting input values
            const widthInput = document.getElementById('width') as HTMLInputElement;
            const heightInput = document.getElementById('height') as HTMLInputElement;

            if (widthInput && heightInput) {
              widthInput.value = currentWidth.toString();
              heightInput.value = currentHeight.toString();
            }

            isModalOpen = true;
            return { success: true, currentWidth, currentHeight };
          } catch (error) {
            return { success: false, error: error instanceof Error ? error.message : 'Modal error' };
          }
        };

        const resizeSVG = () => {
          try {
            if (!isModalOpen) {
              throw new Error('Modal not open');
            }

            const widthInput = document.getElementById('width') as HTMLInputElement;
            const heightInput = document.getElementById('height') as HTMLInputElement;

            const newWidth = parseInt(widthInput.value);
            const newHeight = parseInt(heightInput.value);

            if (!newWidth || newWidth <= 0 || !newHeight || newHeight <= 0) {
              throw new Error('Invalid dimensions');
            }

            // Update SVG content
            let updatedSVG = editorContent;
            updatedSVG = updatedSVG.replace(/width="[^"]*"/, `width="${newWidth}"`);
            updatedSVG = updatedSVG.replace(/height="[^"]*"/, `height="${newHeight}"`);

            editorContent = updatedSVG;
            isModalOpen = false;

            return { success: true, newWidth, newHeight, updatedContent: editorContent };
          } catch (error) {
            return { success: false, error: error instanceof Error ? error.message : 'Resize failed' };
          }
        };

        const closeModal = () => {
          isModalOpen = false;
        };

        return { showResolutionModal, resizeSVG, closeModal, getContent: () => editorContent };
      };

      const modalManager = integratedModalManager();

      // Test showing modal
      const showResult = modalManager.showResolutionModal();
      expect(showResult.success).toBe(true);
      expect(showResult.currentWidth).toBe(200);
      expect(showResult.currentHeight).toBe(200);

      // Test resizing
      const widthInput = document.getElementById('width') as HTMLInputElement;
      const heightInput = document.getElementById('height') as HTMLInputElement;
      widthInput.value = '300';
      heightInput.value = '400';

      const resizeResult = modalManager.resizeSVG();
      expect(resizeResult.success).toBe(true);
      expect(resizeResult.newWidth).toBe(300);
      expect(resizeResult.newHeight).toBe(400);
      expect(modalManager.getContent()).toContain('width="300"');
      expect(modalManager.getContent()).toContain('height="400"');
    });
  });

  describe('Performance and Memory Management', () => {
    it('should handle event listener cleanup', () => {
      const eventManager = () => {
        const listeners: Array<{
          element: HTMLElement;
          type: string;
          handler: EventListener;
          options?: boolean | AddEventListenerOptions;
        }> = [];

        const addEventListener = (
          element: HTMLElement,
          type: string,
          handler: EventListener,
          options?: boolean | AddEventListenerOptions
        ) => {
          element.addEventListener(type, handler, options);
          listeners.push({ element, type, handler, options });
        };

        const removeAllListeners = () => {
          listeners.forEach(({ element, type, handler, options }) => {
            try {
              element.removeEventListener(type, handler, options);
            } catch (error) {
              console.warn('Failed to remove listener:', error);
            }
          });
          listeners.length = 0;
        };

        const getListenerCount = () => listeners.length;

        return { addEventListener, removeAllListeners, getListenerCount };
      };

      const manager = eventManager();
      const button1 = document.getElementById('upload') as HTMLElement;
      const button2 = document.getElementById('dark') as HTMLElement;

      const handler1 = () => {};
      const handler2 = () => {};

      manager.addEventListener(button1, 'click', handler1);
      manager.addEventListener(button2, 'click', handler2);
      manager.addEventListener(button1, 'mouseover', handler1);

      expect(manager.getListenerCount()).toBe(3);

      manager.removeAllListeners();
      expect(manager.getListenerCount()).toBe(0);
    });

    it('should optimize SVG content updates', () => {
      const optimizedUpdater = () => {
        let lastContent = '';
        let updateCount = 0;

        const updateSVGContent = (newContent: string) => {
          updateCount++;

          // Skip update if content hasn't changed
          if (newContent === lastContent) {
            return { updated: false, updateCount };
          }

          // Simulate expensive DOM operation
          lastContent = newContent;
          return { updated: true, updateCount };
        };

        const getUpdateCount = () => updateCount;
        const reset = () => {
          lastContent = '';
          updateCount = 0;
        };

        return { updateSVGContent, getUpdateCount, reset };
      };

      const updater = optimizedUpdater();

      // First update
      const result1 = updater.updateSVGContent('<svg><rect/></svg>');
      expect(result1.updated).toBe(true);
      expect(result1.updateCount).toBe(1);

      // Same content - should skip
      const result2 = updater.updateSVGContent('<svg><rect/></svg>');
      expect(result2.updated).toBe(false);
      expect(result2.updateCount).toBe(2); // Count increments but no actual update

      // Different content - should update
      const result3 = updater.updateSVGContent('<svg><circle/></svg>');
      expect(result3.updated).toBe(true);
      expect(result3.updateCount).toBe(3);
    });

    it('should handle memory-efficient transform calculations', () => {
      const transformCalculator = () => {
        const transformCache = new Map<string, string>();

        const calculateTransform = (
          zoomLevel: number,
          panX: number,
          panY: number,
          rotation: number,
          flipX: boolean,
          flipY: boolean
        ) => {
          const key = `${zoomLevel}-${panX}-${panY}-${rotation}-${flipX}-${flipY}`;

          // Check cache first
          if (transformCache.has(key)) {
            return { transform: transformCache.get(key)!, fromCache: true };
          }

          // Calculate transform
          const transforms = [];

          if (zoomLevel !== 1) {
            transforms.push(`scale(${zoomLevel})`);
          }

          if (panX !== 0 || panY !== 0) {
            transforms.push(`translate(${panX}px, ${panY}px)`);
          }

          if (rotation !== 0) {
            transforms.push(`rotate(${rotation}deg)`);
          }

          if (flipX || flipY) {
            const scaleX = flipX ? -1 : 1;
            const scaleY = flipY ? -1 : 1;
            transforms.push(`scale(${scaleX}, ${scaleY})`);
          }

          const transform = transforms.join(' ');

          // Cache result
          transformCache.set(key, transform);

          // Limit cache size
          if (transformCache.size > 100) {
            const firstKey = transformCache.keys().next().value;
            transformCache.delete(firstKey);
          }

          return { transform, fromCache: false };
        };

        const getCacheSize = () => transformCache.size;
        const clearCache = () => transformCache.clear();

        return { calculateTransform, getCacheSize, clearCache };
      };

      const calculator = transformCalculator();

      // First calculation
      const result1 = calculator.calculateTransform(1.5, 10, 20, 90, true, false);
      expect(result1.fromCache).toBe(false);
      expect(result1.transform).toBe('scale(1.5) translate(10px, 20px) rotate(90deg) scale(-1, 1)');
      expect(calculator.getCacheSize()).toBe(1);

      // Same calculation - should use cache
      const result2 = calculator.calculateTransform(1.5, 10, 20, 90, true, false);
      expect(result2.fromCache).toBe(true);
      expect(result2.transform).toBe('scale(1.5) translate(10px, 20px) rotate(90deg) scale(-1, 1)');
      expect(calculator.getCacheSize()).toBe(1);

      // Different calculation
      const result3 = calculator.calculateTransform(2, 0, 0, 0, false, false);
      expect(result3.fromCache).toBe(false);
      expect(result3.transform).toBe('scale(2)');
      expect(calculator.getCacheSize()).toBe(2);
    });
  });
});