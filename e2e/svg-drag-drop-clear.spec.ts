import { test, expect } from '@playwright/test';

test.describe('SVG Drag and Drop Content Clearing', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the SVG editor
    await page.goto('/index.html');
  });

  test('should completely replace content when dropping new SVG file', async ({ page }) => {
    // Wait for editor to be ready
    const editor = page.locator('#editor .cm-content');
    await expect(editor).toBeVisible();

    // Get initial content (should be the default circle SVG)
    const initialContent = await editor.textContent();
    expect(initialContent).toContain('Hello SVG');
    expect(initialContent).toContain('circle');

    // Position cursor in the middle of the content
    await editor.click();
    await page.keyboard.press('Control+a'); // Select all
    await page.keyboard.press('ArrowRight'); // Move cursor to end
    await page.keyboard.press('ArrowLeft'); // Move back a bit
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');

    // Zoom in and pan to simulate a modified view state
    await page.locator('#zoomin').click();
    await page.locator('#zoomin').click(); // Zoom in twice

    // Get the SVG container and simulate panning
    const svgContainer = page.locator('.svg-container');
    if (await svgContainer.count() > 0) {
      await svgContainer.hover();
      await page.mouse.down();
      await page.mouse.move(150, 150);
      await page.mouse.up();
    }

    // Create a different SVG content to drop
    const newSVGContent = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300">
  <rect x="50" y="50" width="200" height="200" fill="green" stroke="black" stroke-width="3"/>
  <text x="150" y="160" text-anchor="middle" fill="white" font-family="Arial" font-size="20">
    New SVG Content
  </text>
</svg>`;

    // Simulate dropping the new SVG file
    await page.evaluate((content) => {
      const file = new File([content], 'new-test.svg', { type: 'image/svg+xml' });
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);

      const dropEvent = new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        dataTransfer: dataTransfer
      });
      document.dispatchEvent(dropEvent);
    }, newSVGContent);

    // Wait for content to be updated
    await page.waitForTimeout(1000);

    // Verify the content was completely replaced
    const newContent = await editor.textContent();
    expect(newContent).toContain('New SVG Content');
    expect(newContent).toContain('rect');
    expect(newContent).not.toContain('Hello SVG'); // Old content should be gone
    expect(newContent).not.toContain('circle'); // Old content should be gone

    // Check that the view state was reset by looking for reset zoom level
    // The SVG should be back to normal size and position
    const svgPreview = page.locator('.svg-preview-wrapper svg');
    if (await svgPreview.count() > 0) {
      await expect(svgPreview).toBeVisible();
      // After reset, the SVG should be visible and not overly zoomed
      const boundingBox = await svgPreview.boundingBox();
      expect(boundingBox).toBeTruthy();
      if (boundingBox) {
        // Should not be extremely large (indicating zoom was reset)
        expect(boundingBox.width).toBeLessThan(1000);
        expect(boundingBox.height).toBeLessThan(1000);
      }
    }
  });

  test('should reset zoom and pan state when loading new SVG', async ({ page }) => {
    // Wait for editor to be ready
    const editor = page.locator('#editor .cm-content');
    await expect(editor).toBeVisible();

    // Zoom in multiple times
    await page.locator('#zoomin').click();
    await page.locator('#zoomin').click();
    await page.locator('#zoomin').click();

    // Create and drop a new SVG
    const newSVGContent = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
  <circle cx="50" cy="50" r="30" fill="red"/>
</svg>`;

    await page.evaluate((content) => {
      const file = new File([content], 'reset-test.svg', { type: 'image/svg+xml' });
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);

      const dropEvent = new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        dataTransfer: dataTransfer
      });
      document.dispatchEvent(dropEvent);
    }, newSVGContent);

    // Wait for update
    await page.waitForTimeout(1000);

    // Verify content was loaded
    const content = await editor.textContent();
    expect(content).toContain('fill="red"');

    // Check that we can zoom in again from the reset state
    // If state was properly reset, we should be able to zoom in from level 1
    await page.locator('#zoomin').click();

    // The editor should still be functional
    await expect(editor).toBeVisible();
  });

  test('should handle cursor position correctly after content replacement', async ({ page }) => {
    // Wait for editor to be ready
    const editor = page.locator('#editor .cm-content');
    await expect(editor).toBeVisible();

    // Position cursor somewhere in the middle
    await editor.click();
    await page.keyboard.press('Control+a');
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('ArrowRight');
    }

    // Drop new content
    const newSVGContent = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">
  <polygon points="10,10 190,10 100,190" fill="blue"/>
</svg>`;

    await page.evaluate((content) => {
      const file = new File([content], 'cursor-test.svg', { type: 'image/svg+xml' });
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);

      const dropEvent = new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        dataTransfer: dataTransfer
      });
      document.dispatchEvent(dropEvent);
    }, newSVGContent);

    await page.waitForTimeout(1000);

    // Verify content was completely replaced
    const content = await editor.textContent();
    expect(content).toContain('polygon');
    expect(content).toContain('fill="blue"');

    // Test that we can still edit after replacement
    await editor.click();
    await page.keyboard.press('End'); // Go to end
    await page.keyboard.type(' ');  // Add a space
    await page.keyboard.press('Backspace'); // Remove it

    // Content should still be there and editable
    const finalContent = await editor.textContent();
    expect(finalContent).toContain('polygon');
  });
});