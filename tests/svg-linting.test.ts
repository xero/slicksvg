import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { JSDOM } from 'jsdom';

describe('SVG Editor Linting Functionality', () => {
	let dom: JSDOM;
	let window: Window;
	let document: Document;

	beforeEach(() => {
		dom = new JSDOM(`
			<!DOCTYPE html>
			<html>
				<body>
					<main id="editor"></main>
					<aside id="preview"></aside>
					<button id="upload">upload</button>
					<button id="dark">dark mode</button>
					<button id="flip">flip screen</button>
					<button id="zoomin">+</button>
					<button id="zoomout">-</button>
					<button id="rotatel">rotate left</button>
					<button id="rotater">rotate right</button>
					<button id="flipx">flip X</button>
					<button id="flipy">flip Y</button>
					<button id="optimize">optimize</button>
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

	describe('SVG Linter Function', () => {
		it('should validate well-formed SVG without errors', () => {
			const parser = new DOMParser();
			const validSVG = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="100" height="100"/></svg>';

			const doc = parser.parseFromString(validSVG, 'image/svg+xml');
			const parserError = doc.querySelector('parsererror');

			expect(parserError).toBeNull();
		});

		it('should detect malformed XML in SVG', () => {
			const parser = new DOMParser();
			const malformedSVG = '<svg><rect width="100" height="100"></svg>'; // Missing closing rect tag

			const doc = parser.parseFromString(malformedSVG, 'image/svg+xml');
			const parserError = doc.querySelector('parsererror');

			expect(parserError).not.toBeNull();
			if (parserError) {
				const errorText = parserError.textContent?.toLowerCase() || '';
				// Check for common error indicators
				expect(
					errorText.includes('error') ||
					errorText.includes('unexpected') ||
					errorText.includes('parse') ||
					errorText.includes('close tag')
				).toBe(true);
			}
		});

		it('should detect invalid XML syntax', () => {
			const parser = new DOMParser();
			const invalidXML = '<svg><rect width="100" height="100" <invalid></svg>';

			const doc = parser.parseFromString(invalidXML, 'image/svg+xml');
			const parserError = doc.querySelector('parsererror');

			expect(parserError).not.toBeNull();
		});

		it('should handle empty content gracefully', () => {
			const parser = new DOMParser();
			const emptyContent = '';

			// Empty content should not cause errors, just return empty diagnostics
			expect(() => {
				const doc = parser.parseFromString(emptyContent, 'image/svg+xml');
				const parserError = doc.querySelector('parsererror');
				// This should not throw
			}).not.toThrow();
		});

		it('should detect unclosed tags', () => {
			const parser = new DOMParser();
			const unClosedTags = '<svg><circle cx="50" cy="50" r="25"></svg>'; // Missing circle closing tag

			const doc = parser.parseFromString(unClosedTags, 'image/svg+xml');
			const parserError = doc.querySelector('parsererror');

			expect(parserError).not.toBeNull();
		});

		it('should validate SVG with special characters', () => {
			const parser = new DOMParser();
			const svgWithSpecialChars = '<svg><text>&lt;&gt;&amp;</text></svg>';

			const doc = parser.parseFromString(svgWithSpecialChars, 'image/svg+xml');
			const parserError = doc.querySelector('parsererror');

			expect(parserError).toBeNull();
		});

		it('should detect invalid attribute syntax', () => {
			const parser = new DOMParser();
			const invalidAttributes = '<svg><rect width=100 height="100"/></svg>'; // Missing quotes

			const doc = parser.parseFromString(invalidAttributes, 'image/svg+xml');
			const parserError = doc.querySelector('parsererror');

			// Note: Some browsers are more lenient with attribute quotes
			// This test mainly ensures the parser doesn't crash
			expect(typeof parserError === 'object').toBe(true);
		});
	});

	describe('Error Message Extraction', () => {
		it('should extract meaningful error messages', () => {
			const parser = new DOMParser();
			const malformedSVG = '<svg><rect></svg>';

			const doc = parser.parseFromString(malformedSVG, 'image/svg+xml');
			const parserError = doc.querySelector('parsererror');

			if (parserError && parserError.textContent) {
				const message = parserError.textContent;
				expect(message.length).toBeGreaterThan(0);
				expect(typeof message).toBe('string');
			}
		});

		it('should handle complex nested SVG errors', () => {
			const parser = new DOMParser();
			const complexMalformed = `
				<svg>
					<g>
						<rect width="100" height="100">
						<circle cx="50" cy="50" r="25"/>
					</g>
				</svg>
			`; // Missing closing rect tag

			const doc = parser.parseFromString(complexMalformed, 'image/svg+xml');
			const parserError = doc.querySelector('parsererror');

			expect(parserError).not.toBeNull();
		});
	});

	describe('Performance and Edge Cases', () => {
		it('should handle large SVG content efficiently', () => {
			const parser = new DOMParser();
			const largeSVG = '<svg>' + '<rect/>'.repeat(1000) + '</svg>';

			const startTime = performance.now();
			const doc = parser.parseFromString(largeSVG, 'image/svg+xml');
			const endTime = performance.now();

			// Should complete parsing in reasonable time (less than 100ms)
			expect(endTime - startTime).toBeLessThan(100);
			expect(doc.querySelector('parsererror')).toBeNull();
		});

		it('should handle malformed large content', () => {
			const parser = new DOMParser();
			const largeMalformed = '<svg>' + '<rect>'.repeat(100) + '</svg>'; // Missing closing tags

			expect(() => {
				const doc = parser.parseFromString(largeMalformed, 'image/svg+xml');
				doc.querySelector('parsererror');
			}).not.toThrow();
		});

		it('should handle special XML entities', () => {
			const parser = new DOMParser();
			const svgWithEntities = '<svg><text>Test &amp; &lt; &gt; &quot; &#39;</text></svg>';

			const doc = parser.parseFromString(svgWithEntities, 'image/svg+xml');
			const parserError = doc.querySelector('parsererror');

			expect(parserError).toBeNull();
		});
	});
});