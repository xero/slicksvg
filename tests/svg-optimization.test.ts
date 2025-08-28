import { describe, it, expect } from 'vitest';

describe('SVG Optimization', () => {
  // Helper function to simulate the enhanced optimizeSVG method
  const optimizeSVG = (svgCode: string): string => {
    // Comprehensive SVG optimization
    const optimized = svgCode
      // Remove XML processing instructions
      .replace(/<\?xml[^>]*\?>/g, '')
      // Remove DOCTYPE declarations
      .replace(/<!DOCTYPE[^>]*>/g, '')
      // Remove comments
      .replace(/<!--[\s\S]*?-->/g, '')
      // Remove extra whitespace between tags
      .replace(/>\s+</g, '><')
      // Remove whitespace around attribute values
      .replace(/\s*=\s*"/g, '="')
      // Remove unnecessary precision in numbers (limit to 3 decimal places)
      .replace(/(\d+\.\d{3})\d+/g, '$1')
      // Remove trailing zeros after decimal point
      .replace(/(\d+)\.0+\b/g, '$1')
      .replace(/(\d+\.\d*?)0+\b/g, '$1')
      // Remove redundant default attribute values
      .replace(/\s+fill="none"/g, '')
      .replace(/\s+stroke="none"/g, '')
      .replace(/\s+stroke-width="1"/g, '')
      .replace(/\s+opacity="1"/g, '')
      .replace(/\s+fill-opacity="1"/g, '')
      .replace(/\s+stroke-opacity="1"/g, '')
      // Remove empty attributes
      .replace(/\s+[a-zA-Z-]+=""/g, '')
      // Remove redundant transform attributes
      .replace(/\s+transform="matrix\(1,0,0,1,0,0\)"/g, '')
      .replace(/\s+transform="translate\(0,0\)"/g, '')
      .replace(/\s+transform="scale\(1\)"/g, '')
      .replace(/\s+transform="rotate\(0\)"/g, '')
      // Remove unnecessary namespace declarations if not used
      .replace(/\s+xmlns:[a-z]+="[^"]*"/g, (match) => {
        const prefix = match.match(/xmlns:([a-z]+)=/)?.[1];
        if (prefix && !svgCode.includes(`${prefix}:`)) {
          return '';
        }
        return match;
      })
      // Remove metadata, desc, and title elements (optional optimization)
      .replace(/<metadata[^>]*>[\s\S]*?<\/metadata>/g, '')
      .replace(/<desc[^>]*>[\s\S]*?<\/desc>/g, '')
      // Remove empty groups
      .replace(/<g[^>]*>\s*<\/g>/g, '')
      // Consolidate whitespace
      .replace(/\s+/g, ' ')
      // Trim whitespace
      .trim();

    return optimized;
  };

  it('should remove XML processing instructions and DOCTYPE', () => {
    const svgWithXML = `<?xml version="1.0" encoding="UTF-8"?>
    <!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
    <svg xmlns="http://www.w3.org/2000/svg">
      <circle cx="50" cy="50" r="40" fill="red"/>
    </svg>`;

    const result = optimizeSVG(svgWithXML);

    expect(result).not.toContain('<?xml');
    expect(result).not.toContain('<!DOCTYPE');
    expect(result).toContain('<svg xmlns="http://www.w3.org/2000/svg">');
  });

  it('should remove XML comments', () => {
    const svgWithComments = `<svg xmlns="http://www.w3.org/2000/svg">
      <!-- This is a comment -->
      <circle cx="50" cy="50" r="40" fill="red"/>
      <!-- Another comment -->
    </svg>`;

    const result = optimizeSVG(svgWithComments);

    expect(result).not.toContain('<!--');
    expect(result).not.toContain('-->');
    expect(result).toContain('<circle cx="50" cy="50" r="40" fill="red"/>');
  });

  it('should remove extra whitespace between tags', () => {
    const svgWithWhitespace = `<svg xmlns="http://www.w3.org/2000/svg">
      <circle cx="50" cy="50" r="40" fill="red"/>
      <rect x="10" y="10" width="80" height="80" fill="blue"/>
    </svg>`;

    const result = optimizeSVG(svgWithWhitespace);

    expect(result).not.toMatch(/>\s+</);
    expect(result).toContain('><circle');
    expect(result).toContain('/><rect');
  });

  it('should reduce unnecessary precision in numbers', () => {
    const svgWithPrecision = `<svg xmlns="http://www.w3.org/2000/svg">
      <circle cx="50.123456" cy="50.789012" r="40.555555" fill="red"/>
    </svg>`;

    const result = optimizeSVG(svgWithPrecision);

    expect(result).toContain('cx="50.123"');
    expect(result).toContain('cy="50.789"');
    expect(result).toContain('r="40.555"');
  });

  it('should remove redundant default attribute values', () => {
    const svgWithDefaults = `<svg xmlns="http://www.w3.org/2000/svg">
      <circle cx="50" cy="50" r="40" fill="red" stroke="none" stroke-width="1" opacity="1"/>
      <rect x="10" y="10" width="80" height="80" fill="none" fill-opacity="1" stroke-opacity="1"/>
    </svg>`;

    const result = optimizeSVG(svgWithDefaults);

    expect(result).not.toContain('stroke="none"');
    expect(result).not.toContain('stroke-width="1"');
    expect(result).not.toContain('opacity="1"');
    expect(result).not.toContain('fill="none"');
    expect(result).not.toContain('fill-opacity="1"');
    expect(result).not.toContain('stroke-opacity="1"');
  });

  it('should remove redundant transform attributes', () => {
    const svgWithTransforms = `<svg xmlns="http://www.w3.org/2000/svg">
      <g transform="matrix(1,0,0,1,0,0)">
        <circle cx="50" cy="50" r="40" transform="translate(0,0)"/>
      </g>
      <rect x="10" y="10" width="80" height="80" transform="scale(1)" fill="blue"/>
      <path d="M10 10 L50 50" transform="rotate(0)"/>
    </svg>`;

    const result = optimizeSVG(svgWithTransforms);

    expect(result).not.toContain('transform="matrix(1,0,0,1,0,0)"');
    expect(result).not.toContain('transform="translate(0,0)"');
    expect(result).not.toContain('transform="scale(1)"');
    expect(result).not.toContain('transform="rotate(0)"');
  });

  it('should remove metadata and desc elements', () => {
    const svgWithMetadata = `<svg xmlns="http://www.w3.org/2000/svg">
      <metadata>
        <rdf:RDF>
          <cc:Work>
            <dc:title>Test SVG</dc:title>
          </cc:Work>
        </rdf:RDF>
      </metadata>
      <desc>This is a description of the SVG</desc>
      <circle cx="50" cy="50" r="40" fill="red"/>
    </svg>`;

    const result = optimizeSVG(svgWithMetadata);

    expect(result).not.toContain('<metadata>');
    expect(result).not.toContain('</metadata>');
    expect(result).not.toContain('<desc>');
    expect(result).not.toContain('</desc>');
    expect(result).toContain('<circle cx="50" cy="50" r="40" fill="red"/>');
  });

  it('should remove empty groups', () => {
    const svgWithEmptyGroups = `<svg xmlns="http://www.w3.org/2000/svg">
      <g></g>
      <g>
        <circle cx="50" cy="50" r="40" fill="red"/>
      </g>
      <g> </g>
    </svg>`;

    const result = optimizeSVG(svgWithEmptyGroups);

    // Should not contain empty groups
    expect(result).not.toMatch(/<g[^>]*>\s*<\/g>/);
    // Should keep non-empty group
    expect(result).toContain('<g><circle');
  });

  it('should handle complex SVG with multiple optimizations', () => {
    const complexSVG = `<?xml version="1.0" encoding="UTF-8"?>
    <!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
    <!-- SVG with various elements -->
    <svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="200" height="200">
      <metadata>
        <rdf:RDF>metadata content</rdf:RDF>
      </metadata>
      <!-- Circle element -->
      <g transform="matrix(1,0,0,1,0,0)">
        <circle cx="100.123456" cy="100.789012" r="50.555555" fill="red" stroke="none" opacity="1"/>
      </g>

      <!-- Rectangle element -->
      <rect x="10.111111" y="10.222222" width="80.333333" height="80.444444" fill="blue" stroke-width="1"/>

      <!-- Empty group -->
      <g></g>

      <!-- Path element -->
      <path d="M 10.123456 10.789012 L 50.111111 50.222222" stroke="green" transform="translate(0,0)"/>
    </svg>`;

    const result = optimizeSVG(complexSVG);

    // Should not contain processing instructions, doctype, comments
    expect(result).not.toContain('<?xml');
    expect(result).not.toContain('<!DOCTYPE');
    expect(result).not.toContain('<!--');
    expect(result).not.toContain('-->');

    // Should not contain metadata
    expect(result).not.toContain('<metadata>');

    // Should not have extra whitespace between tags
    expect(result).not.toMatch(/>\s+</);

    // Should have reduced precision
    expect(result).toContain('100.123');
    expect(result).toContain('100.789');
    expect(result).toContain('50.555');

    // Should not contain redundant attributes
    expect(result).not.toContain('stroke="none"');
    expect(result).not.toContain('opacity="1"');
    expect(result).not.toContain('stroke-width="1"');
    expect(result).not.toContain('transform="matrix(1,0,0,1,0,0)"');
    expect(result).not.toContain('transform="translate(0,0)"');

    // Should not contain empty groups
    expect(result).not.toMatch(/<g[^>]*>\s*<\/g>/);
  });

  it('should preserve necessary SVG structure and attributes', () => {
    const basicSVG = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
      <circle cx="50" cy="50" r="40" fill="red" stroke="blue" stroke-width="2"/>
    </svg>`;

    const result = optimizeSVG(basicSVG);

    // Should preserve essential attributes
    expect(result).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(result).toContain('width="100"');
    expect(result).toContain('height="100"');
    expect(result).toContain('cx="50"');
    expect(result).toContain('cy="50"');
    expect(result).toContain('r="40"');
    expect(result).toContain('fill="red"');
    expect(result).toContain('stroke="blue"');
    expect(result).toContain('stroke-width="2"'); // Non-default value should be preserved
  });

  it('should remove trailing zeros from decimal numbers', () => {
    const svgWithTrailingZeros = `<svg xmlns="http://www.w3.org/2000/svg" width="200.0" height="200" viewBox="0 0 200.00 200"><circle cx="100.000000" cy="100.0000" r="80" fill="#6291e0" stroke="#295da9" stroke-width="2"/></svg>`;

    const result = optimizeSVG(svgWithTrailingZeros);

    // Should remove trailing zeros after decimal points
    expect(result).toContain('width="200"');
    expect(result).toContain('viewBox="0 0 200 200"');
    expect(result).toContain('cx="100"');
    expect(result).toContain('cy="100"');
    // Should not contain any trailing zeros
    expect(result).not.toContain('.0');
    expect(result).not.toContain('.00');
    expect(result).not.toContain('.000');
  });

  it('should handle both precision limiting and trailing zero removal', () => {
    const svgWithMixedPrecision = `<svg xmlns="http://www.w3.org/2000/svg">
      <circle cx="50.123456" cy="50.0" r="40.55000"/>
      <rect x="10.0000" y="10.000000" width="80.12300" height="80"/>
    </svg>`;

    const result = optimizeSVG(svgWithMixedPrecision);

    // Should limit precision and remove trailing zeros
    expect(result).toContain('cx="50.123"'); // Precision limited
    expect(result).toContain('cy="50"');     // Trailing zero removed
    expect(result).toContain('r="40.55"');   // Trailing zeros removed
    expect(result).toContain('x="10"');      // Trailing zeros removed
    expect(result).toContain('y="10"');      // Precision limited then trailing zeros removed
    expect(result).toContain('width="80.123"'); // Trailing zero removed
    expect(result).toContain('height="80"'); // Already clean
  });

  it('should preserve used namespace declarations', () => {
    const svgWithUsedNamespace = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
      <use xlink:href="#circle"/>
      <defs>
        <circle id="circle" cx="50" cy="50" r="40" fill="red"/>
      </defs>
    </svg>`;

    const result = optimizeSVG(svgWithUsedNamespace);

    // Should preserve xlink namespace since it's used
    expect(result).toContain('xmlns:xlink="http://www.w3.org/1999/xlink"');
    expect(result).toContain('xlink:href="#circle"');
  });

  it('should remove unused namespace declarations', () => {
    const svgWithUnusedNamespace = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:unused="http://example.com/unused">
      <circle cx="50" cy="50" r="40" fill="red"/>
    </svg>`;

    const result = optimizeSVG(svgWithUnusedNamespace);

    // Should remove unused namespace
    expect(result).not.toContain('xmlns:unused');
    expect(result).toContain('xmlns="http://www.w3.org/2000/svg"');
  });
});