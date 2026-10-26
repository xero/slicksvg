import { test, expect, type Page } from '@playwright/test';

const getSource = (page: Page) =>
  page.evaluate(() => (window as any).svgEditor.editor.state.doc.toString() as string);

async function setContent(page: Page, content: string) {
  await page.evaluate((content) => {
    const view = (window as any).svgEditor.editor;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: content } });
  }, content);
}

test.describe('SVG Editor Edit History', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html');
    await expect(page.locator('.svg-container svg')).toBeVisible();
  });

  test('should rewrite only the root svg tag when rotating, and undo it in one step', async ({ page }) => {
    const original = await getSource(page);

    await page.locator('#rotate').click();
    await expect(page.locator('.svg-container svg')).toHaveAttribute('transform', 'rotate(90)');
    expect(await getSource(page)).toBe(
      original.replace('viewBox="0 0 200 200">', 'viewBox="0 0 200 200" transform="rotate(90)">'),
    );

    await page.locator('#undo').click();
    await expect(page.locator('.svg-container svg')).not.toHaveAttribute('transform');
    expect(await getSource(page)).toBe(original);
  });

  test('should enable undo and redo as the history allows', async ({ page }) => {
    const undo = page.locator('#undo');
    const redo = page.locator('#redo');
    await expect(undo).toBeDisabled();
    await expect(redo).toBeDisabled();

    await page.locator('#flipx').click();
    await expect(undo).toBeEnabled();
    await expect(redo).toBeDisabled();

    await undo.click();
    await expect(undo).toBeDisabled();
    await expect(redo).toBeEnabled();

    await redo.click();
    await expect(page.locator('.svg-container svg')).toHaveAttribute('transform', 'matrix(-1,0,0,1,0,0)');
    await expect(redo).toBeDisabled();
  });

  test('should undo and redo from outside the editor with the keyboard', async ({ page }) => {
    await page.locator('#rotate').click();
    await expect(page.locator('.svg-container svg')).toHaveAttribute('transform', 'rotate(90)');

    await page.locator('.svg-preview-wrapper').click();
    await page.keyboard.press('ControlOrMeta+z');
    await expect(page.locator('.svg-container svg')).not.toHaveAttribute('transform');

    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect(page.locator('.svg-container svg')).toHaveAttribute('transform', 'rotate(90)');
  });

  test('should resize only the root svg and leave child sizes alone', async ({ page }) => {
    await setContent(page, '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="50" height="50"/></svg>');
    await expect(page.locator('.svg-container rect')).toBeVisible();

    await page.locator('#resolution').click();
    const modal = page.locator('dialog');
    await modal.locator('#width').fill('300');
    await modal.locator('#height').fill('400');
    await modal.locator('#resize').click();

    await expect(page.locator('.svg-container svg')).toHaveAttribute('viewBox', '0 0 300 400');
    expect(await getSource(page)).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400" viewBox="0 0 300 400"><rect width="50" height="50"/></svg>',
    );

    await page.locator('#undo').click();
    await expect(page.locator('.svg-container svg')).toHaveAttribute('width', '100');
    await expect(page.locator('.svg-container svg')).not.toHaveAttribute('viewBox');
  });

  test('should keep the preview traceable to the source by stamping elements', async ({ page }) => {
    await expect(page.locator('.svg-container svg')).toHaveAttribute('data-slick-src', '0');
    await expect(page.locator('.svg-container circle')).toHaveAttribute('data-slick-src', '1');
    await expect(page.locator('.svg-container text')).toHaveAttribute('data-slick-src', '2');
  });
});
