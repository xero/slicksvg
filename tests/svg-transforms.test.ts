import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('SVG Transform and Parsing', () => {
  describe('SVG Transform Parsing', () => {
    it('should parse transform attributes correctly', () => {
      const parseCurrentTransforms = (svgCode: string) => {
        let rotationDegrees = 0;
        let flipX = false;
        let flipY = false;

        const transformMatch = svgCode.match(/transform="([^"]*)"/);
        if (!transformMatch) return { rotationDegrees, flipX, flipY };

        const transform = transformMatch[1];

        // Parse rotation
        const rotateMatch = transform.match(/rotate\(([^)]+)\)/);
        if (rotateMatch) {
          rotationDegrees = parseFloat(rotateMatch[1]);
        }

        // Parse scale for flips
        const scaleMatch = transform.match(/scale\(([^)]+)\)/);
        if (scaleMatch) {
          const scaleValues = scaleMatch[1].split(/[,\s]+/).map(parseFloat);
          if (scaleValues.length >= 2) {
            flipX = scaleValues[0] < 0;
            flipY = scaleValues[1] < 0;
          } else if (scaleValues.length === 1) {
            const scale = scaleValues[0];
            flipX = scale < 0;
            flipY = scale < 0;
          }
        }

        return { rotationDegrees, flipX, flipY };
      };

      // Test with no transform
      const svgNoTransform = '<svg><rect width="100" height="100"/></svg>';
      const resultNoTransform = parseCurrentTransforms(svgNoTransform);
      expect(resultNoTransform).toEqual({ rotationDegrees: 0, flipX: false, flipY: false });

      // Test with rotation
      const svgWithRotation = '<svg transform="rotate(90)"><rect width="100" height="100"/></svg>';
      const resultRotation = parseCurrentTransforms(svgWithRotation);
      expect(resultRotation.rotationDegrees).toBe(90);

      // Test with scale (flip)
      const svgWithFlip = '<svg transform="scale(-1, 1)"><rect width="100" height="100"/></svg>';
      const resultFlip = parseCurrentTransforms(svgWithFlip);
      expect(resultFlip.flipX).toBe(true);
      expect(resultFlip.flipY).toBe(false);

      // Test with complex transform
      const svgComplex = '<svg transform="rotate(45) scale(-1, -1)"><rect width="100" height="100"/></svg>';
      const resultComplex = parseCurrentTransforms(svgComplex);
      expect(resultComplex.rotationDegrees).toBe(45);
      expect(resultComplex.flipX).toBe(true);
      expect(resultComplex.flipY).toBe(true);
    });

    it('should build transform attributes correctly', () => {
      const buildTransformAttribute = (width: number, height: number, rotationDegrees: number, flipX: boolean, flipY: boolean) => {
        const transforms = [];

        if (rotationDegrees !== 0) {
          const centerX = width / 2;
          const centerY = height / 2;
          transforms.push(`rotate(${rotationDegrees} ${centerX} ${centerY})`);
        }

        if (flipX || flipY) {
          const scaleX = flipX ? -1 : 1;
          const scaleY = flipY ? -1 : 1;
          const centerX = width / 2;
          const centerY = height / 2;
          transforms.push(`translate(${centerX} ${centerY})`);
          transforms.push(`scale(${scaleX} ${scaleY})`);
          transforms.push(`translate(${-centerX} ${-centerY})`);
        }

        return transforms.length > 0 ? transforms.join(' ') : '';
      };

      // Test no transform
      expect(buildTransformAttribute(100, 100, 0, false, false)).toBe('');

      // Test rotation only
      const rotationResult = buildTransformAttribute(100, 100, 90, false, false);
      expect(rotationResult).toBe('rotate(90 50 50)');

      // Test flip X only
      const flipXResult = buildTransformAttribute(100, 100, 0, true, false);
      expect(flipXResult).toBe('translate(50 50) scale(-1 1) translate(-50 -50)');

      // Test flip Y only
      const flipYResult = buildTransformAttribute(100, 100, 0, false, true);
      expect(flipYResult).toBe('translate(50 50) scale(1 -1) translate(-50 -50)');

      // Test rotation and flip
      const combinedResult = buildTransformAttribute(100, 100, 45, true, true);
      expect(combinedResult).toBe('rotate(45 50 50) translate(50 50) scale(-1 -1) translate(-50 -50)');
    });
  });

  describe('SVG Transform Operations', () => {
    it('should handle rotation transform correctly', () => {
      let rotationDegrees = 0;

      const rotateSVG = () => {
        rotationDegrees = (rotationDegrees + 90) % 360;
      };

      // Test multiple rotations
      expect(rotationDegrees).toBe(0);

      rotateSVG();
      expect(rotationDegrees).toBe(90);

      rotateSVG();
      expect(rotationDegrees).toBe(180);

      rotateSVG();
      expect(rotationDegrees).toBe(270);

      rotateSVG();
      expect(rotationDegrees).toBe(0); // Full circle
    });

    it('should handle flip transforms correctly', () => {
      let flipX = false;
      let flipY = false;

      const flipSVGX = () => {
        flipX = !flipX;
      };

      const flipSVGY = () => {
        flipY = !flipY;
      };

      // Test initial state
      expect(flipX).toBe(false);
      expect(flipY).toBe(false);

      // Test flip X
      flipSVGX();
      expect(flipX).toBe(true);
      expect(flipY).toBe(false);

      // Test flip Y
      flipSVGY();
      expect(flipX).toBe(true);
      expect(flipY).toBe(true);

      // Test flip X again
      flipSVGX();
      expect(flipX).toBe(false);
      expect(flipY).toBe(true);

      // Test flip Y again
      flipSVGY();
      expect(flipX).toBe(false);
      expect(flipY).toBe(false);
    });
  });

  describe('SVG Resolution Parsing', () => {
    it('should extract width and height from SVG correctly', () => {
      const extractDimensions = (svgCode: string) => {
        const widthMatch = svgCode.match(/width="([^"]+)"/);
        const heightMatch = svgCode.match(/height="([^"]+)"/);

        let currentWidth = widthMatch ? parseInt(widthMatch[1]) : null;
        let currentHeight = heightMatch ? parseInt(heightMatch[1]) : null;

        // Fall back to viewBox if width/height missing
        if (currentWidth === null || currentHeight === null) {
          const viewBoxMatch = svgCode.match(/viewBox="([^"]+)"/);
          if (viewBoxMatch) {
            const viewBoxValues = viewBoxMatch[1].split(/\s+/);
            if (viewBoxValues.length >= 4) {
              if (currentWidth === null) {
                currentWidth = parseInt(viewBoxValues[2]);
              }
              if (currentHeight === null) {
                currentHeight = parseInt(viewBoxValues[3]);
              }
            }
          }
        }

        // Final fallback
        currentWidth = currentWidth || 200;
        currentHeight = currentHeight || 200;

        return { width: currentWidth, height: currentHeight };
      };

      // Test with explicit width and height
      const svgExplicit = '<svg width="300" height="400"><rect/></svg>';
      const resultExplicit = extractDimensions(svgExplicit);
      expect(resultExplicit).toEqual({ width: 300, height: 400 });

      // Test with viewBox only
      const svgViewBox = '<svg viewBox="0 0 500 600"><rect/></svg>';
      const resultViewBox = extractDimensions(svgViewBox);
      expect(resultViewBox).toEqual({ width: 500, height: 600 });

      // Test with partial dimensions (width only)
      const svgPartial = '<svg width="100" viewBox="0 0 250 350"><rect/></svg>';
      const resultPartial = extractDimensions(svgPartial);
      expect(resultPartial).toEqual({ width: 100, height: 350 });

      // Test with no dimensions
      const svgNone = '<svg><rect/></svg>';
      const resultNone = extractDimensions(svgNone);
      expect(resultNone).toEqual({ width: 200, height: 200 });
    });

    it('should update SVG dimensions correctly', () => {
      const updateSVGDimensions = (svgCode: string, newWidth: number, newHeight: number) => {
        let updatedSVG = svgCode;

        // Update width
        if (updatedSVG.includes('width="')) {
          updatedSVG = updatedSVG.replace(/width="[^"]*"/, `width="${newWidth}"`);
        } else {
          updatedSVG = updatedSVG.replace(/(<svg[^>]*)(>)/, `$1 width="${newWidth}"$2`);
        }

        // Update height
        if (updatedSVG.includes('height="')) {
          updatedSVG = updatedSVG.replace(/height="[^"]*"/, `height="${newHeight}"`);
        } else {
          updatedSVG = updatedSVG.replace(/(<svg[^>]*)(>)/, `$1 height="${newHeight}"$2`);
        }

        // Update viewBox
        const viewBoxValue = `0 0 ${newWidth} ${newHeight}`;
        if (updatedSVG.includes('viewBox="')) {
          updatedSVG = updatedSVG.replace(/viewBox="[^"]*"/, `viewBox="${viewBoxValue}"`);
        } else {
          updatedSVG = updatedSVG.replace(/(<svg[^>]*)(>)/, `$1 viewBox="${viewBoxValue}"$2`);
        }

        return updatedSVG;
      };

      // Test updating existing dimensions
      const originalSVG = '<svg width="100" height="200" viewBox="0 0 100 200"><rect/></svg>';
      const updatedSVG = updateSVGDimensions(originalSVG, 300, 400);

      expect(updatedSVG).toContain('width="300"');
      expect(updatedSVG).toContain('height="400"');
      expect(updatedSVG).toContain('viewBox="0 0 300 400"');

      // Test adding dimensions to SVG without them
      const svgNoDimensions = '<svg><rect/></svg>';
      const addedDimensions = updateSVGDimensions(svgNoDimensions, 150, 250);

      expect(addedDimensions).toContain('width="150"');
      expect(addedDimensions).toContain('height="250"');
      expect(addedDimensions).toContain('viewBox="0 0 150 250"');
    });
  });

  describe('SVG Validation', () => {
    it('should validate SVG content correctly', () => {
      const validateSVGContent = (content: string): boolean => {
        // Basic validation - check for SVG tags
        return content.includes('<svg') && content.includes('</svg>');
      };

      // Valid SVG
      const validSVG = '<svg xmlns="http://www.w3.org/2000/svg"><circle r="50"/></svg>';
      expect(validateSVGContent(validSVG)).toBe(true);

      // Valid SVG with attributes
      const validComplexSVG = '<svg width="100" height="100" viewBox="0 0 100 100"><rect width="50" height="50"/></svg>';
      expect(validateSVGContent(validComplexSVG)).toBe(true);

      // Invalid content
      const invalidContent = 'This is not SVG content';
      expect(validateSVGContent(invalidContent)).toBe(false);

      // HTML content
      const htmlContent = '<div><p>Not SVG</p></div>';
      expect(validateSVGContent(htmlContent)).toBe(false);

      // Partial SVG (missing closing tag)
      const partialSVG = '<svg><rect/>';
      expect(validateSVGContent(partialSVG)).toBe(false);
    });

    it('should handle malformed SVG gracefully', () => {
      const parseSVGSafely = (content: string) => {
        try {
          if (!content.includes('<svg')) {
            throw new Error('Not an SVG file');
          }

          return { success: true, error: null };
        } catch (error) {
          return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
        }
      };

      // Test valid SVG
      const validSVG = '<svg><rect/></svg>';
      const validResult = parseSVGSafely(validSVG);
      expect(validResult.success).toBe(true);
      expect(validResult.error).toBeNull();

      // Test non-SVG content
      const notSVG = '<div>Not SVG</div>';
      const notSVGResult = parseSVGSafely(notSVG);
      expect(notSVGResult.success).toBe(false);
      expect(notSVGResult.error).toBe('Not an SVG file');
    });
  });

  describe('SVG Preview Generation', () => {
    it('should generate SVG preview safely', () => {
      const generateSVGPreview = (svgCode: string) => {
        try {
          // Clean the SVG code
          const cleanedSVG = svgCode.trim();

          // Basic validation
          if (!cleanedSVG.includes('<svg')) {
            throw new Error('Not a valid SVG');
          }

          // Create a wrapper div
          const previewWrapper = {
            innerHTML: cleanedSVG,
            querySelector: vi.fn().mockReturnValue({
              style: {},
              setAttribute: vi.fn()
            })
          };

          return { success: true, preview: previewWrapper };
        } catch (error) {
          return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
        }
      };

      // Test valid SVG
      const validSVG = '<svg width="100" height="100"><circle r="50"/></svg>';
      const result = generateSVGPreview(validSVG);
      expect(result.success).toBe(true);
      expect(result.preview?.innerHTML).toBe(validSVG);

      // Test invalid content
      const invalidContent = 'Not SVG content';
      const invalidResult = generateSVGPreview(invalidContent);
      expect(invalidResult.success).toBe(false);
      expect(invalidResult.error).toBe('Not a valid SVG');
    });

    it('should apply SVG styles correctly', () => {
      const applySVGStyles = (svg: any, zoomLevel: number, panX: number, panY: number, rotationDegrees: number, flipX: boolean, flipY: boolean) => {
        const styles = [];

        // Apply zoom
        if (zoomLevel !== 1) {
          styles.push(`scale(${zoomLevel})`);
        }

        // Apply pan
        if (panX !== 0 || panY !== 0) {
          styles.push(`translate(${panX}px, ${panY}px)`);
        }

        // Apply rotation
        if (rotationDegrees !== 0) {
          styles.push(`rotate(${rotationDegrees}deg)`);
        }

        // Apply flips
        let scaleTransform = '';
        if (flipX || flipY) {
          const scaleX = flipX ? -1 : 1;
          const scaleY = flipY ? -1 : 1;
          scaleTransform = `scale(${scaleX}, ${scaleY})`;
          styles.push(scaleTransform);
        }

        const transformValue = styles.join(' ');
        svg.style.transform = transformValue;

        return transformValue;
      };

      const mockSVG = { style: {} };

      // Test no transforms
      const noTransform = applySVGStyles(mockSVG, 1, 0, 0, 0, false, false);
      expect(noTransform).toBe('');

      // Test zoom only
      const zoomTransform = applySVGStyles(mockSVG, 2, 0, 0, 0, false, false);
      expect(zoomTransform).toBe('scale(2)');

      // Test pan only
      const panTransform = applySVGStyles(mockSVG, 1, 10, 20, 0, false, false);
      expect(panTransform).toBe('translate(10px, 20px)');

      // Test rotation only
      const rotateTransform = applySVGStyles(mockSVG, 1, 0, 0, 45, false, false);
      expect(rotateTransform).toBe('rotate(45deg)');

      // Test combined transforms
      const combinedTransform = applySVGStyles(mockSVG, 1.5, 5, 10, 90, true, false);
      expect(combinedTransform).toBe('scale(1.5) translate(5px, 10px) rotate(90deg) scale(-1, 1)');
    });
  });
});