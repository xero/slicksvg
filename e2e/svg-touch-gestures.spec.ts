import { test, expect } from '@playwright/test';

test.describe('SVG Editor Advanced Touch Gestures E2E Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/src/index.html');
    // Wait for the app to load completely
    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.getByRole('complementary')).toBeVisible();
  });

  test.describe('Multi-Touch Pinch Gestures', () => {
    test('should handle precise pinch-to-zoom with momentum', async ({ page }) => {
      // Set mobile viewport for touch testing
      await page.setViewportSize({ width: 375, height: 667 });
      
      const preview = page.locator('#preview');
      await expect(preview).toBeVisible();
      
      // Test slow, precise pinch
      await preview.dispatchEvent('touchstart', {
        touches: [
          { clientX: 150, clientY: 200, identifier: 1, force: 0.5 },
          { clientX: 225, clientY: 200, identifier: 2, force: 0.5 }
        ]
      });
      
      // Gradual pinch out (zoom in)
      for (let i = 0; i < 5; i++) {
        await preview.dispatchEvent('touchmove', {
          touches: [
            { clientX: 150 - i * 10, clientY: 200, identifier: 1, force: 0.5 + i * 0.1 },
            { clientX: 225 + i * 10, clientY: 200, identifier: 2, force: 0.5 + i * 0.1 }
          ]
        });
        await page.waitForTimeout(50);
      }
      
      await preview.dispatchEvent('touchend', {
        touches: []
      });
      
      // Should handle gradual pinch smoothly
      await expect(preview).toBeVisible();
    });

    test('should handle rapid pinch gestures', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      
      const preview = page.locator('#preview');
      await expect(preview).toBeVisible();
      
      // Test rapid pinch sequence
      for (let cycle = 0; cycle < 3; cycle++) {
        // Pinch out quickly
        await preview.dispatchEvent('touchstart', {
          touches: [
            { clientX: 170, clientY: 200, identifier: 1 },
            { clientX: 205, clientY: 200, identifier: 2 }
          ]
        });
        
        await preview.dispatchEvent('touchmove', {
          touches: [
            { clientX: 140, clientY: 200, identifier: 1 },
            { clientX: 235, clientY: 200, identifier: 2 }
          ]
        });
        
        await preview.dispatchEvent('touchend', {
          touches: []
        });
        
        await page.waitForTimeout(100);
        
        // Pinch in quickly
        await preview.dispatchEvent('touchstart', {
          touches: [
            { clientX: 140, clientY: 200, identifier: 1 },
            { clientX: 235, clientY: 200, identifier: 2 }
          ]
        });
        
        await preview.dispatchEvent('touchmove', {
          touches: [
            { clientX: 170, clientY: 200, identifier: 1 },
            { clientX: 205, clientY: 200, identifier: 2 }
          ]
        });
        
        await preview.dispatchEvent('touchend', {
          touches: []
        });
        
        await page.waitForTimeout(100);
      }
      
      // Should remain stable after rapid pinching
      await expect(preview).toBeVisible();
    });

    test('should handle asymmetric pinch gestures', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      
      const preview = page.locator('#preview');
      await expect(preview).toBeVisible();
      
      // Test pinch where fingers move unequally
      await preview.dispatchEvent('touchstart', {
        touches: [
          { clientX: 150, clientY: 200, identifier: 1 },
          { clientX: 225, clientY: 200, identifier: 2 }
        ]
      });
      
      // Move fingers asymmetrically
      await preview.dispatchEvent('touchmove', {
        touches: [
          { clientX: 120, clientY: 180, identifier: 1 }, // Move left and up
          { clientX: 260, clientY: 220, identifier: 2 }  // Move right and down
        ]
      });
      
      await preview.dispatchEvent('touchend', {
        touches: []
      });
      
      // Should handle asymmetric movement gracefully
      await expect(preview).toBeVisible();
    });
  });

  test.describe('Complex Pan Gestures', () => {
    test('should handle multi-directional pan sequences', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      
      const preview = page.locator('#preview');
      await expect(preview).toBeVisible();
      
      // Test pan in multiple directions
      const panSequence = [
        { start: { x: 150, y: 200 }, end: { x: 200, y: 200 } }, // Right
        { start: { x: 200, y: 200 }, end: { x: 200, y: 150 } }, // Up
        { start: { x: 200, y: 150 }, end: { x: 150, y: 150 } }, // Left
        { start: { x: 150, y: 150 }, end: { x: 150, y: 200 } }  // Down
      ];
      
      for (const pan of panSequence) {
        await preview.dispatchEvent('touchstart', {
          touches: [
            { clientX: pan.start.x, clientY: pan.start.y, identifier: 1 }
          ]
        });
        
        // Smooth pan movement
        const steps = 5;
        for (let i = 1; i <= steps; i++) {
          const progress = i / steps;
          const currentX = pan.start.x + (pan.end.x - pan.start.x) * progress;
          const currentY = pan.start.y + (pan.end.y - pan.start.y) * progress;
          
          await preview.dispatchEvent('touchmove', {
            touches: [
              { clientX: currentX, clientY: currentY, identifier: 1 }
            ]
          });
          await page.waitForTimeout(20);
        }
        
        await preview.dispatchEvent('touchend', {
          touches: []
        });
        
        await page.waitForTimeout(100);
      }
      
      // Should handle complex pan sequences
      await expect(preview).toBeVisible();
    });

    test('should handle momentum-based pan gestures', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      
      const preview = page.locator('#preview');
      await expect(preview).toBeVisible();
      
      // Test fast pan with momentum
      await preview.dispatchEvent('touchstart', {
        touches: [
          { clientX: 100, clientY: 200, identifier: 1 }
        ],
        timeStamp: Date.now()
      });
      
      // Fast movement to simulate momentum
      const startTime = Date.now();
      await preview.dispatchEvent('touchmove', {
        touches: [
          { clientX: 275, clientY: 200, identifier: 1 }
        ],
        timeStamp: startTime + 100
      });
      
      await preview.dispatchEvent('touchend', {
        touches: [],
        timeStamp: startTime + 120
      });
      
      // Should handle momentum pan gracefully
      await expect(preview).toBeVisible();
    });

    test('should handle interrupted pan gestures', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      
      const preview = page.locator('#preview');
      await expect(preview).toBeVisible();
      
      // Start pan gesture
      await preview.dispatchEvent('touchstart', {
        touches: [
          { clientX: 150, clientY: 200, identifier: 1 }
        ]
      });
      
      // Move partially
      await preview.dispatchEvent('touchmove', {
        touches: [
          { clientX: 200, clientY: 200, identifier: 1 }
        ]
      });
      
      // Simulate interruption (e.g., phone call, notification)
      await preview.dispatchEvent('touchcancel', {
        touches: []
      });
      
      // Should handle interruption gracefully
      await expect(preview).toBeVisible();
      
      // Start new gesture after interruption
      await preview.dispatchEvent('touchstart', {
        touches: [
          { clientX: 200, clientY: 200, identifier: 1 }
        ]
      });
      
      await preview.dispatchEvent('touchmove', {
        touches: [
          { clientX: 150, clientY: 200, identifier: 1 }
        ]
      });
      
      await preview.dispatchEvent('touchend', {
        touches: []
      });
      
      await expect(preview).toBeVisible();
    });
  });

  test.describe('Advanced Multi-Touch Gestures', () => {
    test('should handle three-finger gestures', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      
      const preview = page.locator('#preview');
      await expect(preview).toBeVisible();
      
      // Test three-finger tap (potential reset gesture)
      await preview.dispatchEvent('touchstart', {
        touches: [
          { clientX: 150, clientY: 200, identifier: 1 },
          { clientX: 175, clientY: 200, identifier: 2 },
          { clientX: 200, clientY: 200, identifier: 3 }
        ]
      });
      
      await page.waitForTimeout(100);
      
      await preview.dispatchEvent('touchend', {
        touches: []
      });
      
      // Should handle three-finger input gracefully
      await expect(preview).toBeVisible();
    });

    test('should handle four-finger gestures', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      
      const preview = page.locator('#preview');
      await expect(preview).toBeVisible();
      
      // Test four-finger gesture (app switching simulation)
      await preview.dispatchEvent('touchstart', {
        touches: [
          { clientX: 140, clientY: 180, identifier: 1 },
          { clientX: 160, clientY: 180, identifier: 2 },
          { clientX: 140, clientY: 220, identifier: 3 },
          { clientX: 160, clientY: 220, identifier: 4 }
        ]
      });
      
      // Move all fingers up (simulating app switcher)
      await preview.dispatchEvent('touchmove', {
        touches: [
          { clientX: 140, clientY: 100, identifier: 1 },
          { clientX: 160, clientY: 100, identifier: 2 },
          { clientX: 140, clientY: 140, identifier: 3 },
          { clientX: 160, clientY: 140, identifier: 4 }
        ]
      });
      
      await preview.dispatchEvent('touchend', {
        touches: []
      });
      
      // Should not be disrupted by system gestures
      await expect(preview).toBeVisible();
    });

    test('should handle palm rejection', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      
      const preview = page.locator('#preview');
      await expect(preview).toBeVisible();
      
      // Simulate palm touch (large contact area)
      await preview.dispatchEvent('touchstart', {
        touches: [
          { 
            clientX: 150, 
            clientY: 200, 
            identifier: 1,
            radiusX: 30, // Large contact area
            radiusY: 30,
            force: 0.8
          }
        ]
      });
      
      // Add stylus touch (small, precise)
      await preview.dispatchEvent('touchstart', {
        touches: [
          { 
            clientX: 150, 
            clientY: 200, 
            identifier: 1,
            radiusX: 30,
            radiusY: 30,
            force: 0.8
          },
          {
            clientX: 200,
            clientY: 250,
            identifier: 2,
            radiusX: 1, // Very precise
            radiusY: 1,
            force: 0.3
          }
        ]
      });
      
      // Move only the stylus
      await preview.dispatchEvent('touchmove', {
        touches: [
          { 
            clientX: 150, 
            clientY: 200, 
            identifier: 1,
            radiusX: 30,
            radiusY: 30,
            force: 0.8
          },
          {
            clientX: 220,
            clientY: 270,
            identifier: 2,
            radiusX: 1,
            radiusY: 1,
            force: 0.3
          }
        ]
      });
      
      await preview.dispatchEvent('touchend', {
        touches: []
      });
      
      // Should handle palm rejection scenarios
      await expect(preview).toBeVisible();
    });
  });

  test.describe('Touch Pressure and Force', () => {
    test('should handle variable touch pressure', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      
      const preview = page.locator('#preview');
      await expect(preview).toBeVisible();
      
      // Test light touch
      await preview.dispatchEvent('touchstart', {
        touches: [
          { clientX: 150, clientY: 200, identifier: 1, force: 0.1 }
        ]
      });
      
      await preview.dispatchEvent('touchmove', {
        touches: [
          { clientX: 200, clientY: 200, identifier: 1, force: 0.1 }
        ]
      });
      
      await preview.dispatchEvent('touchend', {
        touches: []
      });
      
      await page.waitForTimeout(100);
      
      // Test heavy touch
      await preview.dispatchEvent('touchstart', {
        touches: [
          { clientX: 200, clientY: 200, identifier: 1, force: 1.0 }
        ]
      });
      
      await preview.dispatchEvent('touchmove', {
        touches: [
          { clientX: 150, clientY: 200, identifier: 1, force: 1.0 }
        ]
      });
      
      await preview.dispatchEvent('touchend', {
        touches: []
      });
      
      // Should handle different pressure levels
      await expect(preview).toBeVisible();
    });

    test('should handle 3D Touch / Force Touch simulation', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      
      const uploadButton = page.locator('#upload');
      await expect(uploadButton).toBeVisible();
      
      // Simulate force touch (deep press)
      await uploadButton.dispatchEvent('touchstart', {
        touches: [
          { clientX: 50, clientY: 50, identifier: 1, force: 0.3 }
        ]
      });
      
      // Increase pressure gradually (force touch)
      for (let pressure = 0.4; pressure <= 1.0; pressure += 0.2) {
        await uploadButton.dispatchEvent('touchforcechange', {
          touches: [
            { clientX: 50, clientY: 50, identifier: 1, force: pressure }
          ]
        });
        await page.waitForTimeout(50);
      }
      
      await uploadButton.dispatchEvent('touchend', {
        touches: []
      });
      
      // Should handle force touch without issues
      await expect(page.getByRole('main')).toBeVisible();
    });
  });

  test.describe('Touch Timing and Sequences', () => {
    test('should handle rapid tap sequences', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      
      const rotateButton = page.locator('#rotate');
      await expect(rotateButton).toBeVisible();
      
      // Test rapid tapping (faster than typical UI can handle)
      for (let i = 0; i < 10; i++) {
        await rotateButton.dispatchEvent('touchstart', {
          touches: [
            { clientX: 50, clientY: 50, identifier: 1 }
          ]
        });
        
        await page.waitForTimeout(30);
        
        await rotateButton.dispatchEvent('touchend', {
          touches: []
        });
        
        await page.waitForTimeout(30);
      }
      
      // Should handle rapid tapping gracefully
      await expect(page.getByRole('main')).toBeVisible();
    });

    test('should handle long press with movement', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      
      const preview = page.locator('#preview');
      await expect(preview).toBeVisible();
      
      // Start long press
      await preview.dispatchEvent('touchstart', {
        touches: [
          { clientX: 150, clientY: 200, identifier: 1 }
        ]
      });
      
      // Hold for long press duration while slightly moving
      for (let i = 0; i < 10; i++) {
        await page.waitForTimeout(100);
        await preview.dispatchEvent('touchmove', {
          touches: [
            { clientX: 150 + i, clientY: 200 + i, identifier: 1 }
          ]
        });
      }
      
      await preview.dispatchEvent('touchend', {
        touches: []
      });
      
      // Should handle long press with movement
      await expect(preview).toBeVisible();
    });

    test('should handle gesture conflicts', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      
      const preview = page.locator('#preview');
      await expect(preview).toBeVisible();
      
      // Start what looks like a pinch
      await preview.dispatchEvent('touchstart', {
        touches: [
          { clientX: 150, clientY: 200, identifier: 1 },
          { clientX: 200, clientY: 200, identifier: 2 }
        ]
      });
      
      // But then move like a pan (gesture conflict)
      await preview.dispatchEvent('touchmove', {
        touches: [
          { clientX: 170, clientY: 220, identifier: 1 },
          { clientX: 220, clientY: 220, identifier: 2 }
        ]
      });
      
      // Remove one finger (gesture change)
      await preview.dispatchEvent('touchend', {
        touches: [
          { clientX: 170, clientY: 220, identifier: 1 }
        ],
        changedTouches: [
          { clientX: 220, clientY: 220, identifier: 2 }
        ]
      });
      
      // Continue with single finger
      await preview.dispatchEvent('touchmove', {
        touches: [
          { clientX: 180, clientY: 230, identifier: 1 }
        ]
      });
      
      await preview.dispatchEvent('touchend', {
        touches: []
      });
      
      // Should handle gesture conflicts gracefully
      await expect(preview).toBeVisible();
    });
  });

  test.describe('Touch Edge Cases', () => {
    test('should handle touches outside viewport', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      
      const preview = page.locator('#preview');
      await expect(preview).toBeVisible();
      
      // Start touch inside, move outside
      await preview.dispatchEvent('touchstart', {
        touches: [
          { clientX: 150, clientY: 200, identifier: 1 }
        ]
      });
      
      // Move outside viewport
      await preview.dispatchEvent('touchmove', {
        touches: [
          { clientX: -50, clientY: 200, identifier: 1 }
        ]
      });
      
      // Move back inside
      await preview.dispatchEvent('touchmove', {
        touches: [
          { clientX: 200, clientY: 200, identifier: 1 }
        ]
      });
      
      await preview.dispatchEvent('touchend', {
        touches: []
      });
      
      // Should handle touches that move outside viewport
      await expect(preview).toBeVisible();
    });

    test('should handle maximum finger limit', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      
      const preview = page.locator('#preview');
      await expect(preview).toBeVisible();
      
      // Test with many fingers (beyond typical support)
      const manyTouches = Array.from({ length: 10 }, (_, i) => ({
        clientX: 100 + (i % 5) * 50,
        clientY: 100 + Math.floor(i / 5) * 50,
        identifier: i + 1
      }));
      
      await preview.dispatchEvent('touchstart', {
        touches: manyTouches
      });
      
      await page.waitForTimeout(100);
      
      await preview.dispatchEvent('touchend', {
        touches: []
      });
      
      // Should handle many simultaneous touches gracefully
      await expect(preview).toBeVisible();
    });

    test('should handle touch identifier reuse', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      
      const preview = page.locator('#preview');
      await expect(preview).toBeVisible();
      
      // Use identifier 1
      await preview.dispatchEvent('touchstart', {
        touches: [
          { clientX: 150, clientY: 200, identifier: 1 }
        ]
      });
      
      await preview.dispatchEvent('touchend', {
        touches: []
      });
      
      // Immediately reuse identifier 1
      await preview.dispatchEvent('touchstart', {
        touches: [
          { clientX: 200, clientY: 250, identifier: 1 }
        ]
      });
      
      await preview.dispatchEvent('touchend', {
        touches: []
      });
      
      // Should handle identifier reuse properly
      await expect(preview).toBeVisible();
    });
  });
});