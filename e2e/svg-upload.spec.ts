import { test, expect } from '@playwright/test';

test.describe('SVG Upload Functionality', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the SVG editor
    await page.goto('/src/index.html');
  });

  test('should have upload button visible', async ({ page }) => {
    // Check that upload button exists and is visible
    const uploadButton = page.locator('#upload');
    await expect(uploadButton).toBeVisible();
  });

  test('should trigger file chooser when upload button is clicked', async ({ page }) => {
    // Set up file chooser handler
    const fileChooserPromise = page.waitForEvent('filechooser');

    // Click upload button
    await page.locator('#upload').click();

    // Verify file chooser opens
    const fileChooser = await fileChooserPromise;
    expect(fileChooser).toBeTruthy();
  });

  test('should handle drag and drop events', async ({ page }) => {
    // Create a test SVG file content
    const svgContent = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
  <circle cx="50" cy="50" r="40" fill="red"/>
</svg>`;

    // Simulate drag enter to show visual feedback
    await page.evaluate(() => {
      const dragEnterEvent = new DragEvent('dragenter', {
        bubbles: true,
        cancelable: true
      });
      document.dispatchEvent(dragEnterEvent);
    });

    // Check that drag-over class is added (visual feedback)
    const bodyClass = await page.evaluate(() => document.body.className);
    expect(bodyClass).toContain('drag-over');

    // Simulate dropping an SVG file
    await page.evaluate((content) => {
      const file = new File([content], 'test.svg', { type: 'image/svg+xml' });
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);

      const dropEvent = new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        dataTransfer: dataTransfer
      });
      document.dispatchEvent(dropEvent);
    }, svgContent);

    // Check that the content was loaded into the editor
    const editorContent = await page.locator('#editor .cm-content').textContent();
    expect(editorContent).toContain('<circle cx="50" cy="50" r="40" fill="red"/>');
  });

  test('should reject non-SVG files with error message', async ({ page }) => {
    // Override alert to capture the message
    let alertMessage = '';
    page.on('dialog', async dialog => {
      alertMessage = dialog.message();
      await dialog.accept();
    });

    // Simulate dropping a non-SVG file
    await page.evaluate(() => {
      const file = new File(['This is not SVG'], 'test.txt', { type: 'text/plain' });
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);

      const dropEvent = new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        dataTransfer: dataTransfer
      });
      document.dispatchEvent(dropEvent);
    });

    // Verify error message was shown
    expect(alertMessage).toBe('Please select a valid SVG file.');
  });
});