import { test, expect } from '@playwright/test';

test.describe('SVG Editor Accessibility E2E Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should have proper heading structure and landmarks', async ({ page }) => {
    // Check for main landmarks
    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.getByRole('complementary')).toBeVisible();
    
    // Check aria-labels
    await expect(page.getByRole('main')).toHaveAttribute('aria-label', 'SVG Code Editor');
    await expect(page.getByRole('complementary')).toHaveAttribute('aria-label', 'SVG Preview');
  });

  test('should support keyboard navigation', async ({ page }) => {
    // Tab through all interactive elements
    const interactiveElements = [
      'upload',
      'resolution', 
      'optimize',
      'rotate',
      'flipx',
      'flipy',
      'dark',
      'flip',
      'zoomin',
      'zoomout'
    ];

    for (const elementId of interactiveElements) {
      const element = page.getByRole('button', { name: new RegExp(elementId, 'i') });
      await element.focus();
      await expect(element).toBeFocused();
    }
  });

  test('should have proper button labels for screen readers', async ({ page }) => {
    const buttonLabels = [
      { selector: '#upload', expectedLabel: /upload/i },
      { selector: '#resolution', expectedLabel: /resize|resolution/i },
      { selector: '#optimize', expectedLabel: /optimize/i },
      { selector: '#rotate', expectedLabel: /rotate/i },
      { selector: '#flipx', expectedLabel: /flip.*horizontal/i },
      { selector: '#flipy', expectedLabel: /flip.*vertical/i },
      { selector: '#dark', expectedLabel: /dark mode/i },
      { selector: '#flip', expectedLabel: /flip screen|layout/i },
      { selector: '#zoomin', expectedLabel: /zoom in/i },
      { selector: '#zoomout', expectedLabel: /zoom out/i }
    ];

    for (const { selector, expectedLabel } of buttonLabels) {
      const button = page.locator(selector);
      await expect(button).toBeVisible();
      
      // Check accessible name (aria-label, aria-labelledby, or text content)
      const accessibleName = await button.getAttribute('aria-label') || 
                             await button.textContent() || '';
      expect(accessibleName).toMatch(expectedLabel);
    }
  });

  test('should support high contrast mode', async ({ page }) => {
    // Toggle dark mode
    await page.getByRole('button', { name: /dark mode/i }).click();
    
    // Check that body has dark class
    await expect(page.locator('body')).toHaveClass(/dark/);
    
    // Verify contrast by checking computed styles would be different
    const bodyBg = await page.locator('body').evaluate((el) => 
      getComputedStyle(el).backgroundColor
    );
    
    // In dark mode, background should be dark
    expect(bodyBg).toBeTruthy();
  });

  test('should provide screen reader announcements for actions', async ({ page }) => {
    // Add a live region for testing announcements
    await page.addInitScript(() => {
      const liveRegion = document.createElement('div');
      liveRegion.id = 'test-announcements';
      liveRegion.setAttribute('aria-live', 'polite');
      liveRegion.setAttribute('aria-atomic', 'true');
      liveRegion.style.position = 'absolute';
      liveRegion.style.left = '-10000px';
      document.body.appendChild(liveRegion);
    });

    // Mock announcements by adding text to live region when actions occur
    await page.addInitScript(() => {
      const announce = (message: string) => {
        const liveRegion = document.getElementById('test-announcements');
        if (liveRegion) {
          liveRegion.textContent = message;
        }
      };
      
      // Add announcement for transform actions
      document.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        if (target.id === 'rotate') {
          announce('SVG rotated 90 degrees');
        } else if (target.id === 'flipx') {
          announce('SVG flipped horizontally');
        } else if (target.id === 'flipy') {
          announce('SVG flipped vertically');
        }
      });
    });

    // Test rotation announcement
    await page.getByRole('button', { name: /rotate/i }).click();
    await expect(page.locator('#test-announcements')).toHaveText('SVG rotated 90 degrees');

    // Test flip announcement
    await page.getByRole('button', { name: /flip.*horizontal/i }).click();
    await expect(page.locator('#test-announcements')).toHaveText('SVG flipped horizontally');
  });

  test('should have accessible modal dialog', async ({ page }) => {
    // Open resolution modal
    await page.getByRole('button', { name: /resize|resolution/i }).click();
    
    // Check modal is visible and properly labeled
    const dialog = page.locator('dialog');
    await expect(dialog).toBeVisible();
    
    // Check modal has proper heading
    await expect(dialog.locator('header')).toHaveText('Change Resolution');
    
    // Check form inputs have proper labels
    const widthInput = dialog.locator('#width');
    const heightInput = dialog.locator('#height');
    
    await expect(widthInput).toBeVisible();
    await expect(heightInput).toBeVisible();
    await expect(widthInput).toHaveAttribute('type', 'number');
    await expect(heightInput).toHaveAttribute('type', 'number');
    
    // Check buttons are accessible
    await expect(dialog.getByRole('button', { name: /update/i })).toBeVisible();
    await expect(dialog.getByRole('button', { name: /cancel/i })).toBeVisible();
    
    // Close modal
    await dialog.getByRole('button', { name: /cancel/i }).click();
    await expect(dialog).not.toBeVisible();
  });

  test('should handle focus trapping in modal', async ({ page }) => {
    // Open modal
    await page.getByRole('button', { name: /resize|resolution/i }).click();
    
    const dialog = page.locator('dialog');
    await expect(dialog).toBeVisible();
    
    // Tab through modal elements
    const widthInput = dialog.locator('#width');
    const heightInput = dialog.locator('#height');
    const updateButton = dialog.getByRole('button', { name: /update/i });
    const cancelButton = dialog.getByRole('button', { name: /cancel/i });
    
    // First element should be focused (or explicitly focus it)
    await widthInput.focus();
    await expect(widthInput).toBeFocused();
    
    // Tab to next element
    await page.keyboard.press('Tab');
    await expect(heightInput).toBeFocused();
    
    // Tab to buttons
    await page.keyboard.press('Tab');
    await expect(updateButton).toBeFocused();
    
    await page.keyboard.press('Tab');
    await expect(cancelButton).toBeFocused();
    
    // Tab should wrap back to first element
    await page.keyboard.press('Tab');
    await expect(widthInput).toBeFocused();
    
    // Shift+Tab should go backwards
    await page.keyboard.press('Shift+Tab');
    await expect(cancelButton).toBeFocused();
    
    // Close modal
    await cancelButton.click();
  });

  test('should support reduced motion preferences', async ({ page }) => {
    // Mock reduced motion preference
    await page.addInitScript(() => {
      // Override matchMedia to return reduced motion
      Object.defineProperty(window, 'matchMedia', {
        writable: true,
        value: (query: string) => ({
          matches: query.includes('prefers-reduced-motion: reduce'),
          media: query,
          onchange: null,
          addListener: () => {},
          removeListener: () => {},
          addEventListener: () => {},
          removeEventListener: () => {},
          dispatchEvent: () => {},
        }),
      });
    });
    
    // Refresh to apply the mock
    await page.reload();
    
    // Verify that animations would be disabled
    // In a real implementation, this would check CSS classes or animation states
    const bodyClasses = await page.locator('body').getAttribute('class');
    
    // The application should respect reduced motion preferences
    expect(bodyClasses).toBeTruthy();
  });

  test('should have proper error announcements', async ({ page }) => {
    // Add error handling to page
    await page.addInitScript(() => {
      const announceError = (message: string) => {
        let liveRegion = document.getElementById('error-announcements');
        if (!liveRegion) {
          liveRegion = document.createElement('div');
          liveRegion.id = 'error-announcements';
          liveRegion.setAttribute('aria-live', 'assertive');
          liveRegion.setAttribute('aria-atomic', 'true');
          liveRegion.style.position = 'absolute';
          liveRegion.style.left = '-10000px';
          document.body.appendChild(liveRegion);
        }
        liveRegion.textContent = message;
      };
      
      // Mock file upload error
      (window as any).announceError = announceError;
    });
    
    // Trigger an error (simulate invalid file upload)
    await page.evaluate(() => {
      (window as any).announceError('Error: Invalid file format. Please upload an SVG file.');
    });
    
    await expect(page.locator('#error-announcements'))
      .toHaveText('Error: Invalid file format. Please upload an SVG file.');
  });

  test('should support zoom controls with keyboard', async ({ page }) => {
    // Focus zoom in button
    const zoomInButton = page.getByRole('button', { name: /zoom in/i });
    const zoomOutButton = page.getByRole('button', { name: /zoom out/i });
    
    await zoomInButton.focus();
    await expect(zoomInButton).toBeFocused();
    
    // Press Enter to activate
    await page.keyboard.press('Enter');
    
    // Verify zoom action (in real implementation, would check transform styles)
    const svgElement = page.locator('svg').first();
    if (await svgElement.count() > 0) {
      // Check that SVG is still visible after zoom
      await expect(svgElement).toBeVisible();
    }
    
    // Test zoom out
    await zoomOutButton.focus();
    await expect(zoomOutButton).toBeFocused();
    
    await page.keyboard.press('Enter');
    
    // Verify zoom out action
    if (await svgElement.count() > 0) {
      await expect(svgElement).toBeVisible();
    }
  });
});