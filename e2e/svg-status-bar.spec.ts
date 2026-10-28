import { pressMenuItem } from './toolbar';
import { test, expect } from '@playwright/test';

test.describe('SVG Status Bar E2E Tests', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/index.html');
	});

	test('should display default "svg valid" status', async ({ page }) => {
		// Wait for the status bar to be visible
		const statusBar = page.locator('#svg-status');
		await expect(statusBar).toBeVisible();
		await expect(statusBar).toHaveText('SVG valid');
		await expect(statusBar).not.toHaveClass(/error/);
	});

	test('should show error status for malformed SVG', async ({ page }) => {
		// Wait for editor to load
		const editor = page.locator('#editor .cm-content');
		await expect(editor).toBeVisible();

		// Clear editor and type malformed SVG
		await editor.click();
		await page.keyboard.press('ControlOrMeta+a');
		await page.keyboard.type('<svg><rect width="100" height="100"></svg>'); // Missing closing rect tag

		// Wait for linting to process
		await page.waitForTimeout(1000);

		// Check status bar shows error
		const statusBar = page.locator('#svg-status');
		await expect(statusBar).toBeVisible();
		await expect(statusBar).not.toHaveText('SVG valid');
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

		// First verify initial valid state
		const statusBar = page.locator('#svg-status');
		await expect(statusBar).toHaveText('SVG valid');
		await expect(statusBar).not.toHaveClass(/error/);

		// Create an error
		await editor.fill('<svg><rect></svg>'); // Missing closing rect tag

		// Wait for linting
		await page.waitForTimeout(1500);

		// Verify error state
		await expect(statusBar).toHaveClass(/error/);
		await expect(statusBar).not.toHaveText('SVG valid');

		// Fix the error by typing valid SVG
		await editor.fill('<svg width="100" height="100"><rect width="50" height="50"/></svg>');

		// Wait longer for linting to process the change
		await page.waitForTimeout(3000);

		// Verify that the error is now cleared and status returns to valid
		await expect(statusBar).not.toHaveClass(/error/);
		await expect(statusBar).toHaveText('SVG valid');
	});

	test('should show warning for non-SVG content', async ({ page }) => {
		// Wait for editor to load
		const editor = page.locator('#editor .cm-content');
		await expect(editor).toBeVisible();

		// Type non-SVG content
		await editor.click();
		await page.keyboard.press('ControlOrMeta+a');
		await page.keyboard.type('<div>This is not SVG</div>');

		// Wait for linting
		await page.waitForTimeout(1000);

		// Check status bar shows error/warning
		const statusBar = page.locator('#svg-status');
		await expect(statusBar).toBeVisible();
		await expect(statusBar).toHaveClass(/error/);
		await expect(statusBar).toHaveText('SVG error: invalid contents');
	});

	test('should handle empty content gracefully', async ({ page }) => {
		// Wait for editor to load
		const editor = page.locator('#editor .cm-content');
		await expect(editor).toBeVisible();

		// Clear all content
		await editor.click();
		await page.keyboard.press('ControlOrMeta+a');
		await page.keyboard.press('Delete');

		// Wait for linting
		await page.waitForTimeout(1000);

		// Status bar should show valid, for empty content
		const statusBar = page.locator('#svg-status');
		await expect(statusBar).toHaveText('Buffer empty');
		await expect(statusBar).not.toHaveClass(/error/);
	});

	test('should not show floating tooltips', async ({ page }) => {
		// Wait for editor to load
		const editor = page.locator('#editor .cm-content');
		await expect(editor).toBeVisible();

		// Create an error
		await editor.click();
		await page.keyboard.press('ControlOrMeta+a');
		await page.keyboard.type('<svg><rect></svg>'); // Missing closing rect tag

		// Wait for linting
		await page.waitForTimeout(1000);

		// Verify that tooltips are hidden via CSS
		const tooltips = page.locator('.cm-tooltip');
		if (await tooltips.count() > 0) {
			// Check that tooltips are hidden via CSS display: none
			await expect(tooltips.first()).toHaveCSS('display', 'none');
		}

		// Verify error information is shown in status bar instead
		const statusBar = page.locator('#svg-status');
		await expect(statusBar).toHaveClass(/error/);
		await expect(statusBar).not.toHaveText('SVG valid');
	});

	test('should preserve status bar across theme changes', async ({ page }) => {
		// Wait for the status bar to be visible
		const statusBar = page.locator('#svg-status');
		await expect(statusBar).toBeVisible();
		await expect(statusBar).toHaveText('SVG valid');

		// Toggle dark mode
		await pressMenuItem(page, 'dark');

		// Status bar should still be visible and functional
		await expect(statusBar).toBeVisible();
		await expect(statusBar).toHaveText('SVG valid');

		// Toggle back to light mode
		await pressMenuItem(page, 'dark');

		// Status bar should still work
		await expect(statusBar).toBeVisible();
		await expect(statusBar).toHaveText('SVG valid');
	});

	test('should show the code\'s state as an icon in its colour, and only that corner in the error\'s colours', async ({ page }) => {
		const status = page.locator('#svg-status');
		const message = page.locator('#message');
		await expect(status.locator('svg.ok')).toBeVisible();
		await expect(status.locator('svg.bad')).toBeHidden();
		await expect(status.locator('svg.ok')).toHaveCSS('stroke', 'rgb(47, 111, 51)');
		// a drawing that is fine has nothing to say
		await expect(message).toHaveText('');

		await page.evaluate(() => {
			const view = (window as any).svgEditor.editor;
			view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: '<svg><rect></svg>' } });
		});
		await expect(status).toHaveClass(/error/);
		await expect(status.locator('svg.bad')).toBeVisible();
		await expect(status.locator('svg.ok')).toBeHidden();
		await expect(status).toHaveCSS('background-color', 'rgb(254, 242, 242)');
		await expect(message).toHaveText(/^SVG (error: |parsing error)/);
		await expect(message).toHaveClass(/error/);
		await expect(page.locator('#code-bar')).toHaveCSS('background-color', 'rgb(213, 214, 219)');

		await page.evaluate(() => {
			const view = (window as any).svgEditor.editor;
			view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: '' } });
		});
		await expect(status).toHaveClass(/empty/);
		await expect(status.locator('svg.blank')).toBeVisible();
		await expect(status).toHaveText('Buffer empty');
		await expect(message).toHaveText('Buffer empty');
		await expect(message).not.toHaveClass(/error/);
	});

	test('should keep the code\'s error in the message over a tool\'s note or hint, but not over a tool\'s error', async ({ page }) => {
		const message = page.locator('#message');
		await page.evaluate(() => {
			const view = (window as any).svgEditor.editor;
			view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><rect width="50" height="50">' } });
		});
		const codeError = /^SVG (error: |parsing error)/;
		await expect(message).toHaveText(codeError);
		// a note, or the hint of the tool taken up, waits behind it
		await page.evaluate(() => (window as any).svgEditor.say('rect drawn'));
		await page.locator('#mode-shapes').click();
		await page.locator('#draw-rect').click();
		await expect(message).toHaveText(codeError);
		await expect(message).toHaveClass(/error/);
		// an error a tool says is shown, for a while
		await page.evaluate(() => (window as any).svgEditor.announceError('The code has an error, so a shape cannot be added here. Fix the code first.'));
		await expect(message).toHaveText(/^The code has an error, so a shape cannot be added/);
		await expect(message).toHaveText(codeError, { timeout: 8000 });
		// once the code is fixed, the tool's hint comes back
		await page.evaluate(() => {
			const view = (window as any).svgEditor.editor;
			view.dispatch({ changes: { from: view.state.doc.length, insert: '</rect></svg>' } });
		});
		await expect(message).toHaveText('Drag across the drawing to draw a rectangle, or tap to place one');
		await expect(message).not.toHaveClass(/error/);
	});
});
