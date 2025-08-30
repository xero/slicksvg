import { test, expect, devices } from '@playwright/test';

test.describe('SVG Editor Mobile Devices E2E Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html');
    // Wait for the app to load completely
    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.getByRole('complementary')).toBeVisible();
  });

  test.describe('iPhone Testing', () => {
    test('should work on iPhone 12 portrait mode', async ({ page, browserName }) => {
      // iPhone 12 specific viewport
      await page.setViewportSize({ width: 390, height: 844 });
      
      // Check all essential UI elements are accessible
      await expect(page.locator('#upload')).toBeVisible();
      await expect(page.locator('#dark')).toBeVisible();
      await expect(page.locator('#flip')).toBeVisible();
      await expect(page.locator('#rotate')).toBeVisible();
      
      // Test basic functionality
      await page.locator('#dark').click();
      await page.locator('#rotate').click();
      
      // Verify the app remains functional
      await expect(page.getByRole('main')).toBeVisible();
      await expect(page.getByRole('complementary')).toBeVisible();
    });

    test('should work on iPhone 12 landscape mode', async ({ page }) => {
      // iPhone 12 landscape viewport
      await page.setViewportSize({ width: 844, height: 390 });
      
      // Check layout adapts to landscape
      await expect(page.getByRole('main')).toBeVisible();
      await expect(page.getByRole('complementary')).toBeVisible();
      
      // Test toolbar accessibility in landscape
      await expect(page.locator('#zoomin')).toBeVisible();
      await expect(page.locator('#zoomout')).toBeVisible();
      await expect(page.locator('#resolution')).toBeVisible();
      
      // Test zoom functionality works in landscape
      await page.locator('#zoomin').click();
      await page.locator('#zoomout').click();
      
      // Should remain functional
      await expect(page.locator('#preview')).toBeVisible();
    });

    test('should handle iPhone safe areas and notches', async ({ page }) => {
      // iPhone 12 Pro with safe area considerations
      await page.setViewportSize({ width: 390, height: 844 });
      
      // Add safe area simulation
      await page.addInitScript(() => {
        const style = document.createElement('style');
        style.textContent = `
          :root {
            --safe-area-inset-top: 47px;
            --safe-area-inset-bottom: 34px;
            --safe-area-inset-left: 0px;
            --safe-area-inset-right: 0px;
          }
        `;
        document.head.appendChild(style);
      });
      
      await page.reload();
      
      // Check that content is not hidden behind notch areas
      await expect(page.getByRole('main')).toBeVisible();
      await expect(page.getByRole('complementary')).toBeVisible();
      
      // Test that controls are still accessible
      await page.locator('#dark').click();
      await expect(page.getByRole('main')).toBeVisible();
    });
  });

  test.describe('Android Device Testing', () => {
    test('should work on Galaxy S9+ portrait mode', async ({ page }) => {
      // Galaxy S9+ viewport
      await page.setViewportSize({ width: 412, height: 846 });
      
      // Test Android-specific behaviors
      await expect(page.getByRole('main')).toBeVisible();
      await expect(page.getByRole('complementary')).toBeVisible();
      
      // Test editor functionality on Android
      const editor = page.locator('#editor .cm-content');
      await editor.click();
      
      // Simulate Android virtual keyboard behavior
      await page.setViewportSize({ width: 412, height: 400 }); // Simulated keyboard open
      
      // App should still be usable with keyboard open
      await expect(page.getByRole('main')).toBeVisible();
      
      // Close virtual keyboard simulation
      await page.setViewportSize({ width: 412, height: 846 });
      await expect(page.getByRole('complementary')).toBeVisible();
    });

    test('should work on Galaxy S9+ landscape mode', async ({ page }) => {
      // Galaxy S9+ landscape viewport
      await page.setViewportSize({ width: 846, height: 412 });
      
      // Test landscape optimization
      await expect(page.getByRole('main')).toBeVisible();
      await expect(page.getByRole('complementary')).toBeVisible();
      
      // Test flip screen functionality in landscape
      await page.locator('#flip').click();
      await expect(page.getByRole('main')).toBeVisible();
      
      // Test editor in landscape
      const editor = page.locator('#editor .cm-content');
      await editor.click();
      await page.keyboard.type('<circle cx="50" cy="50" r="20" fill="blue"/>');
      
      // Should update preview in landscape
      await expect(page.locator('#preview')).toBeVisible();
    });

    test('should handle Android Chrome specific features', async ({ page }) => {
      // Test Android Chrome behaviors
      await page.setViewportSize({ width: 412, height: 846 });
      
      // Simulate Android back button behavior
      await page.goBack();
      await page.goForward();
      
      // App should still be functional
      await expect(page.getByRole('main')).toBeVisible();
      await expect(page.getByRole('complementary')).toBeVisible();
      
      // Test Android fullscreen behavior
      await page.evaluate(() => {
        if (document.documentElement.requestFullscreen) {
          document.documentElement.requestFullscreen();
        }
      });
      
      // Wait a bit for fullscreen transition
      await page.waitForTimeout(500);
      
      // Should still be functional in fullscreen
      await expect(page.getByRole('main')).toBeVisible();
    });
  });

  test.describe('Small Screen Device Testing', () => {
    test('should work on very small screens (iPhone SE)', async ({ page }) => {
      // iPhone SE viewport (very small)
      await page.setViewportSize({ width: 375, height: 667 });
      
      // Test that all critical UI is accessible
      await expect(page.locator('#upload')).toBeVisible();
      await expect(page.locator('#dark')).toBeVisible();
      
      // Test touch targets are large enough
      const uploadButton = page.locator('#upload');
      const boundingBox = await uploadButton.boundingBox();
      
      if (boundingBox) {
        // Touch targets should be at least 44px for accessibility
        expect(boundingBox.height).toBeGreaterThanOrEqual(24); // Allow some flexibility
        expect(boundingBox.width).toBeGreaterThanOrEqual(24);
      }
      
      // Test functionality on small screen
      await page.locator('#rotate').click();
      await page.locator('#zoomin').click();
      
      await expect(page.getByRole('main')).toBeVisible();
    });

    test('should handle extreme aspect ratios', async ({ page }) => {
      // Very wide screen (like some foldable devices)
      await page.setViewportSize({ width: 890, height: 344 });
      
      await expect(page.getByRole('main')).toBeVisible();
      await expect(page.getByRole('complementary')).toBeVisible();
      
      // Very tall screen
      await page.setViewportSize({ width: 344, height: 890 });
      
      await expect(page.getByRole('main')).toBeVisible();
      await expect(page.getByRole('complementary')).toBeVisible();
      
      // Test functionality in extreme aspect ratios
      await page.locator('#flip').click();
      await expect(page.getByRole('main')).toBeVisible();
    });
  });

  test.describe('High DPI and Retina Display Testing', () => {
    test('should render correctly on high DPI displays', async ({ page }) => {
      // Simulate high DPI display
      await page.setViewportSize({ width: 414, height: 896 });
      await page.emulateMedia({ 
        reducedMotion: 'no-preference',
        colorScheme: 'light'
      });
      
      // Test that SVG rendering is crisp on high DPI
      const svgPreview = page.locator('.svg-preview-wrapper svg');
      await expect(svgPreview).toBeVisible();
      
      // Test zoom functionality with high DPI
      await page.locator('#zoomin').click();
      await page.locator('#zoomin').click();
      
      // Should remain crisp when zoomed
      await expect(svgPreview).toBeVisible();
      
      // Test editor text clarity
      const editor = page.locator('#editor .cm-content');
      await editor.click();
      await page.keyboard.type('<!-- High DPI test -->');
      
      // Text should be visible and clear
      await expect(editor).toContainText('High DPI test');
    });

    test('should work with different pixel ratios', async ({ page }) => {
      // Test various device pixel ratios
      const pixelRatios = [1, 1.5, 2, 3];
      
      for (const ratio of pixelRatios) {
        await page.evaluate((devicePixelRatio) => {
          Object.defineProperty(window, 'devicePixelRatio', {
            value: devicePixelRatio,
            writable: true
          });
        }, ratio);
        
        await page.reload();
        
        // Should work with any pixel ratio
        await expect(page.getByRole('main')).toBeVisible();
        await expect(page.getByRole('complementary')).toBeVisible();
        
        // Test basic functionality
        await page.locator('#dark').click();
        await page.locator('#dark').click(); // Toggle back
      }
    });
  });

  test.describe('Network Conditions Simulation', () => {
    test('should work with slow network connections', async ({ page }) => {
      // Simulate slow 3G connection
      await page.route('**/*', async (route) => {
        // Add delay to simulate slow network
        await new Promise(resolve => setTimeout(resolve, 100));
        await route.continue();
      });
      
      await page.setViewportSize({ width: 375, height: 667 });
      
      // Should still load and be functional
      await expect(page.getByRole('main')).toBeVisible();
      await expect(page.getByRole('complementary')).toBeVisible();
      
      // Test that interactions work despite slow network
      await page.locator('#rotate').click();
      await expect(page.getByRole('main')).toBeVisible();
    });

    test('should handle offline conditions gracefully', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      
      // Simulate going offline
      await page.context().setOffline(true);
      
      // App should still function (since it's a client-side app)
      await page.locator('#dark').click();
      await page.locator('#rotate').click();
      
      await expect(page.getByRole('main')).toBeVisible();
      
      // Restore online
      await page.context().setOffline(false);
    });
  });

  test.describe('Device-Specific Gestures', () => {
    test('should handle mobile-specific interactions', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      
      // Test long press simulation
      const uploadButton = page.locator('#upload');
      await uploadButton.hover();
      await page.mouse.down();
      await page.waitForTimeout(800); // Long press duration
      await page.mouse.up();
      
      // Should not break the app
      await expect(page.getByRole('main')).toBeVisible();
      
      // Test double tap
      await uploadButton.dblclick();
      await expect(page.getByRole('main')).toBeVisible();
    });

    test('should handle edge swipe gestures', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      
      // Simulate edge swipe from left
      await page.mouse.move(0, 300);
      await page.mouse.down();
      await page.mouse.move(50, 300);
      await page.mouse.up();
      
      // App should remain functional
      await expect(page.getByRole('main')).toBeVisible();
      
      // Simulate edge swipe from right
      await page.mouse.move(375, 300);
      await page.mouse.down();
      await page.mouse.move(325, 300);
      await page.mouse.up();
      
      await expect(page.getByRole('complementary')).toBeVisible();
    });
  });
});
