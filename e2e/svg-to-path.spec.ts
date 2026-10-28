import { test, expect, type Page } from '@playwright/test';

const getSource = (page: Page) =>
  page.evaluate(() => (window as any).svgEditor.editor.state.doc.toString() as string);

async function setContent(page: Page, content: string) {
  await page.evaluate((content) => {
    const view = (window as any).svgEditor.editor;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: content } });
  }, content);
}

/** The page point for a position in the drawing's user units, at 1:1. */
async function at(page: Page, x: number, y: number) {
  const svg = (await page.locator('.svg-container svg').boundingBox())!;
  return { x: svg.x + x, y: svg.y + y };
}

const FIXTURE = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
  <rect id="r" x="20" y="20" width="80" height="60" fill="#6291e0"/>
  <g id="grp">
    <circle id="c" cx="150" cy="50" r="30" fill="#aa0000"/>
    <ellipse id="e" cx="150" cy="150" rx="40" ry="20" fill="#00aa00"/>
    <line id="l" x1="20" y1="150" x2="100" y2="150" stroke="#000" stroke-width="6"/>
  </g>
  <path id="p" d="M20 180 L100 190" stroke="#000" stroke-width="4"/>
</svg>`;

test.describe('SVG Editor converting shapes to paths', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html');
    await expect(page.locator('.svg-container svg')).toBeVisible();
    await setContent(page, FIXTURE);
    await expect(page.locator('.svg-container rect')).toBeVisible();
  });

  test('should make a rect a path that draws the same, undone in one step', async ({ page }) => {
    const button = page.locator('#topath');
    await expect(button).toBeDisabled();
    await page.locator('.svg-container #r').click();
    await expect(button).toBeEnabled();
    await button.click();
    expect(await getSource(page)).toBe(FIXTURE.replace('<rect id="r" x="20" y="20" width="80" height="60" fill="#6291e0"/>', '<path id="r" d="M20 20 H100 V80 H20 Z" fill="#6291e0"/>'));
    await expect(page.locator('#test-announcements')).toHaveText('rect made a path: press Enter to edit its points');
    // still selected, and now its points can be edited
    await expect(page.locator('#points')).toBeEnabled();
    await expect(button).toBeDisabled();
    await page.keyboard.press('Enter');
    await expect(page.locator('.points rect')).toHaveCount(4);

    await page.keyboard.press('Escape');
    await page.locator('#undo').click();
    expect(await getSource(page)).toBe(FIXTURE);
  });

  test('should make every shape in a selected group a path, leaving the rest alone', async ({ page }) => {
    const circle = page.locator('.svg-container #c');
    await circle.click();
    // the first click picks the group
    expect(await page.evaluate(() => (window as any).svgEditor.selected)).toEqual([2]);
    await page.locator('#topath').click();
    const source = await getSource(page);
    expect(source).toContain('<path id="c" d="M180 50 C180 66.57 166.57 80 150 80 C133.43 80 120 66.57 120 50 C120 33.43 133.43 20 150 20 C166.57 20 180 33.43 180 50 Z" fill="#aa0000"/>');
    expect(source).toContain('<path id="e" d="M190 150 C190 161.05 172.09 170 150 170 C127.91 170 110 161.05 110 150 C110 138.95 127.91 130 150 130 C172.09 130 190 138.95 190 150 Z" fill="#00aa00"/>');
    expect(source).toContain('<path id="l" d="M20 150 L100 150" stroke="#000" stroke-width="6"/>');
    expect(source).toContain('<rect id="r"');
    expect(source).toContain('<path id="p" d="M20 180 L100 190"');
    await expect(page.locator('#test-announcements')).toHaveText('3 shapes made paths');
    await expect(page.locator('.svg-container circle, .svg-container ellipse, .svg-container line')).toHaveCount(0);
  });

  test('should convert several selected shapes at once, and read a percentage as the drawing lays it out', async ({ page }) => {
    await setContent(page, FIXTURE.replace('x="20" y="20" width="80" height="60"', 'x="10%" y="20" width="40%" height="30%"'));
    await page.locator('.svg-container #r').click();
    await page.locator('.svg-container #p').click({ modifiers: ['ControlOrMeta'] });
    await page.locator('#topath').click();
    expect(await getSource(page)).toContain('<path id="r" d="M20 20 H100 V80 H20 Z" fill="#6291e0"/>');
  });

  test('should say a rect needs to be a path before its points can be edited, and offer To path in Points', async ({ page }) => {
    await page.locator('.svg-container #r').click();
    await page.keyboard.press('Enter');
    await expect(page.locator('#points')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#error-announcements')).toHaveText('A rect has no points to edit until it is a path: press To path.');
    await expect(page.locator('.points rect')).toHaveCount(0);
    // the point tools wait for something with points; To path is at hand meanwhile
    await expect(page.locator('#point-add')).toBeDisabled();
    await expect(page.locator('#topath')).toBeVisible();
    await page.locator('#topath').click();
    await expect(page.locator('.points rect')).toHaveCount(4);
    await expect(page.locator('#topath')).toBeHidden();
  });

  test('should make a line a path when one of its points tools needs curves', async ({ page }) => {
    const middle = await at(page, 60, 150);
    await page.mouse.click(middle.x, middle.y);
    await page.mouse.click(middle.x, middle.y);
    expect(await page.evaluate(() => (window as any).svgEditor.selected)).toEqual([5]);
    await page.keyboard.press('Enter');
    await expect(page.locator('.points rect')).toHaveCount(2);
    await page.mouse.click(middle.x, middle.y);
    await expect(page.locator('#point-curve')).toBeEnabled();
    await page.locator('#point-curve').click();
    expect(await getSource(page)).toContain('<path id="l" d="M20 150 C47 150 73 150 100 150" stroke="#000" stroke-width="6"/>');
    // still editing its points, now as a path's
    await expect(page.locator('.points rect')).toHaveCount(2);
    await expect(page.locator('.points circle')).toHaveCount(2);
  });

  test('should add a point to a line, making it a path', async ({ page }) => {
    const middle = await at(page, 60, 150);
    await page.mouse.click(middle.x, middle.y);
    await page.mouse.click(middle.x, middle.y);
    await page.keyboard.press('Enter');
    await page.mouse.dblclick(middle.x, middle.y);
    expect(await getSource(page)).toContain('<path id="l" d="M20 150 L60 150 L100 150" stroke="#000" stroke-width="6"/>');
    await expect(page.locator('.points rect')).toHaveCount(3);
  });
});
