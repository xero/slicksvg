import { useHello } from './fixtures';
import { test, expect, type Page } from '@playwright/test';

const HIGHLIGHT = 'url(#highlight-glow)';

// Place the editor cursor at a source offset through the app's exposed editor instance
async function setCursor(page: Page, needle: string, offset = 0) {
  await page.evaluate(({ needle, offset }) => {
    const view = (window as any).svgEditor.editor;
    const pos = view.state.doc.toString().indexOf(needle) + offset;
    view.dispatch({ selection: { anchor: pos } });
  }, { needle, offset });
}

async function setContent(page: Page, content: string) {
  await page.evaluate((content) => {
    const view = (window as any).svgEditor.editor;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: content } });
  }, content);
}

test.describe('SVG Editor X-ray Mode', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html');
    await expect(page.locator('#editor .cm-content')).toBeVisible();
    await expect(page.locator('.svg-container svg')).toBeVisible();
    await useHello(page);
  });

  test('should highlight the element under the cursor when x-ray is enabled', async ({ page }) => {
    await setCursor(page, '<circle', 3);
    await page.locator('#xray').click();

    await expect(page.locator('.svg-container circle')).toHaveAttribute('filter', HIGHLIGHT);
    await expect(page.locator('.svg-container svg')).not.toHaveAttribute('filter', HIGHLIGHT);
  });

  test('should move the highlight as the cursor moves between elements', async ({ page }) => {
    await page.locator('#xray').click();

    await setCursor(page, '<text', 3);
    await expect(page.locator('.svg-container text')).toHaveAttribute('filter', HIGHLIGHT);
    await expect(page.locator('.svg-container circle')).not.toHaveAttribute('filter', HIGHLIGHT);

    // text content inside <text> still belongs to the text element
    await setCursor(page, 'Hello SVG');
    await expect(page.locator('.svg-container text')).toHaveAttribute('filter', HIGHLIGHT);

    await setCursor(page, '<circle', 3);
    await expect(page.locator('.svg-container circle')).toHaveAttribute('filter', HIGHLIGHT);
    await expect(page.locator('.svg-container text')).not.toHaveAttribute('filter', HIGHLIGHT);
  });

  test('should clear the highlight when x-ray is disabled', async ({ page }) => {
    await setCursor(page, '<circle', 3);
    await page.locator('#xray').click();
    await expect(page.locator('.svg-container circle')).toHaveAttribute('filter', HIGHLIGHT);

    await page.locator('#xray').click();
    await expect(page.locator(`.svg-container [filter="${HIGHLIGHT}"]`)).toHaveCount(0);
  });

  test("should restore an element's own filter when the highlight is cleared", async ({ page }) => {
    await setContent(page, '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="50" height="50" filter="url(#own)"/><circle cx="75" cy="75" r="10"/></svg>');
    await expect(page.locator('.svg-container rect')).toHaveAttribute('filter', 'url(#own)');

    await setCursor(page, '<rect', 3);
    await page.locator('#xray').click();
    await expect(page.locator('.svg-container rect')).toHaveAttribute('filter', HIGHLIGHT);

    await page.locator('#xray').click();
    await expect(page.locator('.svg-container rect')).toHaveAttribute('filter', 'url(#own)');
    await expect(page.locator(`.svg-container [filter="${HIGHLIGHT}"]`)).toHaveCount(0);
  });
});
