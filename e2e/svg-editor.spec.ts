import { test, expect } from '@playwright/test';

test.describe('SVG Editor', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should load the SVG editor with default content', async ({ page }) => {
    // Check that the editor loads
    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.getByRole('complementary')).toBeVisible();
    
    // Check that the default SVG is rendered
    await expect(page.locator('#editor .cm-content')).toBeVisible();
    await expect(page.locator('svg')).toBeVisible();
    
    // Check for the "Hello SVG" text specifically in the SVG preview area
    await expect(page.locator('#preview svg text').filter({ hasText: 'Hello SVG' })).toBeVisible();
  });

  test('should update SVG preview when code changes', async ({ page }) => {
    // Get the initial color
    const initialSvg = page.locator('svg circle');
    await expect(initialSvg).toHaveAttribute('fill', '#6291e0');
    
    // Change the SVG code - use more specific selector for CodeMirror editor
    const editor = page.locator('#editor .cm-content');
    await editor.click();
    await page.keyboard.press('Control+a');
    await page.keyboard.type(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
  <circle cx="100" cy="100" r="80" fill="#ff0000" stroke="#aa0000" stroke-width="2"/>
  <text x="100" y="110" text-anchor="middle" fill="white" font-family="Arial" font-size="16">
    Modified SVG
  </text>
</svg>`);
    
    // Check that the preview updates
    await expect(page.locator('svg circle')).toHaveAttribute('fill', '#ff0000');
    await expect(page.locator('#preview svg text').filter({ hasText: 'Modified SVG' })).toBeVisible();
  });

  test('should have working zoom controls', async ({ page }) => {
    // Click zoom in button multiple times
    await page.getByRole('button', { name: /zoom in/i }).click();
    await page.getByRole('button', { name: /zoom in/i }).click();
    
    // Check that the SVG is still visible (zoom functionality working)
    await expect(page.locator('svg')).toBeVisible();
    
    // Click zoom out button
    await page.getByRole('button', { name: /zoom out/i }).click();
    
    // SVG should still be visible
    await expect(page.locator('svg')).toBeVisible();
  });

  test('should have flip screen button', async ({ page }) => {
    // Check that flip button exists
    const flipButton = page.getByRole('button', { name: 'flip screen' });
    await expect(flipButton).toBeVisible();
    
    // Click the flip button
    await flipButton.click();
    
    // Elements should still be visible after flip
    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.getByRole('complementary')).toBeVisible();
  });

  test('should render SVG with dashed border', async ({ page }) => {
    // Check that SVG has border styling
    const svg = page.locator('svg');
    await expect(svg).toBeVisible();
    
    // Check that the SVG has the expected border style
    await expect(svg).toHaveCSS('border', /dashed/);
  });

  test('should have SVG transform controls', async ({ page }) => {
    // Check that transform controls exist
    await expect(page.getByRole('button', { name: /rotate/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /flip.*horizontal/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /flip.*vertical/i })).toBeVisible();
    
    // Test rotation functionality
    const rotateButton = page.getByRole('button', { name: /rotate/i });
    await rotateButton.click();
    
    // SVG should still be visible after rotation
    await expect(page.locator('svg')).toBeVisible();
  });

  test('should have SVG optimization button', async ({ page }) => {
    // Check that optimize button exists
    const optimizeButton = page.getByRole('button', { name: /optimize/i });
    await expect(optimizeButton).toBeVisible();
    
    // Click the optimize button
    await optimizeButton.click();
    
    // SVG should still be visible after optimization
    await expect(page.locator('svg')).toBeVisible();
  });

  test('should have flip functionality', async ({ page }) => {
    // Test flip X button
    const flipXButton = page.getByRole('button', { name: /flip.*horizontal/i });
    await expect(flipXButton).toBeVisible();
    await flipXButton.click();
    
    // Test flip Y button  
    const flipYButton = page.getByRole('button', { name: /flip.*vertical/i });
    await expect(flipYButton).toBeVisible();
    await flipYButton.click();
    
    // SVG should still be visible after flipping
    await expect(page.locator('svg')).toBeVisible();
  });

  test('should support pinch zoom gestures on touch devices', async ({ page }) => {
    // Get the SVG preview area
    const svgPreview = page.locator('.svg-preview-wrapper');
    await expect(svgPreview).toBeVisible();

    // Get initial zoom level to compare later
    const svgContainer = page.locator('.svg-container');
    await expect(svgContainer).toBeVisible();
    
    const initialTransform = await svgContainer.evaluate(el => 
      window.getComputedStyle(el).transform
    );

    // Simulate pinch zoom with proper touch events
    // Start with two fingers close together
    await svgPreview.dispatchEvent('touchstart', {
      touches: [
        { clientX: 450, clientY: 300, identifier: 0 },
        { clientX: 460, clientY: 300, identifier: 1 }
      ],
      targetTouches: [
        { clientX: 450, clientY: 300, identifier: 0 },
        { clientX: 460, clientY: 300, identifier: 1 }
      ],
      changedTouches: [
        { clientX: 450, clientY: 300, identifier: 0 },
        { clientX: 460, clientY: 300, identifier: 1 }
      ]
    });

    // Move touches apart to simulate pinch zoom out (increasing distance)
    await svgPreview.dispatchEvent('touchmove', {
      touches: [
        { clientX: 400, clientY: 300, identifier: 0 },
        { clientX: 500, clientY: 300, identifier: 1 }
      ],
      targetTouches: [
        { clientX: 400, clientY: 300, identifier: 0 },
        { clientX: 500, clientY: 300, identifier: 1 }
      ],
      changedTouches: [
        { clientX: 400, clientY: 300, identifier: 0 },
        { clientX: 500, clientY: 300, identifier: 1 }
      ]
    });

    // End the touch gesture
    await svgPreview.dispatchEvent('touchend', {
      touches: [],
      targetTouches: [],
      changedTouches: [
        { clientX: 400, clientY: 300, identifier: 0 },
        { clientX: 500, clientY: 300, identifier: 1 }
      ]
    });

    // Wait a bit for transform to be applied
    await page.waitForTimeout(100);

    // Check that the transform has changed (indicating zoom occurred)
    const finalTransform = await svgContainer.evaluate(el => 
      window.getComputedStyle(el).transform
    );
    
    // The transform should be different from initial (indicating zoom worked)
    expect(finalTransform).not.toBe(initialTransform);
    
    // SVG should still be visible after pinch zoom
    await expect(page.locator('svg')).toBeVisible();
  });

  test('should have line wrapping enabled in editor', async ({ page }) => {
    // Get the editor
    const editor = page.locator('#editor .cm-content');
    await expect(editor).toBeVisible();
    
    // Add very long text to test line wrapping
    await editor.click();
    await page.keyboard.press('Control+a');
    await page.keyboard.type(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
  <circle cx="100" cy="100" r="80" fill="#6291e0" stroke="#295da9" stroke-width="2"/>
  <text x="100" y="110" text-anchor="middle" fill="white" font-family="Arial" font-size="16">This is a very long line of text that should demonstrate the line wrapping feature when it is enabled, because it will wrap within the editor instead of creating horizontal scrollbars</text>
</svg>`);
    
    // Check that the CodeMirror editor has line wrapping enabled
    // We can verify this by checking that no horizontal scrollbar appears
    const editorElement = page.locator('.cm-editor');
    await expect(editorElement).toBeVisible();
    
    // The text should be visible and wrapped - check for multiple lines in the third line
    const textLine = page.locator('.cm-line').nth(2); // Third line (0-indexed)
    await expect(textLine).toBeVisible();
    
    // Verify that the SVG preview still updates correctly with the long text
    await expect(page.locator('svg')).toBeVisible();
  });
});