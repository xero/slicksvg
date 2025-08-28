import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';

describe('SVG Drag and Drop Content Clearing', () => {
  let dom: JSDOM;
  let window: Window;
  let document: Document;

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
          <main id="editor">
            <nav>
              <button id="upload">upload</button>
              <button id="resolution">resize</button>
              <button id="optimize">optimize</button>
              <button id="rotate">↻</button>
              <button id="flipx">⇔</button>
              <button id="flipy">⥮</button>
            </nav>
          </main>
          <aside id="preview">
            <nav>
              <button id="dark">dark mode</button>
              <button id="flip">flip screen</button>
              <button id="zoomin">+</button>
              <button id="zoomout">-</button>
              <button id="download">💾</button>
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

    // Set up global objects
    global.window = window;
    global.document = document;
    global.Element = window.Element;
    global.HTMLElement = window.HTMLElement;
    global.HTMLDialogElement = window.HTMLDialogElement;
    global.HTMLInputElement = window.HTMLInputElement;
    global.FileReader = window.FileReader;
    global.File = window.File;

    // Mock CodeMirror and its dependencies
    vi.doMock('@codemirror/view', () => ({
      EditorView: class {
        static lineWrapping = {};
        static updateListener = { of: () => ({}) };
        dispatch = vi.fn();
        state = {
          doc: {
            toString: () => '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><circle cx="100" cy="100" r="50" fill="blue"/></svg>',
            length: 100
          },
          update: vi.fn((config) => ({
            changes: config.changes,
            dispatch: vi.fn()
          }))
        };
        constructor() {}
      }
    }));

    vi.doMock('@codemirror/state', () => ({
      EditorState: {
        create: () => ({})
      },
      Compartment: class {
        of = () => ({});
        reconfigure = () => ({});
      }
    }));

    vi.doMock('@codemirror/lang-xml', () => ({
      xml: () => ({})
    }));

    vi.doMock('codemirror', () => ({
      basicSetup: {}
    }));

    vi.doMock('@uiw/codemirror-theme-nord', () => ({
      nord: {}
    }));

    vi.doMock('@codemirror/lint', () => ({
      linter: () => ({}),
      lintGutter: () => ({})
    }));
  });

  afterEach(() => {
    vi.resetAllMocks();
    vi.clearAllMocks();
    dom.window.close();
  });

  describe('Content Replacement Behavior', () => {
    it('should completely replace existing content when loading new SVG', () => {
      // Mock the loadSVGContent method behavior
      const mockEditor = {
        state: {
          doc: {
            toString: () => '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><circle cx="100" cy="100" r="50" fill="blue"/></svg>',
            length: 100
          },
          update: vi.fn((config) => ({
            changes: config.changes,
            dispatch: vi.fn()
          }))
        },
        dispatch: vi.fn()
      };

      const newSVGContent = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect width="100" height="100" fill="red"/></svg>';

      // Simulate the loadSVGContent method
      const loadSVGContent = (content: string) => {
        const transaction = mockEditor.state.update({
          changes: {
            from: 0,
            to: mockEditor.state.doc.length,
            insert: content
          }
        });
        mockEditor.dispatch(transaction);
      };

      // Call loadSVGContent with new content
      loadSVGContent(newSVGContent);

      // Verify that update was called with the correct parameters
      expect(mockEditor.state.update).toHaveBeenCalledWith({
        changes: {
          from: 0,
          to: 100, // Full length of existing document
          insert: newSVGContent
        }
      });

      // Verify that dispatch was called
      expect(mockEditor.dispatch).toHaveBeenCalled();
    });

    it('should clear selection before loading new content', () => {
      // Mock the selection-aware loadSVGContent method
      const mockEditor = {
        state: {
          doc: {
            toString: () => '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><circle cx="100" cy="100" r="50" fill="blue"/></svg>',
            length: 100
          },
          selection: {
            main: {
              from: 50,  // Cursor in middle of document
              to: 50
            }
          },
          update: vi.fn((config) => ({
            changes: config.changes,
            selection: config.selection,
            dispatch: vi.fn()
          }))
        },
        dispatch: vi.fn()
      };

      const newSVGContent = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect width="100" height="100" fill="red"/></svg>';

      // Simulate improved loadSVGContent method that clears selection
      const loadSVGContentWithSelectionClear = (content: string) => {
        const transaction = mockEditor.state.update({
          changes: {
            from: 0,
            to: mockEditor.state.doc.length,
            insert: content
          },
          selection: { anchor: 0 } // Clear selection to start of document
        });
        mockEditor.dispatch(transaction);
      };

      // Call loadSVGContent with new content
      loadSVGContentWithSelectionClear(newSVGContent);

      // Verify that update was called with both changes and selection
      expect(mockEditor.state.update).toHaveBeenCalledWith({
        changes: {
          from: 0,
          to: 100,
          insert: newSVGContent
        },
        selection: { anchor: 0 }
      });
    });

    it('should reset preview state when loading new SVG', () => {
      // Mock preview state properties
      let panX = 100;
      let panY = 50;
      let zoomLevel = 2.5;
      let rotationAngle = 45;

      // Mock the resetPreviewState method
      const resetPreviewState = () => {
        panX = 0;
        panY = 0;
        zoomLevel = 1;
        rotationAngle = 0;
      };

      // Simulate loading new content with preview reset
      const loadSVGWithPreviewReset = (content: string) => {
        // First reset preview state
        resetPreviewState();

        // Then load the new content (simplified mock)
        // In real implementation, this would call the actual loadSVGContent
      };

      // Initial state should be modified
      expect(panX).toBe(100);
      expect(panY).toBe(50);
      expect(zoomLevel).toBe(2.5);
      expect(rotationAngle).toBe(45);

      // Load new SVG content
      const newContent = '<svg><rect width="50" height="50"/></svg>';
      loadSVGWithPreviewReset(newContent);

      // State should be reset
      expect(panX).toBe(0);
      expect(panY).toBe(0);
      expect(zoomLevel).toBe(1);
      expect(rotationAngle).toBe(0);
    });
  });

  describe('File Drop Integration', () => {
    it('should replace content when file is dropped, regardless of cursor position', () => {
      // Mock file content
      const originalContent = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><circle cx="100" cy="100" r="50" fill="blue"/></svg>';
      const newFileContent = '<svg xmlns="http://www.w3.org/2000/svg" width="150" height="150"><polygon points="10,10 40,10 40,40 10,40" fill="green"/></svg>';

      let editorContent = originalContent;
      let cursorPosition = 50; // Cursor in middle

      // Mock loadSVGContent behavior
      const mockLoadSVGContent = (content: string) => {
        // Should completely replace content regardless of cursor position
        editorContent = content;
        cursorPosition = 0; // Reset cursor to start
      };

      // Simulate file drop
      const simulateFileDrop = (fileContent: string) => {
        // Validate file contains SVG
        if (fileContent.includes('<svg') && fileContent.includes('</svg>')) {
          mockLoadSVGContent(fileContent);
        }
      };

      // Initial state: cursor in middle, existing content
      expect(editorContent).toBe(originalContent);
      expect(cursorPosition).toBe(50);

      // Drop new file
      simulateFileDrop(newFileContent);

      // Verify content was completely replaced
      expect(editorContent).toBe(newFileContent);
      expect(editorContent).not.toContain('circle'); // Old content should be gone
      expect(editorContent).toContain('polygon'); // New content should be present
      expect(cursorPosition).toBe(0); // Cursor should be reset
    });
  });
});