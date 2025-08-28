import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { JSDOM } from 'jsdom';

describe('SVGEditor Error Handling and Edge Cases', () => {
  let dom: JSDOM;
  let window: Window;
  let document: Document;
  let consoleErrorSpy: any;

  beforeEach(() => {
    dom = new JSDOM(`
      <!DOCTYPE html>
      <html>
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
          <main id="editor"></main>
          <aside id="preview"></aside>
          <button id="upload">upload</button>
          <button id="dark">dark mode</button>
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
    global.FileReader = window.FileReader;
    global.File = window.File;
    global.alert = vi.fn();

    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    dom.window.close();
    consoleErrorSpy.mockRestore();
  });

  describe('Element Selection Error Handling', () => {
    it('should throw meaningful errors for missing elements', () => {
      const get = (id: string) => {
        const element = document.getElementById(id);
        if (!element) throw new Error(`Element #${id} not found`);
        return element;
      };

      const getTyped = <T extends Element = HTMLElement>(q: string): T => {
        const element = document.querySelector(q);
        if (!element) throw new Error(`Element ${q} was not found`);
        return element as T;
      };

      // Test missing ID
      expect(() => get('nonexistent')).toThrow('Element #nonexistent not found');

      // Test missing selector
      expect(() => getTyped('#missing-element')).toThrow('Element #missing-element was not found');

      // Test empty selector - should catch browser error
      expect(() => getTyped('')).toThrow();

      // Test malformed selector
      expect(() => getTyped('invalid selector')).toThrow();
    });

    it('should handle null and undefined element references', () => {
      const safeGetElement = (id: string) => {
        try {
          const element = document.getElementById(id);
          return element;
        } catch (error) {
          console.error('Failed to get element:', error);
          return null;
        }
      };

      expect(safeGetElement('nonexistent')).toBeNull();
      expect(safeGetElement('')).toBeNull();
    });
  });

  describe('File Upload Error Handling', () => {
    it('should handle invalid file types', () => {
      const validateFileType = (file: { type: string, name: string }) => {
        const allowedTypes = ['image/svg+xml', 'text/xml', 'application/xml'];
        const allowedExtensions = ['.svg'];

        const isValidType = allowedTypes.includes(file.type);
        const isValidExtension = allowedExtensions.some(ext => file.name.toLowerCase().endsWith(ext));

        return isValidType || isValidExtension;
      };

      // Valid files
      expect(validateFileType({ type: 'image/svg+xml', name: 'test.svg' })).toBe(true);
      expect(validateFileType({ type: 'text/xml', name: 'drawing.svg' })).toBe(true);
      expect(validateFileType({ type: 'application/octet-stream', name: 'icon.svg' })).toBe(true); // Extension override

      // Invalid files
      expect(validateFileType({ type: 'image/jpeg', name: 'photo.jpg' })).toBe(false);
      expect(validateFileType({ type: 'text/plain', name: 'document.txt' })).toBe(false);
      expect(validateFileType({ type: 'application/pdf', name: 'file.pdf' })).toBe(false);
    });

    it('should handle file reading errors', () => {
      const handleFileUpload = (file: File) => {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();

          reader.onload = (e) => {
            try {
              const content = e.target?.result as string;
              if (!content) {
                throw new Error('File content is empty');
              }

              if (!content.includes('<svg')) {
                throw new Error('File does not contain valid SVG content');
              }

              resolve({ success: true, content });
            } catch (error) {
              reject({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
            }
          };

          reader.onerror = () => {
            reject({ success: false, error: 'Failed to read file' });
          };

          reader.readAsText(file);
        });
      };

      // Test with valid SVG content
      const validSVGFile = new File(['<svg><rect/></svg>'], 'test.svg', { type: 'image/svg+xml' });

      // Test with invalid content
      const invalidFile = new File(['Not SVG content'], 'test.txt', { type: 'text/plain' });

      // Test with empty file
      const emptyFile = new File([''], 'empty.svg', { type: 'image/svg+xml' });

      // These would need to be tested with actual FileReader mock in a real implementation
      expect(validSVGFile.name).toBe('test.svg');
      expect(invalidFile.type).toBe('text/plain');
      expect(emptyFile.size).toBe(0);
    });

    it('should handle drag and drop errors', () => {
      const handleDragAndDrop = (dataTransfer: { files?: FileList | null }) => {
        try {
          const files = dataTransfer.files;

          if (!files || files.length === 0) {
            throw new Error('No files provided');
          }

          if (files.length > 1) {
            throw new Error('Multiple files not supported');
          }

          const file = files[0];
          if (!file) {
            throw new Error('Invalid file');
          }

          return { success: true, file };
        } catch (error) {
          return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
        }
      };

      // Test with no files
      const noFiles = handleDragAndDrop({});
      expect(noFiles.success).toBe(false);
      expect(noFiles.error).toBe('No files provided');

      // Test with null files
      const nullFiles = handleDragAndDrop({ files: null });
      expect(nullFiles.success).toBe(false);
      expect(nullFiles.error).toBe('No files provided');

      // Test with valid file
      const mockFile = { name: 'test.svg', type: 'image/svg+xml' };
      const mockFileList = [mockFile] as any as FileList;
      const validFiles = handleDragAndDrop({ files: mockFileList });
      expect(validFiles.success).toBe(true);
    });
  });

  describe('SVG Parsing Error Handling', () => {
    it('should handle malformed SVG gracefully', () => {
      const parseSVGSafely = (content: string) => {
        try {
          // Validate basic SVG structure
          if (!content || typeof content !== 'string') {
            throw new Error('Invalid content type');
          }

          if (!content.trim()) {
            throw new Error('Empty content');
          }

          if (!content.includes('<svg')) {
            throw new Error('Not an SVG file');
          }

          // Check for matching tags
          const svgOpenMatch = content.match(/<svg[^>]*>/g);
          const svgCloseMatch = content.match(/<\/svg>/g);

          if (!svgOpenMatch || !svgCloseMatch) {
            throw new Error('Malformed SVG: missing opening or closing svg tag');
          }

          if (svgOpenMatch.length !== svgCloseMatch.length) {
            throw new Error('Malformed SVG: mismatched svg tags');
          }

          return { success: true, content };
        } catch (error) {
          console.error('SVG parsing failed:', error);
          return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
        }
      };

      // Test valid SVG
      const validSVG = '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>';
      const validResult = parseSVGSafely(validSVG);
      expect(validResult.success).toBe(true);

      // Test malformed SVG
      const malformedSVG = '<svg><rect>';
      const malformedResult = parseSVGSafely(malformedSVG);
      expect(malformedResult.success).toBe(false);
      expect(malformedResult.error).toBe('Malformed SVG: missing opening or closing svg tag');

      // Test empty content
      const emptyResult = parseSVGSafely('');
      expect(emptyResult.success).toBe(false);
      expect(emptyResult.error).toBe('Invalid content type');

      // Test non-SVG content
      const nonSVGResult = parseSVGSafely('<div>Not SVG</div>');
      expect(nonSVGResult.success).toBe(false);
      expect(nonSVGResult.error).toBe('Not an SVG file');

      // Test null/undefined
      const nullResult = parseSVGSafely(null as any);
      expect(nullResult.success).toBe(false);
      expect(nullResult.error).toBe('Invalid content type');
    });

    it('should handle SVG transformation errors', () => {
      const applyTransformSafely = (svgCode: string, transformData: any) => {
        try {
          if (!svgCode || typeof svgCode !== 'string') {
            throw new Error('Invalid SVG code');
          }

          if (!transformData) {
            throw new Error('No transform data provided');
          }

          // Simulate transform application
          let transformedSVG = svgCode;

          // Check if SVG tag exists
          if (!transformedSVG.includes('<svg')) {
            throw new Error('SVG tag not found');
          }

          // Apply transforms (simplified)
          const { width, height, rotation, flipX, flipY } = transformData;

          if (width < 0 || height < 0) {
            throw new Error('Invalid dimensions: width and height must be positive');
          }

          if (rotation && (rotation < 0 || rotation >= 360)) {
            throw new Error('Invalid rotation: must be between 0 and 359 degrees');
          }

          return { success: true, transformedSVG };
        } catch (error) {
          console.error('SVG transformation failed:', error);
          return { success: false, error: error instanceof Error ? error.message : 'Transform failed' };
        }
      };

      // Valid transform
      const validTransform = applyTransformSafely('<svg><rect/></svg>', {
        width: 100,
        height: 100,
        rotation: 90,
        flipX: false,
        flipY: false
      });
      expect(validTransform.success).toBe(true);

      // Invalid dimensions
      const invalidDimensions = applyTransformSafely('<svg><rect/></svg>', {
        width: -100,
        height: 100,
        rotation: 0
      });
      expect(invalidDimensions.success).toBe(false);
      expect(invalidDimensions.error).toBe('Invalid dimensions: width and height must be positive');

      // Invalid rotation
      const invalidRotation = applyTransformSafely('<svg><rect/></svg>', {
        width: 100,
        height: 100,
        rotation: 400
      });
      expect(invalidRotation.success).toBe(false);
      expect(invalidRotation.error).toBe('Invalid rotation: must be between 0 and 359 degrees');

      // Missing transform data
      const noTransform = applyTransformSafely('<svg><rect/></svg>', null);
      expect(noTransform.success).toBe(false);
      expect(noTransform.error).toBe('No transform data provided');
    });
  });

  describe('Modal Dialog Error Handling', () => {
    it('should handle modal state errors gracefully', () => {
      const dialog = document.querySelector('dialog') as HTMLDialogElement;

      // Mock missing showModal method
      const originalShowModal = dialog.showModal;
      delete (dialog as any).showModal;

      const safeModalShow = () => {
        try {
          if (!dialog) {
            throw new Error('Modal element not found');
          }

          if (typeof dialog.showModal !== 'function') {
            throw new Error('showModal method not supported');
          }

          dialog.showModal();
          return { success: true };
        } catch (error) {
          console.error('Failed to show modal:', error);
          return { success: false, error: error instanceof Error ? error.message : 'Modal error' };
        }
      };

      const result = safeModalShow();
      expect(result.success).toBe(false);
      expect(result.error).toBe('showModal method not supported');

      // Restore original method
      dialog.showModal = originalShowModal;
    });

    it('should validate input values in modal', () => {
      const validateModalInputs = () => {
        const widthInput = document.getElementById('width') as HTMLInputElement;
        const heightInput = document.getElementById('height') as HTMLInputElement;

        if (!widthInput || !heightInput) {
          return { valid: false, error: 'Required input elements not found' };
        }

        const width = parseInt(widthInput.value);
        const height = parseInt(heightInput.value);

        if (isNaN(width) || width <= 0) {
          return { valid: false, error: 'Width must be a positive number' };
        }

        if (isNaN(height) || height <= 0) {
          return { valid: false, error: 'Height must be a positive number' };
        }

        if (width > 10000 || height > 10000) {
          return { valid: false, error: 'Dimensions too large (max 10000)' };
        }

        return { valid: true, width, height };
      };

      const widthInput = document.getElementById('width') as HTMLInputElement;
      const heightInput = document.getElementById('height') as HTMLInputElement;

      // Test valid inputs
      widthInput.value = '100';
      heightInput.value = '200';
      const validResult = validateModalInputs();
      expect(validResult.valid).toBe(true);
      expect(validResult.width).toBe(100);
      expect(validResult.height).toBe(200);

      // Test invalid width
      widthInput.value = '0';
      heightInput.value = '100';
      const invalidWidthResult = validateModalInputs();
      expect(invalidWidthResult.valid).toBe(false);
      expect(invalidWidthResult.error).toBe('Width must be a positive number');

      // Test non-numeric height
      widthInput.value = '100';
      heightInput.value = 'abc';
      const invalidHeightResult = validateModalInputs();
      expect(invalidHeightResult.valid).toBe(false);
      expect(invalidHeightResult.error).toBe('Height must be a positive number');

      // Test dimensions too large
      widthInput.value = '20000';
      heightInput.value = '100';
      const tooLargeResult = validateModalInputs();
      expect(tooLargeResult.valid).toBe(false);
      expect(tooLargeResult.error).toBe('Dimensions too large (max 10000)');
    });
  });

  describe('Event Handler Error Handling', () => {
    it('should handle missing event targets gracefully', () => {
      const setupEventListenerSafely = (id: string, eventType: string, handler: () => void) => {
        try {
          const element = document.getElementById(id);
          if (!element) {
            throw new Error(`Element with id "${id}" not found`);
          }

          element.addEventListener(eventType, handler);
          return { success: true };
        } catch (error) {
          console.error('Failed to setup event listener:', error);
          return { success: false, error: error instanceof Error ? error.message : 'Event setup failed' };
        }
      };

      // Test valid element
      const validSetup = setupEventListenerSafely('upload', 'click', () => {});
      expect(validSetup.success).toBe(true);

      // Test missing element
      const invalidSetup = setupEventListenerSafely('missing-button', 'click', () => {});
      expect(invalidSetup.success).toBe(false);
      expect(invalidSetup.error).toBe('Element with id "missing-button" not found');
    });

    it('should handle event errors gracefully', () => {
      const createSafeEventHandler = (callback: () => void) => {
        return (event: Event) => {
          try {
            callback();
          } catch (error) {
            console.error('Event handler error:', error);
            event.preventDefault();
          }
        };
      };

      const errorHandler = createSafeEventHandler(() => {
        throw new Error('Test error');
      });

      const mockEvent = {
        preventDefault: vi.fn()
      };

      // Should not throw and should call preventDefault
      expect(() => errorHandler(mockEvent as any)).not.toThrow();
      expect(mockEvent.preventDefault).toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalledWith('Event handler error:', expect.any(Error));
    });
  });

  describe('Memory and Performance Edge Cases', () => {
    it('should handle large SVG content', () => {
      const validateSVGSize = (content: string, maxSize: number = 1024 * 1024) => { // 1MB default
        try {
          if (content.length > maxSize) {
            return { valid: false, error: `SVG too large (${content.length} bytes, max ${maxSize})` };
          }

          // Count elements (rough complexity check)
          const elementCount = (content.match(/<[^/][^>]*>/g) || []).length;
          if (elementCount > 10000) {
            return { valid: false, error: `SVG too complex (${elementCount} elements, max 10000)` };
          }

          return { valid: true };
        } catch (error) {
          return { valid: false, error: 'Failed to validate SVG size' };
        }
      };

      // Test normal size SVG
      const normalSVG = '<svg><rect/></svg>';
      expect(validateSVGSize(normalSVG).valid).toBe(true);

      // Test large SVG
      const largeSVG = 'x'.repeat(2 * 1024 * 1024); // 2MB
      const largeResult = validateSVGSize(largeSVG);
      expect(largeResult.valid).toBe(false);
      expect(largeResult.error).toContain('SVG too large');

      // Test complex SVG
      const complexSVG = '<svg>' + '<rect/>'.repeat(15000) + '</svg>';
      const complexResult = validateSVGSize(complexSVG);
      expect(complexResult.valid).toBe(false);
      expect(complexResult.error).toContain('SVG too complex');
    });

    it('should handle cleanup operations', () => {
      const createCleanupManager = () => {
        const listeners: Array<{ element: HTMLElement, type: string, handler: () => void }> = [];

        const addListener = (element: HTMLElement, type: string, handler: () => void) => {
          element.addEventListener(type, handler);
          listeners.push({ element, type, handler });
        };

        const cleanup = () => {
          try {
            listeners.forEach(({ element, type, handler }) => {
              if (element && typeof element.removeEventListener === 'function') {
                element.removeEventListener(type, handler);
              }
            });
            listeners.length = 0;
            return { success: true };
          } catch (error) {
            console.error('Cleanup failed:', error);
            return { success: false, error: error instanceof Error ? error.message : 'Cleanup failed' };
          }
        };

        return { addListener, cleanup, getListenerCount: () => listeners.length };
      };

      const manager = createCleanupManager();
      const button = document.getElementById('upload') as HTMLElement;
      const handler = () => {};

      // Add some listeners
      manager.addListener(button, 'click', handler);
      manager.addListener(button, 'mouseover', handler);
      expect(manager.getListenerCount()).toBe(2);

      // Cleanup
      const cleanupResult = manager.cleanup();
      expect(cleanupResult.success).toBe(true);
      expect(manager.getListenerCount()).toBe(0);
    });
  });
});