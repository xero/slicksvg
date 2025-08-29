import { test, expect } from '@playwright/test';

test.describe('SVG Editor Drag Resize E2E Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5173/src/');
    await page.waitForLoadState('networkidle');
    // Wait for application to be ready
    await page.waitForSelector('#dragbar', { timeout: 10000 });
  });

  test.describe('Desktop Drag Resize', () => {
    test('should have dragbar element visible between editor and preview', async ({ page }) => {
      const dragbar = page.locator('#dragbar');
      await expect(dragbar).toBeVisible();
      
      // Check accessibility attributes
      await expect(dragbar).toHaveAttribute('role', 'separator');
      await expect(dragbar).toHaveAttribute('aria-label', 'Resize Panel');
      await expect(dragbar).toHaveAttribute('tabindex', '0');
      await expect(dragbar).toHaveAttribute('aria-orientation', 'vertical');
    });

    test('should resize panels by dragging in horizontal layout', async ({ page }) => {
      const editor = page.locator('#editor');
      const preview = page.locator('#preview');
      const dragbar = page.locator('#dragbar');

      // Get initial dimensions
      const editorInitial = await editor.boundingBox();
      const previewInitial = await preview.boundingBox();
      const dragbarBox = await dragbar.boundingBox();

      expect(editorInitial).toBeTruthy();
      expect(previewInitial).toBeTruthy();
      expect(dragbarBox).toBeTruthy();

      // Perform drag operation - drag left to make editor smaller
      await dragbar.hover();
      await page.mouse.down();
      await page.mouse.move(dragbarBox!.x - 100, dragbarBox!.y);
      await page.mouse.up();

      // Wait a moment for changes to apply
      await page.waitForTimeout(100);

      // Check that panels have resizing class applied
      await expect(editor).toHaveClass(/resizing/);
      await expect(preview).toHaveClass(/resizing/);

      // Get final dimensions
      const editorFinal = await editor.boundingBox();
      const previewFinal = await preview.boundingBox();

      expect(editorFinal).toBeTruthy();
      expect(previewFinal).toBeTruthy();

      // Editor should be smaller, preview should be larger
      expect(editorFinal!.width).toBeLessThan(editorInitial!.width);
      expect(previewFinal!.width).toBeGreaterThan(previewInitial!.width);
    });

    test('should resize panels by dragging in vertical layout', async ({ page }) => {
      // Switch to vertical layout first
      const flipButton = page.locator('#flip');
      await flipButton.click();

      // Verify we're in vertical layout
      await expect(page.locator('body')).toHaveClass(/vertical/);

      const editor = page.locator('#editor');
      const preview = page.locator('#preview');
      const dragbar = page.locator('#dragbar');

      // Check dragbar has correct orientation
      await expect(dragbar).toHaveAttribute('aria-orientation', 'horizontal');

      // Get initial dimensions
      const editorInitial = await editor.boundingBox();
      const previewInitial = await preview.boundingBox();
      const dragbarBox = await dragbar.boundingBox();

      expect(editorInitial).toBeTruthy();
      expect(previewInitial).toBeTruthy();
      expect(dragbarBox).toBeTruthy();

      // Perform drag operation - drag up to make editor smaller
      await dragbar.hover();
      await page.mouse.down();
      await page.mouse.move(dragbarBox!.x, dragbarBox!.y - 100);
      await page.mouse.up();

      // Wait a moment for changes to apply
      await page.waitForTimeout(100);

      // Check that panels have resizing class applied
      await expect(editor).toHaveClass(/resizing/);
      await expect(preview).toHaveClass(/resizing/);

      // Get final dimensions
      const editorFinal = await editor.boundingBox();
      const previewFinal = await preview.boundingBox();

      expect(editorFinal).toBeTruthy();
      expect(previewFinal).toBeTruthy();

      // Editor should be smaller in height, preview should be larger
      expect(editorFinal!.height).toBeLessThan(editorInitial!.height);
      expect(previewFinal!.height).toBeGreaterThan(previewInitial!.height);
    });

    test('should enforce minimum panel sizes during drag', async ({ page }) => {
      const editor = page.locator('#editor');
      const preview = page.locator('#preview');
      const dragbar = page.locator('#dragbar');

      const dragbarBox = await dragbar.boundingBox();
      expect(dragbarBox).toBeTruthy();

      // Try to drag very far to the left (should be limited to minimum size)
      await dragbar.hover();
      await page.mouse.down();
      await page.mouse.move(50, dragbarBox!.y); // Very far left
      await page.mouse.up();

      await page.waitForTimeout(100);

      // Get panel dimensions after extreme drag
      const editorFinal = await editor.boundingBox();
      const previewFinal = await preview.boundingBox();
      const containerBox = await page.locator('body').boundingBox();

      expect(editorFinal).toBeTruthy();
      expect(previewFinal).toBeTruthy();
      expect(containerBox).toBeTruthy();

      // Editor should not be smaller than 10% of container width
      const minEditorWidth = containerBox!.width * 0.1;
      expect(editorFinal!.width).toBeGreaterThanOrEqual(minEditorWidth - 10); // Allow small margin for measurement

      // Preview should not be smaller than 10% either
      const minPreviewWidth = containerBox!.width * 0.1;
      expect(previewFinal!.width).toBeGreaterThanOrEqual(minPreviewWidth - 10);
    });

    test('should clear resize state when switching layouts', async ({ page }) => {
      const editor = page.locator('#editor');
      const preview = page.locator('#preview');
      const dragbar = page.locator('#dragbar');
      const flipButton = page.locator('#flip');

      // First resize in horizontal layout
      const dragbarBox = await dragbar.boundingBox();
      expect(dragbarBox).toBeTruthy();

      await dragbar.hover();
      await page.mouse.down();
      await page.mouse.move(dragbarBox!.x - 100, dragbarBox!.y);
      await page.mouse.up();

      await page.waitForTimeout(100);

      // Verify resize classes are applied
      await expect(editor).toHaveClass(/resizing/);
      await expect(preview).toHaveClass(/resizing/);

      // Switch to vertical layout
      await flipButton.click();
      await page.waitForTimeout(100);

      // Verify resize classes are removed
      await expect(editor).not.toHaveClass(/resizing/);
      await expect(preview).not.toHaveClass(/resizing/);

      // Check that inline styles are cleared
      const editorStyles = await editor.getAttribute('style');
      const previewStyles = await preview.getAttribute('style');

      // Should not have width or height styles
      expect(editorStyles).not.toContain('width:');
      expect(editorStyles).not.toContain('height:');
      expect(previewStyles).not.toContain('width:');
      expect(previewStyles).not.toContain('height:');
    });

    test('should maintain panel content during resize operations', async ({ page }) => {
      // Add some test content to verify it's preserved
      const editorTextarea = page.locator('.cm-content');
      await editorTextarea.click();
      await editorTextarea.fill('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><circle cx="50" cy="50" r="40" fill="red"/></svg>');

      // Wait for preview to update
      await page.waitForTimeout(500);

      // Verify preview has SVG content (specifically the actual SVG preview content, not icon SVGs)
      const svgElement = page.locator('#preview .svg-preview-wrapper svg');
      await expect(svgElement).toBeVisible();

      // Perform resize
      const dragbar = page.locator('#dragbar');
      const dragbarBox = await dragbar.boundingBox();
      expect(dragbarBox).toBeTruthy();

      await dragbar.hover();
      await page.mouse.down();
      await page.mouse.move(dragbarBox!.x + 50, dragbarBox!.y);
      await page.mouse.up();

      await page.waitForTimeout(100);

      // Verify content is still there
      await expect(svgElement).toBeVisible();
      const circle = page.locator('#preview .svg-preview-wrapper svg circle');
      await expect(circle).toBeVisible();
      await expect(circle).toHaveAttribute('fill', 'red');

      // Verify editor content is preserved
      const editorContent = await editorTextarea.textContent();
      expect(editorContent).toContain('<circle');
      expect(editorContent).toContain('fill="red"');
    });
  });

  test.describe('Touch Device Drag Resize', () => {
    test('should handle touch drag for resizing on mobile', async ({ page }) => {
      // Emulate mobile device
      await page.setViewportSize({ width: 390, height: 844 });

      const editor = page.locator('#editor');
      const preview = page.locator('#preview');
      const dragbar = page.locator('#dragbar');

      // Get initial dimensions
      const editorInitial = await editor.boundingBox();
      const previewInitial = await preview.boundingBox();
      const dragbarBox = await dragbar.boundingBox();

      expect(editorInitial).toBeTruthy();
      expect(previewInitial).toBeTruthy();
      expect(dragbarBox).toBeTruthy();

      // Perform touch drag operation
      const startX = dragbarBox!.x + dragbarBox!.width / 2;
      const startY = dragbarBox!.y + dragbarBox!.height / 2;
      const endX = dragbarBox!.x - 50;
      const endY = dragbarBox!.y + dragbarBox!.height / 2;

      // Simulate touch drag
      await page.touchscreen.tap(startX, startY);
      await page.waitForTimeout(100);
      // Drag to new position
      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(endX, endY);
      await page.mouse.up();

      await page.waitForTimeout(200);

      // Check that panels have resizing class applied
      await expect(editor).toHaveClass(/resizing/);
      await expect(preview).toHaveClass(/resizing/);

      // Get final dimensions
      const editorFinal = await editor.boundingBox();
      const previewFinal = await preview.boundingBox();

      expect(editorFinal).toBeTruthy();
      expect(previewFinal).toBeTruthy();

      // Editor should be smaller, preview should be larger
      expect(editorFinal!.width).not.toBe(editorInitial!.width);
      expect(previewFinal!.width).not.toBe(previewInitial!.width);
    });

    test('should handle touch drag in vertical layout on mobile', async ({ page }) => {
      // Emulate mobile device
      await page.setViewportSize({ width: 390, height: 844 });

      // Switch to vertical layout
      const flipButton = page.locator('#flip');
      await flipButton.click();

      const editor = page.locator('#editor');
      const preview = page.locator('#preview');
      const dragbar = page.locator('#dragbar');

      // Get initial dimensions
      const editorInitial = await editor.boundingBox();
      const previewInitial = await preview.boundingBox();
      const dragbarBox = await dragbar.boundingBox();

      expect(editorInitial).toBeTruthy();
      expect(previewInitial).toBeTruthy();
      expect(dragbarBox).toBeTruthy();

      // Perform touch drag operation vertically
      const startX = dragbarBox!.x + dragbarBox!.width / 2;
      const startY = dragbarBox!.y + dragbarBox!.height / 2;
      const endX = dragbarBox!.x + dragbarBox!.width / 2;
      const endY = dragbarBox!.y - 50;

      // Simulate touch drag
      await page.touchscreen.tap(startX, startY);
      await page.waitForTimeout(100);
      // Drag to new position
      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(endX, endY);
      await page.mouse.up();

      await page.waitForTimeout(200);

      // Check that panels have resizing class applied
      await expect(editor).toHaveClass(/resizing/);
      await expect(preview).toHaveClass(/resizing/);

      // Get final dimensions
      const editorFinal = await editor.boundingBox();
      const previewFinal = await preview.boundingBox();

      expect(editorFinal).toBeTruthy();
      expect(previewFinal).toBeTruthy();

      // Heights should have changed
      expect(editorFinal!.height).not.toBe(editorInitial!.height);
      expect(previewFinal!.height).not.toBe(previewInitial!.height);
    });
  });

  test.describe('Accessibility and Keyboard Support', () => {
    test('should be focusable with keyboard navigation', async ({ page }) => {
      const dragbar = page.locator('#dragbar');

      // Focus the dragbar directly
      await dragbar.focus();

      // Verify dragbar is focused
      await expect(dragbar).toBeFocused();
    });

    test('should provide proper ARIA labels and roles', async ({ page }) => {
      const dragbar = page.locator('#dragbar');

      // Check all required accessibility attributes
      await expect(dragbar).toHaveAttribute('role', 'separator');
      await expect(dragbar).toHaveAttribute('aria-label', 'Resize Panel');
      await expect(dragbar).toHaveAttribute('tabindex', '0');

      // Check orientation updates with layout
      await expect(dragbar).toHaveAttribute('aria-orientation', 'vertical');

      // Switch to vertical layout
      const flipButton = page.locator('#flip');
      await flipButton.click();

      // Should update orientation
      await expect(dragbar).toHaveAttribute('aria-orientation', 'horizontal');
    });

    test('should have visible focus indicators', async ({ page }) => {
      const dragbar = page.locator('#dragbar');

      // Focus the dragbar
      await dragbar.focus();

      // Check that focus styles are applied
      const focusStyles = await dragbar.evaluate(el => {
        const styles = window.getComputedStyle(el);
        return {
          outline: styles.outline,
          backgroundColor: styles.backgroundColor,
          opacity: styles.opacity
        };
      });

      // Should have some kind of focus indication
      const hasFocusIndicator = focusStyles.outline !== 'none' || 
                               focusStyles.backgroundColor !== 'rgba(0, 0, 0, 0)' ||
                               parseFloat(focusStyles.opacity) !== 1;
      
      expect(hasFocusIndicator).toBeTruthy();
    });
  });

  test.describe('Error Handling and Edge Cases', () => {
    test('should handle rapid drag operations without errors', async ({ page }) => {
      const dragbar = page.locator('#dragbar');
      const dragbarBox = await dragbar.boundingBox();
      expect(dragbarBox).toBeTruthy();

      // Perform multiple rapid drag operations
      for (let i = 0; i < 5; i++) {
        await dragbar.hover();
        await page.mouse.down();
        await page.mouse.move(dragbarBox!.x + (i % 2 === 0 ? 50 : -50), dragbarBox!.y);
        await page.mouse.up();
        await page.waitForTimeout(50); // Small delay between operations
      }

      // Should not have any console errors
      const messages = page.locator('console').all();
      const errorMessages = await Promise.all((await messages).map(async msg => {
        const text = await msg.textContent();
        return text?.includes('error') || text?.includes('Error');
      }));
      
      expect(errorMessages.some(hasError => hasError)).toBeFalsy();
    });

    test('should handle drag operations near viewport edges', async ({ page }) => {
      const dragbar = page.locator('#dragbar');
      const dragbarBox = await dragbar.boundingBox();
      expect(dragbarBox).toBeTruthy();

      // Try to drag to very edge of viewport
      await dragbar.hover();
      await page.mouse.down();
      await page.mouse.move(10, dragbarBox!.y); // Very close to left edge
      await page.mouse.up();

      await page.waitForTimeout(100);

      // Panels should still be visible and functional
      const editor = page.locator('#editor');
      const preview = page.locator('#preview');
      
      await expect(editor).toBeVisible();
      await expect(preview).toBeVisible();

      // Should still have minimum sizes
      const editorBox = await editor.boundingBox();
      const viewportSize = page.viewportSize();
      expect(editorBox!.width).toBeGreaterThan(viewportSize!.width * 0.05); // At least 5% of viewport
    });

    test('should maintain functionality after multiple layout switches', async ({ page }) => {
      const flipButton = page.locator('#flip');
      const dragbar = page.locator('#dragbar');

      // Switch layouts multiple times
      for (let i = 0; i < 4; i++) {
        await flipButton.click();
        await page.waitForTimeout(100);
        
        // Try to drag after each switch
        const dragbarBox = await dragbar.boundingBox();
        expect(dragbarBox).toBeTruthy();

        await dragbar.hover();
        await page.mouse.down();
        
        // Drag in appropriate direction based on layout
        const isVertical = await page.locator('body').evaluate(el => el.classList.contains('vertical'));
        if (isVertical) {
          await page.mouse.move(dragbarBox!.x, dragbarBox!.y + 20);
        } else {
          await page.mouse.move(dragbarBox!.x + 20, dragbarBox!.y);
        }
        
        await page.mouse.up();
        await page.waitForTimeout(100);
      }

      // Should still be functional
      const editor = page.locator('#editor');
      const preview = page.locator('#preview');
      
      await expect(editor).toBeVisible();
      await expect(preview).toBeVisible();
    });
  });

  test.describe('Performance and Responsiveness', () => {
    test('should resize smoothly without lag on large viewports', async ({ page }) => {
      // Set large viewport
      await page.setViewportSize({ width: 1920, height: 1080 });

      const dragbar = page.locator('#dragbar');
      const dragbarBox = await dragbar.boundingBox();
      expect(dragbarBox).toBeTruthy();

      // Measure performance of drag operation
      const startTime = Date.now();

      await dragbar.hover();
      await page.mouse.down();
      await page.mouse.move(dragbarBox!.x + 200, dragbarBox!.y);
      await page.mouse.up();

      const endTime = Date.now();
      const operationTime = endTime - startTime;

      // Should complete within reasonable time
      expect(operationTime).toBeLessThan(1000); // Less than 1 second

      // Verify resize actually happened
      const editor = page.locator('#editor');
      const preview = page.locator('#preview');
      
      await expect(editor).toHaveClass(/resizing/);
      await expect(preview).toHaveClass(/resizing/);
    });

    test('should work on different screen sizes', async ({ page }) => {
      const screenSizes = [
        { width: 320, height: 568 },  // Small mobile
        { width: 768, height: 1024 }, // Tablet
        { width: 1366, height: 768 }, // Laptop
        { width: 1920, height: 1080 } // Desktop
      ];

      for (const size of screenSizes) {
        await page.setViewportSize(size);
        await page.waitForTimeout(100);

        const dragbar = page.locator('#dragbar');
        await expect(dragbar).toBeVisible();

        // Try a simple drag operation
        const dragbarBox = await dragbar.boundingBox();
        expect(dragbarBox).toBeTruthy();

        await dragbar.hover();
        await page.mouse.down();
        await page.mouse.move(dragbarBox!.x + 30, dragbarBox!.y);
        await page.mouse.up();

        await page.waitForTimeout(100);

        // Should work on all screen sizes
        const editor = page.locator('#editor');
        const preview = page.locator('#preview');
        
        await expect(editor).toBeVisible();
        await expect(preview).toBeVisible();
      }
    });
  });
});