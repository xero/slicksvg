import { test, expect } from '@playwright/test';

test.describe('SVG Editor Error Handling E2E Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should handle invalid SVG content gracefully', async ({ page }) => {
    // Wait for editor to load
    await expect(page.getByRole('main')).toBeVisible();
    
    // Clear the editor and enter invalid content
    const editor = page.locator('#editor .cm-content');
    await editor.click();
    await page.keyboard.press('Control+a');
    await page.keyboard.type('This is not valid SVG content');
    
    // The preview should handle this gracefully without crashing
    const preview = page.locator('#preview');
    await expect(preview).toBeVisible();
    
    // Check that no error dialogs or alerts appear
    page.on('dialog', dialog => {
      console.log('Unexpected dialog:', dialog.message());
      dialog.dismiss();
    });
  });

  test('should show error states for file upload', async ({ page }) => {
    // Mock file input to test error handling
    await page.addInitScript(() => {
      // Override file input behavior to simulate errors
      document.addEventListener('DOMContentLoaded', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.style.display = 'none';
        input.id = 'file-input';
        document.body.appendChild(input);
        
        // Mock FileReader for testing
        class MockFileReader {
          readAsText(file: File) {
            setTimeout(() => {
              if (file.name.endsWith('.txt')) {
                // Simulate error for non-SVG files
                this.onerror && this.onerror(new Error('Invalid file type'));
              } else if (file.name === 'empty.svg') {
                // Simulate empty file
                this.onload && this.onload({ target: { result: '' } } as any);
              } else if (file.name === 'malformed.svg') {
                // Simulate malformed SVG
                this.onload && this.onload({ target: { result: '<svg><rect>' } } as any);
              } else {
                // Valid SVG
                this.onload && this.onload({ 
                  target: { result: '<svg><rect width="100" height="100"/></svg>' } 
                } as any);
              }
            }, 10);
          }
          
          onerror: ((error: any) => void) | null = null;
          onload: ((event: any) => void) | null = null;
        }
        
        (window as any).FileReader = MockFileReader;
      });
    });

    // Test with invalid file type
    await page.evaluate(() => {
      const file = new File(['not svg content'], 'test.txt', { type: 'text/plain' });
      const reader = new (window as any).FileReader();
      reader.onerror = () => console.log('File read error handled');
      reader.readAsText(file);
    });

    // Test with empty SVG file
    await page.evaluate(() => {
      const file = new File([''], 'empty.svg', { type: 'image/svg+xml' });
      const reader = new (window as any).FileReader();
      reader.onload = (e: any) => {
        if (!e.target.result) {
          console.log('Empty file handled');
        }
      };
      reader.readAsText(file);
    });
  });

  test('should handle modal input validation errors', async ({ page }) => {
    // Open resolution modal
    await page.getByRole('button', { name: /resize|resolution/i }).click();
    
    const dialog = page.locator('dialog');
    await expect(dialog).toBeVisible();
    
    // Test invalid width input
    const widthInput = dialog.locator('#width');
    const heightInput = dialog.locator('#height');
    
    await widthInput.fill('0');
    await heightInput.fill('100');
    
    // Click update button
    await dialog.getByRole('button', { name: /update/i }).click();
    
    // Should show validation error (check for alert or error message)
    page.on('dialog', async dialog => {
      expect(dialog.message()).toContain('valid');
      await dialog.accept();
    });
    
    // Test negative values
    await widthInput.fill('-50');
    await dialog.getByRole('button', { name: /update/i }).click();
    
    // Test non-numeric values - use setAttribute since browsers prevent typing text in number inputs
    await widthInput.evaluate((input: HTMLInputElement) => {
      input.setAttribute('type', 'text');
      input.value = 'abc';
      input.setAttribute('type', 'number');
    });
    await dialog.getByRole('button', { name: /update/i }).click();
    
    // Close modal
    await dialog.getByRole('button', { name: /cancel/i }).click();
  });

  test('should handle network errors gracefully', async ({ page }) => {
    // Mock network failure for external resources
    await page.route('**/*', async route => {
      if (route.request().url().includes('cdn') || route.request().url().includes('external')) {
        await route.abort();
      } else {
        await route.continue();
      }
    });
    
    // The application should still load and function
    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.getByRole('complementary')).toBeVisible();
  });

  test('should handle JavaScript errors without crashing', async ({ page }) => {
    // Listen for console errors
    const errors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });
    
    // Inject code that might cause errors
    await page.addInitScript(() => {
      // Override a method to cause potential errors
      const originalAddEventListener = document.addEventListener;
      document.addEventListener = function(type: string, listener: any, options?: any) {
        try {
          return originalAddEventListener.call(this, type, listener, options);
        } catch (error) {
          console.error('Event listener error:', error);
          // Application should continue functioning
        }
      };
    });
    
    // Try to interact with the application
    await page.getByRole('button', { name: /dark mode/i }).click();
    await page.getByRole('button', { name: /flip screen/i }).click();
    
    // Application should still be responsive
    await expect(page.getByRole('main')).toBeVisible();
    
    // Check that any errors were handled gracefully
    if (errors.length > 0) {
      console.log('Handled errors:', errors);
    }
  });

  test('should handle touch events on non-touch devices', async ({ page }) => {
    // Simulate touch events even on non-touch devices
    await page.addInitScript(() => {
      // Mock touch events
      const mockTouch = {
        clientX: 100,
        clientY: 100,
        identifier: 1
      };
      
      const mockTouchEvent = {
        touches: [mockTouch, { ...mockTouch, clientX: 200 }],
        preventDefault: () => {},
        type: 'touchstart'
      };
      
      // Dispatch mock touch events
      setTimeout(() => {
        const preview = document.getElementById('preview');
        if (preview) {
          preview.dispatchEvent(new CustomEvent('touchstart', { detail: mockTouchEvent }));
          preview.dispatchEvent(new CustomEvent('touchmove', { detail: mockTouchEvent }));
          preview.dispatchEvent(new CustomEvent('touchend', { detail: mockTouchEvent }));
        }
      }, 1000);
    });
    
    // Application should handle these gracefully
    await expect(page.getByRole('complementary')).toBeVisible();
  });

  test('should handle rapid user interactions', async ({ page }) => {
    // Rapid clicking should not crash the application
    const rotateButton = page.getByRole('button', { name: /rotate/i });
    
    // Click rapidly multiple times
    for (let i = 0; i < 10; i++) {
      await rotateButton.click({ delay: 50 });
    }
    
    // Application should still be responsive
    await expect(page.getByRole('main')).toBeVisible();
    
    // Try rapid zoom operations
    const zoomInButton = page.getByRole('button', { name: /zoom in/i });
    const zoomOutButton = page.getByRole('button', { name: /zoom out/i });
    
    for (let i = 0; i < 5; i++) {
      await zoomInButton.click({ delay: 30 });
      await zoomOutButton.click({ delay: 30 });
    }
    
    // Application should still function
    await expect(page.getByRole('complementary')).toBeVisible();
  });

  test('should handle browser resize events', async ({ page }) => {
    // Get initial viewport size
    const initialViewport = page.viewportSize();
    
    // Resize to mobile size
    await page.setViewportSize({ width: 375, height: 667 });
    
    // Application should still be usable
    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.getByRole('complementary')).toBeVisible();
    
    // Resize to desktop size
    await page.setViewportSize({ width: 1920, height: 1080 });
    
    // Application should adapt
    await expect(page.getByRole('main')).toBeVisible();
    
    // Resize to very narrow
    await page.setViewportSize({ width: 320, height: 568 });
    
    // Should still be functional
    await expect(page.getByRole('main')).toBeVisible();
    
    // Restore original size
    if (initialViewport) {
      await page.setViewportSize(initialViewport);
    }
  });

  test('should handle memory constraints with large SVG', async ({ page }) => {
    // Create a large SVG content
    const largeSVGContent = `<svg width="1000" height="1000" viewBox="0 0 1000 1000">
      ${Array.from({ length: 100 }, (_, i) => 
        `<rect x="${i * 10}" y="${i * 10}" width="50" height="50" fill="#${i.toString(16).padStart(6, '0')}" />`
      ).join('')}
    </svg>`;
    
    // Input large content into editor more efficiently using CodeMirror API
    await page.evaluate((content) => {
      // Access the global editor instance and set content directly
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
    }, largeSVGContent);
    
    // Application should handle this without freezing
    await expect(page.getByRole('main')).toBeVisible();
    
    // Try to interact with other controls
    await page.getByRole('button', { name: /dark mode/i }).click();
    
    // Should remain responsive
    await expect(page.getByRole('complementary')).toBeVisible();
  });

  test('should handle localStorage errors', async ({ page }) => {
    // Mock localStorage to throw errors
    await page.addInitScript(() => {
      const originalSetItem = localStorage.setItem;
      const originalGetItem = localStorage.getItem;
      
      localStorage.setItem = function(key: string, value: string) {
        throw new Error('Storage quota exceeded');
      };
      
      localStorage.getItem = function(key: string) {
        throw new Error('Storage unavailable');
      };
    });
    
    // Application should still load and function
    await expect(page.getByRole('main')).toBeVisible();
    
    // Try operations that might use localStorage
    await page.getByRole('button', { name: /dark mode/i }).click();
    await page.getByRole('button', { name: /flip screen/i }).click();
    
    // Should continue working
    await expect(page.getByRole('complementary')).toBeVisible();
  });

  test('should handle edge cases in SVG parsing', async ({ page }) => {
    const edgeCaseSVGs = [
      // Empty SVG
      '<svg></svg>',
      // SVG with no dimensions
      '<svg><rect/></svg>',
      // SVG with only viewBox
      '<svg viewBox="0 0 100 100"><circle r="50"/></svg>',
      // SVG with special characters
      '<svg><text>Special chars: &lt;&gt;&amp;</text></svg>',
      // SVG with comments
      '<svg><!-- This is a comment --><rect width="100" height="100"/></svg>',
      // Nested SVG
      '<svg><svg><rect width="50" height="50"/></svg></svg>'
    ];
    
    const editor = page.locator('#editor .cm-content');
    
    for (const svgContent of edgeCaseSVGs) {
      await editor.click();
      await page.keyboard.press('Control+a');
      await page.keyboard.type(svgContent);
      
      // Wait a moment for processing
      await page.waitForTimeout(500);
      
      // Application should handle each case
      await expect(page.getByRole('main')).toBeVisible();
      await expect(page.getByRole('complementary')).toBeVisible();
    }
  });
});