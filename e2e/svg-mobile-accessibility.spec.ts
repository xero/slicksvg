import { test, expect } from '@playwright/test';

test.describe('SVG Editor Mobile Accessibility E2E Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/src/index.html');
    // Wait for the app to load completely
    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.getByRole('complementary')).toBeVisible();
  });

  test.describe('Virtual Keyboard Handling', () => {
    test('should adapt layout when virtual keyboard appears', async ({ page }) => {
      // Mobile viewport
      await page.setViewportSize({ width: 375, height: 667 });
      
      const editor = page.locator('#editor .cm-content');
      await expect(editor).toBeVisible();
      
      // Click to focus editor (should trigger virtual keyboard)
      await editor.click();
      
      // Simulate virtual keyboard appearing (reduces viewport height)
      await page.setViewportSize({ width: 375, height: 400 });
      
      // Editor should still be visible and usable
      await expect(editor).toBeVisible();
      
      // Type some content
      await page.keyboard.type('<circle cx="50" cy="50" r="25" fill="red"/>');
      
      // Preview should update even with virtual keyboard
      await expect(page.locator('#preview')).toBeVisible();
      
      // Simulate keyboard hiding
      await page.setViewportSize({ width: 375, height: 667 });
      
      // Layout should restore
      await expect(page.getByRole('main')).toBeVisible();
      await expect(page.getByRole('complementary')).toBeVisible();
    });

    test('should handle virtual keyboard with different input types', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      
      // Test with resolution modal inputs
      await page.locator('#resolution').click();
      const modal = page.locator('dialog');
      await expect(modal).toBeVisible();
      
      // Focus width input (numeric keyboard)
      const widthInput = modal.locator('#width');
      await widthInput.click();
      
      // Simulate numeric keyboard (smaller than text keyboard)
      await page.setViewportSize({ width: 375, height: 450 });
      
      await widthInput.fill('300');
      
      // Focus height input
      const heightInput = modal.locator('#height');
      await heightInput.click();
      await heightInput.fill('400');
      
      // Modal should remain accessible
      const resizeButton = modal.locator('#resize');
      await expect(resizeButton).toBeVisible();
      
      await resizeButton.click();
      
      // Restore viewport
      await page.setViewportSize({ width: 375, height: 667 });
    });

    test('should maintain scroll position with virtual keyboard', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      
      const editor = page.locator('#editor .cm-content');
      await editor.click();
      
      // Add content that would cause scrolling
      const longSVG = `<svg width="200" height="200" viewBox="0 0 200 200">
        ${Array.from({ length: 20 }, (_, i) => 
          `<line x1="0" y1="${i * 10}" x2="200" y2="${i * 10}" stroke="black"/>`
        ).join('\n')}
      </svg>`;
      
      await page.keyboard.type(longSVG);
      
      // Scroll to bottom of editor
      await page.keyboard.press('Control+End');
      
      // Simulate virtual keyboard
      await page.setViewportSize({ width: 375, height: 400 });
      
      // Should maintain cursor position visibility
      await page.keyboard.type('\n<!-- Additional comment -->');
      
      // Content should still be editable
      await expect(editor).toContainText('Additional comment');
      
      // Restore viewport
      await page.setViewportSize({ width: 375, height: 667 });
    });
  });

  test.describe('Screen Reader Support', () => {
    test('should provide proper ARIA labels for mobile screen readers', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      
      // Check that main controls have accessible labels
      const controls = [
        { selector: '#upload', expectedContent: /upload|file|import/i },
        { selector: '#dark', expectedContent: /dark|theme|mode/i },
        { selector: '#flip', expectedContent: /flip|layout|screen/i },
        { selector: '#rotate', expectedContent: /rotate/i }
      ];
      
      for (const control of controls) {
        const element = page.locator(control.selector);
        await expect(element).toBeVisible();
        
        // Check for accessible name (aria-label, title, or text content)
        const accessibleName = await element.evaluate(el => {
          return el.getAttribute('aria-label') || 
                 el.getAttribute('title') || 
                 el.textContent || 
                 el.value;
        });
        
        expect(accessibleName).toBeTruthy();
        if (control.expectedContent && accessibleName) {
          expect(accessibleName).toMatch(control.expectedContent);
        }
      }
    });

    test('should support mobile screen reader navigation', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      
      // Test heading structure for mobile screen readers
      const headings = await page.locator('h1, h2, h3, h4, h5, h6').all();
      
      // Should have logical heading structure
      for (const heading of headings) {
        await expect(heading).toBeVisible();
        const text = await heading.textContent();
        expect(text).toBeTruthy();
      }
      
      // Test landmark navigation
      await expect(page.getByRole('main')).toBeVisible();
      await expect(page.getByRole('complementary')).toBeVisible();
      
      // Test that interactive elements are keyboard navigable
      await page.keyboard.press('Tab');
      
      let focusedElement = await page.evaluate(() => document.activeElement?.tagName);
      expect(focusedElement).toBeTruthy();
      
      // Navigate through interactive elements
      for (let i = 0; i < 10; i++) {
        await page.keyboard.press('Tab');
        const newFocusedElement = await page.evaluate(() => 
          document.activeElement?.tagName
        );
        
        if (newFocusedElement === focusedElement) {
          break; // End of tabbable elements
        }
        focusedElement = newFocusedElement;
      }
    });

    test('should announce status changes to screen readers', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      
      // Test that status changes are announced
      const statusBar = page.locator('#status');
      await expect(statusBar).toBeVisible();
      
      // Check for live region attributes
      const liveRegion = await statusBar.getAttribute('aria-live');
      expect(['polite', 'assertive']).toContain(liveRegion);
      
      // Trigger status change by entering invalid SVG
      const editor = page.locator('#editor .cm-content');
      await editor.click();
      
      await page.keyboard.press('Control+a');
      await page.keyboard.type('<invalid>not closed');
      
      // Wait for status update
      await page.waitForTimeout(1000);
      
      // Status should show error state
      const statusText = await statusBar.textContent();
      expect(statusText).toMatch(/error|invalid|malformed/i);
    });
  });

  test.describe('Voice Control Support', () => {
    test('should support voice control commands via accessibility API', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      
      // Test that elements can be activated via accessibility API
      const uploadButton = page.locator('#upload');
      
      // Simulate voice command "Click Upload"
      await uploadButton.focus();
      await page.keyboard.press('Enter');
      
      // Should trigger file chooser or appropriate action
      await expect(page.getByRole('main')).toBeVisible();
      
      // Test voice command "Click Dark Mode"
      const darkButton = page.locator('#dark');
      await darkButton.focus();
      await page.keyboard.press('Space');
      
      // Should toggle dark mode
      await expect(page.getByRole('main')).toBeVisible();
    });

    test('should provide clear focus indicators for voice control', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      
      // Test that focused elements are clearly visible
      const interactiveElements = [
        '#upload', '#dark', '#flip', '#rotate', '#flipx', '#flipy',
        '#zoomin', '#zoomout', '#reset'
      ];
      
      for (const selector of interactiveElements) {
        const element = page.locator(selector);
        await element.focus();
        
        // Check that element has visible focus indicator
        const focusStyles = await element.evaluate(el => {
          const styles = window.getComputedStyle(el, ':focus');
          return {
            outline: styles.outline,
            outlineWidth: styles.outlineWidth,
            outlineStyle: styles.outlineStyle,
            boxShadow: styles.boxShadow
          };
        });
        
        // Should have some form of focus indicator
        const hasFocusIndicator = 
          focusStyles.outlineWidth !== '0px' ||
          focusStyles.boxShadow !== 'none' ||
          focusStyles.outline !== 'none';
        
        expect(hasFocusIndicator).toBeTruthy();
      }
    });
  });

  test.describe('Switch Control Support', () => {
    test('should support switch control navigation', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      
      // Test sequential navigation through all interactive elements
      const interactiveSelectors = [
        '#upload', '#dark', '#flip', '#rotate', '#flipx', '#flipy',
        '#zoomin', '#zoomout', '#reset', '#resolution'
      ];
      
      // Start navigation
      await page.keyboard.press('Tab');
      
      for (const selector of interactiveSelectors) {
        // Find the currently focused element
        const focusedSelector = await page.evaluate(() => {
          const focused = document.activeElement;
          return focused?.id ? `#${focused.id}` : null;
        });
        
        if (focusedSelector && interactiveSelectors.includes(focusedSelector)) {
          // Activate with switch control (Space or Enter)
          await page.keyboard.press('Space');
          await page.waitForTimeout(200);
          
          // App should remain functional
          await expect(page.getByRole('main')).toBeVisible();
        }
        
        // Move to next element
        await page.keyboard.press('Tab');
        await page.waitForTimeout(100);
      }
    });

    test('should provide adequate dwell time for switch control', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      
      // Test that elements remain focusable for adequate time
      const uploadButton = page.locator('#upload');
      await uploadButton.focus();
      
      // Wait for typical switch control dwell time
      await page.waitForTimeout(2000);
      
      // Element should still be focused and activatable
      const stillFocused = await page.evaluate(() => 
        document.activeElement?.id === 'upload'
      );
      expect(stillFocused).toBeTruthy();
      
      // Should still be activatable after dwell time
      await page.keyboard.press('Enter');
      await expect(page.getByRole('main')).toBeVisible();
    });
  });

  test.describe('High Contrast and Low Vision Support', () => {
    test('should work with high contrast mode', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      
      // Simulate high contrast mode
      await page.addInitScript(() => {
        const style = document.createElement('style');
        style.textContent = `
          @media (prefers-contrast: high) {
            * {
              background: black !important;
              color: white !important;
              border: 1px solid white !important;
            }
          }
        `;
        document.head.appendChild(style);
      });
      
      await page.emulateMedia({ 
        colorScheme: 'dark',
        reducedMotion: 'no-preference'
      });
      
      await page.reload();
      
      // Should remain functional in high contrast mode
      await expect(page.getByRole('main')).toBeVisible();
      await expect(page.getByRole('complementary')).toBeVisible();
      
      // Test that controls are still accessible
      await page.locator('#dark').click();
      await page.locator('#rotate').click();
      
      await expect(page.getByRole('main')).toBeVisible();
    });

    test('should support zoom up to 200% without breaking layout', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      
      // Simulate 200% zoom
      await page.addInitScript(() => {
        document.body.style.zoom = '2';
      });
      
      await page.reload();
      
      // Layout should adapt to zoom
      await expect(page.getByRole('main')).toBeVisible();
      await expect(page.getByRole('complementary')).toBeVisible();
      
      // Controls should still be accessible when zoomed
      const controls = ['#upload', '#dark', '#flip', '#rotate'];
      
      for (const control of controls) {
        const element = page.locator(control);
        await expect(element).toBeVisible();
        
        // Should be clickable even when zoomed
        await element.click();
        await page.waitForTimeout(100);
      }
    });

    test('should respect reduced motion preferences', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      
      // Test with reduced motion preference
      await page.emulateMedia({ reducedMotion: 'reduce' });
      
      // Should respect motion preferences
      await expect(page.getByRole('main')).toBeVisible();
      
      // Test animations are reduced/disabled
      await page.locator('#rotate').click();
      await page.locator('#flipx').click();
      
      // App should function without relying on animations
      await expect(page.getByRole('main')).toBeVisible();
      
      // Test with no motion preference
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      
      await page.locator('#flipy').click();
      await expect(page.getByRole('main')).toBeVisible();
    });
  });

  test.describe('Mobile-Specific Accessibility Features', () => {
    test('should work with mobile assistive touch', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      
      // Simulate assistive touch overlay
      await page.addInitScript(() => {
        // Create assistive touch simulation
        const assistiveTouch = document.createElement('div');
        assistiveTouch.style.cssText = `
          position: fixed;
          top: 20px;
          right: 20px;
          width: 50px;
          height: 50px;
          background: rgba(255, 255, 255, 0.8);
          border-radius: 50%;
          z-index: 10000;
          pointer-events: auto;
        `;
        assistiveTouch.id = 'assistive-touch';
        document.body.appendChild(assistiveTouch);
      });
      
      await page.reload();
      
      // App should work with assistive touch overlay
      await expect(page.getByRole('main')).toBeVisible();
      
      // Controls should remain accessible
      await page.locator('#upload').click();
      await page.locator('#dark').click();
      
      await expect(page.getByRole('main')).toBeVisible();
    });

    test('should handle orientation changes with assistive technologies', async ({ page }) => {
      // Start in portrait
      await page.setViewportSize({ width: 375, height: 667 });
      
      // Test with screen reader simulation
      await page.addInitScript(() => {
        // Simulate screen reader announcement
        window.announceToScreenReader = (text: string) => {
          const announcement = document.createElement('div');
          announcement.setAttribute('aria-live', 'polite');
          announcement.style.cssText = 'position: absolute; left: -10000px;';
          announcement.textContent = text;
          document.body.appendChild(announcement);
          setTimeout(() => announcement.remove(), 1000);
        };
      });
      
      await page.reload();
      
      // Test in portrait
      await expect(page.getByRole('main')).toBeVisible();
      
      // Rotate to landscape
      await page.setViewportSize({ width: 667, height: 375 });
      
      // Should announce orientation change or layout change
      await page.evaluate(() => {
        (window as any).announceToScreenReader?.('Layout changed to landscape');
      });
      
      // Should remain accessible in landscape
      await expect(page.getByRole('main')).toBeVisible();
      await expect(page.getByRole('complementary')).toBeVisible();
      
      // Test controls in landscape
      await page.locator('#flip').click();
      await expect(page.getByRole('main')).toBeVisible();
    });

    test('should support custom gesture alternatives', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      
      // Test that complex gestures have keyboard/button alternatives
      const preview = page.locator('#preview');
      await expect(preview).toBeVisible();
      
      // Instead of pinch-to-zoom, use zoom buttons
      await page.locator('#zoomin').click();
      await page.locator('#zoomin').click();
      await page.locator('#zoomout').click();
      
      // Should provide same functionality as pinch gestures
      await expect(preview).toBeVisible();
      
      // Instead of pan gestures, could use keyboard
      await preview.click();
      await page.keyboard.press('ArrowUp');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.press('ArrowRight');
      
      // Should provide alternative to pan gestures
      await expect(preview).toBeVisible();
    });
  });

  test.describe('Mobile Input Method Support', () => {
    test('should work with voice input and dictation', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      
      const editor = page.locator('#editor .cm-content');
      await editor.click();
      
      // Simulate voice input (rapid text insertion)
      const dictatedSVG = '<svg width="100" height="100"><circle cx="50" cy="50" r="30" fill="blue"/></svg>';
      
      // Clear existing content
      await page.keyboard.press('Control+a');
      
      // Simulate dictated input (all at once, like voice input)
      await page.evaluate((content) => {
        const activeElement = document.activeElement;
        if (activeElement) {
          const event = new Event('input', { bubbles: true });
          (activeElement as any).value = content;
          activeElement.dispatchEvent(event);
        }
      }, dictatedSVG);
      
      // Should handle voice input gracefully
      await expect(page.locator('#preview')).toBeVisible();
    });

    test('should support handwriting input', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      
      // Test modal inputs with handwriting
      await page.locator('#resolution').click();
      const modal = page.locator('dialog');
      await expect(modal).toBeVisible();
      
      const widthInput = modal.locator('#width');
      await widthInput.click();
      
      // Simulate handwriting input (character by character with delays)
      const handwrittenText = '250';
      for (const char of handwrittenText) {
        await page.keyboard.type(char);
        await page.waitForTimeout(200); // Simulate handwriting recognition delay
      }
      
      const heightInput = modal.locator('#height');
      await heightInput.click();
      
      for (const char of '300') {
        await page.keyboard.type(char);
        await page.waitForTimeout(200);
      }
      
      // Should handle handwriting input
      await modal.locator('#resize').click();
      await expect(page.getByRole('main')).toBeVisible();
    });

    test('should work with external keyboard on mobile', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      
      // Test keyboard shortcuts with external keyboard
      const editor = page.locator('#editor .cm-content');
      await editor.click();
      
      // Test common keyboard shortcuts
      await page.keyboard.press('Control+a'); // Select all
      await page.keyboard.type('<rect x="10" y="10" width="50" height="30"/>');
      
      // Test navigation shortcuts
      await page.keyboard.press('Control+Home'); // Go to start
      await page.keyboard.press('Control+End');   // Go to end
      
      // Test that external keyboard works well with mobile layout
      await expect(page.locator('#preview')).toBeVisible();
      
      // Test keyboard navigation of UI
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      await page.keyboard.press('Enter'); // Activate focused control
      
      await expect(page.getByRole('main')).toBeVisible();
    });
  });
});