import { test, expect } from '@playwright/test';

test.describe('SVG Editor', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:8080/');
  });

  test('should load the SVG editor with default content', async ({ page }) => {
    // Check that the editor loads
    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.getByRole('complementary')).toBeVisible();
    
    // Check that the default SVG is rendered
    await expect(page.getByRole('textbox')).toBeVisible();
    await expect(page.locator('svg')).toBeVisible();
    
    // Check for the "Hello SVG" text in the preview
    await expect(page.getByText('Hello SVG')).toBeVisible();
  });

  test('should update SVG preview when code changes', async ({ page }) => {
    // Get the initial color
    const initialSvg = page.locator('svg circle');
    await expect(initialSvg).toHaveAttribute('fill', '#6291e0');
    
    // Change the SVG code
    const editor = page.getByRole('textbox');
    await editor.click();
    await page.keyboard.press('Control+a');
    await editor.fill(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
  <circle cx="100" cy="100" r="80" fill="#ff0000" stroke="#aa0000" stroke-width="2"/>
  <text x="100" y="110" text-anchor="middle" fill="white" font-family="Arial" font-size="16">
    Modified SVG
  </text>
</svg>`);
    
    // Check that the preview updates
    await expect(page.locator('svg circle')).toHaveAttribute('fill', '#ff0000');
    await expect(page.getByText('Modified SVG')).toBeVisible();
  });

  test('should have working zoom controls', async ({ page }) => {
    // Click zoom in button multiple times
    await page.getByRole('button', { name: '+' }).click();
    await page.getByRole('button', { name: '+' }).click();
    
    // Check that the SVG is still visible (zoom functionality working)
    await expect(page.locator('svg')).toBeVisible();
    
    // Click zoom out button
    await page.getByRole('button', { name: '-' }).click();
    
    // SVG should still be visible
    await expect(page.locator('svg')).toBeVisible();
  });

  test('should have flip screen button', async ({ page }) => {
    // Check that flip button exists
    const flipButton = page.getByRole('button', { name: 'flip screen' });
    await expect(flipButton).toBeVisible();
    
    // Click the flip button
    await flipButton.click();
    
    // Elements should still be visible after flip
    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.getByRole('complementary')).toBeVisible();
  });

  test('should render SVG with dashed border', async ({ page }) => {
    // Check that SVG has border styling
    const svg = page.locator('svg');
    await expect(svg).toBeVisible();
    
    // Check that the SVG has the expected border style
    await expect(svg).toHaveCSS('border', /dashed/);
  });
});