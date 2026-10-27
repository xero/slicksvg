import { test, expect, type Page } from '@playwright/test';

const getSource = (page: Page) =>
  page.evaluate(() => (window as any).svgEditor.editor.state.doc.toString() as string);

const editorSelection = (page: Page) =>
  page.evaluate(() => {
    const state = (window as any).svgEditor.editor.state;
    return state.doc.sliceString(state.selection.main.from, state.selection.main.to) as string;
  });

async function setContent(page: Page, content: string) {
  await page.evaluate((content) => {
    const view = (window as any).svgEditor.editor;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: content } });
  }, content);
}

/** Drag the marker of point `index` by (dx, dy) screen pixels. */
async function dragPoint(page: Page, index: number, dx: number, dy: number) {
  const box = (await page.locator(`.points [data-point="${index}"]`).boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 });
  await page.mouse.move(x + dx, y + dy, { steps: 4 });
  await page.mouse.up();
}

/** The page point for a position in the drawing's user units, at 1:1. */
async function at(page: Page, x: number, y: number) {
  const svg = (await page.locator('.svg-container svg').boundingBox())!;
  return { x: svg.x + x, y: svg.y + y };
}

const FIXTURE = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
  <path id="p" d="M20 20 L100 20 L100 100 Z" fill="#6291e0"/>
  <polygon id="g" points="120,120 180,120 150,180" fill="#aa0000"/>
</svg>`;

test.describe('SVG Editor Point Editing', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html');
    await expect(page.locator('.svg-container svg')).toBeVisible();
    await setContent(page, FIXTURE);
    await expect(page.locator('.svg-container path')).toBeVisible();
  });

  test('should enter point editing with Enter and leave it with Escape, keeping the selection', async ({ page }) => {
    const button = page.locator('#points');
    await expect(button).toBeDisabled();
    await page.locator('.svg-container path').click();
    await expect(button).toBeEnabled();
    await expect(page.locator('[data-handle="se"]')).toBeVisible();

    await page.keyboard.press('Enter');
    await expect(page.locator('.points rect')).toHaveCount(3);
    await expect(page.locator('[data-handle="se"]')).toBeHidden();
    await expect(button).toHaveAttribute('aria-pressed', 'true');

    await page.keyboard.press('Escape');
    await expect(page.locator('.points rect')).toHaveCount(0);
    await expect(page.locator('.select-overlay .select-box')).toBeVisible();
    await expect(button).toHaveAttribute('aria-pressed', 'false');
  });

  test('should move a point by dragging its marker, and select its numbers in the editor', async ({ page }) => {
    await page.locator('.svg-container path').click();
    await page.keyboard.press('Enter');
    await dragPoint(page, 1, 20, 10);
    expect(await getSource(page)).toBe(FIXTURE.replace('L100 20', 'L120 30'));
    expect(await editorSelection(page)).toBe('120 30');
    await expect(page.locator('.points rect.selected')).toHaveCount(1);

    await page.locator('#undo').click();
    expect(await getSource(page)).toBe(FIXTURE);
  });

  test('should add a point where the outline is double-clicked', async ({ page }) => {
    const path = page.locator('.svg-container path');
    await path.click();
    await path.dblclick();
    await expect(page.locator('.points rect')).toHaveCount(3);

    const spot = await at(page, 60, 20);
    await page.mouse.dblclick(spot.x, spot.y);
    expect(await getSource(page)).toBe(FIXTURE.replace('L100 20', 'L60 20 L100 20'));
    await expect(page.locator('.points rect')).toHaveCount(4);
    expect(await editorSelection(page)).toBe('60 20');
  });

  test('should remove the selected point with Delete and nudge it with the arrows', async ({ page }) => {
    await page.locator('.svg-container path').click();
    await page.keyboard.press('Enter');
    await page.locator('.points [data-point="1"]').click();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowDown');
    expect(await getSource(page)).toBe(FIXTURE.replace('L100 20', 'L102 21'));

    await page.keyboard.press('Delete');
    expect(await getSource(page)).toBe(FIXTURE.replace('L100 20 L100 100', 'L100 100'));
    await expect(page.locator('.points rect')).toHaveCount(2);
  });

  test('should edit a polygon\'s points the same way', async ({ page }) => {
    const polygon = page.locator('.svg-container polygon');
    await polygon.click();
    await polygon.dblclick();
    await expect(page.locator('.points rect')).toHaveCount(3);

    await dragPoint(page, 2, 0, -10);
    expect(await getSource(page)).toBe(FIXTURE.replace('150,180', '150,170'));

    const spot = await at(page, 150, 120);
    await page.mouse.dblclick(spot.x, spot.y);
    expect(await getSource(page)).toBe(FIXTURE.replace('120,120 180,120 150,180', '120,120 150,120 180,120 150,170'));

    await page.keyboard.press('Delete');
    expect(await getSource(page)).toBe(FIXTURE.replace('150,180', '150,170'));
  });

  test('should show curve handles and move them without moving the anchors', async ({ page }) => {
    await setContent(page, FIXTURE.replace('M20 20 L100 20 L100 100 Z', 'M20 100 C20 20 100 20 100 100'));
    const path = page.locator('.svg-container path');
    await path.click({ position: { x: 40, y: 60 } });
    await page.keyboard.press('Enter');
    await expect(page.locator('.points circle')).toHaveCount(2);
    await expect(page.locator('.points line')).toHaveCount(2);

    await dragPoint(page, 1, 10, 10);
    expect(await getSource(page)).toContain('d="M20 100 C30 30 100 20 100 100"');
  });

  test('should leave point editing when another element is selected', async ({ page }) => {
    await page.locator('.svg-container path').click();
    await page.keyboard.press('Enter');
    await expect(page.locator('.points rect')).toHaveCount(3);
    await page.locator('.svg-container polygon').click();
    await expect(page.locator('.points rect')).toHaveCount(0);
    await expect(page.locator('[data-handle="se"]')).toBeVisible();
  });
});
