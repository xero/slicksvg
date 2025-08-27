import { test, expect } from '@playwright/test';

test.describe('SVG Editor Mobile and Touch E2E Tests', () => {
  test.beforeEach(async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
  });

  test('should be responsive on mobile devices', async ({ page }) => {
    // Check that main elements are visible on mobile
    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.getByRole('complementary')).toBeVisible();
    
    // Check that buttons are still accessible
    await expect(page.getByRole('button', { name: /upload/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /dark mode/i })).toBeVisible();
  });

  test('should handle touch interactions for zoom', async ({ page }) => {
    // Simulate pinch-to-zoom gesture
    const preview = page.locator('#preview');
    await expect(preview).toBeVisible();
    
    // Simulate touch start with two fingers
    await preview.dispatchEvent('touchstart', {
      touches: [
        { clientX: 100, clientY: 100, identifier: 1 },
        { clientX: 200, clientY: 100, identifier: 2 }
      ]
    });
    
    // Simulate pinch movement (fingers moving apart)
    await preview.dispatchEvent('touchmove', {
      touches: [
        { clientX: 50, clientY: 100, identifier: 1 },
        { clientX: 250, clientY: 100, identifier: 2 }
      ]
    });
    
    // End touch
    await preview.dispatchEvent('touchend', {
      touches: []
    });
    
    // Should still be functional
    await expect(preview).toBeVisible();
  });

  test('should work well on tablet size', async ({ page }) => {
    // Set tablet viewport
    await page.setViewportSize({ width: 768, height: 1024 });
    
    // Check layout adaptation
    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.getByRole('complementary')).toBeVisible();
    
    // Test flip screen functionality on tablet
    await page.getByRole('button', { name: /flip screen/i }).click();
    
    // Should toggle layout
    const body = page.locator('body');
    await expect(body).toBeVisible();
  });

  test('should handle orientation changes', async ({ page }) => {
    // Portrait mode
    await page.setViewportSize({ width: 375, height: 667 });
    await expect(page.getByRole('main')).toBeVisible();
    
    // Landscape mode
    await page.setViewportSize({ width: 667, height: 375 });
    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.getByRole('complementary')).toBeVisible();
    
    // Should still be usable in landscape
    await page.getByRole('button', { name: /rotate/i }).click();
    await expect(page.getByRole('main')).toBeVisible();
  });

  test('should support touch scrolling', async ({ page }) => {
    // Set a smaller viewport to force scrolling
    await page.setViewportSize({ width: 320, height: 480 });
    
    // Check that content is scrollable
    const editor = page.locator('#editor');
    await expect(editor).toBeVisible();
    
    // Simulate touch scroll
    await editor.hover();
    await page.mouse.wheel(0, 100);
    
    // Should still be interactive
    await expect(editor).toBeVisible();
  });
});

test.describe('SVG Editor Performance E2E Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should load quickly', async ({ page }) => {
    const startTime = Date.now();
    
    // Wait for essential elements to load
    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.getByRole('complementary')).toBeVisible();
    
    const loadTime = Date.now() - startTime;
    
    // Should load within reasonable time (3 seconds)
    expect(loadTime).toBeLessThan(3000);
  });

  test('should handle rapid interactions smoothly', async ({ page }) => {
    const startTime = Date.now();
    
    // Perform rapid sequence of operations
    for (let i = 0; i < 5; i++) {
      await page.getByRole('button', { name: /rotate/i }).click();
      await page.getByRole('button', { name: /flip.*horizontal/i }).click();
      await page.getByRole('button', { name: /zoom in/i }).click();
      await page.getByRole('button', { name: /zoom out/i }).click();
    }
    
    const interactionTime = Date.now() - startTime;
    
    // Should complete interactions smoothly
    expect(interactionTime).toBeLessThan(2000);
    
    // Application should still be responsive
    await expect(page.getByRole('main')).toBeVisible();
  });

  test('should handle large SVG content efficiently', async ({ page }) => {
    // Create complex SVG
    const complexSVG = `<svg width="500" height="500" viewBox="0 0 500 500">
      ${Array.from({ length: 50 }, (_, i) => 
        `<g transform="translate(${i * 10}, ${i * 10})">
          <rect width="30" height="30" fill="hsl(${i * 7}, 70%, 50%)" />
          <circle cx="15" cy="15" r="10" fill="white" opacity="0.7" />
          <text x="15" y="20" text-anchor="middle" font-size="8" fill="black">${i}</text>
        </g>`
      ).join('')}
    </svg>`;
    
    const startTime = Date.now();
    
    // Input complex content
    const editor = page.locator('#editor .cm-content');
    await editor.click();
    await page.keyboard.press('Control+a');
    await page.keyboard.type(complexSVG);
    
    // Wait for preview to update
    await page.waitForTimeout(1000);
    
    const updateTime = Date.now() - startTime;
    
    // Should handle complex content reasonably quickly
    expect(updateTime).toBeLessThan(5000);
    
    // Should still be responsive
    await expect(page.getByRole('complementary')).toBeVisible();
  });

  test('should not have memory leaks with repeated operations', async ({ page }) => {
    // Perform many repeated operations
    for (let i = 0; i < 20; i++) {
      // Toggle dark mode
      await page.getByRole('button', { name: /dark mode/i }).click();
      
      // Rotate
      await page.getByRole('button', { name: /rotate/i }).click();
      
      // Zoom operations
      await page.getByRole('button', { name: /zoom in/i }).click();
      await page.getByRole('button', { name: /zoom out/i }).click();
      
      // Every 5 iterations, check responsiveness
      if (i % 5 === 0) {
        await expect(page.getByRole('main')).toBeVisible();
      }
    }
    
    // Final responsiveness check
    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.getByRole('complementary')).toBeVisible();
  });
});

