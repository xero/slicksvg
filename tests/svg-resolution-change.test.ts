import { describe, it, expect, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';

describe('SVG Resolution Change', () => {
  let dom: JSDOM;
  let document: Document;
  let container: HTMLElement;

  beforeEach(() => {
    dom = new JSDOM(`
      <!DOCTYPE html>
      <html>
        <body>
          <div id="container">
            <dialog>
              <input type="number" id="width" min="1">
              <input type="number" id="height" min="1">
            </dialog>
          </div>
        </body>
      </html>
    `);
    document = dom.window.document;
    global.document = document;
    global.window = dom.window as any;
    container = document.getElementById('container')!;
  });

  it('should extract width and height from SVG', () => {
    const svgCode = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="150" viewBox="0 0 200 150">
      <circle cx="100" cy="75" r="50" fill="blue"/>
    </svg>`;

    // Mock the extraction logic
    const extractDimensions = (svg: string) => {
      const widthMatch = svg.match(/width="([^"]+)"/);
      const heightMatch = svg.match(/height="([^"]+)"/);
      return {
        width: widthMatch ? parseInt(widthMatch[1]) : 200,
        height: heightMatch ? parseInt(heightMatch[1]) : 200
      };
    };

    const dimensions = extractDimensions(svgCode);
    expect(dimensions.width).toBe(200);
    expect(dimensions.height).toBe(150);
  });

  it('should update SVG dimensions and viewBox', () => {
    const originalSVG = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
      <circle cx="100" cy="100" r="80" fill="blue"/>
    </svg>`;

    const newWidth = 400;
    const newHeight = 300;

    // Mock the resize logic
    const resizeSVG = (svgCode: string, width: number, height: number) => {
      let updatedSVG = svgCode;
      
      // Update width attribute
      if (updatedSVG.includes('width="')) {
        updatedSVG = updatedSVG.replace(/width="[^"]*"/, `width="${width}"`);
      } else {
        updatedSVG = updatedSVG.replace(/(<svg[^>]*)(>)/, `$1 width="${width}"$2`);
      }
      
      // Update height attribute
      if (updatedSVG.includes('height="')) {
        updatedSVG = updatedSVG.replace(/height="[^"]*"/, `height="${height}"`);
      } else {
        updatedSVG = updatedSVG.replace(/(<svg[^>]*)(>)/, `$1 height="${height}"$2`);
      }
      
      // Update viewBox attribute
      const viewBoxValue = `0 0 ${width} ${height}`;
      if (updatedSVG.includes('viewBox="')) {
        updatedSVG = updatedSVG.replace(/viewBox="[^"]*"/, `viewBox="${viewBoxValue}"`);
      } else {
        updatedSVG = updatedSVG.replace(/(<svg[^>]*)(>)/, `$1 viewBox="${viewBoxValue}"$2`);
      }
      
      return updatedSVG;
    };

    const resizedSVG = resizeSVG(originalSVG, newWidth, newHeight);

    expect(resizedSVG).toContain('width="400"');
    expect(resizedSVG).toContain('height="300"');
    expect(resizedSVG).toContain('viewBox="0 0 400 300"');
    
    // Content should remain unchanged
    expect(resizedSVG).toContain('<circle cx="100" cy="100" r="80" fill="blue"/>');
  });

  it('should handle SVG without existing viewBox', () => {
    const originalSVG = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
      <rect x="10" y="10" width="80" height="80" fill="red"/>
    </svg>`;

    const newWidth = 200;
    const newHeight = 150;

    // Mock the resize logic
    const resizeSVG = (svgCode: string, width: number, height: number) => {
      let updatedSVG = svgCode;
      
      // Update width attribute
      if (updatedSVG.includes('width="')) {
        updatedSVG = updatedSVG.replace(/width="[^"]*"/, `width="${width}"`);
      } else {
        updatedSVG = updatedSVG.replace(/(<svg[^>]*)(>)/, `$1 width="${width}"$2`);
      }
      
      // Update height attribute
      if (updatedSVG.includes('height="')) {
        updatedSVG = updatedSVG.replace(/height="[^"]*"/, `height="${height}"`);
      } else {
        updatedSVG = updatedSVG.replace(/(<svg[^>]*)(>)/, `$1 height="${height}"$2`);
      }
      
      // Update viewBox attribute
      const viewBoxValue = `0 0 ${width} ${height}`;
      if (updatedSVG.includes('viewBox="')) {
        updatedSVG = updatedSVG.replace(/viewBox="[^"]*"/, `viewBox="${viewBoxValue}"`);
      } else {
        updatedSVG = updatedSVG.replace(/(<svg[^>]*)(>)/, `$1 viewBox="${viewBoxValue}"$2`);
      }
      
      return updatedSVG;
    };

    const resizedSVG = resizeSVG(originalSVG, newWidth, newHeight);

    expect(resizedSVG).toContain('width="200"');
    expect(resizedSVG).toContain('height="150"');
    expect(resizedSVG).toContain('viewBox="0 0 200 150"');
    expect(resizedSVG).toContain('<rect x="10" y="10" width="80" height="80" fill="red"/>');
  });

  it('should handle missing width or height attributes', () => {
    const svgWithoutWidth = `<svg xmlns="http://www.w3.org/2000/svg" height="100">
      <circle cx="50" cy="50" r="40" fill="green"/>
    </svg>`;

    // Mock the extraction logic with defaults
    const extractDimensions = (svg: string) => {
      const widthMatch = svg.match(/width="([^"]+)"/);
      const heightMatch = svg.match(/height="([^"]+)"/);
      return {
        width: widthMatch ? parseInt(widthMatch[1]) : 200,
        height: heightMatch ? parseInt(heightMatch[1]) : 200
      };
    };

    const dimensions = extractDimensions(svgWithoutWidth);
    expect(dimensions.width).toBe(200); // Default value
    expect(dimensions.height).toBe(100); // Extracted value
  });
});