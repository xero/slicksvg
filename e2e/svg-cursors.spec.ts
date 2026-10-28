import { test, expect, type Page, type Locator } from '@playwright/test';

async function setContent(page: Page, content: string) {
  await page.evaluate((content) => {
    const view = (window as any).svgEditor.editor;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: content } });
  }, content);
}

const cursorOf = (el: Locator) => el.evaluate(e => getComputedStyle(e).cursor);
const canvas = (page: Page) => page.locator('.svg-preview-wrapper');
const handle = (page: Page, name: string) => page.locator(`[data-handle="${name}"]`);

async function centreOf(el: Locator) {
  const box = await el.boundingBox();
  if (!box) throw new Error('not on screen');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

// one pixel to the unit; the rect is wide enough to show its side handles
const FIXTURE = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
  <rect id="box" x="20" y="20" width="60" height="60" fill="#6291e0"/>
  <rect id="bar" x="20" y="110" width="160" height="16" fill="#aa0000"/>
  <rect id="turned" x="120" y="20" width="60" height="40" transform="rotate(90 150 40)" fill="#00aa00"/>
</svg>`;

const SQUARE = {
  nw: 'nwse-resize', ne: 'nesw-resize', se: 'nwse-resize', sw: 'nesw-resize',
  n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize',
};

test.describe('preview cursors', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html');
    await expect(page.locator('.svg-container svg')).toBeVisible();
    await setContent(page, FIXTURE);
    await expect(page.locator('#box')).toBeVisible();
  });

  test('each resize handle shows the arrow for the way it pulls, and the rotate handle shows move', async ({ page }) => {
    await page.locator('#box').click();
    await expect(handle(page, 'n')).toBeVisible();
    for (const [name, cursor] of Object.entries(SQUARE)) {
      expect(await cursorOf(handle(page, name)), name).toBe(cursor);
    }
    expect(await cursorOf(handle(page, 'rotate'))).toBe('move');
  });

  test('the corners of a long thin element keep their diagonals', async ({ page }) => {
    await page.locator('#bar').click({ position: { x: 20, y: 8 } });
    await expect(handle(page, 'nw')).toBeVisible();
    for (const name of ['nw', 'ne', 'se', 'sw']) {
      expect(await cursorOf(handle(page, name)), name).toBe(SQUARE[name as keyof typeof SQUARE]);
    }
  });

  test('the handles of a turned element point the way they face', async ({ page }) => {
    await page.locator('#turned').click();
    await expect(handle(page, 'n')).toBeVisible();
    // a quarter turn swaps the diagonals and the straight arrows
    expect(await cursorOf(handle(page, 'nw'))).toBe('nesw-resize');
    expect(await cursorOf(handle(page, 'ne'))).toBe('nwse-resize');
    expect(await cursorOf(handle(page, 'n'))).toBe('ew-resize');
    expect(await cursorOf(handle(page, 'e'))).toBe('ns-resize');
  });

  test('the selection shows an open hand, which closes while it is dragged', async ({ page }) => {
    const box = page.locator('#box');
    await box.click();
    const at = await centreOf(box);
    await page.mouse.move(at.x + 5, at.y + 5);
    await expect.poll(() => cursorOf(canvas(page))).toBe('grab');
    // an element that is not selected offers a click instead
    const bar = await centreOf(page.locator('#bar'));
    await page.mouse.move(bar.x - 60, bar.y);
    await expect.poll(() => cursorOf(canvas(page))).toBe('pointer');

    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    expect(await cursorOf(canvas(page))).toBe('grabbing');
    await page.mouse.move(at.x + 20, at.y + 10, { steps: 4 });
    expect(await cursorOf(canvas(page))).toBe('grabbing');
    await page.mouse.up();
    await expect(page.locator('#box')).toHaveAttribute('x', '40');
    expect(await cursorOf(canvas(page))).toBe('grab');
  });

  test('a resize keeps its arrow and a turn keeps move, wherever the pointer strays', async ({ page }) => {
    await page.locator('#box').click();
    const se = await centreOf(handle(page, 'se'));
    await page.mouse.move(se.x, se.y);
    await page.mouse.down();
    await page.mouse.move(se.x + 30, se.y + 30, { steps: 4 });
    expect(await cursorOf(canvas(page))).toBe('nwse-resize');
    await page.mouse.up();

    const spin = await centreOf(handle(page, 'rotate'));
    await page.mouse.move(spin.x, spin.y);
    await page.mouse.down();
    await page.mouse.move(spin.x + 40, spin.y + 30, { steps: 4 });
    expect(await cursorOf(canvas(page))).toBe('move');
    await page.mouse.up();
    expect(await cursorOf(canvas(page))).toBe('grab');
  });

  test('the canvas shows an open hand, which closes while it pans', async ({ page }) => {
    const pane = await canvas(page).boundingBox();
    if (!pane) throw new Error('no canvas');
    // above the strip of tools at the foot of the preview
    const [x, y] = [pane.x + pane.width - 40, pane.y + pane.height - 100];
    await page.mouse.move(x, y);
    expect(await cursorOf(canvas(page))).toBe('grab');
    await page.mouse.down();
    await page.mouse.move(x - 30, y - 20, { steps: 4 });
    expect(await cursorOf(canvas(page))).toBe('grabbing');
    await page.mouse.up();
    expect(await cursorOf(canvas(page))).toBe('grab');
  });
});
