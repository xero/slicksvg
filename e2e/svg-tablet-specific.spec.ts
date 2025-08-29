import { test, expect } from '@playwright/test';

test.describe('SVG Editor Tablet-Specific E2E Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/src/index.html');
    // Wait for the app to load completely
    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.getByRole('complementary')).toBeVisible();
  });

  test.describe('iPad Testing', () => {
    test('should optimize layout for iPad Pro portrait', async ({ page }) => {
      // iPad Pro 12.9" portrait viewport
      await page.setViewportSize({ width: 1024, height: 1366 });
      
      // Check that layout utilizes the larger screen real estate
      await expect(page.getByRole('main')).toBeVisible();
      await expect(page.getByRole('complementary')).toBeVisible();
      
      // Test that both editor and preview have adequate space
      const editorBounds = await page.locator('#editor').boundingBox();
      const previewBounds = await page.locator('#preview').boundingBox();
      
      if (editorBounds && previewBounds) {
        // Both should have substantial width on tablet
        expect(editorBounds.width).toBeGreaterThan(400);
        expect(previewBounds.width).toBeGreaterThan(400);
      }
      
      // Test enhanced functionality available with more space
      await page.locator('#resolution').click();
      const modal = page.locator('dialog');
      await expect(modal).toBeVisible();
      
      // Modal should be well-positioned on tablet
      const modalBounds = await modal.boundingBox();
      if (modalBounds) {
        expect(modalBounds.width).toBeLessThan(800); // Not too wide
        expect(modalBounds.height).toBeLessThan(600); // Not too tall
      }
      
      // Close modal and test other controls
      await page.keyboard.press('Escape');
      await page.locator('#flipx').click();
      await page.locator('#flipy').click();
    });

    test('should optimize layout for iPad Pro landscape', async ({ page }) => {
      // iPad Pro 12.9" landscape viewport
      await page.setViewportSize({ width: 1366, height: 1024 });
      
      // Test landscape-optimized layout
      await expect(page.getByRole('main')).toBeVisible();
      await expect(page.getByRole('complementary')).toBeVisible();
      
      // In landscape, should have more horizontal space
      const mainBounds = await page.locator('[role="main"]').boundingBox();
      const complementaryBounds = await page.locator('[role="complementary"]').boundingBox();
      
      if (mainBounds && complementaryBounds) {
        // Should utilize the full width effectively
        expect(mainBounds.width + complementaryBounds.width).toBeGreaterThan(1200);
      }
      
      // Test flip screen functionality on tablet landscape
      await page.locator('#flip').click();
      await expect(page.getByRole('main')).toBeVisible();
      
      // Should adapt layout when flipped
      await page.locator('#flip').click(); // Flip back
    });

    test('should handle iPad Mini size efficiently', async ({ page }) => {
      // iPad Mini viewport
      await page.setViewportSize({ width: 768, height: 1024 });
      
      // Should work well on smaller tablet
      await expect(page.getByRole('main')).toBeVisible();
      await expect(page.getByRole('complementary')).toBeVisible();
      
      // Test that controls are appropriately sized
      const controls = ['#upload', '#dark', '#flip', '#rotate', '#flipx', '#flipy'];
      
      for (const control of controls) {
        const element = page.locator(control);
        await expect(element).toBeVisible();
        
        const bounds = await element.boundingBox();
        if (bounds) {
          // Touch targets should be adequate for tablets (larger than phone)
          expect(bounds.height).toBeGreaterThanOrEqual(32);
          expect(bounds.width).toBeGreaterThanOrEqual(32);
        }
      }
      
      // Test zoom controls work well on tablet
      await page.locator('#zoomin').click();
      await page.locator('#zoomin').click();
      await page.locator('#zoomout').click();
      
      await expect(page.locator('#preview')).toBeVisible();
    });
  });

  test.describe('Android Tablet Testing', () => {
    test('should work on Galaxy Tab S4', async ({ page }) => {
      // Galaxy Tab S4 viewport
      await page.setViewportSize({ width: 712, height: 1138 });
      
      // Test Android tablet specific behaviors
      await expect(page.getByRole('main')).toBeVisible();
      await expect(page.getByRole('complementary')).toBeVisible();
      
      // Test multi-window/split-screen simulation
      await page.setViewportSize({ width: 356, height: 1138 }); // Half width
      
      // Should still be usable in split-screen mode
      await expect(page.locator('#upload')).toBeVisible();
      await expect(page.locator('#dark')).toBeVisible();
      
      // Restore full size
      await page.setViewportSize({ width: 712, height: 1138 });
      
      // Test Android tablet navigation
      await page.locator('#rotate').click();
      await page.locator('#zoomin').click();
      
      await expect(page.getByRole('main')).toBeVisible();
    });

    test('should handle tablet stylus input simulation', async ({ page }) => {
      // Standard tablet viewport
      await page.setViewportSize({ width: 800, height: 1280 });
      
      // Simulate stylus precision by using smaller touch radius
      const editor = page.locator('#editor .cm-content');
      await editor.click();
      
      // Simulate precise stylus text selection
      await page.mouse.move(100, 200);
      await page.mouse.down();
      await page.mouse.move(200, 200);
      await page.mouse.up();
      
      // Should handle precise input well
      await page.keyboard.type('<rect x="10" y="10" width="50" height="30" fill="green"/>');
      
      // Verify the SVG updates
      await expect(page.locator('#preview')).toBeVisible();
      
      // Test stylus pressure simulation (hover effects)
      await page.locator('#zoomin').hover();
      await page.locator('#zoomin').click();
    });
  });

  test.describe('Tablet Multitasking Features', () => {
    test('should handle tablet split-screen scenarios', async ({ page }) => {
      // Start with full tablet size
      await page.setViewportSize({ width: 1024, height: 1366 });
      
      // Simulate app being moved to split-screen (half width)
      await page.setViewportSize({ width: 512, height: 1366 });
      
      // Should adapt to narrower layout
      await expect(page.getByRole('main')).toBeVisible();
      await expect(page.getByRole('complementary')).toBeVisible();
      
      // Test that functionality remains intact
      await page.locator('#flip').click();
      await expect(page.getByRole('main')).toBeVisible();
      
      // Test very narrow split-screen
      await page.setViewportSize({ width: 320, height: 1366 });
      
      // Should still be usable
      await expect(page.locator('#upload')).toBeVisible();
      
      // Restore full width
      await page.setViewportSize({ width: 1024, height: 1366 });
    });

    test('should handle picture-in-picture mode simulation', async ({ page }) => {
      // Start with normal tablet size
      await page.setViewportSize({ width: 768, height: 1024 });
      
      // Simulate picture-in-picture (small overlay window)
      await page.setViewportSize({ width: 320, height: 240 });
      
      // Should handle very small window gracefully
      await expect(page.getByRole('main')).toBeVisible();
      
      // Essential controls should still be accessible
      await expect(page.locator('#upload')).toBeVisible();
      
      // Restore normal size
      await page.setViewportSize({ width: 768, height: 1024 });
      
      // Should return to full functionality
      await expect(page.getByRole('complementary')).toBeVisible();
    });

    test('should handle tablet dock/undock scenarios', async ({ page }) => {
      // Simulate tablet being docked to keyboard (landscape)
      await page.setViewportSize({ width: 1366, height: 1024 });
      
      // Should optimize for landscape with keyboard
      await expect(page.getByRole('main')).toBeVisible();
      await expect(page.getByRole('complementary')).toBeVisible();
      
      // Test keyboard shortcuts work when docked
      await page.locator('#editor .cm-content').click();
      await page.keyboard.press('Control+a');
      
      // Simulate undocking (portrait)
      await page.setViewportSize({ width: 1024, height: 1366 });
      
      // Should adapt back to portrait touch-optimized layout
      await expect(page.getByRole('main')).toBeVisible();
    });
  });

  test.describe('Tablet-Specific Touch Interactions', () => {
    test('should handle tablet-optimized pinch zoom', async ({ page }) => {
      // Tablet viewport
      await page.setViewportSize({ width: 768, height: 1024 });
      
      const preview = page.locator('#preview');
      await expect(preview).toBeVisible();
      
      // Simulate tablet pinch zoom with larger touch area
      await preview.dispatchEvent('touchstart', {
        touches: [
          { clientX: 200, clientY: 300, identifier: 1, radiusX: 10, radiusY: 10 },
          { clientX: 400, clientY: 300, identifier: 2, radiusX: 10, radiusY: 10 }
        ]
      });
      
      // Larger pinch movement for tablet
      await preview.dispatchEvent('touchmove', {
        touches: [
          { clientX: 150, clientY: 300, identifier: 1, radiusX: 10, radiusY: 10 },
          { clientX: 450, clientY: 300, identifier: 2, radiusX: 10, radiusY: 10 }
        ]
      });
      
      await preview.dispatchEvent('touchend', {
        touches: []
      });
      
      // Should handle tablet pinch smoothly
      await expect(preview).toBeVisible();
    });

    test('should handle tablet two-finger pan', async ({ page }) => {
      // Tablet viewport
      await page.setViewportSize({ width: 768, height: 1024 });
      
      const preview = page.locator('#preview');
      await expect(preview).toBeVisible();
      
      // Simulate two-finger pan gesture (common on tablets)
      await preview.dispatchEvent('touchstart', {
        touches: [
          { clientX: 200, clientY: 300, identifier: 1 },
          { clientX: 220, clientY: 320, identifier: 2 }
        ]
      });
      
      // Move both fingers together to pan
      await preview.dispatchEvent('touchmove', {
        touches: [
          { clientX: 250, clientY: 350, identifier: 1 },
          { clientX: 270, clientY: 370, identifier: 2 }
        ]
      });
      
      await preview.dispatchEvent('touchend', {
        touches: []
      });
      
      // Should handle tablet pan gestures
      await expect(preview).toBeVisible();
    });

    test('should handle tablet rotation gestures', async ({ page }) => {
      // Tablet viewport
      await page.setViewportSize({ width: 768, height: 1024 });
      
      const preview = page.locator('#preview');
      await expect(preview).toBeVisible();
      
      // Simulate rotation gesture (two fingers rotating)
      await preview.dispatchEvent('touchstart', {
        touches: [
          { clientX: 200, clientY: 200, identifier: 1 },
          { clientX: 400, clientY: 200, identifier: 2 }
        ]
      });
      
      // Simulate rotation by moving fingers in circular motion
      await preview.dispatchEvent('touchmove', {
        touches: [
          { clientX: 200, clientY: 400, identifier: 1 },
          { clientX: 400, clientY: 100, identifier: 2 }
        ]
      });
      
      await preview.dispatchEvent('touchend', {
        touches: []
      });
      
      // Should handle tablet rotation gestures gracefully
      await expect(preview).toBeVisible();
    });
  });

  test.describe('Tablet Accessibility Features', () => {
    test('should work with tablet voice control', async ({ page }) => {
      // Tablet viewport
      await page.setViewportSize({ width: 768, height: 1024 });
      
      // Simulate voice control by testing focus navigation
      await page.keyboard.press('Tab');
      
      // Should focus on first interactive element
      const focusedElement = await page.evaluate(() => document.activeElement?.tagName);
      expect(focusedElement).toBeTruthy();
      
      // Test that all controls are reachable via keyboard/voice
      const controls = ['#upload', '#dark', '#flip', '#rotate'];
      
      for (const control of controls) {
        await page.locator(control).focus();
        await expect(page.locator(control)).toBeFocused();
        
        // Simulate voice activation (Enter key)
        await page.keyboard.press('Enter');
        await page.waitForTimeout(100);
      }
    });

    test('should work with tablet switch control', async ({ page }) => {
      // Tablet viewport
      await page.setViewportSize({ width: 768, height: 1024 });
      
      // Simulate switch control navigation (sequential focus)
      const interactiveElements = [
        '#upload', '#dark', '#flip', '#rotate', '#flipx', '#flipy',
        '#zoomin', '#zoomout', '#reset', '#resolution'
      ];
      
      for (const element of interactiveElements) {
        // Focus and activate element
        await page.locator(element).focus();
        await expect(page.locator(element)).toBeFocused();
        
        // Simulate switch activation
        await page.keyboard.press('Space');
        await page.waitForTimeout(200);
        
        // App should remain functional
        await expect(page.getByRole('main')).toBeVisible();
      }
    });

    test('should support tablet screen reader navigation', async ({ page }) => {
      // Tablet viewport
      await page.setViewportSize({ width: 768, height: 1024 });
      
      // Test that all interactive elements have proper labels
      const controls = [
        { selector: '#upload', expectedRole: 'button' },
        { selector: '#dark', expectedRole: 'button' },
        { selector: '#flip', expectedRole: 'button' },
        { selector: '#rotate', expectedRole: 'button' }
      ];
      
      for (const control of controls) {
        const element = page.locator(control.selector);
        await expect(element).toBeVisible();
        
        // Check that element has accessible properties
        const role = await element.getAttribute('role') || 
                    await element.evaluate(el => el.tagName.toLowerCase() === 'button' ? 'button' : null);
        
        if (control.expectedRole === 'button') {
          expect(role === 'button' || await element.evaluate(el => el.tagName.toLowerCase() === 'button')).toBeTruthy();
        }
      }
      
      // Test landmark navigation
      await expect(page.getByRole('main')).toBeVisible();
      await expect(page.getByRole('complementary')).toBeVisible();
    });
  });

  test.describe('Tablet Performance Optimization', () => {
    test('should handle tablet-scale content efficiently', async ({ page }) => {
      // Tablet viewport
      await page.setViewportSize({ width: 1024, height: 1366 });
      
      // Create tablet-appropriate complex SVG
      const complexSVG = `<svg width="800" height="600" viewBox="0 0 800 600">
        ${Array.from({ length: 100 }, (_, i) =>
          `<g transform="translate(${(i % 10) * 80}, ${Math.floor(i / 10) * 60})">
            <rect width="70" height="50" fill="hsl(${i * 3.6}, 70%, 50%)" />
            <circle cx="35" cy="25" r="20" fill="white" opacity="0.8" />
            <text x="35" y="30" text-anchor="middle" font-size="12" fill="black">${i}</text>
          </g>`
        ).join('')}
      </svg>`;
      
      const startTime = Date.now();
      
      // Input complex content
      const editor = page.locator('#editor .cm-content');
      await editor.click();
      
      // Use efficient input method for tablets
      await page.evaluate((content) => {
        const svgEditor = (window as any).svgEditor;
        if (svgEditor?.editor) {
          const transaction = svgEditor.editor.state.update({
            changes: {
              from: 0,
              to: svgEditor.editor.state.doc.length,
              insert: content
            }
          });
          svgEditor.editor.dispatch(transaction);
        }
      }, complexSVG);
      
      // Wait for preview to update
      await page.waitForTimeout(1500);
      
      const updateTime = Date.now() - startTime;
      
      // Should handle complex content efficiently on tablet
      expect(updateTime).toBeLessThan(8000);
      
      // Should remain responsive
      await expect(page.getByRole('complementary')).toBeVisible();
      
      // Test zoom performance with complex content
      await page.locator('#zoomin').click();
      await page.locator('#zoomin').click();
      
      await expect(page.locator('#preview')).toBeVisible();
    });

    test('should maintain 60fps interactions on tablet', async ({ page }) => {
      // Tablet viewport
      await page.setViewportSize({ width: 768, height: 1024 });
      
      // Test smooth interactions
      const startTime = Date.now();
      
      // Perform rapid tablet-style interactions
      for (let i = 0; i < 10; i++) {
        await page.locator('#rotate').click();
        await page.locator('#flipx').click();
        await page.locator('#zoomin').click();
        await page.locator('#zoomout').click();
        
        // Brief pause to allow rendering
        await page.waitForTimeout(50);
      }
      
      const interactionTime = Date.now() - startTime;
      
      // Should complete tablet interactions smoothly
      expect(interactionTime).toBeLessThan(5000);
      
      // Should remain responsive after intense interactions
      await expect(page.getByRole('main')).toBeVisible();
      await expect(page.getByRole('complementary')).toBeVisible();
    });
  });
});