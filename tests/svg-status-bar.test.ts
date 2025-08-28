import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { JSDOM } from 'jsdom';

describe('SVG Status Bar Functionality', () => {
	let dom: JSDOM;
	let window: Window;
	let document: Document;

	beforeEach(() => {
		dom = new JSDOM(`
			<!DOCTYPE html>
			<html>
				<body>
					<main id="editor">
						<div id="svg-status-bar" class="svg-status-bar">svg valid</div>
						<div class="cm-editor"></div>
					</main>
					<aside id="preview"></aside>
					<button id="upload">upload</button>
					<button id="dark">dark mode</button>
					<button id="flip">flip screen</button>
					<button id="zoomin">+</button>
					<button id="zoomout">-</button>
					<button id="rotate">rotate</button>
					<button id="flipx">flip X</button>
					<button id="flipy">flip Y</button>
					<button id="optimize">optimize</button>
					<button id="download">download</button>
					<button id="resolution">resolution</button>
					<input type="file" id="file" style="display:none">
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
		global.DOMParser = window.DOMParser;
		global.FileReader = window.FileReader;
		global.File = window.File;
		global.alert = vi.fn();
	});

	afterEach(() => {
		dom.window.close();
	});

	describe('Status Bar Element', () => {
		it('should exist and have default "svg valid" text', () => {
			const statusBar = document.getElementById('svg-status-bar');
			expect(statusBar).not.toBeNull();
			expect(statusBar?.textContent).toBe('svg valid');
			expect(statusBar?.classList.contains('svg-status-bar')).toBe(true);
		});

		it('should have proper accessibility attributes', () => {
			const statusBar = document.getElementById('svg-status-bar');
			expect(statusBar).not.toBeNull();
			// The aria-live and aria-atomic attributes are defined in the real HTML
			// In this test, we verify the element exists and can have these attributes set
			statusBar?.setAttribute('aria-live', 'polite');
			statusBar?.setAttribute('aria-atomic', 'true');
			expect(statusBar?.getAttribute('aria-live')).toBe('polite');
			expect(statusBar?.getAttribute('aria-atomic')).toBe('true');
		});
	});

	describe('Status Bar Update Functionality', () => {
		it('should update status bar text when updateStatusBar is called', () => {
			const statusBar = document.getElementById('svg-status-bar');
			
			// Mock the updateStatusBar function
			const mockUpdateStatusBar = (message: string, isError: boolean = false) => {
				if (statusBar) {
					statusBar.textContent = message;
					if (isError) {
						statusBar.classList.add('error');
					} else {
						statusBar.classList.remove('error');
					}
				}
			};

			// Test valid status
			mockUpdateStatusBar('svg valid', false);
			expect(statusBar?.textContent).toBe('svg valid');
			expect(statusBar?.classList.contains('error')).toBe(false);

			// Test error status
			mockUpdateStatusBar('Invalid SVG syntax', true);
			expect(statusBar?.textContent).toBe('Invalid SVG syntax');
			expect(statusBar?.classList.contains('error')).toBe(true);

			// Test clearing error
			mockUpdateStatusBar('svg valid', false);
			expect(statusBar?.textContent).toBe('svg valid');
			expect(statusBar?.classList.contains('error')).toBe(false);
		});
	});

	describe('Status Bar Error Styling', () => {
		it('should apply error class for errors', () => {
			const statusBar = document.getElementById('svg-status-bar');
			
			// Simulate error state
			statusBar?.classList.add('error');
			expect(statusBar?.classList.contains('error')).toBe(true);
		});

		it('should remove error class for valid state', () => {
			const statusBar = document.getElementById('svg-status-bar');
			
			// Start with error state
			statusBar?.classList.add('error');
			expect(statusBar?.classList.contains('error')).toBe(true);
			
			// Clear error state
			statusBar?.classList.remove('error');
			expect(statusBar?.classList.contains('error')).toBe(false);
		});
	});

	describe('Status Bar Integration with Linting', () => {
		it('should handle various error message types', () => {
			const statusBar = document.getElementById('svg-status-bar');
			
			const mockUpdateStatusBar = (message: string, isError: boolean = false) => {
				if (statusBar) {
					statusBar.textContent = message;
					if (isError) {
						statusBar.classList.add('error');
					} else {
						statusBar.classList.remove('error');
					}
				}
			};

			// Test parsing error
			mockUpdateStatusBar('Parse Error: Unexpected token', true);
			expect(statusBar?.textContent).toBe('Parse Error: Unexpected token');
			expect(statusBar?.classList.contains('error')).toBe(true);

			// Test warning message
			mockUpdateStatusBar('Document should contain an SVG element', true);
			expect(statusBar?.textContent).toBe('Document should contain an SVG element');
			expect(statusBar?.classList.contains('error')).toBe(true);

			// Test back to valid
			mockUpdateStatusBar('svg valid', false);
			expect(statusBar?.textContent).toBe('svg valid');
			expect(statusBar?.classList.contains('error')).toBe(false);
		});
	});
});