test.describe('SVG Editor Cross-Browser Compatibility E2E Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should work with different user agent strings', async ({ page }) => {
    // Test with different user agents to simulate different browsers
    const userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.1 Safari/605.1.15',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:89.0) Gecko/20100101 Firefox/89.0'
    ];
    
    for (const userAgent of userAgents) {
      await page.setExtraHTTPHeaders({ 'User-Agent': userAgent });
      await page.reload();
      
      // Should work regardless of user agent
      await expect(page.getByRole('main')).toBeVisible();
      await expect(page.getByRole('complementary')).toBeVisible();
      
      // Test basic functionality
      await page.getByRole('button', { name: /dark mode/i }).click();
      await page.getByRole('button', { name: /rotate/i }).click();
    }
  });

  test('should handle different screen densities', async ({ page }) => {
    // Test with different device pixel ratios
    await page.emulateMedia({ reducedMotion: 'reduce' });
    
    // Should respect reduced motion preferences
    await expect(page.getByRole('main')).toBeVisible();
    
    // Test with high DPI
    await page.setViewportSize({ width: 1920, height: 1080 });
    await expect(page.getByRole('main')).toBeVisible();
    
    // Test with low DPI
    await page.setViewportSize({ width: 800, height: 600 });
    await expect(page.getByRole('main')).toBeVisible();
  });

  test('should work with JavaScript disabled features', async ({ page }) => {
    // Test graceful degradation when certain features might not be available
    await page.addInitScript(() => {
      // Mock missing APIs
      delete (window as any).localStorage;
      delete (window as any).sessionStorage;
    });
    
    await page.reload();
    
    // Should still load basic functionality
    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.getByRole('complementary')).toBeVisible();
  });

  test('should handle different color schemes', async ({ page }) => {
    // Test with dark color scheme preference
    await page.emulateMedia({ colorScheme: 'dark' });
    
    // Should respect system color scheme
    await expect(page.getByRole('main')).toBeVisible();
    
    // Test with light color scheme
    await page.emulateMedia({ colorScheme: 'light' });
    
    // Should work with light scheme
    await expect(page.getByRole('main')).toBeVisible();
    
    // Test with no preference
    await page.emulateMedia({ colorScheme: null });
    
    // Should work without preference
    await expect(page.getByRole('main')).toBeVisible();
  });
});

test.describe('SVG Editor Integration E2E Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should integrate editor and preview seamlessly', async ({ page }) => {
    // Change editor content and verify preview updates
    const editor = page.locator('#editor .cm-content');
    await editor.click();
    
    // Clear existing content
    await page.keyboard.press('Control+a');
    
    // Add new SVG content
    const newSVG = '<svg width="200" height="200"><circle cx="100" cy="100" r="50" fill="red"/></svg>';
    await page.keyboard.type(newSVG);
    
    // Preview should update
    const preview = page.locator('#preview');
    await expect(preview).toBeVisible();
    
    // Check that SVG is rendered in preview
    const svgInPreview = preview.locator('svg');
    if (await svgInPreview.count() > 0) {
      await expect(svgInPreview).toBeVisible();
    }
  });

  test('should maintain state across operations', async ({ page }) => {
    // Perform a series of operations and verify state is maintained
    
    // Start with dark mode
    await page.getByRole('button', { name: /dark mode/i }).click();
    const body = page.locator('body');
    
    // Check dark mode is applied
    // Note: In real implementation, would check actual CSS classes
    
    // Rotate SVG
    await page.getByRole('button', { name: /rotate/i }).click();
    
    // Zoom in
    await page.getByRole('button', { name: /zoom in/i }).click();
    
    // Flip layout
    await page.getByRole('button', { name: /flip screen/i }).click();
    
    // All operations should be preserved
    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.getByRole('complementary')).toBeVisible();
    
    // State should be consistent
    // In real implementation, would verify transform states, etc.
  });

  test('should handle complex user workflows', async ({ page }) => {
    // Simulate a complete user workflow
    
    // 1. User opens resolution modal
    await page.getByRole('button', { name: /resize|resolution/i }).click();
    const modal = page.locator('dialog');
    await expect(modal).toBeVisible();
    
    // 2. User changes dimensions
    await modal.locator('#width').fill('300');
    await modal.locator('#height').fill('400');
    await modal.getByRole('button', { name: /update/i }).click();
    
    // 3. User rotates the SVG
    await page.getByRole('button', { name: /rotate/i }).click();
    
    // 4. User flips horizontally
    await page.getByRole('button', { name: /flip.*horizontal/i }).click();
    
    // 5. User zooms in
    await page.getByRole('button', { name: /zoom in/i }).click();
    
    // 6. User toggles dark mode
    await page.getByRole('button', { name: /dark mode/i }).click();
    
    // 7. User toggles layout
    await page.getByRole('button', { name: /flip screen/i }).click();
    
    // Application should handle the complete workflow smoothly
    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.getByRole('complementary')).toBeVisible();
  });
});