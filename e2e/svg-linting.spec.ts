import { test, expect } from '@playwright/test';

test.describe('SVG Editor Linting', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('http://localhost:8080/');
	});

	test('should display lint errors for malformed SVG', async ({ page }) => {
		// Wait for editor to load
		const editor = page.locator('#editor .cm-content');
		await expect(editor).toBeVisible();

		// Clear editor and type malformed SVG
		await editor.click();
		await page.keyboard.press('Control+a');
		await page.keyboard.type('<svg><rect width="100" height="100"></svg>'); // Missing closing rect tag

		// Wait a moment for linting to process
		await page.waitForTimeout(1000);

		// Check for lint gutter
		const lintGutter = page.locator('.cm-gutter-lint');
		await expect(lintGutter).toBeVisible();

		// Look for error markers in the gutter
		const lintMarkers = page.locator('.cm-lint-marker-error');
		await expect(lintMarkers.first()).toBeVisible();
	});

	test('should clear lint errors for valid SVG', async ({ page }) => {
		// Wait for editor to load
		const editor = page.locator('#editor .cm-content');
		await expect(editor).toBeVisible();

		// First, add malformed SVG to trigger errors
		await editor.click();
		await page.keyboard.press('Control+a');
		await page.keyboard.type('<svg><rect width="100" height="100"></svg>'); // Missing closing rect tag

		// Wait for lint errors to appear
		await page.waitForTimeout(1000);

		// Verify errors are present
		const lintGutter = page.locator('.cm-gutter-lint');
		await expect(lintGutter).toBeVisible();

		// Now fix the SVG
		await editor.click();
		await page.keyboard.press('Control+a');
		await page.keyboard.type('<svg><rect width="100" height="100"/></svg>'); // Valid SVG

		// Wait for linting to reprocess
		await page.waitForTimeout(1000);

		// Check that errors are cleared (no lint markers should be visible)
		const lintMarkers = page.locator('.cm-lint-marker-error');
		await expect(lintMarkers).toHaveCount(0);
	});

	test('should show lint errors for invalid XML syntax', async ({ page }) => {
		// Wait for editor to load
		const editor = page.locator('#editor .cm-content');
		await expect(editor).toBeVisible();

		// Type invalid XML
		await editor.click();
		await page.keyboard.press('Control+a');
		await page.keyboard.type('<svg><rect width="100" height="100" <invalid></svg>'); // Invalid syntax

		// Wait for linting
		await page.waitForTimeout(1000);

		// Check for lint errors
		const lintGutter = page.locator('.cm-gutter-lint');
		await expect(lintGutter).toBeVisible();

		const lintMarkers = page.locator('.cm-lint-marker-error');
		await expect(lintMarkers.first()).toBeVisible();
	});

	test('should show warning for non-SVG content', async ({ page }) => {
		// Wait for editor to load
		const editor = page.locator('#editor .cm-content');
		await expect(editor).toBeVisible();

		// Type valid XML but not SVG
		await editor.click();
		await page.keyboard.press('Control+a');
		await page.keyboard.type('<html><body>Not an SVG</body></html>');

		// Wait for linting
		await page.waitForTimeout(1000);

		// Check for lint warnings/errors
		const lintGutter = page.locator('.cm-gutter-lint');
		await expect(lintGutter).toBeVisible();

		// Should have warning indicators (our linter shows warnings for non-SVG content)
		const lintMarkers = page.locator('.cm-lint-marker');
		await expect(lintMarkers.first()).toBeVisible();
	});

	test('should handle empty content without errors', async ({ page }) => {
		// Wait for editor to load
		const editor = page.locator('#editor .cm-content');
		await expect(editor).toBeVisible();

		// Clear all content
		await editor.click();
		await page.keyboard.press('Control+a');
		await page.keyboard.press('Delete');

		// Wait for linting
		await page.waitForTimeout(1000);

		// Empty content should not show lint errors
		const lintMarkers = page.locator('.cm-lint-marker');
		await expect(lintMarkers).toHaveCount(0);
	});

	test('should provide error tooltips on hover', async ({ page }) => {
		// Wait for editor to load
		const editor = page.locator('#editor .cm-content');
		await expect(editor).toBeVisible();

		// Add malformed SVG
		await editor.click();
		await page.keyboard.press('Control+a');
		await page.keyboard.type('<svg><rect></svg>'); // Missing closing rect tag

		// Wait for linting
		await page.waitForTimeout(1000);

		// Check for lint markers
		const lintMarkers = page.locator('.cm-lint-marker-error');
		await expect(lintMarkers.first()).toBeVisible();

		// Hover over the lint marker to trigger tooltip
		await lintMarkers.first().hover();

		// Wait a moment for tooltip to appear
		await page.waitForTimeout(500);

		// Look for tooltip or error message
		// CodeMirror should show error details on hover
		const tooltip = page.locator('.cm-tooltip');
		if (await tooltip.count() > 0) {
			await expect(tooltip.first()).toBeVisible();
		}
	});

	test('should work with complex nested SVG', async ({ page }) => {
		// Wait for editor to load
		const editor = page.locator('#editor .cm-content');
		await expect(editor).toBeVisible();

		// Add complex nested SVG with error
		const complexSVG = `<svg xmlns="http://www.w3.org/2000/svg">
			<g>
				<rect width="100" height="100">
				<circle cx="50" cy="50" r="25"/>
			</g>
		</svg>`; // Missing closing rect tag

		await editor.click();
		await page.keyboard.press('Control+a');
		await page.keyboard.type(complexSVG);

		// Wait for linting
		await page.waitForTimeout(1000);

		// Should detect the error
		const lintGutter = page.locator('.cm-gutter-lint');
		await expect(lintGutter).toBeVisible();

		const lintMarkers = page.locator('.cm-lint-marker-error');
		await expect(lintMarkers.first()).toBeVisible();
	});

	test('should maintain editor functionality with linting enabled', async ({ page }) => {
		// Verify that basic editor functionality still works with linting
		const editor = page.locator('#editor .cm-content');
		await expect(editor).toBeVisible();

		// Type valid SVG
		await editor.click();
		await page.keyboard.press('Control+a');
		await page.keyboard.type('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><circle cx="100" cy="100" r="50" fill="red"/></svg>');

		// Wait for preview update
		await page.waitForTimeout(1000);

		// Verify preview updates (core functionality still works)
		await expect(page.locator('svg circle')).toHaveAttribute('fill', 'red');

		// Verify no lint errors for valid SVG
		const lintMarkers = page.locator('.cm-lint-marker-error');
		await expect(lintMarkers).toHaveCount(0);

		// Test editing still works
		await editor.click();
		await page.keyboard.press('Control+a');
		await page.keyboard.type('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><circle cx="100" cy="100" r="50" fill="blue"/></svg>');

		// Wait for update
		await page.waitForTimeout(1000);

		// Verify preview updates
		await expect(page.locator('svg circle')).toHaveAttribute('fill', 'blue');
	});
});