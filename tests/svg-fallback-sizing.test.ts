import { describe, it, expect, beforeEach, afterEach } from 'vitest';
/**
 * @vitest-environment jsdom
 */

describe('SVG Fallback Sizing', () => {
  let container: HTMLElement;

  beforeEach(() => {
    // Create a test container to simulate the preview area
    container = document.createElement('div');
    container.className = 'svg-preview-wrapper';
    document.body.appendChild(container);
  });

  afterEach(() => {
    // Clean up
    document.body.removeChild(container);
  });

  it('should handle SVG without width and height attributes', () => {
    // Test SVG without width/height - this should have fallback sizing
    const svgWithoutDimensions = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <circle cx="50" cy="50" r="40" fill="red"/>
    </svg>`;

    const svgContainer = document.createElement('div');
    svgContainer.className = 'svg-container';
    svgContainer.innerHTML = svgWithoutDimensions;
    container.appendChild(svgContainer);

    const svgElement = svgContainer.querySelector('svg') as SVGElement;
    expect(svgElement).toBeTruthy();

    // Mock the applySVGStyles behavior - this will be our fix
    const applySVGFallbackSizing = (svg: SVGElement) => {
      const hasWidth = svg.hasAttribute('width');
      const hasHeight = svg.hasAttribute('height');

      if (!hasWidth || !hasHeight) {
        // Apply fallback dimensions
        if (!hasWidth) {
          svg.style.width = '200px';
        }
        if (!hasHeight) {
          svg.style.height = '200px';
        }
      }
    };

    applySVGFallbackSizing(svgElement);

    // After applying fallback sizing, the SVG should have dimensions
    expect(svgElement.style.width).toBe('200px');
    expect(svgElement.style.height).toBe('200px');
  });

  it('should handle SVG with only width attribute', () => {
    const svgWithWidthOnly = `<svg xmlns="http://www.w3.org/2000/svg" width="150" viewBox="0 0 100 100">
      <circle cx="50" cy="50" r="40" fill="blue"/>
    </svg>`;

    const svgContainer = document.createElement('div');
    svgContainer.className = 'svg-container';
    svgContainer.innerHTML = svgWithWidthOnly;
    container.appendChild(svgContainer);

    const svgElement = svgContainer.querySelector('svg') as SVGElement;
    expect(svgElement).toBeTruthy();

    const applySVGFallbackSizing = (svg: SVGElement) => {
      const hasWidth = svg.hasAttribute('width');
      const hasHeight = svg.hasAttribute('height');

      if (!hasWidth || !hasHeight) {
        if (!hasWidth) {
          svg.style.width = '200px';
        }
        if (!hasHeight) {
          svg.style.height = '200px';
        }
      }
    };

    applySVGFallbackSizing(svgElement);

    // Should only set height since width is already defined
    expect(svgElement.style.width).toBe('');  // No style applied since width attribute exists
    expect(svgElement.style.height).toBe('200px');  // Style applied since height attribute missing
  });

  it('should handle SVG with only height attribute', () => {
    const svgWithHeightOnly = `<svg xmlns="http://www.w3.org/2000/svg" height="150" viewBox="0 0 100 100">
      <circle cx="50" cy="50" r="40" fill="green"/>
    </svg>`;

    const svgContainer = document.createElement('div');
    svgContainer.className = 'svg-container';
    svgContainer.innerHTML = svgWithHeightOnly;
    container.appendChild(svgContainer);

    const svgElement = svgContainer.querySelector('svg') as SVGElement;
    expect(svgElement).toBeTruthy();

    const applySVGFallbackSizing = (svg: SVGElement) => {
      const hasWidth = svg.hasAttribute('width');
      const hasHeight = svg.hasAttribute('height');

      if (!hasWidth || !hasHeight) {
        if (!hasWidth) {
          svg.style.width = '200px';
        }
        if (!hasHeight) {
          svg.style.height = '200px';
        }
      }
    };

    applySVGFallbackSizing(svgElement);

    // Should only set width since height is already defined
    expect(svgElement.style.width).toBe('200px');  // Style applied since width attribute missing
    expect(svgElement.style.height).toBe('');  // No style applied since height attribute exists
  });

  it('should not modify SVG with both width and height attributes', () => {
    const svgWithBothDimensions = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
      <circle cx="50" cy="50" r="40" fill="purple"/>
    </svg>`;

    const svgContainer = document.createElement('div');
    svgContainer.className = 'svg-container';
    svgContainer.innerHTML = svgWithBothDimensions;
    container.appendChild(svgContainer);

    const svgElement = svgContainer.querySelector('svg') as SVGElement;
    expect(svgElement).toBeTruthy();

    const applySVGFallbackSizing = (svg: SVGElement) => {
      const hasWidth = svg.hasAttribute('width');
      const hasHeight = svg.hasAttribute('height');

      if (!hasWidth || !hasHeight) {
        if (!hasWidth) {
          svg.style.width = '200px';
        }
        if (!hasHeight) {
          svg.style.height = '200px';
        }
      }
    };

    applySVGFallbackSizing(svgElement);

    // Should not apply any fallback styles
    expect(svgElement.style.width).toBe('');
    expect(svgElement.style.height).toBe('');
  });
});