import { test, expect } from '@playwright/test';

test.describe('SVG Status Bar E2E Tests', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/index.html');
	});

	test('should display default "svg valid" status', async ({ page }) => {
		// Wait for the status bar to be visible
		const statusBar = page.locator('#svg-status-bar');
		await expect(statusBar).toBeVisible();
		await expect(statusBar).toHaveText('svg valid');
		await expect(statusBar).not.toHaveClass(/error/);
	});

	test('should show error status for malformed SVG', async ({ page }) => {
		// Wait for editor to load
		const editor = page.locator('#editor .cm-content');
		await expect(editor).toBeVisible();

		// Clear editor and type malformed SVG
		await editor.click();
		await page.keyboard.press('Control+a');
		await page.keyboard.type('<svg><rect width="100" height="100"></svg>'); // Missing closing rect tag

		// Wait for linting to process
		await page.waitForTimeout(1000);

		// Check status bar shows error
		const statusBar = page.locator('#svg-status-bar');
		await expect(statusBar).toBeVisible();
		await expect(statusBar).not.toHaveText('svg valid');
		await expect(statusBar).toHaveClass(/error/);
		
		// Verify the error message contains meaningful content
		const statusText = await statusBar.textContent();
		expect(statusText).toBeTruthy();
		expect(statusText?.length).toBeGreaterThan(0);
	});

	test('should return to valid status when error is fixed', async ({ page }) => {
		// Wait for editor to load
		const editor = page.locator('#editor .cm-content');
		await expect(editor).toBeVisible();

		// First create an error
		await editor.click();
		await page.keyboard.press('Control+a');
		await page.keyboard.type('<svg><rect></svg>'); // Missing closing rect tag

		// Wait for linting
		await page.waitForTimeout(1000);

		// Verify error state
		const statusBar = page.locator('#svg-status-bar');
		await expect(statusBar).toHaveClass(/error/);

		// Fix the error by typing valid SVG
		await editor.click();
		await page.keyboard.press('Control+a');
		await page.keyboard.type('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="50" height="50"/></svg>');

		// Wait for linting
		await page.waitForTimeout(1000);

		// Verify back to valid state
		await expect(statusBar).toHaveText('svg valid');
		await expect(statusBar).not.toHaveClass(/error/);
	});

	test('should show warning for non-SVG content', async ({ page }) => {
		// Wait for editor to load
		const editor = page.locator('#editor .cm-content');
		await expect(editor).toBeVisible();

		// Type non-SVG content
		await editor.click();
		await page.keyboard.press('Control+a');
		await page.keyboard.type('<div>This is not SVG</div>');

		// Wait for linting
		await page.waitForTimeout(1000);

		// Check status bar shows error/warning
		const statusBar = page.locator('#svg-status-bar');
		await expect(statusBar).toBeVisible();
		await expect(statusBar).toHaveClass(/error/);
		await expect(statusBar).toHaveText('Document should contain an SVG element');
	});

	test('should handle empty content gracefully', async ({ page }) => {
		// Wait for editor to load
		const editor = page.locator('#editor .cm-content');
		await expect(editor).toBeVisible();

		// Clear all content
		await editor.click();
		await page.keyboard.press('Control+a');
		await page.keyboard.press('Delete');

		// Wait for linting
		await page.waitForTimeout(1000);

		// Status bar should show valid for empty content
		const statusBar = page.locator('#svg-status-bar');
		await expect(statusBar).toHaveText('svg valid');
		await expect(statusBar).not.toHaveClass(/error/);
	});

	test('should not show floating tooltips', async ({ page }) => {
		// Wait for editor to load
		const editor = page.locator('#editor .cm-content');
		await expect(editor).toBeVisible();

		// Create an error
		await editor.click();
		await page.keyboard.press('Control+a');
		await page.keyboard.type('<svg><rect></svg>'); // Missing closing rect tag

		// Wait for linting
		await page.waitForTimeout(1000);

		// Verify lint markers exist but are not interactive
		const lintMarkers = page.locator('.cm-lint-marker');
		if (await lintMarkers.count() > 0) {
			// Try to hover over lint marker
			await lintMarkers.first().hover();
			await page.waitForTimeout(500);

			// Verify no tooltip is visible
			const tooltips = page.locator('.cm-tooltip, .cm-tooltip-lint, .cm-tooltip-below');
			await expect(tooltips).toHaveCount(0);
		}
	});

	test('should preserve status bar across theme changes', async ({ page }) => {
		// Wait for the status bar to be visible
		const statusBar = page.locator('#svg-status-bar');
		await expect(statusBar).toBeVisible();
		await expect(statusBar).toHaveText('svg valid');

		// Toggle dark mode
		const darkButton = page.locator('#dark');
		await darkButton.click();

		// Status bar should still be visible and functional
		await expect(statusBar).toBeVisible();
		await expect(statusBar).toHaveText('svg valid');

		// Toggle back to light mode
		await darkButton.click();

		// Status bar should still work
		await expect(statusBar).toBeVisible();
		await expect(statusBar).toHaveText('svg valid');
	});
});